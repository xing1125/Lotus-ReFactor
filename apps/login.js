import { refreshAccountAndSync, refreshAllAccountsAndSync, isAccountChangedError } from "../core/login/refresh.js"
const BasePlugin = globalThis.plugin

import QRCode from "qrcode"
import { LOTUS_INTERCEPT_PRIORITY } from "../core/intercept/priority.js"
import {
  listProfileIds,
  loadProfile,
  ensureProfile,
  saveProfile,
  MAX_PROFILE_ID,
  parseProfileIdFromMessage,
  PROFILE_ID_SUFFIX_PATTERN,
} from "../core/config/profile.js"
import { parseStokenCookie, parseAccountCookie } from "../core/mihoyo/cookies.js"
import { AccountService } from "../core/login/account.js"
import { ensureGeneratedProfileDevice } from "../core/devices/generated-profile.js"
import { QrLoginService } from "../core/login/qr.js"
import { renderStatusCard, renderTemplate } from "../core/render/service.js"
import { isProfileCheckinEnabled } from "../core/scheduler/service.js"
import { replyImage, replyText } from "../core/transport/reply.js"
import { registerProfileWithGenshin } from "../services/genshinBridge/profile.js"
import { ScheduledSigninService } from "../services/checkin/scheduled.js"
import { loadGlobalConfig } from "../core/config/global.js"
import { PermissionService } from "../core/permissions/service.js"

const loginLocks = new Map()

