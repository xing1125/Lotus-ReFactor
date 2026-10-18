import path from "node:path"
import { existsSync } from "node:fs"
import { Canvas, FontLibrary, loadImage } from "skia-canvas"
import { resourcesPath } from "../path.js"
import { fetchImageBytes } from "./image.js"
import { encodeGpuCanvas } from "./gpu-buffer.js"
import { fstr } from "./theme.js"

// ---------------------------------------------------------------------------
// 星铁挑战战绩卡（混沌回忆 / 虚构叙事 / 末日幻影 / 异相仲裁）
//
// 版式来源：用户提供的「Rozaki Arina」版挑战回顾参考图（483×1920 截图）。骨架：
//   页底深蓝灰渐变
//     → 顶部「统计总览」卡：UID + 模式挑战回顾 / ★×N 总星数 | ✦ 最高关卡 | ✦ / 挑战次数 / 统计周期
//     → 每期关卡一张卡：关卡名（+星启模式）+ 右侧星级 | 使用轮次 / 节点N + 时间戳 + 4 列角色卡
//     → 页脚署名（Powered by genshin & Designed by Rozaki Arina）
// 参考图 483px 宽、卡片 457px，本渲染器画布 760px、卡片 720px，故所有尺寸都按
//   k = 720 / 457 ≈ 1.5755 从参考图换算过来（下方常量里的数字即参考图原值 × k）。
//
// 配色是「自带底色的品牌面板」——与 core/render/daily-note.js 同理，不跟 LOTUS_THEME 走：
//   参考图是深紫底 + 金字的固定品牌色，套进浅色主题（crystal / saas）会完全失真。
//   这两张卡是全插件仅有的两处主题真源例外，其余卡片仍在 theme.js 的 SSOT 之下。
//
// 图标（四芒星 / 八芒尖芒 / 王冠 / 属性角标）全部矢量绘制，不依赖 resources/starrail-abyss
//   （该资源子模块未初始化时，历史上会让星级与场景图整块变空）。
// ---------------------------------------------------------------------------

/* ===== 画布 / 卡片几何 ===== */
const W = 760
const SIDE = 20
const CARD_W = W - SIDE * 2                      // 720（参考图 457）
const PAD = 33                                   // 参考图 21
const CONTENT_X = SIDE + PAD                     // 53（参考图 34）
const CONTENT_W = CARD_W - PAD * 2                // 654（参考图 415）
const RADIUS = 12

/* ===== 角色卡 ===== */
const AVATAR_W = 150                             // 参考图 95
const AVATAR_H = 230                             // 参考图 146
const LV_H = 33                                  // 参考图 21
const AVATAR_GAP = 18                            // 参考图 12
const PER_ROW = 4
const NODE_BAND = 60                             // 参考图 38：节点行标签带
const HIGHLIGHT_BAND = 79                        // 参考图 50：王冠高亮行标签带
const BUFF_BAND = 30                             // 节点增益副行（荷花补全：上游数据有 buff 但参考图版式没画）

/* ===== 区块节奏 ===== */
const SECTION_HEAD_H = 158                       // 参考图 100
const SECTION_PAD_BOTTOM = 36                    // 参考图 23
const CARD_GAP = 25                              // 参考图 16
const TOP_PAD = 27                               // 参考图 17
const HEADER_H = 331                             // 参考图 210
const FOOTER_H = 124                             // 参考图 79

/* ===== 品牌色板（固定，不随主题）===== */
const C = {
  pageTop: "#343547",
  pageBottom: "#2B3443",
  card: "#1D1725",
  cardGlowHeader: "rgba(152,94,198,.26)",
  cardGlowSection: "rgba(140,86,186,.16)",
  cardRim: "rgba(200,154,226,.22)",
  cardLine: "rgba(255,255,255,.055)",
  white: "#FFFFFF",
  ink: "#F3F5F9",
  sub: "#BCC1D2",
  dim: "#8D93A7",
  gold: "#F0C98E",
  goldStar: "#FBC46B",
  spark: "#DFF0FF",
  footer: "#7C849B",
  footerDim: "#5E6579",
  strip: "#0B0710",
  stripLine: "rgba(255,255,255,.10)",
  rule: "rgba(255,255,255,.10)",
  sep: "rgba(255,255,255,.26)",
}

