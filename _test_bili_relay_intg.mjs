// 集成测试：验证 B 站大文件 HTTP 中转真的可用
//   Phase 1：relay.js 真实路由 + 真实 HTTP 下载 + 鉴权（403/404）
//   Phase 2：动态导入 bilibili.js，验证「所有视频都走中转」决策（小视频也发链接，不走 sendFile）
//   Phase 3：过期清除机制（用极小 TTL 模拟超时，验证 cleanupRelay 真删磁盘）
import express from "express"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import { resolveData } from "./core/path.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RELAY_DIR = resolveData("bilibili", "relay")

// 干净的测试环境：清空历史中转区（当前无生产数据）
await fs.rm(RELAY_DIR, { recursive: true, force: true })

// ---- 准备源文件：1.5MB 随机内容，足以验证"下载内容 == 源文件" ----
const src = path.join(os.tmpdir(), `bili-relay-src-${crypto.randomUUID()}.mp4`)
const payload = Buffer.concat([
  Buffer.from("LOTUS-RELAY-PROBE-MARKER-"),
  crypto.randomBytes(1_500_000),
])
await fs.writeFile(src, payload)
const sizeMb = (await fs.stat(src)).size / (1000 * 1000)
console.log(`源文件: ${(await fs.stat(src)).size} bytes (~${sizeMb.toFixed(1)}MB)`)

// ---- 真实 express + Bot 桩 ----
const app = express()
let server
const port = await new Promise((resolve) => {
  server = app.listen(0, "127.0.0.1", () => resolve(server.address().port))
})
globalThis.Bot = {
  express: app,
  server: { address: () => server.address() },
}

let failures = 0
function check(name, ok, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`)
  if (!ok) failures++
}

// ============ Phase 1：relay.js 真实路由 + HTTP 下载 + 鉴权 ============
const relayMod = await import("./services/bilibili/relay.js")
const { buildRelayLink, normalizeRelayConfig } = relayMod
const relayCfg = normalizeRelayConfig({
  video_relay: { enable: true, ttl_hours: 24, max_total_size_mb: 2048 },
})

const relay = await buildRelayLink(src, "测试视频.mp4", relayCfg)
check("buildRelayLink 返回 ok", relay.ok, relay.reason || "")
console.log(`   链接: ${relay.url}`)

const u = new URL(relay.url)
const base = `http://127.0.0.1:${u.port}${u.pathname}`

const okRes = await fetch(`${base}?token=${u.searchParams.get("token")}`)
const okBuf = Buffer.from(await okRes.arrayBuffer())
check("正确令牌下载 status=200", okRes.status === 200, `status=${okRes.status}`)
check("下载内容 == 源文件", okBuf.equals(payload), `len=${okBuf.length}`)
check("Content-Disposition 含文件名", /filename\*?=/.test(okRes.headers.get("content-disposition") || ""), okRes.headers.get("content-disposition") || "")

const badRes = await fetch(`${base}?token=deadbeefdeadbeef`)
check("错误令牌 status=403", badRes.status === 403, `status=${badRes.status}`)

const missRes = await fetch(`http://127.0.0.1:${u.port}/lotus/relay/__nope__?token=x`)
check("不存在 id status=404", missRes.status === 404, `status=${missRes.status}`)

// ============ Phase 2：决策层——所有视频都走中转（小视频也发链接，不走 sendFile） ============
let phase2 = "未执行"
try {
  globalThis.plugin = class {}
  globalThis.logger = { warn() {}, debug() {}, mark() {}, info() {}, error() {}, log() {} }
  globalThis.segment = { video: async () => ({ ok: false }) }

  const bili = await import("./apps/bilibili.js")
  // 注意 video_wx_limit_mb 保持默认 100：本可视频消息直发，验证「都走」逻辑强制改中转
  const config = {
    video_size_limit_mb: 100,
    video_wx_limit_mb: 100,
    video_transcode: { enable: false },
    video_relay: { enable: true, ttl_hours: 24, max_total_size_mb: 2048 },
  }

  let replyText = ""
  let sendFileCalled = false
  const e = {
    isGroup: true,
    group_id: "test-chatroom",
    user_id: "test-user",
    group: { sendFile: async () => { sendFileCalled = true } },
    reply: async (msg) => { replyText = typeof msg === "string" ? msg : JSON.stringify(msg) },
  }

  await bili.sendBiliFile(e, src, config)
  const wentRelay = replyText.includes("/lotus/relay/")
  check("所有视频都走中转(小视频也发链接)", wentRelay, replyText.split("\n")[0] || "")
  check("未走 sendFile 兜底", !sendFileCalled, `sendFileCalled=${sendFileCalled}`)
  phase2 = wentRelay && !sendFileCalled ? "通过" : "失败"
} catch (error) {
  phase2 = `import/执行异常: ${error.message}`
  check("决策层导入执行", false, error.message)
}

// ============ Phase 3：过期清除机制（手写已过期条目，验证 cleanupRelay 真删磁盘） ============
let phase3 = "未执行"
try {
  // 用新模块实例（?v=3）绕过内存态守卫，使其重新从 manifest.json 加载；
  // 直接写入一个 expiresAt 已过去的条目，验证过期即清除。
  const relayFresh = await import("./services/bilibili/relay.js?v=3")
  const expiredId = crypto.randomUUID()
  const expiredDir = path.join(RELAY_DIR, expiredId)
  await fs.mkdir(expiredDir, { recursive: true })
  const expiredFile = path.join(expiredDir, "old.mp4")
  await fs.writeFile(expiredFile, Buffer.from("OLDEXPIRED"))
  const manifest = {
    [expiredId]: {
      token: "x", file: expiredFile, name: "old.mp4", sizeBytes: 9,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    },
  }
  await fs.writeFile(path.join(RELAY_DIR, "manifest.json"), JSON.stringify(manifest))
  const cleaned = await relayFresh.cleanupRelay()
  check("cleanupRelay 清除过期条目", cleaned.removedFiles === 1, `removed=${cleaned.removedFiles}`)
  const stillThere = await fs.stat(expiredFile).catch(() => null)
  check("过期文件已从磁盘删除", !stillThere)
  phase3 = cleaned.removedFiles === 1 && !stillThere ? "通过" : "失败"
} catch (error) {
  phase3 = `异常: ${error.message}`
  check("过期清除", false, error.message)
}

// ---- 清理 ----
await fs.unlink(src).catch(() => {})
server.close()
await fs.rm(RELAY_DIR, { recursive: true, force: true }).catch(() => {})

console.log("\n================ 结论 ================")
console.log(`Phase 1 (relay 真实 HTTP): ${failures === 0 ? "通过" : "有失败"}`)
console.log(`Phase 2 (所有视频走中转):  ${phase2}`)
console.log(`Phase 3 (超 TTL 清除):     ${phase3}`)
console.log(failures === 0 && phase2 === "通过" && phase3 === "通过"
  ? "\n🎉 中转功能可用：所有视频走链接，且超 TTL 自动清除。"
  : "\n⚠️ 存在问题，见上方 ❌。")
process.exit(failures === 0 && phase2 === "通过" && phase3 === "通过" ? 0 : 1)
