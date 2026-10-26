import { listProfileIds, loadProfile } from "../config/profile.js"
import { deviceHeaders } from "../devices/service.js"
import { AccountService } from "../login/account.js"
import { parseCookieString } from "../mihoyo/cookies.js"
import { getDs2 } from "../mihoyo/ds.js"
import { MIHOYO } from "../mihoyo/constants.js"
import {
  inferServerFromUid,
  isCnServer,
  isUnknownServer,
  resolveServer,
  sameServerSide,
} from "../mihoyo/regions.js"
import { solveCaptcha } from "./service.js"

// 5003 必须在这里：genshin 的 mysInfo 把 5003 与 1034 归为同一类验证码
//（`case 1034: case 5003: case 10035: case 10041:` 一起走 Handler）。
// 漏掉它的后果非常隐蔽：solveMysRequestCaptcha 会在第 38 行 1ms 内 reject，
// 不打任何 captcha 日志，用户侧只收到「米游社账号异常，请绑定设备」，
// 而 device_fp handler 的 5003 重试通常也失败，看起来像「绑了设备也没用」。
const CAPTCHA_RETCODES = new Set([1034, 5003, 10035, 10041])
const COOKIE_REFRESH_RETCODES = new Set([-100, 10001, 10101, 10102, 10103])

export async function solveMysRequestCaptcha({
  e,
  args,
  reject,
  fetchImpl = globalThis.fetch,
  solveCaptchaImpl = solveCaptcha,
  onCaptchaEvent,
  accountService,
} = {}) {
  const { mysApi, res, type, data = {} } = args || {}
  const retcode = Number(res?.retcode)
  if (isCookieRefreshableResponse(res)) {
    return await refreshCookieAndRetry({
      e,
      args,
      reject,
      accountService,
    })
  }
  if (!CAPTCHA_RETCODES.has(retcode)) return reject?.()
  if (!mysApi) return reject?.()

  const context = await createMysCaptchaContext(e, mysApi, retcode)
  const createChallenge = async () => {
    const created = await requestCaptchaChallenge(context, fetchImpl)
    if (created?.retcode !== 0 || !created?.data?.gt) {
      throw new Error(created?.message || "create captcha challenge failed")
    }
    return created
  }

  const created = await createChallenge()
  const solved = await solveCaptchaImpl(created.data, {
    onCaptchaEvent,
    refreshChallenge: async () => (await createChallenge()).data,
  })

  if (!solved.ok) {
    return {
      retcode,
      message: solved.reason || "验证码失败",
      data: null,
    }
  }

  const verified = await verifyCaptchaChallenge(context, {
    challenge: solved.challenge || created.data.challenge,
    validate: solved.validate || solved.token,
  }, fetchImpl)
  const rpcChallenge = verified?.data?.challenge
  if (!rpcChallenge) {
    // 打码成功但米游社不认 validate 时，必须能看到 verify 的真实响应，
    // 否则上层只会拿到一句兜底文案「验证码校验失败」，无法区分是
    // 参数不匹配 / DS 算错 / device_fp 不一致 / 账号被风控。
    try {
      const short = (v) => (typeof v === "string" && v.length > 12 ? `${v.slice(0, 12)}...(${v.length})` : v)
      globalThis.logger?.mark?.(
        `[Lotus-Plugin] captcha verify rejected: retcode=${context.retcode}` +
        ` gt=${short(created.data?.gt)}` +
        ` challenge=${short(solved.challenge || created.data?.challenge)}` +
        ` validate=${short(solved.validate || solved.token)}` +
        ` dfp=${short(context.extraHeaders?.["x-rpc-device_fp"])}` +
        ` headers=${JSON.stringify(Object.keys(context.extraHeaders || {}))}` +
        ` resp=${JSON.stringify(verified)}`,
      )
    } catch {}
    return {
      retcode,
      message: verified?.message || "验证码校验失败",
      data: null,
    }
  }

  if (args?.OnlyGtest) return verified

  const retryData = {
    ...data,
    headers: {
      ...(data?.headers || {}),
      "x-rpc-challenge": rpcChallenge,
    },
  }
  return mysApi.getData(type, retryData)
}

export function isCookieRefreshableResponse(res = {}) {
  const retcode = Number(res?.retcode)
  if (CAPTCHA_RETCODES.has(retcode)) return false
  if (COOKIE_REFRESH_RETCODES.has(retcode)) return true

  const message = String(res?.message || res?.msg || res?.data?.message || "")
  if (!message) return false
  if (/验证码|captcha|geetest|challenge|风控|频繁|visit too frequently/i.test(message)) return false
  return /(cookie|ck|login|登录|登陆|未登录|失效|过期|expired|invalid|please login)/i.test(message)
}

