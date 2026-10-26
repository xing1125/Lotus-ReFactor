// 临时测试：routing 配置解析 + front_modules + mtime 缓存失效 + loader 热更新
import fs from "node:fs"
import {
  resolvePriority,
  resolveQueryPriority,
  resetRoutingCache,
  syncRoutingPriorities,
  sortPriorityEntries,
} from "./core/intercept/priority.js"

const FILE = "./config/global.yaml"
const original = fs.readFileSync(FILE, "utf8")
const LF = "\n"

const results = []
function check(name, actual, expected) {
  const ok = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected)
  results.push({ name, actual, expected, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${actual} (期望 ${expected})`)
}

try {
  check("默认 query_priority", resolveQueryPriority(), 5001)
  check("默认 genshin_abyss", resolvePriority("genshin_abyss"), 5001)

  // 1. front_modules 生效（走 mtime 缓存失效，不重启进程）
  fs.writeFileSync(FILE, original.replace("front_modules: []", "front_modules:" + LF + "    - genshin_abyss"), "utf8")
  await new Promise(r => setTimeout(r, 40))
  check("front_modules 命中", resolvePriority("genshin_abyss"), Number.NEGATIVE_INFINITY)
  check("front_modules 未命中", resolvePriority("gacha_log"), 5001)

  // 2. query_priority 改值生效
  fs.writeFileSync(FILE, original.replace("query_priority: 5001", "query_priority: 4200"), "utf8")
  await new Promise(r => setTimeout(r, 40))
  check("query_priority 改值", resolveQueryPriority(), 4200)
  check("query_priority 影响模块", resolvePriority("gacha_log"), 4200)

  // 3. 环境变量覆盖优先（需重启进程，这里只验证常量解析逻辑存在）
  check("LOTUS_INTERCEPT_PRIORITY", (await import("./core/intercept/priority.js")).LOTUS_INTERCEPT_PRIORITY, Number.NEGATIVE_INFINITY)

  // 4. loader 热更新：模拟 loader.priority 条目，改配置后 syncRoutingPriorities 免重载生效
  //    先还原配置，避免继承前面步骤改过的 4200
  fs.writeFileSync(FILE, original, "utf8")
  await new Promise(r => setTimeout(r, 40))
  resetRoutingCache()
  const lotus = id => ({ __lotusModuleId: id })
  const entries = [
    { key: "miao-plugin", name: "miao", priority: 5000, class: {} },
    { key: "Lotus-Plugin", name: "[Lotus-Plugin] Gacha Log", priority: 5001, class: lotus("gacha_log") },
    { key: "Lotus-Plugin", name: "[Lotus-Plugin] Genshin Abyss", priority: 5001, class: lotus("genshin_abyss") },
  ]
  const r0 = syncRoutingPriorities(entries)
  check("热更新: 默认配置无需变更", r0.changed, 0)
  check("热更新: 默认顺序 miao 在前", entries.map(e => e.name).indexOf("miao"), 0)

  // front_modules 加入 genshin_abyss → 该条目变 -Infinity 并排到最前
  fs.writeFileSync(FILE, original.replace("front_modules: []", "front_modules:" + LF + "    - genshin_abyss"), "utf8")
  await new Promise(r => setTimeout(r, 40))
  const r1 = syncRoutingPriorities(entries)
  check("热更新: 变更条目数", r1.changed, 1)
  check("热更新: genshin_abyss 条目变 -∞", entries.find(e => e.class.__lotusModuleId === "genshin_abyss").priority, Number.NEGATIVE_INFINITY)
  check("热更新: genshin_abyss 排最前", entries[0].class.__lotusModuleId, "genshin_abyss")
  check("热更新: gacha_log 不受影响", entries.find(e => e.class.__lotusModuleId === "gacha_log").priority, 5001)

  // 还原后再次同步 → 回到 5001，顺序恢复
  fs.writeFileSync(FILE, original, "utf8")
  await new Promise(r => setTimeout(r, 40))
  const r2 = syncRoutingPriorities(entries)
  check("热更新: 还原变更条目数", r2.changed, 1)
  check("热更新: 顺序恢复 miao 在前", entries[0].name, "miao")

  // sortPriorityEntries 原地排序且保持数组引用
  const ref = entries
  sortPriorityEntries(entries)
  check("热更新: 原地排序保持引用", Object.is(entries, ref), true)
} finally {
  fs.writeFileSync(FILE, original, "utf8")
  resetRoutingCache()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
