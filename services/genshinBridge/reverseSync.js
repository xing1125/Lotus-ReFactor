/**
 * genshin → Lotus 反向桥接服务
 *
 * 从 genshin 插件的 DB (NoteUser / MysUser) 中读取所有 QQ 绑定的账号信息，
 * 同步到荷花档案（Lotus profile），实现双向数据贯通。
 *
 * 策略：只补缺不覆盖 — 如果荷花 profile 已有 ltuid/cookie/game_roles，则跳过；
 * 只有荷花侧缺失时才从 genshin 侧写入。
 */

import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  ensureProfile,
  loadProfile,
  saveProfile,
  listProfileIds,
  hasProfileLogin,
} from "../../core/config/profile.js"

/**
 * 执行全量反向同步：genshin → Lotus
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]  只统计不同步
 * @param {string}  [options.filterQq]      只同步指定 QQ
 * @returns {Promise<{synced:number, skipped:number, failed:number, details:Array}>}
 */
export async function syncGenshinToLotus({ dryRun = false, filterQq } = {}) {
  const { NoteUser, MysUser } = await loadGenshinModels()

  const result = { synced: 0, skipped: 0, failed: 0, details: [] }

  // 遍历 genshin DB 中所有用户
  await NoteUser.forEach(async (noteUser) => {
    const qq = String(noteUser.qq || "")
    if (!qq) return
    if (filterQq && qq !== filterQq) return

    try {
      const syncResult = await syncSingleUser({ qq, noteUser, MysUser, dryRun })
      if (syncResult.synced) {
        result.synced++
      } else if (syncResult.skipped) {
        result.skipped++
      }
      result.details.push({ qq, ...syncResult })
    } catch (err) {
      result.failed++
      result.details.push({ qq, ok: false, error: err.message })
    }
  })

  return result
}

/**
 * 同步单个 QQ 用户：从 genshin NoteUser → Lotus profile
 *
 * 策略：
 * - 如果荷花 profile 1 已有完整登录信息（cookie + stoken），跳过
 * - 如果荷花 profile 没有登录信息，从 genshin 侧 MysUser 中取 cookie/ltuid/uids 写入
 * - 如果同一个 QQ 在 genshin 绑定了多个 ltuid（多 CK），写入 profile 1（主 CK）
 * - 只补缺，不覆盖已有字段
 */
