import { spawn } from "node:child_process"
import { rootPath } from "../../core/path.js"
import { notifyUser } from "../../core/transport/notify.js"

const DEFAULT_OUTPUT_LIMIT = 12000
const GIT_STATUS_ARGS = ["status", "--short", "--ignore-submodules=dirty"]

export async function checkPluginUpdate(options = {}) {
  const {
    cwd = rootPath,
    pull = true,
    updateSubmodules = true,
    outputLimit = DEFAULT_OUTPUT_LIMIT,
    runner = runGit,
  } = options

  const status = await runner(GIT_STATUS_ARGS, { cwd, outputLimit })
  const dirtyState = partitionDirtyStatus(splitStatusLines(status.stdout))
  const dirtyLines = dirtyState.blocking
  if (dirtyLines.length) {
    return {
      ok: false,
      action: "blocked_dirty",
      message: "当前仓库存在未提交改动，已停止自动更新。",
      dirty: dirtyLines.slice(0, 12),
      ignoredDirty: dirtyState.ignored.slice(0, 12),
    }
  }

  const remotes = await runner(["remote"], { cwd, outputLimit })
  if (!splitLines(remotes.stdout).length) {
    return {
      ok: false,
      action: "no_remote",
      message: "当前仓库没有配置 remote，无法自动检查更新。",
    }
  }

  await runner(["remote", "update"], { cwd, outputLimit })

  const branch = await runner(["rev-parse", "--abbrev-ref", "HEAD"], { cwd, outputLimit })
  const upstream = await runner(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
    cwd,
    outputLimit,
    allowFailure: true,
  })
  if (upstream.code !== 0) {
    return {
      ok: false,
      action: "no_upstream",
      branch: branch.stdout.trim(),
      message: "当前分支没有上游跟踪分支，无法自动判断更新。",
      detail: upstream.stderr || upstream.stdout,
    }
  }

  const counts = await runner(["rev-list", "--left-right", "--count", "HEAD...@{u}"], {
    cwd,
    outputLimit,
  })
  const [ahead, behind] = parseAheadBehind(counts.stdout)
  const current = await latestCommit(runner, cwd, outputLimit)

  if (ahead > 0 && behind > 0) {
    return {
      ok: false,
      action: "diverged",
      branch: branch.stdout.trim(),
      upstream: upstream.stdout.trim(),
      ahead,
      behind,
      commit: current,
      message: "本地分支和上游已分叉，请手动处理后再更新。",
    }
  }
  if (ahead > 0) {
    return {
      ok: true,
      action: "ahead",
      branch: branch.stdout.trim(),
      upstream: upstream.stdout.trim(),
      ahead,
      behind,
      commit: current,
      message: "本地分支领先上游，无需拉取。",
      ignoredDirty: dirtyState.ignored.slice(0, 12),
    }
  }
  if (behind === 0) {
    return {
      ok: true,
      action: "up_to_date",
      branch: branch.stdout.trim(),
      upstream: upstream.stdout.trim(),
      ahead,
      behind,
      commit: current,
      message: "插件已是最新版本。",
      ignoredDirty: dirtyState.ignored.slice(0, 12),
    }
  }

  if (!pull) {
    return {
      ok: true,
      action: "behind",
      branch: branch.stdout.trim(),
      upstream: upstream.stdout.trim(),
      ahead,
      behind,
      commit: current,
      message: `检测到上游有 ${behind} 个新提交。`,
      ignoredDirty: dirtyState.ignored.slice(0, 12),
    }
  }

  const pullResult = await runner(["pull", "--ff-only"], { cwd, outputLimit })
  if (updateSubmodules) {
    await runner(["submodule", "update", "--init", "--recursive"], {
      cwd,
      outputLimit,
      allowFailure: true,
    })
  }
  const updated = await latestCommit(runner, cwd, outputLimit)

  return {
    ok: true,
    action: "updated",
    branch: branch.stdout.trim(),
    upstream: upstream.stdout.trim(),
    ahead: 0,
    behind,
    commit: updated,
    previousCommit: current,
    message: `已 fast-forward 更新 ${behind} 个提交，请按需重启机器人。`,
    output: pullResult.stdout || pullResult.stderr,
    ignoredDirty: dirtyState.ignored.slice(0, 12),
  }
}

