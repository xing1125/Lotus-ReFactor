const BasePlugin = globalThis.plugin

import { loadGlobalConfig, saveGlobalConfig } from "../core/config/global.js"
import { loadProfile, saveProfile } from "../core/config/profile.js"
import { PermissionService } from "../core/permissions/service.js"
import { renderStatusCard } from "../core/render/service.js"
import { replyImage, replyText } from "../core/transport/reply.js"
import { registerGroupCheckinProfiles } from "../services/checkin/groupRegister.js"
import { SchedulerService } from "../core/scheduler/service.js"
import { ScheduledSigninService } from "../services/checkin/scheduled.js"

// 一键群签到部署指令（git untracked，git pull 安全）
//
// 命令格式：
//   #群签到部署                          查看当前部署状态
//   #群签到部署 HH:MM                    当前群，固定时间
//   #群签到部署 随机 HH:MM-HH:MM         当前群，随机窗口
//   #群签到部署 HH:MM 全部               所有群，固定时间
//   #群签到部署 HH:MM 群号1,群号2        指定群，固定时间
//   #群签到部署 随机 HH:MM-HH:MM 全部   所有群，随机窗口
//
// 行为：
//   1. 设置全局签到模式与时间（写入 global.yaml，锅巴自动同步）
//   2. 为目标群所有成员注册签到（enabled = true）
//   3. 为所有成员开启签到通知（notify.enable = true + fallback_groups）
//   4. 强制重生成明日计划（新时间立即生效，不用等到午夜）
//   5. 通知每个成员明日的签到时间
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

