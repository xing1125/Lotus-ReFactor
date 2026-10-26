const BasePlugin = globalThis.plugin
import { accountDisplay } from "../services/checkin/account.js"

import { LOTUS_INTERCEPT_PRIORITY } from "../core/intercept/priority.js"
import {
  parseProfileIdFromMessage,
  PROFILE_ID_SUFFIX_PATTERN,
  listProfileIds,
  loadProfile,
} from "../core/config/profile.js"
import { renderTemplate } from "../core/render/service.js"
import { DAILY_NOTE_ICONS } from "../core/render/daily-note.js"
import { replyImage, replyText } from "../core/transport/reply.js"
import {
  DailyNoteService,
  dailyNoteGameName,
} from "../services/dailyNote/service.js"
import { ResinPushService, RESIN_GAME_NAME } from "../services/dailyNote/push.js"

// collect 内部要走 profile 读取 + 跨插件 import + 米游社请求，
// 任何一环不结算都会让命令永久静默，所以必须有一道硬超时兜底。
// 上限里包含了打码预算（单次过码 90s），遇到验证码的账号整体查询会明显变慢。
const DAILY_NOTE_DEADLINE_MS = 150000
// 渲染 / 发送的独立上限。单张卡片正常 1~2s，超过这个值就是真卡住了，
// 继续等只会让用户永远收不到回复。
const RENDER_DEADLINE_MS = 20000
const SEND_DEADLINE_MS = 12000

