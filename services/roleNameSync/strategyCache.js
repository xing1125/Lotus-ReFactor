/**
 * 攻略图缓存 TTL 淘汰
 *
 * genshin 的 strategy.js 是「缓存 jpg 存在就直发，不存在才去米游社合集下载」。
 * 因此只要把过期的缓存文件移走，下次查询自然就会拉最新攻略图 ——
 * 不用改第三方源码、不用主动联网、不用给任何人发消息。
 *
 * 只处理 temp/strategy/<纯数字来源目录>/ 下的 .jpg（gs/sr/zzz 等不碰），
 * 移走而非删除，落到 _stale/<来源>/ 保留最近一份备份，可随时回滚。
 *
 * 设 LOTUS_STRATEGY_CACHE_TTL_DAYS=0 可关闭自动淘汰。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const yunzaiRoot = path.resolve(here, '../../../..')
const STRATEGY_ROOT = path.join(yunzaiRoot, 'temp', 'strategy')
const DEFAULT_TTL_DAYS = 30

export function rotateStaleStrategyCache({
  root = STRATEGY_ROOT,
  maxAgeDays = Number(process.env.LOTUS_STRATEGY_CACHE_TTL_DAYS ?? DEFAULT_TTL_DAYS),
  apply = false,
  now = Date.now(),
} = {}) {
  const result = { scanned: 0, rotated: [], ttlDays: maxAgeDays, written: false }
  if (!fs.existsSync(root)) return result
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return result

  const ttlMs = maxAgeDays * 86400000
  const staleRoot = path.join(root, '_stale')
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const dir = path.join(root, entry.name)
    for (const file of fs.readdirSync(dir)) {
      if (!file.toLowerCase().endsWith('.jpg')) continue
      const src = path.join(dir, file)
      let st
      try { st = fs.statSync(src) } catch (_) { continue }
      result.scanned++
      if (now - st.mtimeMs < ttlMs) continue
      result.rotated.push(src)
      if (!apply) continue

      const dstDir = path.join(staleRoot, entry.name)
      fs.mkdirSync(dstDir, { recursive: true })
      const dst = path.join(dstDir, file)
      if (fs.existsSync(dst)) fs.unlinkSync(dst)
      fs.renameSync(src, dst)
    }
  }
  result.written = apply && result.rotated.length > 0
  return result
}
