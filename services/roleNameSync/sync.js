/**
 * 角色别名表同步服务
 *
 * miao-plugin 的角色库（resources/meta-gs/character）通常比 genshin 插件自带的
 * config/defSet/role/name.yaml 更新得快，而 #XX攻略 走的是后者。本服务把 miao 已收录、
 * genshin 表缺失的角色 ID 追加到表末尾，只新增、绝不改动已有条目，可重复运行。
 *
 * 同步后需调用 invalidateGsCfgCache() 清掉 gsCfg 单例的 nameID Map，
 * 否则 getAbbr() 会直接返回旧缓存，新角色仍解析不到。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginsRoot = path.resolve(here, '../../..')
const MIAO_DATA = path.join(pluginsRoot, 'miao-plugin', 'resources', 'meta-gs', 'character', 'data.json')
const MIAO_ALIAS = path.join(pluginsRoot, 'miao-plugin', 'resources', 'meta-gs', 'character', 'alias.js')
const GS_NAMES = path.join(pluginsRoot, 'genshin', 'config', 'defSet', 'role', 'name.yaml')
const GS_CFG = path.join(pluginsRoot, 'genshin', 'model', 'gsCfg.js')

const require = createRequire(path.join(pluginsRoot, 'genshin', 'package.json'))
const YAML = require('yaml')

/**
 * 对比两个角色库；apply=true 时才落盘，并先备份原文件。
 * 路径参数仅供沙箱测试注入，正常调用全部使用默认路径。
 */
export async function syncRoleNames({
  apply = false,
  dataPath = MIAO_DATA,
  aliasPath = MIAO_ALIAS,
  namesPath = GS_NAMES,
} = {}) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
  let alias = {}
  try {
    const mod = await import(pathToFileURL(aliasPath).href + '?t=' + Date.now())
    alias = mod.alias || {}
  } catch (_) {
    // 别名表不可用时退化为只同步主名
  }

  const raw = fs.readFileSync(namesPath, 'utf8')
  const current = YAML.parse(raw) || {}
  const existingNames = new Set()
  for (const k in current) {
    for (const a of current[k] || []) existingNames.add(String(a))
  }

  const missing = []
  for (const [id, info] of Object.entries(data)) {
    if (!info?.name) continue
    const key = String(id)
    if (Object.prototype.hasOwnProperty.call(current, key)) continue
    const list = [info.name]
    const extras = String(alias[info.name] || '').split(',').map(s => s.trim()).filter(Boolean)
    for (const a of extras) {
      if (!list.includes(a) && !existingNames.has(a)) {
        list.push(a)
        existingNames.add(a)
      }
    }
    missing.push({ id: key, list })
  }

  const result = {
    total: Object.keys(data).length,
    existing: Object.keys(current).length,
    missing,
    written: false,
    backup: null,
  }
  if (!apply || !missing.length) return result

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = namesPath.replace(/\.yaml$/, `.bak-${ts}.yaml`)
  fs.writeFileSync(backup, raw, 'utf8')
  const stamp = new Date().toLocaleString('zh-CN')
  const block = missing
    .map(m => `"${m.id}":\n` + m.list.map(a => `  - ${a}`).join('\n'))
    .join('\n')
  fs.writeFileSync(namesPath, `${raw.trimEnd()}\n# Lotus-Plugin 自动同步 ${stamp}\n${block}\n`, 'utf8')
  result.written = true
  result.backup = backup
  return result
}

/** 清除 gsCfg 单例的别名缓存，让新角色无需 #重载 即刻生效 */
export async function invalidateGsCfgCache() {
  try {
    const mod = await import(pathToFileURL(GS_CFG).href)
    const cfg = mod.default
    delete cfg.nameID
    delete cfg.sr_nameID
    if (cfg.defSet) delete cfg.defSet['role.name']
    if (cfg.config) delete cfg.config['role.name']
    return true
  } catch (_) {
    return false
  }
}
