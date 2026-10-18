// 体力面板配色预览（对齐用户提供的 jj 参考截图：星铁 300/300 已全部恢复）
globalThis.plugin = globalThis.plugin || class Plugin { constructor() {} }
globalThis.logger = globalThis.logger || { warn() {}, debug() {}, info() {}, mark() {}, error() {} }

const { renderWithSkia } = await import("./core/render/skia.js")

const base = {
  title: "星穹铁道体力",
  subtitle: "测试 · UID 159411658",
  badge: "1/1",
  panels: [{
    ok: true, uid: "159411658", game: "sr", gameName: "星穹铁道", profileLabel: "Profile 1",
    date: "2026年10月18日 16:44 星期日",
    signed: true,
    primary: { label: "开拓力", current: 300, max: 300, icon: undefined, recover: null },
    reserve: "2400",
    rows: [
      { label: "每日实训", value: 0, max: 500, warn: true },
      { label: "模拟宇宙", value: 0, max: 18000 },
      { label: "委托执行", value: 0, max: 4, warn: true },
    ],
    footer: { label: "尚未进行委托执行", items: [] },
  }],
}

await renderWithSkia("daily-note-summary", base, { path: "preview/_daily-color-sr.png", renderScale: 2 })
console.log("OK -> preview/_daily-color-sr.png")
