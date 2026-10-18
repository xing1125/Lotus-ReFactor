// 离线探针：验证 apps/help.js 的分组索引与输入解析（不依赖 Yunzai 运行时）
// 运行：node _probe_help.mjs
globalThis.plugin = class { constructor(o) { Object.assign(this, o) } }

const { GROUPS, resolveGroups } = await import("./apps/help.js")

const names = GROUPS.map(g => g.name)
const itemTotal = GROUPS.reduce((s, g) => s + (g.items?.length || 0), 0)

console.log("分组数 =", GROUPS.length)
console.log("分组名 =", names.join(" / "))
console.log("条目总数 =", itemTotal)

// 每个条目必须有 title，desc 可缺省
const bad = []
for (const g of GROUPS) {
  if (!g.name) bad.push("分组缺 name")
  if (!Array.isArray(g.items) || !g.items.length) bad.push(`${g.name} 缺 items`)
  for (const it of g.items || []) {
    if (!it.title) bad.push(`${g.name} 条目缺 title`)
    if (!it.desc) bad.push(`${g.name} 条目缺 desc: ${it.title}`)
  }
}
console.log("结构校验 =", bad.length ? "FAIL\n  " + bad.join("\n  ") : "OK")

const cases = [
  ["", GROUPS.length],
  ["基础", 1],
  ["登录与账号", 1],
  ["自动签到", 2],
  ["签到", 2],
  ["游戏查询", 1],
  ["图鉴与成就", 1],
  ["体力", 1],
  ["抽卡记录", 1],
  ["视频", 1],
  ["工具与权限", 1],
  ["管理命令", 1],
  ["全局", 1],
  ["不存在的分组", 0],
]
let pass = 0
for (const [arg, want] of cases) {
  const got = resolveGroups(arg).length
  const ok = got === want
  if (ok) pass++
  console.log(`${ok ? "OK  " : "FAIL"} resolveGroups(${JSON.stringify(arg)}) -> ${got} (want ${want})`)
}
console.log(`解析用例 = ${pass}/${cases.length}`)
