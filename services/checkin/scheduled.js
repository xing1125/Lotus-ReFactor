import { loadGlobalConfig } from "../../core/config/global.js"
import { createCaptchaEventReporter } from "../../core/captcha/notify.js"
import { loadProfile, listAllProfiles } from "../../core/config/profile.js"
import { renderTemplate } from "../../core/render/service.js"
import { SchedulerService, dateString, nextDateString } from "../../core/scheduler/service.js"
import { formatLocalIso } from "../../core/time.js"
import { notifyProfile, notifyUser } from "../../core/transport/notify.js"
import { ProfileSigninService, renderSigninFailure } from "./profileSignin.js"
import { accountAvatar, accountDisplay } from "./account.js"
import { buildCheckinStatsData } from "./statsBuilder.js"
import { emitCheckinLog } from "../../core/checkinLog.js"

// 上游 11-17 社区签到当日重试的收尾 cron；apps/scheduler.js（上游版）需要。
// 本地 scheduled.js 是旧签到链路，补这个纯常量导出以兼容上游 scheduler，不改任何逻辑。
export const COMMUNITY_RETRY_FINAL_CRON = "0 50,59 23 * * ? *"

const scheduleTasks = new Map()
const planTasks = new Map()

// 补签/二次签到结果回写计划。
// 背景：#全员二次签到 / #补签重试 只跑 ProfileSigninService.run + 写审计，
// 从不碰当日计划条目；而 #签到看板 / 主人汇总（buildCheckinStatsData）只读计划，
// 导致补签成功后看板仍显示自动签到的旧失败 —— 「跟后台数据对不上」。
// 本函数把补签 outcome 按 qq+profileId 合并进当日计划条目（找不到条目则计入 missing）。
export async function applyOutcomesToPlan(results, options = {}) {
  const date = options.date || dateString()
  const scheduler = options.scheduler || new SchedulerService()
  const list = Array.isArray(results) ? results : []
  if (!list.length) return { ok: true, date, updated: 0, missing: 0 }

  const plan = await scheduler.getPlan(date)
  if (!plan || !Array.isArray(plan.entries)) {
    return { ok: false, date, updated: 0, missing: list.length, reason: "plan_not_found" }
  }

  let updated = 0
  let missing = 0
  for (const item of list) {
    const qq = String(item?.qq ?? "")
    const profileId = Number(item?.profileId || 1)
    const outcome = item?.outcome
    if (!qq || !outcome) { missing++; continue }
    const entry = plan.entries.find(e =>
      String(e.qq) === qq && Number(e.profileId || 1) === profileId)
    if (!entry) { missing++; continue }
    entry.done = true
    entry.doneAt = formatLocalIso()
    entry.ok = outcome.ok === true
    entry.stage = outcome.stage || "checkin"
    entry.message = outcome.message || ""
    // 与 runDuePlan 的 entry.result 同构，额外带 resigned 标记表明来自补签回写
    entry.result = {
      ok: entry.ok,
      games: Array.isArray(outcome.games) ? outcome.games : [],
      finishedAt: entry.doneAt,
      message: entry.message,
      resigned: true,
    }
    updated++
  }
  if (updated) await scheduler.savePlan(plan)
  return { ok: true, date, updated, missing }
}

export class ScheduledSigninService {
  constructor(options = {}) {
    this.scheduler = options.scheduler || new SchedulerService(options)
    this.signin = options.signin || new ProfileSigninService(options)
    this.notify = options.notify || notifyProfile
    this.bot = options.bot
    this.now = options.now || (() => new Date())
    this.renderTemplate = options.renderTemplate || renderTemplate
  }

  async runDue(options = {}) {
    const now = options.now || this.now()
    const planDate = options.date || dateString(now)
    const { shared, result } = await runScheduleTask(
      `run-due:${planDate}`,
      () => runPlanTask(planDate, () => this.runDuePlan(planDate, now, options)),
    )
    // 单飞锁：并发调用共享同一次执行。只有真正发起执行的调用方打印结果，
    // 避免 cron 每分钟重入共享等待、执行结束时同毫秒刷屏 N 条相同日志。
    if (!shared && result.count) {
      logger?.mark?.(`[Lotus-Plugin] scheduled checkin executed: ${result.count}`)
    }
    return result
  }

