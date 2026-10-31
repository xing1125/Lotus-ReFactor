// 图鉴三模块「成品卡」资源索引。
// 不做重新绘制：直接复用 Atlas 图鉴插件里已经做好的三套卡面（1600×900 武器 / 1080×1700 圣遗物 /
// 1920×1080 角色养成材料），按名称命中即直发原图，视觉与原插件 100% 一致。
// 找不到成品图（新版本新增内容）时，交由 nanoka 数据渲染兜底。
//
// 资源优先级：
//   1. Lotus 自己的 resources/guide-cards/<kind>/   ← 迁移完成后放这里，可脱离 Atlas
//   2. Atlas 插件 Genshin-Atlas/<dir>/              ← 过渡期直接借源
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { resourcesPath } from '../../core/path.js'

// kind → 目录名（Atlas 上游沿用中文/带空格的英文目录名）
const KIND_DIRS = {
  weapon: 'weapon',
  artifact: 'artifact',
  character: 'material for role',
}

// Lotus 本地目标目录名
const LOCAL_DIRS = {
  weapon: 'weapon',
  artifact: 'artifact',
  character: 'character',
}

function atlasRoots() {
  const roots = []
  const local = path.join(resourcesPath, 'guide-cards')
  if (existsSync(local)) roots.push({ root: local, dirs: LOCAL_DIRS, local: true })
  // 只认 Lotus 本地库：Atlas 的旧版卡面署名与版式和逍遥库不一致（如 DESIGNED BY NWFLOWER），
  // 混用会破坏统一风格。缺图一律走 nanoka 渲染兜底。
  return roots
}

// 索引缓存：`${root}|${kind}` → Map(名称 → 文件绝对路径)，按目录 mtime 失效
const INDEX = new Map()

function safeMtime(dir) {
  try { return statSync(dir).mtimeMs } catch { return 0 }
}

function buildIndex(root, dirName, kind) {
  const dir = path.join(root, dirName)
  const key = `${dir}|${kind}`
  const mtime = safeMtime(dir)
  const cached = INDEX.get(key)
  if (cached && cached.mtime === mtime) return cached.map
  const map = new Map()
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!/\.(png|jpg|jpeg|webp)$/i.test(file)) continue
      const name = path.basename(file, path.extname(file))
      const full = path.join(dir, file)
      map.set(name, full)
      // 官方名带书名号的武器（「渔获」「究极霸王超级魔剑」）同时登记去掉书名号的键，
      // 避免上游数据少写括号时命不中。
      const bare = name.replace(/[「」『』]/g, '')
      if (bare !== name && !map.has(bare)) map.set(bare, full)
    }
  }
  INDEX.set(key, { mtime, map })
  return map
}

// 取某类成品卡：kind ∈ character | weapon | artifact
export function findGuideCard(kind, name) {
  const key = String(name || '').trim()
  if (!key || !KIND_DIRS[kind]) return null
  for (const { root, dirs } of atlasRoots()) {
    const dirName = dirs[kind]
    if (!dirName) continue
    const map = buildIndex(root, dirName, kind)
    const hit = map.get(key)
      || map.get(key.replace(/[·・]/g, ''))
      || map.get(key.replace(/[「」『』]/g, ''))
    if (hit && existsSync(hit)) return { file: hit, kind, name: key }
  }
  return null
}

// 覆盖率统计（#图鉴状态 用）
export function guideCardStats() {
  const stats = {}
  for (const kind of Object.keys(KIND_DIRS)) {
    let count = 0
    let fromLocal = false
    for (const { root, dirs, local } of atlasRoots()) {
      const dirName = dirs[kind]
      if (!dirName) continue
      const map = buildIndex(root, dirName, kind)
      // map 里可能带书名号别名键（同一文件两条记录），按文件去重
      const unique = new Set(map.values()).size
      if (unique) { count = Math.max(count, unique); fromLocal ||= Boolean(local) }
    }
    stats[kind] = { count, source: fromLocal ? 'local' : 'atlas' }
  }
  return stats
}

export function resetGuideCardCache() {
  INDEX.clear()
}
