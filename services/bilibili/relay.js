// B 站大文件 HTTP 中转。
//
// 背景：hook 版微信（ComWeChat）走文件通道发大视频有崩客户端风险——
// 2026-10-28 实测 16MB 视频文件发送后 5 秒 WeChatWin.dll 崩溃。
// 超过微信上限（video_wx_limit_mb）且压缩不可用的视频，改为：
//   落盘到 data/bilibili/relay/<id>/<文件名> + Yunzai 自带 express 挂带令牌下载路由，
//   聊天里只发链接，不碰微信文件通道。
//
// 生命周期：
//   - stageRelayFile  拷贝文件入中转区（原文件仍走缓存/清理逻辑，互不影响）
//   - ensureRelayRoutes  挂 /lotus/relay/:id 路由（模块加载即挂，Bot 未就绪时发送前兜底重试）
//   - cleanupRelay  清过期文件；由 B 站每日清理任务与启动清理顺带执行
//   - manifest 持久化到 relay/manifest.json，重启后链接仍有效

import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { resolveData } from "../../core/path.js"

const RELAY_DIR = resolveData("bilibili", "relay")
const MANIFEST_FILE = path.join(RELAY_DIR, "manifest.json")
const ROUTE_FLAG = "__lotusBiliRelayRoutes"

/** @type {Map<string, {token:string, file:string, name:string, sizeBytes:number, expiresAt:string}>} */
const manifest = new Map()
let manifestLoaded = false

export function normalizeRelayConfig(config = {}) {
  const source = config.video_relay || config.relay || {}
  return {
    enable: source.enable !== false,
    ttl_hours: Math.min(24 * 30, Math.max(0.1, Number(source.ttl_hours ?? 24) || 24)),
    max_total_size_mb: Math.max(0, Number(source.max_total_size_mb ?? 2048) || 0),
    // 只有大视频才进中转：min_size_mb 为空时由调用方回退到微信视频上限（video_wx_limit_mb），
    // 即「能作为视频消息直发的都不中转」。显式配 0 = 恢复全量中转。
    min_size_mb: source.min_size_mb === undefined || source.min_size_mb === null
      ? null
      : Math.max(0, Number(source.min_size_mb) || 0),
  }
}

async function loadManifest() {
  if (manifestLoaded) return
  manifestLoaded = true
  try {
    const raw = JSON.parse(await fs.readFile(MANIFEST_FILE, "utf8"))
    for (const [id, item] of Object.entries(raw || {})) {
      if (id && item?.file && item?.token) manifest.set(id, item)
    }
  } catch {
    // 无 manifest 或损坏：从空开始
  }
}

async function saveManifest() {
  await fs.mkdir(RELAY_DIR, { recursive: true })
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(Object.fromEntries(manifest), null, 2), "utf8")
}

function lanIPv4() {
  const nets = os.networkInterfaces()
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) return net.address
    }
  }
  return "127.0.0.1"
}

function serverPort() {
  try {
    const addr = globalThis.Bot?.server?.address?.()
    if (addr?.port) return addr.port
  } catch { }
  return 2536
}

async function totalRelayBytes() {
  let total = 0
  for (const item of manifest.values()) total += Number(item.sizeBytes || 0)
  return total
}

/** 容量闸门：超出上限时从最旧的条目开始淘汰（含未过期），直到装得下或清空 */
async function makeRoom(incomingBytes, maxTotalMb) {
  if (!maxTotalMb) return true
  const cap = maxTotalMb * 1000 * 1000
  if (await totalRelayBytes() + incomingBytes <= cap) return true
  const entries = [...manifest.entries()]
    .sort((a, b) => Date.parse(a[1].expiresAt || 0) - Date.parse(b[1].expiresAt || 0))
  for (const [id, item] of entries) {
    await dropRelayEntry(id, item)
    if (await totalRelayBytes() + incomingBytes <= cap) return true
  }
  return false
}

async function dropRelayEntry(id, item) {
  manifest.delete(id)
  try {
    await fs.rm(path.dirname(item.file), { recursive: true, force: true })
  } catch { }
}

