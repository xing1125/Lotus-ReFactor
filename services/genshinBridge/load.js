import { pathToFileURL } from "node:url"

const cache = new Map()

/**
 * 运行时加载 genshin 插件的模块（default 导出）。
 *
 * 为什么需要这个包装：genshin 的模块顶层会 `import { cfg } from "#index"`，
 * 而 #index 的初始化又要把整条插件链路带起来，两边互相等待，首次求值时会命中 TDZ：
 *   ReferenceError: Cannot access 'Data' before initialization
 * 实测在独立进程里必现（Lotus 先加载、genshin 后加载）。
 *
 * 这个异常只发生在第一次求值；此时模块图已经执行完毕，再 import 一次会命中
 * 模块缓存并拿到完整模块。所以这里做「一次重试 + 结果缓存」，不需要改 genshin。
 */
export async function importGenshinModule(file) {
  const url = pathToFileURL(file).href
  const cached = cache.get(url)
  if (cached) return cached

  const task = (async () => {
    try {
      return (await import(url)).default
    } catch (error) {
      if (!/before initialization/.test(String(error?.message || ""))) throw error
      globalThis.logger?.mark?.(
        `[Lotus-Plugin] 跨插件加载命中循环依赖 TDZ，重试一次：${error.message}`,
      )
      return (await import(url)).default
    }
  })().catch((error) => {
    // 失败不缓存，下次调用重新尝试。
    cache.delete(url)
    throw error
  })

  cache.set(url, task)
  return task
}
