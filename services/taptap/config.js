// TapTap game-sign 签到配置与持久化（数据统一落在 Lotus-Plugin/data/taptap/）
import fs from "node:fs"
import path from "node:path"
import yaml from "yaml"
import { resolveData } from "../../core/path.js"

const DATA_DIR = resolveData("taptap")
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.yaml") // 已绑定账号索引（list of { user_id, bound_at }）
const CONFIG_FILE = path.join(DATA_DIR, "config.yaml")

/** 每个微信 user_id 独立的浏览器会话目录（登录态隔离） */
export function profileDir(userId) {
  return resolveData("taptap_profile", String(userId))
}

/** 每个 user_id 独立的签到状态文件（活动缓存 + 上次结果） */
function statusFile(userId) {
  return path.join(DATA_DIR, `status_${String(userId)}.json`)
}

/**
 * 三个游戏：appId 为 TapTap 国服稳定标识（不是活动 id，活动 id 每版本轮换，由 EventResolver 自动发现）
 * 仅做 原神 / 崩坏：星穹铁道 / 绝区零（用户要求，其余不要）
 */
export const GAMES = [
  { key: "genshin", name: "原神", appId: "168332" },
  { key: "hsr", name: "崩坏：星穹铁道", appId: "305268" },
  { key: "zzz", name: "绝区零", appId: "470132" },
]

const DEFAULTS = {
  auto_checkin: true,
  checkin_cron: "0 15 0 * * ? *", // 每日 00:15（与荷花主签到一致）
  random_delay_min: 0,
  random_delay_max: 30,
  login_timeout_min: 5,
  headless: true,
  push_groups: [],
  games: { genshin: { enabled: true }, hsr: { enabled: true }, zzz: { enabled: true } },
  event_override: { genshin: "", hsr: "", zzz: "" },
}

export function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
}

export function loadConfig() {
  ensureDir(DATA_DIR)
  let userCfg = {}
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      userCfg = yaml.parse(fs.readFileSync(CONFIG_FILE, "utf8")) || {}
    } catch (e) {
      logger?.warn?.(`[Lotus-TapTap] config.yaml 解析失败，使用默认配置：${e.message}`)
    }
  }
  // 深合并（用户配置优先）
  return {
    ...DEFAULTS,
    ...userCfg,
    games: { ...DEFAULTS.games, ...(userCfg.games || {}) },
    event_override: { ...DEFAULTS.event_override, ...(userCfg.event_override || {}) },
    push_groups: userCfg.push_groups || DEFAULTS.push_groups,
  }
}

export function saveUserConfig(cfg) {
  ensureDir(DATA_DIR)
  fs.writeFileSync(CONFIG_FILE, yaml.stringify(cfg))
}

export function loadStatus(userId) {
  try {
    const data = JSON.parse(fs.readFileSync(statusFile(userId), "utf8"))
    data.games = data.games || {}
    return data
  } catch {
    return { games: {}, login: { lastCheck: 0 } }
  }
}

export function saveStatus(userId, data) {
  ensureDir(DATA_DIR)
  fs.writeFileSync(statusFile(userId), JSON.stringify(data, null, 2))
}

// ===== 已绑定账号索引（多账号支持：每个微信 user_id 绑定独立 TapTap 登录态） =====

/** 读取账号索引，返回 [{ user_id, bound_at }] */
export function loadAccounts() {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) return []
    const data = yaml.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"))
    if (Array.isArray(data)) return data.filter((a) => a && a.user_id)
    return []
  } catch {
    return []
  }
}

/** 记录一个已绑定账号（幂等，按 user_id 去重） */
export function addAccount(userId) {
  const id = String(userId)
  const list = loadAccounts().filter((a) => a.user_id !== id)
  list.push({ user_id: id, bound_at: Date.now() })
  ensureDir(DATA_DIR)
  fs.writeFileSync(ACCOUNTS_FILE, yaml.stringify(list))
  return list
}

/** 删除一个已绑定账号，返回是否删除 */
export function removeAccount(userId) {
  const id = String(userId)
  const list = loadAccounts()
  const next = list.filter((a) => a.user_id !== id)
  if (next.length === list.length) return false
  ensureDir(DATA_DIR)
  fs.writeFileSync(ACCOUNTS_FILE, yaml.stringify(next))
  return true
}

/** 当前启用（未显式关闭）的游戏列表 */
export function enabledGames(cfg) {
  return GAMES.filter((g) => !(cfg.games?.[g.key] && cfg.games[g.key].enabled === false))
}

/** 按名称/key 过滤游戏，支持中文名或 key；无关键词返回全部启用游戏 */
export function matchGames(cfg, keyword) {
  if (!keyword) return enabledGames(cfg)
  const kw = String(keyword).trim()
  const all = enabledGames(cfg)
  const hit = all.filter((g) => g.name.includes(kw) || g.key.toLowerCase().includes(kw.toLowerCase()))
  return hit.length ? hit : all
}
