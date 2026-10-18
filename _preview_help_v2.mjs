// 帮助菜单新版式预览：LOTUS_THEME=tide node _preview_help_v2.mjs
globalThis.plugin = class {}
const { GROUPS } = await import("./apps/help.js")
const { renderWithSkia } = await import("./core/render/skia.js")
const fs = await import("node:fs/promises")

const image = await renderWithSkia("help-menu", {
  title: "荷花插件 · 命令菜单",
  subtitle: "按模块分组 · 输入 #荷花帮助 <分组> 查看细化说明",
  groups: GROUPS,
})
const out = "preview/help-menu-v2.png"
await fs.mkdir("preview", { recursive: true })
await fs.writeFile(out, image)
console.log("saved:", out, image.length, "bytes")
