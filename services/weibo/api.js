// 微博 m.weibo.cn + login.sina.com.cn HTTP 封装
// 超话签到走 container/getContainer 拿列表 + scheme 直 POST（抄 genshin-impact-helper/weibo.py）
// 扫码登录走 login.sina.com.cn/sso/qrcode 三步流程

const M_WEIBO = "https://m.weibo.cn"
const LOGIN_SINA = "https://login.sina.com.cn"

const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"

/** 超话列表接口（关注超话 tab），返回 JSON */
const SUPER_URL = `${M_WEIBO}/api/container/getContainer?containerid=100803_-_followsuper`

export function defaultUserAgent() {
  return DEFAULT_UA
}

function buildHeaders(cookie, { referer = M_WEIBO, ua = DEFAULT_UA, extra = {} } = {}) {
  const h = { "User-Agent": ua, Referer: referer, ...extra }
  if (cookie) h.Cookie = cookie
  return h
}

/** 获取已关注超话列表；cookie 失效返回 reason=cookie_expired（接口会 302） */
export async function fetchSuperTopics(cookie) {
  let res
  try {
    res = await fetch(SUPER_URL, { headers: buildHeaders(cookie), redirect: "manual" })
  } catch (error) {
    return { ok: false, reason: "network_error", message: error.message }
  }
  if (res.status === 302 || res.status === 301) return { ok: false, reason: "cookie_expired" }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` }
  const json = await res.json().catch(() => null)
  if (!json) return { ok: false, reason: "bad_json" }
  return { ok: true, topics: parseSuperTopics(json) }
}

/** 从 getContainer JSON 解析超话列表（weibo.py: card_group[1:-1] 跳过首尾 banner） */
export function parseSuperTopics(json) {
  const group = json?.data?.cards?.[0]?.card_group || []
  return group.slice(1, -1).map(card => {
    const btn = card.buttons?.[0] || {}
    const scheme = btn.scheme || ""
    const containerid = String(card.scheme || card.scheme_raw || "")
      .split("&")[0]
      .split("=")
      .pop() || ""
    return {
      name: card.title_sub || card.title || "",
      containerid,
      level: parseInt(String(card.desc1 || "").match(/\d+/)?.[0] || "0", 10),
      signed: btn.name === "已签",
      signUrl: scheme ? `${M_WEIBO}${scheme}` : "",
    }
  }).filter(t => t.name) // 保留已签超话（signUrl 为空）用于统计 skipped
}

/** 单个超话签到：直接 POST scheme URL，返回 {ok} 子段（weibo.py 用 response.ok==1 判成功） */
export async function signSuperTopic(cookie, signUrl) {
  let res
  try {
    res = await fetch(signUrl, {
      method: "POST",
      headers: buildHeaders(cookie),
      redirect: "manual",
    })
  } catch (error) {
    return { ok: false, reason: "network_error", message: error.message }
  }
  if (res.status === 302 || res.status === 301) return { ok: false, reason: "cookie_expired" }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` }
  const json = await res.json().catch(() => null)
  if (!json) return { ok: false, reason: "bad_json" }
  // 微博 ok 字段：1=成功，0=已签/失败；msg 里带提示
  return { ok: json.ok === 1, msg: json.msg || json.data?.msg || "", raw: json }
}

/** 校验 cookie 是否有效（拉超话列表，302 即失效） */
export async function checkCookieValid(cookie) {
  const r = await fetchSuperTopics(cookie)
  if (r.ok) return { valid: true, topicCount: r.topics.length }
  return { valid: false, reason: r.reason }
}

// ===== 扫码登录（login.sina.com.cn/sso/qrcode 三步流程） =====

