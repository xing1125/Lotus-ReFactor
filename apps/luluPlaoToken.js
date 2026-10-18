const BasePlugin = globalThis.plugin

// lulu/plao 付费 token 管理命令（移植自 ji-plugin apps/token.js）
//
// 命令（仅 bot 主人可用，走私聊注入更安全）：
//   #注入lulutk <token> / #注入plaotk <token>   写入并切换到对应 token
//   #切换lulutk [token] / #切换plaotk [token]   切换到已注入的 token（可顺带更新）
//   #验证码次数查询                               查询 lulu/plao 剩余次数
//
// token 持久化到 global.yaml 的 captcha.lulu_plao.{lulu_token,plao_token}。
import { loadGlobalConfig, saveGlobalConfig } from "../core/config/global.js"
import { PermissionService } from "../core/permissions/service.js"
import { replyText } from "../core/transport/reply.js"
import { luluPlaoProvider } from "../core/captcha/providers/luluPlao.js"

const INJECT_RE = /^#注入(lulu|plao)tk\s*(\S*)$/i
const SWITCH_RE = /^#切换(lulu|plao)tk\s*(\S*)$/i
const TIMES_RE = /^#验证码(剩余|使用)?(次数)?查询$/

export class LotusLuluPlaoToken extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Lulu/Plao Token",
      dsc: "lulu/plao 外部验证码 token 管理",
      event: "message",
      priority: 20,
      rule: [
        { reg: "^#注入(lulu|plao)tk\\s*\\S*$", fnc: "inject" },
        { reg: "^#切换(lulu|plao)tk(\\s*\\S*)?$", fnc: "switchToken" },
        { reg: "^#(yzm|验证码)(剩余|使用)?(次数)?查询$", fnc: "queryTimes" },
      ],
    })
  }

  async inject() {
    return this.handleToken(true)
  }

  async switchToken() {
    return this.handleToken(false)
  }

  async handleToken(inject) {
    const globalConfig = await loadGlobalConfig()
    const permission = new PermissionService({ permissions: globalConfig.permissions })
      .explain(this.e, "captcha.manage")
    if (!permission.ok) {
      await replyText(this, "[荷花插件]只有 bot 主人可以注入/切换验证码 token。")
      return true
    }

    const msg = String(this.e.msg || "")
    const match = msg.match(inject ? INJECT_RE : SWITCH_RE)
    const type = (match?.[1] || "").toLowerCase()
    const token = (match?.[2] || "").trim()

    if (!["lulu", "plao"].includes(type)) {
      await replyText(this, "[荷花插件]token 类型必须是 lulu 或 plao。")
      return true
    }

    const lp = globalConfig.captcha?.lulu_plao || {}
    const key = `${type}_token`

    if (inject) {
      if (!token) {
        await replyText(this, "[荷花插件]请一同输入 token，如「#注入lulutk xxxxx」。")
        return true
      }
      lp[key] = token
      lp.provider = type
    } else {
      if (token) {
        lp[key] = token
      }
      if (!lp[key]) {
        await replyText(this, `[荷花插件]尚未注入 ${type} 的 token，请先「#注入${type}tk <token>」。`)
        return true
      }
      lp.provider = type
    }

    lp.enable = Boolean(lp.lulu_token || lp.plao_token)
    globalConfig.captcha.lulu_plao = lp
    await saveGlobalConfig(globalConfig)

    await replyText(this, `[荷花插件]${inject ? "注入" : "切换"}成功，当前使用 token：${type}${inject ? "（已保存）" : ""}。`)
    return true
  }

  async queryTimes() {
    const globalConfig = await loadGlobalConfig()
    const permission = new PermissionService({ permissions: globalConfig.permissions })
      .explain(this.e, "captcha.manage")
    if (!permission.ok) {
      await replyText(this, "[荷花插件]只有 bot 主人可以查询验证码 token 次数。")
      return true
    }

    const lp = globalConfig.captcha?.lulu_plao || {}
    if (!lp.lulu_token && !lp.plao_token) {
      await replyText(this, "[荷花插件]尚未注入任何 token，请先「#注入lulutk <token>」或「#注入plaotk <token>」。")
      return true
    }

    const result = await luluPlaoProvider.queryTimes(lp)
    const lines = ["【验证码次数查询】"]
    for (const name of ["lulu", "plao"]) {
      const info = result[name]
      const mark = lp.provider === name ? " ☑" : ""
      if (!info?.configured) continue
      if (info.error) {
        lines.push(`token：${name}${mark}\n查询失败：${info.error}`)
      } else if (info.times === null) {
        lines.push(`token：${name}${mark}\n查询失败：接口未返回剩余次数`)
      } else {
        lines.push(`token：${name}${mark}\n剩余次数：${Math.abs(info.times)}`)
      }
    }
    await replyText(this, `[荷花插件]${lines.join("\n")}`)
    return true
  }
}
