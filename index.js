import fs from "node:fs/promises"
import { installLotusRuntimeInterception } from "./services/intercept/runtime.js"
import { ensureGlobalConfig } from "./core/config/global.js"
import { isModuleEnabled, moduleLabel, MODULE_BY_APP_FILE } from "./core/config/modules.js"
import { replyText } from "./core/transport/reply.js"
import { autoStartTestNineServer } from "./services/testNine/server.js"
import { checkTrackedSubmoduleRemoteUpdates, syncTrackedSubmodules } from "./services/pluginUpdate/service.js"

const pluginName = "Lotus-Plugin"
const appsDir = new URL("./apps/", import.meta.url)

logger?.info?.("---- Lotus-Plugin refactor loading ----")

let startupConfig = {}
await ensureGlobalConfig().then(result => {
  startupConfig = result.config || {}
  if (result.created) logger?.mark?.(`[${pluginName}] created default config: ${result.file}`)
}).catch(error => {
  logger?.warn?.(`[${pluginName}] global config init skipped: ${error.message}`)
})

// 只检查并通知，不在开机阶段自动改写子仓库，避免隐藏更新或阻塞启动。
void checkTrackedSubmoduleRemoteUpdates({ config: startupConfig }).then(result => {
  if (result.updates?.length) logger?.warn?.(`[${pluginName}] ${result.message}`)
}).catch(error => {
  logger?.debug?.(`[${pluginName}] submodule remote check skipped: ${error.message}`)
})

await installLotusRuntimeInterception().catch(error => {
  logger?.debug?.(`[${pluginName}] runtime interception skipped: ${error.message}`)
})

await syncTrackedSubmodules().then(result => {
  if (result.action === "submodules_updated") {
    logger?.mark?.("[" + pluginName + "] " + result.message)
  } else if (!result.ok) {
    logger?.warn?.("[" + pluginName + "] submodule sync skipped: " + result.message)
  }
}).catch(error => {
  logger?.debug?.("[" + pluginName + "] submodule sync skipped: " + error.message)
})

autoStartTestNineServer().catch(error => {
  logger?.warn?.(`[${pluginName}] test_nine auto start failed: ${error.message}`)
})

const files = await fs.readdir(appsDir).catch(err => {
  logger?.error?.(`[${pluginName}] failed to read apps directory`)
  logger?.error?.(err)
  return []
})

const modules = await Promise.allSettled(
  files.filter(file => file.endsWith(".js")).map(file => import(new URL(file, appsDir))),
)

const apps = {}
for (const [index, result] of modules.entries()) {
  const file = files.filter(name => name.endsWith(".js"))[index]
  const name = file.replace(/\.js$/, "")

  if (result.status !== "fulfilled") {
    logger?.error?.(`[${pluginName}] failed to load app: ${name}`)
    logger?.error?.(result.reason)
    continue
  }

  // ESM 命名空间对象的键按字典序排列，主类之外可能还有常量 / 辅助函数导出
  // （如 help.js 的 GROUPS 数组排在大写的 LotusHelp 之前），
  // 因此不能盲取第一个键，必须挑出真正的插件主类（类的 typeof 也是 function）。
  const AppClass = pickAppClass(result.value)
  if (typeof AppClass !== "function") {
    logger?.warn?.(`[${pluginName}] app has no plugin class export: ${name}`)
    continue
  }
  apps[name] = gatePluginModules(silencePluginLogs(AppClass), MODULE_BY_APP_FILE[name])
}

logger?.info?.(`Lotus-Plugin refactor loaded: ${Object.keys(apps).length} app(s)`)

export { apps }

// 从 app 模块的命名空间对象中挑出插件主类。
// 优先命中 Lotus* / *Plugin / *Control / *Sync 等主类命名，否则退化为首个函数导出。
function pickAppClass(moduleExports) {
  if (!moduleExports || typeof moduleExports !== "object") return null
  let fallback = null
  for (const key of Object.keys(moduleExports)) {
    const value = moduleExports[key]
    if (typeof value !== "function") continue
    if (/^(?:Lotus.*|.*Plugin|.*Control|.*Sync)$/.test(key)) return value
    if (!fallback) fallback = value
  }
  return fallback
}

// 模块开关：登记在 MODULE_BY_APP_FILE 的 app，其所有 rule 方法在执行前查 config/modules.<id>，
// 显式 false（锅巴「功能开关」）→ 短提示并吞掉消息；未登记 / 读取失败 → 一律放行（fail-open）。
function gatePluginModules(AppClass, moduleId) {
  if (!moduleId) return AppClass
  return class LotusModuleGate extends AppClass {
    constructor(...args) {
      super(...args)
      const fncs = new Set((this.rule || []).map(entry => entry?.fnc).filter(Boolean))
      for (const fnc of fncs) {
        if (typeof this[fnc] !== "function") continue
        this[fnc] = (...callArgs) => this.__runGated(fnc, callArgs)
      }
    }
    async __runGated(fnc, callArgs) {
      let enabled = true
      try { enabled = await isModuleEnabled(moduleId) } catch { }
      if (!enabled) {
        try { await replyText(this, `[荷花插件]「${moduleLabel(moduleId)}」功能已在锅巴中关闭`) } catch { }
        return true
      }
      return super[fnc](...callArgs)
    }
  }
}

function silencePluginLogs(AppClass) {
  return class LotusSilentPluginLogs extends AppClass {
    constructor(...args) {
      super(...args)
      silenceEntries(this.rule)
      silenceEntries(this.task)
    }
  }
}

function silenceEntries(entries) {
  if (!entries) return
  for (const entry of Array.isArray(entries) ? entries : [entries]) {
    if (entry && typeof entry === "object") entry.log = false
  }
}
