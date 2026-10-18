import path from "node:path"
import { existsSync } from "node:fs"
import { Canvas, FontLibrary, loadImage } from "skia-canvas"
import { resourcesPath } from "../path.js"
import { fstr } from "./theme.js"
import { fetchImageBytes } from "./image.js"
import { encodeGpuCanvas } from "./gpu-buffer.js"

// 队伍伤害（原神 / 星铁）—— 原生复刻上游 `genshin/resources/Genshin/html/dmg/damage.{html,css}`
// （提瓦特小助手 / FanSky_Qs 版式；用户给的参考图页脚为
//   `Original Function by FanSky_Qs | Modified by fleurdelys | Designed by Aozaki Arina`）。
//
// 信息序完全照上游：
//   ① 左上 TopLeftPanel：UID 胶囊 → 评级四宫格（伤害评级 / DPS / 输出轴长 / 输出总伤）→ 输出比例环形图
//   ② 右上 Avatars：2×2 角色卡（头像·命座·等级 | 武器·精炼·等级 | 遗物；暴击·暴伤·关键属性 /
//      充能环·同色球·异色球 / 天赋图标）
//   ③ Actions 操作手法（绿色指令 chip）  ④ Damages 伤害过程（detail 时）  ⑤ Buffs Buff 情况
//   ⑥ 页脚署名条
//
// 【配色为什么写死深色，不走主题真源】
// 这套版式与 miao 的 `common/bg/bg-{elem}.webp` 元素星云底 + 深色半透面板是配对的：
// 面板 `#332e3ed6`、角色卡 `rgba(46,53,62,.68)`、指令 chip `rgb(164,241,137)`、Buff 效果字
// `rgb(214,113,211)` —— 全是「深底 + 亮字」组合，套到浅色主题上会直接隐身。
// 所以它是一块「自带底色的品牌面板」，与 `daily-note.js`（体力）、`starrail-abyss.js`（星铁挑战）同类，
// 不读 DARK / LOTUS_THEME。底图与天赋底图已拷进 Lotus 自有 `resources/team-damage/`，运行时不读 miao。

const ROOT = path.join(resourcesPath, "team-damage")
const FONT_PATH = path.join(resourcesPath, "fonts/MiSans-VF.ttf")

// ---- 几何（按参考图实体测量 + 上游 CSS，逻辑宽度 960）----
const W = 960
const SIDE = 20            // 参考图左内边距（面板 20..940）
const LEFT_W = 325, LEFT_H = 543
const AV_X = 365, AV_W = 575            // 角色栏 365..940
const CARD_W = 280, CARD_H = 264, CARD_GAP = 15
const PANEL_W = 920, PANEL_X = (W - PANEL_W) / 2
const PANEL_R = 15, PANEL_GAP = 15
const UID_H = 35
const RANK_TOP = 65, RANK_CELL_H = 91, RANK_PAD = 6
const PIE_TOP = 279, PIE_H = 264
const TITLE_H = 50
const ROW_H = 48           // 表格行高（参考图实测 ≈48 逻辑 px）
const CHIP_H = 30, CHIP_GAP_X = 9, CHIP_GAP_Y = 8, FOOT_H = 64

