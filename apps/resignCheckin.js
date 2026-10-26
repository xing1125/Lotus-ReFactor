// 补签重试指令（手动二次签到，限 3 次/日）
//
// 背景：自动签到调度若在运行中抛错（如渲染分支 ReferenceError），计划条目会被标记为 done，
// 当天不会再自动重试。本指令提供一个手动「重新拉起」入口，直接调用签到引擎补跑。
//
// 与 apps/checkin.js 里既有的 #补签（无次数限制、仅单 profile）区分：本指令带每日次数上限，
// 防止刷屏/滥用，并支持「全部 profile」批量补签。
//
// 命令：
//   #补签重试            补签当前用户默认 profile（id 1）
//   #补签重试<id>        补签指定 profile，例如 #补签重试2
//   #补签重试全部        补签当前用户全部已配置 profile
//   #补签重试次数        查询今日剩余补签次数（不消耗次数）
//   别名：#二次签到、#重新签到（语义相同）
//
// 限制：每个用户每天最多 3 次补签（一次指令=1 次，不论补签几个 profile）。次日 00:00 自动重置。
//
// 注意：本文件为未跟踪文件，git pull 不会覆盖；如需随插件分发请自行 git add。

const BasePlugin = globalThis.plugin

import fs from "node:fs/promises"
import {
  listProfileIds,
  normalizeProfileId,
  MAX_PROFILE_ID,
} from "../core/config/profile.js"
import { loadGlobalConfig } from "../core/config/global.js"
import { resolveData } from "../core/path.js"
import { dateString } from "../core/scheduler/service.js"
import { replyImage, replyText } from "../core/transport/reply.js"
import { replyCaptchaEvent } from "../core/captcha/notify.js"
import { ProfileSigninService } from "../services/checkin/profileSignin.js"
import { applyOutcomesToPlan } from "../services/checkin/scheduled.js"
import { emitCheckinLog } from "../core/checkinLog.js"

const MAX_RETRY_PER_DAY = 3
const COUNT_FILE = resolveData("resign-count.json")

