// 共享：把「今日签到计划 + 全部 profile」聚合成
// 「按群分组、每组展开每个人具体签到信息（各游戏成功/失败/关闭 + 天数）」的数据。
//
// 单一数据源，供两条路径复用，避免漂移：
//   1. 手动指令  #签到看板 / #签到人数 / #签到统计  （apps/checkinStats.js）
//   2. 签到全部完成后自动私聊推给 BOT主人            （services/checkin/scheduled.js）
//
// 纯函数（不渲染、不读写文件），调用方负责渲染与发送。
import { accountDisplay } from "./account.js"
import { resolveDisplayName } from "./profileSignin.js"

export function buildCheckinStatsData(plan, profiles = []) {
  if (!plan || !Array.isArray(plan.entries) || !plan.entries.length) {
    return { groups: [], summary: [], knownGroups: [], totals: emptyTotals() }
  }

  // 群归属映射：profile.notify.fallback_groups（部署时写入，严格"用户实际所在群"）
  // profile 显示名映射：profile.user.nickname（手动 #设置昵称写入；微信下通常为空 → 回退裸 wxid）
  const groupOf = new Map()
  const profileOf = new Map()
  for (const p of profiles) {
    const qq = String(p?.user?.qq || "")
    const pid = Number(p?.profile?.id || 1)
    const groups = p?.profile?.notify?.fallback_groups || []
    if (qq) {
      if (groups.length) groupOf.set(`${qq}|${pid}`, groups.map(String))
      profileOf.set(`${qq}|${pid}`, p)
    }
  }

  // 按群聚合：每个群下挂成员列表（含每人具体签到信息）
  const agg = new Map()
  for (const entry of plan.entries) {
    const key = `${String(entry.qq)}|${Number(entry.profileId || 1)}`
    const groups = groupOf.get(key) || ["未分组"]
    const profile = profileOf.get(key)
    // 显示名解析：profile.user.nickname → account.game_roles[*].nickname → 平台标签。
    // 与 profileSignin.js#resolveDisplayName 保持一致（个别签到结果卡已用此链，
    // 主人汇总看板此前仅 user.nickname → 平台标签，故微信下大多数行退化为截断 wxid）。
    const displayName = resolveDisplayName(profile) || accountDisplay(String(entry.qq || ""), profile?.user?.platform)
    const result = entry.result && typeof entry.result === "object" ? entry.result : null
    const games = Array.isArray(result?.games) ? result.games : []
    const member = {
      qq: String(entry.qq || ""),
      profileId: Number(entry.profileId || 1),
      name: displayName,
      status: entry.done === true ? (entry.ok === true ? "ok" : "fail") : "pending",
      time: entry.time || "",
      doneAt: entry.doneAt || "",
      message: entry.message || result?.message || "",
      games,
    }
    for (const gid of groups) {
      if (!agg.has(gid)) {
        agg.set(gid, {
          groupId: gid,
          total: 0,
          done: 0,
          ok: 0,
          fail: 0,
          pending: 0,
          members: [],
        })
      }
      const a = agg.get(gid)
      a.total++
      if (member.status === "ok") { a.done++; a.ok++ }
      else if (member.status === "fail") { a.done++; a.fail++ }
      else { a.pending++ }
      a.members.push(member)
    }
  }

  // 排序：已知群优先 + 总数降序
  const groups = [...agg.values()].sort((a, b) => {
    const aKnown = a.groupId !== "未分组" ? 0 : 1
    const bKnown = b.groupId !== "未分组" ? 0 : 1
    if (aKnown !== bKnown) return aKnown - bKnown
    return b.total - a.total
  })
  const knownGroups = groups.filter(g => g.groupId !== "未分组")
  const totals = {
    all: groups.reduce((s, g) => s + g.total, 0),
    done: groups.reduce((s, g) => s + g.done, 0),
    ok: groups.reduce((s, g) => s + g.ok, 0),
    fail: groups.reduce((s, g) => s + g.fail, 0),
    pending: groups.reduce((s, g) => s + g.pending, 0),
  }
  totals.rate = totals.all ? `${Math.round(totals.ok / totals.all * 100)}%` : "-"

  // 每个群的成功率 + 成员按 (ok 优先 > fail > pending > 时间) 排序
  for (const g of groups) {
    g.rate = g.total ? `${Math.round(g.ok / g.total * 100)}%` : "-"
    g.members.sort((a, b) => {
      const order = { ok: 0, fail: 1, pending: 2 }
      const oa = order[a.status] ?? 9
      const ob = order[b.status] ?? 9
      if (oa !== ob) return oa - ob
      return (a.time || "").localeCompare(b.time || "")
    })
  }

  const summary = [
    { label: "部署群数", value: String(knownGroups.length) },
    { label: "已部署", value: `${totals.all} 人` },
    { label: "今日已签", value: `${totals.done} 人` },
    { label: "成功", value: `${totals.ok} 人` },
    { label: "失败", value: `${totals.fail} 人` },
    { label: "待签", value: `${totals.pending} 人` },
  ]
  return { groups, summary, knownGroups, totals }
}

export function buildStatsText(date, knownGroups, groups, totals) {
  const lines = [
    `签到汇总（${date}）`,
    `群数：${knownGroups.length}　已签：${totals.done}/${totals.all}　成功：${totals.ok}　失败：${totals.fail}　待签：${totals.pending}　成功率：${totals.rate}`,
    "",
  ]
  for (const g of groups) {
    lines.push(`— 群 ${g.groupId}（${g.rate}）`)
    for (const m of g.members) {
      const mark = m.status === "ok" ? "✓" : m.status === "fail" ? "✕" : "⏳"
      const games = m.games.length
        ? m.games.map(gr => {
            if (gr.label === "社区") return `社区${gr.community === "关闭" ? "(关)" : gr.community === "失败" ? "失败" : "成功"}`
            return `${gr.label}${gr.game === "关闭" ? "(关)" : gr.game === "失败" ? "失败" : `成功${gr.days ? gr.days + "天" : ""}`}`
          }).join(" ")
        : (m.status === "pending" ? "待签" : (m.message || "无详情"))
      lines.push(`  ${mark} ${m.name}　${m.time || ""}　${games}`)
    }
    lines.push("")
  }
  return lines.join("\n").trim()
}

function emptyTotals() {
  return { all: 0, done: 0, ok: 0, fail: 0, pending: 0, rate: "-" }
}
