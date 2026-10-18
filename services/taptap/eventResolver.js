// TapTap game-sign 活动 id 自动发现（不硬编码，按用户要求自动探测）
import { withPage } from "./browser.js"

const EVENT_RE = /\/events\/game\-sign\/([a-z0-9]+)/i

/** 24h 内有效缓存 */
export function getCachedEvent(status, gameKey) {
  const e = status?.games?.[gameKey]?.event
  if (e?.id && e?.resolvedAt && Date.now() - e.resolvedAt < 1000 * 60 * 60 * 24) return e.id
  return null
}

/** 活动是否仍在进行（页面存在「立即签到」按钮且未显示已结束） */
export async function isEventActive(eventId) {
  return withPage(true, async (page) => {
    await page.goto(`https://www.taptap.cn/events/game-sign/${eventId}`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    })
    const info = await page.evaluate(() => {
      const t = document.body.innerText || ""
      return {
        ended: /活动已结束|已过期|活动结束/.test(t),
        hasSign: [...document.querySelectorAll("button,a,div,span")].some(
          (e) => (e.innerText || e.textContent || "").trim() === "立即签到"
        ),
      }
    })
    return !info.ended && info.hasSign
  }).catch(() => false)
}

/**
 * 自动发现某游戏当前进行中的 game-sign 活动 id。
 * 优先 config.event_override；否则抓取游戏详情/活动/动态/礼包/攻略/搜索页中的 game-sign 链接。
 */
export async function discoverEvent(game, { status, overrideId } = {}) {
  if (overrideId) return { id: overrideId, source: "override", candidates: [] }
  const candidates = await withPage(true, async (page) => {
    const found = []
    const urls = [
      `https://www.taptap.cn/app/${game.appId}`,
      `https://www.taptap.cn/app/${game.appId}/event`,
      `https://www.taptap.cn/app/${game.appId}/moment`,
      `https://www.taptap.cn/app/${game.appId}/gift`,
      `https://www.taptap.cn/app/${game.appId}/strategy`,
      `https://www.taptap.cn/search?word=${encodeURIComponent(game.name + "签到")}`,
    ]
    for (const u of urls) {
      try {
        await page.goto(u, { waitUntil: "networkidle2", timeout: 30000 })
        const links = await page.evaluate((reSrc) => {
          const RE = new RegExp(reSrc, "i")
          const out = []
          document.querySelectorAll("a[href]").forEach((a) => {
            const m = (a.getAttribute("href") || "").match(RE)
            if (m) {
              out.push({ id: m[1], href: a.href, text: (a.innerText || a.textContent || "").trim().slice(0, 40) })
            }
          })
          return out
        }, EVENT_RE.source)
        found.push(...links)
      } catch {
        /* 单个 URL 失败忽略 */
      }
    }
    const seen = new Set()
    return found.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))
  }).catch((e) => {
    logger?.warn?.(`[Lotus-TapTap] 发现 ${game.name} 活动失败：${e.message}`)
    return []
  })

  if (!candidates.length) return { id: null, source: "none", candidates: [] }
  const first = candidates[0].id
  const active = await isEventActive(first).catch(() => false)
  return { id: first, source: active ? "discovered" : "discovered_unverified", candidates, active }
}

/** 解析某游戏当前应使用的 event id（带缓存 + 强制刷新） */
export async function resolveEvent(game, { status, force = false, overrideId } = {}) {
  if (!force) {
    const cached = getCachedEvent(status, game.key)
    if (cached) return { id: cached, source: "cache", candidates: [] }
  }
  return discoverEvent(game, { status, overrideId })
}