export class LotusLogin extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Login",
      dsc: "Lotus profile aware QR login",
      event: "message",
      priority: LOTUS_INTERCEPT_PRIORITY,
      rule: [
        {
          reg: `^#(扫码|二维码|辅助)(登录|绑定|登陆)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "qrLogin",
        },
        {
          reg: `^#?(米哈?游社?登(录|陆|入)|登(录|陆|入)米哈?游社?)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "qrLogin",
        },
        {
          reg: `^#?(账号密码|密码)(登录|登陆)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "passwordLoginRemoved",
        },
        {
          reg: "^#?(米哈?游社?登(录|陆|入)|登(录|陆|入)米哈?游社?).+$",
          fnc: "passwordLoginRemoved",
        },
        {
          reg: `^#刷新(c|ck|cookie|Cookie)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "refreshCookie",
        },
        {
          reg: `^#刷新自动签到${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "refreshCookie",
        },
        {
          reg: `^#(清除|删除)(登录|扫码登录|cookie|Cookie)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "clearLogin",
        },
        {
          reg: `^#同步(角色|UID|uid)${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "syncRoles",
        },
        {
          reg: `^#同步登录${PROFILE_ID_SUFFIX_PATTERN}$`,
          fnc: "syncBridge",
        },
        {
          reg: "^#(登录|账号)列表$",
          fnc: "loginList",
        },
      ],
    })
  }

  async qrLogin() {
    const e = this.e
    const target = { e }
    const userId = String(e.user_id)
    const explicit = /\d+$/.test(String(e.msg || ""))
    const profileIdInput = parseProfileIdFromMessage(e.msg)
    const lockKey = `${userId}:${explicit ? profileIdInput : "auto"}`

    if (loginLocks.has(lockKey)) {
      await replyText(target, explicit
        ? "[荷花插件]当前 profile 已有二维码等待确认，请稍后再试。"
        : "[荷花插件]已有二维码等待确认，请稍后再试。")
      return true
    }

    loginLocks.set(lockKey, Date.now())
    try {
      let existing = null
      let qr
      if (explicit) {
        await replyText(target, `[荷花插件]正在为 profile ${profileIdInput} 创建米游社登录二维码。`)
        existing = await loadProfile(userId, profileIdInput).catch(error => {
          if (error?.code === "ENOENT") return null
          throw new Error("登录档案读取失败，已保留原档案，请检查后重试")
        })
        try {
          if (!existing) existing = await ensureProfile({ qq: userId, profileId: profileIdInput, nickname: e.sender?.card || e.sender?.nickname || "" })
          existing = (await ensureGeneratedProfileDevice(userId, profileIdInput)).profile
        } catch {
          throw new Error("登录设备档案初始化失败，已保留原档案，请检查后重试")
        }
        qr = new QrLoginService({ device: existing.device || {} })
      } else {
        // 逍遥式扫码（默认路径）：确认后按账号身份自动识别——
        // 已绑定 → 原地更新；新号 → 自动分配下一个空 profile，无需任何编号。
        await replyText(target, "[荷花插件]正在创建米游社登录二维码，扫码确认后自动识别账号：已绑定 → 原地更新，新号 → 自动分配 profile。多次扫码即可绑定多个账号，无需带编号。")
        qr = new QrLoginService()
      }

      const created = await qr.create()
      const qrDataUrl = await QRCode.toDataURL(created.url, {
        margin: 1,
        scale: 10,
        errorCorrectionLevel: "M",
      })
      const image = await renderTemplate("qr-login", {
        profileId: explicit ? profileIdInput : undefined,
        subtitle: explicit ? undefined : "扫码后自动识别账号",
        qrDataUrl,
      }, {
        saveId: `lotus-qr-${userId}-${explicit ? profileIdInput : "auto"}`,
      })

      await replyImage(target, image, "请使用米游社 App 扫码完成登录。")
      const loginResult = await qr.waitConfirmed(created.ticket, {
        onScanned: async () => {
          await replyText(target, "[荷花插件]二维码已扫描，请在米游社 App 内确认登录。")
        },
      })

      let profileId = profileIdInput
      let autoNotice = ""
      let matched = null
      if (!explicit) {
        matched = await matchProfileByAccount(userId, loginResult)
        if (matched) {
          profileId = matched.profileId
          autoNotice = `已识别为已绑定账号（${matched.reason}），原地更新。`
          // 老档案若缺设备，补齐后再写入，避免后续查询/签到走无设备请求。
          try {
            await ensureGeneratedProfileDevice(userId, profileId)
          } catch {
            autoNotice += "设备档案补齐失败，已沿用原设备。"
          }
        } else {
          profileId = await nextFreeProfileId(userId)
          autoNotice = `识别为新账号，自动分配 profile ${profileId}。`
          try {
            await ensureProfile({ qq: userId, profileId, nickname: e.sender?.card || e.sender?.nickname || "" })
            await ensureGeneratedProfileDevice(userId, profileId)
          } catch {
            throw new Error("新账号设备档案初始化失败，已保留原档案，请检查后重试")
          }
        }
      }

      const accountService = new AccountService({ client: qr.client, preserveLoginSession: true })
      let profile = await accountService.saveLoginResult({
        qq: userId,
        profileId,
        result: loginResult,
        nickname: e.sender?.card || e.sender?.nickname || "",
      })
      if (!profile.account?.cookie || profile.account?.role_sync_error) {
        profile = await refreshAccountAndSync(userId, profileId, { accountService, expectedProfile: profile }).catch(error => {
          if (isAccountChangedError(error)) throw error
          globalThis.logger?.warn?.(`[Lotus-Plugin] QR login post-refresh skipped: ${error.message}`)
          return profile
        })
      }
      // 新扫码账号自动开启自动签到（对齐 roster 提示「扫码登录即自动加入」）。
      // 已绑定账号原地更新：保留用户已有的 enabled 选择，不强改。
      if (!explicit && !matched && profile.enabled !== true) {
        profile.enabled = true
        await saveProfile(profile)
        autoNotice += "已自动开启自动签到（含原神/星铁/绝区零）。"
      }
      await safeRegisterGenshin(userId, profile)
      await safeAddLateSchedule(profile)

      await replyText(target, `[荷花插件]profile ${profileId} 扫码登录完成，已保存登录信息。${autoNotice}`)
    } catch (error) {
      globalThis.logger?.error?.(`[Lotus-Plugin] QR login failed: ${error.stack || error.message}`)
      await replyText(target, `[荷花插件]扫码登录失败：${error.message}`)
    } finally {
      loginLocks.delete(lockKey)
    }

    return true
  }

  async passwordLoginRemoved() {
    await replyText(this, "[荷花插件]账号密码登录已裁掉，请使用 #扫码登录。")
    return true
  }

  async refreshCookie() {
    const config = await loadGlobalConfig()
    if (!new PermissionService({ permissions: config.permissions }).can(this.e, "checkin.refresh")) {
      await replyText(this, "[荷花插件]当前不允许刷新登录信息，请联系机器人主人。")
      return true
    }
    const userId = String(this.e.user_id)
    const hasSuffix = /\d+$/.test(String(this.e.msg || ""))
    const profileIds = hasSuffix
      ? [parseProfileIdFromMessage(this.e.msg)]
      : await listProfileIds(userId)

    if (profileIds.length === 0) {
      await replyText(this, "[荷花插件]没有找到已绑定的 profile，请先使用 #扫码登录。")
      return true
    }

    const accountService = new AccountService()
    const results = await refreshAllAccountsAndSync(userId, profileIds, { accountService })
    const okCount = results.filter(item => item.ok).length
    const items = results.map(item => ({
      label: `Profile ${item.profileId}`,
      value: item.ok ? "刷新成功" : `刷新失败：${friendlyRefreshError(item.error)}`,
    }))

    const image = await renderStatusCard({
      title: "Cookie 刷新",
      subtitle: `QQ ${userId}`,
      badge: `${okCount}/${results.length}`,
      message: hasSuffix
        ? `已刷新 profile ${profileIds[0]} 的登录信息。`
        : "已按 profile 粒度刷新当前 QQ 的登录信息。",
      userId,
      items,
    }, {
      saveId: `lotus-refresh-${userId}-${profileIds.join("-")}`,
    })

    await replyImage(this, image, `[荷花插件]刷新完成：${okCount}/${results.length}`)
    return true
  }

  async clearLogin() {
    const userId = String(this.e.user_id)
    const profileId = parseProfileIdFromMessage(this.e.msg)
    try {
      const profile = await new AccountService().clearLogin(userId, profileId)
      const image = await renderStatusCard({
        title: "清除登录",
        subtitle: `QQ ${userId} · Profile ${profileId}`,
        badge: "完成",
        message: "已清除该 profile 的 cookie/stoken/mid 等登录敏感字段，保留设备、签到和 UID 配置。",
        userId,
        items: [
          { label: "Profile", value: String(profile.profile?.id || profileId) },
          { label: "Cookie", value: profile.account?.cookie ? "仍存在" : "已清除" },
          { label: "UID", value: loginRoleSummary(profile) },
        ],
      }, {
        saveId: `lotus-clear-login-${userId}-${profileId}`,
      })
      await replyImage(this, image, "[荷花插件]登录信息已清除。")
    } catch (error) {
      await replyText(this, `[荷花插件]清除登录失败：${error.message}`)
    }
    return true
  }

  async syncRoles() {
    const userId = String(this.e.user_id)
    const profileId = parseProfileIdFromMessage(this.e.msg)
    try {
      const account = new AccountService()
      const profile = await account.syncGameRoles(userId, profileId)
      await safeRegisterGenshin(userId, profile)
      const image = await renderStatusCard({
        title: "同步角色",
        subtitle: `QQ ${userId} · Profile ${profileId}`,
        badge: "完成",
        message: "已通过当前 cookie 同步米哈游角色列表，并刷新 genshin bridge。",
        userId,
        items: [
          { label: "原神", value: roleCount(profile, "gs") },
          { label: "星铁", value: roleCount(profile, "sr") },
          { label: "绝区零", value: roleCount(profile, "zzz") },
        ],
      }, {
        saveId: `lotus-sync-roles-${userId}-${profileId}`,
      })
      await replyImage(this, image, "[荷花插件]角色同步完成。")
    } catch (error) {
      await replyText(this, `[荷花插件]角色同步失败：${error.message}`)
    }
    return true
  }

  async syncBridge() {
    const userId = String(this.e.user_id)
    const profileId = parseProfileIdFromMessage(this.e.msg)
    try {
      const profile = await new AccountService().get(userId, profileId)
      const result = await safeRegisterGenshin(userId, profile)
      const image = await renderStatusCard({
        title: "登录桥接",
        subtitle: `QQ ${userId} · Profile ${profileId}`,
        badge: result.ok ? "完成" : "跳过",
        message: result.ok
          ? "已把该 profile 的 ltuid/cookie/uids 注册到 genshin NoteUser/MysUser。"
          : `bridge 未完成：${result.reason || "未知原因"}`,
        userId,
        items: [
          { label: "ltuid", value: profile.account?.ltuid || profile.account?.stuid || "无" },
          { label: "UID", value: loginRoleSummary(profile) },
        ],
      }, {
        saveId: `lotus-sync-bridge-${userId}-${profileId}`,
      })
      await replyImage(this, image, "[荷花插件]登录桥接同步完成。")
    } catch (error) {
      await replyText(this, `[荷花插件]登录桥接失败：${error.message}`)
    }
    return true
  }

  async loginList() {
    const userId = String(this.e.user_id)
    const profiles = await new AccountService().listSummaries(userId)
    const image = await renderStatusCard({
      title: "登录列表",
      subtitle: `QQ ${userId}`,
      badge: String(profiles.length),
      message: profiles.length ? "当前 QQ 已创建的 profile 如下。" : "还没有创建 profile。",
      userId,
      items: profiles.map(profile => ({
        label: `Profile ${profile.profile?.id || 1}`,
        value: [
          profile.account?.cookie ? "已登录" : "未登录",
          loginRoleSummary(profile),
        ].join(" · "),
      })),
    }, {
      saveId: `lotus-login-list-${userId}`,
    })
    await replyImage(this, image, "[荷花插件]登录列表已生成。")
    return true
  }
}

