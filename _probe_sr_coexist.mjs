// 离线探针：验证荷花 vs genshin 星铁挑战「谁有谁响应」共存不变量。
// 直接从两个部署文件抽取真实规则正则，避免手抄漂移。
import { readFileSync } from "node:fs"

const LOTUS = "D:/trss-yunzai/plugins/Lotus-Plugin/apps/starRailChallenge.js"
const GENSHIN = "D:/trss-yunzai/plugins/genshin/lib/StarRail/apps/abyss.js"

function read(p) {
  return readFileSync(p, "utf8")
}

// ---- 抽取荷花 starRailChallenge 规则 ----
function lotusRules(src) {
  const m = src.match(/const SR_WORDS = "([^"]*)"/)
  if (!m) throw new Error("Lotus SR_WORDS 未找到（可能被误删）")
  const srWords = m[1]
  const regs = []
  const re = /reg:\s*`([^`]*)`/g
  let r
  while ((r = re.exec(src))) {
    // 源码模板串里 \\* / [\\s\\S] 是 JS 转义后的双反斜杠，需还原成单反斜杠再交给 RegExp
    const src2 = r[1].replace(/\\\\/g, "\\").replace(/\$\{SR_WORDS\}/g, srWords)
    regs.push(new RegExp(src2))
  }
  return regs
}

// ---- 抽取 genshin abyss 规则（全为双引号 reg）----
function genshinRules(src) {
  const regs = []
  const re = /reg:\s*"([^"]*)"/g
  let r
  while ((r = re.exec(src))) {
    regs.push(new RegExp(r[1]))
  }
  return regs
}

const lotus = lotusRules(read(LOTUS))
const genshin = genshinRules(read(GENSHIN))

console.log(`荷花 starRailChallenge 规则数: ${lotus.length}`)
console.log(`genshin abyss 规则数: ${genshin.length}`)
console.log("")

const samples = [
  ["*虚构", true, false],
  ["*虚构叙事", true, false],
  ["*上期混沌", true, false],
  ["*忘却之庭", true, false],
  ["*末日幻影", true, false],
  ["*异相仲裁", true, false],
  ["*深渊", true, false],
  ["*本期末日", true, false],
  ["#星铁虚构", false, true],
  ["#星铁虚构叙事", false, true],
  ["#星铁混沌回忆", false, true],
  ["#星铁忘却之庭", false, true],
  ["#星铁末日幻影", false, true],
  ["#星铁异相仲裁", false, true],
  ["#星铁模拟宇宙", false, true],
  ["#星铁差分宇宙", false, true],
  ["#星铁货币战争", false, true],
  ["#星铁不可知域", false, true],
  ["#星铁寰宇蝗灾", false, true],
  ["#星铁黄金与机械", false, true],
  ["#星铁深渊", false, true],
]

let pass = 0
let fail = 0
const failures = []
for (const [msg, lotusExpect, genshinExpect] of samples) {
  const lotusHit = lotus.some(re => re.test(msg))
  const genshinHit = genshin.some(re => re.test(msg))
  const ok = lotusHit === lotusExpect && genshinHit === genshinExpect
  if (ok) pass++
  else {
    fail++
    failures.push({ msg, lotusHit, genshinHit, lotusExpect, genshinExpect })
  }
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${msg.padEnd(16)}  荷花=${lotusHit ? "Y" : "·"}   genshin=${genshinHit ? "Y" : "·"}`
  )
}

// ---- 核心不变量：任何 #星铁* 消息，荷花绝不可命中（否则双图）----
const doubleRisk = samples.filter(([msg]) => msg.startsWith("#星铁") && lotus.some(re => re.test(msg)))
console.log("")
console.log(`样本总数: ${samples.length}  PASS: ${pass}  FAIL: ${fail}`)
console.log(`#星铁* 双触发风险条数（应=0）: ${doubleRisk.length}`)

if (fail > 0) {
  console.log("\n失败明细:")
  for (const f of failures) console.log(JSON.stringify(f))
  process.exit(1)
}
if (doubleRisk.length > 0) {
  console.log("\n双触发风险:", doubleRisk)
  process.exit(2)
}
console.log("\n结论: 荷花只守 * 命名空间，#星铁* 全量由 genshin 响应，无双图风险。共存不变量成立。")