export class LotusResignCheckin extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] ResignCheckin",
      dsc: "Lotus manual re-signin (limited retries)",
      event: "message",
      priority: 21,
      rule: [
        {
          reg: `^#(补签重试|二次签到|重新签到)(.*)$`,
          fnc: "resignRetry",
        },
      ],
    })
  }

  async resignRetry() {
    const userId = String(this.e.user_id)
    const tail = String(this.e.msg).replace(/^#(补签重试|二次签到|重新签到)/, "").trim()

    // 全局静默主开关：notify_enabled=false 时，手动补签也不向群/私聊刷图（保留文字回执，不推卡片）
    const silent = (await loadGlobalConfig().catch(() => null))?.scheduler?.notify_enabled === false

    // 查询剩余次数，不消耗额度
    if (/次数/.test(tail)) {
      const remaining = await this.remainingAttempts(userId)
      await replyText(this, `[荷花插件]今日补签剩余次数：${remaining}/${MAX_RETRY_PER_DAY}（每日 00:00 重置）。`)
      return true
    }

    // 解析作用域
    let scope = "default"
    let profileId = 1
    if (/(全部|all)/i.test(tail)) {
      scope = "all"
    } else {
      const m = tail.match(/(\d+)/)
      if (m) {
        try {
          profileId = normalizeProfileId(m[1])
          scope = "single"
        } catch {
          await replyText(this, `[荷花插件]profile id 无效，应为 1-${MAX_PROFILE_ID} 之间的数字。`)
          return true
        }
      }
    }

    // 限额检查（先扣额度再执行，失败也算一次）
    const remaining = await this.remainingAttempts(userId)
    if (remaining <= 0) {
      await replyText(this, `[荷花插件]今日补签次数已用完（${MAX_RETRY_PER_DAY}/${MAX_RETRY_PER_DAY}），请明日 00:00 后再试。如需更多，请手动使用 #补签 或检查自动签到计划。`)
      return true
    }
    await this.incrementAttempts(userId)

    const ids = scope === "all"
      ? await listProfileIds(userId)
      : [profileId]

    if (!ids.length) {
      await replyText(this, `[荷花插件]你还没有任何已配置的 profile，请先使用 #扫码登录 绑定账号。`)
      return true
    }

    if (scope === "all") {
      await replyText(this, `[荷花插件]开始补签全部 ${ids.length} 个 profile（剩余次数 ${remaining - 1}/${MAX_RETRY_PER_DAY}）…`)
    } else {
      await replyText(this, `[荷花插件]开始补签 profile ${profileId}（剩余次数 ${remaining - 1}/${MAX_RETRY_PER_DAY}）…`)
    }

    const outcomes = []
    emitCheckinLog({ type: "resign-batch-start", qq: userId, message: `补签开始（${scope === "all" ? `全部 ${ids.length} 个 profile` : `profile ${profileId}`}）` })
    for (const id of ids) {
      emitCheckinLog({ type: "signing", qq: userId, profileId: id, message: "补签开始" })
      const outcome = await this.runOne(userId, id)
      emitCheckinLog({
        type: "done",
        qq: userId,
        profileId: id,
        ok: outcome.ok === true,
        message: outcome.ok ? "补签成功" : (outcome.message || "补签失败"),
      })
      outcomes.push({ profileId: id, outcome })
    }

    // 把补签结果回写进当日计划条目，保证 #签到看板 / 主人汇总与实际一致
    await applyOutcomesToPlan(outcomes.map(({ profileId, outcome }) => ({
      qq: userId, profileId, outcome,
    }))).catch(error => {
      logger?.warn?.(`[Lotus-Plugin] 补签结果回写计划失败：${error?.message || error}`)
    })

    // 单 profile：直接回传签到卡片
    if (scope !== "all") {
      const { outcome } = outcomes[0]
      const text = outcome.ok
        ? `[荷花插件]profile ${profileId} 补签完成。`
        : `[荷花插件]profile ${profileId} 补签失败：${outcome.message}`
      // 静默模式：仅回文字，不推卡片图（避免群里刷图）
      if (silent) {
        await replyText(this, text)
      } else {
        await replyImage(this, outcome.image, text)
      }
      return true
    }

    // 全部：文字汇总 + 逐张卡片
    const summary = outcomes.map(({ profileId: id, outcome }) =>
      `· profile ${id}：${outcome.ok ? "成功" : "失败" + (outcome.message ? `（${outcome.message}）` : "")}`
    ).join("\n")
    const okCount = outcomes.filter(o => o.outcome.ok).length
    await replyText(this, `[荷花插件]补签全部完成：${okCount}/${outcomes.length} 成功。\n${summary}\n剩余补签次数：${Math.max(0, remaining - 1)}/${MAX_RETRY_PER_DAY}`)
    for (const { outcome } of outcomes) {
      // 静默模式：跳过逐张卡片图，仅保留上方文字汇总（不刷群图）
      if (!silent && outcome.image) {
        await replyImage(this, outcome.image, "").catch(() => {})
      }
    }
    return true
  }

  async runOne(userId, profileId) {
    try {
      const outcome = await new ProfileSigninService().run({
        qq: userId,
        profileId,
        refresh: true,
        installRequirements: false,
        onCaptchaEvent: async event => {
          await replyCaptchaEvent(this, event).catch(() => {})
        },
      })
      return outcome
    } catch (error) {
      logger?.error?.(`[Lotus-Plugin] resign failed (${userId}/${profileId}): ${error.stack || error.message}`)
      const message = error?.code === "ENOENT"
        ? `profile ${profileId} 尚未配置，请先使用 #扫码登录${profileId === 1 ? "" : profileId}。`
        : error.message
      return {
        ok: false,
        message,
        image: null,
      }
    }
  }

  // ---- 每日次数计数器 ----

  async readCounts() {
    try {
      const raw = await fs.readFile(COUNT_FILE, "utf8")
      const data = JSON.parse(raw)
      return data && typeof data === "object" ? data : {}
    } catch (error) {
      if (error?.code === "ENOENT") return {}
      logger?.warn?.(`[Lotus-Plugin] read resign-count failed: ${error.message}`)
      return {}
    }
  }

  async writeCounts(data) {
    try {
      await fs.mkdir(COUNT_FILE.replace(/[^/\\]+$/, ""), { recursive: true })
      await fs.writeFile(COUNT_FILE, JSON.stringify(data, null, 2), "utf8")
    } catch (error) {
      logger?.warn?.(`[Lotus-Plugin] write resign-count failed: ${error.message}`)
    }
  }

  async remainingAttempts(userId) {
    const data = await this.readCounts()
    const today = dateString()
    const used = Number(data[today]?.[userId] || 0)
    return Math.max(0, MAX_RETRY_PER_DAY - used)
  }

  async incrementAttempts(userId) {
    const data = await this.readCounts()
    const today = dateString()
    if (!data[today]) data[today] = {}
    data[today][userId] = Number(data[today][userId] || 0) + 1
    // 清理过期日期，避免文件无限膨胀
    const keep = [today]
    const yesterday = dateString(new Date(Date.now() - 24 * 3600 * 1000))
    if (yesterday !== today) keep.push(yesterday)
    for (const key of Object.keys(data)) {
      if (!keep.includes(key)) delete data[key]
    }
    await this.writeCounts(data)
  }
}

export { MAX_RETRY_PER_DAY }
