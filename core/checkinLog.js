// 签到实时日志事件总线（内存态，不落盘）
//
// 供 apps/checkinDashboard.js 的 HTTP 接口消费：
//   - emitCheckinLog(event)  各签到链路打点（开始/完成/失败/批量开始/批量结束）
//   - getCheckinLogs(since)  拉取 since 序号之后的事件（前端轮询增量）
//   - getCheckinLogTail(n)   拉取最近 n 条
//
// 纯内存环形缓冲，进程重启即清空；持久化审计仍在 data/audit/checkin.jsonl。

import { formatLocalIso } from "./time.js"

const MAX_EVENTS = 500

/** @type {Array<{seq:number, t:string, type:string, qq:string, profileId:number, name?:string, ok?:boolean, message?:string}>} */
const events = []
let seq = 0

/**
 * 打点一条签到日志。
 * @param {object} event
 * @param {string} event.type  事件类型：batch-start / signing / done / resign-batch-start / resign-batch-end / notice
 * @param {string} [event.qq]
 * @param {number} [event.profileId]
 * @param {string} [event.name] 可选，打点侧顺手带上显示名；不带则由看板服务端解析
 * @param {boolean} [event.ok]
 * @param {string} [event.message]
 */
export function emitCheckinLog(event = {}) {
  try {
    events.push({
      seq: ++seq,
      t: formatLocalIso(),
      type: String(event.type || "notice"),
      qq: String(event.qq || ""),
      profileId: Number(event.profileId || 1),
      ...(event.name ? { name: String(event.name) } : {}),
      ...(event.ok === undefined ? {} : { ok: Boolean(event.ok) }),
      ...(event.message ? { message: String(event.message).slice(0, 300) } : {}),
    })
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  } catch {
    // 日志打点绝不能影响签到主链路
  }
}

/** 拉取 seq > since 的事件（增量轮询） */
export function getCheckinLogs(since = 0) {
  const from = Number(since) || 0
  return events.filter(e => e.seq > from)
}

/** 最近 n 条（时间正序） */
export function getCheckinLogTail(n = 50) {
  const count = Math.max(1, Math.min(Number(n) || 50, MAX_EVENTS))
  return events.slice(-count)
}

/** 当前最新 seq（前端首次加载用 tail，之后用 since=seq 增量） */
export function getCheckinLogSeq() {
  return seq
}
