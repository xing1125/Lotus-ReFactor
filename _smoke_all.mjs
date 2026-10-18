// 全模板冒烟测试：验证统一调色板改造后，每个模板都能无异常渲染
// 数据刻意给最小集 —— 目的是抓 ReferenceError / undefined 崩溃，不是校验排版
import { renderWithSkia } from "./core/render/skia.js"
import path from "node:path"

const cases = [
  ["qr-login", { title: "扫码登录", subtitle: "profile 1", qrCode: "", notice: "使用手机微信扫码" }],
  ["donate", { title: "赏赞", message: "感谢支持", methods: [] }],
  ["genshin-team-damage", { title: "队伍伤害", members: [] }],
  ["starrail-team-damage", { title: "队伍伤害", members: [], badge: "SR" }],
  ["achievement-index", { title: "成就", groups: [] }],
  ["achievement-category", { title: "成就分类", rows: [] }],
  ["zzz-rank", { title: "排行榜", rows: [] }],
  ["douyin-info", { title: "作品信息", desc: "测试" }],
  ["bilibili-info", { title: "作品信息", desc: "测试" }],
  ["atlas-result", { rows: [], message: "没有找到图鉴结果。" }],
]

let pass = 0, fail = 0
for (const [template, data] of cases) {
  try {
    await renderWithSkia(template, data, { path: path.resolve(`preview/smoke-${template}.png`), renderScale: 1 })
    console.log(`OK    ${template}`)
    pass++
  } catch (e) {
    console.error(`FAIL  ${template}: ${e.message}`)
    fail++
  }
}
console.log(`\n通过 ${pass}/${pass + fail}`)
