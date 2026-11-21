/**
 * 图鉴更新任务队列：并发互斥 + 冷却保护 + 后台执行 + 完成回调
 *
 * 设计借鉴 AxiuCN/Atlas-Plugin 的「后台异步抓取、完成后通知」思路，独立实现。
 * 背景：nanoka-atlas-backend 的 scrape.mjs 全量抓取最长 30 分钟，且 full 模式会
 * 先删除 data/items、gallery 再重建；两个任务并发会互相破坏数据，指令侧 await
 * 也会让机器人假死。所以所有更新入口（手动 + cron + 启动挑战）统一走这里。
 *
 * 注意：本模块不 await 抓取任务，提交后立即返回；异常全部内部兜住，
 * 不会产生 unhandled rejection。
 */
import { AtlasUpdateService } from './update.js'
import { collectAtlasStats, diffAtlasStats } from './stats.js'

const DEFAULT_COOLDOWN_MS = 60_000

let running = null
const lastFinished = new Map()

export function getAtlasTaskState() {
  return {
    running: running ? { ...running } : null,
    lastFinished: Object.fromEntries(lastFinished),
  }
}

/**
 * 提交一个图鉴更新任务。
 * @param {object} options
 * @param {object} options.config global.yaml 的 atlas 配置
 * @param {'check'|'initial'|'incremental'|'challenge'} options.mode
 * @param {string} options.label 任务标签，仅用于日志
 * @param {(result:object)=>Promise<void>|void} options.onDone 完成后回调（发结果图 / 刷新路由 / 通知）
 * @returns {{started:boolean, taskId?:string, reason?:string, retryAfterMs?:number, result?:Promise<object>}}
 */
export function submitAtlasUpdate({ config = {}, mode = 'check', label = '图鉴更新', onDone } = {}) {
  if (running) {
    return { started: false, reason: 'update_in_progress', taskId: running.taskId }
  }

  const cooldownMs = Number(config?.auto_update?.cooldown_ms ?? config?.cooldown_ms ?? DEFAULT_COOLDOWN_MS)
  const previous = lastFinished.get(mode) || 0
  const elapsed = Date.now() - previous
  if (previous && cooldownMs > 0 && elapsed < cooldownMs) {
    return { started: false, reason: 'cooldown', retryAfterMs: cooldownMs - elapsed }
  }

  const taskId = `atlas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const startedAt = Date.now()
  running = { taskId, mode, label, startedAt }

  const task = (async () => {
    let result
    let before = null
    // 更新前快照：必须在 scrape 之前取，full 模式会删掉 data/items 与 gallery
    try {
      before = await collectAtlasStats(config)
    } catch (error) {
      globalThis.logger?.debug?.(`[Lotus-Plugin] atlas stats before failed: ${error?.message || error}`)
    }
    try {
      const service = new AtlasUpdateService()
      result = mode === 'check'
        ? await service.checkAndRun(config)
        : await service.run(config, { mode })
    } catch (error) {
      result = { ok: false, reason: 'exception', message: error?.message || String(error) }
      globalThis.logger?.warn?.(`[Lotus-Plugin] atlas task ${taskId} error: ${result.message}`)
    } finally {
      lastFinished.set(mode, Date.now())
      running = null
    }

    // 更新后快照：结果卡据此给出逐游戏旧→新版本 / 条目与图片增减 / 「无变化」。
    // 统计失败只影响展示，绝不影响更新结果本身或完成通知。
    try {
      const after = await collectAtlasStats(config)
      result.stats = { before, after, diff: diffAtlasStats(before, after) }
    } catch (error) {
      result.stats = { error: error?.message || String(error) }
    }
    result.durationMs = Date.now() - startedAt

    if (typeof onDone === 'function') {
      try {
        await onDone(result)
      } catch (error) {
        globalThis.logger?.warn?.(`[Lotus-Plugin] atlas task ${taskId} onDone failed: ${error?.message || error}`)
      }
    }
    return result
  })()

  // 显式挂一个 catch，确保极端情况下也不会有未处理的 Promise 拒绝
  void task.catch(() => {})
  return { started: true, taskId, result: task }
}

/** 仅用于自检 / 诊断：重置队列状态，不影响正在运行的任务本体 */
export function resetAtlasTaskStateForTest() {
  lastFinished.clear()
}