// ---- 上游色值（逐条来自 damage.css / damage.html，非杜撰）----
const C = {
  uidBg: "rgba(34,24,189,.84)", uidText: "rgb(255,189,4)",
  rankBg: "rgba(37,50,0,.30)",
  pieBg: "rgba(48,54,66,.72)",
  cardBg: "rgba(46,53,62,.68)",
  panelBg: "rgba(51,46,62,.84)",      // #332e3ed6
  ambrLight: "rgb(233,229,220)",
  ambrDeep: "rgb(74,83,102)",
  chipBg: "rgb(164,241,137)", chipText: "rgb(74,83,102)",
  white: "#FFFFFF", soft: "rgba(255,255,255,.68)",
  buffEffect: "rgb(214,113,211)",
  line: "rgba(255,255,255,.20)",
  footBar: "rgba(14,58,88,.74)", footText: "#E8843C",
  ring: "#CCCCCC",
}
// 评级分档色（damage.html 内联 style 逐档）
const RANK_TIERS = [
  { keys: ["ACE", "SSS", "SS"], main: "rgba(255,71,71,1)", soft: "rgba(255,198,198,1)" },
  { keys: ["S"], main: "rgba(190,124,255,1)", soft: "rgba(233,198,255,1)" },
  { keys: ["A"], main: "rgba(0,200,155,1)", soft: "rgba(178,255,231,1)" },
  { keys: ["B"], main: "rgba(255,156,70,1)", soft: "rgba(255,218,182,1)" },
]
const DEFAULT_TIER = { main: "rgba(41,141,255,1)", soft: "rgba(173,213,255,1)" }
const rankTier = v => RANK_TIERS.find(t => t.keys.includes(String(v || "").trim().toUpperCase())) || DEFAULT_TIER
// 命座色（--charCons1..6）
const CONS_COLORS = ["", "#5cbac2", "#339d61", "#3e95b9", "#3955b7", "#531ba9", "#ff5722"]
const consColor = n => CONS_COLORS[Math.min(6, Math.max(0, Number(n) || 0))] || C.ambrDeep
// 武器精炼色（--weaponAffix2..5；a1 走默认 ambrDeep，与上游 CSS 一致）
const AFFIX_COLORS = { 2: "#51B72F", 3: "#396CDE", 4: "#C539DE", 5: "#DEAF39" }
const affixColor = n => AFFIX_COLORS[Number(n)] || C.ambrDeep
// 稀有度底色（--itemStar1..5）
const STAR_COLORS = { 1: "#818486", 2: "#5A977A", 3: "#5987AD", 4: "#9470BB", 5: "#C87C24" }
const starColor = n => STAR_COLORS[Number(n)] || "rgba(70,80,95,.85)"
// 元素 → 底图 / 天赋底图文件名
const ELEM_FILE = { 火: "pyro", 水: "hydro", 冰: "cryo", 雷: "electro", 风: "anemo", 岩: "geo", 草: "dendro" }
const PERCENT_STATS = new Set(["暴击率", "暴击伤害", "元素充能效率", "充能效率", "击破", "击破特攻", "效果命中", "效果抵抗", "治疗加成"])
const DEFAULT_CREDIT = "Original Function by FanSky_Qs | Modified by fleurdelys | Designed by Aozaki Arina"

const CACHE = new Map()
let fontsLoaded = false

const asset = name => path.join(ROOT, name)
const has = v => v !== undefined && v !== null && v !== ""
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

async function image(src) {
  if (!src) return null
  if (!CACHE.has(src)) {
    CACHE.set(src, (async () => loadImage(/^https?:\/\//i.test(src) ? await fetchImageBytes(src) : /^file:\/\//i.test(src) ? new URL(src) : src))().catch(error => {
      CACHE.delete(src)
      globalThis.logger?.warn?.(`[荷花队伍伤害] 图片加载失败：${error.message}`)
      return null
    }))
    if (CACHE.size > 128) CACHE.delete(CACHE.keys().next().value)
  }
  return CACHE.get(src)
}

export function isTeamDamagePayload(data = {}) {
  return Array.isArray(data.avatars) || Array.isArray(data.summary) || Array.isArray(data.pie)
}

