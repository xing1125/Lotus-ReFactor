// 体力面板「底色板（.bg-art）」预览：
//   A 有立绘 —— 走真实解析链（renderer 按 panel.game 从角色立绘库随机抽取）
//   B 无立绘 —— artImg 指向不存在的文件，验证 image() 加载失败时优雅降级（保持原深蓝玻璃观感）
// 用法：node _preview_daily_art.mjs
globalThis.plugin = globalThis.plugin || class Plugin { constructor() {} }
globalThis.logger = globalThis.logger || { warn() {}, debug() {}, info() {}, mark() {}, error() {} }

const { buildDailyNoteRenderData } = await import("./apps/dailyNote.js")
const { renderWithSkia } = await import("./core/render/skia.js")

const results = [
  { ok: true, profileId: 1, game: "gs", uid: "257698897", data: {
    current_resin: 108, max_resin: 200, resin_recovery_time: 5400,
    current_home_coin: 1350, max_home_coin: 2400,
    finished_task_num: 4, total_task_num: 4, is_extra_task_reward_received: true,
    current_expedition_num: 5, max_expedition_num: 5, has_signed: true,
    expeditions: [{ status: "Finished" }, { status: "Finished" }, { status: "Finished" }, { status: "Finished" }, { status: "Finished" }],
  } },
  { ok: true, profileId: 1, game: "sr", uid: "100398381", data: {
    current_stamina: 180, max_stamina: 300, stamina_recover_time: 3600,
    current_train_score: 500, max_train_score: 500,
    current_rogue_score: 14000, max_rogue_score: 14000,
    accepted_expedition_num: 4, total_expedition_num: 4,
    current_reserve_stamina: 1200, has_signed: 1,
  } },
  { ok: true, profileId: 2, game: "zzz", uid: "13085206", data: {
    energy: { progress: { current: 240, max: 240 } },
    vitality: { current: 0, max: 400 },
    card_sign: "CardSignNotDone",
    vhs_sale: { sale_state: "SaleStateWaiting" },
    has_signed: true,
  } },
]

const base = buildDailyNoteRenderData({ userId: "123456789", profileId: null, games: ["gs", "sr", "zzz"], results })

// A：保留真实随机立绘
await renderWithSkia("daily-note-summary", base, { path: "preview/_daily-art-on.png", renderScale: 2 })
console.log("OK -> preview/_daily-art-on.png")

// B：强制指向不存在的文件 → 加载失败 → 不画底色板（降级）
const broken = { ...base, panels: base.panels.map(p => ({ ...p, artImg: "preview/__no_such_art__.png" })) }
await renderWithSkia("daily-note-summary", broken, { path: "preview/_daily-art-off.png", renderScale: 2 })
console.log("OK -> preview/_daily-art-off.png")
