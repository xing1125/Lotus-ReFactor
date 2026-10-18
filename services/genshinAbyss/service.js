import crypto from "node:crypto"
import { deviceHeaders } from "../../core/devices/service.js"
import { getDs2 } from "../../core/mihoyo/ds.js"
import { isCnServer, resolveServer } from "../../core/mihoyo/regions.js"
import { getRoleUid, pickRole } from "../pluginBridge/common.js"

// 原神深境螺旋战绩 —— 数据链路镜像 services/starRailChallenge/service.js（同一套 mihoyo game_record 请求栈），
// 端点换成 genshin 的 `api/spiralAbyss`（本期 schedule_type=1 / 上期 =2），另拉 `api/index` 取命座数。
// UI 蓝本：genshin 插件 `resources/Genshin/html/abyss/abyss.{html,css}`（深蓝 #07091B + 层卡 #1C1B3D）。
const CN_DS_SALT = "xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs"
const OS_DS_SALT = "okr4obncj8bw5a65hbnn5oo6ixjc3l9w"

const RANK_META = Object.freeze([
  { key: "defeat", label: "最多击破" },
  { key: "take_damage", label: "承受最多伤害" },
  { key: "normal_skill", label: "元素战技施放数" },
  { key: "damage", label: "最强一击" },
  { key: "energy_skill", label: "元素爆发次数" },
])
const FLOOR_INDEXES = [9, 10, 11, 12]

export class GenshinAbyssService {
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch
  }

  async queryProfile({ profile, profileId = 1, command = "#深渊" } = {}) {
    if (!this.fetch) throw new Error("fetch is unavailable")
    const parsed = parseGenshinAbyssCommand(command)
    const role = pickRole(profile, "gs")
    const uid = getRoleUid(role)
    if (!uid) throw new Error(`profile ${profileId} 没有同步原神 UID`)
    const cookie = profile?.account?.cookie
    if (!cookie) throw new Error(`profile ${profileId} 未保存 cookie`)

    const server = resolveServer({ server: role?.region, uid, game: "gs" })
    const context = {
      uid,
      server,
      isCn: isCnServer(server),
      cookie,
      profile,
      deviceFp: profile?.device?.fp || fallbackDeviceFp(profile),
      deviceId: profile?.device?.id || fallbackDeviceId(cookie),
    }

    const [abyssRes, indexRes] = await Promise.all([
      this.requestGameRecord({ ...context, endpoint: "spiralAbyss", scheduleType: parsed.scheduleType }),
      this.requestGameRecord({ ...context, endpoint: "index" }).catch(() => null),
    ])
    if (!isOkResponse(abyssRes)) throw mihoyoResponseError(abyssRes, "深境螺旋")

    const data = abyssRes.data || {}
    if (Number(data.total_battle_times || 0) <= 0) throw new Error(`UID:${uid} 本期暂无挑战数据`)
    if (!Array.isArray(data.damage_rank) || !data.damage_rank.length) throw new Error(`UID:${uid} 数据还没更新，请稍后再试`)

    const consById = new Map()
    for (const avatar of (indexRes?.data?.avatars || [])) {
      if (avatar?.id !== undefined) consById.set(Number(avatar.id), Number(avatar.actived_constellation_num || 0))
    }

    return {
      ok: true,
      profileId,
      uid,
      command,
      parsed,
      renderData: buildGenshinAbyssRenderData({ uid, profileId, command, parsed, data, consById }),
    }
  }

  async requestGameRecord({ uid, server, isCn, cookie, profile, deviceFp, deviceId, endpoint, scheduleType } = {}) {
    const host = isCn ? "https://api-takumi-record.mihoyo.com" : "https://bbs-api-os.hoyolab.com"
    const query = new URLSearchParams({ role_id: uid, server })
    if (scheduleType !== undefined) query.set("schedule_type", String(scheduleType))
    const queryText = query.toString()
    const url = `${host}/game_record/app/genshin/api/${endpoint}?${queryText}`
    const response = await this.fetch(url, {
      method: "GET",
      headers: buildHeaders({ query: queryText, isCn, cookie, profile, deviceFp, deviceId }),
    })
    if (!response?.ok) throw new Error(`深境螺旋接口 HTTP ${response?.status || "请求失败"}`)
    return response.json()
  }
}

export function parseGenshinAbyssCommand(command = "") {
  const text = String(command || "").trim()
  const last = /上期|往期/.test(text)
  return { last, scheduleType: last ? 2 : 1, normalized: text }
}