/* ===== 元素 / 命座 ===== */
const ELEMENT_TINT = {
  physical: "#CFD4DE",
  fire: "#F0704F",
  ice: "#7ED0F2",
  lightning: "#C07BF5",
  wind: "#5FD3A2",
  quantum: "#7B7BF2",
  imaginary: "#F2D35E",
}

/* ===== 稀有度卡面底色（5★ 暖褐金 / 4★ 紫调，与主题无关）===== */
const RARITY_FACE = {
  five: ["#7C5A45", "#3B2440"],
  four: ["#5A497C", "#2C2444"],
}

const LABELS = { hall: "混沌回忆", story: "虚构叙事", boss: "末日幻影", peak: "异相仲裁" }
const KINDS = ["boss", "story", "hall", "peak"]
const CREDIT = "Powered by genshin & Designed by Rozaki Arina(860563585)"

const CACHE = new Map()
let fontsLoaded = false
const family = "MiSans, sans-serif"

const hasValue = value => value !== undefined && value !== null && value !== ""
const valueOr = (value, suffix = "") => (hasValue(value) ? `${value}${suffix}` : "—")
const kindOf = result => result.kind || KINDS[result.challengeType]

function elementTint(value) {
  const key = String(value || "").trim().toLowerCase()
  if (ELEMENT_TINT[key]) return ELEMENT_TINT[key]
  if (key === "thunder" || key === "electric") return ELEMENT_TINT.lightning
  return ""
}

export function isStarRailAbyss(data = {}) {
  return Boolean(data.results?.length) && data.results.every(result => LABELS[kindOf(result)])
}

// 一期展示多少关：参考图是「最深 3 关」（其十二 / 其十一 / 其十）。
// 0 表示不截断（全部关卡）。可用 LOTUS_SR_ABYSS_FLOORS 覆盖。
function resolveFloorLimit(data = {}) {
  const raw = data.floorLimit ?? process.env.LOTUS_SR_ABYSS_FLOORS
  const value = Number(raw)
  if (Number.isFinite(value) && value >= 0) return Math.floor(value)
  return 3
}

function hasFloorRecord(floor = {}) {
  return hasValue(floor.score) || hasValue(floor.stars) || hasValue(floor.round) || floor.nodes?.length
}

/**
 * 把查询结果摊平成「一期关卡 = 一张区块卡」。节点角色行与上游 starRailChallenge 服务同构，
 * 只是这里保留最近 N 关（参考图版式）而不是只留最深一关。
 */
export function buildStarRailAbyssSections(data = {}) {
  const limit = resolveFloorLimit(data)
  return (data.results || []).flatMap(result => {
    const kind = kindOf(result)
    const label = result.label || LABELS[kind] || "挑战战绩"
    if (kind === "peak" && result.peak?.length) {
      return result.peak.map(record => {
        const items = [
          record.boss && { ...record.boss, label: "王棋" },
          ...(record.mobs || []).map((mob, index) => ({ ...mob, label: `骑士${index + 1}` })),
        ].filter(Boolean)
        const stars = hasValue(record.bossStars) || hasValue(record.mobStars)
          ? Number(record.bossStars || 0) + Number(record.mobStars || 0)
          : ""
        return {
          label,
          floorTitle: record.title || "异相仲裁",
          modeSuffix: "",
          stars,
          maxStars: 3,
          extra: false,
          extraStars: 0,
          round: items.find(item => hasValue(item.round))?.round ?? "",
          nodes: items.map(item => ({
            label: item.label,
            time: item.time || "",
            avatars: item.avatars || [],
            crowned: Boolean(item.cleared),
          })),
        }
      })
    }
    const floors = (result.floors || []).filter(hasFloorRecord)
    const picked = limit > 0 ? floors.slice(-limit) : floors
    return [...picked].reverse().map(floor => ({
      label,
      floorTitle: floor.title || "挑战记录",
      modeSuffix: floor.tierce ? "星启模式" : "",
      stars: floor.stars,
      maxStars: 3,
      extra: Boolean(floor.tierce),
      extraStars: Boolean(floor.tierce) && hasValue(result.extraStars) && Number(result.extraStars) > 0 ? 1 : 0,
      round: floor.round,
      score: floor.score,
      nodes: (floor.nodes || []).map(node => ({
        label: node.label || "节点",
        time: node.time || "",
        buff: node.buff || "",
        avatars: node.avatars || [],
        crowned: node.defeated === true,
      })),
    }))
  })
}