/** 1. 申请二维码，返回 { qrid, image } */
export async function createQrCode() {
  const url = `${LOGIN_SINA}/sso/qrcode/image?entry=mweibo`
  let res
  try {
    res = await fetch(url, {
      headers: { "User-Agent": DEFAULT_UA, Referer: M_WEIBO },
    })
  } catch (error) {
    return { ok: false, reason: "network_error", message: error.message }
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` }
  const json = await parseJsonpResponse(res)
  const qrid = json?.data?.qrid || json?.qrid
  if (!qrid) return { ok: false, reason: "no_qrid", raw: json }
  const image = json?.data?.image || json?.image || `${LOGIN_SINA}/sso/qrcode/image?qrid=${qrid}`
  return { ok: true, qrid, image }
}

/** 2. 轮询扫码状态；retcode 20000000=确认成功(带 alt)，50114002=已扫码待确认，其他=等待 */
export async function checkQrCode(qrid) {
  const url = `${LOGIN_SINA}/sso/qrcode/check?entry=mweibo&qrid=${encodeURIComponent(qrid)}&callback=jsonp`
  let res
  try {
    res = await fetch(url, {
      headers: { "User-Agent": DEFAULT_UA, Referer: M_WEIBO },
    })
  } catch (error) {
    return { ok: false, reason: "network_error", message: error.message, status: "error" }
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}`, status: "error" }
  const json = await parseJsonpResponse(res)
  const retcode = String(json?.retcode || json?.data?.retcode || "")
  const alt = json?.data?.alt || json?.alt || ""
  // 20000000 成功；50114002 已扫码待确认；50114001 等待扫码；其他视作等待
  if (retcode === "20000000") {
    return { ok: true, status: "confirmed", alt }
  }
  if (retcode === "50114002") return { ok: true, status: "scanned", retcode }
  if (retcode === "50114001") return { ok: true, status: "waiting", retcode }
  return { ok: true, status: "waiting", retcode }
}

/** 3. 用 alt 换完整 cookie，跟随跨域重定向并收集 set-cookie */
export async function exchangeAltForCookie(alt) {
  const startUrl = `${LOGIN_SINA}/sso/login.php?entry=mweibo&alt=${encodeURIComponent(alt)}`
  const cookies = new Map()
  let currentUrl = startUrl
  let hops = 0
  while (hops < 12) {
    let res
    try {
      res = await fetch(currentUrl, {
        headers: { "User-Agent": DEFAULT_UA, Referer: M_WEIBO },
        redirect: "manual",
      })
    } catch (error) {
      return { ok: false, reason: "network_error", message: error.message }
    }
    collectSetCookies(res, cookies)
    const loc = res.headers.get("location")
    if (!loc) {
      // 没有重定向了，最后一跳的 set-cookie 已收集
      if (cookies.size === 0) return { ok: false, reason: "no_cookie_set" }
      return { ok: true, cookie: cookiesToString(cookies) }
    }
    // 部分跨域 URL 需要附加 action=login（文档：后两个 crossDomainUrl 附 &action=login）
    let nextUrl = new URL(loc, currentUrl).href
    if (!nextUrl.includes("action=login") && /sso\/login\.php/.test(nextUrl)) {
      nextUrl += (nextUrl.includes("?") ? "&" : "?") + "action=login"
    }
    currentUrl = nextUrl
    hops++
  }
  if (cookies.size === 0) return { ok: false, reason: "redirect_loop" }
  return { ok: true, cookie: cookiesToString(cookies) }
}

/** 从 set-cookie header 收集到 Map（name -> value，去重保留最新） */
function collectSetCookies(res, cookies) {
  // node fetch：headers.getSetCookie() 返回数组（node 18.14+）；回退到 get('set-cookie')
  let entries = []
  if (typeof res.headers?.getSetCookie === "function") {
    entries = res.headers.getSetCookie()
  } else {
    const raw = res.headers?.get?.("set-cookie")
    if (raw) entries = [raw]
  }
  for (const entry of entries) {
    const parts = String(entry).split(";")
    const pair = parts[0] || ""
    const idx = pair.indexOf("=")
    if (idx <= 0) continue
    const name = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (name) cookies.set(name, value)
  }
}

