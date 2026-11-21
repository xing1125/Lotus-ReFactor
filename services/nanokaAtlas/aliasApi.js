/**
 * 荷花图鉴别名只读门面（Lotus Alias API）
 *
 * 设计借鉴 AxiuCN/Atlas-Plugin 的 modules/aliasApi.js「四层别名合并 + 只读门面」思路，
 * 本文件为独立实现，未复制其代码。荷花原本已把 miao / ZZZ / xiaoyao Atlas_alias /
 * 静态查询别名聚合成一张双向表，但只暴露了 resolveAtlasAliasName 一个函数；
 * 这里把整张表以只读方式开放，其它插件不必再各自维护一份过时的角色名表。
 *
 * 接入约定（与上游一致）：
 *   1. 动态 import + try/catch 降级，荷花是可选依赖，静态 import 会让未安装的机器整插件挂掉；
 *   2. 传 gameId（'gi' / 'hsr' / 'zzz' 或 '原神' / '星铁' / '绝区零'），避免跨游戏同名混淆；
 *   3. 不要缓存副本，长期派生数据用 getAliasVersion() 判断失效；
 *   4. 不要自己挂别名 watcher，荷花已在每日 0 点 / 图鉴更新后 resetAtlasAliasCache()；
 *   5. getAliasMap 返回的 Map 是只读视图，set/delete/clear 会抛 TypeError。
 *
 * 示例：
 *   let aliasApi = null
 *   try { aliasApi = await import('../../Lotus-Plugin/services/nanokaAtlas/aliasApi.js') } catch {}
 *   const hit = aliasApi ? await aliasApi.resolveAlias(userInput, 'gi') : null
 *   const target = hit?.primary || userInput
 */
import {
  getAtlasAliasSnapshot,
  getAtlasAliasVersion,
  resolveAtlasAliasName,
  resolveSignatureWeapon,
} from './service.js'

const GAME_IDS = Object.freeze({
  gi: '原神',
  genshin: '原神',
  hsr: '星铁',
  sr: '星铁',
  zzz: '绝区零',
})

const KNOWN_GAMES = Object.freeze(['原神', '星铁', '绝区零'])

function normalizeGame(gameId) {
  if (!gameId) return ''
  const key = String(gameId).trim().toLowerCase()
  if (GAME_IDS[key]) return GAME_IDS[key]
  return KNOWN_GAMES.includes(String(gameId).trim()) ? String(gameId).trim() : ''
}

/** 与 service.js 的 normalizeForMatch 保持同一套归一化口径 */
function normalizeKey(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[·・]/g, '')
    .replace(/[「」『』"'“”‘’【】[\]()（）]/g, '')
    .toLowerCase()
}

function frozenMap(source) {
  const map = new Map(source)
  return new Proxy(map, {
    get(target, prop) {
      if (prop === 'set' || prop === 'delete' || prop === 'clear') {
        return () => {
          throw new TypeError('[Lotus aliasApi] 别名表为只读视图，请使用 resolveAlias / expandKeyword')
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** 表版本号（同步）：resetAtlasAliasCache 后 +1，派生缓存据此失效 */
export function getAliasVersion() {
  return getAtlasAliasVersion()
}

/** 表状态：版本 / 键数 / 条目数 / 各游戏条目数 */
export async function getAliasStatus() {
  const snap = await getAtlasAliasSnapshot()
  const keys = new Set()
  const byGame = {}
  for (const entry of snap.entries) {
    keys.add(entry.key)
    const game = entry.game || '未分类'
    byGame[game] = (byGame[game] || 0) + 1
  }
  return Object.freeze({
    version: snap.version,
    keys: keys.size,
    entries: snap.entries.length,
    byGame: Object.freeze(byGame),
  })
}

/**
 * 取整表的只读视图：Map<归一化键, 冻结候选数组 [{ value, game }]>。
 * 注意 key 已归一化（去空格/标点/小写），查询请用 resolveAlias。
 */
export async function getAliasMap(gameId) {
  const game = normalizeGame(gameId)
  const snap = await getAtlasAliasSnapshot()
  const grouped = new Map()
  for (const entry of snap.entries) {
    if (game && entry.game !== game) continue
    const list = grouped.get(entry.key) || []
    list.push(Object.freeze({ value: entry.value, game: entry.game }))
    grouped.set(entry.key, list)
  }
  for (const [key, list] of grouped) grouped.set(key, Object.freeze(list))
  return frozenMap(grouped)
}

/** 名字 → 候选：{ key, candidates, primary }；未命中时 primary 为 null */
export async function resolveAlias(name, gameId) {
  const key = String(name || '').trim()
  if (!key) return Object.freeze({ key: '', candidates: Object.freeze([]), primary: null })
  const game = normalizeGame(gameId)
  const normalized = normalizeKey(key)
  const snap = await getAtlasAliasSnapshot()
  const candidates = Object.freeze([
    ...new Set(
      snap.entries
        .filter(entry => entry.key === normalized && (!game || entry.game === game))
        .map(entry => entry.value),
    ),
  ])
  let primary = null
  try {
    const resolved = await resolveAtlasAliasName(key)
    if (resolved && (!game || resolved.game === game)) primary = resolved.value
  } catch {
    // 内部解析不可用时退回快照候选，不向调用方抛错
  }
  if (!primary) primary = candidates[0] || null
  return Object.freeze({ key, candidates, primary })
}

/** 关键词 → 检索变体（原词 + 别名），用于扩大搜索召回 */
export async function expandKeyword(keyword, gameId) {
  const text = String(keyword || '').trim()
  if (!text) return Object.freeze([])
  const hit = await resolveAlias(text, gameId)
  return Object.freeze([...new Set([text, ...hit.candidates])])
}

/** 角色名 → 专武标准名（复用荷花既有实现） */
export async function resolveWeapon(charName) {
  return resolveSignatureWeapon(charName)
}
