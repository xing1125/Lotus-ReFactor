/**
 * 荷花图鉴 · 用户可配正则黑名单
 *
 * 命中「完整消息」时，图鉴插件的所有 rule 入口静默返回 false：
 * Yunzai loader 见到 false 会继续匹配后续插件，因此本插件不回复、不渲染、不吞消息。
 *
 * 配置文件：config/atlas-blacklist.yaml（不存在 = 未启用，等价于空规则）
 *   enabled: true
 *   patterns:
 *     - '^#.*面板'
 *     - { pattern: '^#.*攻略$', flags: 'i' }
 *
 * 热重载：按文件 mtimeMs 感知，最多每 500ms stat 一次，保存后无需重启 bot。
 * 容错：YAML 写坏 / 单条正则写坏 / 文件读取失败，一律 fail-open（不额外拦截消息）。
 *
 * 实现说明：只借鉴「用户可配黑名单」的产品思路，代码独立编写，
 * 未复制 AxiuCN/Atlas-Plugin（GPL-3.0）的任何源文件。
 */
import fs from "node:fs/promises"
import path from "node:path"
import YAML from "yaml"
import { resolveConfig } from "../../core/path.js"

const DEFAULT_FILE = "atlas-blacklist.yaml"
const RECHECK_MS = 500
const MAX_PATTERNS = 200
const MAX_SOURCE_LENGTH = 500
const MAX_MATCH_LENGTH = 1000
const ALLOWED_FLAGS = /[^imsu]/g

let cache = emptyCache("")

function emptyCache(file) {
  return {
    file,
    mtimeMs: 0,
    checkedAt: 0,
    patterns: [],
    invalid: [],
    exists: false,
    enabled: true,
    error: "",
  }
}

function resolveFile(file) {
  if (!file) return resolveConfig(DEFAULT_FILE)
  return path.isAbsolute(file) ? path.normalize(file) : path.resolve(file)
}

function isMissing(error) {
  return ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error?.code)
}

/**
 * 读取编译后的规则集；带 mtime 热重载与短 TTL，正常消息路径最多一次 stat / 500ms。
 */
async function loadSnapshot(file, force = false) {
  const now = Date.now()
  if (!force && cache.file === file && now - cache.checkedAt < RECHECK_MS) return cache

  let stat
  try {
    stat = await fs.stat(file)
  } catch (error) {
    if (isMissing(error)) {
      cache = { ...emptyCache(file), checkedAt: now }
      return cache
    }
    // 非「文件不存在」的错误：保持上一次有效快照，避免误拦截
    globalThis.logger?.debug?.(`[Lotus-Plugin] atlas blacklist stat failed: ${error?.message || error}`)
    cache.checkedAt = now
    return cache
  }

  // 文件存在且 mtime 未变 → 复用已编译的 RegExp
  if (cache.file === file && cache.exists && cache.mtimeMs === stat.mtimeMs) {
    cache.checkedAt = now
    return cache
  }

  const next = {
    ...emptyCache(file),
    exists: true,
    mtimeMs: stat.mtimeMs,
    checkedAt: now,
  }

  try {
    const raw = await fs.readFile(file, "utf8")
    const doc = YAML.parse(raw)
    const list = Array.isArray(doc) ? doc : Array.isArray(doc?.patterns) ? doc.patterns : []
    next.enabled = !(doc && typeof doc === "object" && doc.enabled === false)

    for (const [index, item] of list.slice(0, MAX_PATTERNS).entries()) {
      const spec = normalizeSpec(item)
      if (!spec) {
        next.invalid.push(`#${index + 1}: 空规则或不支持的格式`)
        continue
      }
      if (spec.source.length > MAX_SOURCE_LENGTH) {
        next.invalid.push(`#${index + 1}: 正则超过 ${MAX_SOURCE_LENGTH} 字符`)
        continue
      }
      try {
        next.patterns.push({ ...spec, regex: new RegExp(spec.source, spec.flags) })
      } catch (error) {
        next.invalid.push(`#${index + 1}: ${error?.message || "正则语法错误"}`)
      }
    }
    if (list.length > MAX_PATTERNS) {
      next.invalid.push(`规则超过 ${MAX_PATTERNS} 条，多余部分已忽略`)
    }
  } catch (error) {
    // 解析失败（例如编辑器正在写文件）：保留上一份有效规则，避免黑名单突然失效
    next.error = error?.message || String(error)
    if (cache.file === file && cache.exists) {
      next.patterns = cache.patterns
      next.invalid = cache.invalid
      next.enabled = cache.enabled
    }
  }

  if (next.invalid.length || next.error) {
    const detail = next.error || next.invalid.slice(0, 3).join("；")
    globalThis.logger?.warn?.(`[Lotus-Plugin] 图鉴黑名单配置异常（已跳过无效规则）：${detail}`)
  }

  cache = next
  return cache
}