  async runDuePlan(planDate, now, options = {}) {
    const plan = await this.scheduler.getPlan(planDate)
    if (!plan) {
      return {
        ok: true,
        date: planDate,
        count: 0,
        results: [],
        reason: "plan_not_found",
      }
    }
    const globalConfig = options.config || await loadGlobalConfig()
    const dueEntries = plan.entries.filter(entry => isDue(entry, now))
    const results = []
    if (dueEntries.length) {
      emitCheckinLog({ type: "batch-start", message: `自动签到开始，本轮 ${dueEntries.length} 人` })
    }
    const throttleCfg = normalizeThrottle(globalConfig.scheduler?.throttle)
    let throttleFirst = true
    for (const entry of dueEntries) {
      if (!throttleFirst && throttleCfg.enable) {
        await sleepThrottle(throttleCfg)
      }
      throttleFirst = false
      entry.runningAt = formatLocalIso()
      await this.scheduler.savePlan(plan)
      emitCheckinLog({ type: "signing", qq: entry.qq, profileId: entry.profileId, message: "开始签到" })
      const outcome = await this.runEntry(entry, { ...options, config: globalConfig })
      entry.done = true
      entry.doneAt = formatLocalIso()
      entry.ok = outcome.ok
      entry.stage = outcome.stage
      entry.message = outcome.message || outcome.error?.message || ""
      // 持久化结构化结果（看板 / 主人汇总要展示每人各游戏的具体签到状态与天数）。
      // 不存 image（segment/Buffer，无法 JSON 化且较大），只存可序列化的轻量字段。
      // 兼容旧 entry（无 result 字段）和小失败（无 games）。
      entry.result = {
        ok: outcome.ok === true,
        games: Array.isArray(outcome.games) ? outcome.games : [],
        finishedAt: entry.doneAt,
        message: entry.message,
      }
      delete entry.runningAt
      await this.scheduler.savePlan(plan)
      emitCheckinLog({
        type: "done",
        qq: entry.qq,
        profileId: entry.profileId,
        ok: entry.ok,
        message: entry.message,
      })
      results.push({ entry: { ...entry }, outcome })
    }
    if (dueEntries.length) {
      const okN = results.filter(item => item.outcome.ok).length
      emitCheckinLog({ type: "batch-end", message: `自动签到结束：${okN}/${results.length} 成功` })
    }
    // 当日全部签到完成后，私聊推汇总看板给 BOT主人（每天一次，去重）
    await this.maybeNotifyMasterSummary(plan, { ...options, config: globalConfig }).catch(err => {
      logger?.warn?.(`[Lotus-Plugin] 主人汇总推送失败：${err?.message || err}`)
    })
    return {
      ok: results.every(item => item.outcome.ok),
      date: planDate,
      count: results.length,
      results,
    }
  }

  async maybeNotifyMasterSummary(plan, options = {}) {
    const config = options.config || await loadGlobalConfig()
    const masterWxid = config.master?.wxid
    if (!masterWxid) return
    if (plan.masterSummarySent === true) return
    if (!Array.isArray(plan.entries) || !plan.entries.length) return
    // 当日所有签到项都完成（含失败）才汇总；还有人待签则等全签完再发
    const allDone = plan.entries.every(e => e.done === true)
    if (!allDone) return

    // 冷却：私聊 + 兜底都失败时，30 分钟内不再重试（避免每分钟 cron 轰炸日志）
    const lastAttempt = Number(plan.masterSummaryLastAttemptTs || 0)
    if (lastAttempt && Date.now() - lastAttempt < 30 * 60 * 1000) return

    const profiles = await listAllProfiles().catch(() => [])
    const { groups, summary, knownGroups, totals } = buildCheckinStatsData(plan, profiles)
    const bot = options.bot || this.bot || globalThis.Bot
    const title = "签到汇总看板"
    const subtitle = `${plan.date} · 共 ${knownGroups.length} 个群 · ${totals.done}/${totals.all} 已签`
    // 主人汇总看板恒为看板图：独立于 notify_enabled（全局静默）与 notify_image（纯文字）两开关，
    // 是常开监控通道——主人明确要"收到并且查看"，故不随静默/纯文字配置降级或静音。
    const payload = await this.renderTemplate("checkin-stats", {
      title,
      subtitle,
      badge: "SUMMARY",
      message: "BOT主人专属汇总",
      summary,
      groups,
    }, { saveId: `lotus-master-summary-${plan.date}` })

    // 严格私聊：直接发到主人真实私聊，失败不进群兜底（微信下自己非好友会触发）
    const sent = await notifyUser(masterWxid, payload, {
      bot,
      prefer: "private",
      onlyPrivate: true,
      onlyKnownFriend: false,
    })
    if (sent.ok) {
      plan.masterSummarySent = true
      await this.scheduler.savePlan(plan)
      return
    }
    // 私聊失败 → 兜底文件传输助手（微信系统号总是可达；QQ 适配器无 filehelper 会失败）
    const fh = await trySendFileHelper(bot, payload)
    if (fh.ok) {
      plan.masterSummarySent = true
      await this.scheduler.savePlan(plan)
      return
    }
    // 都失败：记冷却时间戳，下次 cron（>30min）再试
    plan.masterSummaryLastAttemptTs = Date.now()
    await this.scheduler.savePlan(plan)
  }

