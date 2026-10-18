const BasePlugin = globalThis.plugin

import { LOTUS_INTERCEPT_PRIORITY } from "../core/intercept/priority.js"
import { renderStatusCard, renderTemplate } from "../core/render/service.js"
import { replyImage, replyText } from "../core/transport/reply.js"
import {
  loadConfig,
  saveStatus,
  loadStatus,
  loadAccounts,
  addAccount,
  removeAccount,
  enabledGames,
  matchGames,
  hasProfile,
  runLogin,
  runCheckin,
  runDiscover,
  getStatus,
  setAutoCheckin,
  formatResults,
  pushToGroups,
  pushToMaster,
} from "../services/taptap/service.js"

const AUTO_CHECKIN_CRON = "0 15 0 * * ? *" // 每日 00:15（与荷花主签到一致）

/** 把签到结果转成 tap-checkin 模板所需结构 */
function toCardResults(results) {
  return results.map((r) => {
    let status
    let detail = ""
    if (r.ok && !r.already) {
      status = "signed"
      detail = r.message || ""
    } else if (r.ok && r.already) {
      status = "already_signed"
    } else if (r.reason === "not_logged_in") {
      status = "not_logged_in"
    } else if (["no_event", "no_record", "no_sign_button"].includes(r.reason)) {
      status = "no_event"
    } else {
      status = "failed"
      detail = r.reason || r.message || ""
    }
    return { name: r.game, status, detail }
  })
}

