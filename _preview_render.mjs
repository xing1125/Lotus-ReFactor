import { renderWithSkia } from "./core/render/skia.js"
import { DAILY_NOTE_ICONS } from "./core/render/daily-note.js"
import { getRandomCharacter } from "./core/characterArt.js"
import { Canvas } from "skia-canvas"
import path from "node:path"

const outDir = path.resolve("preview")

// 假派遣头像（仅预览用，验证派遣胶囊的圆环 / 裁切 / 完成勾标）
const expeditionIcons = []
for (const [i, [color, label]] of [["#7f8fd8", "A"], ["#c96f6f", "B"], ["#8fa8d8", "C"], ["#6fb8b0", "D"]].entries()) {
  const canvas = new Canvas(120, 120)
  const ctx = canvas.getContext("2d")
  const g = ctx.createLinearGradient(0, 0, 0, 120)
  g.addColorStop(0, color); g.addColorStop(1, "#eef2f8")
  ctx.fillStyle = g; ctx.fillRect(0, 0, 120, 120)
  ctx.fillStyle = "rgba(30,41,59,.85)"; ctx.font = "700 54px MiSans"
  ctx.textAlign = "center"; ctx.fillText(label, 60, 84)
  const file = path.join(outDir, `_exp-${i}.png`)
  await canvas.toFile(file)
  expeditionIcons.push(file)
}

// 体力面板（复刻 ji-plugin dailyNote 数据契约：ok=false 走失败面板）
const dailyNotePanels = () => {
  const I = DAILY_NOTE_ICONS
  const stamp = "2026年10月17日 12:34 星期六"
  return [
    {
      ok: true, uid: "100234567", game: "gs", gameName: "原神", profileLabel: "Profile 1",
      date: stamp, signed: true, logo: I.gs.logo,
      primary: { label: "原粹树脂", current: 142, max: 160, icon: I.gs.primary, recover: { day: "今天", time: "下午09:44" } },
      rows: [
        { icon: I.gs.coin, label: "洞天财瓮", value: 1920, max: 2400 },
        { icon: I.gs.daily, label: "每日委托", value: 2, max: 4, warn: true },
        { icon: I.gs.expedition, label: "探索派遣", value: 3, max: 5 },
      ],
      footer: { label: "尚未进行探索派遣", items: [
        { icon: expeditionIcons[0], done: false }, { icon: expeditionIcons[1], done: false },
        { icon: expeditionIcons[2], done: true }, { icon: expeditionIcons[3], done: false },
      ] },
    },
    {
      ok: true, uid: "800123456", game: "sr", gameName: "星穹铁道", profileLabel: "Profile 1",
      date: stamp, signed: true, logo: I.sr.logo,
      primary: { label: "开拓力", current: 240, max: 300, icon: I.sr.primary, recover: { day: "今天", time: "晚上10:05" } },
      reserve: "1200",
      rows: [
        { icon: I.sr.train, label: "每日实训", value: 500, max: 500 },
        { icon: I.sr.sim, label: "模拟宇宙", value: 14000, max: 14000 },
        { icon: I.sr.expedition, label: "委托执行", value: 3, max: 4 },
      ],
      footer: { label: "尚未进行委托执行", items: [
        { icon: expeditionIcons[0], done: false }, { icon: expeditionIcons[1], done: false },
        { icon: expeditionIcons[2], done: false }, { icon: expeditionIcons[3], done: true },
      ] },
    },
    {
      ok: true, uid: "130001234", game: "zzz", gameName: "绝区零", profileLabel: "Profile 2",
      date: stamp, signed: false, logo: I.zzz.logo,
      primary: { label: "电量", current: 60, max: 240, icon: I.zzz.primary, recover: { day: "今天", time: "晚上09:12" } },
      rows: [
        { icon: I.zzz.vitality, label: "活跃度", value: 150, max: 200, warn: true },
        { icon: I.zzz.sign, label: "刮刮卡", value: "已完成" },
        { icon: I.zzz.store, label: "录像店", value: "正在营业" },
      ],
      footer: null,
    },
    {
      ok: false, uid: "", game: "gs", gameName: "原神", profileLabel: "Profile 2",
      date: stamp, signed: null, logo: I.gs.logo,
      error: "米游社查询失败(retcode -100): 登录态已失效，请重新扫码登录后重试。",
    },
  ]
}

