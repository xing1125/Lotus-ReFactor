// 离线探针：锅巴快捷动作（不 import index.js，stub globalThis.plugin）
// 验证：1) GUOBA_SCHEMAS 挂载「快捷操作」组 + 4 个 actions.* 开关
//       2) applyGuobaFormData 触发检测：关→开 收集、写回复位 false、已开不动不触发
//       3) createHeadlessContext 文字负载记日志、数组展开
globalThis.plugin = class {}
globalThis.logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

const { GUOBA_SCHEMAS, applyGuobaFormData } = await import("./guoba.support.js")
const { GBACTIONS, createHeadlessContext, isCommandBlocked, matchCommandRule, dispatchCommand } = await import("./guoba.actions.js")

let failed = 0
const check = (name, ok, detail = "") => {
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`)
}

// 1. schema 挂载
const actionFields = GUOBA_SCHEMAS.filter(s => s.field?.startsWith("actions.")).map(s => s.field)
const hasGroup = GUOBA_SCHEMAS.some(s => s.component === "Divider" && s.label === "快捷操作")
check("快捷操作组挂载", hasGroup)
check("7 个动作开关", actionFields.filter(f => /^actions\.\w+$/.test(f) && !f.startsWith("actions.command_")).length === Object.keys(GBACTIONS).length, actionFields.join(", "))
check("动作 id 与注册表一致", Object.keys(GBACTIONS).every(id => actionFields.includes(`actions.${id}`)))
check("自定义指令文本框挂载", actionFields.includes("actions.command_text"))
check("指令黑名单挂载", actionFields.includes("actions.command_blacklist"))

// 2. 触发检测（纯函数，不落盘）
const base = { modules: {}, actions: { resign_all: false, register_all: false, batch_refresh: false, board_push: false, generate_plan: false, capture_challenge: false, custom_command: false, command_text: "", command_blacklist: [] }, render: { theme: "abyss" } }
// 2a. resign_all 关→开 → 触发 + 复位
const r1 = applyGuobaFormData(structuredClone(base), { "actions.resign_all": true })
check("关→开 触发 resign_all", r1.triggered.length === 1 && r1.triggered[0] === "resign_all", JSON.stringify(r1.triggered))
check("写盘后动作位复位 false", r1.next.actions.resign_all === false)
// 2b. 其余保持关 → 不触发
check("保持关不触发", r1.next.actions.register_all === false && r1.next.actions.board_push === false)
// 2c. 已开（不该出现，但防御）→ 不触发
const r2 = applyGuobaFormData({ actions: { resign_all: true } }, { "actions.resign_all": true })
check("已开→开 不触发", r2.triggered.length === 0, JSON.stringify(r2.triggered))
// 2d. 未提交 actions 字段 → 无触发
const r3 = applyGuobaFormData(structuredClone(base), { "render.theme": "abyss" })
check("未提交不触发", r3.triggered.length === 0)
// 2e. 主题等其他字段保存不受影响
check("其它字段正常保存", r3.next.render.theme === "abyss")
// 2f. custom_command 触发 + command_text/blacklist 字段共存
const r4 = applyGuobaFormData(structuredClone(base), { "actions.custom_command": true, "actions.command_text": "#签到看板\n#帮助", "actions.command_blacklist": "更新图鉴\n远程" })
check("custom_command 关→开 触发", r4.triggered.length === 1 && r4.triggered[0] === "custom_command", JSON.stringify(r4.triggered))
check("command_text 字符串保存", r4.next.actions.command_text === "#签到看板\n#帮助")
check("command_blacklist 数组解析", Array.isArray(r4.next.actions.command_blacklist) && r4.next.actions.command_blacklist.join(",") === "更新图鉴,远程")

// 3. 无头 context
const ctx = createHeadlessContext("wxid-test", "测试动作")
check("ctx.e.user_id 透传", ctx.e.user_id === "wxid-test" && ctx.e.isGroup === false)
await ctx.reply("[荷花插件]测试文字 A")
await ctx.reply(["[荷花插件]测试文字 B1", "[荷花插件]测试文字 B2"])
check("文字负载入 logs（数组展开）", ctx.logs.length === 3, JSON.stringify(ctx.logs))

// 4. 通用指令调度（纯函数，fake apps 注入，不 import index.js）
check("黑名单命中", isCommandBlocked("#更新图鉴 全量", ["更新图鉴"]) === "更新图鉴")
check("黑名单未命中", isCommandBlocked("#签到看板", ["更新图鉴"]) === "")
check("黑名单空数组放行", isCommandBlocked("#更新图鉴", []) === "")
class FakeApp {
  constructor() {
    this.pinged = []
    this.rule = [
      { regex: /^#ping$/, fnc: "ping" },
      { regex: /^#需要群$/, fnc: "needGroup" },
    ]
  }
  async ping() { this.pinged.push(this.e.msg); await this.e.reply(`[荷花插件]pong ${this.e.user_id} master=${this.e.isMaster}`) }
  async needGroup() { await this.e.reply(`群 ${this.e.group_id}`) }
}
const fakeApps = { "FakeApp": FakeApp }
const m1 = matchCommandRule(fakeApps, "#ping")
check("rule 正则命中", m1?.name === "FakeApp" && m1.entry.fnc === "ping")
await dispatchCommand(m1, "#ping", ctx)
check("fnc 执行 + 无头事件注入", ctx.logs.some(l => l.includes("pong wxid-test master=true")), JSON.stringify(ctx.logs))
check("无匹配返回 null", matchCommandRule(fakeApps, "#不存在") === null)

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
