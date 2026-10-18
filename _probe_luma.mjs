// 采样各版本渲染图的像素明度，客观判断「压抑」程度
import { loadImage } from "skia-canvas"
import path from "node:path"

const files = process.argv.slice(2)
const lum = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)

for (const f of files) {
  const img = await loadImage(path.resolve(f))
  const canvas = new (await import("skia-canvas")).Canvas(img.width, img.height)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(img, 0, 0)
  const pts = {
    "背景角落": [4, 4],
    "标题栏": [Math.round(img.width * 0.5), Math.round(img.height * 0.045)],
    "磁贴面": [Math.round(img.width * 0.25), Math.round(img.height * 0.235)],
    "群卡面": [Math.round(img.width * 0.5), Math.round(img.height * 0.52)],
  }
  const out = []
  let sum = 0, n = 0
  for (const [name, [x, y]] of Object.entries(pts)) {
    const d = ctx.getImageData(x, y, 1, 1).data
    out.push(`${name}=${lum(d[0], d[1], d[2])}`)
  }
  // 全图平均明度
  const all = ctx.getImageData(0, 0, img.width, img.height).data
  for (let i = 0; i < all.length; i += 4 * 37) { sum += lum(all[i], all[i + 1], all[i + 2]); n++ }
  console.log(`${path.basename(f).padEnd(26)} 平均明度=${String(Math.round(sum / n)).padStart(3)}  ${out.join("  ")}`)
}