// 生成一张假二维码占位图（只用于预览扫码登录卡的版式，不参与生产逻辑）
const qrPlaceholder = path.join(outDir, "_qr-placeholder.png")
{
  const canvas = new Canvas(360, 360)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, 360, 360)
  ctx.fillStyle = "#111111"
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      if ((x * 7 + y * 13 + ((x * y) % 5)) % 3 === 0) ctx.fillRect(x * 15, y * 15, 15, 15)
    }
  }
  for (const [ox, oy] of [[0, 0], [270, 0], [0, 270]]) {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(ox, oy, 90, 90)
    ctx.fillStyle = "#111111"
    ctx.fillRect(ox, oy, 90, 90)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(ox + 15, oy + 15, 60, 60)
    ctx.fillStyle = "#111111"
    ctx.fillRect(ox + 30, oy + 30, 30, 30)
  }
  await canvas.toFile(qrPlaceholder)
}

// 生成两张假收款码（只用于预览赏赞卡版式）
const posterPaths = []
for (const [i, label] of ["微信赞赏码", "支付宝收款码"].entries()) {
  const canvas = new Canvas(420, 560)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = i ? "#1677ff" : "#07c160"
  ctx.fillRect(0, 0, 420, 560)
  ctx.fillStyle = "rgba(255,255,255,.92)"
  ctx.fillRect(30, 30, 360, 360)
  ctx.fillStyle = "#111"
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) if ((x * 5 + y * 11 + x * y) % 3 === 0) ctx.fillRect(45 + x * 16.5, 45 + y * 16.5, 16.5, 16.5)
  }
  ctx.fillStyle = "#ffffff"
  ctx.font = "600 30px MiSans"
  ctx.textAlign = "center"
  ctx.fillText(label, 210, 470)
  const file = path.join(outDir, `_poster-${i}.png`)
  await canvas.toFile(file)
  posterPaths.push(file)
}

// 生成假角色头像 / 武器图（仅预览用，验证图位与裁切；生产路径由真实 CDN 图覆盖）
const charIcons = []
for (const [i, [color, label]] of [["#5b7fbf", "神里绫华"], ["#5f9e7a", "枫原万叶"], ["#b98a5a", "珊瑚宫心海"], ["#8f7fc4", "申鹤"], ["#c96f6f", "花火"], ["#7f8fd8", "银狼"], ["#6fb8b0", "知更鸟"]].entries()) {
  const canvas = new Canvas(240, 260)
  const ctx = canvas.getContext("2d")
  const g = ctx.createLinearGradient(0, 0, 0, 260)
  g.addColorStop(0, color); g.addColorStop(1, "#f2f5f9")
  ctx.fillStyle = g; ctx.fillRect(0, 0, 240, 260)
  ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.font = "600 44px MiSans"
  ctx.textAlign = "center"; ctx.fillText(label, 120, 200)
  const file = path.join(outDir, `_char-${i}.png`)
  await canvas.toFile(file)
  charIcons.push(file)
}
const weaponIcons = []
for (const [i, color] of ["#c8a06c", "#8fb0d8", "#a9d8c2", "#d8b0c8"].entries()) {
  const canvas = new Canvas(120, 120)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(0, 0, 120, 120, 18); ctx.fill()
  ctx.fillStyle = "rgba(255,255,255,.94)"; ctx.font = "600 34px MiSans"; ctx.textAlign = "center"
  ctx.fillText(["剑", "刀", "枪", "书"][i], 60, 78)
  const file = path.join(outDir, `_weapon-${i}.png`)
  await canvas.toFile(file)
  weaponIcons.push(file)
}