async function safeAddLateSchedule(profile) {
  if (!isProfileCheckinEnabled(profile)) {
    return {
      results: [],
      notifications: [],
      reason: "profile_disabled",
    }
  }

  try {
    return await new ScheduledSigninService().addLateProfileAndNotify(profile, {
      bot: globalThis.Bot,
    })
  } catch (error) {
    logger?.warn?.(`[Lotus-Plugin] late schedule skipped: ${error.message}`)
    return {
      results: [],
      notifications: [],
      reason: error.message,
    }
  }
}

async function safeRegisterGenshin(qq, profile) {
  try {
    return await registerProfileWithGenshin({ qq, profile })
  } catch (error) {
    logger?.warn?.(`[Lotus-Plugin] genshin bridge skipped: ${error.message}`)
    return {
      ok: false,
      reason: error.message,
    }
  }
}

function roleCount(profile, game) {
  const roles = profile.account?.game_roles?.[game] || []
  const current = profile.account?.current_uid?.[game]
  return current ? `${roles.length} 个 · 当前 ${current}` : `${roles.length} 个`
}

function loginRoleSummary(profile) {
  return [
    `原${profile.account?.current_uid?.gs || "-"}`,
    `铁${profile.account?.current_uid?.sr || "-"}`,
    `绝${profile.account?.current_uid?.zzz || "-"}`,
  ].join(" / ")
}

