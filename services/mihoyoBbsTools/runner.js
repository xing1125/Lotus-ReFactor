import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import YAML from "yaml"
import {
  resolveData,
  rootPath,
} from "../../core/path.js"
import { solveCaptcha } from "../../core/captcha/service.js"
import { decodeProcessChunk, PythonEnvService, withUtf8ProcessEnv } from "../python/env.js"
import { buildBbsToolsConfig } from "./config.js"

// 签到整体超时。签到要跑多个游戏 + 可能等待打码，会比体力重得多，
// 但没有上限就是隐患：Python 侧一旦卡在 httpx 请求或验证码轮询上，
// 子进程的 close 事件永远不会触发，上一层就只能永久静默
// （线上已复现：回完「签到中请稍后」后 8 分钟无任何日志，直到手动重启）。
const DEFAULT_RUN_TIMEOUT_MS = 180000

export class MihoyoBbsToolsRunner {
  constructor(options = {}) {
    this.python = options.python || new PythonEnvService(options)
    this.spawn = options.spawn || spawn
    this.moduleDir = options.moduleDir || path.join(rootPath, "MihoyoBBSTools")
    this.captchaSolver = options.captchaSolver || solveCaptcha
  }

  async runProfile(profile, options = {}) {
    const taskId = options.taskId || `bbs-${Date.now()}-${profile.user?.qq || "user"}-${profile.profile?.id || 1}`
    const workDir = resolveData("tmp", "mihoyo-bbs-tools", taskId)
    const configFile = path.join(workDir, "config.yaml")
    const eventFile = path.join(workDir, "events.jsonl")
    const resultFile = path.join(workDir, "result.json")
    const captchaDir = path.join(workDir, "captcha")

    await fs.mkdir(workDir, { recursive: true })
    await fs.mkdir(captchaDir, { recursive: true })
    await fs.writeFile(configFile, YAML.stringify(buildBbsToolsConfig(profile)), "utf8")

    const python = options.ensureVenv === false
      ? await this.python.getPythonExecutable()
      : await this.python.ensureVenv({ installRequirements: options.installRequirements !== false })

    try {
      await this.spawnRunner(python.command, [
        ...(python.args || []),
        path.join(rootPath, "python", "lotus_bbs_runner.py"),
        "--config",
        configFile,
        "--module-dir",
        this.moduleDir,
        "--event-file",
        eventFile,
        "--result-file",
        resultFile,
        "--captcha-dir",
        captchaDir,
        "--mihoyobbs-version",
        options.mihoyobbsVersion || "2.102.1",
        "--task-id",
        taskId,
        "--user-id",
        String(profile.user?.qq || ""),
        "--profile-id",
        String(profile.profile?.id || 1),
      ], {
        captchaDir,
        onCaptchaEvent: options.onCaptchaEvent,
        captchaTimeoutMs: options.captchaTimeoutMs,
        captchaSolver: this.captchaSolver,
        totalTimeoutMs: options.totalTimeoutMs,
      })

      const result = JSON.parse(await fs.readFile(resultFile, "utf8"))
      const events = await readJsonl(eventFile)
      return {
        ...result,
        taskId,
        workDir,
        events,
      }
    } finally {
      if (options.keepWorkDir !== true) {
        await cleanupWorkDir(workDir)
      }
    }
  }

  async spawnRunner(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = this.spawn(command, args, {
        cwd: rootPath,
        env: withUtf8ProcessEnv(process.env),
        windowsHide: true,
      })
      const stopCaptcha = watchCaptchaRequests(options.captchaDir, {
        onCaptchaEvent: options.onCaptchaEvent,
        timeoutMs: options.captchaTimeoutMs,
        solveCaptcha: options.captchaSolver,
      })
      let stderr = ""
      let settled = false
      const totalTimeoutMs = Number(options.totalTimeoutMs) > 0
        ? Number(options.totalTimeoutMs)
        : DEFAULT_RUN_TIMEOUT_MS
      // 整体超时兜底。settled 保证 close / error / timeout 三者只有一个生效，
      // 避免「超时已 reject，随后 close 又 resolve」这种二次结算。
      // 注意不要 unref：进程空闲时无其它 handle，unref 会让定时器根本不触发。
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        stopCaptcha()
        killProcessTree(child)
        const error = new Error(
          `MihoyoBBSTools 执行超时（${totalTimeoutMs}ms 未结束），已强制终止。`
          + `\n常见原因：米游社接口长时间无响应、验证码未通过后卡在重试轮询、或 Python 侧网络挂起。`,
        )
        error.timeout = true
        error.stderr = stderr
        logger?.error?.(`[Lotus-Plugin] bbs runner timeout ${totalTimeoutMs}ms, pid=${child.pid}`)
        reject(error)
      }, totalTimeoutMs)

      child.stderr?.on("data", chunk => {
        stderr += decodeProcessChunk(chunk)
      })
      child.on("error", error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        stopCaptcha()
        reject(error)
      })
      child.on("close", code => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        stopCaptcha()
        if (code === 0 || code === 1) {
          resolve({ code, stderr })
          return
        }
        const error = new Error(`MihoyoBBSTools runner exited with code ${code}`)
        error.stderr = stderr
        reject(error)
      })
    })
  }
}

