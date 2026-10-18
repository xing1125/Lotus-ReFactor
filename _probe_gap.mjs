// 找角色卡之间的暗缝：node _probe_gap.mjs <src> x,y1,y2,... [thr]
// 横向：node _probe_gap.mjs <src> y1,y2,... [thr]
// 纵向：node _probe_gap.mjs <src> x:<x1>,<x2> [thr]
import { Canvas, loadImage } from "skia-canvas"

const img = await loadImage(process.argv[2])
const canvas = new Canvas(img.width, img.height)
const ctx = canvas.getContext("2d")
ctx.drawImage(img, 0, 0)
const { data } = ctx.getImageData(0, 0, img.width, img.height)
const lum = (x, y) => {
  const i = (y * img.width + x) * 4
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
}
const thr = Number(process.argv[4] || 34)
const spec = process.argv[3]
const runs = value => {
  const out = []
  let start = -1
  for (let i = 0; i < value.length; i++) {
    const dark = value[i]
    if (dark && start < 0) start = i
    if (!dark && start >= 0) { if (i - start >= 2) out.push(`${start}..${i - 1}`); start = -1 }
  }
  if (start >= 0) out.push(`${start}..${value.length - 1}`)
  return out.join("  ")
}
if (/^x:/.test(spec)) {
  for (const x of spec.slice(2).split(",").map(Number)) {
    const col = []
    for (let y = 0; y < img.height; y++) col.push(lum(x, y) < thr)
    console.log(`x=${x}  dark runs: ${runs(col)}`)
  }
} else {
  for (const y of spec.split(",").map(Number)) {
    const row = []
    for (let x = 0; x < img.width; x++) row.push(lum(x, y) < thr)
    console.log(`y=${y}  dark runs: ${runs(row)}`)
  }
}