// 刷新失败的展示层文案映射：把上游英文错误翻译成人话，核心抛错/retcode 保持原样。
// 只影响 Cookie 刷新卡片显示，不改变任何刷新逻辑。
function friendlyRefreshError(error) {
  if (!error) return "未知错误"
  if (error.code === "LOTUS_ACCOUNT_CHANGED") return "登录信息已变更，请重试"
  const retcode = Number(error.retcode)
  if (retcode === -464) return "该登录方式已被米游社停用，请重新扫码登录"
  if (retcode === -100 || retcode === 10001) return "登录已失效，请重新扫码登录"
  const reason = String(error.reason || "")
  if (["request", "http"].includes(reason)) return "网络请求失败，请稍后重试"
  if (reason === "missing_credentials") return "未保存 stoken，请重新扫码登录"
  if (["uid_mismatch", "mid_mismatch", "credential_format"].includes(reason)) return "返回账号信息异常，请重新扫码登录"
  return error.message || "刷新失败，请重新扫码登录"
}

// ---- 逍遥式扫码：按账号身份自动识别 profile ----
// 身份键强度：mid > stuid > ltuid > cookie 完全一致。
// 多字段兜底是为了在米游社某字段缺失/变更时仍能归并同一账号，
// 避免回头扫同号被当成新号重复建 profile。
function loginAccountIdentity(loginResult = {}) {
  const stoken = parseStokenCookie(loginResult.stoken || "")
  const cookie = parseAccountCookie(loginResult.cookie || "")
  return {
    mid: stoken.mid || cookie.mid || "",
    stuid: stoken.stuid || cookie.ltuid || "",
    ltuid: cookie.ltuid || stoken.stuid || "",
    cookie: loginResult.cookie || "",
  }
}

// cookie 比较前归一化：按 ; 切分、去空格、排序，容忍字段顺序差异。
function normalizeCookieForCompare(cookie = "") {
  return String(cookie).split(";").map(s => s.trim()).filter(Boolean).sort().join(";")
}

async function matchProfileByAccount(userId, loginResult) {
  const identity = loginAccountIdentity(loginResult)
  let ids = []
  try {
    ids = await listProfileIds(userId)
  } catch {
    return null
  }
  if (ids.length === 0) return null
  for (const id of ids) {
    try {
      const profile = await loadProfile(userId, id)
      const acc = profile?.account || {}
      if (identity.mid && acc.mid && String(acc.mid) === String(identity.mid)) {
        return { profileId: id, reason: "mid 一致" }
      }
      if (identity.stuid && acc.stuid && String(acc.stuid) === String(identity.stuid)) {
        return { profileId: id, reason: "米游社 UID 一致" }
      }
      if (identity.ltuid && acc.ltuid && String(acc.ltuid) === String(identity.ltuid)) {
        return { profileId: id, reason: "ltuid 一致" }
      }
      if (identity.cookie && acc.cookie && normalizeCookieForCompare(identity.cookie) === normalizeCookieForCompare(acc.cookie)) {
        return { profileId: id, reason: "cookie 一致" }
      }
    } catch {}
  }
  return null
}

async function nextFreeProfileId(userId) {
  let ids = []
  try {
    ids = await listProfileIds(userId)
  } catch {}
  const max = ids.reduce((m, id) => Math.max(m, Number(id) || 0), 0)
  return Math.min(MAX_PROFILE_ID, max + 1)
}