export class LotusGroupDeploy extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Group Deploy",
      dsc: "一键群签到部署：注册全员 + 开启通知 + 设定时间 + 同步锅巴",
      event: "message",
      priority: 20,
      rule: [
        { reg: "^#群签到部署", fnc: "deploy" },
      ],
    })
  }

  async deploy() {
    const globalConfig = await loadGlobalConfig()
    const permission = new PermissionService({ permissions: globalConfig.permissions })
      .explain(this.e, "scheduler.manage")
    if (!permission.ok) {
      await replyText(this, "[荷花插件]只有 bot 主人可以执行群签到部署。")
      return true
    }

    const parsed = parseDeployCommand(String(this.e.msg || ""))
    if (!parsed.ok) {
      await replyText(this, `[荷花插件]${parsed.reason}\n\n用法：\n  #群签到部署 HH:MM — 当前群固定时间\n  #群签到部署 随机 HH:MM-HH:MM — 当前群随机窗口\n  #群签到部署 HH:MM 全部 — 所有群\n  #群签到部署 HH:MM 群号,群号 — 指定群\n  #群签到部署 — 查看当前状态`)
      return true
    }

    if (parsed.action === "show") {
      return this.showStatus(globalConfig)
    }

    await replyText(this, "[荷花插件]正在执行群签到部署，请稍候。")

    // 1. 更新全局调度配置并保存（锅巴读取同一 global.yaml，自动同步）
    const next = structuredClone(globalConfig)
    next.scheduler ||= {}
    next.scheduler.enable = true
    next.scheduler.random ||= {}
    next.scheduler.random.notify_before = true
    if (parsed.mode === "fixed") {
      next.scheduler.mode = "fixed"
      next.scheduler.fixed_time = parsed.fixedTime
    } else if (parsed.mode === "random") {
      next.scheduler.mode = "random"
      next.scheduler.random.window_start = parsed.windowStart
      next.scheduler.random.window_end = parsed.windowEnd
    }
    await saveGlobalConfig(next)

    // 2. 解析目标群
    const groupIds = resolveGroupIds(parsed.groupIds, this.e, globalThis.Bot)
    if (!groupIds.length) {
      await replyText(this, "[荷花插件]未找到目标群。请在群内执行，或指定群号 / 全部。")
      return true
    }

    // 3. 逐群注册全员 + 开启通知
    const deployResults = []
    for (const groupId of groupIds) {
      try {
        const result = await deployGroupCheckin(this.e, globalThis.Bot, groupId)
        deployResults.push(result)
      } catch (error) {
        deployResults.push({
          groupId,
          ok: false,
          totalMembers: 0,
          registered: 0,
          updated: 0,
          existing: 0,
          skipped: 0,
          reason: error.message || "unknown_error",
        })
      }
    }

    // 4. 强制重生成明日计划（新时间立即生效），并逐个群内通知每位成员（保留「一对一明日时间卡」）
    //    现在 fallback_groups 已写入、schedule-notice 已带群号，通知会走群通道而非私聊，
    //    每张图都能看到归属群号，方便核对谁部署成功。notifyPlan 内部带轻量节流，避免群里瞬间爆发。
    const scheduler = new SchedulerService({ config: next.scheduler })
    const scheduled = new ScheduledSigninService({ scheduler })
    let plan = null
    let notifications = []
    try {
      const generated = await scheduled.ensureTomorrowPlanAndNotify({
        config: next,
        force: true,
        forceNotify: true,
        throttle: true,
        bot: globalThis.Bot,
      })
      plan = generated.plan
      notifications = generated.notifications || []
    } catch (error) {
      logger?.error?.(`[Lotus-Plugin] group deploy regenerate plan failed: ${error.stack || error.message}`)
    }

    // 5. 渲染结果
    const cur = next.scheduler
    const timeDesc = cur.mode === "random"
      ? `随机 ${cur.random?.window_start || "00:00"} ~ ${cur.random?.window_end || "23:30"}`
      : `固定 ${cur.fixed_time || "04:30"}`

    const totalMembers = deployResults.reduce((sum, r) => sum + (r.totalMembers || 0), 0)
    const totalRegistered = deployResults.reduce((sum, r) => sum + (r.registered || 0), 0)
    const totalUpdated = deployResults.reduce((sum, r) => sum + (r.updated || 0), 0)
    const totalSkipped = deployResults.reduce((sum, r) => sum + (r.skipped || 0), 0)
    const notified = notifications.filter(n => n.sent?.ok).length

    const items = [
      { label: "签到模式", value: `${cur.mode} · ${timeDesc}` },
      { label: "部署群数", value: String(deployResults.length) },
      { label: "群成员总数", value: String(totalMembers) },
      { label: "已注册签到", value: `${totalRegistered}（新增 ${totalUpdated}，跳过 ${totalSkipped}）` },
      { label: "签到通知", value: `已群内逐个通知 ${notified}/${totalRegistered} 人（带群号）` },
      { label: "明日计划", value: plan ? `${plan.entries.length} 条已重生成` : "生成失败，将于午夜自动重试" },
      { label: "锅巴同步", value: "已写入 global.yaml" },
    ]

    for (const r of deployResults.slice(0, 8)) {
      items.push({
        label: `群 ${r.groupId}`,
        value: r.ok
          ? `${r.registered}/${r.totalMembers} 注册（新增 ${r.updated}）`
          : `失败：${r.reason}`,
      })
    }
    if (deployResults.length > 8) {
      items.push({ label: "更多", value: `另有 ${deployResults.length - 8} 个群` })
    }

    const image = await renderStatusCard({
      title: "群签到部署",
      subtitle: `账号 ${this.e.user_id} · ${timeDesc}`,
      badge: `${totalRegistered}`,
      message: `已为 ${deployResults.length} 个群部署签到，模式 ${cur.mode}，时间 ${timeDesc}。明日计划已按新时间重生成，全员签到通知已开启，配置已同步锅巴。`,
      userId: this.e.user_id,
      items,
    }, {
      saveId: `lotus-group-deploy-${this.e.user_id || "master"}`,
    })
    await replyImage(this, image, "[荷花插件]群签到部署完成。")
    return true
  }

  async showStatus(globalConfig) {
    const cur = globalConfig.scheduler || {}
    const timeDesc = cur.mode === "random"
      ? `随机 ${cur.random?.window_start || "00:00"} ~ ${cur.random?.window_end || "23:30"}`
      : `固定 ${cur.fixed_time || "04:30"}`

    const image = await renderStatusCard({
      title: "签到部署状态",
      subtitle: `账号 ${this.e.user_id}`,
      badge: cur.mode || "fixed",
      message: `当前签到模式：${timeDesc}\n锅巴配置已同步（同一 global.yaml）。`,
      userId: this.e.user_id,
      items: [
        { label: "签到模式", value: cur.mode || "fixed" },
        { label: "固定时间", value: cur.fixed_time || "04:30" },
        { label: "随机窗口", value: `${cur.random?.window_start || "00:00"} ~ ${cur.random?.window_end || "23:30"}` },
        { label: "计划生成", value: cur.plan_generate_cron || "0 0 0 * * ? *" },
        { label: "到期扫描", value: cur.run_due_cron || "0 * * * * ? *" },
        { label: "调度启用", value: cur.enable === false ? "关闭" : "开启" },
        { label: "通知次日时间", value: cur.random?.notify_before === false ? "关闭" : "开启" },
      ],
    }, {
      saveId: `lotus-group-deploy-status-${this.e.user_id || "master"}`,
    })
    await replyImage(this, image, "[荷花插件]当前签到部署状态。")
    return true
  }
}

