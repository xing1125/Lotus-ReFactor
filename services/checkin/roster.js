// 自动签到「群 / 员名单」统计（git untracked，git pull 安全）
//
// 枚举所有已开启自动签到(enabled + notify.enable)的 profile，
// 按「群成员关系(bot.gml) + 各 profile 的 notify.fallback_groups」归组，
// 输出 { byGroup, groupName, totalEnrolled, totalProfiles }。
// 供 apps/checkinRoster.js（聊天命令 #自动签到名单）与 guoba.support.js（锅巴只读名单）共用。
//
// 跨群说明：profile 是全局存储，通知投递会遍历用户所在每个群，
// 所以「名单」天然是跨群的——这里只是把「谁在哪个群的自动签到名单里」可视化出来。

import { listAllProfiles } from "../../core/config/profile.js"

// 成员表可能是 Map<qq, info> / Set<qq> / Array / 普通对象；统一判定是否含某 id
function memberHasId(members, id) {
  if (!members) return false
  const sid = String(id)
  const nid = Number(id)
  if (Number.isNaN(nid)) return false
  if (members instanceof Map) return members.has(nid) || members.has(sid)
  if (members instanceof Set) return members.has(nid) || members.has(sid)
  if (Array.isArray(members)) {
    return members.some(m => {
      const v = m?.user_id ?? m?.qq ?? m
      return String(v) === sid || Number(v) === nid
    })
  }
  if (typeof members === "object") return sid in members || nid in members
  return false
}

function listAllGroupIds(bot) {
  const gl = bot?.getGroupList?.()
  if (gl instanceof Map) return [...gl.keys()].map(String)
  if (Array.isArray(gl)) return gl.map(g => String(g?.group_id ?? g)).filter(Boolean)
  return []
}

// 返回 { byGroup: Map<groupId, [{qq,nick,p}]>, groupName: Map, totalEnrolled, totalProfiles, hasBot }
export async function buildRoster() {
  const bot = globalThis.Bot
  const groups = (typeof bot?.getGroupList === "function") ? (bot.getGroupList() || []) : []
  const groupName = new Map()
  for (const g of (Array.isArray(groups) ? groups : [])) {
    const id = String(g?.group_id ?? g)
    if (id) groupName.set(id, g?.group_name || String(g?.group_id ?? g))
  }

  const gml = bot?.gml instanceof Map ? bot.gml : null

  const profiles = await listAllProfiles().catch(() => [])
  const enrolled = profiles.filter(p => p.enabled === true && p.profile?.notify?.enable === true && p.user?.qq)

  const byGroup = new Map()
  const noGroup = []
  for (const p of enrolled) {
    const qq = String(p.user.qq)
    const nick = p.user?.nickname || ""
    const pid = p.profile?.id || 1
    const inGroups = []
    if (gml) {
      for (const [gid, members] of gml) {
        if (memberHasId(members, qq)) inGroups.push(String(gid))
      }
    }
    for (const g of (p.profile?.notify?.fallback_groups || [])) {
      const gs = String(g)
      if (gs && !inGroups.includes(gs)) inGroups.push(gs)
    }
    if (inGroups.length === 0) {
      noGroup.push({ qq, nick, p: pid })
      continue
    }
    for (const gid of inGroups) {
      if (!byGroup.has(gid)) byGroup.set(gid, [])
      byGroup.get(gid).push({ qq, nick, p: pid })
    }
  }

  return { byGroup, noGroup, groupName, totalEnrolled: enrolled.length, totalProfiles: profiles.length }
}

// 把 roster 结构格式化为可读文本（聊天/锅巴共用）
export function formatRosterMarkdown(roster) {
  const { byGroup, noGroup, groupName, totalEnrolled, totalProfiles } = roster
  const lines = []
  lines.push("【自动签到群 / 员名单】")
  lines.push(`已开启自动签到的账号：${totalEnrolled} 个（共 ${totalProfiles} 个 profile）`)
  lines.push("")

  // 先按群号排序，保证稳定输出
  const groupIds = [...byGroup.keys()].sort((a, b) => a.localeCompare(b))
  for (const gid of groupIds) {
    const members = byGroup.get(gid)
    const name = groupName.get(gid) || gid
    lines.push(`▸ 群 ${name}（${gid}）：${members.length} 人`)
    for (const m of members) {
      const label = m.nick ? `${m.nick}（${m.qq}）` : m.qq
      lines.push(`    - ${label}${m.p && m.p !== 1 ? ` · P${m.p}` : ""}`)
    }
    lines.push("")
  }

  if (noGroup.length) {
    lines.push(`▸ 未匹配到群（仅 fallback / 无群成员记录）：${noGroup.length} 人`)
    for (const m of noGroup) {
      const label = m.nick ? `${m.nick}（${m.qq}）` : m.qq
      lines.push(`    - ${label}${m.p && m.p !== 1 ? ` · P${m.p}` : ""}`)
    }
    lines.push("")
  }

  if (!totalEnrolled) {
    lines.push("（暂无已开启自动签到的账号。扫码登录现已自动加入名单，或用 #全员注册签到 批量开启。）")
  }
  return lines.join("\n")
}

export { listAllGroupIds }
