// 量化「对比是否够强」：统计全图明度分布（min/max/跨度/标准差）
// 跨度小 = 明度全挤在一起 = 「形不成强烈对比」
import { Canvas, loadImage } from "skia-canvas"
import path from "node:path"

const files = process.argv.slice(2)
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

for (const f of files) {
  const img = await loadImage(path.resolve(f))
  const c = new Canvas(img.width, img.height)
  const ctx = c.getContext("2d")
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data
  const hist = new Array(16).fill(0)
  let n = 0, sum = 0, sum2 = 0, min = 255, max = 0
  for (let i = 0; i < d.length; i += 4 * 29) {
    const L = lum(d[i], d[i + 1], d[i + 2])
    n++; sum += L; sum2 += L * L
    if (L < min) min = L
    if (L > max) max = L
    hist[Math.min(15, Math.floor(L / 16))]++
  }
  const mean = sum / n, sd = Math.sqrt(sum2 / n - mean * mean)
  const bar = hist.map(h => "▁▂▃▄▅▆▇█"[Math.min(7, Math.floor(h / n * 8 * 8))]).join("")
  console.log(`${path.basename(f).padEnd(24)} 明度跨度=${(max - min).toFixed(0).padStart(3)}  均值=${mean.toFixed(0).padStart(3)}  σ=${sd.toFixed(1).padStart(4)}  min=${min.toFixed(0).padStart(3)} max=${max.toFixed(0).padStart(3)}`)
  console.log(`  分布 ${bar}`)
}
