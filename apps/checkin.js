const BasePlugin = globalThis.plugin
import { accountDisplay } from "../services/checkin/account.js"

import { LOTUS_INTERCEPT_PRIORITY } from "../core/intercept/priority.js"
import { replyCaptchaEvent } from "../core/captcha/notify.js"
import {
  loadProfile,
  parseProfileIdFromMessage,
  PROFILE_ID_SUFFIX_PATTERN,
} from "../core/config/profile.js"
import { renderStatusCard } from "../core/render/service.js"
import { replyImage, replyText } from "../core/transport/reply.js"
import { loadGlobalConfig } from "../core/config/global.js"
import { PythonEnvService } from "../services/python/env.js"
import { ProfileSigninService } from "../services/checkin/profileSignin.js"
import { TestNineEnvService } from "../services/testNine/env.js"
import { ToolInstallerService } from "../services/tools/installer.js"

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
    const profileId = parseProfileIdFromMessage(this.e.msg)
    let profile
    try {
      profile = await loadProfile(userId, profileId)
    } catch (error) {
      if (error?.code === "ENOENT") {
        await replyText(this, `profile ${profileId} 尚未配置，请先使用 #扫码登录${profileId === 1 ? "" : profileId}。`, { at: true })
        return true
      }
      throw error
    }

    if (!profile.account?.cookie) {
      await replyText(this, `profile ${profileId} 尚未保存 cookie，请先扫码登录。`, { at: true })
      return true
    }

    try {
      const outcome = await new ProfileSigninService().run({
        qq: userId,
        profileId,
        profile,
        installRequirements: false,
        onCaptchaEvent: async event => {
          await replyCaptchaEvent(this, event)
        },
      })
      await replyImage(this, outcome.image, outcome.ok
        ? `签到完成。`
        : `签到失败：${outcome.message}`, { at: true })
    } catch (error) {
      logger?.error?.(`[Lotus-Plugin] checkin failed: ${error.stack || error.message}`)
      const image = await renderStatusCard({
        title: "签到失败",
        subtitle: `${accountDisplay(String(userId))} · Profile ${profileId}`,
        badge: "失败",
        message: error.message,
        userId,
        items: [
          { label: "阶段", value: "MihoyoBBSTools runner" },
          { label: "建议", value: "先执行 #初始化签到环境，确认 profile 登录态和设备信息。" },
        ],
      }, {
        saveId: `lotus-checkin-error-${userId}-${profileId}`,
      })
      await replyImage(this, image, `签到失败：${error.message}`, { at: true })
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
