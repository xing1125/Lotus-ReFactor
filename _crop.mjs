// 局部放大工具：node _crop.mjs <src> <x> <y> <w> <h> <out> [zoom]
import { Canvas, loadImage } from "skia-canvas"
import fs from "node:fs/promises"

const [, , src, xs, ys, ws, hs, out, zs] = process.argv
const [x, y, w, h, zoom] = [xs, ys, ws, hs, zs].map(Number)

const img = await loadImage(src)
const canvas = new Canvas(Math.round(w * zoom), Math.round(h * zoom))
const ctx = canvas.getContext("2d")
ctx.imageSmoothingEnabled = true
ctx.imageSmoothingQuality = "high"
ctx.drawImage(img, x * zoom, y * zoom, w * zoom, h * zoom, 0, 0, w * zoom, h * zoom)
await fs.writeFile(out, await canvas.png)
console.log(`OK ${out}  ${src} @(${x},${y},${w},${h}) x${zoom}`)