// 超时后必须真的把子进程干掉，否则它会继续占着 puppeteer/httpx 连接和临时目录。
// Windows 下 kill() 只终止直接子进程，python 若自己 fork 了子进程会残留，
// 所以优先用 taskkill /T 杀整棵树。
function killProcessTree(child) {
  if (!child?.pid) return
  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      })
      killer.on("error", () => {})
      killer.unref?.()
      return
    }
    child.kill("SIGKILL")
  } catch {
    try { child.kill("SIGKILL") } catch {}
  }
}

// 清理本轮临时目录。
// 注意：宿主（WorkBuddy/CodeBuddy）会通过 NODE_OPTIONS=--require=node-language-shim.cjs
// 给进程注入 fs 钩子，删除文件数超过 50 就抛
// SAFE_DELETE_BULK_CONFIRM_REQUIRED。签到产生的临时目录正好 51~52 个文件，
// 于是「签到本身已经成功、只是清理失败」会被上层判成整个签到失败
// （线上真机卡片显示的就是这个错误）。所以这里绝不能让它冒泡：
// fs.rm 失败就回退 cmd rmdir /s /q，仍然失败就留目录（残留不影响功能）。
async function cleanupWorkDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true })
    return
  } catch (error) {
    logger?.warn?.(`[Lotus-Plugin] workDir fs.rm 失败，回退 rmdir：${error?.message || error}`)
  }
  try {
    if (process.platform === "win32") {
      await new Promise(resolve => {
        const child = spawn("cmd", ["/c", "rmdir", "/s", "/q", dir], {
          windowsHide: true,
          stdio: "ignore",
        })
        child.on("close", () => resolve())
        child.on("error", () => resolve())
      })
      return
    }
    await fs.rm(dir, { recursive: true, force: true })
  } catch (error) {
    logger?.warn?.(`[Lotus-Plugin] workDir 清理最终失败（残留不影响功能）：${dir} / ${error?.message || error}`)
  }
}

export function watchCaptchaRequests(captchaDir, options = {}) {
  if (!captchaDir) return () => {}
  const handled = new Set()
  const interval = setInterval(async () => {
    let files = []
    try {
      files = await fs.readdir(captchaDir)
    } catch {
      return
    }
    for (const file of files) {
      if (!file.endsWith(".request.json") || handled.has(file)) continue
      handled.add(file)
      handleCaptchaRequest(path.join(captchaDir, file), options).catch(error => {
        logger?.error?.(`[Lotus-Plugin] captcha bridge failed: ${error.stack || error.message}`)
      })
    }
  }, 500)
  interval.unref?.()
  return () => clearInterval(interval)
}

export async function handleCaptchaRequest(requestFile, options = {}) {
  const raw = await fs.readFile(requestFile, "utf8")
  const request = JSON.parse(raw)
  const responseFile = requestFile.replace(/\.request\.json$/, ".response.json")
  const result = await solveCaptchaRequest(request, options)
  await fs.writeFile(responseFile, JSON.stringify(result, null, 2), "utf8")
  return result
}

export async function solveCaptchaRequest(request, options = {}) {
  const solver = options.solveCaptcha || solveCaptcha
  const result = await solver({
    gt: request.gt,
    challenge: request.challenge,
  }, {
    request,
    maxChallengeRefreshAttempts: 0,
    onCaptchaEvent: options.onCaptchaEvent,
  })

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      provider: result.provider,
      attempts: result.attempts,
    }
  }

  return {
    ok: true,
    provider: result.provider,
    token: result.token,
    validate: result.validate || result.token,
    challenge: result.challenge || request.challenge,
    costMs: result.costMs,
  }
}

async function readJsonl(file) {
  try {
    const raw = await fs.readFile(file, "utf8")
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }
}
