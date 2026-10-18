// 取色 / 边界探针：node _probe_px.mjs <src> [scan-x|scan-y]
import { loadImage } from "skia-canvas"

const src = process.argv[2]
const mode = process.argv[3] || ""
const img = await loadImage(src)
const canvas = new (await import("skia-canvas")).Canvas(img.width, img.height)
const ctx = canvas.getContext("2d")
ctx.drawImage(img, 0, 0)
const { data } = ctx.getImageData(0, 0, img.width, img.height)
const at = (x, y) => {
  const i = (y * img.width + x) * 4
  return [data[i], data[i + 1], data[i + 2]]
}
const hex = ([r, g, b]) => `#${[r ?? 0, g ?? 0, b ?? 0].map(v => v.toString(16).padStart(2, "0")).join("")}`
const diff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))

console.log(`image ${img.width}x${img.height}`)
if (process.argv[4] && process.argv[4].includes(",")) {
  for (const pair of process.argv[4].split(";")) {
    const [x, y] = pair.split(",").map(Number)
    console.log(`  (${x},${y}) = ${hex(at(x, y))}  rgb(${at(x, y).join(",")})`)
  }
}
if (mode === "scan-y") {
  const x = Number(process.argv[5] || Math.floor(img.width / 2))
  console.log(`vertical scan x=${x}`)
  let prev = at(x, 0)
  for (let y = 1; y < img.height; y++) {
    const cur = at(x, y)
    if (diff(prev, cur) > 12) console.log(`  y=${y}  ${hex(prev)} -> ${hex(cur)}`)
    prev = cur
  }
}
if (mode === "scan-x") {
  const y = Number(process.argv[5] || Math.floor(img.height / 2))
  console.log(`horizontal scan y=${y}`)
  let prev = at(0, y)
  for (let x = 1; x < img.width; x++) {
    const cur = at(x, y)
    if (diff(prev, cur) > 12) console.log(`  x=${x}  ${hex(prev)} -> ${hex(cur)}`)
    prev = cur
  }
}
