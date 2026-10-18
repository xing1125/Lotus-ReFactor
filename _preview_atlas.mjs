// 图鉴页 / 星铁挑战页 预览（验证配色是否跟随 LOTUS_THEME）
// 用法：LOTUS_THEME=crystal node _preview_atlas.mjs
import { renderAtlasPage } from "./core/render/atlas-pages.js"
import { renderStarRailAbyss } from "./core/render/starrail-abyss.js"
import { buildStarRailAbyssSections } from "./core/render/starrail-abyss.js"
import fs from "node:fs/promises"
import path from "node:path"

const outDir = path.resolve("preview")

const view = { game: "原神", page: "角色资料", version: "", kind: "character" }

const atlasPage = {
  index: 1,
  total: 3,
  section: "角色资料",
  element: "gs",
  height: 980,
  blocks: [
    { type: "label", title: ["神里绫华"], icon: "", subtitle: "冰元素 · 单手剑", height: 120 },
    {
      type: "text",
      lines: ["社奉行神里家的大小姐。端庄文雅，聪慧坚韧。", "人称「白鹭公主」，深受民众爱戴。"],
      size: 19, color: "#000", lineHeight: 29, height: 88,
    },
    { type: "gap", height: 18 },
    {
      type: "facts",
      facts: [
        { label: ["生命值"], value: ["12,858"] },
        { label: ["攻击力"], value: ["3,492"] },
        { label: ["防御力"], value: ["784"] },
      ],
      height: 96,
    },
    {
      type: "table-head", cells: [["等级"], ["基础生命值"], ["基础攻击力"]], widths: [280, 236, 236],
      height: 50, title: "等级数值",
    },
    { type: "table-row", cells: [["Lv.1"], ["1,000"], ["27"]], widths: [280, 236, 236], height: 44 },
    { type: "table-row", cells: [["Lv.20"], ["2,592"], ["70"]], widths: [280, 236, 236], height: 44 },
    { type: "table-row", cells: [["Lv.40"], ["4,400"], ["118"]], widths: [280, 236, 236], height: 44 },
    { type: "gap", height: 18 },
    {
      type: "material",
      icon: "", name: ["哀叙冰玉"], count: "6",
      height: 84,
    },
  ],
}

// 生成假角色头像（仅预览用，验证角色行图位/裁切与命徽标叠加）
import { Canvas } from "skia-canvas"
const abyssIcons = {}
for (const [i, [name, color]] of [["开拓者", "#7f8fd8"], ["花火", "#c96f6f"], ["阮·梅", "#8fa8d8"], ["符玄", "#8fc8c0"],
  ["黄泉", "#9b7fd8"], ["银狼", "#7f9fc8"], ["知更鸟", "#6fb8b0"], ["霍霍", "#c8a06c"],
  ["流萤", "#c88fb0"], ["波提欧", "#8fb0c8"], ["同谐主角", "#b0a06c"], ["星期日", "#a08fd8"],
  ["飞霄", "#c8a08f"], ["椒丘", "#d8b08f"], ["貊泽", "#8f9fc8"], ["三月七", "#8fd8d0"],
  ["刃", "#b06f8f"], ["镜流", "#a8c8e0"], ["罗刹", "#d0c0a0"], ["驭空", "#9fc8a8"]].entries()) {
  const canvas = new Canvas(240, 320)
  const ctx = canvas.getContext("2d")
  const g = ctx.createLinearGradient(0, 0, 0, 320)
  g.addColorStop(0, color); g.addColorStop(1, "#f2f5f9")
  ctx.fillStyle = g; ctx.fillRect(0, 0, 240, 320)
  ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.font = "600 40px MiSans"
  ctx.textAlign = "center"; ctx.fillText(name, 120, 250)
  const file = path.join(outDir, `_abyss-${i}.png`)
  await canvas.toFile(file)
  abyssIcons[name] = file
}

const TEAMS = {
  a: ["开拓者", "花火", "阮·梅", "符玄"],
  b: ["黄泉", "银狼", "知更鸟", "霍霍"],
  c: ["流萤", "波提欧", "同谐主角", "星期日"],
  d: ["飞霄", "椒丘", "貊泽", "三月七"],
  e: ["刃", "镜流", "罗刹", "驭空"],
}
const RANKS = { 开拓者: 6, 花火: 1, 银狼: 2, 霍霍: 4, 符玄: 2, 流萤: 0, 飞霄: 1, 镜流: 3 }
const ELEMENTS = ["Quantum", "Wind", "Ice", "Imaginary"]
const team = key => TEAMS[key].map((name, i) => ({
  name,
  level: 80,
  rarity: i % 3 === 2 ? 4 : 5,
  rank: RANKS[name] || 0,
  element: ELEMENTS[i % ELEMENTS.length],
  icon: abyssIcons[name] || abyssIcons.开拓者,
}))

const abyssData = {
  uid: "100398381",
  floorLimit: 3,
  generatedAt: "2026.10.16 20:00",
  results: [
    {
      kind: "hall",
      label: "混沌回忆",
      period: "2026.09.28 06:00-2026.11.02 04:00",
      stars: 36,
      extraStars: 1,
      battleNum: 3,
      maxFloor: "来生泗渡其十二",
      floors: [
        { title: "来生泗渡其十", stars: 3, round: 0, score: 3820, tierce: false, nodes: [
          { label: "节点1", time: "2026.10.08 23:53", score: 1910, round: 3, avatars: team("b") },
          { label: "节点2", time: "2026.10.08 23:53", score: 1910, round: 4, avatars: team("d") },
        ] },
        { title: "来生泗渡其十一", stars: 3, round: 0, score: 3820, tierce: false, nodes: [
          { label: "节点1", time: "2026.10.09 00:00", score: 1910, round: 2, avatars: team("c") },
          { label: "节点2", time: "2026.10.09 00:00", score: 1910, round: 5, avatars: team("e") },
        ] },
        { title: "来生泗渡其十二", stars: 3, round: 7, score: 3820, tierce: true, nodes: [
          { label: "节点1", time: "2026.10.09 00:06", score: 1910, round: 7, avatars: team("a") },
          { label: "节点2", time: "2026.10.09 00:14", score: 1910, round: 6, avatars: team("b") },
          { label: "节点3", time: "2026.10.09 00:23", score: 1910, round: 5, defeated: true, avatars: team("c") },
        ] },
      ],
    },
  ],
}

const theme = (process.env.LOTUS_THEME || "crystal").toLowerCase()

try {
  const buf = await renderAtlasPage({ atlasPage, title: "神里绫华", view, image: "" }, { renderScale: 2 })
  await fs.writeFile(path.join(outDir, "atlas-page.png"), buf)
  console.log("OK  atlas-page ->", path.join(outDir, "atlas-page.png"))
} catch (e) {
  console.error("FAIL atlas-page:", e.message)
}

try {
  console.log("abyss sections =", buildStarRailAbyssSections(abyssData).length)
  const buf = await renderStarRailAbyss(abyssData, { renderScale: 2, imgType: "png" })
  await fs.writeFile(path.join(outDir, "starrail-challenge.png"), buf)
  console.log("OK  starrail-challenge ->", path.join(outDir, "starrail-challenge.png"))
} catch (e) {
  console.error("FAIL starrail-challenge:", e.message)
}

console.log("theme =", theme)
