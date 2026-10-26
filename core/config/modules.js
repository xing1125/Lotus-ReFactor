import { loadGlobalConfig } from "./global.js"

// 功能模块开关注册表：id = config/modules 下的键，label/desc 供锅巴与关闭提示使用。
// 未登记的 app 一律视为「无开关」；登记的模块缺省 enabled（modules[id] !== false）。
// 签到链路不在此列 —— 它已有 forced_disables / scheduler.notify_enabled 等独立开关，避免双重控制。
export const FEATURE_MODULES = Object.freeze([
  { id: "genshin_abyss", label: "原神深境螺旋", desc: "#深渊 / #上期深渊（荷花自制卡）" },
  { id: "starrail_challenge", label: "星铁挑战战绩", desc: "*深渊 / #星铁深渊（荷花自制卡）" },
  { id: "genshin_team_damage", label: "原神队伍伤害", desc: "#队伍伤害" },
  { id: "starrail_team_damage", label: "星铁队伍伤害", desc: "#星铁队伍伤害" },
  { id: "daily_note", label: "实时便笺", desc: "#体力 / #全部体力" },
  { id: "achievements", label: "成就查漏", desc: "#成就 / #成就导入" },
  { id: "atlas", label: "图鉴", desc: "#xx图鉴 / #录入xx" },
  { id: "gacha_log", label: "抽卡记录", desc: "#获取抽卡记录 / #抽卡分析" },
  { id: "miao_calendar", label: "日历素材", desc: "#日历 / #今日素材" },
  { id: "panel_update", label: "更新面板", desc: "#更新面板 / #修复面板" },
  { id: "profile_query", label: "委派个人查询", desc: "面板/练度/角色查询（群路由多由上游插件承接）" },
  { id: "device", label: "设备绑定", desc: "#绑定设备 / #设备信息" },
  { id: "genshin_challenge_capture", label: "剧诗/幽境数据捕获", desc: "#捕获挑战数据（主人专用，为后续自制卡采真实报文）" },
  { id: "bilibili", label: "B站解析", desc: "B站视频 / 番剧 / 搜索" },
  { id: "douyin", label: "抖音解析", desc: "抖音视频解析" },
  { id: "weibo", label: "微博签到", desc: "#微博签到" },
  { id: "taptap", label: "TapTap", desc: "#taptap 游戏库" },
  { id: "netease_partner", label: "网易云伙伴", desc: "网易云任务" },
  { id: "remote", label: "远程命令", desc: "#remote 远程执行（建议非自用部署时关闭）" },
])

const LABELS = new Map(FEATURE_MODULES.map(m => [m.id, m.label]))

// 短 TTL 缓存：命令频率低，省掉每条消息的 YAML 解析；锅巴保存后 ≤2s 生效。
const CACHE_TTL_MS = 2000
let cache = { at: 0, modules: null }

async function readModules() {
  const now = Date.now()
  if (cache.modules && now - cache.at < CACHE_TTL_MS) return cache.modules
  let modules = {}
  try {
    const config = await loadGlobalConfig()
    modules = (config && typeof config.modules === "object" && config.modules) || {}
  } catch {
    modules = {}
  }
  cache = { at: now, modules }
  return modules
}

export function invalidateModuleCache() {
  cache = { at: 0, modules: null }
}

// 模块是否启用：缺省 true（fail-open），仅显式 false 关闭；配置读取失败也放行。
export async function isModuleEnabled(id) {
  try {
    const modules = await readModules()
    return modules?.[id] !== false
  } catch {
    return true
  }
}

export function moduleLabel(id) {
  return LABELS.get(id) || "该功能"
}

// apps 文件名 → 模块 id（index.js 装载 apps 时按文件名接线）
export const MODULE_BY_APP_FILE = Object.freeze({
  genshinAbyss: "genshin_abyss",
  starRailChallenge: "starrail_challenge",
  genshinTeamDamage: "genshin_team_damage",
  starRailTeamDamage: "starrail_team_damage",
  dailyNote: "daily_note",
  achievements: "achievements",
  atlas: "atlas",
  gachaLog: "gacha_log",
  miaoCalendar: "miao_calendar",
  panelUpdate: "panel_update",
  profileQuery: "profile_query",
  device: "device",
  genshinChallenge: "genshin_challenge_capture",
  bilibili: "bilibili",
  douyin: "douyin",
  weibo: "weibo",
  taptap: "taptap",
  neteasePartner: "netease_partner",
  remote: "remote",
})
