// 主题走查：同一批数据在 dark / glass / light 三套调色板下的渲染对比
// 用法：LOTUS_THEME=glass node _preview_theme.mjs   → preview/theme-glass-*.png
import { renderWithSkia } from "./core/render/skia.js"
import path from "node:path"

const theme = (process.env.LOTUS_THEME || "dark").toLowerCase()
const outDir = path.resolve("preview")

const games = (ok) => ([
  { label: "原神", game: ok ? "成功" : "失败", community: ok ? "成功" : "失败", days: "12天" },
  { label: "星铁", game: ok ? "成功" : "失败", community: ok ? "成功" : "失败", days: "12天" },
  { label: "绝区零", game: ok ? "成功" : "待执行", community: ok ? "成功" : "待执行", days: "5天" },
  { label: "社区", game: "", community: ok ? "成功" : "失败", days: "" },
])

const cases = [
  {
    template: "checkin-stats", file: "stats",
    data: {
      title: "实时签到看板", subtitle: "2026-10-16 · 跨群汇总",
      summary: [
        { label: "部署群数", value: "3 人" }, { label: "已部署", value: "31 人" }, { label: "今日已签", value: "28 人" },
        { label: "成功", value: "27 人" }, { label: "失败", value: "2 人" }, { label: "待签", value: "3 人" },
      ],
      groups: [
        {
          groupId: "806338006", total: 12, ok: 11, fail: 1, pending: 0, done: 12, rate: "92%",
          members: [
            { name: "旅人", status: "ok", time: "08:12", games: games(true) },
            { name: "小七", status: "ok", time: "08:15", games: games(true) },
            { name: "阿澈", status: "fail", time: "08:20", games: games(false) },
            { name: "星野", status: "pending", time: "", games: [] },
          ],
        },
      ],
    },
  },
  {
    template: "status", file: "status",
    data: {
      title: "全员二次签到", subtitle: "旅人 · 跨群生效", badge: "29/31",
      message: "已为 31 个已扫码 profile 拉起二次签到（成功 29 / 失败 2）。当前「全局静默」模式：未向各用户推送结果卡，仅此汇总发给你（管理员）。",
      items: [
        { label: "操作范围", value: "全体已扫码用户（跨群）" },
        { label: "补签 profile 数", value: "31" }, { label: "成功", value: "29" }, { label: "失败", value: "2" },
        { label: "旅人 · P1", value: "成功" }, { label: "小七 · P1", value: "成功" },
        { label: "阿澈 · P1", value: "失败：cookie 已失效，请重新扫码登录" },
        { label: "更多", value: "另有 24 个 profile" },
      ],
    },
  },
]

for (const c of cases) {
  const out = path.join(outDir, `theme-${theme}-${c.file}.png`)
  try {
    await renderWithSkia(c.template, c.data, { path: out, renderScale: 2 })
    console.log(`OK  theme-${theme}-${c.file} (${c.template})`)
  } catch (e) {
    console.error(`FAIL theme-${theme}-${c.file}:`, e.message)
  }
}
