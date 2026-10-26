const BasePlugin = globalThis.plugin
import { accountDisplay } from "../services/checkin/account.js"

import { resolvePriority } from "../core/intercept/priority.js"
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
import { StarRailChallengeService } from "../services/starRailChallenge/service.js"

// 与 core/intercept/personal-query.js 共用同一份词表，避免两处漂移。
const SR_WORDS = "(?:深渊|忘却|忘却之庭|混沌|混沌回忆|虚构|虚构叙事|末日|末日幻影|异乡|异相|异向|仲裁|异相仲裁)"

// 星铁挑战卡只守荷花自己的 `*` 命名空间。`#星铁` 前缀整体让给 genshin（它覆盖全部 11 个
// 挑战模式，含模拟宇宙 / 差分宇宙等荷花未复刻的玩法），避免两边同名规则双触发出双图。
// 谁有谁响应：*` = 荷花自制 4 类；#星铁* = genshin 全量。
export class LotusStarRailChallenge extends BasePlugin {
  constructor(options = {}) {
    super({
      name: "[Lotus-Plugin] StarRail Challenge",
      dsc: "Profile aware StarRail challenge records (hall/story/boss/peak)",
      event: "message",
      priority: resolvePriority("starrail_challenge"),
      rule: [
        { reg: `^\\*(?:往期|上期|本期|最新|当期)?${SR_WORDS}[\\s\\S]*$`, fnc: "challenge" },
      ],
    })
    this.service = options.service || new StarRailChallengeService(options)
  }

  async challenge() {
    const parsed = splitStarRailChallengeProfile(this.e.msg)
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
      const image = await renderTemplate("starrail-challenge", result.renderData, {
        saveId: `lotus-sr-challenge-${userId}-${profileId}-${Date.now()}`,
      })
      await replyImage(this, image, `[荷花插件]${result.renderData.title}查询完成。`)
    } catch (error) {
      if (isMissingProfileError(error)) {
        await replyText(this, `[荷花插件]${profileLoginRequiredMessage(profileId)}`)
        return true
      }
      logger?.error?.(`[Lotus-Plugin] starrail challenge failed: ${error.stack || error.message}`)
      const image = await renderStatusCard({
        title: "星铁挑战战绩",
        subtitle: `${accountDisplay(String(userId))} · Profile ${profileId}`,
        badge: "失败",
        message: error.message,
        userId,
        items: [
          { label: "命令", value: command },
          { label: "提示", value: "支持 混沌回忆 / 虚构叙事 / 末日幻影 / 异相仲裁，加「上期/往期」查往期记录。" },
        ],
      }, {
        saveId: `lotus-sr-challenge-error-${userId}-${profileId}`,
      })
      await replyImage(this, image, `[荷花插件]星铁挑战战绩查询失败：${error.message}`)
    }
    return true
  }
}

export function splitStarRailChallengeProfile(message = "") {
  const suffix = splitProfileSuffix(message)
  if (suffix.hasProfileSuffix) return suffix

  const text = String(message || "").trim()
  const match = text.match(/^((?:\*|#[\u4e00-\u9fa5]+)?(?:往期|上期|本期|最新|当期)?(?:深渊|忘却|忘却之庭|混沌|混沌回忆|虚构|虚构叙事|末日|末日幻影|异乡|异相|异向|仲裁|异相仲裁))([1-9]\d{0,2})(?=\D)([\s\S]*)$/)
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
    logger?.debug?.(`[Lotus-Plugin] starrail challenge pre-refresh skipped: ${error.message}`)
    return profile
  }
}
