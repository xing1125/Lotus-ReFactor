// 锅巴快捷动作（guoba.actions.js）
//
// 把「原本要在微信里发指令」的管理操作搬到锅巴后台：锅巴里把动作开关从 关→开 保存即触发一次，
// 执行完写回前自动复位为 false（见 guoba.support.js），结果（进度文字 / 结果卡图片）私聊推送给主人。
//
// 无头复用约定：
//   - apps 层管理函数（runResignAll / runRegisterAll）接受 plugin-like context，
//     只用到 e.e.user_id（renderStatusCard 的 userId）与 replyText(e,...)/replyImage(e,...)。
//     core/transport/reply.js 的 callReply 走 target.reply(payload) 或 target.e.reply(payload)，
//     所以 stub { e: { user_id, isGroup: false, reply }, reply } 即可无头复用，不依赖真实 Yunzai 事件。
//   - stub.reply 收到字符串 → 记日志（logger.info）；收到对象 → 视为渲染结果卡（图片），
//     通过 notifyUser 推主人私聊（与 #签到看板 同通道：prefer private + onlyKnownFriend:false）。
//   - 动作执行失败（含尚未 #设置主人 / #签到看板 绑定主人账号）→ logger.error + 私聊告知主人。
//
// 新增动作：在 GBACTIONS 里加一项即可，锅巴表单与触发链自动生成。

import { loadGlobalConfig } from "./core/config/global.js"
import { listAllProfiles } from "./core/config/profile.js"
import { AccountService } from "./core/login/account.js"
import { registerProfileWithGenshin } from "./services/genshinBridge/profile.js"
import { accountDisplay } from "./services/checkin/account.js"
import { renderStatusCard, renderTemplate } from "./core/render/service.js"
import { SchedulerService, dateString } from "./core/scheduler/service.js"
import { ScheduledSigninService } from "./services/checkin/scheduled.js"
import { buildCheckinStatsData } from "./services/checkin/statsBuilder.js"
import { notifyUser } from "./core/transport/notify.js"
import { runResignAll, runRegisterAll } from "./apps/adminCheckin.js"

export const GBACTIONS = {
  resign_all: {
    label: "全员二次签到",
    desc: "为全体「已扫码」profile 拉起二次签到（等价 #全员二次签到），各用户照常收结果卡，汇总卡私聊发主人。",
    run: async ctx => {
      await runResignAll(ctx, "")
    },
  },
  register_all: {
    label: "全员注册签到",
    desc: "为全体已扫码 profile 一键开启自动签到 + 通知（等价 #全员注册签到），按用户实际所在群写入。",
    run: async ctx => {
      await runRegisterAll(ctx, "")
    },
  },
  batch_refresh: {
    label: "批量刷新账号",
    desc: "按 profile 粒度刷新全部登录信息（等价 #批量刷新签到），结果卡私聊发主人。",
    run: runBatchRefresh,
  },
  board_push: {
    label: "推送签到看板",
    desc: "生成今日实时签到看板并私聊发给主人（等价 #签到看板）。",
    run: runBoardPush,
  },
  checkin_logs: {
    label: "推送签到实时日志",
    desc: "把最近 30 条签到实时事件（批量开始 / 谁在签 / 成功 / 失败原因 / 结束）私聊发给主人。",
    run: runCheckinLogs,
  },
  checkin_dashboard_link: {
    label: "签到实时后台链接",
    desc: "私发主人浏览器看板链接（自动刷新状态+日志，与 bot 同一局域网可开；等价 #签到后台）。",
    run: runDashboardLink,
  },
  generate_plan: {
    label: "生成明日签到计划",
    desc: "立即强制重生成次日签到计划并群发时间通知（等价午夜自动生成，含补注册窗口）。",
    run: runGeneratePlan,
  },
  capture_challenge: {
    label: "捕获挑战数据",
    desc: "拉取剧诗 / 幽境真实报文落盘 data/capture（等价 #捕获挑战数据，供后续自制挑战卡用）。",
    run: async ctx => {
      await runCommandText("#捕获挑战数据", ctx)
    },
  },
  custom_command: {
    label: "自定义指令",
    desc: "逐条执行「自定义指令文本」里填的前台指令（按各 app 的 rule 正则匹配，master 权限指令同样生效）。",
    run: runCustomCommand,
  },
}

