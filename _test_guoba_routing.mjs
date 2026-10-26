// 临时测试：荧后台（锅巴）命令路由字段读写往返 + 配置校验
// apps/*.js 用 globalThis.plugin 作为 BasePlugin，无头环境先注入桩
globalThis.plugin = class {}
globalThis.Bot = { uin: "10000", nickname: "test" }

const { toGuobaFormData, applyGuobaFormData, GUOBA_SCHEMAS } = await import("./guoba.support.js")
const { DEFAULT_GLOBAL_CONFIG } = await import("./core/config/defaults.js")
const { validateGlobalConfig, assertValidGlobalConfig } = await import("./core/config/schema.js")

const out = []
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  out.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`)
}

// 1. schema 里存在两个字段
const fields = GUOBA_SCHEMAS.filter(s => s.field).map(s => s.field)
check("schema 含 routing.query_priority", fields.includes("routing.query_priority"), true)
check("schema 含 routing.front_modules", fields.includes("routing.front_modules"), true)

// 2. 默认配置 → 表单数据（数组字段转成多行文本）
const form = toGuobaFormData(structuredClone(DEFAULT_GLOBAL_CONFIG))
check("表单 reading query_priority", form.routing?.query_priority, 5001)
check("表单 front_modules 文本", form.routing?.front_modules, "")

// 2.5 模块开关缺省显示：稀疏 modules（只写了部分键）→ 未写的开关在面板按「开」显示（fail-open）
const sparse = structuredClone(DEFAULT_GLOBAL_CONFIG)
sparse.modules = { daily_note: true }
const sparseForm = toGuobaFormData(sparse)
check("稀疏 modules 已写键原样", sparseForm.modules?.daily_note, true)
check("稀疏 modules 未写键显示为开", sparseForm.modules?.genshin_abyss, true)
check("稀疏 modules 未写键不是 undefined", sparseForm.modules?.genshin_abyss === undefined, false)

// 3. 表单提交 → 合并回配置（文本拆数组、字符串转数字）
const submitted = structuredClone(form)
submitted.routing = { query_priority: "4300", front_modules: "genshin_abyss\n starrail_challenge , gacha_log" }
const { next } = applyGuobaFormData(structuredClone(DEFAULT_GLOBAL_CONFIG), submitted)
check("合并后 query_priority 数值", next.routing.query_priority, 4300)
check("合并后 front_modules 数组", next.routing.front_modules, ["genshin_abyss", "starrail_challenge", "gacha_log"])

// 4. 校验通过（且路由块能被 validateGlobalConfig 接受）
check("校验错误数", validateGlobalConfig(next).filter(e => String(e).includes("routing")).length, 0)
let threw = ""
try { assertValidGlobalConfig(next) } catch (e) { threw = e.message }
check("整体校验通过", threw, "")

// 5. 旧配置（无 routing 块）仍合法
const legacy = structuredClone(DEFAULT_GLOBAL_CONFIG)
delete legacy.routing
check("旧配置无 routing 也通过", validateGlobalConfig(legacy).filter(e => String(e).includes("routing")).length, 0)

// 6. 非法值被拦
check("非法 query_priority 被拦", validateGlobalConfig({ ...next, routing: { query_priority: "abc" } }).some(e => e.includes("routing.query_priority")), true)
check("非法 front_modules 被拦", validateGlobalConfig({ ...next, routing: { front_modules: "genshin_abyss" } }).some(e => e.includes("routing.front_modules")), true)

const failed = out.filter(v => !v).length
console.log(`\n${out.length - failed}/${out.length} 通过`)
process.exit(failed ? 1 : 0)
