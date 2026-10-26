// 路由胜负探针：对真实命令样本，测出所有命中规则，按 priority 升序 = loader 实际执行顺序
// 用法:
//   node _scan_route_probe.mjs '#体力' '#深渊'            // 逐条详表
//   node _scan_route_probe.mjs --brief '#体力' '#深渊'    // 汇总表
import fs from "node:fs"
import path from "node:path"
import { resolvePriority, resolveQueryPriority } from "./core/intercept/priority.js"

const BRIEF = process.argv.includes("--brief")
const SAMPLES = process.argv.slice(2).filter((a) => a !== "--brief")

const rules = JSON.parse(fs.readFileSync(path.join("D:/yunzai-yingbot/Yunzai/app/plugins/Lotus-Plugin", "_route_rules.json"), "utf8"))

function normPrio(p) {
  if (p == null) return 5000
  const s = String(p)
  // 查询类模块：priority: resolvePriority("<module_id>") —— 模块 id 决定是抢最前还是退后备
  const m = s.match(/resolvePriority\(\s*["']([^"']+)["']\s*\)/)
  if (m) return resolvePriority(m[1])
  if (/LOTUS_QUERY_PRIORITY/.test(s)) return resolveQueryPriority()
  if (/NEGATIVE_INFINITY|NEG_INF|-Infinity|-infinity|LOTUS_INTERCEPT_PRIORITY/.test(s)) return -Infinity
  if (/MIN_SAFE_INTEGER/.test(s)) return Number.MIN_SAFE_INTEGER
  const n = Number(s)
  return Number.isFinite(n) ? n : 5000
}

// 兜底宽匹配判定：有效字面量（中文/字母/数字）太少 = 通配规则
function isWide(src) {
  const lits = src.replace(/\\[a-zA-Z]/g, "").replace(/[^\u4e00-\u9fa5A-Za-z0-9#]/g, "")
  return lits.length < 7
}

const compiled = []
const seen = new Set()
for (const r of rules) {
  if (r.reg === "VAR" || !r.reg) continue
  const key = r.plugin + "|" + r.reg + "|" + (r.name || "")
  if (seen.has(key)) continue
  seen.add(key)
  let re
  try { re = new RegExp(r.reg) } catch { continue }
  compiled.push({ ...r, re, prio: normPrio(r.priority), wide: isWide(r.reg) })
}

// 静态扫描失明的「变量规则表」：直接 import 真实常量注入
try {
  const pq = await import("file:///D:/yunzai-yingbot/Yunzai/app/plugins/Lotus-Plugin/core/intercept/personal-query.js")
  for (const r of pq.PERSONAL_QUERY_RULES || []) {
    let re
    try { re = new RegExp(r.reg) } catch { continue }
    compiled.push({
      plugin: "Lotus-Plugin",
      file: "core/intercept/personal-query.js",
      name: "[Lotus-Plugin] Profile Query",
      reg: r.reg,
      prio: resolvePriority("profile_query"),
      re,
      wide: false,
      approx: false,
      injected: true,
    })
  }
  console.log(`[注入] Profile Query 常量规则 ${pq.PERSONAL_QUERY_RULES?.length || 0} 条`)
} catch (e) {
  console.error("[注入失败] personal-query.js:", e.message)
}

// 动态优先级补丁：genshin gcLog 的 priority 由 config.admin.yaml 的 Gacha 决定，静态扫不到
try {
  const y = fs.readFileSync("D:/yunzai-yingbot/Yunzai/app/plugins/genshin/config/config/config.admin.yaml", "utf8")
  const g = y.match(/^Gacha:\s*(\d+)/m)
  if (g) for (const r of compiled) if (String(r.file || "").includes("genshin/apps/gcLog.js")) r.prio = Number(g[1])
} catch { /* 未装 genshin 时忽略 */ }

// 复刻 loader 实际执行序：priority 升序；同优先级时 Lotus 条目强制优先（enforceLotusInterception）
const isLotus = (h) => String(h.name || "").startsWith("[Lotus-Plugin]") || h.plugin === "Lotus-Plugin"
function hitsOf(msg) {
  return compiled
    .filter((r) => { try { return r.re.test(msg) } catch { return false } })
    .sort((a, b) => {
      if (a.prio < b.prio) return -1
      if (a.prio > b.prio) return 1
      const la = isLotus(a), lb = isLotus(b)
      if (la !== lb) return la ? -1 : 1
      return 0
    })
}

const fmtP = (p) => (p === -Infinity ? "-∞" : p === Number.MIN_SAFE_INTEGER ? "-MAX" : String(p))
const fmtN = (h) => (h.name || "?").replace(/^\[.*?\]\s*/, "").slice(0, 28)

if (BRIEF) {
  console.log("命令".padEnd(14) + " | 真实接管（跳过兜底）".padEnd(46) + " | 次席")
  console.log("-".repeat(112))
  for (const msg of SAMPLES) {
    const hits = hitsOf(msg)
    const strong = hits.filter((h) => !h.wide && !h.approx)
    const win = strong[0]
    const rival = strong.find((h) => win && h.plugin !== win.plugin && !["core-guard", "ark-plugin"].includes(h.plugin))
    const f = (h) => (h ? `${h.plugin}::${fmtN(h)} (p=${fmtP(h.prio)})` : "—")
    console.log(msg.padEnd(14) + " | " + f(win).padEnd(44) + " | " + f(rival))
  }
  process.exit(0)
}

for (const msg of SAMPLES) {
  const hits = hitsOf(msg)
  console.log("\n=== " + msg + " ===")
  if (!hits.length) { console.log("  (无规则命中)"); continue }
  const strong = hits.filter((h) => !h.wide && !h.approx)
  const wide = hits.filter((h) => h.wide || h.approx)
  strong.slice(0, 8).forEach((h, i) => {
    const tag = i === 0 ? " WIN>" : "  " + String(i + 1).padStart(2) + ">"
    console.log(`${tag} p=${fmtP(h.prio).padStart(5)} ${h.plugin} :: ${h.name || "?"} :: ${h.reg.slice(0, 62)}${h.approx ? " [近似]" : ""}`)
  })
  if (strong.length > 8) console.log(`      ... 另有 ${strong.length - 8} 条更靠后的精确命中`)
  if (wide.length) console.log(`   兜底(宽/近似) ${wide.length} 条: ${[...new Set(wide.map((w) => w.plugin))].join(", ")}`)
}
