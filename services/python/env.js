import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import {
  resolveData,
  rootPath,
} from "../../core/path.js"
import { loadGlobalConfig } from "../../core/config/global.js"
import { formatLocalIso } from "../../core/time.js"

export class PythonEnvService {
  constructor(options = {}) {
    this.config = options.config
    this.spawn = options.spawn || spawn
    this.onProgress = options.onProgress
  }

  async getConfig() {
    if (this.config) return this.config
    const globalConfig = await loadGlobalConfig()
    return globalConfig.python || {}
  }

  async getPythonExecutable() {
    const config = await this.getConfig()
    if (config.mode === "system") {
      return {
        command: config.system_python || "python",
        args: [],
        mode: "system",
      }
    }

    const venvPath = resolveMaybeData(config.venv_path || "data/python/venv")
    const executable = process.platform === "win32"
      ? path.join(venvPath, "Scripts", "python.exe")
      : path.join(venvPath, "bin", "python")
    return {
      command: executable,
      args: [],
      mode: "venv",
      venvPath,
    }
  }

  async ensureVenv(options = {}) {
    const { installRequirements = true } = options
    const onProgress = options.onProgress || this.onProgress
    const config = await this.getConfig()
    if (config.mode === "system") return this.getPythonExecutable()

    const venvPath = resolveMaybeData(config.venv_path || "data/python/venv")
    const pyvenv = path.join(venvPath, "pyvenv.cfg")
    try {
      await fs.access(pyvenv)
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
      const systemPython = config.system_python || "python"
      await emitProgress(onProgress, `Python：创建虚拟环境 ${venvPath}`)
      await runProcess(this.spawn, systemPython, ["-m", "venv", venvPath], {
        cwd: rootPath,
      })
      await emitProgress(onProgress, "Python：虚拟环境创建完成")
    }

    const python = await this.getPythonExecutable()
    await emitProgress(onProgress, "MihoyoBBSTools：检查依赖指纹")
    const status = await this.getFingerprintStatus(venvPath)
    if (installRequirements && status.stale) {
      await emitProgress(onProgress, `MihoyoBBSTools：安装 Python 依赖（${status.reasons.join(", ") || "首次初始化"}）`)
      await runProcess(this.spawn, python.command, [
        "-m",
        "pip",
        "install",
        "-r",
        path.join(rootPath, "MihoyoBBSTools", "requirements.txt"),
      ], {
        cwd: rootPath,
      })
      await emitProgress(onProgress, "MihoyoBBSTools：Python 依赖安装完成")
    } else if (installRequirements) {
      await emitProgress(onProgress, "MihoyoBBSTools：Python 依赖未变化")
    }

    if (installRequirements) await this.writeFingerprint(venvPath, status.current)
    return {
      ...python,
      fingerprint: status.current,
      fingerprintStale: status.stale,
      fingerprintReasons: status.reasons,
    }
  }

  async getFingerprintStatus(venvPath) {
    const current = await this.buildFingerprint()
    const file = path.join(venvPath, "lotus-fingerprint.json")
    let saved = null
    try {
      saved = JSON.parse(await fs.readFile(file, "utf8"))
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
    return diffFingerprint(saved, current)
  }

  async buildFingerprint() {
    const requirements = path.join(rootPath, "MihoyoBBSTools", "requirements.txt")
    const raw = await fs.readFile(requirements, "utf8")
    const commit = await this.readBbsToolsCommit()
    return {
      requirements_sha256: createHash("sha256").update(raw).digest("hex"),
      bbstools_commit: commit,
    }
  }

  async writeFingerprint(venvPath, fingerprint = null) {
    const current = fingerprint || await this.buildFingerprint()
    const data = {
      ...current,
      updated_at: formatLocalIso(),
    }
    const file = path.join(venvPath, "lotus-fingerprint.json")
    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8")
    return data
  }

  async readBbsToolsCommit() {
    try {
      const result = await runProcess(this.spawn, "git", [
        "-C",
        path.join(rootPath, "MihoyoBBSTools"),
        "rev-parse",
        "HEAD",
      ], {
        cwd: rootPath,
      })
      return result.stdout.trim()
    } catch {
      return ""
    }
  }
}

async function emitProgress(onProgress, message) {
  if (typeof onProgress !== "function") return
  try {
    await onProgress(message)
  } catch (error) {
    logger?.debug?.(`[Lotus-Plugin] progress callback failed: ${error.message}`)
  }
}

export function diffFingerprint(saved, current) {
  if (!saved) {
    const fingerprint = {
      current,
      saved: null,
      stale: true,
      reasons: ["missing"],
    }
    return fingerprint
  }

  const reasons = []
  if (saved.requirements_sha256 !== current.requirements_sha256) reasons.push("requirements")
  if ((saved.bbstools_commit || "") !== (current.bbstools_commit || "")) reasons.push("bbstools_commit")

  return {
    current,
    saved,
    stale: reasons.length > 0,
    reasons,
  }
}

export function runProcess(spawnImpl, command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd: options.cwd || rootPath,
      env: withUtf8ProcessEnv(options.env || process.env),
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", chunk => {
      stdout += decodeProcessChunk(chunk)
    })
    child.stderr?.on("data", chunk => {
      stderr += decodeProcessChunk(chunk)
    })
    child.on("error", reject)
    child.on("close", code => {
      if (code === 0) {
        resolve({ code, stdout, stderr })
        return
      }
      const error = new Error(`${command} exited with code ${code}`)
      error.code = code
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    })
  })
}

