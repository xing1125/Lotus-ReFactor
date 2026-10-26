// 路由体检：提取全库 reg/priority/name，输出 JSON 供分析。只做静态解析，不加载插件。
import fs from "node:fs"
import path from "node:path"

const ROOT = "D:/yunzai-yingbot/Yunzai/app/plugins"
const SKIP_DIRS = new Set(["node_modules", "temp", "example", "logs", "data", "resources", "tests", "dev", ".git", ".workbuddy", "backup"])
const SKIP_PLUGINS = new Set(["temp", "example", "adapter", "other", "system", "Guoba-Plugin", "adapter-guoba"])

const CONSTS = {
  PROFILE_ID_SUFFIX_PATTERN: "(?:[1-9]|[1-9]\\d|1\\d\\d|2[0-4]\\d|25[0-5])?",
  PROFILE_ID_REQUIRED_SUFFIX_PATTERN: "(?:[1-9]|[1-9]\\d|1\\d\\d|2[0-4]\\d|25[0-5])",
  LOTUS_INTERCEPT_PRIORITY: "NEG_INF",
  LOTUS_QUERY_PRIORITY: "5001",
}

function walk(dir, out = []) {
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && e.name.endsWith(".js")) out.push(p)
  }
  return out
}

// JS 字符串转义语义：\\X → X（\\n \t \r 保留控制符）
function jsUnescape(s) {
  return s.replace(/\\([\s\S])/g, (m, c) => {
    if (c === "n") return "\n"
    if (c === "t") return "\t"
    if (c === "r") return "\r"
    return c
  })
}

// 从 i 位置解析字面量值（字符串/模板/正则），返回 {raw, exec, approx, end}
function parseValue(src, i) {
  const ch = src[i]
  if (ch === '"' || ch === "'") {
    let j = i + 1, buf = ""
    while (j < src.length) {
      if (src[j] === "\\") { buf += src[j] + src[j + 1]; j += 2; continue }
      if (src[j] === ch) break
      buf += src[j]; j++
    }
    let body = jsUnescape(buf)
    return { raw: src.slice(i, j + 1), exec: body, approx: false, end: j + 1 }
  }
  if (ch === "`") {
    let j = i + 1, buf = ""
    while (j < src.length) {
      if (src[j] === "\\") { buf += src[j] + src[j + 1]; j += 2; continue }
      if (src[j] === "`") break
      buf += src[j]; j++
    }
    let approx = false
    const body = jsUnescape(buf).replace(/\$\{([^}]*)\}/g, (m, name) => {
      const key = name.trim()
      if (CONSTS[key]) return CONSTS[key]
      if (/^[A-Z_][A-Z0-9_]*$/.test(key)) { approx = true; return "(?:[\\s\\S]*?)" }
      approx = true
      return "(?:[\\s\\S]*?)"
    })
    return { raw: src.slice(i, j + 1), exec: body, approx, end: j + 1 }
  }
  if (ch === "/") {
    let j = i + 1, buf = "", inClass = false
    while (j < src.length) {
      const c = src[j]
      if (c === "\\") { buf += c + src[j + 1]; j += 2; continue }
      if (c === "[") inClass = true
      else if (c === "]") inClass = false
      else if (c === "/" && !inClass) break
      buf += c; j++
    }
    return { raw: src.slice(i, j + 1), exec: buf, approx: false, end: j + 1 }
  }
  return null
}

// priority 表达式：支持 Number.NEGATIVE_INFINITY / 数字 / 变量名 / 函数调用式 resolvePriority("id")
const PRIO_EXPR = String.raw`(Number\.(?:NEGATIVE_INFINITY|MIN_SAFE_INTEGER)|-?[\w$.]+(?:\s*\(\s*["'][^"']*["']\s*\))?)`

// 找 reg 所在对象块内的 priority / name
function blockInfo(src, pos) {
  // 向上找块起点
  let depth = 0, start = 0
  for (let i = pos - 1; i >= 0; i--) {
    if (src[i] === "}") depth++
    else if (src[i] === "{") {
      if (depth === 0) { start = i; break }
      depth--
    }
  }
  let end = src.length, depth2 = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth2++
    else if (src[i] === "}") { depth2--; if (depth2 === 0) { end = i; break } }
  }
  const block = src.slice(start, end + 1)
  const prio = block.match(new RegExp(String.raw`priority\s*:\s*` + PRIO_EXPR))
  const nm = block.match(/name\s*:\s*(["'`])([^"'`]*)\1/)
  return {
    priority: prio ? prio[1] : null,
    name: nm ? nm[2] : null,
  }
}

function pluginNameFor(src, pos) {
  // 向前找最近的 name:（插件构造器）
  const before = src.slice(0, pos)
  const m = [...before.matchAll(/name\s*:\s*(["'`])([^"'`]*)\1/g)]
  if (!m.length) return null
  return m[m.length - 1][2]
}

const rules = []
for (const pluginDir of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!pluginDir.isDirectory() || SKIP_PLUGINS.has(pluginDir.name)) continue
  const base = path.join(ROOT, pluginDir.name)
  for (const file of walk(base)) {
    let src = ""
    try { src = fs.readFileSync(file, "utf8") } catch { continue }
    if (!src.includes("reg:") && !src.includes("rule:")) continue
    // 只认真正的插件定义文件（过滤模板/文档/资源里的假规则）
    if (!/(super\s*\(\s*\{|App\.init\s*\(|app\.reg\s*\(|extends\s+plugin|extends\s+BasePlugin|extends\s+basePlugin|export\s+const\s+rule\s*=)/.test(src)) continue
    // 文件级默认：插件构造器里的 priority / name
    const superIdx = src.indexOf("super({")
    const appInit = src.match(/App\.init\(\s*\{([\s\S]*?)\}\s*\)/)
    const fileScope = superIdx >= 0 ? src.slice(superIdx, superIdx + 4000) : (appInit ? appInit[1] : src.slice(0, 3000))
    const fPrio = fileScope.match(new RegExp(String.raw`priority\s*:\s*` + PRIO_EXPR))
    const fName = fileScope.match(/name\s*:\s*(["'`])([^"'`]*)\1/)
    const filePriority = fPrio ? fPrio[1] : null
    const filePluginName = fName ? fName[2] : null
    const re = /(?<![\w.$])(reg|rule|yzRule)\s*:\s*/g
    let m
    while ((m = re.exec(src))) {
      const vstart = m.index + m[0].length
      const v = parseValue(src, vstart)
      if (!v) {
        rules.push({ plugin: pluginDir.name, file: path.relative(ROOT, file), reg: "VAR", approx: true, priority: null, name: null, note: "无法静态解析" })
        continue
      }
      const info = blockInfo(src, m.index)
      rules.push({
        plugin: pluginDir.name,
        file: path.relative(ROOT, file).replace(/\\/g, "/"),
        reg: v.exec,
        raw: v.raw.slice(0, 160),
        approx: v.approx,
        priority: info.priority || filePriority,
        name: info.name || filePluginName,
        pluginName: filePluginName,
      })
    }
  }
}

const outFile = process.argv[2] || path.join(ROOT, "Lotus-Plugin", "_route_rules.json")
fs.writeFileSync(outFile, JSON.stringify(rules, null, 1), "utf8")
console.log("rules:", rules.length)
const byPlugin = {}
for (const r of rules) byPlugin[r.plugin] = (byPlugin[r.plugin] || 0) + 1
console.log(byPlugin)
