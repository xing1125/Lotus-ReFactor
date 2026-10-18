import path from "node:path"
import { existsSync } from "node:fs"
import { Canvas, FontLibrary, loadImage } from "skia-canvas"
import { resourcesPath } from "../path.js"
import { getRandomCharacter } from "../characterArt.js"
import { fetchImageBytes } from "./image.js"
import { encodeGpuCanvas } from "./gpu-buffer.js"

// 体力 / 开拓力 / 电量面板 —— 原生复刻 ji-plugin（星铁/原神/绝区零命令归属插件）的
// resources/{genshin,StarRail,ZZZero}/html/dailyNote 三套模板：
//   头部（游戏 logo + 米游社 logo + UID + 日期 + 签到福利状态）
//   → 左「主资源玻璃块」（大图标 + 资源名 + 45px 主数值 + 内嵌恢复时间卡）
//   → 右「清单玻璃块」（3 行 图标/名称/数值 + 纹理分隔线 + 底部派遣胶囊）
//   → 底色板（.bg-art）：角色立绘铺在深蓝底之上、所有玻璃块之下//
// 【配色为什么是写死的深蓝，而不是走主题真源】
// 该版式与它依赖的上游图标资源（星铁.png / 米游社.png / 委托执行.png …）是「深底 + 白色字形」
// 配对的：图标本身是白色或半透明，放到浅色主题上会直接隐身。所以这个面板是一块
// 「自带底色的品牌面板」：底 = #142844 + 青/蓝径向光晕 + 160° 藏青渐变，玻璃 = 白玻璃，
// 状态色沿用与签到卡一致的上游规范（青 #67E8F9 / 绿 #34D399 / 红 #F87171）。
// 与 starrail-abyss.js 的「语义色不随主题走」同理（稀有度卡面、命徽标）。
const ROOT = path.join(resourcesPath, "daily-note")

// ---- 上游色值（对齐 ji-plugin dailyNote 实际渲染效果，参考用户提供的 jj 截图取色）----
// 背景 = 中蓝 → 藏青对角渐变（顶部亮蓝 #2F619B → 底部深藏青 #1A3453）+ 青色光晕；
// 玻璃块 = 蓝色调半透明（不是灰白玻璃），描边白、顶部高光白。
const NAVY = {
  angle: 160,
  stops: [["#1A3453", 0], ["#26507E", .5], ["#2F619B", 1]],
  base: "#16304E",
  glows: [
    { c: "#00E5FF", x: .18, y: .14, r: .50, a: .24 },
    { c: "#38BDF8", x: .88, y: .90, r: .54, a: .20 },
  ],
}
const C = {
  text: "#F8FAFC",       // .container / .item color
  sub: "#CBD5E1",        // .header p / .status-title / .status-reserve
  cyan: "#67E8F9",       // .date / .status-date / .time / .sign-status
  green: "#34D399",      // .status-whole
  numFull: "#34D399",    // strong（已回满）
  numPart: "#7DD3FC",    // strong（恢复中）
  warn: "#FCA5A5",       // .task-undone
  red: "#F87171",        // 每日实训未满
  line: "#D3BC8E",       // line.png / star.png 的奶油金
}
const GLASS = { fill: "rgba(96,156,230,.28)", line: "rgba(255,255,255,.32)", shadow: "rgba(0,0,0,.32)", sheen: "rgba(255,255,255,.35)" }
const GLASS_IN = { fill: "rgba(64,126,200,.26)", line: "rgba(255,255,255,.26)", shadow: "rgba(0,0,0,.35)", sheen: null }

const W = 800, PANEL_H = 376, PANEL_GAP = 20
const LOGO_SIZE = { gs: 90, sr: 90, zzz: 72 }
const LABELS = { gs: "原神", sr: "星穹铁道", zzz: "绝区零" }

const CACHE = new Map()
let fontsLoaded = false

const asset = name => path.join(ROOT, name)
const has = src => src !== undefined && src !== null && src !== ""

