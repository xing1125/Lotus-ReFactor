const BasePlugin = globalThis.plugin
import { accountDisplay } from "../services/checkin/account.js"

import { LOTUS_INTERCEPT_PRIORITY } from "../core/intercept/priority.js"
import {
  isMissingProfileError,
  loadProfile,
  normalizeProfileId,
  profileLoginRequiredMessage,
} from "../core/config/profile.js"
import { AccountService } from "../core/login/account.js"
import { renderStatusCard, renderTemplate } from "../core/render/service.js"
import { replyImage, replyText } from "../core/transport/reply.js"
import { splitProfileSuffix } from "../services/pluginBridge/common.js"
import { GenshinAbyssService } from "../services/genshinAbyss/service.js"

export class LotusGenshinAbyss extends BasePlugin {
  constructor(options = {}) {
    super({
      name: "[Lotus-Plugin] Genshin Abyss",
      dsc: "Profile aware Genshin Spiral Abyss record",
      event: "message",
      priority: LOTUS_INTERCEPT_PRIORITY,
      rule: [
        { reg: "^#(?:上期|往期)?(?:深渊|深境螺旋)[\\s\\S]*$", fnc: "abyss" },
      ],
    })
    this.service = options.service || new GenshinAbyssService(options)
  }

  async abyss() {
    const parsed = splitGenshinAbyssProfile(this.e.msg)
    const profileId = parsed.hasProfileSuffix ? parsed.profileId : 1
    const command = parsed.message
    const userId = String(this.e.user_id)
    try {
      const loadedProfile = await loadProfile(userId, profileId)
      const profile = await refreshProfileBeforeQuery(userId, profileId, loadedProfile)
      const result = await this.service.queryProfile({
        profile,
        profileId,
        command,
      })
      const image = await renderTemplate("genshin-abyss", result.renderData, {
        saveId: `lotus-gs-abyss-${userId}-${profileId}-${Date.now()}`,
      })
      await replyImage(this, image, "[荷花插件]深境螺旋战绩查询完成。")
    } catch (error) {
      if (isMissingProfileError(error)) {
        await replyText(this, `[荷花插件]${profileLoginRequiredMessage(profileId)}`)
        return true
      }
      logger?.error?.(`[Lotus-Plugin] genshin abyss failed: ${error.stack || error.message}`)
      const image = await renderStatusCard({
        title: "深境螺旋战绩",
        subtitle: `${accountDisplay(String(userId))} · Profile ${profileId}`,
        badge: "失败",
        message: error.message,
        userId,
        items: [
          { label: "命令", value: command },
          { label: "提示", value: "需先在荷花登录米游社账号并绑定原神 UID。" },
        ],
      }, {
        saveId: `lotus-gs-abyss-error-${userId}-${profileId}`,
      })
      await replyImage(this, image, `[荷花插件]深境螺旋战绩查询失败：${error.message}`)
    }
    return true
  }
}

export function splitGenshinAbyssProfile(message = "") {
  const suffix = splitProfileSuffix(message)
  if (suffix.hasProfileSuffix) return suffix

  const text = String(message || "").trim()
  const match = text.match(/^(#(?:上期|往期)?(?:深渊|深境螺旋))([1-9]\d{0,2})(?=\D)([\s\S]*)$/)
  if (!match) return suffix
  try {
    const profileId = normalizeProfileId(match[2])
    return {
      hasProfileSuffix: true,
      profileId,
      message: `${match[1]}${match[3]}`.trim(),
    }
  } catch {
    return suffix
  }
}

async function refreshProfileBeforeQuery(userId, profileId, profile) {
  if (!profile?.account?.stoken) return profile
  try {
    return await new AccountService().refresh(userId, profileId)
  } catch (error) {
    logger?.debug?.(`[Lotus-Plugin] genshin abyss pre-refresh skipped: ${error.message}`)
    return profile
  }
}