async function deployGroupCheckin(e, bot, groupId) {
  const group = e?.group_id && String(e.group_id) === String(groupId)
    ? e.group
    : (bot?.pickGroup?.(groupId) || bot?.pickGroup?.(Number(groupId)))
  if (!group?.getMemberMap) {
    return {
      groupId,
      ok: false,
      totalMembers: 0,
      registered: 0,
      updated: 0,
      existing: 0,
      skipped: 0,
      reason: "group_unavailable",
    }
  }

  // 注册全员：enabled = true + fallback_groups 含本群
  const result = await registerGroupCheckinProfiles({
    group,
    groupId,
    profileId: 1,
  })

  // 二次遍历：显式开启通知（notify.enable = true + prefer=group + fallback_groups 含本群）
  let notifyEnabled = 0
  for (const item of result.results) {
    if (!item.ok || !item.qq) continue
    const profile = await loadProfile(item.qq, 1).catch(() => null)
    if (!profile) continue
    let changed = false
    profile.profile ||= {}
    profile.profile.notify ||= {}
    if (profile.profile.notify.enable !== true) {
      profile.profile.notify.enable = true
      changed = true
    }
    if (!profile.profile.notify.prefer) {
      profile.profile.notify.prefer = "group"
      changed = true
    }
    // 关键：写入 fallback_groups，否则 group 通道找不到目标群会全部退回私聊
    const existingGroups = Array.isArray(profile.profile.notify.fallback_groups)
      ? profile.profile.notify.fallback_groups.map(String)
      : []
    if (!existingGroups.includes(String(groupId))) {
      profile.profile.notify.fallback_groups = [...existingGroups, String(groupId)]
      changed = true
    }
    if (changed) {
      await saveProfile(profile)
      notifyEnabled++
    }
  }

  return {
    groupId: String(groupId),
    ok: true,
    totalMembers: result.totalMembers,
    registered: result.registered,
    updated: result.updated,
    existing: result.existing,
    skipped: result.skipped,
    notifyEnabled,
  }
}

function parseDeployCommand(message) {
  const text = String(message || "").trim()
  const parts = text.replace(/^#群签到部署\s*/, "").split(/\s+/).filter(Boolean)

  if (!parts.length) {
    return { ok: true, action: "show" }
  }

  let mode, timePart, groupPart
  if (parts[0] === "随机") {
    mode = "random"
    timePart = parts[1]
    groupPart = parts[2] || ""
  } else if (TIME_RE.test(parts[0])) {
    mode = "fixed"
    timePart = parts[0]
    groupPart = parts[1] || ""
  } else {
    return { ok: false, reason: "无法识别指令。第一个参数应为时间（如 08:00）或「随机」。" }
  }

  let fixedTime = ""
  let windowStart = ""
  let windowEnd = ""
  if (mode === "fixed") {
    fixedTime = normalizeTime(timePart)
    if (!fixedTime) return { ok: false, reason: "时间格式不正确，示例 08:00。" }
  } else {
    if (!timePart) return { ok: false, reason: "随机模式需要时间窗口，格式 HH:MM-HH:MM。" }
    const m = timePart.match(/^([01]?\d|2[0-3]):([0-5]\d)[-~到]([01]?\d|2[0-3]):([0-5]\d)$/)
    if (!m) return { ok: false, reason: "随机窗口格式不正确，示例 08:00-10:00。" }
    windowStart = normalizeTime(`${m[1]}:${m[2]}`)
    windowEnd = normalizeTime(`${m[3]}:${m[4]}`)
    if (!windowStart || !windowEnd) return { ok: false, reason: "时间格式不正确。" }
    if (timeToMinutes(windowEnd) <= timeToMinutes(windowStart)) {
      return { ok: false, reason: "结束时间必须晚于开始时间。" }
    }
  }

  let groupIds = null
  if (groupPart === "全部") {
    groupIds = "all"
  } else if (groupPart) {
    groupIds = groupPart.split(/[,，\s]+/).filter(Boolean)
  }

  return { ok: true, action: "deploy", mode, fixedTime, windowStart, windowEnd, groupIds }
}

function resolveGroupIds(groupIds, e, bot) {
  if (groupIds === "all") {
    const groupList = bot?.getGroupList?.()
    if (groupList instanceof Map) {
      return [...groupList.keys()].map(String)
    }
    if (Array.isArray(groupList)) {
      return groupList.map(g => String(g?.group_id ?? g)).filter(Boolean)
    }
    return []
  }
  if (Array.isArray(groupIds) && groupIds.length) {
    return groupIds
  }
  if (e?.group_id) return [String(e.group_id)]
  return []
}

function normalizeTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return ""
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return ""
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function timeToMinutes(value) {
  const norm = normalizeTime(value)
  if (!norm) return Number.NaN
  const [h, m] = norm.split(":")
  return Number(h) * 60 + Number(m)
}