export function buildGenshinAbyssRenderData({ uid, profileId, command, parsed, data = {}, consById = new Map() } = {}) {
  const rankOf = key => {
    const entry = (data[`${key}_rank`] || [])[0] || {}
    return { key, num: entry.value ?? 0, icon: entry.avatar_icon || "" }
  }
  const floors = []
  const byIndex = new Map((Array.isArray(data.floors) ? data.floors : []).map(f => [Number(f.index), f]))
  for (const index of FLOOR_INDEXES) {
    const floor = byIndex.get(index)
    if (!floor) continue
    const rooms = (Array.isArray(floor.levels) ? floor.levels : [])
      .filter(level => Array.isArray(level?.battles) && level.battles.length >= 2)
      .map(level => ({
        index: level.index,
        star: Number(level.star || 0),
        time: formatStamp(level.battles?.[0]?.timestamp),
        halves: level.battles.map(battle => ({
          label: Number(battle.index) === 1 ? "上半" : "下半",
          avatars: (battle.avatars || []).map(a => ({
            icon: a.icon || "",
            level: a.level ?? "—",
            rarity: Number(a.rarity || 5),
            life: consById.get(Number(a.id)) || 0,
          })),
          monsters: (Number(battle.index) === 1 ? level.top_half_floor_monster : level.bottom_half_floor_monster || [])
            .map(m => ({ icon: m.icon || "", level: m.level ?? "—" })),
        })),
      }))
    floors.push({
      index,
      star: Number(floor.star || 0),
      maxStar: Number(floor.max_star || 9),
      leyLine: Array.isArray(floor.ley_line_disorder) ? floor.ley_line_disorder.filter(Boolean) : [],
      rooms,
    })
  }
  return {
    title: parsed?.last ? "深境螺旋战绩 · 上期" : "深境螺旋战绩",
    subtitle: `UID ${uid} · profile ${profileId}`,
    badge: "GS",
    message: `${command || ""}${parsed?.last ? " · 上期" : ""}`,
    uid,
    profileId,
    period: formatPeriod(data.start_time, data.end_time),
    maxFloor: data.max_floor || "—",
    totalBattleTimes: data.total_battle_times ?? 0,
    totalStar: data.total_star ?? 0,
    reveal: (data.reveal_rank || []).slice(0, 8).map(r => ({
      icon: r.avatar_icon || "",
      value: r.value ?? 0,
      rarity: Number(r.rarity || 5),
    })),
    ranks: RANK_META.map(meta => ({ ...rankOf(meta.key), label: meta.label })),
    floors,
    source: "米游社 · 深境螺旋",
  }
}

// ---------------- 内部 ----------------
function buildHeaders({ query = "", isCn = true, cookie = "", profile = {}, deviceFp = "", deviceId = "" } = {}) {
  const cn = {
    appVersion: "2.73.1",
    userAgent: "Mozilla/5.0 (Linux; Android 13; XQ-BC52 Build/61.2.A.0.472A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/111.0.5563.116 Mobile Safari/537.36 miHoYoBBS/2.73.1",
    clientType: "5",
    origin: "https://webstatic.mihoyo.com",
    referer: "https://webstatic.mihoyo.com/",
    salt: CN_DS_SALT,
  }
  const os = {
    appVersion: "2.57.1",
    userAgent: "Mozilla/5.0 (Linux; Android 13; XQ-BC52 Build/61.2.A.0.472A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/111.0.5563.116 Mobile Safari/537.36 miHoYoBBSOversea/2.57.1",
    clientType: "2",
    origin: "https://act.hoyolab.com",
    referer: "https://act.hoyolab.com/",
    salt: OS_DS_SALT,
  }
  const client = isCn ? cn : os
  const headers = {
    "x-rpc-app_version": client.appVersion,
    "x-rpc-client_type": client.clientType,
    "User-Agent": client.userAgent,
    Referer: client.referer,
    Origin: client.origin,
    DS: getDs2(query, "", client.salt),
    Cookie: cookie,
    ...deviceHeaders(profile.device),
  }
  headers["x-rpc-device_fp"] ||= deviceFp
  headers["x-rpc-device_id"] ||= deviceId
  headers["x-rpc-device_name"] ||= profile.device?.name || "Sony XQ-BC52"
  headers["x-rpc-device_model"] ||= profile.device?.model || "XQ-BC52"
  headers["x-rpc-csm_source"] = "myself"
  return headers
}

function isOkResponse(res = {}) {
  return Number(res?.retcode) === 0
}

function mihoyoResponseError(res = {}, label = "深境螺旋") {
  const retcode = Number(res?.retcode)
  const message = res?.message || "接口返回异常"
  if (retcode === 1034 || retcode === 10035) return new Error(`${label}遇到验证码：${message}`)
  if (retcode === 10041 || retcode === 5003) return new Error(`${label}账号异常，暂时无法查询`)
  if (retcode === 10102) return new Error(`${label}数据未公开或未绑定角色`)
  if (retcode === 10104) return new Error(`${label}尚未开通本期深境记录`)
  return new Error(`${label}查询失败：${message}`)
}

function formatStamp(timestamp) {
  const ms = Number(timestamp) * 1000
  if (!Number.isFinite(ms) || ms <= 0) return ""
  const d = new Date(ms)
  const p = v => String(v).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function formatPeriod(start, end) {
  if (!start || !end) return ""
  const fmt = ts => {
    const d = new Date(Number(ts) * 1000)
    if (!Number.isFinite(d.getTime())) return ""
    const p = v => String(v).padStart(2, "0")
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
  }
  return `${fmt(start)}-${fmt(end)}`
}

function fallbackDeviceId(seed = "") {
  return crypto.createHash("md5").update(String(seed || "lotus-gs-device")).digest("hex").slice(0, 32)
}

function fallbackDeviceFp(profile = {}) {
  const seed = `${profile?.user?.qq || ""}:${profile?.profile?.id || 1}:${profile?.account?.ltuid || ""}`
  return `38${crypto.createHash("md5").update(seed || "lotus").digest("hex").slice(0, 11)}`
}