export async function syncTrackedSubmodules(options = {}) {
  const {
    cwd = rootPath,
    outputLimit = DEFAULT_OUTPUT_LIMIT,
    runner = runGit,
  } = options
  const status = await runner(["submodule", "status", "--recursive"], {
    cwd,
    outputLimit,
    allowFailure: true,
  })
  if (status.code !== 0) {
    return {
      ok: false,
      action: "submodule_status_failed",
      message: "无法读取子模块状态。",
      detail: status.stderr || status.stdout,
    }
  }

  const pending = splitLines(status.stdout).filter(line => /^[+\-U]/.test(line))
  if (!pending.length) {
    return {
      ok: true,
      action: "submodules_up_to_date",
      message: "子模块提交已同步。",
    }
  }

  const update = await runner(["submodule", "update", "--init", "--recursive"], {
    cwd,
    outputLimit,
    allowFailure: true,
  })
  if (update.code !== 0) {
    return {
      ok: false,
      action: "submodule_update_failed",
      message: "子模块提交不匹配，但自动更新失败。",
      pending,
      detail: update.stderr || update.stdout,
    }
  }
  return {
    ok: true,
    action: "submodules_updated",
    message: "已同步子模块追踪的提交。",
    pending,
  }
}

/**
 * Check whether tracked submodules have commits newer than the parent pointer.
 * This is intentionally read/notify-only: startup must never rewrite the checkout.
 */
export async function checkTrackedSubmoduleRemoteUpdates(options = {}) {
  const {
    cwd = rootPath,
    outputLimit = DEFAULT_OUTPUT_LIMIT,
    runner = runGit,
    notify = true,
    config = {},
  } = options

  const listed = await runner(["submodule", "status", "--recursive"], {
    cwd,
    outputLimit,
    allowFailure: true,
  })
  if (listed.code !== 0) {
    return { ok: false, action: "submodule_status_failed", updates: [], message: "无法读取子仓库状态。" }
  }

  const updates = []
  for (const line of splitLines(listed.stdout)) {
    const match = line.match(/^[+\-U]?([0-9a-f]+)\s+([^\s]+)/i)
    if (!match) continue
    const submodulePath = match[2]
    const submoduleCwd = pathJoin(cwd, submodulePath)
    const remote = await runner(["remote", "update", "--prune"], {
      cwd: submoduleCwd,
      outputLimit,
      allowFailure: true,
    })
    if (remote.code !== 0) continue
    const head = await runner(["rev-parse", "HEAD"], { cwd: submoduleCwd, outputLimit, allowFailure: true })
    const upstream = await runner(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "origin/HEAD"], {
      cwd: submoduleCwd,
      outputLimit,
      allowFailure: true,
    })
    if (head.code !== 0 || upstream.code !== 0) continue
    const counts = await runner(["rev-list", "--left-right", "--count", `HEAD...${upstream.stdout.trim()}`], {
      cwd: submoduleCwd,
      outputLimit,
      allowFailure: true,
    })
    const [ahead, behind] = parseAheadBehind(counts.stdout)
    if (behind > 0) updates.push({ path: submodulePath, ahead, behind, head: head.stdout.trim().slice(0, 12), upstream: upstream.stdout.trim() })
  }

  const result = {
    ok: true,
    action: updates.length ? "submodules_behind_remote" : "submodules_current",
    updates,
    message: updates.length ? `检测到 ${updates.length} 个子仓库有未同步提交。` : "子仓库均已同步到远端。",
  }
  if (notify && updates.length) await notifySubmoduleUpdates(updates, config)
  return result
}

