import { Canvas, loadImage } from "skia-canvas"
import path from "node:path"
const [, , file, ...pts] = process.argv
const img = await loadImage(path.resolve(file))
const c = new Canvas(img.width, img.height); const ctx = c.getContext("2d")
ctx.drawImage(img, 0, 0)
console.log(`尺寸 ${img.width}x${img.height}`)
for (const p of pts) {
  const [x, y] = p.split(",").map(Number)
  const d = ctx.getImageData(x, y, 1, 1).data
  console.log(`  (${String(x).padStart(4)},${String(y).padStart(4)})  rgb(${d[0]},${d[1]},${d[2]})`)
}
