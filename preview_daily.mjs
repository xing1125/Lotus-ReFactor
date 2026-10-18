// 体力面板预览（ji-plugin dailyNote 版式复刻）：走真实数据映射链路
// 用法：node preview_daily.mjs
globalThis.plugin = globalThis.plugin || class Plugin { constructor() {} }
globalThis.logger = globalThis.logger || { warn() {}, debug() {}, info() {}, mark() {}, error() {} }

const { buildDailyNoteRenderData } = await import("./apps/dailyNote.js")
const { renderWithSkia } = await import("./core/render/skia.js")
const { Canvas } = await import("skia-canvas")
const path = (await import("node:path")).default

// 假派遣头像（真实环境用米游社 CDN 的 avatar_side_icon）
const outDir = path.resolve("preview")
const exps = []
for (const [i, [color, label]] of [["#7f8fd8", "A"], ["#c96f6f", "B"], ["#8fa8d8", "C"], ["#6fb8b0", "D"]].entries()) {
  const canvas = new Canvas(120, 120)
  const ctx = canvas.getContext("2d")
  const g = ctx.createLinearGradient(0, 0, 0, 120)
  g.addColorStop(0, color); g.addColorStop(1, "#eef2f8")
  ctx.fillStyle = g; ctx.fillRect(0, 0, 120, 120)
  ctx.fillStyle = "rgba(30,41,59,.85)"; ctx.font = "700 54px MiSans"; ctx.textAlign = "center"
  ctx.fillText(label, 60, 84)
  const file = path.join(outDir, `_exp-${i}.png`)
  await canvas.toFile(file)
  exps.push(file)
}

// 米游社 dailyNote 原始返回（字段名与 upstream 一致）
const results = [
  {
    ok: true, profileId: 1, game: "gs", uid: "100234567",
    data: {
      current_resin: 142, max_resin: 160, resin_recovery_time: 4200,
      current_home_coin: 1920, max_home_coin: 2400,
      finished_task_num: 2, total_task_num: 4, is_extra_task_reward_received: false,
      current_expedition_num: 3, max_expedition_num: 5, has_signed: true,
      expeditions: [
        { status: "Ongoing", avatar_side_icon: exps[0] },
        { status: "Ongoing", avatar_side_icon: exps[1] },
        { status: "Finished", avatar_side_icon: exps[2] },
        { status: "Ongoing", avatar_side_icon: exps[3] },
      ],
    },
  },
  {
    ok: true, profileId: 1, game: "sr", uid: "800123456",
    data: {
      current_stamina: 240, max_stamina: 300, stamina_recover_time: 3600,
      current_train_score: 500, max_train_score: 500,
      current_rogue_score: 14000, max_rogue_score: 14000,
      accepted_expedition_num: 3, total_expedition_num: 4,
      current_reserve_stamina: 1200, has_signed: 1,
      expeditions: [
        { status: "Ongoing", avatars: [exps[0], exps[1]] },
        { status: "Finished", avatars: [exps[2]] },
      ],
    },
  },
  {
    ok: true, profileId: 2, game: "zzz", uid: "130001234",
    data: {
      energy: { progress: { current: 60, max: 240 }, restore: 6480 },
      vitality: { current: 150, max: 200 },
      card_sign: "CardSignDone",
      vhs_sale: { sale_state: "SaleStateDoing" },
      has_signed: false,
    },
  },
  {
    ok: false, profileId: 2, game: "gs", uid: "",
    error: "米游社查询失败(retcode -100): 登录态已失效，请重新扫码登录后重试。",
  },
]

const data = buildDailyNoteRenderData({
  userId: "123456789",
  profileId: null,
  games: ["gs", "sr", "zzz"],
  results,
})

const out = "preview/daily-note-preview.png"
await renderWithSkia("daily-note-summary", data, { path: out, renderScale: 2 })
console.log("OK ->", out, `panels=${data.panels.length}`)