function withDeadline(promise, ms, label) {
  return new Promise((resolve, reject) => {
    // 注意：不要 unref，否则进程没有其它 handle 时定时器不触发。
    const timer = setTimeout(() => {
      reject(new Error(`${label} 超时（${ms}ms 未返回）`))
    }, ms)
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

const RESIN_PUSH_ENABLE_RE = /^#?(原神|星铁|绝区零)?开启体力推送(?:\s*(\d+))?$/
const RESIN_PUSH_DISABLE_RE = /^#?(原神|星铁|绝区零)?关闭体力推送(?:\s*(\d+))?$/
const RESIN_PUSH_THRESHOLD_RE = /^#?(原神|星铁|绝区零)?体力推送阈值\s*(\d+)$/

export class LotusDailyNote extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Daily Note",
      dsc: "Lotus profile aware daily note",
      event: "message",
      priority: LOTUS_INTERCEPT_PRIORITY,
      rule: [
        {
          reg: `^#全部体力${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "allDailyNote",
        },
        {
          reg: `^#?(多|全|全部)(体力|开拓力|树脂|查询体力|便笺|便签)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "allDailyNote",
        },
        {
          reg: `^#体力${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "allDailyNote",
        },
        {
          // 裸「体力/便笺」等 = jj 模式：原神 + 星铁 + 绝区零 一起出
          reg: `^#?(体力|树脂|查询体力|便笺|便签)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "allDailyNote",
        },
        {
          reg: `^#原神(体力|树脂|便笺|便签)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "genshinDailyNote",
        },
        {
          reg: `^\\*体力${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "starRailDailyNote",
        },
        {
          reg: `^#?(星铁|崩铁)(体力|开拓力|便笺|便签)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "starRailDailyNote",
        },
        {
          reg: `^#?开拓力${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "starRailDailyNote",
        },
        {
          reg: `^%体力${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "zzzDailyNote",
        },
        {
          reg: `^#(绝区零|绝)(体力|便笺|便签)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "zzzDailyNote",
        },
        {
          reg: "^#?(原神|星铁|绝区零)?开启体力推送(\\s*\\d+)?$",
          fnc: "enableResinPush",
        },
        {
          reg: "^#?(原神|星铁|绝区零)?关闭体力推送(\\s*\\d+)?$",
          fnc: "disableResinPush",
        },
        {
          reg: "^#?(原神|星铁|绝区零)?体力推送阈值\\s*\\d+$",
          fnc: "setResinThreshold",
        },
      ],
    })
  }

  async init() {
    // 体力推送定时扫描：cron 可经 global.yaml 的 resin_push.cron 覆盖（缺省每 10 分钟）。
    try {
      const { loadGlobalConfig } = await import("../core/config/global.js")
      const cfg = await loadGlobalConfig().catch(() => ({}))
      const cron = cfg?.resin_push?.cron || "0 */10 * * * ? *"
      this.task = [{
        name: "荷花插件体力推送扫描",
        cron,
        fnc: this.runResinPush.bind(this),
        log: false,
      }]
    } catch (error) {
      logger?.warn?.(`[Lotus-Plugin] load resin push cron failed: ${error.message}`)
    }
  }

  async runResinPush() {
    try {
      const { loadGlobalConfig } = await import("../core/config/global.js")
      const cfg = await loadGlobalConfig().catch(() => ({}))
      if (cfg?.resin_push?.enable === false) {
        return { pushed: 0, scanned: 0, disabled: true }
      }
      const result = await new ResinPushService().runPush({ bot: globalThis.Bot })
      if (result.pushed) {
        logger?.mark?.(`[Lotus-Plugin] resin push sent: ${result.pushed}/${result.scanned}`)
      }
      return result
    } catch (error) {
      logger?.warn?.(`[Lotus-Plugin] resin push scan failed: ${error.message}`)
      return { pushed: 0, scanned: 0, error: error.message }
    }
  }

  async enableResinPush() {
    return this.handleResinPushToggle(true)
  }

  async disableResinPush() {
    return this.handleResinPushToggle(false)
  }

  async setResinThreshold() {
    const game = this.parseGame(this.e.msg)
    const match = this.e.msg.match(RESIN_PUSH_THRESHOLD_RE)
    const threshold = Number(match?.[2])
    if (!threshold) {
      await replyText(this, "请输入体力推送阈值，如「#体力推送阈值 160」。")
      return true
    }
    const min = game === "gs" ? 80 : 120
    if (threshold < min) {
      await replyText(this, `${RESIN_GAME_NAME[game] || "该游戏"}体力推送阈值不可小于【${min}】。`)
      return true
    }

    const botId = String(this.e.self_id || globalThis.Bot?.uin || "default")
    const userId = String(this.e.user_id)
    const groupId = String(this.e.isGroup ? this.e.group_id : "private")
    const service = new ResinPushService()
    const block = await service.loadPushConfig()
    if (!block[botId]?.[userId]?.[groupId]) {
      await replyText(this, "你还没有开启体力推送哦，请先「#开启体力推送」。")
      return true
    }
    await service.setThreshold({ botId, userId, groupId, game, threshold })
    await replyText(this, `${RESIN_GAME_NAME[game]}体力推送阈值已设为【${threshold}】。`)
    return true
  }

  async handleResinPushToggle(enable) {
    const game = this.parseGame(this.e.msg)
    const match = this.e.msg.match(enable ? RESIN_PUSH_ENABLE_RE : RESIN_PUSH_DISABLE_RE)
    const uidInput = match?.[2]
    const gameName = RESIN_GAME_NAME[game]

    const botId = String(this.e.self_id || globalThis.Bot?.uin || "default")
    const userId = String(this.e.user_id)
    const groupId = String(this.e.isGroup ? this.e.group_id : "private")

    // 收集该用户该游戏的所有已同步 UID
    const profileIds = await listProfileIds(userId).catch(() => [])
    const uids = new Set()
    for (const profileId of profileIds) {
      const profile = await loadProfile(userId, profileId).catch(() => null)
      const roles = normalizeRoles(profile?.account?.game_roles?.[game])
      for (const role of roles) uids.add(String(role.uid || role.game_uid || role))
    }
    if (!uids.size) {
      await replyText(this, `未查询到 ${gameName} 的已同步 UID，请先扫码登录并同步。`)
      return true
    }

    const targets = uidInput ? [uidInput] : [...uids]
    if (uidInput && !uids.has(uidInput)) {
      await replyText(this, `只能操作自己已同步的 ${gameName} UID（当前有：${[...uids].join("、")}）。`)
      return true
    }

    const service = new ResinPushService()
    const lines = []
    for (const uid of targets) {
      if (enable) {
        await service.enable({ botId, userId, groupId, game, uid })
        lines.push(`已开启 ${gameName} UID:${uid} 体力推送`)
      } else {
        const { removed } = await service.disable({ botId, userId, groupId, game, uid })
        lines.push(removed
          ? `已关闭 ${gameName} UID:${uid} 体力推送`
          : `${gameName} UID:${uid} 未在本群开启体力推送`)
      }
    }
    await replyText(this, `${lines.join("\n")}`)
    return true
  }

  parseGame(msg = "") {
    if (msg.includes("星铁")) return "sr"
    if (msg.includes("绝区零")) return "zzz"
    return "gs"
  }

  async allDailyNote() {
    return this.replyDailyNote(["gs", "sr", "zzz"])
  }

  async genshinDailyNote() {
    return this.replyDailyNote(["gs"])
  }

  async starRailDailyNote() {
    return this.replyDailyNote(["sr"])
  }

  async zzzDailyNote() {
    return this.replyDailyNote(["zzz"])
  }

  async replyDailyNote(games) {
    const userId = String(this.e.user_id)
    const hasSuffix = /\d+$/.test(String(this.e.msg || ""))
    const profileId = hasSuffix ? parseProfileIdFromMessage(this.e.msg) : null

    // jj 短格式：单条 @ 等待提示（不带 UID），@ 全程只出现这一次
    await replyText(this, "查询中请稍等", { at: true })

    const service = new DailyNoteService()
    const started = Date.now()
    let results
    try {
      // 必须带硬超时：collect 内部会 await 跨插件 import + 米游社请求，
      // 任一环节不结算就会「回了提示语然后永久静默」，线上已经踩过。
      results = await withDeadline(
        service.collect({
          qq: userId,
          profileId,
          games,
          // 过码过程不再发到群里（用户反馈刷屏）：底层照常打码，事件只进日志。
          onCaptchaEvent: async event => {
            if (event?.type) globalThis.logger?.mark?.(`[Lotus-Plugin] dailyNote captcha event: ${event.type}`)
          },
        }),
        DAILY_NOTE_DEADLINE_MS,
        "dailyNote collect",
      )
    } catch (error) {
      globalThis.logger?.error?.(
        `[Lotus-Plugin] dailyNote collect failed after ${Date.now() - started}ms: ${error?.stack || error?.message}`,
      )
      await replyText(this, `体力查询失败：${error?.message || "未知错误"}`, { at: true })
      return true
    }
    globalThis.logger?.mark?.(
      `[Lotus-Plugin] dailyNote collect done ${Date.now() - started}ms, ${results?.length || 0} 条`,
    )

    if (!results.length) {
      await replyText(this, "没有找到可查询的账号，请先 #扫码登录 并同步 UID。")
      return true
    }

    const okResults = results.filter(item => item?.ok)
    // 失败项必须留痕：之前这里只统计数量，P2 因 5003/1034 被静默丢弃，
    // 用户只看到另一个账号的卡，误以为「账号只剩一个」。
    const failedResults = results.filter(item => !item?.ok)
    const failureLines = failedResults.map(describeDailyNoteFailure)
    if (failedResults.length) {
      globalThis.logger?.warn?.(
        `[Lotus-Plugin] dailyNote 失败 ${failedResults.length}/${results.length}：${failureLines.join(" | ")}`,
      )
    }
    if (!okResults.length) {
      await replyText(this, `体力查询失败：\n${failureLines.join("\n") || "未知错误"}`, { at: true })
      return true
    }

    // jj 出图格式：每个游戏/账号各一张独立面板，逐张发送，不带文字、不再 @、不带插件前缀。
    // 渲染和发送也必须各自带 deadline：模板内部会去拉头像/图标等外部资源，
    // 本进程的 undici body 流挂死时那次 fetch 永不结算，卡在这里就等于
    // 「查到数据了却永远不出图」——线上已复现（collect 成功 1543ms 后 60s 无日志）。
    let sent = 0
    for (const [index, item] of okResults.entries()) {
      try {
        const image = await withDeadline(
          renderTemplate("daily-note-summary", buildDailyNoteRenderData({
            userId,
            profileId,
            games,
            results: [item],
          }), {
            saveId: `lotus-daily-note-${userId}-${profileId || "all"}-${item.game}-${item.uid || index}`,
          }),
          RENDER_DEADLINE_MS,
          `${item.game || "体力"} 卡片渲染`,
        )
        await withDeadline(replyImage(this, image, ""), SEND_DEADLINE_MS, `${item.game || "体力"} 卡片发送`)
        sent += 1
      } catch (error) {
        globalThis.logger?.error?.(
          `[Lotus-Plugin] dailyNote render/send failed (${item.game || "-"}/${item.uid || "-"}): ${error?.message}`,
        )
        await replyText(
          this,
          `体力面板生成失败（${item.game || "未知"}${item.uid ? ` ${item.uid}` : ""}）：${error?.message || "未知错误"}`,
          { at: true },
        ).catch(() => {})
      }
      // 多张卡之间稍作间隔，避免刷屏风控
      if (okResults.length > 1 && index < okResults.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 800))
      }
    }
    globalThis.logger?.mark?.(`[Lotus-Plugin] dailyNote rendered ${sent}/${okResults.length} 张`)

    // 部分失败要明确回一条文字：出图成功不代表所有账号都查到了。
    if (failedResults.length) {
      await replyText(
        this,
        `以下 ${failedResults.length} 项没查到（其余已出图）：\n${failureLines.join("\n")}`,
        { at: true },
      ).catch(() => {})
    }
    return true
  }
}

