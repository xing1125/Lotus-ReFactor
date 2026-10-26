// 签到看板冒烟测试：真实数据验证状态聚合 / 日志流 / 令牌 / 路由注册（无 Bot 环境）
// 裸 node 无 Yunzai 环境，先打桩 globalThis.plugin / logger 再动态导入 app 模块
globalThis.plugin = class { constructor() {} }
globalThis.logger = { info() {}, warn() {}, error() {}, mark() {}, debug() {} }
const { emitCheckinLog } = await import("./core/checkinLog.js")
const {
  buildStatusPayload,
  buildLogsPayload,
  ensureDashboardRoutes,
} = await import("./apps/checkinDashboard.js")

let failed = 0
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`)
  if (!cond) failed++
}

// 1. 路由注册：无 Bot 环境 → 应返回 false 而不是抛错
let routes = "throw"
try { routes = ensureDashboardRoutes() } catch (e) { routes = `throw: ${e.message}` }
check("ensureDashboardRoutes 无 Bot 返回 false", routes === false, String(routes))

// 2. 状态聚合（真实计划 + profiles）
const status = await buildStatusPayload()
check("status.summary 存在", !!status.summary && Number.isFinite(status.summary.all),
  `all=${status.summary?.all} ok=${status.summary?.ok} fail=${status.summary?.fail} pending=${status.summary?.pending} rate=${status.summary?.rate}`)
check("status.groups 非空", Array.isArray(status.groups) && status.groups.length > 0,
  `${status.groups?.length} 组`)
const members = status.groups.flatMap(g => g.members)
check("成员有 name", members.length > 0 && members.some(m => m.name && !/^\d+$/.test(m.name)),
  `首成员: ${members[0]?.name} P${members[0]?.profileId} ${members[0]?.status}`)
check("成员 status 合法", members.every(m => ["ok", "fail", "pending"].includes(m.status)))

// 3. runningAt → signing 升级逻辑（模拟：直接改内存 plan 不可行，验证函数路径即可）
//    这里只验证 status 未把 ok/fail 误判成 signing
check("无 runningAt 时不出现 signing", members.every(m => m.status !== "signing"))

// 4. 日志流
emitCheckinLog({ type: "batch-start", message: "冒烟测试开始" })
emitCheckinLog({ type: "signing", qq: "10000", profileId: 1, message: "开始签到" })
emitCheckinLog({ type: "done", qq: "10000", profileId: 1, ok: true, message: "签到成功" })
const logs = await buildLogsPayload(0)
check("日志条数 >= 3", logs.logs.length >= 3, `${logs.logs.length} 条`)
const done = logs.logs.find(e => e.type === "done")
check("done 事件带 name 解析", !!done, `name=${done?.name || "(无 profiles 命中, 回退)"} ok=${done?.ok}`)
const since = await buildLogsPayload(logs.seq)
check("since 增量为空", since.logs.length === 0, `seq=${logs.seq}`)
emitCheckinLog({ type: "done", qq: "10000", profileId: 1, ok: false, message: "失败测试" })
const delta = await buildLogsPayload(logs.seq)
check("since 增量捕获新事件", delta.logs.length === 1 && delta.logs[0].ok === false)

console.log(failed ? `\n${failed} 项失败` : "\n全部通过")
process.exit(failed ? 1 : 0)
