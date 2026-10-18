// TapTap 签到执行：基于已登录的持久化浏览器会话点击「立即签到」
import { withPage } from "./browser.js"

/** 指定 user_id 的浏览器是否已登录 TapTap（会话 cookie 检测） */
export async function isLoggedIn(userId) {
  return withPage(true, async (page) => {
    await page.goto("https://www.taptap.cn/", { waitUntil: "domcontentloaded", timeout: 30000 })
    return page.evaluate(() => {
      const c = document.cookie || ""
      return /TAPSID|tapsid|taptap_sid|SESS|tt_token|token/.test(c)
    })
  }, userId).catch(() => false)
}

/**
 * 对单个 game-sign 活动执行签到（指定 user_id 的登录态）。
 * @returns {{ok:boolean, already?:boolean, reason?:string, message?:string, eventId:string}}
 */
export async function signEvent(userId, eventId) {
  return withPage(true, async (page) => {
    const url = `https://www.taptap.cn/events/game-sign/${eventId}`
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 })

    const needLogin = await page.evaluate(() => {
      const t = document.body.innerText || ""
      return /请登录|立即登录|扫码登录|登录后/.test(t) && !/立即签到|已签到/.test(t)
    })
    if (needLogin) return { ok: false, reason: "not_logged_in", eventId }

    const res = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const findBtn = () =>
        [...document.querySelectorAll("button,a,div,span")].find((e) => {
          const t = (e.innerText || e.textContent || "").trim()
          return t === "立即签到" || t === "签到"
        })
      const btn = findBtn()
      if (!btn) {
        const t = document.body.innerText || ""
        if (/活动已结束|已过期|活动结束/.test(t)) return { found: false, reason: "event_ended" }
        if (/今日已签到|已签到|你已签到/.test(t)) return { found: false, already: true }
        return { found: false, reason: "no_sign_button" }
      }
      btn.click()
      await sleep(3000)
      const t = document.body.innerText || ""
      if (/签到成功|签到完成|签到啦/.test(t)) return { found: true, ok: true, message: "签到成功" }
      if (/今日已签到|已签到|你已签到/.test(t)) return { found: true, ok: true, already: true, message: "今日已签到" }
      if (/活动已结束|已过期|活动结束/.test(t)) return { found: true, ok: false, reason: "event_ended" }
      return { found: true, ok: false, reason: "unknown_result", message: t.slice(0, 160) }
    })

    return { ...res, eventId }
  }, userId).catch((e) => ({ ok: false, reason: "error", message: e.message, eventId }))
}
