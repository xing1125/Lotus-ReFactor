import fs from "node:fs"
import YAML from "yaml"
import { resolveConfig } from "../path.js"

// 拦截优先级（数值越小越先执行）。分两档：
//
// ① 签到链路始终抢在最前：体力/便笺、手动签到、社区签到（TapTap / 微博 / 米游社社区）、
//    自动签到调度、扫码登录、签到设置、验证码处理。这些是荷花的主职，上游插件没有等价实现。
export const LOTUS_INTERCEPT_PRIORITY = Number.NEGATIVE_INFINITY

// ② 查询类模块退居上游插件之后做后备：深渊 / 星铁挑战 / 面板更新 / 角色查询 / 抽卡记录 /
//    图鉴 / 日历素材 / 队伍伤害 / 设备绑定 / 视频解析。
//    实际取值来自 config/global.yaml 的 routing.query_priority（荧后台「命令路由」可改），
//    默认 5001 = 排在 miao、ZZZ、Atlas 的 5000 之后；上游不接管（无规则或返回 false）时由荷花兜底。
export const LOTUS_QUERY_PRIORITY = 5001

// 环境变量仍可作为部署级覆盖（优先于配置文件）。
const ENV_QUERY_PRIORITY = (() => {
  const raw = process.env.LOTUS_QUERY_PRIORITY
  if (raw === undefined || raw === null || String(raw).trim() === "") return null
  const value = Number(raw)
  return Number.isNaN(value) ? null : value
})()

let routingCache = null
let routingCacheStamp = ""

function readRoutingConfig() {
  let routing = {}
  let stamp = "missing"
  try {
    const file = resolveConfig("global.yaml")
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file)
      stamp = `${stat.mtimeMs}:${stat.size}`
      if (routingCache && routingCacheStamp === stamp) return routingCache
      const parsed = YAML.parse(fs.readFileSync(file, "utf8")) || {}
      if (parsed.routing && typeof parsed.routing === "object") routing = parsed.routing
    }
  } catch {
    routing = {}
  }
  if (routingCache && routingCacheStamp === stamp) return routingCache
  routingCacheStamp = stamp

  const configured = Number(routing.query_priority)
  routingCache = {
    queryPriority: ENV_QUERY_PRIORITY !== null
      ? ENV_QUERY_PRIORITY
      : (Number.isNaN(configured) ? LOTUS_QUERY_PRIORITY : configured),
    frontModules: Array.isArray(routing.front_modules)
      ? routing.front_modules.map(item => String(item).trim()).filter(Boolean)
      : [],
  }
  return routingCache
}

/** 查询类模块的优先级（routing.query_priority / 环境变量 / 默认 5001）。 */
export function resolveQueryPriority() {
  return readRoutingConfig().queryPriority
}

/**
 * 按模块 id 解析优先级：routing.front_modules 里的模块固定 -Infinity（抢回最前），
 * 其余走 routing.query_priority。id 取 core/config/modules.js 的 FEATURE_MODULES。
 * priority 在插件构造时确定，改配置后需 #重载 Lotus-Plugin。
 */
export function resolvePriority(moduleId) {
  const routing = readRoutingConfig()
  if (moduleId && routing.frontModules.includes(moduleId)) return LOTUS_INTERCEPT_PRIORITY
  return routing.queryPriority
}

/** 供探针/测试在改配置后重置缓存用。 */
export function resetRoutingCache() {
  routingCache = null
  routingCacheStamp = ""
}

// ---- 运行中的 loader 热更新（荧后台保存后免重载生效） ----

/** 判断 loader.priority 条目是否属于本插件（与 services/intercept/runtime.js 同一判据）。 */
export function isLotusEntry(entry) {
  return String(entry?.key || "").startsWith("Lotus-Plugin")
    || String(entry?.name || "").startsWith("[Lotus-Plugin]")
}

function numericPriority(value) {
  return Number.isFinite(value) || value === Number.NEGATIVE_INFINITY || value === Number.POSITIVE_INFINITY
    ? value
    : 5000
}

/**
 * 按 priority 升序重排条目；同优先级时 Lotus 条目在前（复刻 TRSS loader 的
 * lodash.orderBy + enforceLotusInterception 语义）。原地写回，保持数组引用不变。
 */
export function sortPriorityEntries(entries) {
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const diff = numericPriority(a.entry.priority) - numericPriority(b.entry.priority)
      if (diff) return diff
      if (isLotusEntry(a.entry) && !isLotusEntry(b.entry)) return -1
      if (!isLotusEntry(a.entry) && isLotusEntry(b.entry)) return 1
      return a.index - b.index
    })
    .map(item => item.entry)
  for (let index = 0; index < entries.length; index++) entries[index] = ordered[index]
  return entries
}

