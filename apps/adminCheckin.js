// 管理员全群签到指令（git untracked，git pull 安全）
//
// 设计要点：
//   1. profile 是全局存储（data/users/*.yaml），enabled / notify 均为 profile 级全局设置，
//      与「在哪个群」无关。本文件所有操作都基于 listAllProfiles() 枚举全部 profile，
//      因此无论管理员在哪个群发出指令，都作用于全体用户 —— 天然「同步到所有群」。
//   2. 通知投递（core/transport/notify.js）在群渠道会自动遍历用户所在的所有群
//      （bot.getGroupList()），所以开启 notify 后用户在任何群都能收到签到结果。
//   3. 安全闸：全体操作（二次签到 / 注册签到）采用「两步确认」——
//      先发指令看预览（影响多少 profile、覆盖哪些群），回复 #确认… 才真正执行，
//      避免误触在全部群跑一圈。待确认状态 10 分钟内有效，可用 #取消… 放弃。
//
// 命令（均为 bot 主人权限，permission: master）：
//   预览（不执行，返回待确认）：
//   #全员二次签到              预览：拉起全体「已扫码」用户的二次签到（覆盖所有群）
//   #全员二次签到 <账号>        预览：只拉起指定账号的全部 profile
//   #拉起全员签到 / #全员补签 / #全员签到补跑   同上（别名）
//
//   #全员注册签到              预览：为全体「已扫码」用户一键开启自动签到 + 通知（跨群同步）
//   #全员注册签到 <账号>        预览：只注册指定账号
//   #一键注册签到 / #全员开启签到 / #注册全员签到   同上（别名）
//
//   确认执行（仅当该管理员有待确认状态时有效）：
//   #确认二次签到 / #确认全员二次签到 / #确认补签 / #确认全员补签
//   #确认注册签到 / #确认全员注册签到 / #确认注册 / #确认开启签到
//
//   放弃：
//   #取消二次签到 / #取消注册签到 / #取消全员签到 / #取消注册
//
//   修复工具（仅重写 fallback_groups；不动 enabled/notify；不发通知；master 权限）：
//   #清理误注册群             预览：扫所有 profile，按用户实际所在群重写 fallback_groups 并剔除误写入
//   #确认清理误注册群          真正执行（master 权限）
//
// 与既有指令的边界：
//   - 区别于 apps/resignCheckin.js 的 #补签重试（单个用户、限 3 次/日）：
//     本文件的 #全员二次签到 是管理员维度的「全体补签」，无 3 次限制。
//   - 区别于 apps/groupDeploy.js 的 #群签到部署（按群成员注册、需指定/当前群）：
//     本文件的 #全员注册签到 对全体已扫码 profile 按「该用户实际所在群」批量写入 fallback_groups，
//     跨群同步；写入群 = 用户实际所在群，避免卡片误投到用户不在的群。

const BasePlugin = globalThis.plugin

import {
  listAllProfiles,
  loadProfile,
  saveProfile,
  hasProfileLogin,
  normalizeProfileId,
  MAX_PROFILE_ID,
} from "../core/config/profile.js"
import { loadGlobalConfig } from "../core/config/global.js"
import { renderStatusCard } from "../core/render/service.js"
import { replyImage, replyText } from "../core/transport/reply.js"
import { replyCaptchaEvent } from "../core/captcha/notify.js"
import { notifyProfile } from "../core/transport/notify.js"
import { ProfileSigninService } from "../services/checkin/profileSignin.js"
import { SchedulerService } from "../core/scheduler/service.js"
import { ScheduledSigninService } from "../services/checkin/scheduled.js"

// 批量补签时每两个账号之间的间隔，尽量降低米游社风控对同一出口 IP 的触发概率
const RESIGN_INTERVAL_MS = 600

// 待确认状态：key = 管理员账号，value = { action, tail, expiresAt }
const PENDING_TTL_MS = 10 * 60 * 1000
const pendingConfirm = new Map()

