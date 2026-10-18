import path from "node:path"
import { existsSync } from "node:fs"
import { Canvas, FontLibrary, loadImage } from "skia-canvas"
import { resourcesPath } from "../path.js"
import { fetchImageBytes } from "./image.js"
import { encodeGpuCanvas } from "./gpu-buffer.js"

// 原神深境螺旋战绩 —— 原生复刻 genshin 插件 `resources/Genshin/html/abyss/abyss.{html,css}`：
//   页头（UID 标题 + 统计周期）→ 总览卡（最深抵达/战斗次数/获取星数 + 出战次数头像圈 | 五项之最）
//   → 层卡 ×N（第 9~12 层：层徽 + 星数 + 地脉异常 + 每间 上半/下半 队伍 + 魔物）→ 页脚。
//
// 【配色为什么写死深色，不走主题真源】与 daily-note.js / starrail-abyss.js / team-damage.js 同理：
// 上游就是「深蓝 #07091B + 层卡 #1C1B3D + 金 #d3bc8d」配对，浅色主题上会隐身。
// 图片资源已拷进 Lotus 自有 `resources/genshin-abyss/`，运行时不读 genshin 插件。
const ROOT = path.join(resourcesPath, "genshin-abyss")
const FONT_PATH = path.join(resourcesPath, "fonts/MiSans-VF.ttf")

// ---- 几何（上游 CSS 逐条，逻辑宽 600）----
const W = 600
const X = 7.5            // 内容带 7.5..592.5（宽 585，上游 margin auto）
const CW = 585
const CARD_PAD = 12
const LIFE_COLORS = { 1: "#62a8ea", 2: "#62a8ea", 3: "#45b97c", 4: "#45b97c", 5: "#ff5722", 6: "#ff5722" }
const C = {
  white: "#FFFFFF",
  soft: "#E6EBFF",
  dim: "#C8D1F6",
  gold: "#D3BC8D",
  halfLabel: "#D4B44C",
  logo: "#7994A7",
  panel: "rgba(255,255,255,.07)",
  panelDim: "rgba(255,255,255,.06)",
  half: "rgba(255,255,255,.08)",
  line: "rgba(255,255,255,.12)",
  rule: "hsla(0,0%,100%,.3)",
  page: "#07091B",
  floorBg: "#1C1B3D",
  circle: "rgba(255,255,255,.08)",
}
const RARITY_BG = { 5: "BG_5.png", 4: "BG_4.png", 105: "BG_105.png" }
const rarityBg = r => RARITY_BG[Number(r)] || RARITY_BG[4]
const lifeColor = n => LIFE_COLORS[Math.min(6, Math.max(0, Number(n) || 0))]

const CACHE = new Map()
let fontsLoaded = false

const asset = name => path.join(ROOT, name)
const has = v => v !== undefined && v !== null && v !== ""

async function image(src) {
  if (!src) return null
  if (!CACHE.has(src)) {
    CACHE.set(src, (async () => loadImage(/^https?:\/\//i.test(src) ? await fetchImageBytes(src) : /^file:\/\//i.test(src) ? new URL(src) : src))().catch(error => {
      CACHE.delete(src)
      globalThis.logger?.warn?.(`[荷花深渊] 图片加载失败：${error.message}`)
      return null
    }))
    if (CACHE.size > 160) CACHE.delete(CACHE.keys().next().value)
  }
  return CACHE.get(src)
}

export function isGenshinAbyssPayload(data = {}) {
  return Array.isArray(data.floors) && Array.isArray(data.ranks)
}

