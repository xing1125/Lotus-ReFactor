// 签到看板 e2e：真 express 起服务，实测页面 / 鉴权 / 状态 / 日志四条路由
import http from "node:http"
import express from "express"
import fs from "node:fs/promises"

globalThis.plugin = class { constructor() {} }
globalThis.logger = { info() {}, warn() {}, error() {}, mark() {}, debug() {} }

const { ensureDashboardRoutes } = await import("./apps/checkinDashboard.js")
const { resolveData } = await import("./core/path.js")

const app = express()
globalThis.Bot = { express: app }
if (!ensureDashboardRoutes()) { console.log("FAIL 路由注册失败"); process.exit(1) }
console.log("PASS 路由注册（Bot.express）")

const server = http.createServer(app)
await new Promise(r => server.listen(0, "127.0.0.1", r))
const port = server.address().port
const base = `http://127.0.0.1:${port}`

// 先戳一次 API（处理器内惰性生成令牌文件），再读取
await fetch(`${base}/lotus/checkin/api/status`).catch(() => {})
const token = (await fs.readFile(resolveData("checkin-dashboard-token.txt"), "utf8")).trim()
console.log("PASS 令牌生成/读取 —", token.slice(0, 4) + "...")

let failed = 0
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`)
  if (!cond) failed++
}

// 1. 页面
const page = await fetch(`${base}/lotus/checkin`).then(r => r.text())
check("GET /lotus/checkin 返回 HTML", page.includes("实时签到看板") && page.includes("<!DOCTYPE html>"), `${page.length} bytes`)

// 2. 无 token → 401
const noAuth = await fetch(`${base}/lotus/checkin/api/status`)
check("无 token 请求 API → 401", noAuth.status === 401, String(noAuth.status))

// 3. 错 token → 401
const badAuth = await fetch(`${base}/lotus/checkin/api/status?token=wrong`)
check("错 token → 401", badAuth.status === 401)

// 4. 带 token → 状态 JSON
const status = await fetch(`${base}/lotus/checkin/api/status?token=${token}`).then(r => r.json())
check("状态 API", status.summary && Array.isArray(status.groups),
  `all=${status.summary?.all} groups=${status.groups?.length}`)

// 5. 日志 API
const logs = await fetch(`${base}/lotus/checkin/api/logs?tail=10&token=${token}`).then(r => r.json())
check("日志 API", logs && Array.isArray(logs.logs) && typeof logs.seq === "number", `${logs.logs.length} 条`)

server.close()
console.log(failed ? `\n${failed} 项失败` : "\n全部通过")
process.exit(failed ? 1 : 0)