export class LotusTapTap extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] TapTap 签到",
      dsc: "TapTap 原神/崩铁/绝区零 game-sign 网页签到（仅三游戏）",
      event: "message",
      priority: LOTUS_INTERCEPT_PRIORITY,
      rule: [
        { reg: "^#ta帮助$", fnc: "help" },
        { reg: "^#ta登录$", fnc: "login" },
        { reg: "^#ta活动(\\s+强制)?$", fnc: "discover" },
        { reg: "^#ta签到(\\s+.+)?$", fnc: "checkin" },
        { reg: "^#ta状态$", fnc: "status" },
        { reg: "^#(开启|关闭)ta自动签到$", fnc: "toggleAuto" },
        { reg: "^#ta$", fnc: "status" },
      ],
    })
    const cfg = loadConfig()
    this.task = [
      {
        name: "荷花插件 TapTap 每日自动签到",
        cron: cfg.checkin_cron || AUTO_CHECKIN_CRON,
        fnc: this.autoCheckinTask.bind(this),
        log: false,
      },
    ]
  }

  async help() {
    const lines = [
      "TapTap 游戏签到帮助（仅 原神 / 崩坏：星穹铁道 / 绝区零）",
      "",
      "#ta登录  打开浏览器登录 TapTap（首次必须，登录态长期保存）",
      "#ta签到  立即签到全部启用的游戏（可加游戏名限定，如 #ta签到 原神）",
      "#ta活动  自动发现各游戏当前进行中的签到活动（加“强制”重新发现）",
      "#ta状态  查看登录态与各游戏上次签到结果",
      "#开启|关闭ta自动签到  开关每日定时签到",
      "#ta帮助  本帮助",
      "",
      "说明：",
      "1. 首次使用必须先 #ta登录（弹出可见浏览器，扫码或账号登录后自动保存）。",
      "2. 活动 id 每版本轮换，插件自动发现，无需手填；异常可在 data/taptap/config.yaml 用 event_override 指定。",
      "3. 定时签到默认每日 00:15（与荷花主签到一致），带随机延迟。修改 data/taptap/config.yaml 后需重启 Yunzai。",
    ]
    await replyText(this, lines.join("\n"))
    return true
  }

  async login() {
    const uid = String(this.e.user_id)
    if (!hasProfile(uid)) {
      await replyText(this, "[荷花插件]正在打开浏览器，请登录 TapTap（扫码或账号登录）…\n登录成功后会自动关闭窗口。")
    } else {
      await replyText(this, "[荷花插件]正在打开浏览器校验登录态…（如已登录会自动关闭）")
    }
    let r
    try {
      r = await runLogin(uid, loadConfig().login_timeout_min || 5)
    } catch (e) {
      await replyText(this, `[荷花插件]TapTap 登录失败：${e.message}`)
      return true
    }
    const status = loadStatus(uid)
    status.login = { lastCheck: Date.now(), ok: !!r.ok }
    saveStatus(uid, status)
    if (r.ok) {
      addAccount(uid)
      await replyText(this, "[荷花插件]TapTap 登录成功，登录态已保存（仅绑定到你的账号），后续自动签到无需再次登录。")
    } else {
      await replyText(this, "[荷花插件]登录超时（5 分钟）。请重新 #ta登录 并在窗口内完成登录。")
    }
    return true
  }

  async discover() {
    const uid = String(this.e.user_id)
    const force = /强制/.test(this.e.msg || "")
    await replyText(this, "[荷花插件]正在自动发现各游戏当前进行中的签到活动…（可能需要十余秒）")
    const cfg = loadConfig()
    const status = loadStatus(uid)
    let found
    try {
      found = await runDiscover(uid, cfg, status, force)
    } catch (e) {
      await replyText(this, `[荷花插件]发现活动出错：${e.message}`)
      return true
    }
    const lines = ["【TapTap 签到活动发现结果】"]
    for (const f of found) {
      if (f.id) {
        lines.push(`· ${f.game}：活动 ${f.id}（来源 ${f.source}${f.active === false ? "，未验证进行中" : ""}）`)
      } else {
        lines.push(`· ${f.game}：未发现进行中的活动${f.error ? `（${f.error}）` : ""}`)
      }
      if (f.candidates && f.candidates.length) {
        for (const c of f.candidates.slice(0, 5)) {
          lines.push(`   候选：${c.id}  ${c.text || ""}`)
        }
      }
    }
    lines.push("")
    lines.push("如自动发现不准确，可编辑 data/taptap/config.yaml 的 event_override.<游戏key> 手动指定活动 id。")
    await replyText(this, lines.join("\n"))
    return true
  }

  async checkin() {
    const uid = String(this.e.user_id)
    if (!hasProfile(uid)) {
      await replyText(this, "[荷花插件]尚未登录 TapTap，请先 #ta登录。")
      return true
    }
    const kw = String(this.e.msg || "").replace(/^#ta签到\s*/, "").trim()
    const games = matchGames(loadConfig(), kw)
    if (!games.length) {
      await replyText(this, "[荷花插件]没有启用的游戏，请检查 data/taptap/config.yaml。")
      return true
    }
    await replyText(this, `[荷花插件]正在签到：${games.map((g) => g.name).join("、")} …`)
    const status = loadStatus(uid)
    let results
    try {
      results = await runCheckin(uid, games, loadConfig(), status)
    } catch (e) {
      await replyText(this, `[荷花插件]签到执行出错：${e.message}`)
      return true
    }
    const signed = results.filter((r) => r.ok && !r.already).length
    const already = results.filter((r) => r.ok && r.already).length
    const failed = results.filter((r) => !r.ok).length
    const cardResults = toCardResults(results)
    const image = await renderTemplate(
      "tap-checkin",
      {
        title: "TapTap 签到",
        subtitle: `签到 ${signed + already}/${results.length}`,
        message: `共 ${results.length} 个游戏：成功 ${signed}，已签 ${already}，失败 ${failed}。`,
        result: { total: results.length, signed, already, failed, results: cardResults },
      },
      { saveId: `lotus-taptap-checkin-${Date.now()}` }
    ).catch(() => null)
    await replyImage(this, image, formatResults(results))
    return true
  }

  async status() {
    const uid = String(this.e.user_id)
    const cfg = loadConfig()
    const status = loadStatus(uid)
    const s = getStatus(uid, cfg, status)
    const items = s.games.map((g) => {
      let lastStr = "未签到"
      if (g.last) {
        const t = g.last.at ? new Date(g.last.at).toLocaleString("zh-CN") : ""
        if (g.last.ok) lastStr = `${g.last.already ? "已签" : "成功"}（${t}）`
        else lastStr = `失败(${g.last.reason})（${t}）`
      }
      return {
        label: g.name,
        value: `${lastStr}${g.event ? `｜活动 ${g.event.id}` : ""}`,
      }
    })
    const image = await renderStatusCard(
      {
        title: "TapTap 签到状态",
        subtitle: "状态查询",
        badge: s.login ? "已登录" : "未登录",
        message: s.login
          ? "已保存 TapTap 登录态，可直接签到。"
          : "尚未登录 TapTap，请先 #ta登录（弹出浏览器扫码/账号登录）。",
        items,
      },
      { saveId: "lotus-taptap-status" }
    ).catch(() => null)
    if (image) {
      await replyImage(this, image, "[荷花插件]TapTap 签到状态已查询。")
    } else {
      const lines = ["【TapTap 签到状态】", `登录态：${s.login ? "已登录" : "未登录"}`, `自动签到：${s.autoCheckin ? "开启" : "关闭"}（${s.cron}）`]
      for (const g of s.games) {
        let lastStr = "未签到"
        if (g.last) {
          if (g.last.ok) lastStr = `${g.last.already ? "已签" : "成功"}`
          else lastStr = `失败(${g.last.reason})`
        }
        lines.push(`· ${g.name}：上次 ${lastStr}${g.event ? `｜活动 ${g.event.id}` : ""}`)
      }
      await replyText(this, lines.join("\n"))
    }
    return true
  }

  async toggleAuto() {
    const enable = /^#开启/.test(this.e.msg || "")
    const auto = setAutoCheckin(enable)
    await replyText(this, `[荷花插件]TapTap 每日自动签到已${auto ? "开启" : "关闭"}。修改将于重启 Yunzai 后生效。`)
    return true
  }

  /** 每日定时自动签到：遍历所有已绑定账号，各签各的 */
  async autoCheckinTask() {
    const cfg = loadConfig()
    if (!cfg.auto_checkin) return
    const accounts = loadAccounts()
    if (!accounts.length) {
      logger?.warn?.("[Lotus-Plugin] TapTap 无已绑定账号，跳过自动签到。")
      return
    }
    const [lo, hi] = [cfg.random_delay_min || 0, cfg.random_delay_max || 0]
    if (hi > lo) {
      const d = Math.floor(Math.random() * (hi - lo + 1) + lo)
      if (d > 0) await new Promise((r) => setTimeout(r, d * 60 * 1000))
    }
    for (const account of accounts) {
      const uid = String(account.user_id)
      if (!hasProfile(uid)) {
        logger?.warn?.(`[Lotus-Plugin] TapTap 账号 ${uid} 无登录态，跳过。`)
        continue
      }
      const games = enabledGames(cfg)
      const status = loadStatus(uid)
      let results
      try {
        results = await runCheckin(uid, games, cfg, status)
      } catch (e) {
        logger?.error?.(`[Lotus-Plugin] TapTap 自动签到 ${uid} 出错：${e.message}`)
        continue
      }
      const text = formatResults(results)
      const signed = results.filter((r) => r.ok && !r.already).length
      const already = results.filter((r) => r.ok && r.already).length
      const failed = results.filter((r) => !r.ok).length
      const image = await renderTemplate(
        "tap-checkin",
        {
          title: "TapTap 签到",
          subtitle: `账号 ${uid}｜签到 ${signed + already}/${results.length}`,
          message: `共 ${results.length} 个游戏：成功 ${signed}，已签 ${already}，失败 ${failed}。`,
          result: { total: results.length, signed, already, failed, results: toCardResults(results) },
        },
        { saveId: `lotus-taptap-checkin-auto-${uid}-${Date.now()}` }
      ).catch(() => null)
      logger?.mark?.(`[Lotus-Plugin] TapTap 自动签到（账号 ${uid}）完成\n${text}`)
      // 发结果：优先配置的群；始终再私聊推给 BOT主人（对齐荷花主签到汇总看板，常开监控通道）
      await pushToGroups(text, cfg.push_groups, image)
      await pushToMaster(text, image)
    }
  }
}