/**
 * 把文件拷入中转区并登记。
 * @returns {Promise<{ok:boolean, id?:string, reason?:string}>}
 */
export async function stageRelayFile(file, displayName, relayConfig) {
  await loadManifest()
  await cleanupRelay().catch(() => { }) // 写入前先清过期文件，保证超 TTL 即释放磁盘
  const stat = await fs.stat(file).catch(() => null)
  if (!stat?.isFile()) return { ok: false, reason: "源文件不存在" }
  if (!(await makeRoom(stat.size, relayConfig.max_total_size_mb))) {
    return { ok: false, reason: `中转区容量已满（上限 ${relayConfig.max_total_size_mb}MB）` }
  }

  const id = crypto.randomUUID()
  const token = crypto.randomBytes(16).toString("hex")
  const dir = path.join(RELAY_DIR, id)
  const dest = path.join(dir, path.basename(displayName || path.basename(file)))
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(file, dest)
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => { })
    return { ok: false, reason: `中转落盘失败：${error.message}` }
  }

  manifest.set(id, {
    token,
    file: dest,
    name: path.basename(displayName || path.basename(file)),
    sizeBytes: stat.size,
    expiresAt: new Date(Date.now() + relayConfig.ttl_hours * 60 * 60 * 1000).toISOString(),
  })
  await saveManifest().catch(() => { })
  return { ok: true, id }
}

/** 挂载下载路由（幂等）。返回 false 表示 Bot.express 尚未就绪。 */
export function ensureRelayRoutes() {
  const Bot = globalThis.Bot
  const app = Bot?.express
  if (!app) return false
  if (Bot[ROUTE_FLAG]) return true

  if (Array.isArray(app.skip_auth) && !app.skip_auth.includes("/lotus/relay")) {
    app.skip_auth.push("/lotus/relay", "/lotus/relay/")
  }

  app.get("/lotus/relay/:id", async (req, res) => {
    await loadManifest()
    const item = manifest.get(String(req.params.id || ""))
    if (!item) return res.status(404).send("[荷花插件]中转文件不存在或已被清理。")
    if (String(req.query.token || "") !== item.token) return res.status(403).send("[荷花插件]令牌无效。")
    if (Date.parse(item.expiresAt) < Date.now()) {
      await dropRelayEntry(String(req.params.id), item)
      await saveManifest().catch(() => { })
      return res.status(410).send("[荷花插件]中转链接已过期。")
    }
    res.download(item.file, item.name)
  })

  Bot[ROUTE_FLAG] = true
  return true
}

/**
 * 一站式：落盘 + 挂路由 + 生成链接。
 * @returns {Promise<{ok:boolean, url?:string, sizeMb?:number, ttlHours?:number, reason?:string}>}
 */
export async function buildRelayLink(file, displayName, relayConfig) {
  if (!ensureRelayRoutes()) {
    return { ok: false, reason: "HTTP 服务未就绪（Bot.express 不可用）" }
  }
  const staged = await stageRelayFile(file, displayName, relayConfig)
  if (!staged.ok) return { ok: false, reason: staged.reason }
  const stat = await fs.stat(file).catch(() => null)
  return {
    ok: true,
    url: `http://${lanIPv4()}:${serverPort()}/lotus/relay/${staged.id}?token=${manifest.get(staged.id).token}`,
    sizeMb: stat ? stat.size / (1000 * 1000) : 0,
    ttlHours: relayConfig.ttl_hours,
  }
}

/** 清过期中转文件（每日清理任务 / 启动清理调用） */
export async function cleanupRelay() {
  await loadManifest()
  const nowMs = Date.now()
  let removedFiles = 0
  let freedBytes = 0
  for (const [id, item] of [...manifest.entries()]) {
    if (Date.parse(item.expiresAt || 0) >= nowMs) continue
    freedBytes += Number(item.sizeBytes || 0)
    await dropRelayEntry(id, item)
    removedFiles += 1
  }
  if (removedFiles) await saveManifest().catch(() => { })
  return { removedFiles, freedBytes }
}