export async function createMysCaptchaContext(e, mysApi, retcode) {
  const game = e?.game || mysApi.game || "gs"
  const appKey = game === "zzz" ? "game_record_zzz" : game === "sr" ? "hkrpg_game_record" : ""
  const challengeGame = game === "zzz" ? "8" : game === "sr" ? "6" : "2"
  const server = resolveMysApiServer(e, mysApi, game)
  const isCn = isCnServer(server)
  const device = await findProfileDevice(e, mysApi)
  const extraHeaders = {
    "x-rpc-challenge_game": challengeGame,
    ...deviceHeaders(device),
  }

  const fallbackFp = mysApi._device_fp?.data?.device_fp
  if (!extraHeaders["x-rpc-device_fp"] && fallbackFp) {
    extraHeaders["x-rpc-device_fp"] = fallbackFp
  }

  return {
    retcode,
    game,
    appKey,
    server,
    isCn,
    cookie: mysApi.cookie || "",
    mysApi,
    extraHeaders,
  }
}

export async function requestCaptchaChallenge(context, fetchImpl = globalThis.fetch, options = {}) {
  // is_high 默认 true（高风险通道）。留出开关只为对照实验，实测两档返回的
  // gt/challenge 完全一致（gt 都是 846fea0f...），不影响结果。
  const isHigh = options.isHigh !== false
  const query = context.retcode === 10035
    ? `is_high=${isHigh}&app_key=${encodeURIComponent(context.appKey)}`
    : `is_high=${isHigh}`
  const url = context.retcode === 10035
    ? `${apiHost(context)}event/toolcomsrv/risk/createGeetest?${query}`
    : `${recordHost(context)}game_record/app/card/wapi/createVerification?${query}`
  return requestMysJson(context, fetchImpl, {
    url,
    query,
    body: "",
    headers: context.extraHeaders,
  })
}

export async function verifyCaptchaChallenge(context, solved, fetchImpl = globalThis.fetch) {
  const bodyData = context.retcode === 10035
    ? {
        geetest_challenge: solved.challenge,
        geetest_validate: solved.validate,
        geetest_seccode: `${solved.validate}|jordan`,
        app_key: context.appKey,
      }
    : {
        geetest_challenge: solved.challenge,
        geetest_validate: solved.validate,
        geetest_seccode: `${solved.validate}|jordan`,
      }
  const body = JSON.stringify(bodyData)
  const url = context.retcode === 10035
    ? `${apiHost(context)}event/toolcomsrv/risk/verifyGeetest`
    : `${recordHost(context)}game_record/app/card/wapi/verifyVerification`

  return requestMysJson(context, fetchImpl, {
    url,
    query: "",
    body,
    method: "POST",
    headers: context.extraHeaders,
  })
}

async function requestMysJson(context, fetchImpl, request) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable")
  const headers = buildMysHeaders(context, request.query, request.body)
  // x-trace-id 是「响应头」，请求时正确的名字是 x-rpc-challenge_trace——
  // 之前这里把 x-trace-id 当请求头发出去，属于协议用错（服务端不会识别）。
  if (context.traceId) headers["x-rpc-challenge_trace"] = context.traceId
  const response = await fetchImpl(request.url, {
    method: request.method || (request.body ? "POST" : "GET"),
    headers: {
      ...headers,
      ...(request.headers || {}),
      Cookie: context.cookie,
    },
    body: request.body || undefined,
  })
  // 记录响应头里的 x-trace-id，供后续 verify 作为 x-rpc-challenge_trace 回传。
  // 注意：脱离真实风控事件直接调 verifyVerification 时，米游社恒定返回
  // 10306（带 x-rpc-challenge_game）或 -1「拼图已过期」（不带），
  // 这与打码质量无关，不能拿孤立探测的结果判断链路好坏。
  try {
    const traceId = response.headers?.get?.("x-trace-id")
    if (traceId) context.traceId = traceId
    const log = globalThis.logger?.mark
      ? (m) => globalThis.logger.mark(m)
      : (m) => console.log(m)
    log(`[Lotus-Plugin] captcha ${request.method || "GET"} ${request.url.split("?")[0]} -> ${response.status} trace=${traceId || "(none)"}`)
  } catch {}
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    const error = new Error(`captcha request failed: HTTP ${response.status}`)
    error.data = data
    throw error
  }
  return data
}

