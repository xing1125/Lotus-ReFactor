const BasePlugin = globalThis.plugin

import { loadGlobalConfig, saveGlobalConfig } from "../core/config/global.js"
import { PermissionService } from "../core/permissions/service.js"
import { replyText } from "../core/transport/reply.js"
import { notifyUser } from "../core/transport/notify.js"
import { renderTemplate } from "../core/render/service.js"
import { SchedulerService, dateString } from "../core/scheduler/service.js"
import { listAllProfiles } from "../core/config/profile.js"
import { accountLabel } from "../services/checkin/account.js"
import { buildCheckinStatsData } from "../services/checkin/statsBuilder.js"
import { accountDisplay } from "../services/checkin/account.js"

// 实时签到人数看板指令（git untracked，git pull 安全）
//
// 命令格式：
//   #签到人数          查看各群今日实时签到情况，看板私聊发给触发者
//   #签到看板          同上（别名）
//   #签到统计          同上（别名）
//
// 行为：
//   1. 读取今日签到计划（data/schedules/YYYY-MM-DD.json）
//   2. 通过 profile.notify.fallback_groups 把每个计划项归入所属群
//   3. 聚合每群的「已签 / 总数 / 成功 / 失败 / 待签 / 成功率」
//   4. 渲染看板图，私聊发给触发指令的人（不在群里刷）
//   5. 群里只回一句「已私发」提示
const STATS_RE = /^#签到(人数|看板|统计)/

export class LotusCheckinStats extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Checkin Stats",
      dsc: "实时签到人数看板：聚合各群签到进度，私聊发给触发者",
      event: "message",
      priority: 20,
      rule: [
        { reg: STATS_RE, fnc: "stats" },
      ],
    })
  }

  async stats() {
    const globalConfig = await loadGlobalConfig()
    const permission = new PermissionService({ permissions: globalConfig.permissions })
      .explain(this.e, "scheduler.manage")
    if (!permission.ok) {
      await replyText(this, "[荷花插件]只有 bot 主人可以查看签到看板。")
      return true
    }

    // 记录主人 wxid，供自动推送读取。首次触发即绑定。
    await rememberMasterId(this.e.user_id).catch(err => {
      logger?.warn?.(`[Lotus-Plugin] rememberMasterId failed: ${err.message}`)
    })

    const date = dateString(new Date())
    const plan = await new SchedulerService().getPlan(date)
    if (!plan) {
      await replyText(this, `[荷花插件]今日（${date}）签到计划尚未生成，暂无实时数据。请先执行 #群签到部署 或等待午夜自动生成计划。`)
      return true
    }

    // 群归属映射 + 按群聚合（单一数据源：services/checkin/statsBuilder.js，
    // 与主人自动汇总推送复用，避免漂移）
    const profiles = await listAllProfiles()
    const { groups, summary, knownGroups, totals } = buildCheckinStatsData(plan, profiles)
    const totalAll = totals.all
    const totalDone = totals.done
    const overallRate = totals.rate

    const triggerId = this.e.user_id || this.e.sender?.user_id || ""
    const image = await renderTemplate("checkin-stats", {
      title: "实时签到看板",
      subtitle: `${date} · 共 ${knownGroups.length} 个群 · ${totalDone}/${totalAll} 已签`,
      badge: "STATS",
      message: `触发人 ${accountDisplay(triggerId) || "BOT主人"}`,
      summary,
      groups,
    }, { saveId: `lotus-checkin-stats-${triggerId || "master"}` })

    // 严格私聊：私聊失败不进群兜底（微信下自己非好友会触发）。
    // onlyKnownFriend:false → 跳过好友白名单，直接走 bot.sendFriendMsg 把图发到主人真实私聊
    // （filehelper 能发通正是因为同一条 sendFriendMsg 通道，换成主人 wxid 即可直发主人私聊）。
    const sent = await notifyUser(triggerId, image, { bot: globalThis.Bot, prefer: "private", onlyPrivate: true, onlyKnownFriend: false })
    if (sent.ok && sent.channel === "private") {
      await replyText(this, `[荷花插件]实时签到看板已私聊发给你（BOT主人）：${knownGroups.length} 个群、今日已签 ${totalDone}/${totalAll} 人、成功率 ${overallRate}。`)
      return true
    }
    // 私聊失败 → 兜底发到「文件传输助手」(微信系统号，bot.sendFriendMsg 总是可达)
    // QQ 适配器通常没有 filehelper，会失败 → 群内文字提示
    const fh = await trySendFileHelper(globalThis.Bot, image)
    if (fh.ok) {
      await replyText(this, `[荷花插件]私聊通道不可用（${sent.reason || "private_unavailable"}），实时签到看板已发到微信【文件传输助手】，请到「文件传输助手」聊天查看。\n概览：${knownGroups.length} 个群、今日已签 ${totalDone}/${totalAll} 人、成功率 ${overallRate}。`)
    } else {
      await replyText(this, `[荷花插件]看板已生成，但私聊与文件传输助手均不可用（私聊:${sent.reason || "-"}；文件助手:${fh.reason || "-"}）。请确认你与 bot 的好友/私聊通道可用后重试 #签到看板。\n概览：${knownGroups.length} 个群、今日已签 ${totalDone}/${totalAll} 人。`)
    }
    return true
  }
}

// 记录主人 wxid 到 global.yaml，自动推送时读取。
// 多次调用安全（重复写同值）、不抛错（个人文件读写失败仅 warn）。
async function rememberMasterId(userId) {
  if (!userId) return
  const config = await loadGlobalConfig()
  config.master = config.master || {}
  if (config.master.wxid === String(userId)) return
  config.master.wxid = String(userId)
  await saveGlobalConfig(config)
}

// 兜底：私聊通道不可用时（如微信下自己不在 bot 好友表），
// 把图发到「文件传输助手」——微信系统号，bot.sendFriendMsg 总是可达，
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
