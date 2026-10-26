// 自动二次重签（自动补签）：每天定时扫描当日签到计划里的失败条目，自动重试一次。
//
// 设计约束（2026-10-26 评估定稿）：
//   1. 黑名单过滤：登录状态失效 / 未保存 cookie / 配置类失败不重试——重试必然再失败，
//      只会多打米游社接口、多触发验证码、给用户推第二张重复失败卡。
//   2. 单次上限：每条目每天最多自动重试 1 次（entry.autoResigned 标记）。
//   3. 通知策略：重试成功才通知用户；失败静默（首次失败已推过卡，不再轰炸）。
//      notify_on_success / 全局 notify_enabled 双开关可控。
//   4. 手动补签过的条目（entry.result.resigned）不再自动重试，避免第三次打扰。
//   5. 并发安全：逐条目「重读 plan → 校验 → 执行 → 落盘」，与 cron 主链路 / 手动补签
//      的写入天然收敛；配合全局节流（scheduler.throttle）控制请求节奏。
//
// 触发入口：apps/scheduler.js 注册 cron（scheduler.auto_resign.cron，默认每天 12:00）。

import { loadGlobalConfig } from "../../core/config/global.js"
import { loadProfile } from "../../core/config/profile.js"
import { SchedulerService, dateString } from "../../core/scheduler/service.js"
import { createCaptchaEventReporter } from "../../core/captcha/notify.js"
import { notifyProfile } from "../../core/transport/notify.js"
import { ProfileSigninService } from "./profileSignin.js"
import { emitCheckinLog } from "../../core/checkinLog.js"
import { formatLocalIso } from "../../core/time.js"

// 命中即跳过重试的失败信息关键词（小写不敏感子串匹配）
const NON_RETRYABLE_PATTERNS = [
  "登录状态失效",
  "重新登录",
  "重新扫码",
  "重新绑定",
  "尚未保存 cookie",
  "扫码登录",
  "全局关闭",
  "已被关闭",
]

/** 判断失败信息是否值得重试。message 为空视为可重试（未知失败给一次机会）。 */
export function isRetryableFailure(message = "") {
  const text = String(message || "")
  if (!text) return true
  return !NON_RETRYABLE_PATTERNS.some(keyword => text.includes(keyword))
}

export class AutoResignService {
  constructor(options = {}) {
    this.scheduler = options.scheduler
    this.signin = options.signin || new ProfileSigninService(options)
    this.notify = options.notify || notifyProfile
    this.bot = options.bot
    this.now = options.now || (() => new Date())
  }