const cases = [
  {
    name: "donate",
    data: {
      title: "赏赞荷花插件",
      message: "如果荷花插件对你有帮助，欢迎通过以下方式支持作者继续维护。金额随意，心意最重要。",
      methods: [
        { title: "微信赞赏", image: posterPaths[0], notice: "长按识别二维码，或保存后在微信中扫一扫。感谢支持！" },
        { title: "支付宝", image: posterPaths[1], notice: "打开支付宝扫一扫即可。所有赞赏都会用于插件维护与世界和平。" },
      ],
    },
  },
  {
    name: "genshin-team-damage",
    data: {
      title: "原神队伍伤害",
      subtitle: "UID 100234567 · profile 1",
      badge: "原神",
      message: "#队伍伤害详情 · 神里绫华 / 枫原万叶 / 珊瑚宫心海 / 申鹤",
      uid: "100234567",
      detail: true,
      summary: [
        { label: "总伤害", value: "1,248,600" },
        { label: "DPS", value: "213,540" },
        { label: "时间", value: "5.8s" },
        { label: "评级", value: "ACE" },
      ],
      team: [
        { name: "神里绫华", level: 90, cons: 6, weapon: "雾切之回光", weaponLevel: 90, weaponAffix: 1, icon: charIcons[0] },
        { name: "枫原万叶", level: 90, cons: 2, weapon: "苍古自由之誓", weaponLevel: 90, weaponAffix: 1, icon: charIcons[1] },
        { name: "珊瑚宫心海", level: 90, cons: 0, weapon: "不灭月华", weaponLevel: 90, weaponAffix: 1, icon: charIcons[2] },
        { name: "申鹤", level: 90, cons: 1, weapon: "息灾", weaponLevel: 90, weaponAffix: 1, icon: charIcons[3] },
      ],
      avatars: [
        { name: "神里绫华", rarity: 5, level: 90, cons: 6, elem: "冰", icon: charIcons[0], face: charIcons[0], keyProp: "冰元素伤害加成", keyValue: "61.6%",
          weapon: { name: "雾切之回光", rarity: 5, affix: 1, level: 90, icon: weaponIcons[0] },
          stats: { 暴击率: 38.2, 暴击伤害: 241.6, 攻击力: 2412, 元素充能效率: 112.4 },
          skills: [{ icon: "A", style: "", level: 10 }, { icon: "E", style: "", level: 10 }, { icon: "Q", style: "extra", level: 13 }],
          relicSet: { "冰风迷途的勇士": 2, "追忆之注连": 2 }, recharge: { name: "神里绫华", same: 9.4, diff: 3.2 } },
        { name: "枫原万叶", rarity: 5, level: 90, cons: 2, elem: "风", icon: charIcons[1], face: charIcons[1], keyProp: "元素精通", keyValue: "1,046",
          weapon: { name: "苍古自由之誓", rarity: 5, affix: 1, level: 90, icon: weaponIcons[1] },
          stats: { 暴击率: 22.5, 暴击伤害: 128.4, 攻击力: 1048, 元素充能效率: 168.9 },
          skills: [{ icon: "A", style: "", level: 9 }, { icon: "E", style: "", level: 10 }, { icon: "Q", style: "", level: 10 }],
          relicSet: { "翠绿之影": 4 }, recharge: { name: "枫原万叶", same: 4.1, diff: 8.6 } },
        { name: "珊瑚宫心海", rarity: 5, level: 90, cons: 0, elem: "水", icon: charIcons[2], face: charIcons[2], keyProp: "治疗加成", keyValue: "35.9%",
          weapon: { name: "不灭月华", rarity: 5, affix: 1, level: 90, icon: weaponIcons[2] },
          stats: { 暴击率: 5.0, 暴击伤害: 50.0, 攻击力: 1380, 元素充能效率: 145.2 },
          skills: [{ icon: "A", style: "", level: 8 }, { icon: "E", style: "", level: 9 }, { icon: "Q", style: "", level: 9 }],
          relicSet: { "海染砗磲": 4 }, recharge: { name: "珊瑚宫心海", same: 12.0, diff: 1.4 } },
        { name: "申鹤", rarity: 5, level: 90, cons: 1, elem: "冰", icon: charIcons[3], face: charIcons[3], keyProp: "攻击力", keyValue: "2,860",
          weapon: { name: "息灾", rarity: 5, affix: 1, level: 90, icon: weaponIcons[3] },
          stats: { 暴击率: 18.6, 暴击伤害: 106.2, 攻击力: 2860, 元素充能效率: 156.0 },
          skills: [{ icon: "A", style: "", level: 9 }, { icon: "E", style: "extra", level: 12 }, { icon: "Q", style: "", level: 9 }],
          relicSet: { "深廊终曲": 4 }, recharge: { name: "申鹤", same: 6.2, diff: 6.0 } },
      ],
      pie: [
        { char: "神里绫华", damage: 968000, color: "#7FB3E8" },
        { char: "申鹤", damage: 158400, color: "#A8D8E8" },
        { char: "枫原万叶", damage: 84300, color: "#9FD8B8" },
        { char: "珊瑚宫心海", damage: 37900, color: "#C3B2F0" },
      ],
      actions: ["E 神里流·冰华", "Q 万叶大招", "E 申鹤冰翎", "E 心海海月", "Q 神里流·霜灭", "重击 ×3"],
      damages: [
        { time: 0.0, action: "E", values: ["12,480", "6,240", "11,860"] },
        { time: 1.2, action: "Q", values: ["28,600", "14,300", "27,180"] },
        { time: 2.4, action: "E", values: ["18,240", "9,120", "17,330"] },
        { time: 3.6, action: "重击", values: ["46,800", "23,400", "44,460"] },
        { time: 4.8, action: "重击", values: ["46,800", "23,400", "44,460"] },
        { time: 5.8, action: "重击", values: ["46,800", "23,400", "44,460"] },
      ],
      buffs: [
        { time: 0.0, name: "翠绿之影 4 件套", detail: "扩散反应降低对应元素抗性 40%" },
        { time: 0.0, name: "申鹤 · 仰灵威仪", detail: "冰元素伤害提高 15%，普通攻击伤害提高 15%" },
        { time: 0.3, name: "心海 · 海月之誓", detail: "附近队伍中所有角色获得治疗加成" },
        { time: 1.2, name: "雾切之回光", detail: "元素伤害加成最高提升 40%" },
      ],
      source: "提瓦特小助手",
    },
  },
  {
    name: "starrail-team-damage",
    data: {
      title: "星铁队伍伤害",
      subtitle: "UID 100234567 · profile 1",
      badge: "SR",
      message: "*队伍伤害 · 花火 / 银狼 / 知更鸟 / 开拓者",
      uid: "100234567",
      detail: true,
      summary: [
        { label: "总伤害", value: "2,846,200" },
        { label: "DPS", value: "569,240" },
        { label: "轮次", value: "5" },
        { label: "目标", value: "3怪" },
      ],
      team: [
        { id: 1, name: "花火", elem: "量子", path: "同谐", level: 80, rank: 6, weapon: "游戏尘寰", weaponLevel: 80, weaponRank: 1, icon: charIcons[4], stats: { 暴击率: "5.0", 暴击伤害: "50.0", 攻击力: "1,240", 速度: "143", 击破: "0.0", 效果命中: "0.0" }, panelSource: "喵喵面板" },
        { id: 2, name: "银狼", elem: "量子", path: "虚无", level: 80, rank: 2, weapon: "以世界之名", weaponLevel: 80, weaponRank: 1, icon: charIcons[5], stats: { 暴击率: "58.4", 暴击伤害: "152.0", 攻击力: "2,180", 速度: "134", 击破: "0.0", 效果命中: "68.0" }, panelSource: "喵喵面板" },
        { id: 3, name: "知更鸟", elem: "物理", path: "同谐", level: 80, rank: 0, weapon: "但战斗还未结束", weaponLevel: 80, weaponRank: 1, icon: charIcons[6], stats: { 暴击率: "5.0", 暴击伤害: "50.0", 攻击力: "1,180", 速度: "121", 击破: "15.0", 效果命中: "0.0" }, panelSource: "喵喵面板" },
      ],
      pie: [
        { char: "银狼", damage: 1428000, color: "#8B7FE8" },
        { char: "花火", damage: 986400, color: "#E88FA8" },
        { char: "知更鸟", damage: 431800, color: "#7FD8D0" },
      ],
      actionTrack: [
        { order: 1, name: "花火", actionPoints: 143 },
        { order: 2, name: "知更鸟", actionPoints: 121 },
        { order: 3, name: "银狼", actionPoints: 134 },
        { order: 4, name: "开拓者", actionPoints: 110 },
      ],
      battleRecords: [
        { order: 1, title: "花火 · 战技", lines: [{ type: "skill", text: "使用战技使目标速度提高" }], actionPoint: 143 },
        { order: 2, title: "知更鸟 · 终结技", lines: [{ type: "skill", text: "赋予全体追加攻击" }], actionPoint: 121 },
        { order: 3, title: "银狼 · 普攻", lines: [{ type: "attack", text: "造成量子属性伤害" }], actionPoint: 134 },
        { order: 4, title: "银狼 · 终结技", lines: [{ type: "skill", text: "造成大量量子属性伤害" }], actionPoint: 134 },
      ],
      damageLogs: [
        { order: 1, text: "银狼 终结技：造成 862,400 点量子属性伤害" },
        { order: 2, text: "花火 追加攻击：造成 486,200 点量子属性伤害" },
        { order: 3, text: "知更鸟 追加攻击：造成 218,600 点物理属性伤害" },
      ],
      source: "星穹铁道工坊",
    },
  },
  {
    name: "qr-login",
    data: {
      title: "扫码登录",
      subtitle: "米游社 · profile 1",
      badge: "3 MIN",
      qrDataUrl: qrPlaceholder,
      notice: "请使用米游社 App 扫码完成登录，扫码后 cookie 会自动保存。",
    },
  },
  {
    name: "status",
    data: {
      title: "荷花插件",
      subtitle: "Lotus Plugin · 运行状态",
      badge: "OK",
      message: "所有服务模块运行正常，定时任务已加载 12 项，昨日签到成功率 92%。",
      items: [
        { label: "机器人账号", value: "LotusBot#1234" },
        { label: "已连接群", value: "38 个" },
        { label: "今日签到", value: "完成 92%" },
        { label: "待办提醒", value: "3 条" },
        { label: "缓存命中", value: "98.6%" },
        { label: "运行时间", value: "14 天" },
      ],
    },
  },
  {
    name: "profile-card",
    data: {
      title: "配置资料卡",
      subtitle: "LotusBot 主账号",
      badge: "PROFILE",
      summary: "这是一份用于演示蓝色玻璃主题的资料卡。",
      account: [
        { label: "登录状态", value: "已登录" },
        { label: "Cookie", value: "有效" },
        { label: "绑定游戏", value: "原神 / 星铁" },
      ],
      roles: [
        { label: "主角A", value: "Lv.60" },
        { label: "主角B", value: "Lv.58" },
        { label: "主角C", value: "Lv.55" },
      ],
      settings: [
        { label: "自动签到", value: "开启" },
        { label: "推送群", value: "群①" },
        { label: "静默模式", value: "关闭" },
      ],
    },
  },
  {
    name: "daily-note-summary",
    data: {
      title: "全部体力",
      subtitle: "旅行者 · 原神 / 星铁 / 绝区零",
      badge: "3/4",
      panels: dailyNotePanels(),
    },
  },
  {
    name: "checkin-result",
    data: {
      nickname: "昵称",
      account: "每日自动签到",
      description: "今日全部账号签到成功。",
      badge: "成功",
      avatar: "https://q1.qlogo.cn/g?b=qq&nk=1102305070&s=640",
      illustration: getRandomCharacter(),
      games: [
        { label: "原神", game: "成功", community: "成功", days: "12天" },
        { label: "崩坏3", game: "成功", community: "成功", days: "12天" },
        { label: "星穹铁道", game: "成功", community: "成功", days: "12天" },
        { label: "绝区零", game: "成功", community: "成功", days: "12天" },
        { label: "未定事件簿", game: "成功", community: "成功", days: "12天" },
        { label: "崩坏2", game: "成功", community: "成功", days: "12天" },
        { label: "大别野", game: "无", community: "成功", days: "-" },
        { label: "因缘精灵", game: "成功", community: "成功", days: "5天" },
      ],
    },
  },
]

for (const c of cases) {
  const out = path.join(outDir, `${c.name}.png`)
  try {
    await renderWithSkia(c.name, c.data, { path: out, renderScale: 2 })
    console.log(`OK  ${c.name} -> ${out}`)
  } catch (e) {
    console.error(`FAIL ${c.name}:`, e.message)
  }
}