function summarize(data = {}, sections = []) {
  const results = data.results || []
  const first = results[0] || {}
  const label = results.length === 1
    ? first.label || LABELS[kindOf(first)] || "挑战战绩"
    : results.length > 1 ? "星铁" : "挑战战绩"
  const stars = results.reduce((sum, result) => {
    const value = Number(result.stars)
    return Number.isFinite(value) ? sum + value : sum
  }, 0)
  const battles = first.battleNum
  return {
    title: `${label}挑战回顾`,
    stars: results.some(result => hasValue(result.stars)) ? stars : "",
    maxFloor: sections[0]?.floorTitle || "—",
    battles,
    period: first.period || sections[0]?.period || "",
  }
}

async function image(src) {
  if (!src) return null
  if (!CACHE.has(src)) {
    CACHE.set(src, (async () => loadImage(
      /^https?:\/\//i.test(src) ? await fetchImageBytes(src) : /^file:\/\//i.test(src) ? new URL(src) : src,
    ))().catch(error => {
      CACHE.delete(src)
      globalThis.logger?.warn?.(`[荷花星铁挑战卡] 图片加载失败：${error.message}`)
      return null
    }))
    if (CACHE.size > 128) CACHE.delete(CACHE.keys().next().value)
  }
  return CACHE.get(src)
}