export async function renderGenshinAbyss(data = {}, options = {}) {
  if (!fontsLoaded) {
    try { if (existsSync(FONT_PATH)) FontLibrary.use("MiSans", [FONT_PATH]) } catch { }
    fontsLoaded = true
  }
  const scaleRaw = Number(options.renderScale ?? data.renderScale ?? process.env.LOTUS_RENDER_SCALE ?? 4)
  const scale = Number.isFinite(scaleRaw) ? Math.min(4, Math.max(1, scaleRaw)) : 4

  // 预取图片
  const refs = new Set(["page-bg-top.png", "page-bg-bottom.png", "top-bg.png", "floor-top.png", "floor-bottom.png", "floor-bg.png", "star.png"].map(asset))
  for (const r of data.ranks || []) if (r.icon) refs.add(r.icon)
  for (const r of data.reveal || []) if (r.icon) refs.add(r.icon)
  for (const floor of data.floors || []) {
    for (const room of floor.rooms || []) {
      for (const half of room.halves || []) {
        for (const a of half.avatars || []) if (a.icon) refs.add(a.icon)
        for (const m of half.monsters || []) if (m.icon) refs.add(m.icon)
      }
    }
  }
  const images = new Map()
  await Promise.all([...refs].map(async src => images.set(src, await image(src))))

  // ---- 高度先量后画 ----
  const measure = planLayout(data, images)
  const height = measure.height
  let effective = scale
  const PIXEL_BUDGET = 4.2e7
  while (effective > 1 && W * effective * height * effective > PIXEL_BUDGET) effective -= 1
  const canvas = new Canvas(Math.round(W * effective), Math.round(height * effective))
  const ctx = canvas.getContext("2d")
  ctx.scale(effective, effective)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"

  const family = "MiSans, sans-serif"
  const setFont = (size, weight = 500) => { ctx.font = `${weight} ${size}px ${family}` }
  function draw(value, x, y, size, color, o = {}) {
    const label = String(value ?? "")
    const weight = o.weight ?? 500
    setFont(size, weight)
    while (ctx.measureText(label).width > (o.width ?? W) && size > (o.minSize ?? 10)) { size -= .5; setFont(size, weight) }
    ctx.save()
    ctx.textBaseline = o.baseline || "top"
    ctx.textAlign = o.align || "left"
    ctx.fillStyle = color
    if (o.shadow) { ctx.shadowColor = o.shadowColor || "rgba(0,0,0,.6)"; ctx.shadowBlur = o.shadowBlur ?? 3; ctx.shadowOffsetY = o.shadowOffsetY ?? 1 }
    ctx.fillText(label, x, y)
    ctx.restore()
    return size
  }
  function widthOf(value, size, weight = 500) { setFont(size, weight); return ctx.measureText(String(value ?? "")).width }
  function rect(x, y, w, h, fill, r = 0) { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill() }
  function ring(x, y, r, color, lw = 1) { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke() }
  function imgFit(src, x, y, w, h, mode = "contain", radius = 0) {
    const img = images.get(src)
    if (!img) return false
    ctx.save()
    if (radius) { ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.clip() }
    const ratio = (mode === "cover" ? Math.max : Math.min)(w / img.width, h / img.height)
    const dw = img.width * ratio, dh = img.height * ratio
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    ctx.restore()
    return true
  }
  function starIcon(x, y, size, dimmed) {
    const img = images.get(asset("star.png"))
    if (!img) return
    ctx.save()
    if (dimmed) { ctx.globalAlpha = .3; ctx.filter = "grayscale(100%)" }
    ctx.drawImage(img, x, y, size, size)
    ctx.restore()
  }
  // 地脉异常：数字/百分比用金色，其余浅色（上游 .ley-num）
  function leyLine(x, y, w, text, size) {
    let cx = x
    for (const part of String(text).split(/(\d+(?:\.\d+)?%?)/).filter(Boolean)) {
      setFont(size, 500)
      const w = ctx.measureText(part).width
      if (cx + w > x + w) break
      draw(part, cx, y, size, /^\d/.test(part) ? C.gold : C.soft, { width: x + w - cx, minSize: 9 })
      cx += w
    }
    return cx - x
  }

  // ---------- 背景 ----------
  const pageTop = images.get(asset("page-bg-top.png"))
  const pageBottom = images.get(asset("page-bg-bottom.png"))
  rect(0, 0, W, height, C.page)
  if (pageTop) { const dw = W * 1.1, dh = pageTop.height * dw / pageTop.width; ctx.drawImage(pageTop, (W - dw) / 2, 0, dw, dh) }
  if (pageBottom) { const dw = W * 1.1, dh = pageBottom.height * dw / pageBottom.width; ctx.drawImage(pageBottom, (W - dw) / 2, height - dh, dw, dh) }

  // ---------- 页头 ----------
  draw(`UID:${data.uid || "未绑定"} ${data.title || "深境螺旋战绩"}`, W / 2, 12, 18, C.white, { weight: 700, align: "center", width: CW, shadow: true, shadowBlur: 2 })
  let y = 12 + 26
  if (data.period) {
    draw(`统计周期：${data.period}`, W / 2, y, 13, C.dim, { align: "center", width: CW })
    y += 22
  }

  // ---------- 总览卡 ----------
  const sumTop = y
  const sumH = measure.summaryH
  ctx.save()
  const topBg = images.get(asset("top-bg.png"))
  if (topBg) {
    ctx.beginPath(); ctx.roundRect(X, sumTop, CW, sumH, 12); ctx.clip()
    ctx.drawImage(topBg, X, sumTop, CW, sumH)
  } else rect(X, sumTop, CW, sumH, "rgba(28,27,61,.9)", 12)
  ctx.restore()

  const gx = X + CARD_PAD, gw = CW - CARD_PAD * 2
  const leftW = gw * 0.46, rightW = gw - leftW - 10
  // 左：三个 mini 卡
  let ly = sumTop + 14 + 4
  const mini = (label, value, withStar) => {
    const h = 36
    rect(gx, ly, leftW, h, C.panel, 10)
    draw(label, gx + 10, ly + h / 2, 14, C.soft, { baseline: "middle" })
    if (withStar) {
      starIcon(gx + leftW - 54, ly + h / 2 - 8, 16)
      draw(value, gx + leftW - 10, ly + h / 2, 15, C.white, { weight: 700, baseline: "middle", align: "right", width: leftW - 70, minSize: 11 })
    } else {
      draw(value, gx + leftW - 10, ly + h / 2, 15, C.white, { weight: 700, baseline: "middle", width: leftW - 20, align: "right", minSize: 11 })
    }
    ly += h + 6
  }
  mini("最深抵达", data.maxFloor ?? "—")
  mini("战斗次数", data.totalBattleTimes ?? 0)
  mini("获取星数", data.totalStar ?? 0, true)
  // 出战次数头像圈
  const circleTop = ly
  const circleH = Math.max(0, sumTop + sumH - 16 - circleTop)
  if (circleH > 40) {
    rect(gx, circleTop, leftW, circleH, C.panel, 10)
    const list = (data.reveal || []).slice(0, 4)
    const slot = (leftW - 20) / 4
    list.forEach((item, i) => {
      const cx = gx + 10 + slot * i + slot / 2
      const cy = circleTop + 34
      ctx.save()
      ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.clip()
      rect(cx - 20, cy - 20, 40, 40, C.circle)
      imgFit(item.icon, cx - 20, cy - 20, 40, 40, "cover")
      ctx.restore()
      ring(cx, cy, 20, C.line, 1)
      draw(item.value ?? 0, cx, cy + 24, 12, C.white, { weight: 700, align: "center", baseline: "middle", width: 44, shadow: true, shadowBlur: 2 })
    })
    draw("出战次数", gx + 10, circleTop + 8, 14, C.soft, { weight: 600 })
  }
  // 右：五项之最
  const rx = gx + leftW + 10
  rect(rx, sumTop + 14 + 4, rightW, sumH - 14 * 2 - 4 - 2, C.panelDim, 12)
  let ry = sumTop + 14 + 4 + 8
  for (const r of data.ranks || []) {
    const rowH = (sumH - 14 * 2 - 4 - 2 - 16) / 5
    const iconSize = 22
    ctx.save()
    ctx.beginPath(); ctx.arc(rx + 10 + iconSize / 2, ry + rowH / 2 - 4, iconSize / 2, 0, Math.PI * 2); ctx.clip()
    rect(rx + 10, ry + rowH / 2 - 4 - iconSize / 2, iconSize, iconSize, C.circle)
    imgFit(r.icon, rx + 10, ry + rowH / 2 - 4 - iconSize / 2, iconSize, iconSize, "cover")
    ctx.restore()
    draw(r.label, rx + 10 + iconSize + 10, ry + rowH / 2 - 4, 14, C.soft, { baseline: "middle", width: rightW - 20 - iconSize - 60, minSize: 11 })
    draw(r.num ?? 0, rx + rightW - 12, ry + rowH / 2 - 4, 16, C.white, { weight: 700, align: "right", baseline: "middle", width: 60, minSize: 10 })
    ry += rowH
  }
  y = sumTop + sumH + 10

  // ---------- 层卡 ----------
  for (const floor of data.floors || []) {
    const fl = measure.floors.get(floor.index)
    if (!fl) continue
    const fx = X, fy = y
    ctx.save()
    ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10
    rect(fx, fy, CW, fl.h, C.floorBg, 7)
    ctx.restore()
    const fTop = images.get(asset("floor-top.png"))
    const fBottom = images.get(asset("floor-bottom.png"))
    ctx.save()
    ctx.beginPath(); ctx.roundRect(fx, fy, CW, fl.h, 7); ctx.clip()
    if (fTop) { const dw = CW, dh = fTop.height * dw / fTop.width; ctx.drawImage(fTop, fx, fy, dw, dh) }
    if (fBottom) { const dw = CW, dh = fBottom.height * dw / fBottom.width; ctx.drawImage(fBottom, fx, fy + fl.h - dh, dw, dh) }
    ctx.restore()

    // 层头
    const bx = fx + 20, by = fy + 12
    const badge = images.get(asset("floor-bg.png"))
    if (badge) ctx.drawImage(badge, bx, by, 60, 60)
    else { rect(bx, by, 60, 60, C.gold, 30) }
    draw(String(floor.index), bx + 30, by + 30, 20, "#000", { weight: 800, align: "center", baseline: "middle", width: 60 })
    draw(`深境螺旋第${floor.index}层`, bx + 70, by + 30, 22, C.white, { weight: 700, baseline: "middle", width: CW - 200, minSize: 14 })
    const starSize = 30
    starIcon(bx + CW - 40 - 20 - starSize - 6, by + 30 - starSize / 2, starSize)
    draw(`${floor.star}/${floor.maxStar}`, fx + CW - 26, by + 30, 20, C.white, { weight: 700, align: "right", baseline: "middle", width: 66, minSize: 12 })
    let cy = fy + 12 + 60 + 10
    if ((floor.leyLine || []).length) {
      draw("地脉异常：", bx, cy, 13, C.gold, { weight: 600 })
      const labelW = widthOf("地脉异常：", 13, 600)
      leyLine(bx + labelW, cy, CW - 40 - labelW, floor.leyLine.join("  "), 13)
      cy += 20
    }
    // 每间
    const rx0 = fx + 20, rw = CW - 40
    for (const room of floor.rooms || []) {
      cy += 5
      ctx.strokeStyle = C.rule; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(rx0, cy); ctx.lineTo(rx0 + rw, cy); ctx.stroke()
      cy += 6
      draw(`第${room.index}间`, rx0, cy, 14, C.white, { weight: 600 })
      for (let s = 0; s < 3; s++) {
        const sx = rx0 + rw - (3 - s) * 32 - s * 6
        starIcon(sx, cy + 2, 26, room.star < s + 1)
      }
      cy += 30
      if (room.time) { draw(room.time, rx0, cy, 13, C.dim); cy += 18 }
      for (const half of room.halves || []) {
        const hh = measure.halfH
        ctx.save()
        ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 20; ctx.shadowOffsetY = 6
        rect(rx0, cy, rw, hh, C.half, 10)
        ctx.restore()
        ctx.save()
        ctx.lineWidth = 1; ctx.strokeStyle = C.line
        ctx.beginPath(); ctx.roundRect(rx0 + .5, cy + .5, rw - 1, hh - 1, 10); ctx.stroke()
        ctx.restore()
        draw(half.label, rx0 + rw / 2, cy + 8, 14, C.halfLabel, { weight: 700, align: "center", baseline: "middle" })
        // 队伍（左） + 魔物（右）
        const bodyY = cy + 26
        const halfW = (rw - 24 - 16) / 2
        const slotW = halfW / 4
        ;(half.avatars || []).slice(0, 4).forEach((a, i) => {
          const cx0 = rx0 + 12 + slotW * i + (slotW - 50) / 2
          const cy0 = bodyY
          ctx.save()
          ctx.shadowColor = "rgba(132,93,90,.3)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2
          rect(cx0, cy0, 50, 65, C.circle, 5)
          ctx.restore()
          ctx.save()
          ctx.beginPath(); ctx.roundRect(cx0, cy0, 50, 65, 5); ctx.clip()
          const bg = images.get(asset(rarityBg(a.rarity)))
          if (bg) ctx.drawImage(bg, cx0, cy0, 50, 51)
          imgFit(a.icon, cx0, cy0, 50, 51, "cover")
          ctx.restore()
          rect(cx0, cy0 + 51, 50, 14, "#E9E5DC")
          draw(`Lv.${a.level}`, cx0 + 25, cy0 + 51 + 7, 11, "#1E1F20", { weight: 500, align: "center", baseline: "middle", width: 50, minSize: 8 })
          if (a.life > 0) {
            rect(cx0 + 50 - 24, cy0, 24, 15, lifeColor(a.life), 3)
            draw(`${a.life}命`, cx0 + 50 - 12, cy0 + 7, 11, C.white, { weight: 600, align: "center", baseline: "middle", width: 24, minSize: 8 })
          }
        })
        const monsters = (half.monsters || []).slice(0, 4)
        const mSlot = halfW / 4
        monsters.forEach((m, i) => {
          const size = 40
          const cx0 = rx0 + 12 + halfW + 16 + mSlot * i + (mSlot - size) / 2
          const cy0 = bodyY
          rect(cx0, cy0, size, size, C.circle, 6)
          ctx.save()
          ctx.beginPath(); ctx.roundRect(cx0, cy0, size, size, 6); ctx.clip()
          imgFit(m.icon, cx0, cy0, size, size, "cover")
          ctx.restore()
          ring(cx0 + size / 2, cy0 + size / 2, size / 2, C.line, 1)
          draw(`Lv.${m.level}`, cx0 + size / 2, cy0 + size + 3, 11, C.soft, { align: "center", baseline: "middle", width: mSlot, minSize: 8 })
        })
        cy += hh + 12
      }
      cy += 2
    }
    y = fy + fl.h + 10
  }

  // 页脚
  if (data.source || data.generatedAt) {
    draw([data.source, data.generatedAt].filter(Boolean).join("  ·  "), W / 2, y + 2, 12, C.logo, { align: "center", width: CW })
  }

  const { buffer, tiles, format } = await encodeGpuCanvas(canvas, options)
  options.onRender?.({ gpu: canvas.gpu, ...canvas.engine, width: canvas.width, height: canvas.height, tiles, format, missingImages: [...images].filter(([, img]) => !img).map(([src]) => src) })
  return buffer
}

// ---------------- 布局测量（画之前先算总高）----------------
function planLayout(data, images) {
  const HEAD_H = 26 + (data.period ? 22 : 0)
  const ROOM_PER = { head: 41, half: 96, gap: 12 }
  const halfH = ROOM_PER.half
  let summaryH = 14 + 4 + (36 + 6) * 3 + 6 + 96 + 16
  let total = 12 + HEAD_H + summaryH + 10
  const floors = new Map()
  for (const floor of data.floors || []) {
    let h = 12 + 60 + 10
    if ((floor.leyLine || []).length) h += 20
    for (const room of floor.rooms || []) h += ROOM_PER.head + (room.halves || []).length * (halfH + ROOM_PER.gap) + 7
    h += 16
    floors.set(floor.index, { h })
    total += h + 10
  }
  total += 22
  return { height: Math.ceil(total), summaryH, halfH, floors }
}
