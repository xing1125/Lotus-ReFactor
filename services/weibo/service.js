// 微博超话签到业务编排
// - cookie 存储：data/weibo/<qq>.yaml（独立于米游社 profile，避免污染）
// - 扫码会话：内存 Map，单账号同时只能有一个二维码待确认
// - 签到流程：拉超话列表 → 逐个 POST scheme URL（已签跳过）→ 汇总结果
// - st token 轮换：weibo.py 直接用 scheme URL 签到（scheme 自带签名参数），无需单独取 st；
//   若签到中途返回验签失败，重新拉一次超话列表刷新 scheme 再重试（保险机制）

import fs from "node:fs/promises"
import path from "node:path"
import YAML from "yaml"
import { resolveData } from "../../core/path.js"
import { loadGlobalConfig } from "../../core/config/global.js"
import { notifyUser } from "../../core/transport/notify.js"
import {
  fetchSuperTopics,
  signSuperTopic,
  checkCookieValid,
  createQrCode,
  checkQrCode,
  exchangeAltForCookie,
  fetchWeiboCnCookie,
  redeemCdkTicket,
} from "./api.js"

const SIGN_DELAY_MS = 1500 // 单个超话签到间隔，降低风控识别
const MAX_RETRY = 1 // 签到失败重试次数（scheme 失效时重拉列表）

// 仅签到的目标游戏超话（用户要求：只要 原神 / 崩坏：星穹铁道 / 绝区零）
export const TARGET_GAMES = ["原神", "星穹铁道", "绝区零"]

// 微博「天签到礼包」兑换码（ticket_id）映射，复刻 ji-plugin model/weiboSign.js uptickit()。
// 注意：ticket 可能随活动更新失效；如需刷新可调用 refreshCdkTickets()。
export const WEIBO_CDK_TICKETS = {
  "100808fc439dedbb06ca5fd858848e521b8716": { name: "原神", tickets: ["2670", "2671", "2672"] },
  "100808e1f868bf9980f09ab6908787d7eaf0f0": { name: "星穹铁道", tickets: ["2698", "2699", "2700"] },
}

function isTargetGame(name) {
  const n = String(name || "")
  return TARGET_GAMES.some((g) => n.includes(g))
}

// 内存扫码会话：qq -> { qrid, createdAt, timer }
const qrSessions = new Map()
const QR_TTL_MS = 3 * 60 * 1000 // 二维码 3 分钟过期

/** 读取某账号的微博账号文件 */
function accountFile(qq) {
  return resolveData("weibo", `${qq}.yaml`)
}

