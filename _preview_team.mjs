// 队伍伤害（新「Aozaki Arina」版式）预览：数据照用户参考图复刻
//   A 无伤害过程（= 参考图的形态）  B 带伤害过程（detail）
// 用法：node _preview_team.mjs
globalThis.logger = globalThis.logger || { warn() {}, debug() {}, info() {}, mark() {}, error() {} }
const { renderTeamDamage } = await import("./core/render/team-damage.js")
const { Canvas } = await import("skia-canvas")
const path = (await import("node:path")).default

// 假头像（真实环境用米游社 face 图）
const faces = {}
for (const [i, [name, color]] of [["芙宁娜", "#5b8fd6"], ["爱可菲", "#7fb2c9"], ["申鹤", "#9fb6d8"], ["丝柯克", "#a88fd8"]].entries()) {
  const c = new Canvas(160, 160), x = c.getContext("2d")
  const g = x.createLinearGradient(0, 0, 0, 160)
  g.addColorStop(0, color); g.addColorStop(1, "#eef3fa")
  x.fillStyle = g; x.fillRect(0, 0, 160, 160)
  x.fillStyle = "rgba(20,28,42,.82)"; x.font = "700 88px MiSans"; x.textAlign = "center"; x.textBaseline = "middle"
  x.fillText(name.slice(0, 1), 80, 84)
  const f = path.resolve("preview", `_tm-face-${i}.png`)
  await c.toFile(f); faces[name] = f
}

const member = (name, o) => ({
  name, rarity: 5, level: 90, elem: o.elem, icon: faces[name],
  cons: o.cons, weapon: { name: o.wname, rarity: 5, affix: o.affix, level: 90 },
  stats: o.stats, keyProp: o.keyProp, keyValue: o.keyValue, recharge: o.recharge,
  skills: o.skills.map((lv, i) => ({ icon: "", level: lv, style: i === 1 && lv > 9 ? "extra" : "" })),
})

const avatars = [
  member("芙宁娜", { elem: "水", cons: 2, wname: "静水流涌之辉", affix: 1, stats: { 暴击率: 66, 暴击伤害: 230.4 }, keyProp: "攻击", keyValue: 2338, recharge: { pct: "0%", same: 11.5, diff: 8.3 }, skills: [8, 11, 10] }),
  member("爱可菲", { elem: "冰", cons: 0, wname: "苍古自由之誓", affix: 5, stats: { 暴击率: 39.8, 暴击伤害: 68.6 }, keyProp: "生命", keyValue: 49886, recharge: { pct: "100%", same: 8.3, diff: 11.5 }, skills: [4, 10, 10] }),
  member("申鹤", { elem: "冰", cons: 0, wname: "息灾", affix: 5, stats: { 暴击率: 58.4, 暴击伤害: 154.9 }, keyProp: "攻击", keyValue: 1855, recharge: { pct: "100%", same: 11.5, diff: 8.3 }, skills: [1, 10, 8] }),
  member("丝柯克", { elem: "冰", cons: 2, wname: "雾切之回光", affix: 5, stats: { 暴击率: 14.3, 暴击伤害: 175.1, 元素充能效率: 266.0 }, keyProp: "充能", keyValue: "266.0%", recharge: { pct: "76%", same: 8.3, diff: 11.5 }, skills: [1, 8, 10] }),
]

const base = {
  badge: "GS", uid: "257698897", title: "原神队伍伤害",
  summary: [
    { label: "总伤害", value: "442.8万" },
    { label: "DPS", value: "260443" },
    { label: "时间", value: "17" },
    { label: "评级", value: "ACE" },
  ],
  total: 4428000,
  pie: [
    { char: "丝柯克", damage: 3935000, color: "#7FE3E8" },
    { char: "芙宁娜", damage: 227000, color: "#F5A9C0" },
    { char: "爱可菲", damage: 214000, color: "#FFD166" },
    { char: "莫娜", damage: 51000, color: "#C9A6F0" },
  ],
  avatars,
  actions: ["芙宁娜E", "Q", "爱可菲E", "Q", "莫娜E", "Q", "A1", "A2", "A3", "丝柯克Q", "短E", "重击", "A1", "A2", "A3", "A4", "A5", "A1", "A2", "A3", "A4", "A5"],
  buffs: [
    { time: "0.0", name: "双水共鸣", detail: "全队最大生命+25%" },
    { time: "0.3", name: "千岩被动", detail: "全队攻击力+20%" },
    { time: "3.0", name: "爱可菲天赋2减抗", detail: "怪物水冰抗减少-55%" },
    { time: "3.0", name: "绘卷套", detail: "全队冰属性伤害增加+12%" },
    { time: "3.0", name: "绘卷套", detail: "全队水属性伤害增加+12%" },
    { time: "7.0", name: "莫娜Q", detail: "怪物受到伤害+60%" },
    { time: "7.0", name: "莫娜1命", detail: "全队水元素反应效果提升+15%" },
    { time: "7.0", name: "莫娜1命", detail: "全队水元素反应效果提升+15%" },
    { time: "7.4", name: "莫娜1命", detail: "全队水元素反应效果提升+15%" },
    { time: "8.3", name: "讨龙被动", detail: "丝柯克攻击力+48%" },
    { time: "8.41", name: "雾切(元素爆发)", detail: "丝柯克冰伤+8%" },
    { time: "8.41", name: "雾切(能量低于100%)", detail: "丝柯克冰伤+8%" },
    { time: "10.3", name: "莫娜1命", detail: "全队水元素反应效果提升+15%" },
    { time: "11.3", name: "雾切(元素普攻)", detail: "丝柯克冰伤+12%" },
  ],
  damages: [
    { time: 0, action: "E", values: [12480, 6240, 11860] },
    { time: 1.2, action: "Q", values: [28600, 14300, 27180] },
    { time: 2.4, action: "E", values: [18240, 9120, 17330] },
    { time: 3.6, action: "重击", values: [46800, 23400, 44460] },
    { time: 4.8, action: "重击", values: [46800, 23400, 44460] },
    { time: 5.8, action: "重击", values: [46800, 23400, 44460] },
  ],
}

const fs = await import("node:fs/promises")
const out = async (data, file) => {
  const buf = await renderTeamDamage(data, { renderScale: 2, imgType: "png" })
  await fs.writeFile(file, buf)
  console.log("OK ->", file)
}
await out({ ...base, detail: false }, "preview/_tm-ref.png")
await out({ ...base, detail: true }, "preview/_tm-detail.png")
await out({ ...base, sr: true, badge: "SR", title: "星铁队伍伤害", detail: false }, "preview/_tm-sr.png")
