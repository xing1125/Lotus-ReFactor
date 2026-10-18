import { Canvas, FontLibrary } from 'skia-canvas'
import path from 'node:path'

const rp = path.resolve('resources')
FontLibrary.use('MiSans', [path.join(rp, 'fonts/MiSans-VF.ttf')])

const c = new Canvas(600, 400)
const ctx = c.getContext('2d')

console.log('=== measureText width by weight (CSS shorthand) ===')
for (const w of [300, 400, 500, 600, 700, 900]) {
  ctx.font = `${w} 40px MiSans`
  console.log(`weight ${w}: width=${ctx.measureText('荷花插件 123456').width.toFixed(2)}  font="${ctx.font}"`)
}

console.log('\n=== families registered ===')
try { console.log(FontLibrary.families.filter(f => /MiSans|Source/i.test(f))) } catch (e) { console.log('no families api:', e.message) }

// render a strip to visually compare weights
const strip = new Canvas(600, 260)
const s = strip.getContext('2d')
s.fillStyle = '#ffffff'; s.fillRect(0, 0, 600, 260)
s.fillStyle = '#0F172A'
let y = 34
for (const w of [300, 400, 500, 600, 700, 900]) {
  s.font = `${w} 30px MiSans`
  s.fillText(`${w}  荷花插件签到 Lv.60`, 12, y)
  y += 40
}
await strip.saveAs(path.resolve('preview/_font_weights.png'))
console.log('\nsaved preview/_font_weights.png')
