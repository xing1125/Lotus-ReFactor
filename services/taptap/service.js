// TapTap game-sign 签到业务编排（仅 原神 / 崩铁 / 绝区零）
import {
  GAMES,
  loadConfig,
  saveUserConfig,
  loadStatus,
  saveStatus,
  loadAccounts,
  addAccount,
  removeAccount,
  enabledGames,
  matchGames,
} from "./config.js"
import { withPage, hasProfile } from "./browser.js"
import { resolveEvent } from "./eventResolver.js"
import { signEvent, isLoggedIn } from "./signer.js"
import { loadGlobalConfig } from "../../core/config/global.js"
import { notifyUser } from "../../core/transport/notify.js"

const SIGN_DELAY_MS = 1500

/** 打开可见浏览器等待登录，登录态通过该 user_id 的固定 userDataDir 自动保存 */
export async function runLogin(userId, timeoutMin = 5) {
  return withPage(false, async (page) => {
    await page.goto("https://www.taptap.cn/", { waitUntil: "networkidle2", timeout: 60000 })
    const deadline = Date.now() + timeoutMin * 60 * 1000
    while (Date.now() < deadline) {
      const logged = await page.evaluate(() => {
        const c = document.cookie || ""
        return /TAPSID|tapsid|taptap_sid|SESS|tt_token|token/.test(c)
      })
      if (logged) return { ok: true }
      await new Promise((r) => setTimeout(r, 3000))
    }
    return { ok: false, reason: "timeout" }
  }, userId)
}

/** 执行一组游戏的签到，更新并保存 status，返回 results 数组 */
export async function runCheckin(userId, games, cfg, status) {
  const results = []
  for (const g of games) {
    const override = cfg.event_override?.[g.key]
    let resolved
    try {
      resolved = await resolveEvent(g, { status, force: false, overrideId: override })
    } catch (e) {
      results.push({ game: g.name, ok: false, reason: "resolve_error", message: e.message })
      continue
    }
    const eventId = resolved.id
    if (!eventId) {
      results.push({ game: g.name, ok: false, reason: "no_event" })
      continue
    }
    status.games[g.key] = status.games[g.key] || {}
    status.games[g.key].event = { id: eventId, resolvedAt: Date.now(), source: resolved.source }
    let r
    try {
      r = await signEvent(userId, eventId)
    } catch (e) {
      r = { ok: false, reason: "sign_error", message: e.message }
    }
    status.games[g.key].last = { ...r, at: Date.now() }
    results.push({ game: g.name, ...r })
    await new Promise((res) => setTimeout(res, SIGN_DELAY_MS))
  }
  saveStatus(userId, status)
  return results
}

/** 自动发现各游戏当前活动（写入缓存，指定 user_id 的 status） */
export async function runDiscover(userId, cfg, status, force) {
  const out = []
  for (const g of GAMES) {
    const override = cfg.event_override?.[g.key]
    let resolved
    try {
      resolved = await resolveEvent(g, { status, force, overrideId: override })
    } catch (e) {
      out.push({ game: g.name, id: null, source: "error", candidates: [], error: e.message })
      continue
    }
    if (resolved.id) {
      status.games[g.key] = status.games[g.key] || {}
      status.games[g.key].event = { id: resolved.id, resolvedAt: Date.now(), source: resolved.source }
    }
    out.push({
      game: g.name,
      id: resolved.id,
      source: resolved.source,
      active: resolved.active,
      candidates: resolved.candidates || [],
    })
  }
  saveStatus(userId, status)
  return out
}

/** 读取某 user_id 当前整体状态（供 #ta状态 卡片使用） */
export function getStatus(userId, cfg, status) {
  const games = GAMES.map((g) => {
    const gs = status.games?.[g.key] || {}
    return { key: g.key, name: g.name, last: gs.last || null, event: gs.event || null }
  })
  return { login: hasProfile(userId), autoCheckin: cfg.auto_checkin, cron: cfg.checkin_cron, games }
}

export function setAutoCheckin(enable) {
  const cfg = loadConfig()
  cfg.auto_checkin = Boolean(enable)
  saveUserConfig(cfg)
  return cfg.auto_checkin
}

/** 文字汇总（群推送或卡片渲染失败时的回退） */
export function formatResults(results) {
  const lines = ["【TapTap 签到结果】"]
  for (const r of results) {
    const tag = r.ok ? (r.already ? "已签" : "成功") : "失败"
    let detail = ""
    if (!r.ok) {
      detail =
        r.reason === "not_logged_in"
          ? "（未登录，请 #ta登录）"
          : r.reason === "event_ended"
          ? "（活动已结束）"
          : r.reason === "no_event"
          ? "（未发现进行中的活动）"
          : r.reason === "no_sign_button"
          ? "（无签到按钮）"
          : `（${r.reason}）`
    } else if (r.message) {
      detail = `（${r.message}）`
    }
    lines.push(`· ${r.game}：${tag}${detail}`)
  }
  return lines.join("\n")
}

/** 推送结果到配置的群（image 优先，失败回退 text） */
export async function pushToGroups(text, groups, image) {
  const list = groups || []
  if (!list.length) return
  const Bot = globalThis.Bot
  if (!Bot) {
    logger?.warn?.("[Lotus-TapTap] 未找到全局 Bot，跳过群推送")
    return
  }
  for (const gid of list) {
    try {
      const target = Bot.pickGroup
        ? Bot.pickGroup(Number(gid))
        : Bot.sendGroupMsg
        ? { sendMsg: (m) => Bot.sendGroupMsg(Number(gid), m) }
        : null
      if (!target) {
        logger?.warn?.("[Lotus-TapTap] 全局 Bot 不支持群消息发送，跳过推送")
        return
      }
      if (image) {
        try {
          await target.sendMsg(image)
        } catch (e) {
          logger?.warn?.(`[Lotus-TapTap] 卡片推送到群 ${gid} 失败，回退文字：${e.message}`)
          await target.sendMsg(text)
        }
      } else {
        await target.sendMsg(text)
      }
    } catch (e) {
      logger?.warn?.(`[Lotus-TapTap] 推送到群 ${gid} 失败：${e.message}`)
    }
  }
}

/**
 * 推送自动签到结果给 BOT主人（严格私聊）。
 * 对齐荷花主签到「汇总看板」通道：常开监控，不受全局静默/纯文字影响；
 * 未绑定主人（globalConfig.master.wxid 为空）时静默跳过，仅留 logger.mark 日志。
 */
export async function pushToMaster(text, image) {
  let masterWxid
  try {
    const globalConfig = await loadGlobalConfig()
    masterWxid = globalConfig.master?.wxid
  } catch {
    return
  }
  if (!masterWxid) return
  const Bot = globalThis.Bot
  const opts = { bot: Bot, prefer: "private", onlyPrivate: true, onlyKnownFriend: false }
  try {
    if (image) {
      const r = await notifyUser(masterWxid, image, opts).catch(() => null)
      if (r && r.ok) return
    }
    await notifyUser(masterWxid, text, opts).catch(() => null)
  } catch (e) {
    logger?.warn?.(`[Lotus-TapTap] 推送到主人失败：${e.message}`)
  }
}

export { GAMES, loadConfig, saveUserConfig, loadStatus, saveStatus, loadAccounts, addAccount, removeAccount, enabledGames, matchGames, hasProfile, isLoggedIn }
