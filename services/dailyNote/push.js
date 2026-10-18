// 体力推送服务（ji-plugin「体力推送」移植，纯 JS 落地为 Lotus 的 service）
//
// 对照 ji-plugin 的 apps/note.js（noteconfig/noteResin）+ model/note.js（NoteTask）：
//   - 配置持久化：ji 用 Cfg.note（self_id → user_id → group_id → { gs/sr/zzz 数组 + 阈值 }），
//     这里落地为 Lotus 的 data/resin-push.json（bot → user → group → { games, thresholds, uids }）。
//   - 阈值语义与 ji 完全一致：体力「达到/超过」阈值才推送（当前 >= 阈值）。
//   - 去重：ji 用 redis sendkey + sendCD(小时) 冷却；这里落地为文件内 lastPushAt 时间戳，冷却窗口读 global.resin_push.cooldown_hours。
//   - 通知通道：复用 core/transport/notify.js 的 notifyUser（优先私聊，失败落群兜底），
//     并支持 global.resin_push.push_to 决定「私聊/群」偏好。
//
// 命令（apps/dailyNote.js 挂载）：
//   #开启体力推送 [uid] / #关闭体力推送 [uid]    （可前缀 原神/星铁/绝区零）
//   #体力推送阈值 <n>                            （可前缀 原神/星铁/绝区零）
import fs from "node:fs/promises"
import path from "node:path"
import { resolveData } from "../../core/path.js"
import { loadGlobalConfig } from "../../core/config/global.js"
import { listProfileIds, loadProfile } from "../../core/config/profile.js"
import { DailyNoteService } from "./service.js"
import { buildDailyNoteRenderData } from "../../apps/dailyNote.js"
import { renderTemplate } from "../../core/render/service.js"
import { notifyUser } from "../../core/transport/notify.js"

const PUSH_FILE = "resin-push.json"

// 默认阈值（与 ji Cfg.cof 的 gs_Resin/sr_Resin/zzz_Resin 对齐；不足时用全局兜底）
const DEFAULT_THRESHOLD = { gs: 160, sr: 240, zzz: 240 }

// 体力字段映射：queryDailyNote 返回 data 里的「当前体力」字段
const RESIN_FIELD = {
  gs: "current_resin",
  sr: "current_stamina",
  zzz: "current_energy", // zzz 走 data.energy.current，下面单独处理
}

const GAME_NAME = { gs: "原神", sr: "星铁", zzz: "绝区零" }

export class ResinPushService {
  constructor(options = {}) {
    this.file = options.file || resolveData(PUSH_FILE)
    this.force = Boolean(options.force)
  }

  // ---- 配置读写 ----