function buildMysHeaders(context, query = "", body = "") {
  const mysApi = context.mysApi
  if (shouldTrustMysHeaders(context) && typeof mysApi?.getHeaders === "function") {
    if (mysApi.getHeaders.length >= 3) return mysApi.getHeaders("", query, body)
    return mysApi.getHeaders(query, body)
  }
  return buildLotusMysHeaders(context, query, body)
}

function apiHost(context) {
  return context.isCn ? "https://api-takumi.mihoyo.com/" : "https://sg-public-api.hoyolab.com/"
}

function recordHost(context) {
  return context.isCn ? "https://api-takumi-record.mihoyo.com/" : "https://bbs-api-os.hoyolab.com/"
}

function resolveMysApiServer(e, mysApi, game) {
  const explicit = mysApi?.server || e?.server || e?.region || e?.mysServer || ""
  return resolveServer({
    server: explicit,
    uid: mysApi?.uid || e?.uid,
    game,
    fallback: inferServerFromUid(mysApi?.uid || e?.uid || "", game),
  })
}

function shouldTrustMysHeaders(context) {
  const server = context.mysApi?.server || ""
  if (isUnknownServer(server)) return false
  return sameServerSide(context.server, server)
}

function buildLotusMysHeaders(context, query = "", body = "") {
  const cn = context.isCn
  return {
    "x-rpc-app_version": MIHOYO.appVersion,
    "x-rpc-client_type": cn ? "5" : "2",
    "User-Agent": cn
      ? `Mozilla/5.0 (Linux; Android 12; Lotus) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.73 Mobile Safari/537.36 miHoYoBBS/${MIHOYO.appVersion}`
      : `Mozilla/5.0 (Linux; Android 11; Lotus) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36 miHoYoBBSOversea/${MIHOYO.appVersion}`,
    Referer: cn ? "https://webstatic.mihoyo.com/" : "https://act.hoyolab.com/",
    DS: getDs2(query, body, cn
      ? "xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs"
      : "okr4obncj8bw5a65hbnn5oo6ixjc3l9w"),
  }
}

async function findProfileDevice(e, mysApi) {
  const match = await findProfileForMysApi(e, mysApi)
  return match?.profile?.device || null
}

async function refreshCookieAndRetry({
  e,
  args,
  reject,
  accountService,
} = {}) {
  const { mysApi, type, data = {} } = args || {}
  if (!mysApi || !type || typeof mysApi.getData !== "function") return reject?.()

  const match = await findProfileForMysApi(e, mysApi)
  if (!match) return reject?.()

  try {
    const service = accountService || new AccountService()
    const profile = await service.refresh(match.qq, match.profileId)
    const cookie = profile?.account?.cookie
    if (!cookie) return reject?.()
    mysApi.cookie = cookie
    if (mysApi.apiTool) mysApi.apiTool.cookie = cookie
    await registerRefreshedProfile(match.qq, profile)
    globalThis.logger?.mark?.(`[Lotus-Plugin] CK expired, refreshed profile ${match.profileId} and retry ${type}`)
    return await mysApi.getData(type, data)
  } catch (error) {
    globalThis.logger?.warn?.(`[Lotus-Plugin] refresh expired CK failed: ${error.message}`)
    return reject?.()
  }
}

async function registerRefreshedProfile(qq, profile) {
  try {
    const mod = await import("../../services/genshinBridge/profile.js")
    if (typeof mod.registerProfileWithGenshin === "function") {
      await mod.registerProfileWithGenshin({ qq, profile })
    }
  } catch (error) {
    globalThis.logger?.debug?.(`[Lotus-Plugin] register refreshed CK to genshin bridge failed: ${error.message}`)
  }
}

async function findProfileForMysApi(e, mysApi) {
  const qq = e?.user_id
  if (!qq) return null
  const cookie = typeof mysApi.cookie === "string" ? parseCookieString(mysApi.cookie) : mysApi.cookie || {}
  const ltuid = String(cookie.ltuid || cookie.ltuid_v2 || cookie.account_id || cookie.account_id_v2 || "")
  if (!ltuid) return null

  const profileIds = await listProfileIds(String(qq))
  for (const profileId of profileIds) {
    const profile = await loadProfile(String(qq), profileId).catch(() => null)
    if (!profile) continue
    const account = profile.account || {}
    if ([account.ltuid, account.stuid].map(String).includes(ltuid)) {
      return {
        qq: String(qq),
        profileId,
        profile,
      }
    }
  }
  return null
}
