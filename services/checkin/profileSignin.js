import { loadProfile } from "../../core/config/profile.js"
import { loadGlobalConfig } from "../../core/config/global.js"
import { AccountService } from "../../core/login/account.js"
import { renderTemplate } from "../../core/render/service.js"
import { MihoyoBbsToolsRunner } from "../mihoyoBbsTools/runner.js"
import { appendCheckinAudit } from "./audit.js"
import { getRandomCharacter } from "../../core/characterArt.js"
import { accountAvatar, accountDisplay } from "./account.js"

// 直接读用户展示名：优先 profile.user.nickname；缺失时回退到主游戏角色昵称（数据里几乎都带真实名），
// 最后回退到平台标签。避免在昵称为空时退化成裸 id / “账号 <id>”。
export function resolveDisplayName(profile) {
  const u = profile?.user || {}
  if (u.nickname) return u.nickname
  const roles = profile?.account?.game_roles || {}
  for (const key of ["gs", "sr", "zzz"]) {
    const list = roles[key]
    if (Array.isArray(list)) {
      const chosen = list.find(r => r.is_chosen) || list[0]
      if (chosen?.nickname) return chosen.nickname
    }
  }
  // 最后兜底：微信经适配器 fl/gml 解析真实昵称，仍取不到才退化成裸 id
  return accountDisplay(u.qq, u.platform)
}

export class ProfileSigninService {
  constructor(options = {}) {
    this.account = options.account || new AccountService(options)
    this.runner = options.runner || new MihoyoBbsToolsRunner(options)
    this.render = options.render !== false
  }

  async run({ qq, profileId = 1, profile, refresh = true, onCaptchaEvent, installRequirements = false } = {}) {
    const userId = String(qq || profile?.user?.qq || "")
    const id = Number(profileId || profile?.profile?.id || 1)
    let activeProfile = profile || await loadProfile(userId, id)
    const forcedDisables = (await loadGlobalConfig()).scheduler?.forced_disables || {}

    if (refresh) {
      try {
        activeProfile = await this.account.refresh(userId, id)
      } catch (error) {
        return this.failure({
          stage: "refresh",
          profile: activeProfile,
          error,
          message: "签到前刷新登录信息失败，本次签到已停止。",
          advice: "请重新扫码登录对应 profile，或检查 stoken 是否已失效。",
          forcedDisables,
        })
      }
    }

    if (!activeProfile.account?.cookie) {
      return this.failure({
        stage: "precheck",
        profile: activeProfile,
        error: new Error("profile has no cookie"),
        message: "profile 尚未保存 cookie，无法执行签到。",
        advice: "请先使用 #扫码登录 绑定当前 profile。",
        forcedDisables,
      })
    }

    const skipped = collectSkipped(activeProfile, forcedDisables)
    try {
      const result = await this.runner.runProfile(prepareRunnableProfile(activeProfile), {
        installRequirements,
        onCaptchaEvent,
      })
      const image = this.render
        ? await renderSigninResult({ result, profile: activeProfile, skipped })
        : null
      const outcome = {
        ok: Boolean(result.ok),
        stage: "checkin",
        profile: activeProfile,
        result,
        skipped,
        image,
        // 结构化各游戏 + 社区签到状态，供 scheduled 存入 entry.result.games，
        // 使主人汇总看板明天起能展示原神/星铁/绝区零/社区的具体天数（修复此前 games 恒空）。
        games: buildSigninRows(activeProfile, result, skipped, forcedDisables),
        message: result.message || (result.ok ? "签到完成。" : "签到失败。"),
      }
      await this.audit(outcome)
      return outcome
    } catch (error) {
      return this.failure({
        stage: "runner",
        profile: activeProfile,
        error,
        message: "MihoyoBBSTools runner 执行失败。",
        advice: "先执行 #初始化签到环境，确认 profile 登录态、设备信息和 Python 依赖。",
        forcedDisables,
      })
    }
  }

  async failure({ stage, profile, error, message, advice }) {
    const image = this.render
      ? await renderSigninFailure({
        stage,
        profile,
        error,
        message,
        advice,
      })
      : null
    const outcome = {
      ok: false,
      stage,
      profile,
      error,
      image,
      message: error.message || message,
    }
    await this.audit(outcome)
    return outcome
  }

  async audit(outcome) {
    try {
      await appendCheckinAudit(outcome)
    } catch (error) {
      logger?.warn?.(`[Lotus-Plugin] checkin audit failed: ${error.message}`)
    }
  }
}

export async function renderSigninResult({ result, profile, skipped, forcedDisables = {} }) {
  const message = String(result.message || "无详细结果").slice(0, 180)
  // 先抽立绘，再同时用作背景与（微信无头像时的）头像回退
  const illustration = getRandomCharacter()

  return renderTemplate("checkin-result", {
    title: resolveDisplayName(profile),
    subtitle: `profile ${profile.profile?.id || 1}`,
    nickname: resolveDisplayName(profile),
    account: `profile ${profile.profile?.id || 1}`,
    description: message,
    badge: result.ok ? "成功" : "失败",
    message,
    illustration,
    // 微信等拿不到真实头像时，复用同一张立绘作为头像，与背景保持协调
    avatar: accountAvatar(profile.user?.qq, profile.user?.platform, illustration),
    userId: profile.user?.qq,
    games: buildSigninRows(profile, result,  skipped, forcedDisables),
  }, {
    saveId: `lotus-checkin-${profile.user?.qq || "user"}-${profile.profile?.id || 1}`,
  })
}