// 体力失败话术：retcode 决定用户该做什么，别把空的 message 直接抛给用户。
function describeDailyNoteFailure(item = {}) {
  const profileId = item.profileId || 1
  const game = dailyNoteGameName(item.game) || "账号"
  const where = `P${profileId} ${game}${item.uid ? ` ${item.uid}` : ""}`
  const code = Number(item?.raw?.retcode)
  if (code === 5003) {
    return `${where}：米游社风控拦截（该档案没有可用设备时最常见），先用这个号在手机米游社里打开一次「原神 → 体力」，或 #绑定设备${profileId}`
  }
  if (code === 1034) {
    return `${where}：账号与设备需要验证，自动过码未通过；用这个号在手机米游社里打开一次「原神 → 体力」即可解除`
  }
  if (code === 10001 || code === -100 || code === 10101) {
    return `${where}：CK 已失效，请 #扫码登录 重新绑定`
  }
  return `${where}：${item.error || "查询失败"}`
}

const WEEK = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]

function normalizeRoles(roles = []) {
  if (!Array.isArray(roles)) return []
  return roles
    .map(role => typeof role === "object" ? role : { uid: role })
    .filter(role => role.uid || role.game_uid)
}

function pad2(value) {
  return String(value).padStart(2, "0")
}

// 与上游 dailyNote 的 dayMb2 同构：yyyy年MM月DD日 HH:mm + 星期
function formatStamp(date = new Date()) {
  return `${date.getFullYear()}年${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日 `
    + `${pad2(date.getHours())}:${pad2(date.getMinutes())} ${WEEK[date.getDay()]}`
}

