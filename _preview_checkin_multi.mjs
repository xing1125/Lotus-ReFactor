// 预览：签到结果卡改造 —— ① 成功卡去掉底部长 messageBlock；② 多账号合并为一张卡（sections 小节）
import { renderWithSkia } from "./core/render/skia.js"
import path from "node:path"

const rowsOk = [
  { label: "原神", game: "成功", community: "成功", days: "12天" },
  { label: "星铁", game: "成功", community: "成功", days: "8天" },
  { label: "绝区零", game: "成功", community: "成功", days: "5天" },
  { label: "崩坏3", game: "关闭", community: "关闭", days: "-" },
  { label: "社区", game: "无", community: "成功", days: "-" },
]

const rowsPartial = [
  { label: "原神", game: "成功", community: "失败", days: "3天" },
  { label: "星铁", game: "关闭", community: "关闭", days: "-" },
  { label: "社区", game: "无", community: "关闭", days: "-" },
]

const cases = [
  // 单账号成功卡：不应再有底部 messageBlock
  ["checkin-result", {
    title: "旅行者",
    subtitle: "profile 1",
    badge: "成功",
    userId: "10001",
    games: rowsOk,
  }, "preview/checkin-single.png"],
  // 多账号合并卡：两个小节（一个成功带表、一个未登录带备注）
  ["checkin-result", {
    title: "旅行者",
    subtitle: "3 个账号",
    badge: "部分失败",
    userId: "10001",
    sections: [
      { label: "账号 1 · 旅行者", badge: "成功", games: rowsOk },
      { label: "账号 2", badge: "失败", games: rowsPartial },
      { label: "账号 3", badge: "未执行", games: [], note: "尚未登录，请先使用 #扫码登录。" },
    ],
  }, "preview/checkin-multi.png"],
]

let pass = 0, fail = 0
for (const [template, data, out] of cases) {
  try {
    await renderWithSkia(template, data, { path: path.resolve(out), renderScale: 1 })
    console.log(`OK    ${out}`)
    pass++
  } catch (e) {
    console.error(`FAIL  ${out}: ${e.stack || e.message}`)
    fail++
  }
}
console.log(`\n通过 ${pass}/${pass + fail}`)