async function notifySubmoduleUpdates(updates, config = {}) {
  // 只通知主人（master 映射里的人），不广播给其它 master / 管理员
  const owners = collectOwnerIds(config)
  if (!owners.length) return
  const lines = updates.map(item => `- ${item.path}: 落后 ${item.behind} 个提交（当前 ${item.head}）`)
  const message = `[荷花插件]开机检测发现子仓库未同步：\n${lines.join("\n")}\n请手动更新并检查主项目引用的 commit。`
  for (const owner of owners) {
    // onlyKnownFriend:true → 非好友主人直接跳过，不再出现红叹号发送失败
    const result = await notifyUser(owner, message, { prefer: "private", onlyKnownFriend: true }).catch(error => ({ ok: false, reason: error.message }))
    if (result && result.ok !== true && result.reason && result.reason !== "not_friend") {
      globalThis.logger?.warn?.(`[Lotus-Plugin] submodule update notification failed: ${result.reason}`)
    }
  }
}

// 只取主人（other.yaml 的 master 映射：`botWxid:ownerWxid` 取冒号后的 owner；纯 wxid/QQ 直接取）
function collectOwnerIds(config = {}) {
  const runtime = globalThis.Bot?.config || globalThis.Bot?.cfg || {}
  const raw = [
    ...(Array.isArray(config.master) ? config.master : []),
    ...(Array.isArray(runtime.master) ? runtime.master : []),
  ]
  const owners = []
  for (const entry of raw) {
    const str = String(entry ?? "").trim()
    if (!str || str === "stdin") continue
    const colon = str.indexOf(":")
    owners.push(colon >= 0 ? str.slice(colon + 1).trim() : str)
  }
  // 兜底：master 映射为空时退回 masterQQ 里的主人（排除 stdin 占位符）
  if (!owners.length) {
    const qqRaw = [
      ...(Array.isArray(config.masterQQ) ? config.masterQQ : []),
      ...(Array.isArray(runtime.masterQQ) ? runtime.masterQQ : []),
    ]
    for (const entry of qqRaw) {
      const str = String(entry ?? "").trim()
      if (str && str !== "stdin") owners.push(str)
    }
  }
  return [...new Set(owners.filter(Boolean))]
}

function pathJoin(base, child) {
  return `${String(base).replace(/[\\/]$/, "")}/${String(child).replace(/\\/g, "/")}`
}

export function runGit(args, options = {}) {
  const {
    cwd = rootPath,
    allowFailure = false,
    outputLimit = DEFAULT_OUTPUT_LIMIT,
  } = options
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""

    child.stdout.on("data", chunk => {
      stdout = appendLimited(stdout, chunk, outputLimit)
    })
    child.stderr.on("data", chunk => {
      stderr = appendLimited(stderr, chunk, outputLimit)
    })
    child.on("error", reject)
    child.on("close", code => {
      const result = {
        code,
        stdout,
        stderr,
        args,
      }
      if (code === 0 || allowFailure) {
        resolve(result)
        return
      }
      const error = new Error(`git ${args.join(" ")} failed: ${stderr || stdout || code}`)
      error.result = result
      reject(error)
    })
  })
}

async function latestCommit(runner, cwd, outputLimit) {
  const result = await runner(["log", "-1", "--pretty=%h %s"], {
    cwd,
    outputLimit,
    allowFailure: true,
  })
  return result.stdout.trim()
}

function parseAheadBehind(output = "") {
  const [ahead = 0, behind = 0] = output.trim().split(/\s+/).map(Number)
  return [Number.isFinite(ahead) ? ahead : 0, Number.isFinite(behind) ? behind : 0]
}