function cookiesToString(cookies) {
  return Array.from(cookies.entries()).map(([n, v]) => `${n}=${v}`).join("; ")
}

/** 解析可能被 JSONP 包裹的响应 */
async function parseJsonpResponse(res) {
  const text = await res.text()
  return parseJsonp(text)
}

export function parseJsonp(text) {
  const raw = String(text || "").trim()
  if (!raw) return null
  // jsonp({...}) 或 var x={...};
  const m = raw.match(/^[a-zA-Z_$][\w$]*\s*\(([\s\S]*)\)\s*;?\s*$/)
  const body = m ? m[1] : raw.replace(/^var\s+\w+\s*=\s*/, "").replace(/;\s*$/, "")
  try {
    return JSON.parse(body)
  } catch {
    // 容错：抽取第一个 {...}
    const start = body.indexOf("{")
    const end = body.lastIndexOf("}")
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

// ===== 微博兑换码（天签到礼包 ticket 兑换）=====
// 复刻 ji-plugin model/weiboSign.js 的 weiboCDK 流程：
// 1) 用 app-link 参数(aid/from/s/gsid) 调 account/getcookie 换 .weibo.cn 查询 cookie
// 2) 用该 cookie 调 games.weibo.cn/prize/aj/lottery 兑换 ticket_id

/** 用微博 app-link 参数换 .weibo.cn 查询 cookie（返回 cookie 串与 uid） */
export async function fetchWeiboCnCookie(params) {
  const c = params.c || "android"
  const url =
    `https://api.weibo.cn/2/account/getcookie` +
    `?networktype=wifi&c=${encodeURIComponent(c)}&s=${encodeURIComponent(params.s)}` +
    `&aid=${encodeURIComponent(params.aid)}&from=${encodeURIComponent(params.from)}` +
    `&gsid=${encodeURIComponent(params.gsid)}&lang=zh_CN`
  let res
  try {
    res = await fetch(url, {
      headers: {
        Host: "api.weibo.cn",
        "Accept-Encoding": "gzip",
        "content-type": "application/json;charset=utf-8",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X)",
      },
    })
  } catch (error) {
    return { ok: false, reason: "network_error", message: error.message }
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` }
  const json = await res.json().catch(() => null)
  if (!json) return { ok: false, reason: "bad_json" }
  const cookie = json?.cookie?.[".weibo.cn"]
  if (!cookie) return { ok: false, reason: "no_cookie", raw: json }
  const joined = String(cookie).match(/(SUB=.*?;)|(SUBP=.*?;)|(SCF=.*?;)/g)?.join(" ") || ""
  return { ok: true, cookie: joined, uid: json?.uid || "" }
}

/** 兑换单个 ticket_id（天签到礼包），返回奖品或失败原因 */
export async function redeemCdkTicket(weiboCnCookie, { ticketId, aid, from }) {
  const url =
    `https://games.weibo.cn/prize/aj/lottery` +
    `?ticket_id=${encodeURIComponent(ticketId)}&ext=&aid=${encodeURIComponent(aid)}&from=${encodeURIComponent(from)}`
  let res
  try {
    res = await fetch(url, {
      headers: {
        Referer: "https://games.weibo.cn",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X)",
        Cookie: weiboCnCookie,
      },
    })
  } catch (error) {
    return { ok: false, reason: "network_error", message: error.message }
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` }
  const json = await res.json().catch(() => null)
  if (!json) return { ok: false, reason: "bad_json" }
  if (json?.data?.prize_data)
    return { ok: true, prize: json.data.prize_data.prize_name, card: json.data.prize_data.card_no }
  return {
    ok: false,
    reason: json?.data?.fail_desc1 || `未知错误[${json?.code}][${json?.msg}]`,
    raw: json,
  }
}
