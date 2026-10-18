// 一键重置所有人：签到结果强制进对应的群（git untracked，git pull 安全）
//
// 设计：
//   1. 从 bot.gml（群成员表）反查「每个用户 → 其所在的群」作为「对应的群」。
//   2. 对所有已扫码 profile 执行重置：
//        profile.profile.notify.prefer   = "group"
//        profile.profile.notify.enable    = true
//        profile.profile.notify.fallback_groups 合并进「对应的群」
//      这样 notify.js 在派发时会最先命中用户真正所在的群（确定性投递）。
//   3. 强制重生成明日计划并群发明日时间通知（跨群同步）。
//   4. 默认只做配置重置（秒级完成）；加 `补签`/`立即` 子命令会再立刻把当前签到结果
//      强制推到对应群（复用 adminCheckin 的 runResignAll，逐账号限速、带验证码回传）。
//
// 命令（bot 主人权限）：
//   #全员进群重置                —— 一键重置所有人：结果强制进对应群（配置 + 计划）
//   #全员进群重置 补签           —— 在上述基础上，立即把当前签到结果推到对应群
//   #全员进群重置 立即补签       —— 同上
//
// 与既有指令边界：
//   - 区别于 #群签到部署：按群成员注册、需指定/当前群；本指令按「全部已扫码 profile」，
//     以 bot.gml 反查每个用户的对应群，不依赖在哪条群消息里触发。
//   - 区别于 #全员注册签到：它把「所有群」都写进 fallback_groups；本指令只写「对应的群」，
//     并把「立即把结果推到群」作为可选一步，更贴合「强制进对应的群」诉求。
const BasePlugin = globalThis.plugin

import {
  listAllProfiles,
  loadProfile,
  saveProfile,
  hasProfileLogin,
} from "../core/config/profile.js"
import { loadGlobalConfig } from "../core/config/global.js"
import { renderStatusCard } from "../core/render/service.js"
import { replyImage, replyText } from "../core/transport/reply.js"
import { SchedulerService } from "../core/scheduler/service.js"
import { ScheduledSigninService } from "../services/checkin/scheduled.js"
import { runResignAll } from "./adminCheckin.js"

export class LotusAllGroupReset extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] All Group Reset",
      dsc: "一键重置所有人：签到结果强制进对应的群",
      event: "message",
      priority: 18,
      rule: [
        { reg: "^#全员进群重置", fnc: "reset", permission: "master" },
      ],
    })
  }

  async reset() {
    const tail = String(this.e.msg || "").replace(/^#全员进群重置\s*/, "").trim()
    const doResign = /补签|立即/.test(tail)

    const bot = globalThis.Bot
    const userGroups = buildUserGroupMap(bot)

    const profiles = (await listAllProfiles()).filter(hasProfileLogin)
    if (!profiles.length) {
      await replyText(this, "[荷花插件]没有找到可重置的「已扫码」profile。请确认用户已通过 #扫码登录 绑定账号。")
      return true
    }

    let reset = 0
    let withGroup = 0
    let noGroup = 0
    const samples = []
    for (const base of profiles) {
      const qq = base.user?.qq
      const profileId = base.profile?.id || 1
      const profile = await loadProfile(qq, profileId).catch(() => base)
      const groups = [...(userGroups.get(String(qq)) || userGroups.get(Number(qq)) || [])]

      profile.profile ||= {}
      profile.profile.notify ||= {}
      let changed = false
      if (profile.profile.notify.prefer !== "group") {
        profile.profile.notify.prefer = "group"
        changed = true
      }
      if (profile.profile.notify.enable !== true) {
        profile.profile.notify.enable = true
        changed = true
      }
      const cur = new Set((profile.profile.notify.fallback_groups || []).map(String))
      let added = 0
      for (const g of groups) {
        if (!cur.has(String(g))) {
          cur.add(String(g))
          added++
        }
      }
      if (added) {
        profile.profile.notify.fallback_groups = [...cur]
        changed = true
      }
      if (changed) {
        await saveProfile(profile)
        reset++
      }
      if (groups.length) withGroup++
      else noGroup++
      if (changed && samples.length < 10) {
        samples.push({ qq, profileId, groups: groups.length })
      }
    }

    // 4. 强制重生成明日计划 + 群发明日时间通知（跨群同步）
    let planEntries = 0
    let notified = 0
    try {
      const gc = await loadGlobalConfig()
      const scheduler = new SchedulerService({ config: gc.scheduler })
      const scheduled = new ScheduledSigninService({ scheduler, bot })
      const gen = await scheduled.ensureTomorrowPlanAndNotify({
        config: gc,
        force: true,
        forceNotify: false,
        bot,
      })
      planEntries = gen.plan?.entries?.length || 0
      notified = (gen.notifications || []).filter(n => n.sent?.ok).length
    } catch (error) {
      logger?.error?.(`[Lotus-Plugin] all-group-reset regen plan failed: ${error.stack || error.message}`)
    }

    const items = [
      { label: "重置 profile 数", value: String(reset) },
      { label: "已绑定对应群", value: String(withGroup) },
      { label: "未查到对应群", value: `${noGroup}（将回落到所在群/私聊兜底）` },
      { label: "明日计划", value: planEntries ? `${planEntries} 条已重生成` : "生成失败，将于午夜自动重试" },
      { label: "明日时间通知", value: `已群发 ${notified} 条` },
      { label: "立即补签", value: doResign ? "是，马上把结果推到对应群" : "否（仅重置配置）" },
    ]
    for (const s of samples) {
      items.push({
        label: `账号 ${s.qq} · P${s.profileId}`,
        value: s.groups ? `已绑定 ${s.groups} 个对应群` : "未查到对应群",
      })
    }

    const image = await renderStatusCard({
      title: "全员进群重置",
      subtitle: `管理员 账号 ${this.e.user_id}`,
      badge: `${withGroup}/${profiles.length}`,
      message: doResign
        ? `已为 ${profiles.length} 个已扫码 profile 重置通知为「进对应群」，并立即把当前签到结果推送到各自对应的群。`
        : `已为 ${profiles.length} 个已扫码 profile 重置通知为「进对应群」（其中 ${withGroup} 个已查到对应群并写入 fallback_groups）。后续签到/今晚计划将直接进群；如需立刻看到结果，重发「#全员进群重置 补签」。`,
      userId: this.e.user_id,
      items,
    }, {
      saveId: `lotus-allgroup-reset-${this.e.user_id || "master"}-${Date.now()}`,
    })
    await replyImage(this, image, "[荷花插件]全员进群重置完成。")

    if (doResign) {
      // 复用 adminCheckin 的全体二次签到：逐账号限速、验证码回传，结果卡投递到对应群
      await runResignAll(this, "")
    }
    return true
  }
}

// 从 bot.gml 反查 userId -> 所在群集合（支持 OneBot V12 / ComWeChat 的 wxid 与数字 QQ）
function buildUserGroupMap(bot) {
  const map = new Map()
  const gml = bot?.gml
  if (!(gml instanceof Map)) return map
  for (const [groupId, members] of gml.entries()) {
    const gid = String(groupId)
    let userIds = []
    if (members instanceof Map) {
      userIds = [...members.keys()]
    } else if (Array.isArray(members)) {
      userIds = members.map(m => (m && (m.user_id ?? m.user_id)) || m).filter(Boolean)
    }
    for (const u of userIds) {
      const uid = String(u)
      if (!uid) continue
      if (!map.has(uid)) map.set(uid, new Set())
      map.get(uid).add(gid)
    }
  }
  return map
}
