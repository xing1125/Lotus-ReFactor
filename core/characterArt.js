// 角色立绘库解析器
// 从 app/plugins/character-art/manifest.json 读取立绘清单（扁平结构 images: [{name, game, file}]），
// 提供 getRandomCharacter(game?) 供签到卡片随机抽取一张立绘。
// 立绘库由 scripts/build-character-art.mjs 生成；缺失时优雅降级（返回 ""）。
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGINS_ROOT = path.resolve(__dirname, "../../") // .../app/plugins
const LIB_DIR = path.join(PLUGINS_ROOT, "character-art")
const MANIFEST_PATH = path.join(LIB_DIR, "manifest.json")

let cache = null
let cacheTime = 0
const CACHE_TTL = 60 * 1000 // 1 分钟热缓存，便于运行时增删立绘后自动生效

function loadManifest() {
  const now = Date.now()
  if (cache && now - cacheTime < CACHE_TTL) return cache
  let images = []
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
      // 兼容两种结构：v3 扁平 {images:[...]} / v2 分组 {games:{...}}
      if (Array.isArray(parsed?.images)) {
        images = parsed.images
      } else if (parsed?.games) {
        for (const g of Object.keys(parsed.games)) {
          for (const e of parsed.games[g] || []) images.push({ ...e, game: e.game || g })
        }
      }
    }
  } catch (e) {
    globalThis.logger?.warn?.(`[荷花插件·立绘库] manifest 读取失败：${e.message}`)
  }
  cache = images
  cacheTime = now
  return cache
}

function pickRandom(list) {
  if (!Array.isArray(list) || !list.length) return null
  return list[Math.floor(Math.random() * list.length)]
}

// game: "genshin" | "starrail" | "zzz" | undefined(任意)
// 返回绝对文件路径；库为空时返回 ""
export function getRandomCharacter(game) {
  const images = loadManifest()
  if (!images.length) return ""
  const pool = game ? images.filter(e => e.game === game) : images
  const entry = pickRandom(pool.length ? pool : images)
  if (!entry) return ""
  // manifest 中存的是相对 app/plugins 的路径
  return path.resolve(PLUGINS_ROOT, entry.file || "")
}

export const characterArtLibrary = { LIB_DIR, MANIFEST_PATH }
