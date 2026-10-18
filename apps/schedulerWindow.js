const BasePlugin = globalThis.plugin

import { loadGlobalConfig, saveGlobalConfig } from "../core/config/global.js"
import { PermissionService } from "../core/permissions/service.js"
import { renderStatusCard } from "../core/render/service.js"
import { replyImage, replyText } from "../core/transport/reply.js"

// 命令格式：
//   #签到随机窗口                  查看当前随机窗口与模式
//   #签到随机窗口 08:00-10:00      设置随机窗口 [08:00, 10:00] 并切到随机模式
//   #签到随机窗口 08:00~10:00      同上（支持 ~ 或 到 作分隔符）
//   #签到随机窗口 默认             恢复全天随机 00:00-23:30
// 说明：固定模式仍用原命令 #签到固定模式 HH:MM；两者独立，互不干扰。
const WINDOW_RE = /^#签到随机窗口(?:\s+(默认|清除|(?:[01]?\d|2[0-3]):[0-5]\d)\s*(?:[-~到]\s*((?:[01]?\d|2[0-3]):[0-5]\d))?)?$/

function normalizeTime(value) {
  const match = String(value || "").match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!match) return ""
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function timeToMinutes(value) {
  const norm = normalizeTime(value)
  if (!norm) return Number.NaN
  const [h, m] = norm.split(":")
  return Number(h) * 60 + Number(m)
}

export class LotusRandomWindow extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Random Window",
      dsc: "控制签到随机模式的时间窗口（固定模式仍走 #签到固定模式）",
      event: "message",
      priority: 20,
      rule: [
        { reg: WINDOW_RE, fnc: "setRandomWindow" },
      ],
    })
  }

  async setRandomWindow() {
    const globalConfig = await loadGlobalConfig()
    const permission = new PermissionService({ permissions: globalConfig.permissions })
      .explain(this.e, "scheduler.manage")
    if (!permission.ok) {
      await replyText(this, "[荷花插件]只有 bot 主人可以修改随机签到窗口。")
      return true
    }

    const match = String(this.e.msg || "").match(WINDOW_RE)
    if (!match) {
      await replyText(this, "[荷花插件]用法：#签到随机窗口 08:00-10:00（设置随机时间段）；#签到随机窗口 默认（恢复全天）；#签到随机窗口（查看当前）。")
      return true
    }

    const next = structuredClone(globalConfig)
    next.scheduler ||= {}
    next.scheduler.random ||= { window_start: "00:00", window_end: "23:30", notify_before: true }

    let action = "show"
    if (match[1] === "默认" || match[1] === "清除") {
      next.scheduler.random.window_start = "00:00"
      next.scheduler.random.window_end = "23:30"
      action = "reset"
    } else if (match[1]) {
      const start = normalizeTime(match[1])
      const end = match[2] ? normalizeTime(match[2]) : ""
      if (!start) {
        await replyText(this, "[荷花插件]起始时间格式不正确，示例 08:00。")
        return true
      }
      if (match[2] && !end) {
        await replyText(this, "[荷花插件]结束时间格式不正确，示例 10:00。")
        return true
      }
      const finalEnd = end || "23:30"
      if (!Number.isNaN(timeToMinutes(finalEnd)) && timeToMinutes(finalEnd) <= timeToMinutes(start)) {
        await replyText(this, `[荷花插件]结束时间必须晚于开始时间：${start} ~ ${finalEnd} 不成立。`)
        return true
      }
      next.scheduler.random.window_start = start
      next.scheduler.random.window_end = finalEnd
      next.scheduler.mode = "random"
      action = "set"
    }

    if (action !== "show") {
      await saveGlobalConfig(next)
    }

    const cur = next.scheduler
    const items = [
      { label: "当前模式", value: cur.mode || "fixed" },
      { label: "固定时间", value: cur.fixed_time || "04:30" },
      { label: "随机窗口", value: `${cur.random?.window_start || "00:00"} ~ ${cur.random?.window_end || "23:30"}` },
      { label: "计划生成", value: cur.plan_generate_cron || "0 0 0 * * ? *" },
      { label: "到期扫描", value: cur.run_due_cron || "0 * * * * ? *" },
    ]
    const message =
      action === "set" ? `随机窗口已设为 ${cur.random.window_start} ~ ${cur.random.window_end}，并切换到随机模式。明日计划将在零点自动按此窗口重新分布；如需立即生效，执行 #生成签到计划。`
      : action === "reset" ? "随机窗口已恢复全天 00:00 ~ 23:30。明日计划将在零点自动重新分布；如需立即生效，执行 #生成签到计划。"
      : "以上为当前签到调度配置。固定模式用 #签到固定模式 HH:MM，随机窗口用 #签到随机窗口 HH:MM-HH:MM。"

    const image = await renderStatusCard({
      title: "签到时间模式",
      subtitle: `账号 ${this.e.user_id} · 随机窗口控制`,
      badge: action === "show" ? "查看" : "已保存",
      message,
      userId: this.e.user_id,
      items,
    }, {
      saveId: `lotus-random-window-${this.e.user_id || "master"}`,
    })
    await replyImage(this, image, "[荷花插件]签到时间配置。")
    return true
  }
}