// ---- 底色板（上游 .bg-art）----
// CSS 原文（三游戏 dailyNote.css 一致）：
//   .bg-art { position:absolute; left:0; bottom:0; width:100%; height:100%;
//             object-fit:cover; object-position:bottom center; opacity:.5; z-index:0;
//             -webkit-mask-image: linear-gradient(to top, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 100%); }
// 即：立绘铺满面板、按宽度覆盖并底对齐、整体 50% 不透明度、下半 50% 全显 / 上半 50% 线性淡出。
// 卡片最终编码为 jpeg（无 alpha），所以不能直接在主画布上做 destination-out 打洞（会露黑）；
// 改为「离屏画布 → cover 底对齐铺满 → destination-in 套自底向上遮罩 → 50% 叠到深蓝底上」，
// 视觉与上游一致，且完全不依赖主画布 alpha 通道。缺立绘时直接跳过（零回归）。
const ART_GAME = { gs: "genshin", sr: "starrail", zzz: "zzz" }
const normGame = g => (g === "zzz" ? "zzz" : g === "sr" ? "sr" : "gs")
const ART_OPACITY = .5

function paintArt(ctx, x, y, w, h, img, scale) {
  if (!img) return
  const lw = Math.max(1, Math.round(w * scale)), lh = Math.max(1, Math.round(h * scale))
  const layer = new Canvas(lw, lh)
  const lc = layer.getContext("2d")
  lc.scale(scale, scale)
  const ratio = Math.max(w / img.width, h / img.height)
  const dw = img.width * ratio, dh = img.height * ratio
  lc.drawImage(img, (w - dw) / 2, h - dh, dw, dh) // object-fit:cover + object-position:bottom center
  lc.globalCompositeOperation = "destination-in"
  const mask = lc.createLinearGradient(0, h, 0, 0) // to top：底部=0 → 顶部=1
  mask.addColorStop(0, "rgba(0,0,0,1)")
  mask.addColorStop(.5, "rgba(0,0,0,1)")
  mask.addColorStop(1, "rgba(0,0,0,0)")
  lc.fillStyle = mask
  lc.fillRect(0, 0, w, h)
  ctx.save()
  ctx.globalAlpha = ART_OPACITY
  ctx.drawImage(layer, x, y, w, h)
  ctx.restore()
}

// 立绘来源：显式 panel.artImg 优先（上游同名数据字段），否则按游戏从角色立绘库随机抽一张；
// 库缺失/抽取失败 → ""（不画，保持原深蓝玻璃观感）。
function resolveArt(panel = {}) {
  if (has(panel.artImg)) return panel.artImg
  try { return getRandomCharacter(ART_GAME[normGame(panel.game)]) || "" } catch { return "" }
}

// 图标清单（供 apps/dailyNote.js 组装数据时引用，路径只在这里定义一处）
export const DAILY_NOTE_ICONS = Object.freeze({
  gs: { logo: asset("gs-logo.png"), primary: asset("gs-resin.png"), coin: asset("gs-coin.png"), daily: asset("gs-daily.png"), expedition: asset("gs-expedition.png") },
  sr: { logo: asset("sr-logo.png"), primary: asset("sr-energy.png"), train: asset("sr-train.png"), sim: asset("sr-sim.png"), expedition: asset("sr-expedition.png"), reserve: asset("sr-reserve.png") },
  zzz: { logo: asset("zzz-logo-left.png"), right: asset("zzz-logo-right.png"), primary: asset("zzz-battery.png"), vitality: asset("zzz-vitality.png"), sign: asset("zzz-sign.png"), store: asset("zzz-store.png") },
})

async function image(src) {
  if (!src) return null
  if (!CACHE.has(src)) {
    CACHE.set(src, (async () => loadImage(/^https?:\/\//i.test(src) ? await fetchImageBytes(src) : /^file:\/\//i.test(src) ? new URL(src) : src))().catch(error => {
      CACHE.delete(src)
      globalThis.logger?.warn?.(`[荷花体力面板] 图片加载失败：${error.message}`)
      return null
    }))
    if (CACHE.size > 128) CACHE.delete(CACHE.keys().next().value)
  }
  return CACHE.get(src)
}