async function syncSingleUser({ qq, noteUser, MysUser, dryRun }) {
  // 1) 检查荷花侧 profile 1 是否已有登录
  let lotusProfile
  try {
    lotusProfile = await loadProfile(qq, 1)
  } catch {
    lotusProfile = null
  }

  // 已有完整登录 → 跳过
  if (lotusProfile && hasProfileLogin(lotusProfile)) {
    return { skipped: true, reason: "lotus_already_has_login" }
  }

  // 2) 从 genshin 侧获取 MysUser 列表
  const mysUsers = noteUser.mysUsers || {}
  const ltuidKeys = Object.keys(mysUsers).filter(k => mysUsers[k] && mysUsers[k].ck)

  if (ltuidKeys.length === 0) {
    return { skipped: true, reason: "no_mys_user_with_ck" }
  }

  // 取第一个有效 CK 作为主 CK（genshin 按绑定顺序，第一个通常是主号）
  const primaryMys = mysUsers[ltuidKeys[0]]
  const ltuid = String(primaryMys.ltuid)
  const cookie = primaryMys.ck || ""
  const type = primaryMys.type || "mys"

  if (!ltuid || !cookie) {
    return { skipped: true, reason: "empty_ltuid_or_cookie" }
  }

  // 3) 组装 game_roles
  const gameRoles = { gs: [], sr: [], zzz: [] }
  for (const ltuidKey of ltuidKeys) {
    const mys = mysUsers[ltuidKey]
    if (!mys || !mys.ck) continue

    // 从 MysUser 对象中提取各游戏 UID
    const uidMeta = mys.uidMeta || {}
    for (const game of ["gs", "sr", "zzz"]) {
      const uids = mys.uids?.[game] || []
      for (const uid of uids) {
        const meta = uidMeta[game]?.[uid] || {}
        // 避免重复 UID
        if (!gameRoles[game].some(r => String(r.uid || r) === String(uid))) {
          gameRoles[game].push({
            uid: String(uid),
            game_uid: String(uid),
            game_biz: meta.game_biz || "",
            region: meta.region || "",
            region_name: meta.region_name || "",
            nickname: meta.nickname || "",
            level: meta.level || "",
          })
        }
      }
    }
  }

  if (dryRun) {
    return { synced: false, dryRun: true, ltuid, gameRoles }
  }

  // 4) 确保荷花 profile 存在，写入数据
  const profile = lotusProfile || await ensureProfile({ qq })

  // 只补缺：如果荷花侧已有 ltuid/cookie，不覆盖
  const acct = profile.account || {}
  if (!acct.ltuid) acct.ltuid = ltuid
  if (!acct.stuid) acct.stuid = ltuid
  if (!acct.cookie) acct.cookie = cookie

  // 合并 game_roles：追加 genshin 侧有但荷花侧没有的 UID
  acct.game_roles = acct.game_roles || { gs: [], sr: [], zzz: [] }
  for (const game of ["gs", "sr", "zzz"]) {
    if (!Array.isArray(acct.game_roles[game])) acct.game_roles[game] = []
    for (const role of gameRoles[game]) {
      const uid = String(role.uid || role)
      if (!acct.game_roles[game].some(r => String(r.uid || r.game_uid || r) === uid)) {
        acct.game_roles[game].push(role)
      }
    }
  }

  // 补充 current_uid
  acct.current_uid = acct.current_uid || { gs: "", sr: "", zzz: "" }
  for (const game of ["gs", "sr", "zzz"]) {
    if (!acct.current_uid[game] && acct.game_roles[game].length > 0) {
      acct.current_uid[game] = String(acct.game_roles[game][0].uid || acct.game_roles[game][0])
    }
  }

  profile.account = acct
  await saveProfile(profile)

  return { synced: true, ltuid, uids: gameRoles }
}

/**
 * 同步指定 QQ 用户（命令触发用）
 */
export async function syncSingleQqUser(qq) {
  const { NoteUser, MysUser } = await loadGenshinModels()
  const noteUser = await NoteUser.create(String(qq))
  if (!noteUser || !noteUser.hasCk) {
    return { ok: false, reason: "no_genshin_account" }
  }
  const result = await syncSingleUser({ qq, noteUser, MysUser, dryRun: false })
  // 统一返回格式：synced → ok:true, skipped → ok:true + skipped:true
  if (result.synced) {
    return { ok: true, synced: true, ltuid: result.ltuid, uids: result.uids }
  }
  if (result.skipped) {
    return { ok: true, synced: false, skipped: true, reason: result.reason }
  }
  return { ok: false, reason: "unknown" }
}

/**
 * Bot 启动时自动同步：只补缺，只记录日志，不阻塞启动
 *
 * 如果 genshin 插件不存在或 DB 为空，静默跳过
 */
export async function autoSyncGenshinToLotus() {
  try {
    const { NoteUser } = await loadGenshinModels()
    const result = await syncGenshinToLotus()
    if (result.synced > 0) {
      logger?.mark?.(`[Lotus-Plugin] genshin→荷花自动同步完成：新同步 ${result.synced}，已有 ${result.skipped}，失败 ${result.failed}`)
    } else {
      logger?.debug?.(`[Lotus-Plugin] genshin→荷花自动同步：无新用户需同步（已有 ${result.skipped}）`)
    }
    return result
  } catch (err) {
    // genshin 插件不存在或 DB 未初始化 → 静默跳过
    logger?.debug?.(`[Lotus-Plugin] genshin→荷花自动同步跳过: ${err.message}`)
    return { synced: 0, skipped: 0, failed: 0, details: [] }
  }
}

async function loadGenshinModels() {
  const base = path.join(process.cwd(), "plugins", "genshin", "model", "mys")
  const NoteUser = (await import(pathToFileURL(path.join(base, "NoteUser.js")).href)).default
  const MysUser = (await import(pathToFileURL(path.join(base, "MysUser.js")).href)).default
  return { NoteUser, MysUser }
}
