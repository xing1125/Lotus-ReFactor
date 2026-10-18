// jj 模式单卡体力预览：LOTUS_THEME=tide node _preview_note_single.mjs
globalThis.plugin = class {}
const { buildDailyNoteRenderData } = await import("./apps/dailyNote.js")
const { renderWithSkia } = await import("./core/render/skia.js")
const fs = await import("node:fs/promises")

const srData = {
  ok: true, uid: "159411658", nickname: "岑曜", game: "sr", gameName: "星铁", profileId: 1, data: {
    current_stamina: 300, max_stamina: 300, stamina_recover_time: 0,
    current_train_score: 0, max_train_score: 1300, current_rogue_score: 0, max_rogue_score: 1400,
    accepted_expedition_num: 0, total_expedition_num: 4, current_reserve_stamina: 240,
  },
}
const gsData = {
  ok: true, uid: "293526852", nickname: "旅人", game: "gs", gameName: "原神", profileId: 1, data: {
    current_resin: 160, max_resin: 160, resin_recovery_time: 0,
    current_expedition_num: 3, max_expedition_num: 5, has_signed: true,
  },
}
await fs.mkdir("preview", { recursive: true })
let n = 0
for (const item of [srData, gsData]) {
  const data = buildDailyNoteRenderData({ userId: "wxid_test", profileId: null, games: ["gs", "sr", "zzz"], results: [item] })
  console.log("单卡标题:", data.title, "|", data.subtitle)
  const image = await renderWithSkia("daily-note-summary", data, { saveId: `preview-note-single-${++n}` })
  await fs.writeFile(`preview/note-single-${n}.png`, image)
}
console.log("saved: preview/note-single-1.png / note-single-2.png")