// 「距回满还有 N 秒」→ 上游同款「今天 / 明天 + 时段 + hh:mm」。
// 时段前缀沿用上游 dateTime_()：<6 凌晨 /<12 上午 /<17.5 下午 /<19.5 傍晚 /<22 晚上 /否则 深夜。
function recoverInfo(seconds) {
  const total = Number(seconds || 0)
  if (!(total > 0)) return null
  const now = new Date()
  const target = new Date(Date.now() + total * 1000)
  const sameDay = target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth() && target.getDate() === now.getDate()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const isTomorrow = target.getFullYear() === tomorrow.getFullYear() && target.getMonth() === tomorrow.getMonth() && target.getDate() === tomorrow.getDate()
  const day = sameDay ? "今天" : isTomorrow ? "明天" : `${target.getMonth() + 1}月${target.getDate()}日`
  const hour = target.getHours()
  const prefix = hour < 6 ? "凌晨" : hour < 12 ? "上午" : hour < 17.5 ? "下午" : hour < 19.5 ? "傍晚" : hour < 22 ? "晚上" : "深夜"
  const hour12 = hour % 12 || 12
  return { day, time: `${prefix}${pad2(hour12)}:${pad2(target.getMinutes())}` }
}

const num = (value, fallback = "—") => (value === undefined || value === null || value === "" ? fallback : Number(value))

// 原神：原粹树脂 + 洞天财瓮 / 每日委托 / 探索派遣 + 派遣头像
function genshinPanel(data = {}) {
  const icon = DAILY_NOTE_ICONS.gs
  const coinAwarded = data.is_extra_task_reward_received === true || data.is_extra_task_reward_received === 1
  return {
    logo: icon.logo,
    primary: {
      label: "原粹树脂",
      current: num(data.current_resin),
      max: num(data.max_resin),
      icon: icon.primary,
      recover: recoverInfo(data.resin_recovery_time),
    },
    rows: [
      { icon: icon.coin, label: "洞天财瓮", value: num(data.current_home_coin), max: num(data.max_home_coin) },
      coinAwarded
        ? { icon: icon.daily, label: "每日委托", value: "已全部领取" }
        : { icon: icon.daily, label: "每日委托", value: num(data.finished_task_num), max: num(data.total_task_num), warn: Number(data.finished_task_num || 0) < Number(data.total_task_num || 0) },
      { icon: icon.expedition, label: "探索派遣", value: num(data.current_expedition_num), max: num(data.max_expedition_num) },
    ],
    footer: {
      label: "尚未进行探索派遣",
      items: (Array.isArray(data.expeditions) ? data.expeditions : []).map(item => ({
        icon: item?.avatar_side_icon || item?.avatar_icon || "",
        done: String(item?.status || "") !== "Ongoing",
      })),
    },
  }
}