export async function loadWeiboAccount(qq) {
  const file = accountFile(qq)
  try {
    const raw = await fs.readFile(file, "utf8")
    const data = YAML.parse(raw)
    return data || null
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

export async function saveWeiboAccount(qq, data) {
  const file = accountFile(qq)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const payload = {
    qq: String(qq),
    cookie: String(data.cookie || ""),
    nickname: String(data.nickname || ""),
    auto_checkin: Boolean(data.auto_checkin),
    app_link: data.app_link || null,
    last_checkin: data.last_checkin || null,
    last_result: data.last_result || null,
    updated_at: new Date().toISOString(),
  }
  await fs.writeFile(file, YAML.stringify(payload), "utf8")
  return payload
}

export async function deleteWeiboAccount(qq) {
  const file = accountFile(qq)
  try {
    await fs.unlink(file)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

/** 列出所有绑定了微博的账号（用于自动签到遍历） */
export async function listAllWeiboAccounts() {
  const dir = resolveData("weibo")
  let files
  try {
    files = await fs.readdir(dir)
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }
  const accounts = []
  for (const file of files) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8")
      const data = YAML.parse(raw)
      if (data?.cookie) accounts.push(data)
    } catch {}
  }
  return accounts
}

/** 绑定 cookie（方案 A）：校验有效性后保存 */
export async function bindCookie(qq, cookie, { nickname = "" } = {}) {
  const clean = String(cookie || "").trim()
  if (!clean) return { ok: false, reason: "empty_cookie" }
  if (!/SUB[=_]/i.test(clean)) {
    return { ok: false, reason: "missing_SUB", message: "cookie 缺少 SUB 字段，请确认复制了 m.weibo.cn 的完整 cookie。" }
  }
  const check = await checkCookieValid(clean)
  if (!check.valid) {
    return { ok: false, reason: check.reason || "invalid", message: "cookie 校验失败，可能是已失效或格式不对。" }
  }
  const saved = await saveWeiboAccount(qq, { cookie: clean, nickname, auto_checkin: true })
  return { ok: true, account: saved, topicCount: check.topicCount }
}

/**
 * 执行超话签到
 * @param qq
 * @param cookie 可选，不传则从存储读
 * @returns { ok, signed, skipped, failed, results, cookieExpired }
 */
export async function runCheckin(qq, cookie) {
  const account = cookie ? { cookie, qq } : await loadWeiboAccount(qq)
  if (!account?.cookie) return { ok: false, reason: "no_account" }

  const listRes = await fetchSuperTopics(account.cookie)
  if (!listRes.ok) {
    await markResult(qq, { ok: false, reason: listRes.reason, time: new Date().toISOString() })
    return { ok: false, reason: listRes.reason, cookieExpired: listRes.reason === "cookie_expired" }
  }

  // 仅保留目标游戏超话（原神 / 崩坏星穹铁道 / 绝区零），其余关注超话不签
  const topics = listRes.topics.filter((t) => isTargetGame(t.name))
  const results = []
  let signed = 0
  let skipped = 0
  let failed = 0

  if (topics.length === 0) {
    const summary = {
      ok: true,
      time: new Date().toISOString(),
      total: 0,
      signed: 0,
      skipped: 0,
      failed: 0,
      results: [],
      note: "未关注目标游戏超话（原神/崩坏星穹铁道/绝区零），未执行签到。",
    }
    await markResult(qq, summary)
    return summary
  }

  for (const topic of topics) {
    if (topic.signed) {
      skipped++
      results.push({ name: topic.name, level: topic.level, status: "already_signed" })
      continue
    }
    const r = await signOne(account.cookie, topic)
    if (r.ok) {
      signed++
      results.push({ name: topic.name, level: topic.level, status: "signed", msg: r.msg })
    } else {
      failed++
      results.push({ name: topic.name, level: topic.level, status: "failed", reason: r.reason, msg: r.msg })
    }
    await delay(SIGN_DELAY_MS)
  }

  const summary = {
    ok: true,
    time: new Date().toISOString(),
    total: topics.length,
    signed,
    skipped,
    failed,
    results,
  }
  await markResult(qq, summary)
  return summary
}

/** 单个超话签到 + scheme 失效重试 */
async function signOne(cookie, topic) {
  let r = await signSuperTopic(cookie, topic.signUrl)
  if (!r.ok && r.reason === "bad_json") {
    // scheme 可能过期，重新拉一次超话列表刷新 signUrl
    const fresh = await fetchSuperTopics(cookie)
    if (fresh.ok) {
      const t = fresh.topics.find(x => x.name === topic.name)
      if (t && t.signUrl && t.signUrl !== topic.signUrl) {
        r = await signSuperTopic(cookie, t.signUrl)
      }
    }
  }
  return r
}

async function markResult(qq, result) {
  try {
    const account = await loadWeiboAccount(qq)
    if (!account) return
    account.last_checkin = result.time
    account.last_result = {
      ok: result.ok,
      total: result.total,
      signed: result.signed,
      skipped: result.skipped,
      failed: result.failed,
      reason: result.reason,
      time: result.time,
    }
    await saveWeiboAccount(qq, account)
  } catch {}
}

// ===== 扫码登录（方案 B） =====

/**
 * 开始扫码登录：申请二维码，返回 { qrid, image } 供前端渲染
 * 同时启动 TTL 定时器自动清理
 */
export async function startQrLogin(qq) {
  // 清掉旧会话
  await cancelQrLogin(qq)

  const created = await createQrCode()
  if (!created.ok) return created

  const session = {
    qrid: created.qrid,
    image: created.image,
    createdAt: Date.now(),
    timer: null,
  }
  qrSessions.set(String(qq), session)
  session.timer = setTimeout(() => qrSessions.delete(String(qq)), QR_TTL_MS)
  if (typeof session.timer.unref === "function") session.timer.unref()
  return { ok: true, qrid: created.qrid, image: created.image }
}

/** 轮询扫码状态；确认成功后自动用 alt 换 cookie 并保存 */
export async function pollQrLogin(qq) {
  const session = qrSessions.get(String(qq))
  if (!session) return { ok: false, reason: "no_session", status: "expired" }
  if (Date.now() - session.createdAt > QR_TTL_MS) {
    qrSessions.delete(String(qq))
    return { ok: false, reason: "expired", status: "expired" }
  }

  const status = await checkQrCode(session.qrid)
  if (!status.ok) return status

  if (status.status === "confirmed" && status.alt) {
    // 换 cookie
    const exchanged = await exchangeAltForCookie(status.alt)
    if (!exchanged.ok) {
      qrSessions.delete(String(qq))
      return { ok: false, reason: exchanged.reason || "exchange_failed", status: "error" }
    }
    // 校验并保存
    const bind = await bindCookie(qq, exchanged.cookie)
    qrSessions.delete(String(qq))
    if (!bind.ok) {
      return { ok: false, reason: bind.reason || "bind_failed", status: "error", message: bind.message }
    }
    return {
      ok: true,
      status: "success",
      cookie: exchanged.cookie,
      topicCount: bind.topicCount,
    }
  }
  return status
}

export async function cancelQrLogin(qq) {
  const session = qrSessions.get(String(qq))
  if (!session) return false
  if (session.timer) clearTimeout(session.timer)
  qrSessions.delete(String(qq))
  return true
}

/** 获取上次签到结果（供 #微博签到状态 查询） */
export async function getCheckinStatus(qq) {
  const account = await loadWeiboAccount(qq)
  if (!account) return { ok: false, reason: "no_account" }
  const valid = account.cookie ? await checkCookieValid(account.cookie) : { valid: false, reason: "no_cookie" }
  return {
    ok: true,
    account: {
      qq: account.qq,
      nickname: account.nickname || "",
      auto_checkin: Boolean(account.auto_checkin),
      cookie_valid: valid.valid,
      cookie_reason: valid.reason,
      topic_count: valid.topicCount,
      last_checkin: account.last_checkin || null,
      last_result: account.last_result || null,
    },
  }
}

export async function setAutoCheckin(qq, enabled) {
  const account = await loadWeiboAccount(qq)
  if (!account) return { ok: false, reason: "no_account" }
  account.auto_checkin = Boolean(enabled)
  await saveWeiboAccount(qq, account)
  return { ok: true, auto_checkin: account.auto_checkin }
}

/** 提取 cookie 中的 SUB（用于显示账号标识，避免明文全 cookie） */
export function extractSub(cookie) {
  const m = String(cookie || "").match(/SUB=([^;]+)/)
  return m ? m[1].slice(0, 12) + "…" : ""
}

/** 解析微博 app-link（api.weibo.cn/2/cardlist?...），提取 CDK 兑换所需的 aid/from/s/gsid */
export function parseWeiboLink(link) {
  const text = String(link || "").trim()
  if (!text) return { ok: false, reason: "empty", message: "链接为空" }
  const q = text.includes("api.weibo.cn/2/cardlist?")
    ? text.split("api.weibo.cn/2/cardlist?")[1]
    : text
  const params = new URLSearchParams(q)
  const out = {
    aid: params.get("aid"),
    from: params.get("from"),
    c: params.get("c"),
    s: params.get("s"),
    gsid: params.get("gsid"),
    uid: params.get("uid"),
  }
  if (!out.aid || !out.from || !out.s || !out.gsid || !out.c)
    return { ok: false, reason: "missing_fields", message: "链接缺少必要参数 [c/s/aid/uid/from/gsid]" }
  return { ok: true, link: out }
}

/** 绑定微博 app-link（CDK 兑换需要），校验后存入账号 */
export async function bindLink(qq, link) {
  const parsed = parseWeiboLink(link)
  if (!parsed.ok) return parsed
  const account = await loadWeiboAccount(qq)
  if (!account) return { ok: false, reason: "no_account", message: "请先 #wbcookie 或 #wb扫码 绑定微博 cookie。" }
  const ck = await fetchWeiboCnCookie(parsed.link)
  const uid = parsed.link.uid || ck.uid || ""
  account.app_link = { ...parsed.link, uid }
  await saveWeiboAccount(qq, account)
  if (!ck.ok)
    return { ok: true, uid, warning: `链接已保存，但获取查询 cookie 失败（${ck.reason}），兑换前请确认链接未过期。` }
  return { ok: true, uid }
}

/** 兑换微博「天签到礼包」CDK：遍历 WEIBO_CDK_TICKETS 全部 ticket */
export async function redeemCdk(qq) {
  const account = await loadWeiboAccount(qq)
  if (!account?.app_link?.aid) {
    return {
      ok: false,
      reason: "no_link",
      message: "未绑定微博 app 链接，无法兑换 CDK。请先 #wb链接 <api.weibo.cn/2/cardlist?...> 绑定（CDK 兑换需该链接参数）。",
    }
  }
  const link = account.app_link
  const ck = await fetchWeiboCnCookie(link)
  if (!ck.ok) return { ok: false, reason: "cookie_failed", message: `获取查询 cookie 失败：${ck.reason}` }
  const results = []
  for (const [containerid, info] of Object.entries(WEIBO_CDK_TICKETS)) {
    for (const ticketId of info.tickets) {
      const r = await redeemCdkTicket(ck.cookie, { ticketId, aid: link.aid, from: link.from })
      results.push({
        game: info.name,
        ticketId,
        ok: r.ok,
        prize: r.prize || null,
        card: r.card || null,
        reason: r.reason || null,
      })
      await delay(2000)
    }
  }
  return { ok: true, results }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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
    logger?.warn?.(`[Lotus-Weibo] 推送到主人失败：${e.message}`)
  }
}
