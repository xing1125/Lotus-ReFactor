const BasePlugin = globalThis.plugin

import QRCode from "qrcode"
import { LOTUS_INTERCEPT_PRIORITY } from "../core/intercept/priority.js"
import { renderStatusCard, renderTemplate } from "../core/render/service.js"
import { replyImage, replyText } from "../core/transport/reply.js"
import {
  bindCookie,
  runCheckin,
  startQrLogin,
  pollQrLogin,
  cancelQrLogin,
  loadWeiboAccount,
  saveWeiboAccount,
  deleteWeiboAccount,
  setAutoCheckin,
  getCheckinStatus,
  listAllWeiboAccounts,
  extractSub,
  pushToMaster,
  bindLink,
  redeemCdk,
} from "../services/weibo/service.js"

const QR_POLL_INTERVAL_MS = 3000
const QR_POLL_MAX_TIMES = 60 // 3 分钟
const AUTO_CHECKIN_CRON = "0 15 0 * * ? *" // 每日 00:15 自动签到（与荷花主签到一致）

const pollingLocks = new Set() // 防止同 QQ 重复启动扫码轮询

export class LotusWeibo extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Weibo",
      dsc: "微博超话签到（cookie 绑定 + 扫码登录）",
      event: "message",
      priority: LOTUS_INTERCEPT_PRIORITY,
      rule: [
        { reg: "^#wb帮助$", fnc: "help" },
        { reg: "^#wbcookie\\s+[\\s\\S]+$", fnc: "bindCookie" },
        { reg: "^#绑定(微博|超话)ck\\s*[\\s\\S]*$", fnc: "bindCookie" },
        { reg: "^#wb(扫码|扫码登录|二维码登录)$", fnc: "qrLogin" },
        { reg: "^#取消wb扫码$", fnc: "cancelQr" },
        { reg: "^#wb签到$", fnc: "checkin" },
        { reg: "^#wb签到状态$", fnc: "status" },
        { reg: "^#(开启|关闭)wb自动签到$", fnc: "toggleAuto" },
        { reg: "^#(删除|清除)wb(登录|cookie|Cookie)$", fnc: "clearLogin" },
        { reg: "^#删除(全部)?(微博|超话)ck$", fnc: "clearLogin" },
        { reg: "^#wb链接\\s+[\\s\\S]+$", fnc: "bindLink" },
        { reg: "^#(微博|超话)cdk$", fnc: "redeemCdk" },
        { reg: "^#(微博|超话)cdk帮助$", fnc: "cdkHelp" },
        // 兼容 ji-plugin 旧指令
        { reg: "^#(星铁|原神)?(微博|超话)签到$", fnc: "checkin" },
        { reg: "^#微博(重新)?(全部签到|签到任务)$", fnc: "checkin" },
        { reg: "^#(微博|超话)(ck|链接)?帮助$", fnc: "help" },
        { reg: "^#更新(微博|超话)(兑换码|cdk)$", fnc: "cdkHelp" },
      ],
    })
    this.task = [
      {
        name: "荷花插件微博超话自动签到",
        cron: AUTO_CHECKIN_CRON,
        fnc: this.autoCheckinTask.bind(this),
        log: false,
      },
    ]
  }

  async help() {
    const lines = [
      "微博超话签到帮助",
      "",
      "#wbcookie <完整cookie>  绑定 cookie（m.weibo.cn 登录后 F12 复制）",
      "#wb扫码 / #wb扫码登录  生成二维码，手机微博 App 扫码登录",
      "#wb签到  立即签到所有关注超话",
      "#wb签到状态  查看 cookie 有效性 + 上次签到结果",
      "#开启wb自动签到 / #关闭wb自动签到",
      "#删除wb登录  清除已绑定的微博 cookie",
      "#wb链接 <api.weibo.cn/2/cardlist?...>  绑定 app 链接（兑换 CDK 需要）",
      "#微博cdk / #超话cdk  兑换「天签到礼包」兑换码",
      "#微博cdk帮助  查看 CDK 兑换说明",
      "",
      "说明：",
      "1. cookie 约 7 天失效，失效后插件会推送提醒，需重新绑定或扫码",
      "2. 签到对象 = 仅 原神 / 崩坏：星穹铁道 / 绝区零 三个游戏超话（其余关注超话不签）",
      "3. cookie 复制来源：浏览器无痕模式登录 m.weibo.cn → F12 → Network → 任意请求的 Cookie 头",
      "4. CDK 兑换需先 #wb链接 绑定 app 链接（手机微博 App 打开活动页分享出的 cardlist 链接）",
    ]
    await replyText(this, lines.join("\n"))
    return true
  }

  async bindCookie() {
    const qq = String(this.e.user_id)
    const cookie = String(this.e.msg || "").replace(/^#wbcookie\s+/, "").replace(/^#绑定(微博|超话)ck\s*/, "").trim()
    if (!cookie) {
      await replyText(this, "[荷花插件]请附上 cookie，例如：#wbcookie SUB=xxx; SUBP=xxx; _T_WM=xxx")
      return true
    }
    await replyText(this, "[荷花插件]正在校验微博 cookie 有效性…")
    const r = await bindCookie(qq, cookie, { nickname: this.e.sender?.card || this.e.sender?.nickname || "" })
    if (!r.ok) {
      const hint = r.reason === "missing_SUB"
        ? "cookie 缺少 SUB 字段，请确认复制的是 m.weibo.cn 的完整 cookie（需含 SUB、SUBP、_T_WM）。"
        : r.reason === "cookie_expired"
          ? "cookie 已失效或被微博识别为异地，请重新登录 m.weibo.cn 后复制。"
          : `cookie 校验失败（${r.reason}）。`
      await replyText(this, `[荷花插件]微博 cookie 绑定失败：${hint}`)
      return true
    }
    const image = await renderStatusCard({
      title: "微博超话签到",
      subtitle: "Cookie 绑定成功",
      badge: "完成",
      message: `已绑定微博（关注 ${r.topicCount} 个超话），自动签到已开启。后续仅签到 原神 / 崩坏星穹铁道 / 绝区零 三个游戏超话，cookie 约 7 天失效。`,
      userId: qq,
      items: [
        { label: "账号", value: qq },
        { label: "SUB", value: extractSub(cookie) },
        { label: "关注超话", value: String(r.topicCount) },
        { label: "自动签到", value: "已开启" },
      ],
    }, { saveId: `lotus-weibo-bind-${qq}` })
    await replyImage(this, image, "[荷花插件]微博 cookie 绑定成功。")
    return true
  }

  async qrLogin() {
    const qq = String(this.e.user_id)
    if (pollingLocks.has(qq)) {
      await replyText(this, "[荷花插件]当前已有微博二维码等待扫码，请先 #取消wb扫码 或等待超时。")
      return true
    }
    pollingLocks.add(qq)
    let pollStarted = false
    try {
      await replyText(this, "[荷花插件]正在申请微博登录二维码…")
      const started = await startQrLogin(qq)
      if (!started.ok) {
        await replyText(this, `[荷花插件]微博二维码申请失败：${started.reason || started.message || "未知错误"}`)
        return true
      }
      // 渲染二维码卡片（直接用微博返回的二维码图片 URL，下载转 base64 防盗链）
      const qrDataUrl = await fetchQrImageAsDataUrl(started.image)
      const image = await renderTemplate("qr-login", {
        profileId: "微博",
        qrDataUrl,
        title: "微博扫码登录",
        hint: "请使用微博 App 扫描上方二维码确认登录",
      }, { saveId: `lotus-weibo-qr-${qq}` }).catch(() => null)

      if (image) {
        await replyImage(this, image, "[荷花插件]请用微博 App 扫码登录，3 分钟内有效。")
      } else {
        // 渲染失败，直接发二维码图片
        const seg = globalThis.segment?.image
        if (seg) await this.e.reply(seg(qrDataUrl))
        else await replyText(this, "[荷花插件]二维码生成失败，请改用 #wbcookie 绑定。")
      }

      // 后台轮询扫码状态
      pollStarted = true
      this.pollQrLoginInBackground(qq).catch(error => {
        logger?.error?.(`[Lotus-Plugin] weibo qr poll failed: ${error.message}`)
      })
    } finally {
      // 兜底：仅当未进入后台轮询（如二维码申请/渲染中途抛异常）时释放锁；
      // 正常流程锁由 pollQrLoginInBackground 内部 delete（轮询结束/超时），避免提前释放导致重复扫码
      if (!pollStarted) pollingLocks.delete(qq)
    }
    return true
  }

  /** 后台轮询扫码状态，确认后自动换 cookie 并保存 */
  async pollQrLoginInBackground(qq) {
    for (let i = 0; i < QR_POLL_MAX_TIMES; i++) {
      await new Promise(resolve => setTimeout(resolve, QR_POLL_INTERVAL_MS))
      const r = await pollQrLogin(qq)
      if (r.status === "scanned") {
        if (i === 0) await replyText(this, "[荷花插件]已扫码，请在微博 App 确认登录。")
        continue
      }
      if (r.status === "confirmed" || r.status === "success") {
        if (r.ok) {
          const image = await renderStatusCard({
            title: "微博扫码登录",
            subtitle: "登录成功",
            badge: "完成",
            message: `微博 cookie 已自动保存，已绑定 ${r.topicCount || 0} 个关注超话，自动签到已开启。`,
            userId: qq,
            items: [
              { label: "账号", value: qq },
              { label: "超话数", value: String(r.topicCount || 0) },
              { label: "自动签到", value: "已开启" },
            ],
          }, { saveId: `lotus-weibo-qr-success-${qq}` })
          await replyImage(this, image, "[荷花插件]微博扫码登录成功，cookie 已保存。")
        } else {
          await replyText(this, `[荷花插件]微博登录失败：${r.reason || r.message || "未知错误"}，请重试。`)
        }
        pollingLocks.delete(qq)
        return
      }
      if (r.status === "expired" || r.status === "error") {
        await replyText(this, `[荷花插件]微博扫码登录已${r.status === "expired" ? "超时" : "出错"}，请重新 #wb扫码。`)
        pollingLocks.delete(qq)
        return
      }
    }
    await replyText(this, "[荷花插件]微博扫码超时（3 分钟），请重新 #wb扫码。")
    pollingLocks.delete(qq)
  }

  async cancelQr() {
    const qq = String(this.e.user_id)
    const cancelled = await cancelQrLogin(qq)
    pollingLocks.delete(qq)
    await replyText(this, cancelled ? "[荷花插件]已取消微博扫码。" : "[荷花插件]当前没有进行中的微博扫码会话。")
    return true
  }

  async checkin() {
    const qq = String(this.e.user_id)
    const account = await loadWeiboAccount(qq)
    if (!account?.cookie) {
      await replyText(this, "[荷花插件]未绑定微博 cookie，请先 #wbcookie 绑定 或 #wb扫码 登录。")
      return true
    }
    await replyText(this, "[荷花插件]正在签到 原神 / 崩铁 / 绝区零 超话（其余关注超话不签）…")
    const r = await runCheckin(qq)
    if (!r.ok) {
      const hint = r.cookieExpired
        ? "cookie 已失效，请重新 #wb扫码 或 #wbcookie 绑定。"
        : `签到失败：${r.reason || "未知错误"}`
      await replyText(this, `[荷花插件]微博签到失败：${hint}`)
      return true
    }
    await replyImage(this, await renderCheckinCard(qq, r), "[荷花插件]微博超话签到完成。")
    return true
  }

  async status() {
    const qq = String(this.e.user_id)
    const r = await getCheckinStatus(qq)
    if (!r.ok) {
      await replyText(this, "[荷花插件]未绑定微博 cookie，请先 #wbcookie 绑定 或 #wb扫码 登录。")
      return true
    }
    const a = r.account
    const last = a.last_result
    const image = await renderStatusCard({
      title: "微博超话签到",
      subtitle: "状态查询",
      badge: a.cookie_valid ? "正常" : "失效",
      message: a.cookie_valid
        ? `cookie 有效，关注 ${a.topic_count} 个超话（实际仅签到 原神/崩铁/绝区零）。`
        : `cookie 已失效（${a.cookie_reason || ""}），请重新登录。`,
      userId: qq,
      items: [
        { label: "账号", value: qq },
        { label: "自动签到", value: a.auto_checkin ? "开启" : "关闭" },
        { label: "Cookie", value: a.cookie_valid ? "有效" : "失效" },
        { label: "超话数", value: String(a.topic_count ?? "-") },
        { label: "上次签到", value: a.last_checkin || "未签到" },
        { label: "上次结果", value: last ? `成功${last.signed}/${last.total}（跳过${last.skipped} 失败${last.failed}）` : "-" },
      ],
    }, { saveId: `lotus-weibo-status-${qq}` })
    await replyImage(this, image, "[荷花插件]微博签到状态已查询。")
    return true
  }

  async toggleAuto() {
    const qq = String(this.e.user_id)
    const enable = /^#开启/.test(this.e.msg || "")
    const r = await setAutoCheckin(qq, enable)
    if (!r.ok) {
      await replyText(this, "[荷花插件]未绑定微博 cookie，请先登录。")
      return true
    }
    await replyText(this, `[荷花插件]微博自动签到已${r.auto_checkin ? "开启" : "关闭"}。`)
    return true
  }

  async clearLogin() {
    const qq = String(this.e.user_id)
    const deleted = await deleteWeiboAccount(qq)
    await replyText(this, deleted ? "[荷花插件]已清除微博登录信息。" : "[荷花插件]未绑定微博 cookie，无需清除。")
    return true
  }

  async bindLink() {
    const qq = String(this.e.user_id)
    const link = String(this.e.msg || "").replace(/^#wb链接\s*/, "").trim()
    if (!link) {
      await replyText(this, "[荷花插件]请附上微博 app 链接，例如：#wb链接 https://api.weibo.cn/2/cardlist?c=...&s=...&aid=...&uid=...&from=...&gsid=...")
      return true
    }
    const r = await bindLink(qq, link)
    if (!r.ok) {
      await replyText(this, `[荷花插件]微博 app 链接绑定失败：${r.message || r.reason}`)
      return true
    }
    await replyText(this, `[荷花插件]微博 app 链接绑定成功（uid: ${r.uid || "未知"}）。现在可用 #微博cdk 兑换天签到礼包。${r.warning ? "\n⚠ " + r.warning : ""}`)
    return true
  }

  async redeemCdk() {
    const qq = String(this.e.user_id)
    await replyText(this, "[荷花插件]正在兑换微博天签到礼包...")
    const r = await redeemCdk(qq)
    if (!r.ok) {
      await replyText(this, `[荷花插件]微博 CDK 兑换失败：${r.message || r.reason}`)
      return true
    }
    const lines = ["【微博天签到礼包兑换结果】"]
    for (const item of r.results) {
      if (item.ok)
        lines.push(`${item.game} [ticket ${item.ticketId}]：${item.prize}${item.card ? `（${item.card}）` : ""}`)
      else
        lines.push(`${item.game} [ticket ${item.ticketId}]：失败 ${item.reason || ""}`)
    }
    await replyText(this, lines.join("\n"))
    return true
  }

  async cdkHelp() {
    const lines = [
      "微博 CDK 兑换帮助",
      "",
      "兑换的是微博超话「天签到礼包」兑换码（原神 / 星穹铁道）。",
      "",
      "步骤：",
      "1. 手机微博 App 打开对应超话活动页，分享/复制出 cardlist 链接",
      "   形如：api.weibo.cn/2/cardlist?c=xxx&s=xxx&aid=xxx&uid=xxx&from=xxx&gsid=xxx",
      "2. #wb链接 <上面的链接>  绑定（CDK 兑换必须，普通超话签到不需要）",
      "3. #微博cdk  或 #超话cdk  兑换全部 ticket",
      "",
      "注意：ticket_id 为活动内置固定值，活动结束后会失效；若大量失败多为活动过期。",
    ]
    await replyText(this, lines.join("\n"))
    return true
  }

  /** 每日定时自动签到：遍历所有 auto_checkin=true 的账号 */
  async autoCheckinTask() {
    let accounts
    try {
      accounts = await listAllWeiboAccounts()
    } catch (error) {
      logger?.warn?.(`[Lotus-Plugin] weibo auto checkin list failed: ${error.message}`)
      return
    }
    if (!accounts.length) return
    logger?.mark?.(`[Lotus-Plugin] weibo auto checkin: ${accounts.length} account(s)`)
    const results = []
    for (const account of accounts) {
      if (!account.auto_checkin) continue
      try {
        const r = await runCheckin(account.qq, account.cookie)
        results.push({ qq: account.qq, name: account.nickname || account.qq, r })
        if (!r.ok && r.cookieExpired) {
          // cookie 失效，记录但暂不推送（避免误推，留给用户主动查状态时发现）
          logger?.warn?.(`[Lotus-Plugin] weibo cookie expired for ${account.qq}`)
          continue
        }
        logger?.mark?.(`[Lotus-Plugin] weibo checkin ${account.qq}: 签到${r.signed}/${r.total} 跳过${r.skipped} 失败${r.failed}`)
      } catch (error) {
        logger?.error?.(`[Lotus-Plugin] weibo auto checkin ${account.qq} failed: ${error.message}`)
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    // 发结果：渲染每账户专属卡，私聊推给 BOT主人（对齐荷花主签到汇总看板，常开监控通道）
    for (const { qq, name, r } of results) {
      try {
        const image = await renderCheckinCard(qq, r)
        const text = `【微博自动签到】${name}：签到 ${r.signed}/${r.total}，已签 ${r.skipped}，失败 ${r.failed}`
        await pushToMaster(text, image)
      } catch (e) {
        logger?.warn?.(`[Lotus-Plugin] weibo auto result push failed for ${qq}: ${e.message}`)
      }
    }
  }
}

/** 渲染签到结果专属玻璃卡（weibo-checkin 模板） */
async function renderCheckinCard(qq, result) {
  return renderTemplate("weibo-checkin", {
    title: "微博超话签到",
    subtitle: `签到 ${result.signed}/${result.total}`,
    message: `共 ${result.total} 个超话：成功 ${result.signed}，已签 ${result.skipped}，失败 ${result.failed}。`,
    result,
    userId: qq,
  }, { saveId: `lotus-weibo-checkin-${qq}-${Date.now()}` })
}

/** 下载微博二维码图片转 dataURL（防盗链 + 适配 QRCode 渲染） */
async function fetchQrImageAsDataUrl(imageUrl) {
  try {
    const res = await fetch(imageUrl, {
      headers: { Referer: "https://m.weibo.cn", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X)" },
    })
    if (!res.ok) throw new Error(`http ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const b64 = buf.toString("base64")
    const mime = res.headers.get("content-type") || "image/png"
    return `data:${mime};base64,${b64}`
  } catch (error) {
    logger?.warn?.(`[Lotus-Plugin] weibo qr image fetch failed: ${error.message}, fallback to url`)
    return imageUrl
  }
}