// 星铁：开拓力 + 后备开拓力 + 每日实训 / 模拟宇宙 / 委托执行 + 委托头像
function starRailPanel(data = {}) {
  const icon = DAILY_NOTE_ICONS.sr
  const accepted = data.accepted_expedition_num ?? data.accepted_epedition_num ?? data.current_expedition_num ?? 0
  const reserve = data.current_reserve_stamina
  const items = []
  for (const expedition of Array.isArray(data.expeditions) ? data.expeditions : []) {
    for (const avatar of expedition?.avatars || []) {
      items.push({ icon: typeof avatar === "string" ? avatar : avatar?.icon || "", done: String(expedition?.status || "") === "Finished" })
    }
  }
  return {
    logo: icon.logo,
    primary: {
      label: "开拓力",
      current: num(data.current_stamina),
      max: num(data.max_stamina),
      icon: icon.primary,
      recover: recoverInfo(data.stamina_recover_time),
    },
    reserve: reserve === undefined || reserve === null ? null : String(reserve),
    rows: [
      { icon: icon.train, label: "每日实训", value: num(data.current_train_score), max: num(data.max_train_score), warn: Number(data.current_train_score || 0) !== Number(data.max_train_score || 0) },
      { icon: icon.sim, label: "模拟宇宙", value: num(data.current_rogue_score), max: num(data.max_rogue_score) },
      { icon: icon.expedition, label: "委托执行", value: num(accepted), max: num(data.total_expedition_num), warn: Number(accepted || 0) === 0 },
    ],
    footer: { label: "尚未进行委托执行", items },
  }
}

// 绝区零：电量 + 活跃度 / 刮刮卡 / 录像店（上游无派遣区）
function zzzPanel(data = {}) {
  const icon = DAILY_NOTE_ICONS.zzz
  const energy = data.energy?.progress || data.energy || {}
  const vitality = data.vitality || {}
  const saleState = data.vhs_sale?.sale_state || data.vhs_sale?.status || ""
  const cardSign = data.card_sign
  return {
    logo: icon.logo,
    primary: {
      label: "电量",
      current: num(energy.current),
      max: num(energy.max),
      icon: icon.primary,
      recover: recoverInfo(data.energy?.restore ?? energy.restore),
    },
    rows: [
      { icon: icon.vitality, label: "活跃度", value: num(vitality.current), max: num(vitality.max), warn: Number(vitality.current || 0) !== Number(vitality.max || 0) && vitality.max !== undefined },
      { icon: icon.sign, label: "刮刮卡", value: /Done/i.test(String(cardSign)) || cardSign === true ? "已完成" : "未完成" },
      { icon: icon.store, label: "录像店", value: /Doing/i.test(String(saleState)) ? "正在营业" : "等待营业" },
    ],
    footer: null,
  }
}

export function buildDailyNoteRenderData({ userId, profileId, games, results }) {
  const stamp = formatStamp()
  const panels = results.map(item => {
    const base = {
      ok: Boolean(item.ok),
      uid: item.uid || "",
      nickname: item.nickname || "",
      game: item.game || "gs",
      gameName: item.gameName || dailyNoteGameName(item.game),
      profileLabel: `Profile ${item.profileId || "-"}`,
      date: stamp,
      signed: item.data?.has_signed === undefined ? null : Boolean(item.data.has_signed),
      error: item.error || "",
    }
    if (!item.ok) return base
    const data = item.data || {}
    const extra = item.game === "sr" ? starRailPanel(data) : item.game === "zzz" ? zzzPanel(data) : genshinPanel(data)
    return { ...base, ...extra }
  })
  const okCount = panels.filter(panel => panel.ok).length
  // jj 模式单卡：一张卡只对应一个游戏/账号时，标题直接用「<游戏>体力」，副标题带 UID
  const single = panels.length === 1 ? panels[0] : null
  return {
    title: single
      ? `${single.gameName}体力`
      : profileId ? `Profile ${profileId} 体力` : "全部体力",
    subtitle: single
      ? `${accountDisplay(String(userId))} · UID ${single.uid || "-"}`
      : `${accountDisplay(String(userId))} · ${games.map(dailyNoteGameName).join(" / ")}`,
    badge: `${okCount}/${panels.length}`,
    message: okCount ? "" : "没有成功的体力结果，请检查登录态、UID 同步和设备信息。",
    panels,
  }
}