  async notifyPlan(plan, options = {}) {
    const results = []
    // 轻量节流：群部署可能一次性给几十上百个成员发图，逐张之间加小延迟避免群里瞬间爆发被风控。
    // 传 throttle:true 时若全局未显式配置 scheduler.throttle，则用内置温和默认（150~400ms），
    // 既保留「逐个通知」又不会瞬间刷屏；用户也可在 global.yaml 的 scheduler.throttle 自定义。
    const throttleSource = (options.config || (await loadGlobalConfig())).scheduler?.throttle
    const throttleCfg = normalizeThrottle(
      options.throttle === true
        ? (throttleSource || { enable: true, delay_ms_min: 150, delay_ms_max: 400 })
        : (options.throttle || throttleSource)
    )
    let first = true
    // 全局静默主开关：notify_enabled=false 时，不向各用户推「明日自动签到时间」通知
    const silent = ((options.config || (await loadGlobalConfig())).scheduler?.notify_enabled === false)
    for (const entry of plan.entries) {
      if (entry.notified && !options.force) continue
      // 静默模式：跳过逐人「明日时间通知」推送（群部署时管理员的 in-channel 回执不受影响）
      if (silent) { results.push({ entry: { ...entry }, sent: { ok: false, reason: "silent" } }); continue }
      if (!first && throttleCfg.enable) await sleepThrottle(throttleCfg)
      first = false
      const profile = await loadProfile(entry.qq, entry.profileId).catch(() => null)
      if (!profile) continue
      // 取该成员所属的群（部署时写入 notify.fallback_groups），用于通知图展示群号
      const groups = profile.profile?.notify?.fallback_groups
        || profile.profile?.notify?.groups
        || []
      const groupId = groups.length ? String(groups[0]) : ""
      const items = [
        { label: "签到时间", value: entry.time },
        { label: "模式", value: entry.mode },
        { label: "日期", value: plan.date },
      ]
      if (groupId) items.push({ label: "群号", value: groupId })
      const image = await this.renderTemplate("schedule-notice", {
        title: accountDisplay(entry.qq, profile.user?.platform, profile.user?.nickname),
        subtitle: `${plan.date} · profile ${entry.profileId}`,
        badge: entry.mode,
        message: `明日自动签到将在 ${entry.time} 左右执行。`,
        avatar: accountAvatar(entry.qq, profile.user?.platform),
        userId: entry.qq,
        groupId,
        items,
      }, { saveId: `lotus-schedule-notice-${entry.qq}-${entry.profileId}` })
      const sent = await this.notify(profile, image, { bot: options.bot || this.bot })
      entry.notified = sent.ok
      if (!sent.ok) {
        logger?.warn?.(`[Lotus-Plugin] 明日时间通知失败 qq=${entry.qq} profile=${entry.profileId} channel=${sent.channel || "-"} reason=${sent.reason || "-"} attempts=${JSON.stringify(sent.attempts?.map?.(a => ({ ch: a.channel, ok: a.ok, reason: a.reason })) || [])}`)
      }
      results.push({ entry: { ...entry }, sent })
    }
    await this.scheduler.savePlan(plan)
    return results
  }