// 主人 wxid：config/master.wxid（#设置主人 / 首次 #签到看板 触发 rememberMasterId 写入）。
export async function resolveMasterWxid() {
  const config = await loadGlobalConfig().catch(() => null)
  const wxid = config?.master?.wxid
  if (!wxid) {
    throw new Error("尚未绑定主人账号：请先在微信里对 bot 发一次「#签到看板」或「#设置主人」记录主人 wxid，再回锅巴触发动作。")
  }
  return String(wxid)
}

// 构造可被 apps 层管理函数直接使用的无头 context。
// 文字负载记日志；图片负载（对象）私聊推主人。logs 数组收集全部文字片段便于排查。
export function createHeadlessContext(wxid, actionLabel = "快捷动作") {
  const logs = []

  async function handlePayload(payload) {
    if (payload == null) return
    if (typeof payload === "string") {
      logs.push(payload)
      globalThis.logger?.info?.(`[Lotus-Plugin][锅巴动作] ${payload}`)
      return
    }
    if (Array.isArray(payload)) {
      for (const item of payload) await handlePayload(item)
      return
    }
    // 对象负载：渲染结果卡（图片）→ 私聊推主人（不依赖任何群事件）
    logs.push("[图片结果卡]")
    globalThis.logger?.info?.(`[Lotus-Plugin][锅巴动作] ${actionLabel} 产出结果卡，私聊推送主人 ${accountDisplay(wxid) || wxid}`)
    const sent = await notifyUser(wxid, payload, {
      bot: globalThis.Bot,
      prefer: "private",
      onlyPrivate: true,
      onlyKnownFriend: false,
    }).catch(error => ({ ok: false, reason: error.message }))
    if (!sent?.ok) {
      globalThis.logger?.warn?.(`[Lotus-Plugin][锅巴动作] 结果卡私聊推送失败（${sent?.reason || "unknown"}），主人 ${wxid} 请确认与 bot 私聊通道可用`)
    }
  }

  const reply = payload => handlePayload(payload)
  return {
    e: { user_id: wxid, isGroup: false, reply },
    reply,
    logs,
  }
}

// 触发一个动作（guoba.support.js setConfigData 在保存后调用）。永不向锅巴抛错，失败走通知。
export async function runGuobaAction(id) {
  const action = GBACTIONS[id]
  if (!action?.run) {
    globalThis.logger?.error?.(`[Lotus-Plugin][锅巴动作] 未知动作 id：${id}`)
    return
  }
  let wxid
  try {
    wxid = await resolveMasterWxid()
  } catch (error) {
    globalThis.logger?.error?.(`[Lotus-Plugin][锅巴动作]「${action.label}」无法触发：${error.message}`)
    return
  }
  globalThis.logger?.info?.(`[Lotus-Plugin][锅巴动作] 开始执行「${action.label}」（触发人 主人 ${accountDisplay(wxid) || wxid}）`)
  const ctx = createHeadlessContext(wxid, action.label)
  try {
    await action.run(ctx)
    globalThis.logger?.info?.(`[Lotus-Plugin][锅巴动作]「${action.label}」执行完成（${ctx.logs.length} 条输出）`)
  } catch (error) {
    globalThis.logger?.error?.(`[Lotus-Plugin][锅巴动作]「${action.label}」执行失败：${error.stack || error.message}`)
    await notifyUser(wxid, `[荷花插件]锅巴快捷动作「${action.label}」执行失败：${error.message}`, {
      bot: globalThis.Bot,
      prefer: "private",
      onlyPrivate: true,
      onlyKnownFriend: false,
    }).catch(() => {})
  }
}

