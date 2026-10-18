/**
 * #同步账号 命令 — 手动触发 genshin → Lotus 反向桥接
 *
 * 用法：
 *   #同步账号        — 同步当前账号的 genshin 账号到荷花档案
 *   #同步全部账号     — 同步所有 genshin 用户到荷花档案（仅管理员）
 *
 * 输出：可视化状态卡（renderStatusCard），与插件其它结果卡统一视觉。
 */

import { syncSingleQqUser, syncGenshinToLotus } from "../services/genshinBridge/reverseSync.js"
import { replyImage } from "../core/transport/reply.js"
import { renderStatusCard } from "../core/render/service.js"

const SKIP_REASONS = {
  lotus_already_has_login: "荷花档案已有完整登录信息",
  no_mys_user_with_ck: "genshin 侧该用户无有效 CK",
  empty_ltuid_or_cookie: "genshin 侧账号数据不完整",
}

const FAIL_REASONS = {
  no_genshin_account: "genshin 侧未找到该账号绑定的账号（无 CK）",
  unknown: "未知错误",
}

export class GenshinSync extends plugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Genshin Sync",
      dsc: "从 genshin 插件同步账号到荷花档案",
      event: "message",
      priority: 20,
      rule: [
        {
          reg: /^#同步账号(\d*)$/,
          fnc: "syncSelf",
          permission: "all",
        },
        {
          reg: /^#同步全部账号$/,
          fnc: "syncAll",
          permission: "master",
        },
      ],
    })
  }

  /** #同步账号 — 同步当前用户 */
  async syncSelf(e) {
    const qq = String(e.user_id)
    const match = e.msg?.match(/^#同步账号(\d*)$/)
    const targetQq = match?.[1] ? match[1] : qq

    // 只允许同步自己，或管理员同步他人
    if (targetQq !== qq && !e.isMaster) {
      await e.reply("仅管理员可同步他人账号", true)
      return true
    }

    await e.reply("正在从 genshin 同步账号信息，请稍候...", true)

    try {
      const result = await syncSingleQqUser(targetQq)
      const items = []
      let badge = "完成"
      let message = ""

      if (result.ok === false) {
        badge = "失败"
        items.push({ label: "结果", value: "失败" })
        items.push({ label: "原因", value: FAIL_REASONS[result.reason] || String(result.reason || "未知") })
        message = "未能从 genshin 同步账号。请确认该账号已在 genshin 插件中完成扫码登录（有有效 CK）。"
      } else if (result.synced) {
        badge = "已同步"
        items.push({ label: "ltuid", value: String(result.ltuid || "-") })
        for (const [game, roles] of Object.entries(result.uids || {})) {
          if (Array.isArray(roles) && roles.length) {
            items.push({ label: `${gameName(game)} 角色`, value: roles.map(r => r.uid).join("、") })
          }
        }
        message = "已把 genshin 侧的登录凭证与角色 UID 写入荷花档案，可直接用于自动签到。"
      } else if (result.skipped) {
        badge = "已跳过"
        items.push({ label: "结果", value: "已跳过" })
        items.push({ label: "原因", value: SKIP_REASONS[result.reason] || "无需同步" })
        message = "荷花档案已有完整登录信息，本次不覆盖；如需重置请先 #清除登录 再同步。"
      } else {
        items.push({ label: "结果", value: "无变化" })
      }

      const image = await renderStatusCard({
        title: "账号同步",
        subtitle: `账号 ${targetQq} · genshin → 荷花`,
        badge,
        message,
        userId: targetQq,
        items,
      }, { saveId: `lotus-sync-${targetQq}-${Date.now()}` })
      await replyImage(this, image, "[荷花插件]账号同步完成。")
    } catch (err) {
      logger?.error?.(`[Lotus-Plugin] genshin sync failed: ${err.message}`)
      logger?.error?.(err)
      const image = await renderStatusCard({
        title: "账号同步",
        subtitle: `账号 ${targetQq} · genshin → 荷花`,
        badge: "失败",
        message: err.message,
        userId: targetQq,
      }, { saveId: `lotus-sync-err-${targetQq}-${Date.now()}` }).catch(() => null)
      if (image) await replyImage(this, image, "[荷花插件]账号同步失败。")
      else await e.reply(`同步失败：${err.message}`, true)
    }

    return true
  }

  /** #同步全部账号 — 管理员全量同步 */
  async syncAll(e) {
    await e.reply("正在全量同步 genshin → 荷花档案，请稍候...", true)

    try {
      const result = await syncGenshinToLotus()
      const details = Array.isArray(result.details) ? result.details : []
      const failures = details.filter(d => d.error)

      const items = [
        { label: "新同步", value: String(result.synced ?? 0) },
        { label: "已有跳过", value: String(result.skipped ?? 0) },
        { label: "失败", value: String(result.failed ?? 0) },
      ]
      for (const f of failures.slice(0, 8)) {
        items.push({ label: `账号 ${f.qq}`, value: `失败：${String(f.error).slice(0, 60)}` })
      }
      if (failures.length > 8) {
        items.push({ label: "更多", value: `另有 ${failures.length - 8} 个失败` })
      }

      const image = await renderStatusCard({
        title: "全量账号同步",
        subtitle: `genshin → 荷花 · 共扫描 ${details.length} 个账号`,
        badge: String(result.synced ?? 0),
        message: `已把 genshin 侧账号批量同步到荷花档案：新同步 ${result.synced ?? 0} 个，已有完整登录信息者自动跳过 ${result.skipped ?? 0} 个（不覆盖荷花侧数据），失败 ${result.failed ?? 0} 个。`,
        userId: e.user_id,
        items,
      }, { saveId: `lotus-sync-all-${e.user_id || "master"}-${Date.now()}` })
      await replyImage(this, image, "[荷花插件]全量账号同步完成。")
    } catch (err) {
      logger?.error?.(`[Lotus-Plugin] genshin full sync failed: ${err.message}`)
      logger?.error?.(err)
      await e.reply(`全量同步失败：${err.message}`, true)
    }

    return true
  }
}

function gameName(key) {
  return { gs: "原神", sr: "星铁", zzz: "绝区零" }[key] || key
}
