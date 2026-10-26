const BasePlugin = globalThis.plugin
import { accountDisplay } from "../services/checkin/account.js"

import { LOTUS_INTERCEPT_PRIORITY } from "../core/intercept/priority.js"
import {
  loadProfile,
  listProfileIds,
  PROFILE_ID_SUFFIX_PATTERN,
} from "../core/config/profile.js"
import { renderStatusCard } from "../core/render/service.js"
import { replyImage, replyText } from "../core/transport/reply.js"
import { loadGlobalConfig } from "../core/config/global.js"
import { PythonEnvService } from "../services/python/env.js"
import { ProfileSigninService, renderSigninMulti } from "../services/checkin/profileSignin.js"
import { TestNineEnvService } from "../services/testNine/env.js"
import { ToolInstallerService } from "../services/tools/installer.js"

// 单个 profile 签到的上层兜底。子进程层已有 180s 超时，这里再包一层是为了
// 覆盖 runner 之前的环节（loadProfile / account.refresh / 出图），
// 任一环不结算都会让「签到中请稍后」之后再无下文，try/catch 也抓不到。
const SIGNIN_DEADLINE_MS = 200000

function withDeadline(promise, ms, label) {
  return new Promise((resolve, reject) => {
    // 不要 unref：进程空闲时无其它 handle，unref 会让定时器不触发。
    const timer = setTimeout(() => {
      reject(new Error(`${label} 超时（${ms}ms 未返回）`))
    }, ms)
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

export class LotusCheckin extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Checkin",
      dsc: "Lotus profile checkin runner",
      event: "message",
      priority: LOTUS_INTERCEPT_PRIORITY,
      rule: [
        {
          reg: "^#初始化签到环境$",
          fnc: "initSigninEnv",
        },
        {
          reg: `^#((测试|开始|手动)签到|补签)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "runSignin",
        },
        {
          // 兼容 ji-plugin 旧指令：游戏签到（星铁/原神/游戏/崩三…），均映射到统一签到（可省略 #）
          reg: `^#?(星铁|原神|游戏|崩三|崩崩崩|崩坏3|崩坏|绝区零)?签到${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "runSignin",
        },
        {
          // 兼容 ji-plugin 旧指令：米游社社区签到（#米游社原神签到 / #mys签到 等，可省略 #）
          reg: `^#?(米游社|mys)(原神|崩坏3|崩坏2|未定事件簿|大别野|崩坏星穹铁道|星穹铁道|绝区零|全部)?签到${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "runSignin",
        },
        {
          // 兼容 ji-plugin 旧指令：全部签到/签到任务（游戏+社区批量，映射到统一签到）
          reg: `^#(重新)?(全部签到|签到任务)$`,
          fnc: "runSignin",
        },
        {
          reg: `^#社区(重新)?(全部签到|签到任务)$`,
          fnc: "runSignin",
        },
      ],
    })
  }

  async initSigninEnv() {
    await replyText(this, "[荷花插件]正在初始化 Python、MihoyoBBSTools、test_nine 和下载工具链，首次执行可能需要一会儿。")
    const progress = createInitProgressReporter(this)
    try {
      const globalConfig = await loadGlobalConfig()
      const results = []
      results.push(await runInitStep("MihoyoBBSTools", async () => {
        const python = await new PythonEnvService({
          config: globalConfig.python,
          onProgress: progress,
        }).ensureVenv({ installRequirements: true })
        return {
          ok: true,
          value: `${python.mode} · ${python.command}`,
        }
      }, progress))
      results.push(await runInitStep("test_nine", async () => {
        const env = await new TestNineEnvService({
          config: globalConfig.captcha?.test_nine,
          pythonConfig: globalConfig.python,
          onProgress: progress,
        }).ensureEnv()
        return {
          ok: env.ok,
          value: env.ok
            ? `${env.python.command} · 模型 ${env.models?.items?.filter(item => item.ok).length || 0}/${env.models?.items?.length || 0}`
            : env.reason,
        }
      }, progress))
      results.push(await runInitStep("BBDown/ffmpeg/aria2", async () => {
        const tools = await new ToolInstallerService({
          config: globalConfig.tools,
          onProgress: progress,
        }).ensureAll()
        return {
          ok: tools.ok,
          value: (tools.items || []).map(item => `${item.name}:${item.ok ? item.status || item.reason || "ok" : "fail"}`).join(" / "),
        }
      }, progress))

      const ok = results.every(item => item.ok)
      const image = await renderStatusCard({
        title: "签到环境",
        subtitle: "Python / MihoyoBBSTools / test_nine / tools",
        badge: ok ? "完成" : "部分失败",
        message: ok
          ? "虚拟环境和工具链已经可用，后续签到会使用荷花插件管理的运行环境。"
          : "部分初始化步骤失败，请根据失败项处理后重试。",
        userId: this.e.user_id,
        items: results.map(item => ({
          label: item.name,
          value: item.ok ? item.value : `失败：${item.reason}`,
        })),
      }, {
        saveId: `lotus-python-env-${this.e.user_id || "system"}`,
      })
      await replyImage(this, image, ok ? "[荷花插件]签到环境初始化完成。" : "[荷花插件]签到环境部分初始化失败。")
    } catch (error) {
      logger?.error?.(`[Lotus-Plugin] init signin env failed: ${error.stack || error.message}`)
      await replyText(this, `[荷花插件]签到环境初始化失败：${error.message}`)
    }
    return true
  }

  async runSignin() {
    const userId = String(this.e.user_id)
    // 带编号（#签到2）→ 只跑该 profile；不带编号（#签到 / #全部签到）→ 该用户全部 profile
    // 汇总到一张卡片返回（jj 对齐：多账号不拆卡）。
    const explicitMatch = String(this.e.msg || "").trim().match(/(\d+)$/)
    const targetIds = explicitMatch
      ? [Number(explicitMatch[1])]
      : await listProfileIds(userId).catch(() => [])

    if (!targetIds.length) {
      await replyText(this, "尚未配置账号，请先使用 #扫码登录。", { at: true })
      return true
    }

    // 逐个加载 profile；未配置 / 未登录的直接记为失败小节，不中断其它账号
    const entries = []
    for (const pid of targetIds) {
      let profile = null
      try {
        profile = await loadProfile(userId, pid)
      } catch (error) {
        entries.push({
          profileId: pid,
          error: error?.code === "ENOENT" ? "尚未配置，请先使用 #扫码登录。" : `读取失败：${error.message}`,
        })
        continue
      }
      if (!profile.account?.cookie) {
        entries.push({ profileId: pid, error: "尚未登录，请先使用 #扫码登录。" })
        continue
      }
      entries.push({ profileId: pid, profile })
    }

    if (!entries.some(entry => entry.profile)) {
      await replyText(this, entries[0].error || "没有可签到的账号。", { at: true })
      return true
    }

    // jj 短格式：单条 @ 等待提示，随后静默执行，仅出结果图
    await replyText(this, "签到中请稍后", { at: true })

    // 多账号时跳过每个 profile 的单卡渲染（省一次无用的渲染，最终只出合并卡）
    const multi = entries.filter(entry => entry.profile).length > 1

    try {
      let lastOk = false
      let lastMessage = ""
      for (const entry of entries) {
        if (!entry.profile) continue
        const outcome = await withDeadline(
          new ProfileSigninService({ render: !multi }).run({
            qq: userId,
            profileId: entry.profileId,
            profile: entry.profile,
            installRequirements: false,
            onCaptchaEvent: async event => {
              // 过码过程不再发到群里（用户反馈刷屏）：底层照常打码，事件只进日志。
              // 最终成败由合并结果卡 / 失败文案兜底，信息不会丢。
              if (event?.type) logger?.mark?.(`[Lotus-Plugin] checkin captcha event: ${event.type}`)
            },
          }),
          SIGNIN_DEADLINE_MS,
          `Profile ${entry.profileId || 1} 签到`,
        )
        entry.outcome = outcome
        lastOk = Boolean(outcome.ok)
        lastMessage = outcome.message || ""
      }

      const runnable = entries.filter(entry => entry.profile)
      const image = multi
        ? await renderSigninMulti({ userId, entries })
        : runnable[0].outcome.image
      // 开头的「签到中请稍后」已经 @ 过一次，结果卡不再重复 @（对齐体力：一次就够）
      await replyImage(this, image, lastOk
        ? `签到完成。`
        : `签到失败：${lastMessage}`)
    } catch (error) {
      logger?.error?.(`[Lotus-Plugin] checkin failed: ${error.stack || error.message}`)
      // 出失败卡本身也可能卡（渲染栈偶发挂起），卡住也必须回落纯文字，
      // 否则「签到中请稍后」之后仍然没有下文，等于白等。
      try {
        const image = await withDeadline(renderStatusCard({
          title: "签到失败",
          subtitle: `${accountDisplay(String(userId))}${explicitMatch ? ` · Profile ${explicitMatch[1]}` : ""}`,
          badge: "失败",
          message: error.message,
          userId,
          items: [
            { label: "阶段", value: error?.timeout ? "MihoyoBBSTools 执行超时" : "MihoyoBBSTools runner" },
            { label: "建议", value: "先执行 #初始化签到环境，确认 profile 登录态和设备信息。" },
          ],
        }, {
          saveId: `lotus-checkin-error-${userId}-${explicitMatch ? explicitMatch[1] : "multi"}`,
        }), 20000, "签到失败卡渲染")
        await replyImage(this, image, `签到失败：${error.message}`, { at: true })
      } catch (renderError) {
        logger?.error?.(`[Lotus-Plugin] checkin failure card failed: ${renderError?.message}`)
        await replyText(this, `签到失败：${error.message}`, { at: true })
      }
    }

    return true
  }
}

async function runInitStep(name, fn, onProgress = null) {
  await emitInitProgress(onProgress, `${name}：开始`)
  try {
    const result = await fn()
    await emitInitProgress(onProgress, result.ok === false
      ? `${name}：失败：${result.reason || result.value || "unknown"}`
      : `${name}：完成`)
    return {
      name,
      ok: result.ok !== false,
      value: result.value || "完成",
      reason: result.reason || "",
    }
  } catch (error) {
    await emitInitProgress(onProgress, `${name}：失败：${error.message}`)
    return {
      name,
      ok: false,
      value: "",
      reason: error.message,
    }
  }
}

function createInitProgressReporter(plugin) {
  return async message => {
    logger?.mark?.(`[Lotus-Plugin] init signin env: ${message}`)
    await replyText(plugin, `[荷花插件]${message}`)
  }
}

async function emitInitProgress(onProgress, message) {
  if (typeof onProgress !== "function") return
  await onProgress(message)
}
