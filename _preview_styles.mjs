// 候选版式对比：同一份数据，渲染 text / bar / minimal 三种成员区风格
// 用法：LOTUS_THEME=mist node _preview_styles.mjs
import { renderWithSkia } from "./core/render/skia.js"
import path from "node:path"

const games = (ok, shut) => ([
  { label: "原神", game: shut ? "关闭" : ok ? "成功" : "失败", community: ok ? "成功" : "失败", days: "12" },
  { label: "星铁", game: ok ? "成功" : "失败", community: ok ? "成功" : "失败", days: "8" },
  { label: "绝区零", game: ok ? "成功" : "待执行", community: ok ? "成功" : "待执行", days: "5" },
  { label: "社区", game: "", community: ok ? "成功" : "失败", days: "" },
])

const data = {
  title: "实时签到看板",
  subtitle: "2026-10-16 · 跨群汇总",
  summary: [
    { label: "部署群", value: "3" },
    { label: "已部署成员", value: "31" },
    { label: "今日已签", value: "28" },
    { label: "成功", value: "27" },
    { label: "失败", value: "2" },
    { label: "待签", value: "3" },
  ],
  groups: [
    {
      groupId: "806338006", total: 12, ok: 11, fail: 1, pending: 0, done: 12, rate: "92%",
      members: [
        { name: "旅人", status: "ok", time: "08:12", games: games(true) },
        { name: "小七", status: "ok", time: "08:15", games: games(true, true) },
        { name: "阿澈", status: "fail", time: "08:20", games: games(false) },
        { name: "柚子", status: "ok", time: "08:24", games: games(true) },
        { name: "星野", status: "pending", time: "", games: [] },
      ],
    },
    {
      groupId: "112233445", total: 9, ok: 8, fail: 1, pending: 0, done: 9, rate: "89%",
      members: [
        { name: "木木", status: "ok", time: "08:31", games: games(true) },
        { name: "凉凉", status: "ok", time: "08:36", games: games(true) },
        { name: "橙子", status: "fail", time: "08:40", games: games(false) },
      ],
    },
  ],
}

const styles = ["text", "bar", "minimal"]
for (const s of styles) {
  process.env.LOTUS_ROW_STYLE = s
  const out = path.resolve(`preview/style-${s}.png`)
  try {
    await renderWithSkia("checkin-stats", data, { path: out, renderScale: 2 })
    console.log(`OK  ${s} -> ${out}`)
  } catch (e) {
    console.error(`FAIL ${s}:`, e.message)
  }
}
