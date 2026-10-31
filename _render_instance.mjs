import { NanokaAtlasService, buildAtlasRenderData, selectAtlasTemplate } from "./services/nanokaAtlas/service.js"
import { renderAtlasPage, buildAtlasPages } from "./core/render/atlas-pages.js"
import fs from "node:fs/promises"
import path from "node:path"

const DATA_ROOT = "D:/trss-yunzai/plugins/Lotus-Plugin/nanoka-atlas-backend"
const outDir = path.resolve("preview")
await fs.mkdir(outDir, { recursive: true })

const name = process.argv[2] || "希儿"
const locale = process.argv[3] || "简体中文"
console.log("query =", name, "| locale =", locale)

const svc = new NanokaAtlasService()
const result = await svc.search(name, { dataRoot: DATA_ROOT, locale })
console.log("ok =", result.ok, "reason =", result.reason, "results =", (result.results || []).length, "template =", result.template)

if (!result.ok || !result.results?.length) {
  console.error("NO RESULT, abort")
  process.exit(1)
}

const data = buildAtlasRenderData(result)

// 验证：不手动注入，依赖 service.js 的 gallery 兜底（localPath 为空时按 originalValue 回退 gallery）
console.log("title =", data.title, "| template =", selectAtlasTemplate(data), "| view.kind =", data.view?.kind, "| game =", data.view?.game)
console.log("image =", data.image, "| portrait =", data.view?.portrait)
console.log("has image =", Boolean(data.image || data.view?.image), "| atlasRoot =", data.atlasRoot)

if (selectAtlasTemplate(data) === "atlas-item" && data.view) {
  const pages = buildAtlasPages(data)
  console.log("pages =", pages.length, "->", pages.map(p => p.section).join(" / "))
  let i = 0
  for (const page of pages) {
    const buf = await renderAtlasPage({ ...data, atlasPage: page }, { renderScale: 2 })
    const file = path.join(outDir, `atlas-instance-${name}-${++i}.png`)
    await fs.writeFile(file, buf)
    console.log("OK page", i, page.section, "->", file)
  }
} else {
  const file = path.join(outDir, `atlas-instance-${name}.png`)
  await fs.writeFile(file, await renderAtlasPage(data, { renderScale: 2 }))
  console.log("OK ->", file)
}