  /**
   * 扫描当日计划失败条目并自动重试。
   * @param {object} [options]
   * @param {boolean} [options.dryRun] 只列出将要重试的条目，不执行、不写盘（自检用）
   * @param {string} [options.date]
   * @returns {{ok:boolean, date:string, candidates:number, retried:number, recovered:number, skipped:number, results:Array}}
   */
  async run(options = {}) {
    const config = options.config || await loadGlobalConfig()
    const scheduler = this.scheduler || new SchedulerService({
      config: config.scheduler,
    })
    const date = options.date || dateString(this.now())
    const plan = await scheduler.getPlan(date)
    if (!plan || !Array.isArray(plan.entries)) {
      return { ok: true, date, candidates: 0, retried: 0, recovered: 0, skipped: 0, results: [], reason: "plan_not_found" }
    }

    const failed = plan.entries.filter(entry =>
      entry.done === true
      && entry.ok !== true
      && entry.autoResigned !== true
      && entry.result?.resigned !== true)
    const candidates = failed.filter(entry => isRetryableFailure(entry.message || entry.result?.message))
    const skipped = failed.length - candidates.length

    if (!candidates.length) {
      return { ok: true, date, candidates: 0, retried: 0, recovered: 0, skipped, results: [] }
    }

    if (options.dryRun) {
      return {
        ok: true,
        date,
        dryRun: true,
        candidates: candidates.length,
        skipped,
        results: candidates.map(entry => ({
          qq: entry.qq,
          profileId: entry.profileId,
          time: entry.time,
          message: String(entry.message || entry.result?.message || "").slice(0, 120),
        })),
      }
    }

    emitCheckinLog({ type: "resign-batch-start", message: `自动补签开始，本轮 ${candidates.length} 人（黑名单跳过 ${skipped}）` })
    const throttle = config.scheduler?.throttle || {}
    const results = []
    let recovered = 0

    for (const candidate of candidates) {
      // 节流：与自动签到主链路同配置，避免瞬时并发触发风控
      await sleepThrottle(throttle)

      // 逐条目重读计划：避免覆盖 cron 主链路 / 手动补签期间的并发写入
      const freshPlan = await scheduler.getPlan(date)
      const entry = freshPlan?.entries?.find(item =>
        String(item.qq) === String(candidate.qq) && Number(item.profileId || 1) === Number(candidate.profileId || 1))
      // 条目已消失 / 已被手动补签救回 / 已重试过 → 跳过
      if (!entry || entry.ok === true || entry.autoResigned === true) continue

      entry.autoResigned = true
      entry.autoResignedAt = formatLocalIso()
      await scheduler.savePlan(freshPlan)

      emitCheckinLog({ type: "signing", qq: entry.qq, profileId: entry.profileId, message: "自动补签开始" })
      const outcome = await this.runEntry(entry, { config })
      entry.done = true
      entry.doneAt = formatLocalIso()
      entry.ok = outcome.ok === true
      entry.stage = outcome.stage || "auto-resign"
      entry.message = outcome.ok
        ? `自动补签成功（原失败：${String(entry.message || "").slice(0, 60)}）`
        : `自动补签仍未成功：${outcome.message || outcome.error?.message || ""}`
      entry.result = {
        ok: entry.ok,
        games: Array.isArray(outcome.games) ? outcome.games : [],
        finishedAt: entry.doneAt,
        message: entry.message,
        resigned: true,
        autoResigned: true,
      }
      await scheduler.savePlan(freshPlan)

      if (entry.ok) recovered++
      emitCheckinLog({
        type: "done",
        qq: entry.qq,
        profileId: entry.profileId,
        ok: entry.ok,
        message: entry.message,
      })
      // 通知策略：成功才通知（首次失败已推过卡）；失败静默。
      // 双开关：scheduler.auto_resign.notify_on_success（默认 true）× 全局 notify_enabled。
      if (entry.ok && config.scheduler?.auto_resign?.notify_on_success !== false
        && config.scheduler?.notify_enabled !== false) {
        try {
          const profile = outcome.profile || await this.loadEntryProfile(entry).catch(() => null)
          if (profile) {
            const payload = outcome.image || outcome.message || "自动补签成功。"
            const sent = await this.notify(profile, payload, { bot: this.bot })
            if (!sent.ok) {
              logger?.warn?.(`[Lotus-Plugin] auto resign notify failed qq=${entry.qq} profile=${entry.profileId} reason=${sent.reason || "-"}`)
            }
          }
        } catch (notifyError) {
          logger?.warn?.(`[Lotus-Plugin] auto resign notify error: ${notifyError.message}`)
        }
      }
      results.push({ entry: { ...entry }, outcome })
    }

    emitCheckinLog({ type: "resign-batch-end", message: `自动补签结束：${recovered}/${results.length} 成功` })
    logger?.mark?.(`[Lotus-Plugin] auto resign finished: ${recovered}/${results.length} recovered (skipped ${skipped} non-retryable)`)
    return { ok: true, date, candidates: candidates.length, retried: results.length, recovered, skipped, results }
  }

  async runEntry(entry, options = {}) {
    try {
      const captchaReporter = createCaptchaEventReporter({
        send: async message => {
          // 全局静默主开关：notify_enabled=false → 自动补签过程不推验证码私聊
          const sched = options.config?.scheduler || {}
          if (sched.notify_enabled === false) return false
          const profile = await this.loadEntryProfile(entry).catch(() => null)
          if (!profile) return false
          return (await this.notify(profile, message, { bot: this.bot })).ok
        },
        sendForward: async messages => {
          const sched = options.config?.scheduler || {}
          if (sched.notify_enabled === false) return false
          const profile = await this.loadEntryProfile(entry).catch(() => null)
          if (!profile) return false
          return (await this.notify(profile, messages.join("\n"), { bot: this.bot })).ok
        },
      })
      return await this.signin.run({
        qq: entry.qq,
        profileId: entry.profileId,
        refresh: true,
        installRequirements: false,
        onCaptchaEvent: async event => {
          await captchaReporter(event).catch(error => {
            logger?.warn?.(`[Lotus-Plugin] auto resign captcha notify failed: ${error.message}`)
          })
        },
      })
    } catch (error) {
      return { ok: false, stage: "auto-resign", error, message: error.message }
    }
  }

  async loadEntryProfile(entry) {
    return loadProfile(entry.qq, entry.profileId)
  }
}

function sleepThrottle(throttle = {}) {  const min = Number(throttle.delay_ms_min ?? 0)
  const max = Number(throttle.delay_ms_max ?? 0)
  if (throttle.enable === false || (!min && !max)) return Promise.resolve()
  const ms = min >= max ? min : min + Math.floor(Math.random() * (max - min + 1))
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}
