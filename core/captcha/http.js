export async function requestJson(url, options = {}, context = {}) {
  // preferNative：跳过 undici，直接走 app.js 提供的 node:http 直连通道。
  // 给「同一个 challenge 不能被重放」的场景用（test_nine 打码）。
  const native = globalThis.__nativeFetch
  const useNative = options.preferNative === true && typeof native === "function"
  const fetchImpl = useNative
    ? native
    : (context.fetch || globalThis.fetch)
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable")

  // preferNative 是本函数自己的选项，不能混进 fetch init。
  const { preferNative: _preferNative, ...fetchOptions } = options

  const timeoutMs = Number(options.timeoutMs || 30000)
  const controller = new AbortController()

  // 硬超时兜底（必须，别删）。
  // AbortController 只能中断「还没返回响应」的请求。本进程内 undici 的
  // ReadableStream 校验是坏的（见 app.js 里的 [FETCH-STACK]），典型表现是：
  // fetch() 正常 resolve、TCP 已关闭、对端已 200，但 response.text() 所在的
  // body 流永远不 end —— 此时 abort() 对已经 resolve 的 fetch 毫无作用，
  // 上层会永久悬停在 await response.text()，既不打日志也不报错，
  // provider.solve 不结算 => 既不 success 也不 provider-fail，用户侧全程无输出。
  // 所以这里用 Promise.race 兜一层，保证任何情况下都能落到 provider-fail。
  let timer = null
  const hardTimeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { controller.abort() } catch {}
      const error = new Error(`request timeout after ${timeoutMs}ms: ${url}`)
      error.name = "TimeoutError"
      reject(error)
    }, timeoutMs)
  })

  const work = (async () => {
    const response = await fetchImpl(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
    const text = await response.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      const error = new Error(`invalid json response from ${url}: ${text.slice(0, 300)}`)
      error.rawText = text
      throw error
    }

    if (!response.ok) {
      const error = new Error(`http ${response.status} ${response.statusText}`)
      error.status = response.status
      error.data = data
      throw error
    }

    return data
  })()

  try {
    return await Promise.race([work, hardTimeout])
  } finally {
    if (timer) { clearTimeout(timer); timer = null }
    // race 已结算后 work 才 reject 会变成 unhandledRejection，这里挂个空 catch。
    work.catch(() => {})
  }
}

export function withQuery(endpoint, query = {}) {
  const url = new URL(endpoint)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

export function formBody(fields = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value))
    }
  }
  return params
}

export function mergeQueryString(fields = {}, queryString = "") {
  const result = { ...fields }
  const query = String(queryString || "").replace(/^\?/, "")
  if (!query) return result

  for (const [key, value] of new URLSearchParams(query)) {
    if (key && value !== "") result[key] = value
  }
  return result
}

export function appendKey(fields, key) {
  const raw = String(key || "").trim()
  if (!raw) return fields
  if (raw.includes("=")) return mergeQueryString(fields, raw)
  return {
    ...fields,
    appkey: raw,
  }
}

export function sleep(ms, context = {}) {
  if (typeof context.sleep === "function") return context.sleep(ms)
  return new Promise(resolve => setTimeout(resolve, ms))
}
