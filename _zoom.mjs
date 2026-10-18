// 放大裁切：node _zoom.mjs <src> <x> <y> <w> <h> <out> <scale>
// 与 _crop.mjs 的区别：region 是**源图像素**坐标（自动夹到图像边界，避免越界出白图），scale 单纯放大输出尺寸
import { Canvas, loadImage } from "skia-canvas"
import fs from "node:fs/promises"

const [, , src, xs, ys, ws, hs, out, ss] = process.argv
const [scale] = [ss].map(Number)
const img = await loadImage(src)
const x = Math.max(0, Math.min(img.width - 1, Math.round(Number(xs))))
const y = Math.max(0, Math.min(img.height - 1, Math.round(Number(ys))))
const w = Math.max(1, Math.min(img.width - x, Math.round(Number(ws))))
const h = Math.max(1, Math.min(img.height - y, Math.round(Number(hs))))
const canvas = new Canvas(Math.round(w * scale), Math.round(h * scale))
const ctx = canvas.getContext("2d")
ctx.imageSmoothingEnabled = true
ctx.imageSmoothingQuality = "high"
ctx.drawImage(img, x, y, w, h, 0, 0, w * scale, h * scale)
await fs.writeFile(out, await canvas.png)
console.log(`OK ${out}  src=${img.width}x${img.height}  region(${x},${y},${w},${h}) x${scale}`)