  async loadPushConfig() {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8"))
    } catch (error) {
      if (error?.code === "ENOENT") return {}
      throw error
    }
  }

  async savePushConfig(config) {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await fs.writeFile(this.file, JSON.stringify(config, null, 2), "utf8")
  }

  // 定位某个 bot/群/用户 的推送配置块（懒创建）
  getOrCreateBlock(config, botId, userId, groupId) {
    config[botId] ||= {}
    config[botId][userId] ||= {}
    config[botId][userId][groupId] ||= {
      uids: { gs: [], sr: [], zzz: [] },
      thresholds: { ...DEFAULT_THRESHOLD },
      lastPushAt: {},
    }
    return config[botId][userId][groupId]
  }

  // ---- 阈值 ----

  async defaultThresholds() {
    const cfg = await loadGlobalConfig().catch(() => ({}))
    const rc = cfg?.resin_push || {}
    return {
      gs: Number(rc.gs_threshold || DEFAULT_THRESHOLD.gs),
      sr: Number(rc.sr_threshold || DEFAULT_THRESHOLD.sr),
      zzz: Number(rc.zzz_threshold || DEFAULT_THRESHOLD.zzz),
    }
  }

  // ---- 开启 / 关闭 / 阈值 操作（供 app 命令调用）----

  async enable({ botId, userId, groupId, game, uid }) {
    const config = await this.loadPushConfig()
    const block = this.getOrCreateBlock(config, botId, userId, groupId)
    if (!Array.isArray(block.uids[game])) block.uids[game] = []
    if (!block.uids[game].includes(uid)) block.uids[game].push(uid)
    if (!block.thresholds[game]) block.thresholds[game] = (await this.defaultThresholds())[game]
    await this.savePushConfig(config)
    return block
  }

  async disable({ botId, userId, groupId, game, uid }) {
    const config = await this.loadPushConfig()
    const block = config?.[botId]?.[userId]?.[groupId]
    if (!block) return { removed: false, empty: true }
    const list = Array.isArray(block.uids?.[game]) ? block.uids[game] : []
    const index = list.indexOf(uid)
    const removed = index !== -1
    if (removed) list.splice(index, 1)
    await this.pruneEmpty(config, botId, userId, groupId)
    await this.savePushConfig(config)
    return { removed, empty: !config[botId]?.[userId]?.[groupId] }
  }

  async setThreshold({ botId, userId, groupId, game, threshold }) {
    const config = await this.loadPushConfig()
    const block = this.getOrCreateBlock(config, botId, userId, groupId)
    block.thresholds[game] = threshold
    await this.savePushConfig(config)
    return block
  }

  pruneEmpty(config, botId, userId, groupId) {
    const block = config?.[botId]?.[userId]?.[groupId]
    if (!block) return
    const hasUid = Object.values(block.uids || {}).some(list => list?.length)
    if (!hasUid) {
      delete config[botId][userId][groupId]
      if (!Object.keys(config[botId][userId]).length) delete config[botId][userId]
      if (!Object.keys(config[botId]).length) delete config[botId]
    }
  }

  // ---- 定时扫描：遍历所有开启推送的配置，体力达标就发图 ----

  async runPush({ bot, now = new Date() } = {}) {
    const config = await this.loadPushConfig()
    if (!Object.keys(config).length) return { pushed: 0, scanned: 0 }

    const globalConfig = await loadGlobalConfig().catch(() => ({}))
    const rc = globalConfig?.resin_push || {}
    const enabled = rc.enable !== false
    if (!enabled) return { pushed: 0, scanned: 0, disabled: true }

    const cooldownHours = Number(rc.cooldown_hours ?? 6)
    const cooldownMs = cooldownHours * 3600 * 1000
    const nowMs = now.getTime()

    let scanned = 0
    let pushed = 0
    const results = []

    for (const botId of Object.keys(config)) {
      const users = config[botId]
      for (const userId of Object.keys(users)) {
        for (const groupId of Object.keys(users[userId])) {
          const block = users[userId][groupId]
          const uids = block.uids || {}
          const thresholds = block.thresholds || {}

          for (const game of Object.keys(uids)) {
            for (const uid of uids[game]) {
              scanned++
              const key = `${game}:${uid}`
              const lastPush = Number(block.lastPushAt?.[key] || 0)
              if (lastPush && nowMs - lastPush < cooldownMs) continue

              const outcome = await this.tryPushOne({
                bot,
                userId,
                groupId,
                game,
                uid,
                threshold: Number(thresholds[game]),
              })
              if (outcome.pushed) {
                pushed++
                block.lastPushAt ||= {}
                block.lastPushAt[key] = nowMs
                await this.savePushConfig(config)
              }
              results.push(outcome)
            }
          }
        }
      }
    }

    return { pushed, scanned, results }
  }

  async tryPushOne({ bot, userId, groupId, game, uid, threshold }) {
    const profileIds = await listProfileIds(userId).catch(() => [])
    let matched = null
    for (const profileId of profileIds) {
      const profile = await loadProfile(userId, profileId).catch(() => null)
      if (!profile?.account?.cookie) continue
      const roles = normalizeRoles(profile.account?.game_roles?.[game])
      const role = roles.find(r => String(r.uid || r.game_uid || r) === String(uid))
      if (!role) continue
      matched = { profile, role, profileId }
      break
    }
    if (!matched) {
      return { pushed: false, game, uid, reason: "profile_not_found" }
    }

    const service = new DailyNoteService()
    const res = await service.queryDailyNote(matched.profile, game, matched.role)
    if (!res.ok) {
      return { pushed: false, game, uid, reason: "query_failed", error: res.error }
    }

    const current = currentResin(game, res.data)
    if (current === null || current < threshold) {
      return { pushed: false, game, uid, reason: "below_threshold", current, threshold }
    }

    // 达标：渲染单人 daily-note 卡并推送
    const renderData = buildDailyNoteRenderData({
      userId,
      profileId: matched.profileId,
      games: [game],
      results: [{ ...res, uid, game }],
    })
    const image = await renderTemplate("daily-note-summary", renderData, {
      saveId: `lotus-resin-push-${userId}-${game}-${uid}`,
    })

    const sent = await notifyUser(userId, image, {
      bot,
      prefer: "group",
      groups: [groupId],
      at: true,
      sourceEvent: { group_id: groupId },
    })

    if (sent.ok) {
      return { pushed: true, game, uid, current, threshold, channel: sent.channel }
    }
    return { pushed: false, game, uid, reason: "notify_failed", sentReason: sent.reason }
  }
}

function normalizeRoles(roles = []) {
  if (!Array.isArray(roles)) return []
  return roles
    .map(role => typeof role === "object" ? role : { uid: role })
    .filter(role => role.uid || role.game_uid)
}

function currentResin(game, data = {}) {
  if (game === "zzz") {
    const energy = data.energy?.progress || data.energy || {}
    const value = Number(energy.current)
    return Number.isFinite(value) ? value : null
  }
  const field = RESIN_FIELD[game]
  const value = Number(data?.[field])
  return Number.isFinite(value) ? value : null
}

export const RESIN_GAME_NAME = GAME_NAME
