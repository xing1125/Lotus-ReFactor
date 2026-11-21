import { MihoyoClient } from "../mihoyo/client.js"
import { buildAccountCookie, buildStokenCookie, parseAccountCookie } from "../mihoyo/cookies.js"
import { exchangeStokenCredentials } from "./credentials.js"

export class QrLoginService {
  constructor(options = {}) {
    this.client = options.client || new MihoyoClient(options)
    this.pollIntervalMs = options.pollIntervalMs || 5000
    this.maxPolls = options.maxPolls || 60
    this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  async create() {
    const res = await this.client.createQrLogin()
    const url = res?.data?.url
    const ticket = res?.data?.ticket || url?.split("ticket=")[1]
    if (!url || !ticket) throw new Error(res?.message || "QR login url is unavailable")
    return {
      url,
      ticket,
      raw: res,
    }
  }

  async waitConfirmed(ticket, events = {}) {
    let scannedNotified = false
    for (let index = 0; index < this.maxPolls; index += 1) {
      await this.sleep(this.pollIntervalMs)
      const res = await this.client.queryQrLoginStatus(ticket)
      if (res?.retcode && res.retcode !== 0) throw new Error(res.message || "QR login expired")

      const status = res?.data?.status || res?.data?.stat
      if (status === "Scanned" && !scannedNotified) {
        scannedNotified = true
        await events.onScanned?.(res)
      }
      if (status === "Confirmed") {
        return this.buildLoginResult(res)
      }
    }
    throw new Error("QR login timeout")
  }

  async buildLoginResult(statusResult) {
    const tokenData = pickToken(statusResult.data?.tokens, ["stoken_v2", "stoken"])
    const stoken = tokenData?.token
    const stuid = statusResult.data?.user_info?.aid
      || statusResult.data?.user_info?.uid
      || statusResult.data?.user_info?.account_id
    const mid = statusResult.data?.user_info?.mid
    if (!stoken || !stuid) {
      logInvalidConfirmedShape(statusResult.data, { hasStoken: Boolean(stoken), hasUid: Boolean(stuid), hasMid: Boolean(mid) })
      throw new Error("QR login result has no stoken")
    }

    // 扫码确认的 tokens 里通常直接带 ltoken/cookie_token。米游社的
    // getLtokenByStoken / getCookieAccountInfoBySToken 换票接口自 2026-11 起返回
    // 1002/-464（接口层失效），因此优先用扫码返回自带的 token 构造凭据，
    // 只有在自带 token 缺失时才回退到 exchange，避免扫码必然失败。
    const tokens = Array.isArray(statusResult.data?.tokens) ? statusResult.data.tokens : []
    const selfLtoken = pickToken(tokens, ["ltoken", "ltoken_v2"])?.token || ""
    const selfCookieToken = pickToken(tokens, ["cookie_token", "cookie_token_v2"])?.token || ""

    let ltoken = selfLtoken
    let cookieToken = selfCookieToken
    if (!ltoken || !cookieToken) {
      try {
        const exchanged = await exchangeStokenCredentials(this.client, { stuid, stoken, mid })
        const parsed = parseAccountCookie(exchanged.cookie || "")
        if (!ltoken) ltoken = parsed.ltoken || ""
        if (!cookieToken) cookieToken = parsed.cookie_token || ""
        // exchange 只用来补齐缺失的 token，最终统一用 buildAccountCookie 构造（保证 v2 带 mid）。
      } catch (error) {
        if (!ltoken || !cookieToken) {
          logInvalidConfirmedShape(statusResult.data, { hasStoken: Boolean(stoken), hasUid: Boolean(stuid), hasMid: Boolean(mid) })
          throw new Error(`扫码凭据交换失败：${error.message || "token exchange failed"}；请稍后重试或换号再扫`)
        }
      }
    }

    return {
      cookie: buildAccountCookie({ ltuid: stuid, ltoken, cookieToken, mid }),
      stoken: buildStokenCookie({ stuid, stoken, ltoken, mid }),
      raw: statusResult,
    }
  }
}

function logInvalidConfirmedShape(data, presence) {
  try {
    const tokens = Array.isArray(data?.tokens) ? data.tokens : []
    const knownNames = new Set(["stoken", "stoken_v2", "ltoken", "ltoken_v2", "cookie_token", "cookie_token_v2", "game_token"])
    const shape = {
      ...presence,
      tokenCount: tokens.length,
      dataKeys: ["status", "stat", "tokens", "user_info"].filter(key => Object.hasOwn(data || {}, key)),
      userInfoKeys: ["aid", "uid", "account_id", "mid"].filter(key => Object.hasOwn(data?.user_info || {}, key)),
      tokens: tokens.slice(0, 8).map(item => ({
        keys: ["token", "name", "token_type"].filter(key => Object.hasOwn(item || {}, key)),
        name: knownNames.has(item?.name) ? item.name : item?.name === undefined ? "absent" : "other",
        type: [1, 2, 3, 4, "1", "2", "3", "4"].includes(item?.token_type) ? Number(item.token_type) : item?.token_type === undefined ? "absent" : "other",
      })),
    }
    globalThis.logger?.warn?.(`[Lotus-Plugin] QR confirmed result unsupported: ${JSON.stringify(shape)}`)
  } catch {}
}

export function pickToken(tokens = [], names = []) {
  if (!Array.isArray(tokens)) return null
  // Passport QR responses use token_type=1 for SToken and may have no name.
  // Retain named-response compatibility without guessing another token family.
  if (names.some(name => name === "stoken" || name === "stoken_v2")) {
    const matches = []
    for (const item of tokens) {
      if (!item || typeof item.token !== "string" || !item.token) continue
      const named = names.includes(item.name)
      const typed = item.token_type === 1 || item.token_type === "1"
      if (named && item.token_type !== undefined && !typed) return null
      if (typed && ["ltoken", "ltoken_v2", "cookie_token", "cookie_token_v2", "game_token"].includes(item.name)) return null
      if (named || typed) matches.push(item)
    }
    if (new Set(matches.map(item => item.token)).size !== 1) return null
    return matches[0] || null
  }
  for (const name of names) {
    const token = tokens.find(item => item?.name === name)
    if (token?.token) return token
  }
  return null
}
