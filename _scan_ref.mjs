// 参考图结构扫描：沿若干水平线找「近似同色段」的起止 x 与均值色，用于精确量版式
// 用法：node _scan_ref.mjs <img> <y1,y2,...> [tol]
import { loadImage, Canvas } from "skia-canvas"
const src = process.argv[2]
const ys = String(process.argv[3] || "").split(",").filter(Boolean).map(Number)
const tol = Number(process.argv[4] || 26)
const hex = d => "#" + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, "0")).join("")
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
;(async () => {
  const img = await loadImage(src)
  const c = new Canvas(img.width, img.height), x = c.getContext("2d")
  x.drawImage(img, 0, 0)
  const W = img.width
  for (const y of ys) {
    const d = x.getImageData(0, y, W, 1).data
    const runs = []
    let s = 0, sum = [d[0], d[1], d[2]], n = 1
    const push = (e) => runs.push({ x0: s, x1: e, w: e - s + 1, c: hex(sum.map(v => Math.round(v / n))) })
    for (let i = 1; i < W; i++) {
      const p = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]
      if (dist(p, sum.map(v => v / n)) > tol) { push(i - 1); s = i; sum = [0, 0, 0]; n = 0 }
      sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++
    }
    push(W - 1)
    const big = runs.filter(r => r.w >= 6)
    console.log(`y=${y}  W=${W}  →  ` + big.map(r => `${r.x0}-${r.x1}(${r.w})${r.c}`).join("  "))
  }
})()
