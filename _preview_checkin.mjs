// 签到相关 5 张卡片的预览基准（before/after 对比用）
// 用法：node _preview_checkin.mjs            → 输出到 preview/checkin-*.png
//       node _preview_checkin.mjs before      → 输出到 preview/before-*.png
import { renderWithSkia } from "./core/render/skia.js"
import path from "node:path"

const tag = process.argv[2] || ""
const prefix = tag ? `${tag}-` : "after-"
const outDir = path.resolve("preview")

const g = (game, community, days) => ({ label: "", game, community, days })
const games = (ok) => ([
  { label: "原神", game: ok ? "成功" : "失败", community: ok ? "成功" : "失败", days: "12天" },
  { label: "崩坏3", game: ok ? "成功" : "失败", community: ok ? "成功" : "失败", days: "12天" },
  { label: "星铁", game: ok ? "成功" : "失败", community: ok ? "成功" : "失败", days: "12天" },
  { label: "绝区零", game: ok ? "成功" : "待执行", community: ok ? "成功" : "待执行", days: "5天" },
  { label: "未定事件簿", game: ok ? "成功" : "未执行", community: ok ? "成功" : "未执行", days: "-" },
  { label: "崩坏2", game: ok ? "成功" : "未执行", community: ok ? "成功" : "未执行", days: "-" },
  { label: "大别野", game: "无", community: ok ? "成功" : "关闭", days: "-" },
  { label: "因缘精灵", game: ok ? "成功" : "未执行", community: ok ? "成功" : "未执行", days: "5天" },
  { label: "社区", game: "", community: ok ? "成功" : "失败", days: "" },
])

const cases = [
  {
    template: "checkin-stats", file: "stats",
    data: {
      title: "实时签到看板", subtitle: "2026-10-16 · 跨群汇总",
      summary: [
        { label: "部署群", value: "3" }, { label: "已部署成员", value: "31" }, { label: "今日已签", value: "28" },
        { label: "成功", value: "27" }, { label: "失败", value: "2" }, { label: "待签", value: "3" },
      ],
      groups: [
        {
          groupId: "806338006", total: 12, ok: 11, fail: 1, pending: 0, done: 12, rate: "92%",
          members: [
            { name: "旅人", status: "ok", time: "08:12", games: games(true) },
            { name: "小七", status: "ok", time: "08:15", games: games(true) },
            { name: "阿澈", status: "fail", time: "08:20", games: games(false) },
            { name: "柚子", status: "ok", time: "08:24", games: games(true) },
            { name: "星野", status: "pending", time: "", games: [] },
          ],
        },
        {
          groupId: "112233445", total: 9, ok: 8, fail: 1, pending: 1, done: 9, rate: "89%",
          members: [
            { name: "木木", status: "ok", time: "08:31", games: games(true) },
            { name: "凉凉", status: "ok", time: "08:36", games: games(true) },
            { name: "橙子", status: "fail", time: "08:40", games: games(false) },
            { name: "十六", status: "pending", time: "", games: [] },
          ],
        },
      ],
    },
  },
  {
    template: "checkin-result", file: "result",
    data: {
      title: "每日自动签到", subtitle: "2026-10-16", badge: "成功",
      account: "每日自动签到", description: "今日全部账号签到成功。", nickname: "旅人",
      games: games(true), message: "原神 / 崩坏3 / 星穹铁道 / 绝区零 已完成；未定事件簿、崩坏2、因缘精灵未开启。",
    },
  },
  {
    template: "status", file: "status",
    data: {
      title: "全员二次签到", subtitle: "旅人 · 跨群生效", badge: "29/31",
      message: "已为 31 个已扫码 profile 拉起二次签到（成功 29 / 失败 2）。当前「全局静默」模式：未向各用户推送结果卡，仅此汇总发给你（管理员）。社区签到（米游社）已包含在此次批量中。",
      items: [
        { label: "操作范围", value: "全体已扫码用户（跨群）" },
        { label: "补签 profile 数", value: "31" }, { label: "成功", value: "29" }, { label: "失败", value: "2" },
        { label: "旅人 · P1", value: "成功" }, { label: "小七 · P1", value: "成功" },
        { label: "阿澈 · P1", value: "失败：cookie 已失效，请重新扫码登录" },
        { label: "柚子 · P1", value: "成功" }, { label: "星野 · P1", value: "成功" },
        { label: "更多", value: "另有 24 个 profile" },
      ],
    },
  },
  {
    template: "schedule-notice", file: "notice",
    data: {
      title: "旅人", subtitle: "2026-10-17 · profile 1", badge: "08:30",
      message: "明天将按计划为你自动签到（原神 / 星铁 / 绝区零 + 米游社社区）。如需调整，发送 #我的签到时间 查看，或 #签到固定模式 HH:MM 修改。",
      items: [{ label: "签到时间", value: "08:30" }, { label: "签到模式", value: "固定" }, { label: "群号", value: "806338006" }],
    },
  },
  {
    template: "weibo-checkin", file: "weibo",
    data: {
      title: "微博超话签到", subtitle: "旅人",
      result: { signed: 6, skipped: 2, failed: 1, total: 9 },
      message: "已完成 6 个超话签到，2 个今日已签、1 个失败（超话限制或 cookie 过期）。",
    },
  },
]

for (const c of cases) {
  const out = path.join(outDir, `${prefix}${c.file}.png`)
  try {
    await renderWithSkia(c.template, c.data, { path: out, renderScale: 2 })
    console.log(`OK  ${prefix}${c.file} (${c.template})`)
  } catch (e) {
    console.error(`FAIL ${prefix}${c.file}:`, e.message)
  }
}