export async function renderSigninFailure({ stage, profile, error, message, advice, forcedDisables }) {
  const userId = profile?.user?.qq || ""
  const profileId = profile?.profile?.id || 1
  const failureMessage = `${message} ${error?.message || ""} ${advice || ""}`.trim()
  // 先抽立绘，再同时用作背景与（微信无头像时的）头像回退
  const illustration = getRandomCharacter()
  return renderTemplate("checkin-result", {
    title: resolveDisplayName(profile),
    subtitle: `profile ${profileId}`,
    nickname: resolveDisplayName(profile),
    account: `profile ${profileId}`,
    description: failureMessage,
    badge: "失败",
    message: failureMessage,
    illustration,
    // 微信等拿不到真实头像时，复用同一张立绘作为头像，与背景保持协调
    avatar: accountAvatar(userId, profile?.user?.platform, illustration),
    userId,
    games: buildSigninRows(profile || {}, { ok: false }, collectSkipped(profile || {}, forcedDisables), forcedDisables),
  }, {
    saveId: `lotus-checkin-error-${userId || "user"}-${profileId}`,
  })
}

export function prepareRunnableProfile(profile) {
  // 社区签到（米游社）不再强制绑定设备：dacapo 的 mihoyobbs 模块在 device.id/fp 为空时
  // 仍用默认设备名/型号发送 x-rpc-device_id（空串米游社可接受），社区签到可正常完成。
  // 这与 ji-plugin 行为对齐——社区签到只靠 cookie（stoken），无需用户绑定设备。
  // 仅受 profile.mihoyobbs.enable 与全局 forced_disables.mihoyobbs 控制。
  return structuredClone(profile)
}

export function collectSkipped(profile, forcedDisables = null) {
  const skipped = []
  const fd = forcedDisables || {}
  if (fd.genshin === true) skipped.push("原神签到已被管理员全局关闭。")
  if (fd.honkai_sr === true) skipped.push("星铁签到已被管理员全局关闭。")
  if (fd.zzz === true) skipped.push("绝区零签到已被管理员全局关闭。")
  if (fd.mihoyobbs === true) skipped.push("社区签到已被管理员全局关闭。")
  return skipped
}

const SIGNIN_GAMES = [
  { key: "genshin", label: "原神", forumId: 2 },
  { key: "honkai2", label: "崩坏2", forumId: 3 },
  { key: "honkai3rd", label: "崩坏3", forumId: 1 },
  { key: "tears_of_themis", label: "未定事件簿", forumId: 4 },
  { key: "villa", label: "大别野", forumId: 5, communityOnly: true },
  { key: "honkai_sr", label: "星铁", forumId: 6 },
  { key: "zzz", label: "绝区零", forumId: 8 },
  { key: "hna", label: "因缘精灵", forumId: 9 },
  { key: "starry", label: "星布谷地", forumId: 10, communityOnly: true },
]

function buildSigninRows(profile, result, skipped = [], forcedDisables = {}) {
  const games = profile.games?.cn || {}
  const bbs = profile.mihoyobbs || {}
  const fd = forcedDisables || {}
  const communityEnabled = fd.mihoyobbs !== true && Boolean(bbs.enable && (bbs.tasks?.checkin ?? bbs.checkin ?? true))
  const daysMap = extractGameSigninDays(result?.message)
  const rows = SIGNIN_GAMES.map(game => {
    const gameKey = game.key === "honkai_sr" ? "honkai_sr" : game.key
    const gameForcedOff = fd[gameKey] === true
    const gameEnabled = !game.communityOnly && games.enable !== false && games[game.key]?.checkin === true && !gameForcedOff
    const forumEnabled = communityEnabled && bbs.checkin_list?.map?.(Number).includes(game.forumId)
    const rawDays = daysMap[game.key]
    const days = rawDays !== undefined && rawDays !== null ? `${rawDays}天` : "-"
    return {
      label: game.label,
      game: game.communityOnly ? "无" : gameEnabled ? (result.ok ? "成功" : "失败") : "关闭",
      community: forumEnabled ? (result.ok ? "成功" : "失败") : "关闭",
      days,
    }
  })
  // 社区（米游社）汇总行：供主人看板「社区」列展示；communityEnabled 已考虑全局 forced_disables.mihoyobbs。
  rows.push({
    label: "社区",
    game: "无",
    community: communityEnabled ? (result.ok ? "成功" : "失败") : "关闭",
    days: "-",
  })
  return rows
}

const GAME_SIGNIN_NAME_ALIASES = [
  { key: "genshin", names: ["原神"] },
  { key: "honkai2", names: ["崩坏学园2", "崩坏2"] },
  { key: "honkai3rd", names: ["崩坏3rd", "崩坏3"] },
  { key: "tears_of_themis", names: ["未定事件簿"] },
  { key: "honkai_sr", names: ["崩坏：星穹铁道", "星穹铁道", "星铁"] },
  { key: "zzz", names: ["绝区零"] },
]

export function extractGameSigninDays(message) {
  const map = {}
  if (!message) return map
  const text = String(message)
  for (const { key, names } of GAME_SIGNIN_NAME_ALIASES) {
    for (const name of names) {
      const idx = text.indexOf(name)
      if (idx === -1) continue
      // 从游戏名出现位置向后搜索约 120 个字符内的“已连续签到 N 天”
      const slice = text.slice(idx, idx + 160)
      const match = slice.match(/已连续签到\s*(\d+)\s*天/)
      if (match) {
        map[key] = Number(match[1])
        break
      }
    }
  }
  return map
}
