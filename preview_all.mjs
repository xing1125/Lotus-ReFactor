import { renderWithSkia } from "./core/render/skia.js"

const outDir = "preview"

const cases = [
  {
    name: "schedule-notice",
    data: {
      title: "明日签到计划",
      subtitle: "群① · 08-29",
      badge: "PLAN",
      message: "共 6 个 profile · 固定 08:10 · 通知方式 私聊",
      groupId: "54533020733",
      items: [
        { label: "签到时间", value: "08:10" },
        { label: "模式", value: "固定" },
        { label: "日期", value: "2026-08-29" },
        { label: "群号", value: "54533020733" },
        { label: "已注册", value: "38 人" },
        { label: "通知开启", value: "35 人" },
      ],
    },
  },
  {
    name: "bilibili-info",
    data: {
      type: "video",
      id: "BV1xx411c7mD",
      owner: "演示UP主",
      title: "荷花插件演示视频",
      desc: "这是一段用于验证字体颜色与排版是否正常显示的演示简介文本。",
      stat: { view: 125000, like: 9300, favorite: 2100, coin: 1500, reply: 320, danmaku: 88, duration: 186 },
    },
  },
  {
    name: "genshin-team-damage",
    data: {
      title: "原神队伍伤害",
      subtitle: "胡桃核爆队",
      badge: "GS",
      message: "深境螺旋 12-3 · 上半",
      summary: [
        { label: "总伤害", value: "1.28M" },
        { label: "用时", value: "42s" },
        { label: "最高单段", value: "96.3万" },
        { label: "覆盖率", value: "93%" },
      ],
      pie: [
        { char: "胡桃", damage: 720000, color: "#F1C40F" },
        { char: "行秋", damage: 280000, color: "#38BDF8" },
        { char: "钟离", damage: 160000, color: "#9FB3C8" },
        { char: "阿贝多", damage: 120000, color: "#22D3EE" },
      ],
      team: [
        { name: "胡桃", elem: "火", level: 90, cons: 1, weapon: "护摩之杖", weaponAffix: 5, weaponLevel: 90, stats: { "暴击率": 73, "暴击伤害": 210, "元素充能效率": 130 } },
        { name: "行秋", elem: "水", level: 90, cons: 6, weapon: "苍古", weaponAffix: 1, weaponLevel: 90, stats: { "暴击率": 50, "暴击伤害": 120, "元素充能效率": 180 } },
      ],
      damages: [{ label: "E 接重击", desc: "蒸发", pct: 0.62 }],
      buffs: [{ label: "钟离盾", desc: "减抗" }],
    },
  },
  {
    name: "starrail-team-damage",
    data: {
      title: "星铁队伍伤害",
      subtitle: "黄泉队",
      badge: "SR",
      message: "虚构叙事 · 回忆的序列",
      summary: [
        { label: "总伤害", value: "2.1M" },
        { label: "回合", value: "3" },
        { label: "最高段", value: "88万" },
        { label: "击破", value: "12" },
      ],
      pie: [
        { char: "黄泉", damage: 1200000, color: "#169179" },
        { char: "花火", damage: 500000, color: "#38BDF8" },
        { char: "椒丘", damage: 280000, color: "#B96AD9" },
      ],
      team: [
        { name: "黄泉", elem: "雷", path: "虚无", level: 80, rank: 1, weapon: "星海", weaponRank: 1, weaponLevel: 80, stats: { "暴击率": 75, "暴击伤害": 160, "速度": 134, "击破": 120 } },
        { name: "花火", elem: "量子", path: "虚无", level: 80, rank: 0, weapon: "晚眠", weaponRank: 1, weaponLevel: 80, stats: { "暴击率": 60, "暴击伤害": 100, "速度": 160, "击破": 80 } },
      ],
    },
  },
  {
    name: "starrail-challenge",
    data: {
      results: [
        { title: "虚构叙事", subtitle: "回忆的序列", meta: "Difficulty 4 · 180s", monsters: [{ name: "杰帕德" }, { name: "史莱姆" }], desc: "优先击破核心，注意波次节奏。" },
      ],
    },
  },
  {
    name: "achievement-index",
    data: {
      title: "原神成就目录",
      subtitle: "提瓦特见闻",
      badge: "ACH",
      message: "共 48 个分类",
      summary: [
        { label: "总成就", value: "1380" },
        { label: "已完成", value: "1120" },
        { label: "原石", value: "3200" },
        { label: "完成率", value: "81%" },
      ],
      categories: [
        { name: "天地之一端", completed: 18, total: 20, pointsDone: 300, pointsTotal: 360, percent: 90, icon: "" },
        { name: "蒙德·飞行", completed: 8, total: 15, pointsDone: 120, pointsTotal: 240, percent: 50, icon: "" },
      ],
    },
  },
  {
    name: "achievement-category",
    data: {
      title: "原神成就 · 蒙德",
      subtitle: "蒙德·飞行",
      badge: "ACH",
      message: "已完成 8/15",
      summary: [
        { label: "完成率", value: "53%" },
        { label: "剩余", value: "7" },
        { label: "原石", value: "120/240" },
        { label: "分组", value: "3" },
      ],
      groups: [
        { name: "风起地", done: true, completed: 5, total: 5, pointsDone: 90, pointsTotal: 240, desc: "蒙德城周边探索", stages: [{ stageIndex: 1, stageTotal: 1, desc: "抵达风起地神像", done: true, points: 20, progress: "1/1", date: "2026-03-10" }] },
      ],
      hiddenCount: 4,
    },
  },
  {
    name: "atlas-result",
    data: {
      title: "图鉴搜索结果",
      subtitle: "胡桃",
      badge: "ATLAS",
      message: "共 1 条结果",
      items: [
        { title: "胡桃", meta: "火 · 五星 · 往生堂", desc: "往生堂第七十七代堂主，操纵炽烈的业火。" },
      ],
    },
  },
  {
    name: "atlas-item",
    data: {
      view: {
        kind: "character",
        title: "胡桃",
        description: "往生堂第七十七代堂主。",
        stats: [
          { label: "生命", value: "12890" },
          { label: "攻击", value: "1064" },
          { label: "防御", value: "702" },
          { label: "元素精通", value: "0" },
          { label: "暴击率", value: "5.0%" },
          { label: "暴击伤害", value: "50.0%" },
        ],
        skills: [{ title: "往生秘传·血梅香", type: "普攻", desc: "枪击造成火元素伤害。" }],
        constellations: [{ title: "一魂 · 赤团", desc: "重击后提升攻击。" }],
        materials: [{ name: "燃愿之种" }, { name: "常燃火种" }],
      },
    },
  },
  {
    name: "atlas-challenge",
    data: {
      view: {
        environment: [{ title: "环境效果", text: "本层敌人火抗降低 30%。" }],
        optionalBuffs: [{ title: "可选增益", text: "击破时造成额外伤害。" }],
        rooms: [{ title: "关卡 1", subtitle: "首波", desc: "守卫 x2", enemies: [{ name: "深渊法师" }] }],
      },
    },
  },
  {
    name: "qr-login",
    data: { profileId: 1 },
  },
]

// 删除无效占位项
const realCases = cases.filter(c => c.name)

for (const c of realCases) {
  const out = `${outDir}/${c.name}.png`
  try {
    await renderWithSkia(c.name, c.data, { path: out, renderScale: 2 })
    console.log(`OK  ${c.name} -> ${out}`)
  } catch (e) {
    console.error(`FAIL ${c.name}:`, e.message)
  }
}
