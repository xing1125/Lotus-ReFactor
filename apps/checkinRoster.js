// 自动签到群 / 员名单查看指令（git untracked，git pull 安全，仅 bot 主人）
//
// 命令：#自动签到名单 / #签到群名单 / #群签到名单 / #群名单 / #签到名单
// 输出：按群分组的「已开启自动签到」成员清单（跨群）。
// 底层统计复用 services/checkin/roster.js（与锅巴只读名单同源）。

const BasePlugin = globalThis.plugin

import { buildRoster, formatRosterMarkdown } from "../services/checkin/roster.js"
import { replyText, replyImage } from "../core/transport/reply.js"
import { renderStatusCard } from "../core/render/service.js"

export class LotusCheckinRoster extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Checkin Roster",
      dsc: "查看自动签到群 / 员名单（跨群）",
      event: "message",
      priority: 20,
      rule: [
        {
          reg: "^#(自动签到名单|自动签到群名单|签到群名单|群签到名单|群名单|签到名单)$",
          fnc: "showRoster",
          permission: "master",
        },
      ],
    })
  }

  async showRoster() {
    if (typeof globalThis.Bot === "undefined") {
      await replyText(this, "[荷花插件]Bot 尚未就绪，暂无法读取群成员名单。")
      return true
    }
    const roster = await buildRoster().catch(error => {
      logger?.error?.(`[Lotus-Plugin] buildRoster failed: ${error.stack || error.message}`)
      return null
    })
    if (!roster) {
      await replyText(this, "[荷花插件]读取群 / 员名单失败，请查看运行日志。")
      return true
    }
    // 可视化卡片：汇总磁贴 + 按群分组的成员明细行（超量自动截断并标注）
    const items = [
      { label: "已开启账号", value: String(roster.totalEnrolled) },
      { label: "profile 总数", value: String(roster.totalProfiles) },
    ]
    const CAP_PER_GROUP = 10
    const CAP_TOTAL = 34
    let shown = 0
    let hidden = 0
    const groupIds = [...roster.byGroup.keys()].sort((a, b) => String(a).localeCompare(String(b)))
    for (const gid of groupIds) {
      const members = roster.byGroup.get(gid) || []
      const name = roster.groupName.get(gid) || gid
      items.push({ label: `群 ${name}`, value: `${members.length} 人` })
      const head = members.slice(0, CAP_PER_GROUP)
      for (const m of head) {
        if (shown >= CAP_TOTAL) { hidden++; continue }
        const label = m.nick ? `· ${m.nick}（${m.qq}）` : `· ${m.qq}`
        items.push({ label, value: m.p && m.p !== 1 ? `P${m.p}` : "" })
        shown++
      }
      const rest = members.length - head.length
      if (rest > 0) {
        items.push({ label: "· …", value: `该群另有 ${rest} 人` })
        hidden += rest
      }
    }
    if (roster.noGroup?.length) {
      items.push({ label: "未匹配到群", value: `${roster.noGroup.length} 人（仅 fallback / 无群成员记录）` })
    }
    if (!roster.totalEnrolled) {
      items.push({ label: "提示", value: "暂无已开启自动签到的账号，扫码登录即自动加入" })
    } else if (hidden > 0) {
      items.push({ label: "更多", value: `另有 ${hidden} 人未展开` })
    }

    const image = await renderStatusCard({
      title: "自动签到群 / 员名单",
      subtitle: "跨群 · 按群分组成员（已开启自动签到）",
      badge: String(roster.totalEnrolled),
      message: `已开启自动签到的账号 ${roster.totalEnrolled} 个（共 ${roster.totalProfiles} 个 profile）。扫码登录现已自动加入名单；也可用 #全员注册签到 批量开启。#清理误注册群 可修正误写入的投递群。`,
      userId: this.e?.user_id,
      items,
    }, { saveId: `lotus-roster-${this.e?.user_id || "master"}-${Date.now()}` })
    await replyImage(this, image, "[荷花插件]自动签到名单已生成。")
    return true
  }
}

export { buildRoster, formatRosterMarkdown }