  async ensureTomorrowPlanAndNotify(options = {}) {
    const config = options.config || await loadGlobalConfig()
    const date = options.date || nextDateString(this.now())
    const { result } = await runScheduleTask(`tomorrow-plan:${date}`, () => runPlanTask(date, async () => {
      const plan = await this.scheduler.getOrCreatePlan(date, {
        force: options.force,
      })
      // skipNotify：仅重生成计划、不逐个私聊轰炸通知（群部署时用于避免刷屏，
      // 成员仍会在午夜正常计划生成时收到各自群内的明日时间通知）
      const shouldNotify = options.skipNotify
        ? false
        : (options.forceNotify || config.scheduler?.random?.notify_before !== false)
      const notifications = shouldNotify ? await this.notifyPlan(plan, options) : []
      return { plan, notifications }
    }))
    return result
  }

  async addLateProfileAndNotify(profile, options = {}) {
    const config = options.config || await loadGlobalConfig()
    const now = options.now || this.now()
    const dates = options.dates || [dateString(now), nextDateString(now)]
    const results = []
    for (const date of dates) {
      const items = await runPlanTask(date, () => this.scheduler.addLateProfileToExistingPlans(profile, {
        ...options,
        now,
        dates: [date],
      }))
      results.push(...items)
    }
    const added = results.filter(item => item.ok && !item.skipped && item.entry)
    if (!added.length || config.scheduler?.late_registration?.notify === false || options.notify === false) {
      return { results, notifications: [] }
    }
    // 全局静默主开关：notify_enabled=false 时，不向新补位成员推「补位通知」
    if (config.scheduler?.notify_enabled === false) {
      return { results, notifications: [] }
    }
    const notifications = []
    for (const item of added) {
      const image = await this.renderTemplate("schedule-notice", {
        title: accountDisplay(profile.user?.qq || "", profile.user?.platform, profile.user?.nickname),
        subtitle: `${item.date} · profile ${profile.profile?.id || 1}`,
        badge: "补入",
        message: `已加入今日补位计划，将在 ${item.entry.time} 左右执行。`,
        avatar: accountAvatar(profile.user?.qq, profile.user?.platform),
        userId: profile.user?.qq,
        items: [
          { label: "签到时间", value: item.entry.time },
          { label: "模式", value: "新注册补位" },
          { label: "日期", value: item.date },
        ],
      }, { saveId: `lotus-late-schedule-${profile.user?.qq || "user"}-${profile.profile?.id || 1}-${item.date}` })
      notifications.push(await this.notify(profile, image, { bot: options.bot || this.bot }))
    }
    return { results, notifications }
  }

  async runEntry(entry, options = {}) {
    let profile = await loadProfile(entry.qq, entry.profileId).catch(() => null)
    try {
      const captchaReporter = createCaptchaEventReporter({
        send: async message => {
          if (!profile) return false
          // 主开关①：全局静默通知（notify_enabled=false）→ 自动签到全程不向用户推 captcha 私聊
          const schedCfg = (options.config || (await loadGlobalConfig())).scheduler || {}
          if (schedCfg.notify_enabled === false) return false
          const result = await this.notify(profile, message, { bot: options.bot || this.bot })
          return result.ok
        },
        sendForward: async messages => {
          if (!profile) return false
          // 主开关①：全局静默通知（notify_enabled=false）→ 自动签到全程不向用户推 captcha 私聊
          const schedCfg = (options.config || (await loadGlobalConfig())).scheduler || {}
          if (schedCfg.notify_enabled === false) return false
          const result = await this.notify(profile, messages.join("\n"), { bot: options.bot || this.bot })
          return result.ok
        },
      })
      const outcome = await this.signin.run({
        qq: entry.qq,
        profileId: entry.profileId,
        profile,
        refresh: true,
        installRequirements: false,
        onCaptchaEvent: async event => {
          await captchaReporter(event).catch(error => {
            logger?.warn?.(`[Lotus-Plugin] captcha notify failed: ${error.message}`)
          })
        },
      })
      profile = outcome.profile || profile
      if (options.notify !== false && profile) {
        const schedCfg = (options.config || (await loadGlobalConfig())).scheduler || {}
        // 主开关①：全局静默通知（notify_enabled=false）→ 完全不发每人签到结果
        if (schedCfg.notify_enabled !== false) {
          // 主开关②：纯文字模式（notify_image=false）→ 只发文字、不发图
          const sendImage = schedCfg.notify_image !== false
          const payload = sendImage
            ? (outcome.image || outcome.message)
            : (outcome.message || `今日签到${outcome.ok === true ? "已完成" : "失败"}`)
          const sent = await this.notify(profile, payload, { bot: options.bot || this.bot })
          if (!sent.ok) {
            logger?.warn?.(`[Lotus-Plugin] 签到结果通知失败 qq=${entry.qq} profile=${entry.profileId} channel=${sent.channel || "-"} reason=${sent.reason || "-"} attempts=${JSON.stringify(sent.attempts?.map?.(a => ({ ch: a.channel, ok: a.ok, reason: a.reason })) || [])}`)
          }
        }
      }
      return outcome
    } catch (error) {
      const fallbackProfile = profile || {
        user: { qq: entry.qq },
        profile: { id: entry.profileId, notify: { prefer: "group", fallback_groups: [] } },
      }
      const image = await renderSigninFailure({
        stage: "schedule",
        profile: fallbackProfile,
        error,
        message: "计划签到执行失败。",
        advice: "检查 profile 配置文件是否存在，并确认签到环境已经初始化。",
      })
      if (options.notify !== false) {
        // 主开关①：全局静默通知（notify_enabled=false）→ 即使签到异常也不向用户推失败卡片
        const schedCfg = (options.config || (await loadGlobalConfig())).scheduler || {}
        if (schedCfg.notify_enabled !== false) {
          await this.notify(fallbackProfile, image, { bot: options.bot || this.bot }).catch(notifyError => {
            logger?.warn?.(`[Lotus-Plugin] scheduled signin notify failed: ${notifyError.message}`)
          })
        }
      }
      return {
        ok: false,
        stage: "schedule",
        profile: fallbackProfile,
        error,
        image,
        message: error.message,
      }
    }
  }
}