// ---- 批量刷新账号（复刻 apps/checkinAdmin.js batchRefresh 核心，结果私聊主人）----
async function runBatchRefresh(ctx) {
  const profiles = await listAllProfiles()
  if (!profiles.length) {
    await ctx.reply("[荷花插件]没有可刷新的 profile，请先 #扫码登录 绑定账号。")
    return
  }
  globalThis.logger?.info?.(`[Lotus-Plugin][锅巴动作] 批量刷新开始，共 ${profiles.length} 个 profile`)
  const account = new AccountService()
  const results = []
  for (const profile of profiles) {
    const qq = profile.user?.qq
    const profileId = profile.profile?.id || 1
    try {
      const refreshed = await account.refresh(qq, profileId)
      await registerProfileWithGenshin({ qq, profile: refreshed }).catch(() => null)
      results.push({ name: accountDisplay(qq, profile.user?.platform, profile.user?.nickname), profileId, ok: true })
    } catch (error) {
      results.push({ name: accountDisplay(qq, profile.user?.platform, profile.user?.nickname), profileId, ok: false, error })
    }
  }

  const okCount = results.filter(item => item.ok).length
  const image = await renderStatusCard({
    title: "批量刷新",
    subtitle: "锅巴快捷动作 · 荷花插件 profiles",
    badge: `${okCount}/${results.length}`,
    message: "已按 profile 粒度批量刷新，不会互相覆盖 cookie/stoken。",
    userId: ctx.e.user_id,
    items: results.slice(0, 14).map(item => ({
      label: `${item.name || "未知账号"} · P${item.profileId}`,
      value: item.ok ? "刷新成功" : `失败：${item.error?.message || "未知错误"}`.slice(0, 60),
    })),
  }, {
    saveId: `lotus-guoba-batch-refresh-${Date.now()}`,
  })
  await ctx.reply(image)
  await ctx.reply(`[荷花插件]批量刷新完成：成功 ${okCount} / 共 ${results.length}，结果卡已私聊发送。`)
}

// ---- 推送签到看板（复刻 apps/checkinStats.js 看板核心，结果私聊主人）----
async function runBoardPush(ctx) {
  const wxid = ctx.e.user_id
  const date = dateString(new Date())
  const plan = await new SchedulerService().getPlan(date)
  if (!plan) {
    await ctx.reply(`[荷花插件]今日（${date}）签到计划尚未生成，暂无实时数据。请先执行 #群签到部署 或等待午夜自动生成计划。`)
    return
  }

  // 群归属映射 + 按群聚合：单一数据源 services/checkin/statsBuilder.js，与 #签到看板 / 自动推送复用，避免漂移
  const profiles = await listAllProfiles()
  const { groups, summary, knownGroups, totals } = buildCheckinStatsData(plan, profiles)
  const image = await renderTemplate("checkin-stats", {
    title: "实时签到看板",
    subtitle: `${date} · 共 ${knownGroups.length} 个群 · ${totals.done}/${totals.all} 已签`,
    badge: "STATS",
    message: "来源：锅巴快捷动作",
    summary,
    groups,
  }, { saveId: `lotus-guoba-checkin-stats-${Date.now()}` })

  const sent = await notifyUser(wxid, image, {
    bot: globalThis.Bot,
    prefer: "private",
    onlyPrivate: true,
    onlyKnownFriend: false,
  }).catch(error => ({ ok: false, reason: error.message }))
  if (!sent?.ok) {
    globalThis.logger?.warn?.(`[Lotus-Plugin][锅巴动作] 看板私聊推送失败：${sent?.reason || "unknown"}（概览：${knownGroups.length} 个群、今日已签 ${totals.done}/${totals.all}）`)
  }
}

