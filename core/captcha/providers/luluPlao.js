// lulu / plao 外部付费 geetest 过码 provider（移植自 ji-plugin loveMys + apiTool）
//
// 两个独立的第三方 token 服务，均为公开 HTTP API（无需 ji 后端转发）：
//   lulu（默认 https://api.sayu-bot.com）：
//     过码 GET  /geetest?token=..&gt=..&challenge=..
//     次数 GET  /token?token=..
//   plao（默认 http://api.114514616.xyz）：
//     过码 GET  /validate/get?token=..&gt=..&challenge=..
//     次数 GET  /validate/get?token=..
//
// 响应形态（两服务基本一致，字段做了防御性兜底）：
//   validate 取 data.validate / validate / data.geetest_validate；challenge 取 data.challenge / challenge。
//   过码成功返回 validate + challenge，供下游 verifyVerification 回灌。
//
// 接入 Lotus captcha 体系：作为一个 provider（name: lulu_plao），
// 与 test_nine / ttocr / gtmanual / vision_ai 并列；按 global.yaml captcha.lulu_plao 配置启用。
// 没有 token 时 isAvailable 返回 false（跳过，不报错），由其它 provider 兜底。
import { requestJson, withQuery } from "../http.js"
import { captchaFail, captchaOk } from "../result.js"

const DEFAULT_LULU_URL = "https://api.sayu-bot.com"
const DEFAULT_PLAO_URL = "http://api.114514616.xyz"

export const luluPlaoProvider = {
  name: "lulu_plao",

  isAvailable(config = {}) {
    if (config.enable === false) return false
    return Boolean(luluToken(config) || plaoToken(config))
  },

  async solve(challenge, config = {}, context = {}) {
    const started = Date.now()
    if (!this.isAvailable(config)) {
      return captchaFail(this.name, "provider_unconfigured", { skipped: true })
    }

    // 首选 provider：按 config.provider 指定，否则 lulu 优先
    const preferred = String(config.provider || config.api || "lulu").toLowerCase()
    const order = preferred === "plao" ? ["plao", "lulu"] : ["lulu", "plao"]

    for (const name of order) {
      const token = tokenFor(config, name)
      if (!token) continue
      const result = await this.solveWith(name, token, challenge, config, context)
      if (result.ok) return result
      // 单一服务失败 → 尝试另一个（与 ji 的 lulu 失败回退 plao 一致）
    }

    return captchaFail(this.name, "all_tokens_failed", {
      retryable: true,
      costMs: Date.now() - started,
    })
  },

  async solveWith(name, token, challenge, config = {}, context = {}) {
    const started = Date.now()
    const baseUrl = baseUrlFor(config, name)
    const path = name === "lulu" ? "/geetest" : "/validate/get"
    const url = withQuery(baseUrl + path, {
      token,
      gt: challenge.gt,
      challenge: challenge.challenge,
    })

    try {
      const res = await requestJson(url, {
        method: "GET",
        timeoutMs: Number(config.timeout_ms || 15000),
      }, context)

      const validate = extractValidate(res)
      const challengeValue = extractChallenge(res) || challenge.challenge
      if (!validate) {
        return captchaFail(this.name, "validate_empty", {
          retryable: true,
          costMs: Date.now() - started,
          raw: res,
        })
      }

      return captchaOk(this.name, {
        validate,
        challenge: challengeValue,
        costMs: Date.now() - started,
        raw: res,
      })
    } catch (error) {
      return captchaFail(this.name, error.message || "request_failed", {
        retryable: true,
        costMs: Date.now() - started,
      })
    }
  },

  // 次数查询（供 #验证码次数 命令用）
  async queryTimes(config = {}, context = {}) {
    const out = { lulu: null, plao: null }
    for (const name of ["lulu", "plao"]) {
      const token = tokenFor(config, name)
      if (!token) { out[name] = { configured: false }; continue }
      const baseUrl = baseUrlFor(config, name)
      const path = name === "lulu" ? "/token" : "/validate/get"
      try {
        const res = await requestJson(withQuery(baseUrl + path, { token }), {
          method: "GET",
          timeoutMs: Number(config.timeout_ms || 15000),
        }, context)
        out[name] = { configured: true, raw: res, times: extractTimes(res) }
      } catch (error) {
        out[name] = { configured: true, error: error.message }
      }
    }
    return out
  },
}

function luluToken(config = {}) {
  return String(config.lulu_token || config.lulu?.token || "").trim()
}

function plaoToken(config = {}) {
  return String(config.plao_token || config.plao?.token || "").trim()
}

function tokenFor(config = {}, name = "lulu") {
  return name === "lulu" ? luluToken(config) : plaoToken(config)
}

function baseUrlFor(config = {}, name = "lulu") {
  if (name === "lulu") {
    return String(config.lulu_url || config.lulu?.url || DEFAULT_LULU_URL).replace(/\/+$/, "")
  }
  return String(config.plao_url || config.plao?.url || DEFAULT_PLAO_URL).replace(/\/+$/, "")
}

function extractValidate(data) {
  if (!data || typeof data !== "object") return ""
  if (typeof data.validate === "string") return data.validate
  if (typeof data.data?.validate === "string") return data.data.validate
  if (typeof data.data?.geetest_validate === "string") return data.data.geetest_validate
  if (typeof data.data?.challenge?.validate === "string") return data.data.challenge.validate
  return ""
}

function extractChallenge(data) {
  return data?.challenge
    || data?.data?.challenge
    || data?.data?.geetest_challenge
    || ""
}

function extractTimes(data) {
  if (!data || typeof data !== "object") return null
  const times = data.times ?? data.data?.times ?? data.remaining ?? data.data?.remaining
  return Number.isFinite(Number(times)) ? Number(times) : null
}
