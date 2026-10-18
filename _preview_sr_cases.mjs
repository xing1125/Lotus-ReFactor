// 星铁挑战战绩卡边界用例（虚构叙事 4 关 / 末日幻影 8 人两行 / 异相仲裁 / 无战绩 / 多模式）：
//   node _preview_sr_cases.mjs
// 依赖 preview/_abyss-*.png 假头像，先跑一次 node _preview_atlas.mjs 生成。
import fs from "node:fs/promises"
import path from "node:path"
import { renderStarRailAbyss, buildStarRailAbyssSections } from "./core/render/starrail-abyss.js"

const outDir = path.resolve("preview")
const icon = path.join(outDir, "_abyss-0.png")
const team = n => Array.from({ length: n }, (_, i) => ({
  name: `角色${i + 1}`, level: 80, rarity: i % 2 ? 4 : 5, rank: i, element: ["Fire", "Ice", "Wind", "Quantum", "Lightning"][i % 5], icon,
}))

const cases = {
  // 虚构叙事：4 关，每关 1 个节点
  story: {
    uid: "100398381", saved: true,
    results: [{ kind: "story", label: "虚构叙事", period: "2026.10.13-2026.11.24", stars: 12, battleNum: 1,
      floors: [
        { title: "羁鸟奇谭其一", stars: 3, round: 1, score: 40000, nodes: [{ label: "节点1", time: "2026.10.14 10:00", defeated: true, buff: "增益·破阵七击：我方全体击破特攻提高30%", avatars: team(4) }] },
        { title: "羁鸟奇谭其二", stars: 3, round: 2, score: 40000, nodes: [{ label: "节点1", time: "2026.10.14 10:20", buff: "增益·连携：队伍中角色攻击时无视目标12%防御力", avatars: team(4) }] },
        { title: "羁鸟奇谭其三", stars: 3, round: 3, score: 32000, nodes: [{ label: "节点1", time: "2026.10.14 10:40", avatars: team(4) }] },
        { title: "羁鸟奇谭其四", stars: 3, round: 4, score: 28000, nodes: [{ label: "节点1", time: "2026.10.14 11:00", avatars: team(4) }] },
      ] }],
  },
  // 末日幻影：单关四节点 + 8 人（两行）
  boss: {
    uid: "100398381",
    results: [{ kind: "boss", label: "末日幻影", period: "2026.10.13-2026.11.24", stars: 6, battleNum: 2, extraStars: 0,
      floors: [
        { title: "末日幻影·其一", stars: 3, round: 5, tierce: true,
          nodes: [
            { label: "节点1", time: "2026.10.14 12:00", defeated: true, avatars: team(8) },
            { label: "节点2", time: "2026.10.14 12:30", avatars: team(4) },
            { label: "节点3", time: "2026.10.14 13:00", avatars: team(3) },
          ] },
      ] }],
  },
  // 异相仲裁：peak 记录
  peak: {
    uid: "100398381",
    results: [{ kind: "peak", label: "异相仲裁", period: "2026.10.01-2026.10.15", stars: 6, battleNum: 4,
      peak: [{ title: "3.4 异相仲裁", period: "2026.10.01-2026.10.15", bossStars: 3, mobStars: 3,
        boss: { title: "王棋", stars: 3, round: 4, cleared: true, time: "2026.10.12 20:00", avatars: team(4) },
        mobs: [{ title: "骑士1", stars: 3, round: 3, cleared: true, time: "2026.10.12 20:10", avatars: team(4) },
          { title: "骑士2", stars: 3, round: 3, cleared: false, time: "2026.10.12 20:20", avatars: team(4) }] }] }],
  },
  // 完全没有战绩
  empty: {
    uid: "100398381",
    results: [{ kind: "hall", label: "混沌回忆", period: "", stars: "", battleNum: "", floors: [] }],
  },
  // 多模式（一键查深渊）
  all: {
    uid: "100398381",
    results: [
      { kind: "hall", label: "混沌回忆", period: "2026.09.28 06:00-2026.11.02 04:00", stars: 36, battleNum: 3,
        floors: [{ title: "来生泗渡其十二", stars: 3, round: 7, tierce: true, nodes: [{ label: "节点1", time: "2026.10.09 00:06", defeated: true, avatars: team(4) }] }] },
      { kind: "story", label: "虚构叙事", period: "2026.10.13-2026.11.24", stars: 12, battleNum: 1,
        floors: [{ title: "羁鸟奇谭其四", stars: 3, round: 4, nodes: [{ label: "节点1", time: "2026.10.14 11:00", avatars: team(4) }] }] },
    ],
  },
}

for (const [name, data] of Object.entries(cases)) {
  try {
    const sections = buildStarRailAbyssSections(data)
    const buffer = await renderStarRailAbyss(data, { renderScale: 1, imgType: "png", onRender: info => console.log(`   ${name}: ${info.width}x${info.height} tiles=${info.tiles}`) })
    await fs.writeFile(path.join(outDir, `_sr-${name}.png`), buffer)
    console.log(`OK   _sr-${name}.png  sections=${sections.length}`)
  } catch (error) {
    console.error(`FAIL ${name}: ${error.stack}`)
  }
}