function normalizeThrottle(throttle = {}) {
  const min = Number(throttle?.delay_ms_min ?? 0)
  const max = Number(throttle?.delay_ms_max ?? 0)
  const enable = throttle?.enable !== false
  return {
    enable,
    min: Number.isFinite(min) && min >= 0 ? min : 0,
    max: Number.isFinite(max) && max >= min ? max : Math.max(min, 0),
  }
}

async function sleepThrottle(throttle) {
  const { min, max } = throttle
  const ms = min >= max ? min : min + Math.floor(Math.random() * (max - min + 1))
  if (ms <= 0) return
  await new Promise(resolve => setTimeout(resolve, ms))
}

function isDue(entry, now) {
  if (entry.done || entry.runningAt) return false
  return timeToMinute(entry.time) <= now.getHours() * 60 + now.getMinutes()
}

function timeToMinute(value = "00:00") {
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return Number.POSITIVE_INFINITY
  return Number(match[1]) * 60 + Number(match[2])
}

// 兜底：私聊通道不可用时（如微信下自己不在 bot 好友表），
// 把内容发到「文件传输助手」——微信系统号，bot.sendFriendMsg 总是可达，
// 等价于微信下"发给自己"的私聊替代通道。QQ 适配器通常没有 filehelper，会失败。
async function trySendFileHelper(bot, payload) {
  try {
    if (!bot) return { ok: false, reason: "bot_unavailable" }
    if (typeof bot.sendFriendMsg !== "function") return { ok: false, reason: "sendFriendMsg_unavailable" }
    await bot.sendFriendMsg(null, "filehelper", payload)
    return { ok: true, channel: "filehelper" }
  } catch (error) {
    return { ok: false, reason: error.message || "filehelper_send_failed", error }
  }
}

async function runScheduleTask(key, task) {
  const current = scheduleTasks.get(key)
  if (current) {
    // 与在途执行共享同一结果；shared 标记让调用方（如执行日志）去重
    return { shared: true, result: await current }
  }
  const pending = Promise.resolve().then(task)
  scheduleTasks.set(key, pending)
  try {
    return { shared: false, result: await pending }
  } finally {
    if (scheduleTasks.get(key) === pending) scheduleTasks.delete(key)
  }
}

async function runPlanTask(date, task) {
  const key = `plan:${date}`
  const previous = planTasks.get(key) || Promise.resolve()
  let release
  const pending = new Promise(resolve => {
    release = resolve
  })
  planTasks.set(key, pending)
  try {
    await previous.catch(() => {})
    return await task()
  } finally {
    release()
    if (planTasks.get(key) === pending) planTasks.delete(key)
  }
}
