// 原神深境螺旋战绩预览：A 完整四层 / B 缺字段兜底
// 用法：node _preview_genshin_abyss.mjs
globalThis.logger = globalThis.logger || { warn() {}, debug() {}, info() {}, mark() {}, error() {} }
const { renderGenshinAbyss } = await import("./core/render/genshin-abyss.js")
const path = (await import("node:path")).default
const fs = await import("node:fs/promises")

const ART = name => path.resolve("../character-art", `${name}.webp`)
// 魔物图走真实 API 图源（验证 fetch 链路），其余头像用本地立绘库
const MONSTER = "https://upload-os-bbs.mihoyo.com/game_record/genshin/object/UI_MonsterIcon_Chasm_Drake_Electric.png"

const avatarsOf = names => names.map((n, i) => ({
  icon: ART(n),
  level: 90,
  rarity: i === 3 ? 4 : 5,
  life: [2, 0, 6, 1][i] ?? 0,
}))

const room = (index, star, up, down, time) => ({
  index, star,
  time: time || "2026-10-16 23:41:02",
  halves: [
    { label: "上半", avatars: avatarsOf(up), monsters: [{ icon: MONSTER, level: 103 }, { icon: "", level: 100 }] },
    { label: "下半", avatars: avatarsOf(down), monsters: [{ icon: "", level: 105 }] },
  ],
})

const floor = (index, star, leyLine, rooms) => ({ index, star, maxStar: 9, leyLine, rooms })

const base = {
  uid: "257698897",
  title: "深境螺旋战绩",
  period: "2026.10.01-2026.10.16",
  maxFloor: "12-3",
  totalBattleTimes: 24,
  totalStar: 108,
  reveal: [
    { icon: ART("玛薇卡"), value: 28, rarity: 5 },
    { icon: ART("丝柯克"), value: 24, rarity: 5 },
    { icon: ART("芙宁娜"), value: 18, rarity: 5 },
    { icon: ART("钟离"), value: 12, rarity: 5 },
  ],
  ranks: [
    { key: "defeat", label: "最多击破", num: 187, icon: ART("阿蕾奇诺") },
    { key: "take_damage", label: "承受最多伤害", num: 86420, icon: ART("钟离") },
    { key: "normal_skill", label: "元素战技施放数", num: 96, icon: ART("芙宁娜") },
    { key: "damage", label: "最强一击", num: 2145833, icon: ART("玛薇卡") },
    { key: "energy_skill", label: "元素爆发次数", num: 41, icon: ART("雷电将军") },
  ],
  floors: [
    floor(9, 9, [], [
      room(1, 3, ["玛薇卡", "芙宁娜", "希诺宁", "班尼特"], ["丝柯克", "申鹤", "爱可菲", "夜兰"]),
      room(2, 3, ["玛薇卡", "芙宁娜", "希诺宁", "班尼特"], ["丝柯克", "申鹤", "爱可菲", "夜兰"]),
      room(3, 3, ["玛薇卡", "芙宁娜", "希诺宁", "班尼特"], ["丝柯克", "申鹤", "爱可菲", "夜兰"]),
    ]),
    floor(10, 9, ["队伍中所有角色的攻击力提升50%"], [
      room(1, 3, ["那维莱特", "芙宁娜", "纳西妲", "钟离"], ["雷电将军", "夜兰", "班尼特", "钟离"]),
      room(2, 3, ["那维莱特", "芙宁娜", "纳西妲", "钟离"], ["雷电将军", "夜兰", "班尼特", "钟离"]),
      room(3, 3, ["那维莱特", "芙宁娜", "纳西妲", "钟离"], ["雷电将军", "夜兰", "班尼特", "钟离"]),
    ]),
    floor(11, 9, ["敌人受到的水元素伤害提升30%，元素爆发造成的伤害提升20%"], [
      room(1, 3, ["玛薇卡", "芙宁娜", "希诺宁", "班尼特"], ["丝柯克", "申鹤", "爱可菲", "夜兰"]),
      room(2, 3, ["那维莱特", "芙宁娜", "纳西妲", "钟离"], ["雷电将军", "夜兰", "班尼特", "钟离"]),
      room(3, 3, ["玛薇卡", "芙宁娜", "希诺宁", "班尼特"], ["丝柯克", "申鹤", "爱可菲", "夜兰"]),
    ]),
    floor(12, 9, ["敌人受到的伤害提升15%"], [
      room(1, 3, ["玛薇卡", "芙宁娜", "希诺宁", "班尼特"], ["丝柯克", "申鹤", "爱可菲", "夜兰"]),
      room(2, 3, ["那维莱特", "芙宁娜", "纳西妲", "钟离"], ["雷电将军", "夜兰", "班尼特", "钟离"]),
      room(3, 3, ["玛薇卡", "芙宁娜", "希诺宁", "班尼特"], ["丝柯克", "申鹤", "爱可菲", "夜兰"]),
    ]),
  ],
  source: "米游社 · 深境螺旋",
  generatedAt: "荷花插件",
}

const out = async (data, file) => {
  const buf = await renderGenshinAbyss(data, { renderScale: 3, imgType: "png" })
  await fs.writeFile(file, buf)
  console.log("OK ->", file)
}

await out(base, "preview/_gsa-full.png")
await out({
  ...base,
  period: "",
  reveal: [],
  ranks: base.ranks.map(r => ({ ...r, icon: "" })),
  floors: [{ ...base.floors[3], leyLine: [], rooms: base.floors[3].rooms.map(r => ({ ...r, time: "", halves: r.halves.map(h => ({ ...h, monsters: [] })) })) }],
  source: "",
}, "preview/_gsa-min.png")