function normalizeSpec(item) {
  if (typeof item === "string") {
    const source = item.trim()
    return source ? { source, flags: "" } : null
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) return null
  const source = String(item.pattern ?? item.reg ?? item.regex ?? "").trim()
  if (!source) return null
  // g / y 会让 RegExp.test 带 lastIndex 状态，导致隔条漏判，统一丢弃
  const flags = String(item.flags || "").replace(ALLOWED_FLAGS, "")
  return { source, flags }
}

function extractText(messageOrEvent) {
  let text = ""
  if (typeof messageOrEvent === "string") text = messageOrEvent
  else if (messageOrEvent && typeof messageOrEvent === "object") {
    text = String(messageOrEvent.msg ?? messageOrEvent.raw_message ?? messageOrEvent.message_text ?? "")
  }
  // 限制长度：用户自定义正则若含灾难性回溯，最坏情况也被限制在 1000 字以内
  return text.slice(0, MAX_MATCH_LENGTH)
}

/**
 * 返回命中的规则原文（用于诊断 / 日志），未命中返回 null。
 * @param {string|object} messageOrEvent 完整消息文本或 Yunzai 事件对象
 */
export async function matchAtlasBlacklist(messageOrEvent, options = {}) {
  const file = resolveFile(options.file)
  const snap = await loadSnapshot(file, options.force === true)
  if (!snap.exists || !snap.enabled || !snap.patterns.length) return null

  const text = extractText(messageOrEvent)
  if (!text) return null
  for (const entry of snap.patterns) {
    entry.regex.lastIndex = 0
    if (entry.regex.test(text)) return entry.source
  }
  return null
}

/** rule 入口守卫：任何异常都 fail-open，绝不因为黑名单本身卡住消息 */
export async function isAtlasBlacklisted(messageOrEvent, options = {}) {
  try {
    return Boolean(await matchAtlasBlacklist(messageOrEvent, options))
  } catch (error) {
    globalThis.logger?.debug?.(`[Lotus-Plugin] atlas blacklist skipped: ${error?.message || error}`)
    return false
  }
}

/** 状态卡 / 诊断用：返回不含 RegExp 实例的可序列化快照 */
export async function getAtlasBlacklistStatus(options = {}) {
  const file = resolveFile(options.file)
  let snap
  try {
    snap = await loadSnapshot(file, options.force === true)
  } catch (error) {
    snap = { ...emptyCache(file), error: error?.message || String(error) }
  }
  return {
    file: snap.file,
    exists: snap.exists,
    enabled: snap.enabled,
    count: snap.patterns.length,
    invalid: [...snap.invalid],
    error: snap.error,
    mtimeMs: snap.mtimeMs,
    patterns: snap.patterns.map(item => ({ source: item.source, flags: item.flags })),
  }
}

/** 仅用于自检：清空缓存，强制下次重新读取 */
export function resetAtlasBlacklistCacheForTest() {
  cache = emptyCache("")
}
