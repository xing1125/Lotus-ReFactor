/**
 * 下载图片字节，带**真正生效**的硬超时。
 *
 * 历史坑（2026-10-23 体力卡死）：原实现只用一个 AbortController + setTimeout，
 * 看着有 15s 超时，实际上在没有超时之外还漏了一种情况——
 * 本进程 undici 的 ReadableStream 校验坏掉时，`fetch()` 会正常 resolve
 *（TCP 已关、对端已 200），但 `response.body` 背后的流永不 end。
 * 此时 `controller.abort()` 对**已经 resolve 的 fetch** 完全无效，
 * `for await` 永不结束、定时器也不报错，整张卡片就永久挂住
 *（线上表现：collect 成功 1543ms，然后 60s 零日志、不出图）。
 *
 * 所以这里做两件事：
 * 1. 用 Promise.race 做进程内硬超时，保证一定结算；
 * 2. 改用 `response.arrayBuffer()` 读体，而不是直接遍历 `response.body`——
 *    app.js 给 Response 的 text/json/arrayBuffer 挂了 8s deadline 并用
 *    node:http 重放（仅 GET），遍历 body 会绕过这道兜底。
 */
export async function fetchImageBytes(url, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 15000, maxBytes = 16 * 1024 * 1024 } = {}) {
  const controller = new AbortController()
  let timer
  // 注意：不要 unref，否则进程空闲时定时器不触发。
  const hardTimeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // 对还在飞的 fetch 尽力中止；对已 resolve 的无效，靠 race 兜底
      try { controller.abort() } catch {}
      reject(new Error(`图片下载超时（${timeoutMs}ms）`))
    }, timeoutMs)
  })

  const work = (async () => {
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`图片请求 HTTP ${response.status}`)
    if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("图片超过渲染大小限制")
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw new Error("图片超过渲染大小限制")
    if (!buffer.length) throw new Error("图片响应为空")
    return buffer
  })()
  // race 之后 work 仍可能在跑，必须挂个 catch 吃掉它迟到的 reject，
  // 否则会变成 unhandledRejection 把进程搞崩。
  work.catch(() => {})

  try {
    return await Promise.race([work, hardTimeout])
  } finally {
    clearTimeout(timer)
    try { controller.abort() } catch {}
  }
}