// ---- 推送签到实时日志（core/checkinLog.js 环形缓冲 → 文字私聊主人）----
async function runCheckinLogs(ctx) {
  const { buildLogsPayload } = await import("./apps/checkinDashboard.js")
  const payload = await buildLogsPayload(0)
  const logs = payload.logs.slice(-30)
  const wxid = ctx.e.user_id
  if (!logs.length) {
    await notifyUser(wxid, "[荷花插件]暂无实时签到日志（进程重启后内存清空，自下一次签到/补签开始累积）。", {
      bot: globalThis.Bot,
      prefer: "private",
      onlyPrivate: true,
      onlyKnownFriend: false,
    })
    return
  }
  const lines = logs.map(e => {
    const label = e.type === "done" ? (e.ok ? "成功" : "失败")
      : e.type === "signing" ? "签到中"
      : e.type === "batch-start" ? "开始"
      : e.type === "batch-end" ? "本轮结束"
      : e.type === "resign-batch-start" ? "补签开始"
      : e.type === "resign-batch-end" ? "补签结束"
      : "事件"
    const who = e.name || e.qq || ""
    const msg = e.message ? ` ${String(e.message).slice(0, 100)}` : ""
    return `${String(e.t || "").slice(11, 19)} [${label}] ${who}${e.profileId ? `·P${e.profileId}` : ""}${msg}`
  })
  const sent = await notifyUser(wxid, `[荷花插件]最近 ${lines.length} 条签到实时日志：\n${lines.join("\n")}`, {
    bot: globalThis.Bot,
    prefer: "private",
    onlyPrivate: true,
    onlyKnownFriend: false,
  }).catch(error => ({ ok: false, reason: error.message }))
  if (!sent?.ok) {
    await ctx.reply(`[荷花插件]签到实时日志私聊推送失败：${sent?.reason || "unknown"}（主人 ${wxid} 请确认与 bot 私聊通道可用）`)
    return
  }
  await ctx.reply(`[荷花插件]签到实时日志已私聊发送（${lines.length} 条）。`)
}

// ---- 签到实时后台链接（apps/checkinDashboard.js buildDashboardLink 复用）----
async function runDashboardLink(ctx) {
  const { buildDashboardLink } = await import("./apps/checkinDashboard.js")
  const link = await buildDashboardLink()
  if (!link.ok) {
    await ctx.reply(`[荷花插件]${link.reason}，无法生成签到后台链接。`)
    return
  }
  const sent = await notifyUser(ctx.e.user_id,
    `[荷花插件]签到实时后台（浏览器打开，状态与日志自动刷新）：\n${link.url}\n`
    + `电脑本机可用：${link.lanUrl}\n令牌存于插件 data/checkin-dashboard-token.txt。`, {
    bot: globalThis.Bot,
    prefer: "private",
    onlyPrivate: true,
    onlyKnownFriend: false,
  }).catch(error => ({ ok: false, reason: error.message }))
  if (!sent?.ok) {
    await ctx.reply(`[荷花插件]看板链接私聊推送失败：${sent?.reason || "unknown"}`)
    return
  }
  await ctx.reply("[荷花插件]签到实时后台链接已私聊发送。")
}

// ---- 生成明日签到计划（复刻 adminCheckin.runRegisterAll 的计划重生成段）----
async function runGeneratePlan(ctx) {
  const config = await loadGlobalConfig()
  const scheduler = new SchedulerService({ config: config.scheduler })
  const scheduled = new ScheduledSigninService({ scheduler, bot: globalThis.Bot })
  const generated = await scheduled.ensureTomorrowPlanAndNotify({
    config,
    force: true,
    forceNotify: true,
    bot: globalThis.Bot,
  })
  const planEntries = generated.plan?.entries?.length || 0
  const notified = (generated.notifications || []).filter(n => n.sent?.ok).length
  await ctx.reply(`[荷花插件]明日签到计划已强制重生成：${planEntries} 条，时间通知已按用户所在群群发 ${notified} 条。`)
}