function compactDamage(n) {
  const v = Number(n || 0)
  if (!Number.isFinite(v)) return "—"
  const a = Math.abs(v)
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)} 亿`
  if (a >= 1e4) return `${(v / 1e4).toFixed(1)} 万`
  return String(Math.round(v))
}
const wan = n => { const v = Number(n) || 0; return `${(v / 1e4).toFixed(1)}W` }
// 上游参考图的数值写法是 `442.8W`；Lotus 内部 formatDamage 给的是 `442.8万`，统一成 W 以对齐参考图
const wStyle = v => String(v ?? "—").replace(/万$/, "W")
const totalLabel = v => (Number(v) > 0 ? wan(v) : compactDamage(v))
const statText = (k, v) => (PERCENT_STATS.has(k) && /^[-+]?\d+(?:\.\d+)?$/.test(String(v)) ? `${v}%` : String(v ?? "—"))

// 队伍成员：avatars（信息全）为主、team 兜底，顺序按玩家输入序
function teamMembers(data) {
  const avatars = data.avatars || []
  if (!avatars.length) return (data.team || []).map(m => ({ ...m }))
  const order = new Map()
  ;(data.team || []).forEach((m, i) => { if (!order.has(m.name)) order.set(m.name, i) })
  return avatars.slice()
    .sort((x, y) => (order.get(x.name) ?? 1e9) - (order.get(y.name) ?? 1e9))
    .slice(0, 4)
}

// 主元素 → 底图键：取伤害占比最高的角色的元素（与参考图一致：丝柯克 89% 冰 → cryo 星云底）
function backgroundKey(data, isSR) {
  if (isSR) return "sr"
  const top = (data.pie || [])[0]?.char
  const hit = (data.avatars || []).find(a => a.name === top) || (data.avatars || [])[0]
  return ELEM_FILE[hit?.elem] || "cryo"
}

export async function renderTeamDamage(data = {}, options = {}) {
  if (!fontsLoaded) {
    try { if (existsSync(FONT_PATH)) FontLibrary.use("MiSans", [FONT_PATH]) } catch { }
    fontsLoaded = true
  }
  const isSR = Boolean(data.sr) || data.badge === "SR"
  const scaleRaw = Number(options.renderScale ?? data.renderScale ?? process.env.LOTUS_RENDER_SCALE ?? 4)
  const scale = Number.isFinite(scaleRaw) ? Math.min(4, Math.max(1, scaleRaw)) : 4

  const members = teamMembers(data)
  const bgFile = `bg-${backgroundKey(data, isSR)}.webp`
  const elemOf = m => ELEM_FILE[m?.elem] || (isSR ? "sr" : "cryo")

  // 预取图片
  const refs = new Set([asset(bgFile)])
  for (const m of members) {
    if (m.icon || m.face) refs.add(m.icon || m.face)
    const wIcon = m.weapon && typeof m.weapon === "object" ? (m.weapon.icon || m.weapon.img || "") : ""
    if (wIcon) refs.add(wIcon)
    for (const s of (m.skills || []).slice(0, 3)) if (s?.icon && /^(https?:|file:|\/|[A-Za-z]:)/.test(String(s.icon))) refs.add(s.icon)
    refs.add(asset(`talent-${elemOf(m)}.webp`))
  }
  const images = new Map()
  await Promise.all([...refs].map(async src => images.set(src, await image(src))))

  // 先量 chip 行（需要 ctx 量文字宽度）：用一张一次性的量尺画布
  const ruler = new Canvas(8, 8).getContext("2d")
  const chipRows = wrapChips(ruler, data.actions || [], PANEL_W - 40)

  // ---- 高度：左栏 543 → 操作手法 → 伤害过程 → Buff → 页脚 ----
  let y = 0
  y += LEFT_H
  const blocks = []
  if (chipRows.length) {
    const h = TITLE_H + chipRows.length * (CHIP_H + CHIP_GAP_Y) + 6
    blocks.push({ kind: "actions", h }); y += PANEL_GAP + h
  }
  const damages = (data.damages || []).slice(0, 40)
  if (damages.length && data.detail !== false) {
    const h = TITLE_H + ROW_H * (damages.length + 1) + 8
    blocks.push({ kind: "damages", h }); y += PANEL_GAP + h
  }
  const buffs = (data.buffs || []).slice(0, 60)
  if (buffs.length) {
    const h = TITLE_H + buffs.length * ROW_H + 8
    blocks.push({ kind: "buffs", h }); y += PANEL_GAP + h
  }
  y += PANEL_GAP + FOOT_H
  const height = Math.ceil(y)

  // 像素预算：超高图按整数回退
  let effective = scale
  const PIXEL_BUDGET = 4.2e7
  while (effective > 1 && W * effective * height * effective > PIXEL_BUDGET) effective -= 1
  const canvas = new Canvas(Math.round(W * effective), Math.round(height * effective))
  const ctx = canvas.getContext("2d")
  ctx.scale(effective, effective)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"

  const family = "MiSans, sans-serif"
  const setFont = (size, weight = 500) => { ctx.font = fstr(size, family, weight) }
  function draw(value, x, y2, size, color, o = {}) {
    const label = String(value ?? "")
    const weight = o.weight ?? 500
    setFont(size, weight)
    while (ctx.measureText(label).width > (o.width ?? W) && size > (o.minSize ?? 10)) {
      size -= .5; setFont(size, weight)
    }
    ctx.save()
    ctx.textBaseline = o.baseline || "top"
    ctx.textAlign = o.align || "left"
    ctx.fillStyle = color
    if (o.shadow) { ctx.shadowColor = o.shadowColor || "rgba(0,0,0,.7)"; ctx.shadowBlur = o.shadowBlur ?? 4; ctx.shadowOffsetY = o.shadowOffsetY ?? 1 }
    ctx.fillText(label, x, y2)
    ctx.restore()
    return size
  }
  function widthOf(value, size, weight = 500) { setFont(size, weight); return ctx.measureText(String(value ?? "")).width }
  function rect(x, y2, w, h, fill, r = 0) { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y2, w, h, r); ctx.fill() }
  function imageFit(src, x, y2, w, h, mode = "contain", radius = 0) {
    const img = images.get(src)
    if (!img) return false
    ctx.save()
    if (radius) { ctx.beginPath(); ctx.roundRect(x, y2, w, h, radius); ctx.clip() }
    const ratio = (mode === "cover" ? Math.max : Math.min)(w / img.width, h / img.height)
    const dw = img.width * ratio, dh = img.height * ratio
    ctx.drawImage(img, x + (w - dw) / 2, y2 + (h - dh) / 2, dw, dh)
    ctx.restore()
    return true
  }

  // ---------- 背景：元素星云（object-fit:cover / object-position:center 0）----------
  const bgImg = images.get(asset(bgFile))
  if (bgImg) {
    const ratio = Math.max(W / bgImg.width, height / bgImg.height)
    const dw = bgImg.width * ratio, dh = bgImg.height * ratio
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, height); ctx.clip()
    ctx.drawImage(bgImg, (W - dw) / 2, 0, dw, dh); ctx.restore()
  } else {
    const g = ctx.createLinearGradient(0, 0, W * .4, height)
    g.addColorStop(0, "#0b3352"); g.addColorStop(1, "#08243c")
    rect(0, 0, W, height, g)
  }

  // ---------- ① 左上：UID + 评级四宫格 + 环形图 ----------
  const uidStr = `${data.uid ? `UID: ${data.uid}` : "UID: 未绑定"}`
  rect(SIDE, 0, LEFT_W, UID_H, C.uidBg, 15)
  draw(uidStr, SIDE + LEFT_W / 2, UID_H / 2, 24, C.uidText, { weight: 700, align: "center", width: LEFT_W, baseline: "middle", minSize: 14, shadow: true, shadowColor: "rgba(0,0,0,.7)", shadowBlur: 4 })

  const summary = (data.summary || []).slice(0, 4)
  const rankRaw = has(data.rank) ? data.rank : ""
  const dpsRaw = has(data.dps) ? data.dps : ""
  const tmRaw = data.tm
  const totalRaw = has(data.total) ? data.total : ""
  const quad = summary.length
    ? [
        { v: summary[3]?.value, l: "伤害评级" },
        { v: summary[1]?.value, l: "DPS" },
        { v: summary[2]?.value, l: "输出轴长" },
        { v: summary[0]?.value, l: "输出总伤" },
      ]
    : [
        { v: rankRaw || "—", l: "伤害评级" },
        { v: dpsRaw || "—", l: "DPS" },
        { v: tmRaw ? `${tmRaw}s` : "—", l: "输出轴长" },
        { v: totalRaw || "—", l: "输出总伤" },
      ]
  const tier = rankTier(quad[0].v)
  const cellW = (LEFT_W - RANK_PAD * 2) / 2
  rect(SIDE, RANK_TOP, LEFT_W, RANK_CELL_H * 2 + RANK_PAD * 2, C.rankBg, 15)
  quad.forEach((cell, i) => {
    const cx = SIDE + RANK_PAD + (i % 2) * cellW
    const cy = RANK_TOP + RANK_PAD + Math.floor(i / 2) * RANK_CELL_H
    const valueColor = i <= 1 ? tier.main : tier.soft
    const labelColor = i <= 1 ? tier.main : tier.soft
    draw(wStyle(cell.v ?? "—"), cx + cellW / 2, cy + RANK_CELL_H / 2 - 17, 40, valueColor, {
      weight: 700, align: "center", width: cellW, baseline: "middle",
      minSize: 18, shadow: true, shadowColor: "rgba(0,0,0,.55)", shadowBlur: 10, shadowOffsetY: 6,
    })
    draw(cell.l, cx + cellW / 2, cy + RANK_CELL_H - 20, 27, labelColor, { weight: 700, align: "center", width: cellW, baseline: "middle", minSize: 13 })
  })

  // 输出比例环形图
  const pie = (data.pie || []).filter(item => Number(item.damage) > 0)
  const total = Number(data.total) || pie.reduce((s, i) => s + num(i.damage), 0)
  rect(SIDE, PIE_TOP, LEFT_W, PIE_H, C.pieBg, 20)
  draw("输出比例", SIDE + 12, PIE_TOP + PIE_H - 30, 20, C.ambrLight, { weight: 700 })
  if (!pie.length) {
    draw("暂无伤害占比数据", SIDE + LEFT_W / 2, PIE_TOP + PIE_H / 2 - 10, 14, C.soft, { align: "center", width: LEFT_W })
  } else {
    const cxp = SIDE + LEFT_W / 2, cyp = PIE_TOP + PIE_H / 2 - 2
    const rO = 96, rI = 72
    drawDonut(ctx, cxp, cyp, rO, rI, pie, total)
    draw("总计", cxp, cyp - 26, 16, C.white, { weight: 700, align: "center", baseline: "middle", shadow: true, shadowBlur: 4 })
    draw(totalLabel(total), cxp, cyp + 6, 24, C.white, { weight: 700, align: "center", baseline: "middle", minSize: 14, shadow: true, shadowBlur: 4 })
    drawDonutLabels(ctx, draw, cxp, cyp, rO, pie, total)
  }

  // ---------- ② 右上：2×2 角色卡 ----------
  members.forEach((m, i) => {
    const cx = AV_X + (i % 2) * (CARD_W + CARD_GAP)
    const cy = Math.floor(i / 2) * (CARD_H + CARD_GAP)
    drawMemberCard(ctx, m, cx, cy, isSR, { draw, imageFit })
  })

  // ---------- ③④⑤ 面板 ----------
  let py = LEFT_H
  for (const block of blocks) {
    py += PANEL_GAP
    if (block.kind === "actions") {
      drawPanel(ctx, PANEL_X, py, PANEL_W, block.h, C.panelBg, PANEL_R)
      draw("操作手法", PANEL_X + 20, py + TITLE_H / 2, 25, C.white, { weight: 700, baseline: "middle" })
      const tw = widthOf("操作手法", 25, 700)
      draw("默认手法可能并非最优，如需自定义操作手法请使用微信小程序", PANEL_X + 20 + tw + 20, py + TITLE_H / 2, 18, C.soft, { baseline: "middle", width: PANEL_W - 60 - tw, minSize: 12 })
      let cy = py + TITLE_H
      for (const row of chipRows) {
        let cxx = PANEL_X + 20
        for (const chip of row) { drawChip(ctx, draw, cxx, cy, chip.w, chip.text); cxx += chip.w + CHIP_GAP_X }
        cy += CHIP_H + CHIP_GAP_Y
      }
    } else if (block.kind === "damages") {
      drawPanel(ctx, PANEL_X, py, PANEL_W, block.h, C.panelBg, PANEL_R)
      draw("伤害过程", PANEL_X + 20, py + TITLE_H / 2, 25, C.white, { weight: 700, baseline: "middle" })
      const tw = widthOf("伤害过程", 25, 700)
      draw("伤害以 90 级怪物为基准，最终输出总伤与 DPS 为 1.25 倍期望伤害（实战对群）", PANEL_X + 20 + tw + 20, py + TITLE_H / 2, 18, C.soft, { baseline: "middle", width: PANEL_W - 60 - tw, minSize: 12 })
      const cols = [0.08, 0.28, 0.213, 0.213, 0.214]
      const heads = ["时间", "动作", "暴击伤害", "未暴击伤害", "期望伤害"]
      let ry = py + TITLE_H
      ry = drawRow(ctx, draw, PANEL_X, ry, PANEL_W, heads, C.white, 21, false, null, cols)
      for (const r of damages) {
        ry = drawRow(ctx, draw, PANEL_X, ry, PANEL_W,
          [`${r.time ?? ""}s`, r.action || "—", r.values?.[0] ?? "—", r.values?.[1] ?? "—", r.values?.[2] ?? "—"],
          C.white, 23, true, [C.white, C.white, C.buffEffect, C.buffEffect, C.buffEffect], cols)
      }
    } else {
      drawPanel(ctx, PANEL_X, py, PANEL_W, block.h, C.panelBg, PANEL_R)
      draw("Buff 情况", PANEL_X + 20, py + TITLE_H / 2, 25, C.white, { weight: 700, baseline: "middle" })
      const tw = widthOf("Buff 情况", 25, 700)
      draw("部分 Buff 描述可能异常但通常影响较小，若伤害偏差超过 10% 可认为计算错误", PANEL_X + 20 + tw + 20, py + TITLE_H / 2, 18, C.soft, { baseline: "middle", width: PANEL_W - 60 - tw, minSize: 12 })
      let ry = py + TITLE_H
      for (const r of buffs) {
        ry = drawRow(ctx, draw, PANEL_X, ry, PANEL_W,
          [`${r.time ?? ""}s`, r.name || "—", r.detail || "—"],
          C.white, 23, true, [C.white, C.white, C.buffEffect], [0.08, 0.28, 0.64])
      }    }
    py += block.h
  }

  // ---------- ⑥ 页脚署名条 ----------
  py += PANEL_GAP
  rect(PANEL_X, py, PANEL_W, FOOT_H - 12, C.footBar, 18)
  draw(data.credit || DEFAULT_CREDIT, PANEL_X + PANEL_W / 2, py + (FOOT_H - 12) / 2, 26, C.footText, {
    weight: 700, align: "center", width: PANEL_W, baseline: "middle", minSize: 14,
    shadow: true, shadowColor: "rgba(0,0,0,.5)", shadowBlur: 4,
  })

  const { buffer, tiles, format } = await encodeGpuCanvas(canvas, options)
  options.onRender?.({ gpu: canvas.gpu, ...canvas.engine, width: canvas.width, height: canvas.height, tiles, format, missingImages: [...images].filter(([, img]) => !img).map(([src]) => src) })
  return buffer
}

// ---------------- 子绘制 ----------------

function drawPanel(ctx, x, y, w, h, fill, r) {
  ctx.save()
  ctx.shadowColor = "rgba(0,0,0,.40)"; ctx.shadowBlur = 15; ctx.shadowOffsetY = 15
  ctx.fillStyle = fill
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill()
  ctx.restore()
}
function drawChip(ctx, draw, x, y, w, text) {
  rect(ctx, x, y, w, CHIP_H, C.chipBg, 5)
  draw(text, x + w / 2, y + CHIP_H / 2, 20, C.chipText, { weight: 700, align: "center", width: w, baseline: "middle", minSize: 12 })
}
function rect(ctx, x, y, w, h, fill, r = 0) { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill() }

function wrapChips(ctx, items, maxW) {
  const rows = []
  let row = [], rowW = 0
  for (const raw of items) {
    const text = String(raw ?? "").trim()
    if (!text) continue
    ctx.font = fstr(20, "MiSans, sans-serif", 700)
    const w = Math.max(30, Math.ceil(ctx.measureText(text).width) + 12)
    if (row.length && rowW + CHIP_GAP_X + w > maxW) { rows.push(row); row = []; rowW = 0 }
    if (row.length) rowW += CHIP_GAP_X
    row.push({ text, w }); rowW += w
  }
  if (row.length) rows.push(row)
  return rows
}

// 表格行：cols 为宽度（比例 0..1 或像素），values 为各列文本；锚点语义交给 draw()
function drawRow(ctx, draw, x, y, w, values, color, size, divider, colors, cols) {
  const h = ROW_H
  const useFrac = Array.isArray(cols) && cols.length && cols.every(v => v > 0 && v <= 1)
  const widths = Array.isArray(cols) && cols.length === values.length
    ? cols.map(v => (useFrac ? w * v : v))
    : values.map(() => w / values.length)
  let cx = x
  for (let i = 0; i < values.length; i++) {
    const cw = widths[i]
    const c = (colors && colors[i]) || color
    const align = i <= 1 ? "right" : "left"
    const tx = align === "right" ? cx + cw - 12 : cx + 12
    draw(values[i], tx, y + h / 2, size, c, { baseline: "middle", width: cw - 24, align, minSize: 12 })
    if (divider && i < values.length - 1) {
      ctx.fillStyle = C.line
      ctx.fillRect(cx + cw - 1, y + 6, 2, h - 12)
    }
    cx += cw
  }
  if (divider) { ctx.fillStyle = C.line; ctx.fillRect(x, y + h - 2, w, 2) }
  return y + h
}

function drawDonut(ctx, cx, cy, rO, rI, pie, total) {
  let a = -Math.PI / 2
  for (const item of pie) {
    const sweep = Math.PI * 2 * (total ? num(item.damage) / total : 0)
    if (!(sweep > 0)) continue
    const gap = Math.min(.012, sweep * .06)
    ctx.beginPath()
    ctx.arc(cx, cy, rO, a + gap, a + sweep - gap)
    ctx.arc(cx, cy, rI, a + sweep - gap, a + gap, true)
    ctx.closePath()
    ctx.fillStyle = item.color || "#24a9d8"
    ctx.fill()
    a += sweep
  }
}

// 外置标签 + 引线（上游 g2plot label type:'outer' / labelLine：`名: N%\n(xxW)`）
function drawDonutLabels(ctx, draw, cx, cy, rO, pie, total) {
  const sorted = pie.map(item => ({ ...item, ratio: total ? num(item.damage) / total : 0 })).sort((a, b) => b.ratio - a.ratio).slice(0, 6)
  let acc = 0
  const lefts = [], rights = []
  for (const item of sorted) {
    const angle = -Math.PI / 2 + acc * Math.PI * 2 + item.ratio * Math.PI
    acc += item.ratio
    const outX = cx + Math.cos(angle) * (rO + 12)
    const outY = cy + Math.sin(angle) * (rO + 12)
    const row = { item, outX, outY }
    if (Math.cos(angle) < 0) lefts.push(row); else rights.push(row)
  }
  const place = (group, dir) => {
    group.sort((a, b) => a.outY - b.outY)
    const step = 46
    let ty = cy - ((group.length - 1) * step) / 2
    for (const g of group) {
      // 上游 g2plot offset:-50 → 标签向内收，压在环上；这里同样内收，保证不越出面板
      const endX = cx + dir * (rO - 34)
      const endY = Math.max(cy - rO + 14, Math.min(ty, cy + rO - 10))
      ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.moveTo(g.outX, g.outY); ctx.lineTo(endX, endY); ctx.stroke()
      const tx = dir < 0 ? endX - 6 : endX + 6
      const align = dir < 0 ? "right" : "left"
      const opt = { align, baseline: "middle", width: 118, minSize: 11, shadow: true, shadowColor: "rgba(0,0,0,.85)", shadowBlur: 3 }
      draw(`${g.item.char}: ${(g.item.ratio * 100).toFixed(0)}%`, tx, endY - 9, 15, C.white, opt)
      draw(`(${wan(g.item.damage)})`, tx, endY + 10, 15, C.white, opt)
      ty += step
    }
  }
  place(lefts, -1); place(rights, 1)
}

// 单张角色卡（上游 .Avatars > .avatar，280×264）
function drawMemberCard(ctx, m, cx, cy, isSR, api) {
  const { draw, imageFit } = api
  rect(ctx, cx, cy, CARD_W, CARD_H, C.cardBg, 15)
  const pad = 7
  const icon = m.icon || m.face || ""
  const rarity = starColor(m.rarity)
  // 头像 62×62（左上，圆角 15）
  ctx.save()
  ctx.beginPath(); ctx.roundRect(cx, cy, 62, 62, 15); ctx.clip()
  rect(ctx, cx, cy, 62, 62, rarity)
  imageFit(icon, cx, cy, 62, 62, "cover")
  ctx.restore()
  // 命座 / 等级
  const cons = Number((isSR ? m.rank : m.cons) ?? 0)
  const lvl = m.level ?? "—"
  cell(cx + 62 + 2, cy, 42, 30, consColor(cons), `${cons}${isSR ? "魂" : "命"}`)
  cell(cx + 62 + 2, cy + 31, 42, 30, C.ambrDeep, `Lv.${lvl}`)
  // 武器 62×62
  const wIcon = m.weapon && typeof m.weapon === "object" ? (m.weapon.icon || m.weapon.img || "") : ""
  const wObj = m.weapon && typeof m.weapon === "object" ? m.weapon : {}
  const affix = Number(wObj.affix ?? wObj.rankLevel ?? (isSR ? m.weaponRank : m.weaponAffix)) || 0
  const wLevel = wObj.level ?? m.weaponLevel ?? "—"
  ctx.save()
  ctx.beginPath(); ctx.roundRect(cx + 106, cy, 62, 62, 8); ctx.clip()
  rect(ctx, cx + 106, cy, 62, 62, starColor(wObj.rarity || wObj.star))
  imageFit(wIcon, cx + 106, cy, 62, 62, "cover")
  ctx.restore()
  cell(cx + 170, cy, 42, 30, affixColor(affix), `${isSR ? "叠" : "精"}${affix || "—"}`)
  cell(cx + 170, cy + 31, 42, 30, C.ambrDeep, `Lv.${wLevel}`)
  // 遗物 62×62（右上，圆角 15）
  const relic = m.relicSet && typeof m.relicSet === "object" ? Object.entries(m.relicSet).filter(([, c]) => Number(c) >= 1) : []
  const main = relic.sort((a, b) => Number(b[1]) - Number(a[1]))[0]
  ctx.save()
  ctx.beginPath(); ctx.roundRect(cx + CARD_W - 62, cy, 62, 62, 15); ctx.clip()
  rect(ctx, cx + CARD_W - 62, cy, 62, 62, main && Number(main[1]) >= 4 ? "rgba(148,112,187,.75)" : "rgba(120,128,140,.55)")
  ctx.restore()
  if (main) {
    const cnt = Math.min(4, Number(main[1]))
    draw(String(cnt), cx + CARD_W - 20, cy + 46, 16, "#00FFFF", { weight: 700, align: "center", baseline: "middle" })
  } else {
    draw("—", cx + CARD_W - 31, cy + 31, 16, C.soft, { align: "center", baseline: "middle" })
  }

  // 属性区（260 宽，3 列）
  const gx = cx + 10, gw = CARD_W - 20, cellW = gw / 3, cH = 55
  const stats = m.stats || {}
  const cells1 = [
    ["暴击", has(stats["暴击率"]) ? `${stats["暴击率"]}%` : "—"],
    ["暴伤", has(stats["暴击伤害"]) ? `${stats["暴击伤害"]}%` : "—"],
    [m.keyProp || "攻击", m.keyValue ?? "—"],
  ]
  const r1 = cy + 66
  cells1.forEach(([label, value], i) => statBox(gx + i * cellW, r1, cellW, cH, value, label))

  const r2 = r1 + cH
  const rec = m.recharge || {}
  const pctTxt = has(rec.pct) ? String(rec.pct) : (has(stats["元素充能效率"]) ? `${stats["元素充能效率"]}%` : "—")
  drawResidue(gx + cellW / 2, r2 + cH / 2, pctTxt, m.color)
  statBox(gx + cellW, r2, cellW, cH, has(rec.same) ? rec.same : "—", "同色球")
  statBox(gx + cellW * 2, r2, cellW, cH, has(rec.diff) ? rec.diff : "—", "异色球")

  // 天赋三图标（上游 .talent-icon：底 = common/bg/talent-{elem}.webp 元素环 + 技能图标 + 等级角标）
  const skills = (m.skills || []).slice(0, 3)
  const ty = r2 + cH + 4
  const tIcon = 55, tGap = 6
  const tBg = asset(`talent-${ELEM_FILE[m?.elem] || (isSR ? "sr" : "cryo")}.webp`)
  const startX = cx + (CARD_W - (skills.length * tIcon + Math.max(0, skills.length - 1) * tGap)) / 2
  skills.forEach((s, i) => {
    const sx = startX + i * (tIcon + tGap)
    imageFit(tBg, sx, ty + 4, tIcon, tIcon, "contain")
    const sIcon = s?.icon && /^(https?:|file:|\/|[A-Za-z]:)/.test(String(s.icon)) ? s.icon : ""
    if (sIcon) imageFit(sIcon, sx + tIcon * .22, ty + 4 + tIcon * .22, tIcon * .56, tIcon * .56, "contain")
    if (s?.level) {
      const extra = s.style === "extra"
      rect(ctx, sx + 16, ty + 4 + tIcon - 14, 23, 21, extra ? "#45deff" : "#fff", 5)
      draw(String(s.level), sx + 16 + 23 / 2, ty + 4 + tIcon - 14 + 11, 16, "#000", { weight: 700, align: "center", baseline: "middle", width: 23 })
    }
  })

  function cell(x, y, w, h, fill, text) {
    rect(ctx, x, y, w, h, fill)
    draw(text, x + w / 2, y + h / 2, 16, C.ambrLight, { weight: 700, align: "center", width: w, baseline: "middle", minSize: 10 })
  }
  function statBox(x, y, w, h, value, label) {
    draw(value, x + w / 2, y + h / 2 - 9, 23, C.white, { weight: 700, align: "center", width: w, baseline: "middle", minSize: 12 })
    draw(label, x + w / 2, y + h / 2 + 13, 15, C.ambrLight, { align: "center", width: w, baseline: "middle", minSize: 10 })
  }
  function drawResidue(cxr, cyr, pctText, color) {
    const r = 17
    ctx.save()
    ctx.lineWidth = 2.5; ctx.strokeStyle = C.ring
    ctx.beginPath(); ctx.arc(cxr, cyr, r, 0, Math.PI * 2); ctx.stroke()
    const pct = parseFloat(String(pctText).replace("%", ""))
    if (Number.isFinite(pct)) {
      const frac = Math.max(0, Math.min(1, (50 + pct / 2) / 100))
      const circ = 2 * Math.PI * r
      ctx.strokeStyle = color || "#7FE3E8"
      ctx.beginPath(); ctx.arc(cxr, cyr, r, -Math.PI / 2, -Math.PI / 2 + circ * frac / r); ctx.stroke()
    }
    ctx.restore()
    draw(String(pctText), cxr, cyr, 12, color || "#7FE3E8", { weight: 700, align: "center", baseline: "middle", width: r * 2, minSize: 8 })
  }
}