/**
 * 把当前 routing 配置同步到 loader.priority 条目并重排。
 * 条目通过 class.__lotusModuleId（index.js 装载时打标）识别所属模块。
 * 返回 { ok, changed }，changed = 优先级实际变化的条目数。
 */
export function syncRoutingPriorities(entries) {
  if (!Array.isArray(entries)) return { ok: false, reason: "entries unavailable" }
  let changed = 0
  for (const entry of entries) {
    if (!isLotusEntry(entry)) continue
    const moduleId = entry?.class?.__lotusModuleId
    if (!moduleId) continue
    const next = resolvePriority(moduleId)
    if (entry.priority !== next) {
      entry.priority = next
      changed++
    }
  }
  if (changed) sortPriorityEntries(entries)
  return { ok: true, changed }
}

export const LOTUS_CONFIG_DISABLED_PLUGIN_NAMES = Object.freeze([
  // TRSS-Plugin overlaps
  "米哈游登录",
  "远程命令",
  "文件操作",
  "脚本执行",

  // miao wiki overlaps. Keep 角色查询/角色面板 for cards and panel transform.
  "角色资料",

  // 上游 a8c736c/2ce1221：兑换码功能由 Lotus 全权接管（原神直播码 + 各游戏），
  // genshin 的兑换动作与 ZZZ-Plugin 的 Code 查询一并禁用，避免双答。
  "兑换码",
  "[ZZZ-Plugin]Code",

  // Nwflower/Atlas overlaps
  "Atlas图鉴",
  "Atlas图鉴管理",
  "Atlas图鉴帮助",
  "Atlas原魔属性计算",

  // achievements-plugin overlaps. Lotus owns achievement import/catalog rendering.
  "成就查漏",
  "achievements-plugin",

  // xiaoyao catch-all adapter
  "xiaoyao-cvs-plugin",

  // ZZZ atlas/wiki overlaps. Keep player challenge apps.
  "[ZZZ-Plugin]wiki",

  // StarRail-plugin overlaps. Lotus owns SR personal queries/challenges.
  "星铁别名设置",
  "星铁plugin-深渊",
  "星穹铁道",
  "星铁plugin抽卡分析",
  "星铁plugin-货币战争",
  "[星铁插件]帮助",
  "星铁plugin基本信息",
  "星铁面板-兼容版",
  "星铁plugin-收入",
  "星铁plugin-体力",
  "星铁plugin-面板",
  "星铁plugin-模拟宇宙",
  "星铁插件-角色信息/攻略",
  "米游社星铁攻略",
  "星铁更新插件",
  "StarRail-Plugin更新日志",

  // xhh overlaps
  "[小花火]bili",
  "[小花火]图鉴",
  "[小花火]签到",
  "[小花火]米游社签到",
  "[小花火]体力小组件",
  "[小花火]原神卡池历史",
  "[小花火]星铁历史卡池",
  "[小花火]米哈游最新视频",
  "[小花火]米哈游视频",

  // rconsole is intentionally disabled as a whole.
  "R插件帮助",
  "R插件查询类",
  "R插件点歌",
  "R插件开关类",
  "R插件工具和学习类",
  "R插件更新插件",

  // Liangshi atlas/wiki overlaps.
  "Wiki",
  "wuwaWiki",

  // FanSky_Qs team damage overlaps.
  "提瓦特小助手",

  // TianRu-plugin Gclog constructor name (not its directory or class name).
  "提瓦特小助手抽卡记录",

  // loveMys / related captcha handler overlaps.
  "mys请求错误处理",
  "[loveMys] 插件更新",

  // bujidao / bujidaoRUN overlaps.
  "寄·配置",
  "[寄]深渊查询",
  "[寄]角色查询",
  "寄·米游社更新面板",
  "寄·体力",
  "寄·签到",

  // kissnavel/genshin overlaps. Avoid generic 用户绑定 so base genshin can stay alive.
  "genshin·星铁信息",
  "genshin·绑定设备",
  "genshin·mys请求错误处理",
  "genshin·米游社更新面板",
  "genshin·体力",
  "genshin·崩三体力查询",
  "genshin·签到",

  // JS/Bilibili overlaps
  "bilitv",
  "[Yuki-Plugin] bilibili",
])

export const LOTUS_RUNTIME_DISABLED_PLUGIN_NAMES = LOTUS_CONFIG_DISABLED_PLUGIN_NAMES

export const LOTUS_CAPTCHA_HANDLER_NAMESPACE = "Lotus-Plugin"

export const LEGACY_CAPTCHA_HANDLER_NAMESPACES = Object.freeze([
  "loveMys",
  "@小新枝",
  "genshin",
  "bujidao",
  "ji-plugin",
])