function hexA(hex, a) {
  const h = String(hex).replace("#", "")
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function paintNavy(ctx, w, h) {
  ctx.fillStyle = NAVY.base
  ctx.fillRect(0, 0, w, h)
  const rad = NAVY.angle * Math.PI / 180
  const dx = Math.sin(rad), dy = -Math.cos(rad)
  const len = Math.abs(dx) * w + Math.abs(dy) * h
  const cx = w / 2, cy = h / 2
  const g = ctx.createLinearGradient(cx - dx * len / 2, cy - dy * len / 2, cx + dx * len / 2, cy + dy * len / 2)
  for (const [color, pos] of NAVY.stops) g.addColorStop(pos, color)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  for (const glow of NAVY.glows) {
    const gx = glow.x * w, gy = glow.y * h, rr = glow.r * Math.max(w, h)
    const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr)
    rg.addColorStop(0, hexA(glow.c, glow.a))
    rg.addColorStop(1, hexA(glow.c, 0))
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, w, h)
  }
}

export function isDailyNotePayload(data = {}) {
  return Array.isArray(data.panels)
}

export async function renderDailyNotePanel(data = {}, options = {}) {
  if (!fontsLoaded) {
    const regFont = (name, p) => { try { if (existsSync(p)) FontLibrary.use(name, [p]) } catch {} }
    regFont("MiSans", path.join(resourcesPath, "fonts/MiSans-VF.ttf"))
    fontsLoaded = true
  }
  const scaleValue = Number(options.renderScale ?? data.renderScale ?? process.env.LOTUS_RENDER_SCALE ?? 4)
  const scale = Number.isFinite(scaleValue) ? Math.min(4, Math.max(1, scaleValue)) : 4

  const panels = (Array.isArray(data.panels) ? data.panels : []).filter(Boolean)
  const list = panels.length ? panels : [{ ok: false, error: "没有可展示的体力结果", uid: data.uid || "", game: "gs" }]
  const height = list.length * PANEL_H + (list.length - 1) * PANEL_GAP

  const artSources = list.map(panel => resolveArt(panel))
  const refs = new Set([asset("miyoushe.png"), asset("gs-logo.png"), asset("sr-logo.png"), asset("zzz-logo-left.png"), asset("zzz-logo-right.png"), asset("star.png"), asset("line-gs.png"), asset("line-sr.png"), asset("line-zzz.png")])
  for (const panel of list) {
    if (panel.logo) refs.add(panel.logo)
    if (panel.primary?.icon) refs.add(panel.primary.icon)
    for (const row of panel.rows || []) if (row.icon) refs.add(row.icon)
    for (const item of panel.footer?.items || []) if (item.icon) refs.add(item.icon)
  }
  for (const src of artSources) if (src) refs.add(src)
  const images = new Map()
  await Promise.all([...refs].map(async src => images.set(src, await image(src))))

  const canvas = new Canvas(Math.round(W * scale), Math.round(height * scale))
  const ctx = canvas.getContext("2d")
  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"

  const family = 'MiSans, sans-serif'
  // 与 theme.js 的 fstr 同构：MiSans 是可变字体，用字重而不是换字族建层次
  const setFont = (size, weight = 500) => { ctx.font = `${weight} ${size}px ${family}` }
  function text(value, x, y, size = 16, color = C.text, width = W, align = "left", weight = 500) {
    const label = String(value ?? "")
    setFont(size, weight)
    while (ctx.measureText(label).width > width && size > 11) { size -= .5; setFont(size, weight) }
    ctx.textBaseline = "top"; ctx.textAlign = align
    ctx.fillStyle = color
    ctx.fillText(label, align === "center" ? x + width / 2 : align === "right" ? x + width : x, y)
    return size
  }
  function widthOf(value, size, weight = 500) {
    setFont(size, weight)
    return ctx.measureText(String(value ?? "")).width
  }
  function wrap(value, width, size = 16, weight = 500) {
    setFont(size, weight)
    const lines = []
    for (const paragraph of String(value ?? "").split(/\r?\n/)) {
      let line = ""
      for (const char of paragraph) {
        if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = "" }
        line += char
      }
      if (line) lines.push(line)
    }
    return lines
  }
  function rect(x, y, w, h, fill, radius = 0) {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill()
  }
  function ring(x, y, r, color, lineWidth = 1) {
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
  }
  function hairline(x, y, w, color = "rgba(255,255,255,.14)") {
    ctx.strokeStyle = color; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke()
  }
  // 玻璃块（上游 .resin / .list / .status / .role）：投影 + 顶部高光 + 1px 白描边
  function glass(x, y, w, h, r, kind = "main") {
    const g = kind === "inner" ? GLASS_IN : GLASS
    ctx.save()
    ctx.shadowColor = g.shadow; ctx.shadowBlur = r > 24 ? 28 : 18; ctx.shadowOffsetY = r > 24 ? 10 : 6
    ctx.fillStyle = g.fill
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill()
    ctx.restore()
    if (g.sheen) {
      ctx.save()
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip()
      const lg = ctx.createLinearGradient(x, y, x, y + Math.min(h * .6, 190))
      lg.addColorStop(0, g.sheen); lg.addColorStop(1, "rgba(255,255,255,0)")
      ctx.fillStyle = lg; ctx.fillRect(x, y, w, h)
      ctx.restore()
    }
    ctx.save()
    ctx.lineWidth = 1; ctx.strokeStyle = g.line
    ctx.beginPath(); ctx.roundRect(x + .5, y + .5, w - 1, h - 1, r); ctx.stroke()
    ctx.restore()
  }
  function drawImage(img, x, y, w, h, radius = 0) {
    if (!img) return false
    ctx.save()
    if (radius) { ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.clip() }
    ctx.drawImage(img, x, y, w, h)
    ctx.restore()
    return true
  }
  function drawIcon(img, x, y, size) {
    if (!img) return
    const ratio = Math.min(size / img.width, size / img.height)
    const dw = img.width * ratio, dh = img.height * ratio
    ctx.drawImage(img, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh)
  }

  paintNavy(ctx, W, height)

  for (const [index, panel] of list.entries()) {
    const oy = index * (PANEL_H + PANEL_GAP)
    const game = normGame(panel.game)
    // 底色板先铺：位于深蓝底之上、logo/文字/玻璃块之下（上游 z-index:0 语义）
    paintArt(ctx, 0, oy, W, PANEL_H, images.get(artSources[index] || ""), scale)
    const logoFile = panel.logo || (game === "zzz" ? asset("zzz-logo-left.png") : game === "sr" ? asset("sr-logo.png") : asset("gs-logo.png"))
    const logoSize = LOGO_SIZE[game]
    drawImage(images.get(logoFile), 20, oy + 1, logoSize, logoSize)
    // 右上角标：原神/星铁走「米游社」，绝区零走上游自带的 right.png
    const mys = images.get(game === "zzz" ? asset("zzz-logo-right.png") : asset("miyoushe.png"))
    if (mys) { const mw = 100, mh = 100 * mys.height / mys.width; drawImage(mys, W - 20 - mw, oy + 5, mw, mh) }

    text(`UID: ${has(panel.uid) ? panel.uid : "未绑定"}`, 120, oy + 27, 25, C.text, 540, "left", 600)
    // 昵称（游戏内角色名，对齐 jj dailyNote 模板「昵称:」栏 —— 与 UID 同级展示）
    if (has(panel.nickname)) {
      text(`昵称: ${panel.nickname}`, 120, oy + 57, 16, C.text, 420, "left", 600)
    }
    // 多面板（多游戏 / 多 profile）时才补一行来源小注 —— 单面板保持与上游完全一致
    if (list.length > 1) {
      const note = [panel.gameName || LABELS[game], panel.profileLabel].filter(Boolean).join(" · ")
      text(note, 120, oy + (has(panel.nickname) ? 79 : 58), 13, C.sub, 420, "left", 500)
    }
    text(panel.date || "", W - 120 - 380, oy + 20, 13, C.cyan, 380, "right")
    if (panel.signed !== null && panel.signed !== undefined) {
      text(`今日签到福利${panel.signed ? "已" : "尚未"}领取`, W - 120 - 380, oy + 42, 17, panel.signed ? C.cyan : C.warn, 380, "right")
    }

    if (!panel.ok) {
      const bx = 20, by = oy + 73, bw = W - 40, bh = 283
      glass(bx, by, bw, bh, 20)
      text(`${panel.gameName || LABELS[game]} · 体力查询失败`, bx, by + 58, 26, C.warn, bw, "center", 600)
      const lines = wrap(panel.error || "未知错误", bw - 140, 16)
      lines.slice(0, 6).forEach((line, i) => text(line, bx, by + 116 + i * 26, 16, C.sub, bw, "center"))
      const stamp = panel.uid ? `UID ${panel.uid}` : ""
      if (stamp) text(stamp, bx, by + bh - 58, 15, C.sub, bw, "center")
      continue
    }

    // ---- 左：主资源玻璃块（290×283 @ 20,73）----
    const rx = 20, ry = oy + 73, rw = 290, rh = 283
    glass(rx, ry, rw, rh, 20)
    const primary = panel.primary || {}
    drawImage(images.get(primary.icon), rx + 20, ry + 20, 100, 100)
    text(primary.label || "体力", rx + 125, ry + 30, 25, C.text, 150, "left", 600)
    const full = !(Number(primary.max) > 0) || Number(primary.current) >= Number(primary.max)
    const numColor = panel.primary?.recover ? C.numPart : full ? C.numFull : C.numPart
    const strongText = has(primary.current) ? String(primary.current) : "—"
    const strongW = widthOf(strongText, 45, 600)
    text(strongText, rx + 125, ry + 62, 45, numColor, 200, "left", 600)
    text(`/${has(primary.max) ? primary.max : "—"}`, rx + 125 + strongW + 2, ry + 80, 25, C.text, 160, "left", 500)

    // 内嵌状态卡（250×135，顶 135）
    const sx = rx + 20, sy = ry + 135, sw = 250, sh = 135
    glass(sx, sy, sw, sh, 30, "inner")
    const recover = primary.recover
    if (recover) {
      text("预计恢复时间", sx, sy + 22, 15, C.sub, sw, "center", 600)
      const dayText = recover.day || ""
      const timeText = recover.time || ""
      const dayW = widthOf(dayText, 18, 600)
      const timeW = widthOf(timeText, 18, 600)
      const pillW = timeW + 28, pillH = 36
      const totalW = dayW + 6 + pillW
      const startX = sx + (sw - totalW) / 2
      const rowY = sy + 56
      if (dayText) text(dayText, startX, rowY + 9, 18, C.cyan, dayW + 4, "left", 600)
      ctx.save()
      ctx.fillStyle = "rgba(96,156,230,.25)"
      ctx.beginPath(); ctx.roundRect(dayText ? startX + dayW + 6 : sx + (sw - pillW) / 2, rowY, pillW, pillH, 18); ctx.fill()
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.35)"
      ctx.beginPath(); ctx.roundRect(dayText ? startX + dayW + 6 : sx + (sw - pillW) / 2 + .5, rowY + .5, pillW - 1, pillH - 1, 18); ctx.stroke()
      ctx.restore()
      text(timeText, dayText ? startX + dayW + 6 : sx + (sw - pillW) / 2, rowY + 9, 18, C.cyan, pillW, "center", 600)
    } else {
      text("已全部恢复", sx, sy + 50, 25, C.green, sw, "center", 600)
    }
    if (has(panel.reserve)) text(`后备开拓力：${panel.reserve}`, sx, sy + sh - 34, 16, C.sub, sw, "center", 600)

    // ---- 右：清单玻璃块（447×283 @ 331,73）----
    const lx = 331, ly = oy + 73, lw = 447, lh = 283
    glass(lx, ly, lw, lh, 20)
    const rows = (panel.rows || []).slice(0, 3)
    // 上游行距：有底部派遣胶囊时 .img-line margin 10 → 行距 70 / 线在 +50；
    //           无胶囊（绝区零）时 margin 23 → 行距 96 / 线在 +63，正好铺满整块。
    const hasFooter = Boolean(panel.footer)
    const rowGap = hasFooter ? 70 : 96
    const lineOffset = hasFooter ? 50 : 63
    const lineFile = game === "sr" ? asset("line-sr.png") : game === "zzz" ? asset("line-zzz.png") : asset("line-gs.png")
    const lineImg = images.get(lineFile)
    rows.forEach((row, i) => {
      const rowY = ly + 26 + i * rowGap
      drawIcon(images.get(row.icon), lx + 20, rowY, 40)
      text(row.label || "", lx + 70, rowY + 8, 23, C.text, 200, "left", 600)
      const valueText = String(row.value ?? "—")
      const maxText = has(row.max) ? ` /${row.max}` : ""
      const valueW = widthOf(valueText, 23, 600) + widthOf(maxText, 16, 500)
      const startX = lx + lw - 20 - valueW
      text(valueText, startX, rowY + 8, 23, row.warn ? C.red : C.text, valueW + 4, "left", 600)
      if (maxText) text(maxText, startX + valueW - widthOf(maxText, 16, 500), rowY + 14, 16, C.sub, widthOf(maxText, 16, 500) + 4, "left", 500)
      if (i < rows.length - 1) {
        if (lineImg) { ctx.save(); ctx.globalAlpha = .7; drawImage(lineImg, lx + 20, rowY + lineOffset, lw - 40, 10); ctx.restore() }
        else hairline(lx + 20, rowY + lineOffset + 4, lw - 40, "rgba(255,255,255,.14)")
      }
    })

    // 底部派遣胶囊（380×46，距块底 13）
    const fr = panel.footer
    if (fr) {
      const px = lx + 34, py = ly + lh - 13 - 46, pw = 380, ph = 46
      glass(px, py, pw, ph, 23, "inner")
      const star = images.get(asset("star.png"))
      if (star) {
        ctx.save(); ctx.globalAlpha = .9
        drawImage(star, px + 25, py + 14.5, 17, 17)
        drawImage(star, px + pw - 25 - 17, py + 14.5, 17, 17)
        ctx.restore()
      }
      const items = (fr.items || []).slice(0, 8)
      if (!items.length) {
        text(fr.label || "尚未进行探索派遣", px, py + 13, 17, C.sub, pw, "center")
      } else {
        const size = 34, adv = 32
        const totalW = size + (items.length - 1) * adv
        let x = px + (pw - totalW) / 2
        const cy = py + ph / 2
        for (const item of items) {
          ctx.save()
          ctx.beginPath(); ctx.arc(x + size / 2, cy, size / 2, 0, Math.PI * 2); ctx.clip()
          ctx.fillStyle = "rgba(255,255,255,.10)"; ctx.fillRect(x, cy - size / 2, size, size)
          const img = images.get(item.icon)
          if (img) {
            const ratio = Math.max(size / img.width, size / img.height)
            const dw = img.width * ratio, dh = img.height * ratio
            ctx.drawImage(img, x + (size - dw) / 2, cy - dh / 2, dw, dh)
          }
          ctx.restore()
          ring(x + size / 2, cy, size / 2 - 1, item.done ? C.green : C.cyan, 2)
          if (item.done) {
            ctx.save()
            ctx.fillStyle = C.green
            ctx.beginPath(); ctx.arc(x + size - 7, cy + size / 2 - 7, 7, 0, Math.PI * 2); ctx.fill()
            ctx.strokeStyle = "#0F2233"; ctx.lineWidth = 2; ctx.lineCap = "round"
            ctx.beginPath(); ctx.moveTo(x + size - 11, cy + size / 2 - 7); ctx.lineTo(x + size - 8, cy + size / 2 - 4); ctx.lineTo(x + size - 3, cy + size / 2 - 11); ctx.stroke()
            ctx.restore()
          }
          x += adv
        }
      }
    }
  }

  // 多面板之间的分隔线（同一张底图上堆叠，靠细线分节）
  for (let i = 1; i < list.length; i++) hairline(40, i * (PANEL_H + PANEL_GAP) - PANEL_GAP / 2, W - 80, "rgba(255,255,255,.10)")

  const { buffer, tiles, format } = await encodeGpuCanvas(canvas, options)
  options.onRender?.({ gpu: canvas.gpu, ...canvas.engine, width: canvas.width, height: canvas.height, tiles, format, missingImages: [...images].filter(([, img]) => !img).map(([src]) => src) })
  return buffer
}