// ---- 自定义指令：逐条执行「自定义指令文本」里的前台指令 ----
async function runCustomCommand(ctx) {
  const config = await loadGlobalConfig().catch(() => ({}))
  const lines = String(config.actions?.command_text || "")
    .split(/[\n;；]/)
    .map(line => line.trim())
    .filter(Boolean)
  if (!lines.length) {
    await ctx.reply("[荷花插件]「自定义指令文本」为空：请先在锅巴里填写指令（每行一条，# 开头），再触发本动作。")
    return
  }
  const blacklist = normalizeCommandBlacklist(config.actions?.command_blacklist)
  for (const line of lines) {
    const blocked = isCommandBlocked(line, blacklist)
    if (blocked) {
      await ctx.reply(`[荷花插件]指令「${line}」命中黑名单「${blocked}」已拒绝（可在锅巴「指令黑名单」调整）。`)
      continue
    }
    try {
      await runCommandText(line, ctx)
    } catch (error) {
      globalThis.logger?.warn?.(`[Lotus-Plugin][锅巴动作] 自定义指令「${line}」失败：${error.message}`)
      await ctx.reply(`[荷花插件]指令「${line}」执行失败：${error.message}`)
    }
  }
}

// ---- 通用前台指令调度（锅巴后台 → 无头事件 → rule 匹配 → 执行）----
function normalizeCommandBlacklist(value) {
  // 未配置（undefined/null）→ 用 defaults 的默认黑名单；显式 [] → 放行全部
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  return ["更新图鉴", "远程"]
}

// 纯函数：黑名单子串匹配，命中返回命中的串，否则 ""
export function isCommandBlocked(text, blacklist) {
  const s = String(text || "")
  for (const pattern of Array.isArray(blacklist) ? blacklist : normalizeCommandBlacklist(blacklist)) {
    if (pattern && s.includes(pattern)) return pattern
  }
  return ""
}

// 纯函数：在给定的 apps（index.js 导出的包装类集合）里按 rule 正则匹配指令。
// 返回 { name, AppClass, instance, entry }，无匹配返回 null。构造失败的 app 跳过。
export function matchCommandRule(apps, text) {
  const message = String(text || "").trim()
  if (!message) return null
  for (const [name, AppClass] of Object.entries(apps || {})) {
    let instance
    try {
      instance = new AppClass()
    } catch (error) {
      globalThis.logger?.debug?.(`[Lotus-Plugin][锅巴动作] 实例化 ${name} 失败，跳过：${error.message}`)
      continue
    }
    for (const entry of instance.rule || []) {
      try {
        if (entry?.fnc && entry?.regex instanceof RegExp && entry.regex.test(message)) {
          return { name, AppClass, instance, entry }
        }
      } catch { /* 单条正则异常不阻塞遍历 */ }
    }
  }
  return null
}

// 纯函数：把指令文本投递给命中的 app 实例执行（无头事件，等价真实消息触达）。
export async function dispatchCommand(match, text, ctx) {
  const e = {
    user_id: ctx.e.user_id,
    sender: { user_id: ctx.e.user_id, nickname: accountDisplay(ctx.e.user_id) },
    isGroup: false,
    isMaster: true,
    msg: text,
    message: text,
    logText: text,
    reply: ctx.reply,
    bot: globalThis.Bot,
    self_id: globalThis.Bot?.uin || globalThis.Bot?.self_id,
  }
  match.instance.e = e
  const fnc = match.instance[match.entry.fnc]
  if (typeof fnc !== "function") {
    throw new Error(`指令处理函数 ${match.entry.fnc} 不存在（${match.name}）`)
  }
  await fnc.call(match.instance)
}

// 入口：黑名单检查 → 加载 apps（动态 import，插件运行时 index.js 已加载完成）→ 匹配 → 执行
export async function runCommandText(rawText, ctx) {
  const text = String(rawText || "").trim()
  if (!text) throw new Error("指令为空")

  const config = await loadGlobalConfig().catch(() => ({}))
  const blocked = isCommandBlocked(text, normalizeCommandBlacklist(config.actions?.command_blacklist))
  if (blocked) throw new Error(`指令命中黑名单「${blocked}」，已在锅巴后台禁用（可调整「指令黑名单」放行）`)

  const { apps } = await import("./index.js")
  const match = matchCommandRule(apps, text)
  if (!match) throw new Error(`没有已注册指令匹配「${text}」`)
  globalThis.logger?.info?.(`[Lotus-Plugin][锅巴动作] 自定义指令「${text}」命中 ${match.name} → ${match.entry.fnc}`)
  await dispatchCommand(match, text, ctx)
}