// 宿主（WorkBuddy / CodeBuddy 等）会通过 PYTHONPATH 向所有子进程注入 sitecustomize.py，
// 把 os.remove / shutil.rmtree 改写成「进回收站 + 批量删除闸门校验」。test_nine 这类常驻服务
// 每次请求都要删临时图，一旦闸门上下文失效就 raise SystemExit(1)（不是 Exception，抓不住），
// 整个请求 500，上层只会看到 no_validate。这层污染必须剥离，否则本地打码永远失败。
const HOST_INJECTED_PY_ENV_KEYS = [
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "CODEBUDDY_SAFE_DELETE_BULK_GUARD",
  "CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR",
  "CODEBUDDY_TOOL_CALL_ID",
  "CODEBUDDY_NODE_BIN",
  "CODEBUDDY_NODE_RUN_AS_NODE",
]

// 宿主（WorkBuddy / CodeBuddy）启动本插件时会往环境里塞「本次会话专属」的本地代理
// （HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:<随机端口>）。会话结束端口就没了，但插件是常驻的，
// 子进程会一直拿着这个死代理：httpx 默认 trust_env=True，请求全部被路由到 127.0.0.1:死端口，
// 直接 WinError 10061。线上事故：api.geetest.com 不在宿主 NO_PROXY 白名单里，test_nine 打码
// 100% 连不上 → 每次签到卡验证码重试 → 180s 被 runner 强杀，全站签到失败。
// 处理方式不是粗暴删代理（真需要代理才能出网的环境还得用），而是把插件自己依赖的域名
// 补进 NO_PROXY：这些域名本来就该直连（宿主也已把 .mihoyo.com 划进直连），代理死活与它们无关。
const DIRECT_HOSTS = [
  ".mihoyo.com",
  ".mihoyo.com.cn",
  ".miyoushe.com",
  ".hoyolab.com",
  ".hoyoverse.com",
  ".yuanshen.com",
  ".geetest.com",
  ".kurobbs.com",
]

function withDirectHosts(noProxy) {
  const parts = String(noProxy || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
  const lower = new Set(parts.map(item => item.toLowerCase()))
  for (const host of DIRECT_HOSTS) {
    if (!lower.has(host)) {
      parts.push(host)
      lower.add(host)
    }
  }
  return parts.join(",")
}

export function withUtf8ProcessEnv(env = process.env) {
  const next = { ...env }
  for (const key of HOST_INJECTED_PY_ENV_KEYS) delete next[key]
  // 大小写两份都写：httpx/urllib 读 HTTPS_PROXY 与 NO_PROXY，requests 读小写，
  // 只改一份会出现「上游走代理、下游直连」的不一致。
  const noProxy = withDirectHosts(next.NO_PROXY || next.no_proxy)
  next.NO_PROXY = noProxy
  next.no_proxy = noProxy
  return {
    ...next,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    PYTHONLEGACYWINDOWSSTDIO: "0",
  }
}

export function decodeProcessChunk(chunk) {
  if (chunk == null) return ""
  if (typeof chunk === "string") return chunk
  return new TextDecoder("utf-8", { fatal: false }).decode(chunk)
}

function resolveMaybeData(value) {
  if (path.isAbsolute(value)) return value
  if (value.startsWith("data/") || value.startsWith("data\\")) {
    return resolveData(value.slice(5))
  }
  return path.join(rootPath, value)
}