export async function renderStarRailAbyss(data = {}, options = {}) {
  if (!fontsLoaded) {
    const regFont = (name, p) => { try { if (existsSync(p)) FontLibrary.use(name, [p]) } catch {} }
    regFont("MiSans", path.join(resourcesPath, "fonts/MiSans-VF.ttf"))
    fontsLoaded = true
  }

  const scaleValue = Number(options.renderScale ?? data.renderScale ?? process.env.LOTUS_RENDER_SCALE ?? 4)
  const scale = Number.isFinite(scaleValue) ? Math.min(4, Math.max(1, scaleValue)) : 4

  const canvas = new Canvas(W, 10)
  const ctx = canvas.getContext("2d")

  /* ---------- 绘制基元 ---------- */
  // 所有 ctx.font 都经 fstr（与 theme.js 的字重层次同构：MiSans 可变字体用字重建层次）
  const setFont = (size, { weight = 500, italic = false } = {}) => {
    ctx.font = italic ? `italic ${fstr(size, family, weight)}` : fstr(size, family, weight)
  }
  const measure = (value, size, style) => {
    setFont(size, style)
    return ctx.measureText(String(value ?? "")).width
  }
  // 返回实际落笔字号（超宽时按 minSize 收缩）
  function draw(value, x, y, size, color, style = {}) {
    const { width = CONTENT_W, align = "left", minSize = 12, italic = false, baseline = "top" } = style
    let used = size
    let label = String(value ?? "")
    setFont(used, style)
    while (used > minSize && ctx.measureText(label).width > width) {
      used -= 0.5
      setFont(used, style)
    }
    ctx.fillStyle = color
    ctx.textBaseline = baseline
    ctx.textAlign = align
    if (style.shadow) {
      ctx.shadowColor = style.shadow
      ctx.shadowBlur = 6
    }
    ctx.fillText(label, align === "center" ? x + width / 2 : align === "right" ? x + width : x, y)
    ctx.shadowColor = "transparent"
    ctx.shadowBlur = 0
    ctx.textAlign = "left"
    return used
  }
  function rect(x, y, w, h, fill, radius = 0) {
    if (w <= 0 || h <= 0) return
    ctx.fillStyle = fill
    ctx.beginPath()
    if (radius > 0) ctx.roundRect(x, y, w, h, radius)
    else ctx.rect(x, y, w, h)
    ctx.fill()
  }
  function rule(x, y, w, color = C.rule) {
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y + 0.5)
    ctx.lineTo(x + w, y + 0.5)
    ctx.stroke()
  }
  // 八芒星（参考图里金色星与青色尖芒是同一形状，只是大小与颜色不同）
  function star(cx, cy, radius, color, waist = 0.36, glow = 0) {
    ctx.save()
    if (glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = glow
    }
    ctx.fillStyle = color
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 4
      const r = i % 2 === 0 ? radius : radius * waist
      const px = cx + Math.cos(angle) * r
      const py = cy + Math.sin(angle) * r
      if (i) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
    if (glow) {
      ctx.shadowBlur = 0
      ctx.fillStyle = color
      ctx.globalAlpha = 0.35
      ctx.beginPath()
      ctx.arc(cx, cy, radius * 0.22, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
  // 王冠（高亮节点行前缀）
  function crown(cx, cy, w, color) {
    const h = w * 0.66
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(cx - w / 2, cy + h / 2)
    ctx.lineTo(cx - w / 2, cy - h / 2)
    ctx.lineTo(cx - w * 0.24, cy + h * 0.06)
    ctx.lineTo(cx, cy - h / 2)
    ctx.lineTo(cx + w * 0.24, cy + h * 0.06)
    ctx.lineTo(cx + w / 2, cy - h / 2)
    ctx.lineTo(cx + w / 2, cy + h / 2)
    ctx.closePath()
    ctx.fill()
    for (const [ox, oy] of [[-w / 2, -h / 2], [0, -h / 2], [w / 2, -h / 2]]) {
      ctx.beginPath()
      ctx.arc(cx + ox, cy + oy, w * 0.075, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // 卡片底：深紫底 + 径向氛围光 + 顶缘紫光
  function cardBackground(x, y, w, h, glowColor, gx, gy, gr) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, RADIUS)
    ctx.clip()
    rect(x, y, w, h, C.card)
    const rad = ctx.createRadialGradient(x + w * gx, y + h * gy, 0, x + w * gx, y + h * gy, Math.max(w, h) * gr)
    rad.addColorStop(0, glowColor)
    rad.addColorStop(1, "rgba(0,0,0,0)")
    rect(x, y, w, h, rad)
    const rim = ctx.createLinearGradient(0, y, 0, y + 28)
    rim.addColorStop(0, C.cardRim)
    rim.addColorStop(1, "rgba(0,0,0,0)")
    rect(x, y, w, 28, rim)
    ctx.restore()
    ctx.strokeStyle = C.cardLine
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, RADIUS)
    ctx.stroke()
  }

  /* ---------- 布局测量 ---------- */
  const sections = buildStarRailAbyssSections(data)
  if (!sections.length) {
    sections.push({ label: "挑战战绩", floorTitle: "挑战记录", modeSuffix: "", stars: "", maxStars: 3, extra: false, extraStars: 0, round: "", nodes: [] })
  }
  const header = summarize(data, sections)

  const layouts = sections.map(section => {
    const nodes = (section.nodes || []).map((node, index) => ({
      node,
      band: index === 0 ? 0 : node.crowned ? HIGHLIGHT_BAND : NODE_BAND,
      rows: Math.max(1, Math.ceil((node.avatars || []).length / PER_ROW)),
      buffBand: node.buff ? BUFF_BAND : 0,
    }))
    const body = nodes.reduce((sum, item) => sum + item.band + item.rows * AVATAR_H + item.buffBand, 0)
    return {
      section,
      nodes,
      height: SECTION_HEAD_H + (nodes.length ? body : NODE_BAND) + SECTION_PAD_BOTTOM,
    }
  })

  const height = TOP_PAD + HEADER_H
    + layouts.reduce((sum, item) => sum + item.height + CARD_GAP, 0)
    + FOOTER_H

  /* ---------- 预取图片 ---------- */
  const refs = new Set()
  for (const layout of layouts) {
    for (const { node } of layout.nodes) for (const avatar of node.avatars || []) if (avatar.icon) refs.add(avatar.icon)
  }
  const images = new Map()
  await Promise.all([...refs].map(async src => images.set(src, await image(src))))

  /* ---------- 落笔 ---------- */
  // 极端 payload（如把 LOTUS_SR_ABYSS_FLOORS 设成 0 拉满 12 关）会把长图撑到几万像素，
  // 按总像素预算回退倍率，避免编码时间与显存失控。
  const PIXEL_BUDGET = 4.2e7
  let effective = scale
  while (effective > 1 && W * effective * height * effective > PIXEL_BUDGET) effective -= 1
  canvas.width = Math.round(W * effective)
  canvas.height = Math.round(height * effective)
  ctx.scale(effective, effective)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"

  const page = ctx.createLinearGradient(0, 0, 0, height)
  page.addColorStop(0, C.pageTop)
  page.addColorStop(1, C.pageBottom)
  rect(0, 0, W, height, page)

  /* ===== 1. 统计总览卡 ===== */
  cardBackground(SIDE, TOP_PAD, CARD_W, HEADER_H, C.cardGlowHeader, 0.5, 0.06, 0.62)
  draw(hasValue(data.uid) ? `UID: ${data.uid}` : "UID: 未绑定", CONTENT_X, TOP_PAD + 22, 22, C.sub, { width: CONTENT_W, weight: 600 })
  {
    const uidWidth = measure(hasValue(data.uid) ? `UID: ${data.uid}` : "UID: 未绑定", 22, { weight: 600 })
    draw(header.title, CONTENT_X + uidWidth + 12, TOP_PAD + 20, 29, C.white, {
      width: CONTENT_W - uidWidth - 12, weight: 700,
    })
  }
  // 统计行：★×N  |  ✦ 最高关卡  |  ✦
  const H = TOP_PAD
  {
    const bigStar = 50, xMark = 28, numeral = 58, spark = 32, gapStar = 10, gapNum = 8
    const starsText = hasValue(header.stars) ? String(header.stars) : "—"
    const label = "最高关卡："
    const value = header.maxFloor || "—"
    const parts = [
      bigStar, gapStar, measure("×", xMark, { weight: 600 }), gapNum, measure(starsText, numeral, { weight: 700 }),
      30, 1, 30,
      spark, 12, measure(label, 22, { weight: 500 }), 14, measure(value, 23, { weight: 600 }),
      30, 1, 30, spark,
    ]
    const total = parts.reduce((sum, n) => sum + n, 0)
    const k = total > CONTENT_W ? CONTENT_W / total : 1
    const centerY = H + 164
    let x = CONTENT_X
    const step = n => { const last = x; x += n * k; return last }
    // 左：总星数
    star(step(bigStar) + bigStar * k / 2, centerY, bigStar * k / 2, C.goldStar, 0.36, 16)
    step(gapStar)
    draw("×", step(measure("×", xMark, { weight: 600 })), centerY, xMark * k, C.sub, { width: 200, weight: 600, baseline: "middle" })
    step(gapNum)
    {
      const numeralX = step(measure(starsText, numeral, { weight: 700 }))
      draw(starsText, numeralX, centerY, numeral * k, C.goldStar, {
        width: 300, weight: 700, baseline: "middle", shadow: "rgba(251,196,107,.45)",
      })
    }
    // 分隔线
    {
      const sx = step(30) + 30 * k
      rect(sx, centerY - 22, Math.max(1, k), 44, C.sep)
      step(1)
      step(30)
    }
    // 中：最高关卡
    star(step(spark) + spark * k / 2, centerY, spark * k / 2, C.spark, 0.42, 14)
    step(12)
    const labelX = step(measure(label, 22, { weight: 500 }))
    draw(label, labelX, centerY, 22 * k, C.sub, { width: 300, weight: 500, baseline: "middle" })
    step(14)
    const valueX = step(measure(value, 23, { weight: 600 }))
    draw(value, valueX, centerY, 23 * k, C.gold, { width: 400, weight: 600, baseline: "middle" })
    // 右：分隔线 + 尖芒
    {
      const sx = step(30) + 30 * k
      rect(sx, centerY - 22, Math.max(1, k), 44, C.sep)
      step(1)
      step(30)
      star(step(spark) + spark * k / 2, centerY, spark * k / 2, C.spark, 0.42, 14)
    }
    // 第二行：挑战次数（与中间栏标签左对齐）
    const countLabel = "挑战次数："
    const countValue = hasValue(header.battles) ? String(header.battles) : "—"
    draw(countLabel, labelX, centerY + 62, 22 * k, C.sub, { width: 300, weight: 500, baseline: "middle" })
    draw(countValue, labelX + measure(countLabel, 22, { weight: 500 }) + 10 * k, centerY + 62, 30 * k, C.goldStar, {
      width: 200, weight: 700, baseline: "middle",
    })
  }
  rule(CONTENT_X, H + 260, CONTENT_W)
  {
    // 统计周期：整组居中（参考图里 label+value 的中线正好落在卡片中线上）
    const periodLabel = "统计周期："
    const periodValue = header.period || "暂无统计周期"
    const labelSize = 22
    const valueSize = 23
    const labelW = measure(periodLabel, labelSize, { weight: 500 })
    const valueW = measure(periodValue, valueSize, { weight: 600 })
    const totalW = labelW + 12 + valueW
    const k = totalW > CONTENT_W ? CONTENT_W / totalW : 1
    const startX = CONTENT_X + (CONTENT_W - totalW * k) / 2
    draw(periodLabel, startX, H + 272, labelSize * k, C.sub, { width: 200 * k, weight: 500 })
    draw(periodValue, startX + (labelW + 12) * k, H + 271, valueSize * k, C.gold, { width: 500, weight: 600 })
  }

  /* ===== 2. 每期关卡卡 ===== */
  // 角色卡：稀有度底色 + 头像 cover 裁切 + 近黑 Lv 条 + 属性角标 + 命座角标
  function drawAvatar(x, y2, avatar) {
    const faceH = AVATAR_H - LV_H
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y2, AVATAR_W, AVATAR_H, 9)
    ctx.clip()
    const five = Number(avatar.rarity) >= 5
    const face = ctx.createLinearGradient(0, y2, 0, y2 + faceH)
    const faceStops = five ? RARITY_FACE.five : RARITY_FACE.four
    face.addColorStop(0, faceStops[0])
    face.addColorStop(1, faceStops[1])
    rect(x, y2, AVATAR_W, faceH, face)
    const portrait = images.get(avatar.icon)
    if (portrait && portrait.width && portrait.height) {
      const ratio = Math.max(AVATAR_W / portrait.width, faceH / portrait.height)
      const sw = AVATAR_W / ratio
      const sh = faceH / ratio
      ctx.drawImage(portrait, (portrait.width - sw) / 2, 0, sw, sh, x, y2, AVATAR_W, faceH)
    } else {
      draw(avatar.name || "角色资料未记录", x + 8, y2 + faceH / 2, 17, "rgba(255,255,255,.82)", {
        width: AVATAR_W - 16, align: "center", weight: 500, baseline: "middle",
      })
    }
    // Lv 条：近黑底 + 白色斜体等级（MiSans 没有真正的斜体字面，用 shear 变换模拟参考图的倾斜数字）
    rect(x, y2 + faceH, AVATAR_W, LV_H, C.strip)
    rule(x, y2 + faceH, AVATAR_W, C.stripLine)
    {
      const lvText = hasValue(avatar.level) ? `Lv.${avatar.level}` : "Lv.—"
      const pivotX = x + AVATAR_W / 2
      const pivotY = y2 + faceH + LV_H / 2
      ctx.save()
      ctx.translate(pivotX, pivotY)
      ctx.transform(1, 0, -0.16, 1, 0, 0)
      draw(lvText, -AVATAR_W / 2, 0, 16, C.ink, {
        width: AVATAR_W, align: "center", weight: 700, baseline: "middle",
      })
      ctx.restore()
    }
    ctx.restore()
    // 属性角标（左上）
    const discR = 15
    const cx = x + 8 + discR
    const cy = y2 + 8 + discR
    const tint = elementTint(avatar.element)
    ctx.save()
    ctx.fillStyle = "rgba(14,10,20,.55)"
    ctx.beginPath()
    ctx.arc(cx, cy, discR, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = tint || "rgba(255,255,255,.22)"
    ctx.lineWidth = 1.5
    if (tint) {
      ctx.shadowColor = tint
      ctx.shadowBlur = 8
    }
    ctx.stroke()
    ctx.restore()
    if (tint) star(cx, cy, discR * 0.46, tint, 0.40, 0)
    // 命座角标（右上）
    if (Number(avatar.rank) > 0) {
      const bw = 32
      const bx = x + AVATAR_W - bw - 6
      rect(bx, y2 + 6, bw, bw, "rgba(14,10,20,.58)", 8)
      draw(String(avatar.rank), bx, y2 + 6 + bw / 2, 22, C.white, {
        width: bw, align: "center", weight: 700, baseline: "middle",
      })
    }
  }

  let cursor = TOP_PAD + HEADER_H + CARD_GAP
  for (const layout of layouts) {
    const { section } = layout
    const cardY = cursor
    cardBackground(SIDE, cardY, CARD_W, layout.height, C.cardGlowSection, 0.18, 0.06, 0.85)

    // 关卡名（+ 星启模式）
    const starSize = 30, starGap = 19
    const sparkSize = 32
    const starCount = 3
    let starsW = starCount * starSize + (starCount - 1) * starGap
    if (section.extra) starsW += 24 + 1 + 24 + sparkSize
    const titleText = `${section.floorTitle}${section.modeSuffix}`
    draw(titleText, CONTENT_X, cardY + 18, 28, C.white, {
      width: CONTENT_W - starsW - 24, weight: 700, minSize: 17,
    })
    {
      // 星级：实得金色，未得暗金；星启模式追加「| ✦」
      const earned = Math.max(0, Math.min(starCount, Number(section.stars) || 0))
      let sx = CONTENT_X + CONTENT_W - starsW
      for (let i = 0; i < starCount; i++) {
        star(sx + starSize / 2, cardY + 33, starSize / 2, i < earned ? C.goldStar : "rgba(251,196,107,.20)", 0.36, i < earned ? 10 : 0)
        sx += starSize + starGap
      }
      if (section.extra) {
        sx += 24
        rect(sx, cardY + 15, 1, 36, C.sep)
        sx += 25
        const lit = section.extraStars > 0
        star(sx + sparkSize / 2, cardY + 33, sparkSize / 2, lit ? C.spark : "rgba(223,240,255,.22)", 0.42, lit ? 14 : 0)
      }
    }
    // 使用轮次 + 挑战分数 + 节点N + 时间戳
    draw(`使用轮次：${valueOr(section.round)}`, CONTENT_X, cardY + 55, 20, C.sub, { width: CONTENT_W, weight: 500 })
    if (hasValue(section.score) && Number(section.score) > 0) {
      // 本文件 draw() 语义：align:"right" 的右缘 = x + width（非 canvas 原生），x 须传「右缘 - width」
      const scoreW = Math.min(CONTENT_W * 0.55, 320)
      const scoreText = `挑战分数：${Number(section.score).toLocaleString("zh-CN")}`
      draw(scoreText, CONTENT_X + CONTENT_W - scoreW, cardY + 55, 20, C.goldStar, {
        width: scoreW, align: "right", weight: 600, minSize: 15,
      })
    }

    let y = cardY + SECTION_HEAD_H
    if (!layout.nodes.length) {
      draw("暂无可展示的挑战记录", CONTENT_X, y + 18, 21, C.dim, { width: CONTENT_W, align: "center" })
      cursor += layout.height + CARD_GAP
      continue
    }
    for (const [index, item] of layout.nodes.entries()) {
      const { node } = item
      if (index === 0) {
        // 第一期节点标签落在区块头的呼吸位里（参考图 y = 卡片顶 + 79…102）
        const mid = cardY + 91
        draw(node.label, CONTENT_X, mid, 24, C.white, { width: 300, weight: 700, baseline: "middle" })
        draw(node.time, CONTENT_X + CONTENT_W - 320, mid, 21, C.sub, { width: 320, align: "right", weight: 500, baseline: "middle" })
      } else {
        y += item.band
        const top = y - item.band
        const mid = node.crowned ? top + item.band / 2 : top + 28
        if (node.crowned) {
          // 王冠高亮行：暖粉 → 紫蓝的横向渐变带（参考图里只有「击败首领」的那个节点带王冠）
          const bandX = CONTENT_X - 8
          const bandW = CONTENT_W + 16
          const bandY = top + 6
          const bandH = item.band - 10
          ctx.save()
          ctx.beginPath()
          ctx.roundRect(bandX, bandY, bandW, bandH, 10)
          ctx.clip()
          const grad = ctx.createLinearGradient(bandX, 0, bandX + bandW, 0)
          grad.addColorStop(0, "rgba(228,174,170,.68)")
          grad.addColorStop(0.14, "rgba(168,110,166,.54)")
          grad.addColorStop(0.40, "rgba(84,56,150,.42)")
          grad.addColorStop(0.62, "rgba(46,36,96,.20)")
          grad.addColorStop(1, "rgba(31,25,38,0)")
          rect(bandX, bandY, bandW, bandH, grad)
          ctx.restore()
          crown(bandX + 27, bandY + bandH / 2, 26, "#F7EAE6")
          draw(node.label, bandX + 50, mid, 24, C.white, { width: 300, weight: 700, baseline: "middle" })
        } else {
          draw(node.label, CONTENT_X, mid, 24, C.white, { width: 300, weight: 700, baseline: "middle" })
        }
        draw(node.time, CONTENT_X + CONTENT_W - 320, mid, 21, node.crowned ? C.white : C.sub, {
          width: 320, align: "right", weight: 500, baseline: "middle",
        })
      }
      // 角色卡
      const avatars = node.avatars || []
      for (const [i, avatar] of avatars.entries()) {
        const ax = CONTENT_X + (i % PER_ROW) * (AVATAR_W + AVATAR_GAP)
        const ay = y + Math.floor(i / PER_ROW) * (AVATAR_H + AVATAR_GAP)
        drawAvatar(ax, ay, avatar)
      }
      y += item.rows * AVATAR_H + (item.rows - 1) * AVATAR_GAP
      // 节点增益（荷花补全：混沌/虚构/末日的节点 buff，上游数据有、参考图版式没画）
      if (node.buff) {
        draw(node.buff, CONTENT_X, y + 6, 19, C.dim, { width: CONTENT_W, weight: 500, minSize: 13 })
        y += item.buffBand
      }
    }
    cursor += layout.height + CARD_GAP
  }

  /* ===== 3. 页脚署名 ===== */
  rule(SIDE, height - FOOTER_H + 22, CARD_W, C.rule)
  draw(CREDIT, SIDE, height - FOOTER_H + 46, 20, C.footer, { width: CARD_W, align: "center", weight: 500, italic: true })
  draw(data.demo ? "星铁挑战战绩模板 · Rozaki Arina 版式适配样稿" : (data.generatedAt || ""), SIDE, height - FOOTER_H + 76, 14, C.footerDim, {
    width: CARD_W, align: "center", weight: 500,
  })

  const { buffer, tiles, format } = await encodeGpuCanvas(canvas, options)
  options.onRender?.({
    gpu: canvas.gpu,
    ...canvas.engine,
    width: canvas.width,
    height: canvas.height,
    tiles,
    format,
    missingImages: [...images].filter(([, img]) => !img).map(([src]) => src),
  })
  return buffer
}