function splitLines(text = "") {
  return String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

function splitStatusLines(text = "") {
  return String(text || "").split(/\r?\n/).filter(line => line.trim())
}

function partitionDirtyStatus(lines = []) {
  const ignored = []
  const blocking = []
  for (const line of lines) {
    if (isIgnoredDirtyStatus(line)) ignored.push(line.trim())
    else blocking.push(line.trim())
  }
  return { blocking, ignored }
}

function isIgnoredDirtyStatus(line = "") {
  const normalized = String(line || "").replace(/\\/g, "/")
  const code = normalized.slice(0, 2)
  const file = normalized.slice(3).trim()
  if (file === "services/starRailTeamDamage/data/system-data.json") return true
  if (file === "test_nine" && /[m?]/.test(code)) return true
  if (file.startsWith("test_nine/") && code.includes("?")) return true
  return false
}

/**
 * 子模块隔离同步（启动路径专用）
 *
 * 借鉴 AxiuCN/Atlas-Plugin「按 gitlink 逐个同步、失败不影响其它模块」的思路，独立实现。
 * 原 syncTrackedSubmodules 对全部子模块一次性执行 `submodule update --init --recursive`：
 * 只要有一个子仓库损坏（本机 MihoyoBBSTools 就处于这种状态），整条命令失败，
 * 连本来正常的 nanoka-atlas-backend 也得不到单独处理，启动日志只剩一句
 * 「子模块提交不匹配，但自动更新失败」。
 *
 * 这里改为：读一次 status → 只对 + / - / U 的条目逐个 `submodule update --init <path>`，
 * 每个结果独立记录；不带 --recursive，不触碰子模块内的 data/。
 */
export async function syncSubmodulesIsolated(options = {}) {
  const {
    cwd = rootPath,
    outputLimit = DEFAULT_OUTPUT_LIMIT,
    runner = runGit,
  } = options

  const status = await runner(["submodule", "status"], { cwd, outputLimit, allowFailure: true })
  if (status.code !== 0) {
    return {
      ok: false,
      action: "submodule_status_failed",
      synced: [],
      failed: [],
      results: [],
      message: "无法读取子模块状态。",
      detail: (status.stderr || status.stdout || "").trim().slice(0, 300),
    }
  }

  // splitLines 会 trim 行首空白，所以「已同步」行以 hash 开头；+/-/U 前缀仍保留
  const entries = []
  for (const line of splitLines(status.stdout)) {
    const match = line.match(/^([+\-U]?)([0-9a-fA-F]{7,40})\s+(\S+)/)
    if (!match) continue
    entries.push({ state: match[1] || " ", hash: match[2], path: match[3] })
  }
  const pending = entries.filter(entry => entry.state !== " ")
  if (!pending.length) {
    return {
      ok: true,
      action: "submodules_up_to_date",
      synced: [],
      failed: [],
      results: [],
      message: "子模块提交已同步。",
    }
  }

  const synced = []
  const failed = []
  const results = []
  for (const entry of pending) {
    let update
    try {
      update = await runner(["submodule", "update", "--init", entry.path], {
        cwd,
        outputLimit,
        allowFailure: true,
      })
    } catch (error) {
      update = { code: -1, stdout: "", stderr: error?.message || String(error) }
    }
    const ok = update.code === 0
    results.push({
      path: entry.path,
      state: entry.state,
      ok,
      detail: (update.stderr || update.stdout || "").trim().slice(0, 200),
    })
    if (ok) synced.push(entry.path)
    else failed.push(entry.path)
  }

  return {
    ok: failed.length === 0,
    action: failed.length ? "submodules_partial" : "submodules_updated",
    synced,
    failed,
    results,
    message: failed.length
      ? `已同步 ${synced.length}/${pending.length} 个子模块；失败：${failed.join(", ")}（不影响其它模块，下次启动重试）`
      : `已同步 ${synced.length} 个子模块。`,
  }
}

function appendLimited(current, chunk, limit) {
  const next = current + chunk.toString("utf8")
  if (next.length <= limit) return next
  return next.slice(0, limit)
}
