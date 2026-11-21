/**
 * 荷花图鉴 · 更新前后统计快照
 *
 * 目的：让「图鉴更新结果卡」能给出逐游戏旧→新版本、条目增减、图片增减以及「无变化」结论。
 *
 * 关键约束：本机 data/map.json 约 93MB，若每次更新前后各 JSON.parse 两遍会瞬间吃掉
 * 数百 MB 内存。这里改为按行流式扫描，只抽 meta.fetchedAt / meta.mode 和
 * 各游戏 game 块里的 latestVersion / liveVersion，不做整份反序列化；
 * 条目 / 图片数量直接数目录里的文件，天然只统计当前 locale，不会被 4 语言重复计数。
 */
import fs from "node:fs/promises"
import { createReadStream } from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { resolveAtlasDataRoot } from "./update.js"

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".bmp"])
const GAME_KEY_LINE = /^ {2,8}"(gi|hsr|zzz|nte)":\s*\{/
const MAX_FILES = 200_000
const MAX_MAP_LINES = 2_000_000

/** 采集一次快照；任何单项失败都降级为 0 / 空字符串，绝不阻断更新任务 */
export async function collectAtlasStats(config = {}, fsImpl = fs) {
  const root = resolveAtlasDataRoot(config.data_root)
  const locale = String(config.locale || "简体中文")
  const mapFile = path.join(root, "data", "map.json")
  const itemsRoot = path.join(root, "data", "items", locale)
  const galleryRoot = path.join(root, "gallery")

  const [itemFiles, imageFiles, meta] = await Promise.all([
    countFiles(itemsRoot, fsImpl, name => name.toLowerCase().endsWith(".json")),
    countFiles(galleryRoot, fsImpl, name => IMAGE_EXT.has(path.extname(name).toLowerCase())),
    readMapSummary(mapFile, fsImpl),
  ])

  return {
    root,
    locale,
    itemFiles,
    imageFiles,
    fetchedAt: meta.fetchedAt,
    mode: meta.mode,
    versions: meta.versions,
    ready: Boolean(meta.fetchedAt || itemFiles || imageFiles),
  }
}

/** 前后快照对比；不可用时 available=false，结果卡会显示「未统计」而不是假装无变化 */
export function diffAtlasStats(before, after) {
  const fallback = {
    available: false,
    changed: false,
    versions: [],
    versionChanges: [],
    itemFiles: deltaOf(0, 0),
    imageFiles: deltaOf(0, 0),
    fetchedAt: { from: "", to: "" },
    summary: "统计不可用",
  }
  if (!before || !after || before.error || after.error) return fallback

  const gameIds = [...new Set([
    ...Object.keys(before.versions || {}),
    ...Object.keys(after.versions || {}),
  ])].sort()
  const versions = gameIds.map(game => {
    const from = versionText(before.versions?.[game])
    const to = versionText(after.versions?.[game])
    return { game, from, to, changed: from !== to }
  })
  const versionChanges = versions.filter(item => item.changed)
  const itemFiles = deltaOf(before.itemFiles, after.itemFiles)
  const imageFiles = deltaOf(before.imageFiles, after.imageFiles)
  const fetchedAt = { from: before.fetchedAt || "-", to: after.fetchedAt || "-" }
  const changed = versionChanges.length > 0
    || itemFiles.delta !== 0
    || imageFiles.delta !== 0
    || fetchedAt.from !== fetchedAt.to

  const parts = []
  if (versionChanges.length) parts.push(`${versionChanges.length} 个游戏版本变化`)
  if (itemFiles.delta) parts.push(`条目 ${formatDelta(itemFiles.delta)}`)
  if (imageFiles.delta) parts.push(`图片 ${formatDelta(imageFiles.delta)}`)

  return {
    available: true,
    changed,
    versions,
    versionChanges,
    itemFiles,
    imageFiles,
    fetchedAt,
    summary: changed ? (parts.length ? parts.join(" / ") : "抓取时间已刷新") : "无变化",
  }
}

export function formatNumber(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "0"
}

export function formatDelta(value) {
  const n = Number(value || 0)
  return n > 0 ? `+${n}` : String(n)
}

function deltaOf(from, to) {
  const a = Number(from || 0)
  const b = Number(to || 0)
  return { from: a, to: b, delta: b - a }
}

function versionText(value) {
  const latest = String(value?.latest || "")
  const live = String(value?.live || "")
  if (!latest && !live) return "-"
  if (live && live !== latest) return `${latest || "-"}(${live})`
  return latest || live
}

async function countFiles(dir, fsImpl, accept) {
  let total = 0
  const stack = [dir]
  while (stack.length && total < MAX_FILES) {
    const current = stack.pop()
    let entries
    try {
      entries = await fsImpl.readdir(current, { withFileTypes: true })
    } catch {
      // 目录不存在 / 抓取过程中被重建：当作 0，下一轮会重新统计
      continue
    }
    for (const entry of entries || []) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory?.()) stack.push(full)
      else if (entry.isFile?.() && accept(entry.name)) total++
      if (total >= MAX_FILES) break
    }
  }
  return total
}

/**
 * 流式读取 map.json 的头部信息。
 * 一旦 4 个游戏的版本和 meta 都齐了就提前 break，正常只需要扫到每个游戏 game 块。
 */
async function readMapSummary(file, fsImpl) {
  const empty = { fetchedAt: "", mode: "", versions: {} }
  try {
    await fsImpl.access(file)
  } catch {
    return empty
  }

  const stream = createReadStream(file, { encoding: "utf8" })
  // 抓取进程可能正在覆写 map.json，显式吃掉 stream error，避免未处理异常打挂 bot
  stream.on("error", () => {})
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  const versions = {}
  let fetchedAt = ""
  let mode = ""
  let game = ""
  let lineCount = 0

  try {
    for await (const line of rl) {
      lineCount++
      if (lineCount > MAX_MAP_LINES) break

      const gameMatch = line.match(GAME_KEY_LINE)
      if (gameMatch) {
        game = gameMatch[1]
        if (!versions[game]) versions[game] = { latest: "", live: "" }
        continue
      }
      if (!fetchedAt) {
        const match = line.match(/^\s*"fetchedAt":\s*"([^"]*)"/)
        if (match) fetchedAt = match[1]
      }
      if (!mode) {
        const match = line.match(/^\s*"mode":\s*"([^"]*)"/)
        if (match) mode = match[1]
      }
      if (game) {
        let match = line.match(/^\s*"latestVersion":\s*"([^"]*)"/)
        if (match) {
          if (!versions[game].latest) versions[game].latest = match[1]
        } else {
          match = line.match(/^\s*"liveVersion":\s*"([^"]*)"/)
          if (match && !versions[game].live) versions[game].live = match[1]
        }
      }
      if (fetchedAt && mode && Object.keys(versions).length >= 4
        && Object.values(versions).every(item => item.latest || item.live)) break
    }
  } catch {
    // 文件被覆写 / 读到一半失败：保留已经取到的部分
  } finally {
    rl.close()
    stream.destroy()
  }

  return { fetchedAt, mode, versions }
}
