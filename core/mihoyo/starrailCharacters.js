import { createRequire } from "node:module"

// Miao character IDs also cover API responses that omit name_mi18n.
// 资源子模块（starrail-abyss）未初始化时降级为空映射，避免整模块加载崩溃（自维护模式）
let names = {}
try {
  names = createRequire(import.meta.url)("../../resources/starrail-abyss/characters.json")
} catch {
  names = {}
}

export function starRailCharacterName(id) {
  return names[String(id)] || ""
}