function setPending(userId, payload) {
  payload.expiresAt = Date.now() + PENDING_TTL_MS
  pendingConfirm.set(String(userId), payload)
}
function takePending(userId) {
  const key = String(userId)
  const p = pendingConfirm.get(key)
  if (!p) return null
  pendingConfirm.delete(key)
  if (Date.now() > p.expiresAt) return { expired: true }
  return p
}
function clearPending(userId) {
  pendingConfirm.delete(String(userId))
}

export class LotusAdminCheckin extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Admin Checkin",
      dsc: "管理员全群二次签到 / 一键注册自动签到（跨群同步，两步确认）",
      event: "message",
      priority: 19,
      rule: [
        {
          reg: "^#(全员二次签到|拉起全员签到|全员补签|全员签到补跑)(.*)$",
          fnc: "resignAll",
          permission: "master",
        },
        {
          reg: "^#(全员注册签到|一键注册签到|全员开启签到|注册全员签到)(.*)$",
          fnc: "registerAll",
          permission: "master",
        },
        {
          reg: "^#(确认二次签到|确认全员二次签到|确认补签|确认全员补签)$",
          fnc: "confirmResign",
          permission: "master",
        },
        {
          reg: "^#(确认注册签到|确认全员注册签到|确认注册|确认开启签到)$",
          fnc: "confirmRegister",
          permission: "master",
        },
        {
          reg: "^#(取消二次签到|取消注册签到|取消全员签到|取消注册)$",
          fnc: "cancelPending",
          permission: "master",
        },
        {
          reg: "^#清理误注册群$",
          fnc: "previewCleanMisregistered",
          permission: "master",
        },
        {
          reg: "^#确认清理误注册群$",
          fnc: "confirmCleanMisregistered",
          permission: "master",
        },
      ],
    })
  }

  // ---- 预览 1：拉起全体二次签到（仅展示，不执行）----
  async resignAll() {
    const tail = String(this.e.msg).replace(/^#(全员二次签到|拉起全员签到|全员补签|全员签到补跑)/, "").trim()
    const profiles = await resolveTargetProfiles(tail)
    if (!profiles.length) {
      await replyText(this, "[荷花插件]没有找到可补签的「已扫码」profile。请确认用户已通过 #扫码登录 绑定账号。")
      return true
    }
    setPending(this.e.user_id, { action: "resign", tail })
    const scope = tail ? `指定 账号 ${tail}` : "全体已扫码用户（跨群）"
    const preview = [
      `即将拉起 ${profiles.length} 个「已扫码」profile 的二次签到（${scope}），`,
      `结果卡片会投递到对应用户所在的每一个群。`,
      ``,
      `⚠️ 这是管理员全群操作，不受每日 3 次限制。`,
      `确认请回复：#确认二次签到`,
      `放弃请回复：#取消全员签到`,
      `（待确认状态 10 分钟内有效）`,
    ].join("\n")
    await replyText(this, `[荷花插件]二次确认\n${preview}`)
    return true
  }

  // ---- 预览 2：为全体已扫码用户一键注册自动签到 + 开启通知（仅展示，不执行）----
  async registerAll() {
    const tail = String(this.e.msg).replace(/^#(全员注册签到|一键注册签到|全员开启签到|注册全员签到)/, "").trim()
    const profiles = await resolveTargetProfiles(tail)
    if (!profiles.length) {
      await replyText(this, "[荷花插件]没有找到可注册的「已扫码」profile。请确认用户已通过 #扫码登录 绑定账号。")
      return true
    }
    const groupCount = listAllGroupIds(globalThis.Bot).length
    setPending(this.e.user_id, { action: "register", tail })
    const scope = tail ? `指定 账号 ${tail}` : "全体已扫码用户（跨群）"
    const preview = [
      `即将为 ${profiles.length} 个「已扫码」profile 一键开启自动签到 + 通知（${scope}），`,
      `并按各用户实际所在群写入 fallback_groups（不会投到用户不在的群）；`,
      `随后重生成明日计划并群发「明日时间」通知。`,
      ``,
      `⚠️ 这是管理员全群操作，配置为 profile 级全局设置，跨群同步。`,
      `确认请回复：#确认注册签到`,
      `放弃请回复：#取消全员签到`,
      `（待确认状态 10 分钟内有效）`,
    ].join("\n")
    await replyText(this, `[荷花插件]二次确认\n${preview}`)
    return true
  }

  // ---- 确认执行：二次签到 ----
  async confirmResign() {
    const p = takePending(this.e.user_id)
    if (!p) {
      await replyText(this, "[荷花插件]当前没有待确认的「全员二次签到」指令，或已超时。请重新发出 #全员二次签到。")
      return true
    }
    if (p.expired) {
      await replyText(this, "[荷花插件]待确认的「全员二次签到」已超时，请重新发出 #全员二次签到。")
      return true
    }
    if (p.action !== "resign") {
      await replyText(this, "[荷花插件]待确认的是「注册签到」指令，请回复 #确认注册签到 执行。")
      return true
    }
    await runResignAll(this, p.tail)
    return true
  }

  // ---- 确认执行：注册签到 ----
  async confirmRegister() {
    const p = takePending(this.e.user_id)
    if (!p) {
      await replyText(this, "[荷花插件]当前没有待确认的「全员注册签到」指令，或已超时。请重新发出 #全员注册签到。")
      return true
    }
    if (p.expired) {
      await replyText(this, "[荷花插件]待确认的「全员注册签到」已超时，请重新发出 #全员注册签到。")
      return true
    }
    if (p.action !== "register") {
      await replyText(this, "[荷花插件]待确认的是「二次签到」指令，请回复 #确认二次签到 执行。")
      return true
    }
    await runRegisterAll(this, p.tail)
    return true
  }

  // ---- 放弃待确认 ----
  async cancelPending() {
    const had = pendingConfirm.has(String(this.e.user_id))
    clearPending(this.e.user_id)
    await replyText(this, had ? "[荷花插件]已取消待确认的全群操作。" : "[荷花插件]当前没有待取消的指令。")
    return true
  }

  // ---- 预览：扫描所有 profile，按"用户实际所在群"重写 fallback_groups ----
  async previewCleanMisregistered() {
    const allGroupIds = listAllGroupIds(globalThis.Bot)
    const profiles = await listAllProfiles()
    const candidates = profiles.filter(p =>
      Array.isArray(p?.profile?.notify?.fallback_groups) && p.profile.notify.fallback_groups.length > 0
    )
    if (!candidates.length) {
      await replyText(this, "[荷花插件]没有需要清理的 profile（所有 profile 的 fallback_groups 都为空）。")
      return true
    }

    // 按用户实际所在群过滤（不修改，只看）
    let pruneTotal = 0
    const samples = []
    for (const p of candidates) {
      const qq = String(p.user?.qq || "")
      const profileId = p.profile?.id || 1
      const oldCount = (p.profile.notify.fallback_groups || []).length
      const userGroups = await filterUserGroups(globalThis.Bot, qq, allGroupIds)
      const willPrune = oldCount - userGroups.length
      pruneTotal += Math.max(0, willPrune)
      if (samples.length < 12) samples.push({ qq, profileId, oldCount, newCount: userGroups.length, willPrune })
    }

    setPending(this.e.user_id, { action: "cleanMisregistered", tail: "" })
    const preview = [
      `即将扫描 ${candidates.length} 个 profile，按各用户实际所在群重写 fallback_groups，`,
      `预计剔除 ${pruneTotal} 条历史误写入的群号。`,
      `不动 enabled / notify.prefer，不会发送任何通知。`,
      ``,
      `⚠️ 仅 master 可执行，配置为 profile 级全局设置，跨群生效。`,
      `确认请回复：#确认清理误注册群`,
      `放弃请回复：#取消注册 / #取消全员签到`,
      `（待确认状态 10 分钟内有效）`,
    ].join("\n")
    let extra = ""
    if (samples.length) {
      extra = "\n\n预览前 12 条：\n" + samples.map(s =>
        `• 账号 ${s.qq} · P${s.profileId}：${s.oldCount} → ${s.newCount} 个（剔除 ${s.willPrune}）`
      ).join("\n")
    }
    await replyText(this, `[荷花插件]二次确认\n${preview}${extra}`)
    return true
  }

  // ---- 确认执行：清理误注册群 ----
  async confirmCleanMisregistered() {
    const p = takePending(this.e.user_id)
    if (!p) {
      await replyText(this, "[荷花插件]当前没有待确认的「清理误注册群」指令，或已超时。请重新发出 #清理误注册群。")
      return true
    }
    if (p.expired) {
      await replyText(this, "[荷花插件]待确认的「清理误注册群」已超时，请重新发出 #清理误注册群。")
      return true
    }
    if (p.action !== "cleanMisregistered") {
      await replyText(this, "[荷花插件]待确认的是其它指令，请用对应的确认指令。")
      return true
    }
    await runCleanMisregisteredGroups(this)
    return true
  }
}

// ---- 实际执行：拉起全体二次签到 ----
export async function runResignAll(e, tail) {
  const profiles = await resolveTargetProfiles(tail)
  if (!profiles.length) {
    await replyText(e, "[荷花插件]没有找到可补签的「已扫码」profile。请确认用户已通过 #扫码登录 绑定账号。")
    return
  }

  await replyText(e, `[荷花插件]开始为 ${profiles.length} 个已扫码 profile 拉起二次签到（管理员全群操作，覆盖所有群）…`)

  // 尊重「全局静默」主开关：静默模式下不向各用户推送结果卡，仅给触发命令的管理员汇总
  const globalConfig = await loadGlobalConfig().catch(() => null)
  const silent = globalConfig?.scheduler?.notify_enabled === false
  if (silent) {
    await replyText(e, "[荷花插件]当前为「全局静默」模式：本次二次签到不会向各用户推送结果卡，仅向你（管理员）汇总。")
  }

  const results = []
  const throttle = await loadThrottle()
  for (const profile of profiles) {
    const qq = profile.user?.qq
    const profileId = profile.profile?.id || 1
    const outcome = await runSignin(e, qq, profileId)
    results.push({ qq, profileId, outcome })

    // 把签到结果卡片投递给对应用户（force 确保即使对方 notify.enable=false 也能收到管理员的补签结果）
    // 静默模式下跳过，避免向全体用户刷屏
    if (outcome.image && !silent) {
      await notifyProfile(profile, outcome.image, { bot: globalThis.Bot, force: true }).catch(() => {})
    }
    await sleep(randDelay(throttle, RESIGN_INTERVAL_MS))
  }

  const okCount = results.filter(r => r.outcome.ok).length
  const failCount = results.length - okCount
  const items = [
    { label: "操作范围", value: tail ? `指定 账号 ${tail}` : "全体已扫码用户（跨群）" },
    { label: "补签 profile 数", value: String(results.length) },
    { label: "成功", value: String(okCount) },
    { label: "失败", value: String(failCount) },
  ]
  for (const r of results.slice(0, 12)) {
    items.push({
      label: `账号 ${r.qq} · P${r.profileId}`,
      value: r.outcome.ok ? "成功" : `失败：${(r.outcome.message || "").slice(0, 40)}`,
    })
  }
  if (results.length > 12) {
    items.push({ label: "更多", value: `另有 ${results.length - 12} 个 profile` })
  }

  const image = await renderStatusCard({
    title: "全员二次签到",
    subtitle: `管理员 账号 ${e.e.user_id} · 跨群生效`,
    badge: `${okCount}/${results.length}`,
    message: silent
      ? `已为 ${results.length} 个已扫码 profile 拉起二次签到（成功 ${okCount} / 失败 ${failCount}）。当前「全局静默」模式：未向各用户推送结果卡，仅此汇总发给你（管理员）。社区签到（米游社）已包含在此次批量中。`
      : `已为 ${results.length} 个已扫码 profile 拉起二次签到（成功 ${okCount} / 失败 ${failCount}），结果卡片已分别投递给对应用户（覆盖其所在所有群）。社区签到（米游社）已包含在此次批量中。`,
    userId: e.e.user_id,
    items,
  }, {
    saveId: `lotus-admin-resign-${e.e.user_id || "master"}-${Date.now()}`,
  })
  await replyImage(e, image, "[荷花插件]全员二次签到完成。")
}

// ---- 实际执行：为全体已扫码用户一键注册自动签到 + 开启通知 ----
async function runRegisterAll(e, tail) {
  const profiles = await resolveTargetProfiles(tail)
  if (!profiles.length) {
    await replyText(e, "[荷花插件]没有找到可注册的「已扫码」profile。请确认用户已通过 #扫码登录 绑定账号。")
    return
  }

  await replyText(e, `[荷花插件]正在为 ${profiles.length} 个已扫码 profile 一键注册自动签到并开启通知（按用户实际所在群写入，跨群同步）…`)

  const allGroupIds = listAllGroupIds(globalThis.Bot)
  const totalGroupsAll = allGroupIds.length

  let registered = 0
  let alreadyOn = 0
  let notifyOn = 0
  let totalUserGroupUsable = 0
  const changedSamples = []
  for (const profile of profiles) {
    const qq = profile.user?.qq
    const profileId = profile.profile?.id || 1
    // 只把"该用户实际所在的群"写入 fallback_groups，避免卡片误投到用户不在的群
    const userGroups = await filterUserGroups(globalThis.Bot, qq, allGroupIds)
    // 保护：若成员关系查询整体失败（返回空），保留原 fallback_groups，不空白清空，避免用户彻底失联
    const hadGroups = (profile.profile?.notify?.fallback_groups || []).length > 0
    if (userGroups.length === 0 && hadGroups) {
      logger?.warn?.(`[Lotus-Plugin] 全员注册签到 跳过 账号 ${qq}（P${profileId}）：按用户所在群过滤后为空，疑似成员关系查询不可用，保留原 fallback_groups ${JSON.stringify(profile.profile.notify.fallback_groups)}`)
      changedSamples.push({ qq, profileId, groupCount: (profile.profile.notify.fallback_groups || []).length, pruned: 0, unsafe: true })
      continue
    }
    totalUserGroupUsable += userGroups.length
    const result = registerOneProfile(profile, userGroups)
    if (result.registered) registered++
    if (result.alreadyOn) alreadyOn++
    if (result.notifyOn) notifyOn++
    if (result.changed) {
      await saveProfile(result.profile)
      changedSamples.push({ qq, profileId, groupCount: userGroups.length, pruned: result.pruned })
    }
  }

  // 强制重生成明日计划，让新注册的人进入计划并收到明日时间通知（跨群投递）
  let planEntries = 0
  let notified = 0
  try {
    const globalConfig = await loadGlobalConfig()
    const scheduler = new SchedulerService({ config: globalConfig.scheduler })
    const scheduled = new ScheduledSigninService({ scheduler, bot: globalThis.Bot })
    const generated = await scheduled.ensureTomorrowPlanAndNotify({
      config: globalConfig,
      force: true,
      forceNotify: true,
      bot: globalThis.Bot,
    })
    planEntries = generated.plan?.entries?.length || 0
    notified = (generated.notifications || []).filter(n => n.sent?.ok).length
  } catch (error) {
    logger?.error?.(`[Lotus-Plugin] admin register regenerate plan failed: ${error.stack || error.message}`)
  }

  const items = [
    { label: "操作范围", value: tail ? `指定 账号 ${tail}` : "全体已扫码用户（跨群）" },
    { label: "bot 全部群", value: String(totalGroupsAll) },
    { label: "本次新注册", value: String(registered) },
    { label: "此前已开启", value: String(alreadyOn) },
    { label: "通知已开启", value: String(notifyOn) },
    { label: "实际写入群候选", value: `共 ${totalUserGroupUsable} 条（仅各用户实际所在群；不符合的群已剔除）` },
    { label: "明日计划", value: planEntries ? `${planEntries} 条已重生成` : "生成失败，将于午夜自动重试" },
    { label: "明日时间通知", value: `已群发 ${notified} 条（按各用户实际所在群）` },
  ]
  for (const s of changedSamples.slice(0, 10)) {
    items.push({
      label: `账号 ${s.qq} · P${s.profileId}`,
      value: s.unsafe
        ? `${s.groupCount} 个群（成员查询不可用，保留原群未改动）`
        : `${s.groupCount} 个实际群${s.pruned ? `（已剔除 ${s.pruned} 个误注册）` : ""}`,
    })
  }
  if (changedSamples.length > 10) {
    items.push({ label: "更多", value: `另有 ${changedSamples.length - 10} 个 profile` })
  }

  const image = await renderStatusCard({
    title: "全员注册自动签到",
    subtitle: `管理员 账号 ${e.e.user_id} · 按用户实际所在群写入`,
    badge: String(registered),
    message: `已为 ${registered} 个（共 ${profiles.length} 个）已扫码 profile 开启自动签到与签到通知；fallback_groups 已按各用户实际所在群写入（共 ${totalUserGroupUsable} 条），不在的群不再投递，避免卡片误落到别的群。明日计划已重生成。`,
    userId: e.e.user_id,
    items,
  }, {
    saveId: `lotus-admin-register-${e.e.user_id || "master"}-${Date.now()}`,
  })
  await replyImage(e, image, "[荷花插件]全员注册自动签到完成。")
}

// ---- 实际执行：清理误注册群（仅重写 fallback_groups，不发通知）----
async function runCleanMisregisteredGroups(e) {
  const allGroupIds = listAllGroupIds(globalThis.Bot)
  const profiles = (await listAllProfiles()).filter(p =>
    Array.isArray(p?.profile?.notify?.fallback_groups) && p.profile.notify.fallback_groups.length > 0
  )
  if (!profiles.length) {
    await replyText(e, "[荷花插件]没有需要清理的 profile（所有 profile 的 fallback_groups 都为空）。")
    return
  }

  await replyText(e, `[荷花插件]开始清理误注册的 fallback_groups，共扫描 ${profiles.length} 个 profile…`)

  let rewritten = 0
  let totalPruned = 0
  const samples = []
  for (const profile of profiles) {
    const qq = profile.user?.qq
    const profileId = profile.profile?.id || 1
    const userGroups = await filterUserGroups(globalThis.Bot, qq, allGroupIds)
    profile.profile ||= {}
    profile.profile.notify ||= {}
    profile.profile.notify.fallback_groups ||= []
    const oldList = (profile.profile.notify.fallback_groups || []).map(String)
    // 保护：若成员关系查询整体失败（返回空），保留原 fallback_groups，不空白清空，避免用户彻底失联
    if (userGroups.length === 0 && oldList.length > 0) {
      logger?.warn?.(`[Lotus-Plugin] 清理误注册群 跳过 账号 ${qq}（P${profileId}）：按用户所在群过滤后为空，疑似成员关系查询不可用，保留原 fallback_groups ${JSON.stringify(profile.profile.notify.fallback_groups)}`)
      if (samples.length < 12) samples.push({ qq, profileId, oldCount: oldList.length, newCount: oldList.length, pruned: 0, added: 0, unsafe: true })
      continue
    }
    const oldSet = new Set(oldList)
    const newSet = new Set(userGroups)
    let pruned = 0
    for (const g of oldSet) if (!newSet.has(g)) pruned++
    const added = userGroups.filter(g => !oldSet.has(g)).length
    const sameOrdered = oldList.length === userGroups.length && oldList.every((g, i) => userGroups[i] === g)
    if (!sameOrdered) {
      profile.profile.notify.fallback_groups = [...userGroups]
      totalPruned += pruned
      await saveProfile(profile)
      rewritten++
      if (samples.length < 12) samples.push({ qq, profileId, oldCount: oldList.length, newCount: userGroups.length, pruned, added })
    }
  }

  const items = [
    { label: "扫描 profile", value: `${profiles.length} 个` },
    { label: "已重写", value: `${rewritten} 个（其余已正确）` },
    { label: "剔除误写入", value: `${totalPruned} 条` },
  ]
  for (const s of samples) {
    items.push({
      label: `账号 ${s.qq} · P${s.profileId}`,
      value: s.unsafe
        ? `${s.oldCount} 个群（成员查询不可用，保留原群未改动）`
        : `${s.oldCount} → ${s.newCount}（剔除 ${s.pruned}${s.added ? `、补回 ${s.added}` : ""}）`,
    })
  }
  if (samples.length < rewritten) {
    items.push({ label: "更多", value: `另有 ${rewritten - samples.length} 个 profile 已重写` })
  }

  const image = await renderStatusCard({
    title: "清理误注册群",
    subtitle: `管理员 账号 ${e.e.user_id} · 仅重写 fallback_groups`,
    badge: `${rewritten}/${profiles.length}`,
    message: `已对 ${rewritten} 个（共 ${profiles.length} 个有 fallback_groups 的）profile 按用户实际所在群重写 fallback_groups，共剔除 ${totalPruned} 条误写入。已注册 / 通知偏好 / 计划未受影响；下次签到结果与明日时间通知按重写后的群列表投递。`,
    userId: e.e.user_id,
    items,
  }, {
    saveId: `lotus-admin-clean-misregistered-${e.e.user_id || "master"}-${Date.now()}`,
  })
  await replyImage(e, image, "[荷花插件]清理误注册群完成。")
}

// ---- 工具函数 ----

async function runSignin(e, qq, profileId) {
  try {
    const outcome = await new ProfileSigninService().run({
      qq,
      profileId,
      refresh: true,
      installRequirements: false,
      onCaptchaEvent: async event => {
        await replyCaptchaEvent(e, event).catch(() => {})
      },
    })
    return outcome
  } catch (error) {
    logger?.error?.(`[Lotus-Plugin] admin resign failed (${qq}/${profileId}): ${error.stack || error.message}`)
    const message = error?.code === "ENOENT"
      ? `profile ${profileId} 尚未配置，请先使用 #扫码登录${profileId === 1 ? "" : profileId}。`
      : error.message
    return { ok: false, message, image: null }
  }
}

// 根据指令 tail 解析目标 profile 集合：
//   - 空 / "全部" / "all" → 全体已扫码 profile
//   - 数字 → 该账号的全部已扫码 profile（管理员可代操作）
async function resolveTargetProfiles(tail) {
  const text = String(tail || "").trim()
  if (!text || /^(全部|all)$/i.test(text)) {
    return (await listAllProfiles()).filter(hasProfileLogin)
  }
  // 指定单个账号
  const qq = text.replace(/[^\d]/g, "")
  if (!qq) return []
  const profiles = []
  for (const profile of await listAllProfiles()) {
    if (String(profile.user?.qq) === qq && hasProfileLogin(profile)) {
      profiles.push(profile)
    }
  }
  return profiles
}

// 单个 profile 注册：enabled=true + notify.enable=true + prefer=group + 把 caller 提供的群作为 fallback_groups
// 设计：caller 应已按"用户实际所在群"预过滤（本文件中 runRegisterAll 调用 filterUserGroups）。
// 我们直接把 fallback_groups 重置为 caller 提供的列表（不 merge），这样历史上被错写入的群（全员注册签到
// v1 把 bot 全部群写进每个 profile）会被一次自然清掉。
function registerOneProfile(profile, groupIds) {
  let changed = false
  const before = {
    enabled: profile.enabled === true,
    notifyEnable: profile.profile?.notify?.enable === true,
    prefer: profile.profile?.notify?.prefer,
    fallbackLen: (profile.profile?.notify?.fallback_groups || []).length,
  }

  if (profile.enabled !== true) {
    profile.enabled = true
    changed = true
  }

  profile.profile ||= {}
  profile.profile.notify ||= {}
  if (profile.profile.notify.enable !== true) {
    profile.profile.notify.enable = true
    changed = true
  }
  if (profile.profile.notify.prefer !== "group") {
    profile.profile.notify.prefer = "group"
    changed = true
  }

  // 计算要写入的群集合（去重 + 过滤伪群 id，避免历史 stdin 之类残留）
  const want = new Set()
  for (const g of groupIds || []) {
    const gid = String(g)
    if (gid && !/^(stdin|console|filehelper|null|undefined|none|-)$/i.test(gid)) {
      want.add(gid)
    }
  }
  const current = (profile.profile.notify.fallback_groups || []).map(String)
  const isSame =
    current.length === want.size && current.every((gid, idx) => [...want][idx] === gid)
  // 统计被剔除的旧群（用于显示：之前误注册了 N 个用户不在的群）
  const oldSet = new Set(current)
  let pruned = 0
  for (const gid of oldSet) if (!want.has(gid)) pruned++
  if (!isSame) {
    profile.profile.notify.fallback_groups = [...want]
    changed = true
  }

  const result = {
    profile,
    changed,
    registered: !before.enabled && profile.enabled === true,
    alreadyOn: before.enabled,
    notifyOn: !before.notifyEnable && profile.profile.notify.enable === true,
    pruned,
  }
  return result
}

// 把 "bot 全部群" 过滤成"该用户实际所在的群"。
// 优先看 bot.gml.get(groupId) 缓存（已 populate），否则 fall back 到 pickGroup().getMemberArray() 实时拉一次。
// 找不到/失败则保守地不加入（避免误投）。
async function filterUserGroups(bot, userId, allGroupIds) {
  if (!bot || !userId || !Array.isArray(allGroupIds) || !allGroupIds.length) return []
  const userIdStr = String(userId)
  const result = []
  for (const rawGid of allGroupIds) {
    const gid = String(rawGid)
    if (!gid) continue
    if (/^(stdin|console|filehelper|null|undefined|none|-)$/i.test(gid)) continue

    // 1) 看缓存的成员表（fast path）
    try {
      const memberMap =
        bot.gml?.get?.(gid) ||
        (typeof Number === "function" && Number.isFinite(Number(gid)) ? bot.gml?.get?.(Number(gid)) : null)
      if (memberMap && typeof memberMap.has === "function") {
        if (memberMap.has(userIdStr) || memberMap.has(Number(userIdStr))) {
          result.push(gid)
          continue
        }
      }
    } catch { /* ignore, fallthrough to API */ }

    // 2) 缓存未命中 → 实时拉一次
    try {
      const group = typeof bot.pickGroup === "function" ? bot.pickGroup(gid) : null
      if (group && typeof group.getMemberArray === "function") {
        const arr = await group.getMemberArray().catch(() => null)
        if (Array.isArray(arr)) {
          const hit = arr.some(m => {
            const mid = String(m?.user_id ?? m)
            return mid === userIdStr || mid === String(Number(userIdStr))
          })
          if (hit) {
            result.push(gid)
            continue
          }
        }
      }
    } catch { /* ignore */ }

    // 3) 既无缓存也无 API → 保守不加入
  }
  return result
}

function listAllGroupIds(bot) {
  const gl = bot?.getGroupList?.()
  if (gl instanceof Map) return [...gl.keys()].map(String)
  if (Array.isArray(gl)) return gl.map(g => String(g?.group_id ?? g)).filter(Boolean)
  return []
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function loadThrottle() {
  try {
    const cfg = await loadGlobalConfig()
    const t = cfg.scheduler?.throttle || {}
    const min = Number(t.delay_ms_min ?? 0)
    const max = Number(t.delay_ms_max ?? 0)
    return {
      enable: t.enable !== false,
      min: Number.isFinite(min) && min >= 0 ? min : 0,
      max: Number.isFinite(max) && max >= min ? max : Math.max(min, 0),
    }
  } catch {
    return { enable: false, min: 0, max: 0 }
  }
}

function randDelay(throttle, fallbackMs) {
  if (!throttle?.enable) return fallbackMs
  const { min, max } = throttle
  if (min <= 0 && max <= 0) return fallbackMs
  const ms = min >= max ? min : min + Math.floor(Math.random() * (max - min + 1))
  return ms > 0 ? ms : fallbackMs
}

export { MAX_PROFILE_ID, registerOneProfile, listAllGroupIds, filterUserGroups }
