// TapTap 签到浏览器管理：复用 Yunzai 环境已有的 puppeteer + 系统 Chrome，
// 通过固定 userDataDir 持久保存登录态（与渲染卡片用的浏览器同源）。
import puppeteer from "puppeteer"
import fs from "node:fs"
import path from "node:path"
import yaml from "yaml"
import { profileDir } from "./config.js"

const ARGS = [
  "--disable-gpu",
  "--disable-setuid-sandbox",
  "--no-sandbox",
  "--no-zygote",
  "--disable-dev-shm-usage",
]

/** 读取 Yunzai 的 chromium_path（与渲染器同源）；未配置则返回 undefined 由 puppeteer 自决 */
function readChromiumPath() {
  try {
    const botYaml = path.join(process.cwd(), "app/config/config/bot.yaml")
    if (fs.existsSync(botYaml)) {
      const c = yaml.parse(fs.readFileSync(botYaml, "utf8")) || {}
      const p = c?.bot?.chromium_path
      if (p && fs.existsSync(p)) return p
    }
  } catch {
    /* ignore */
  }
  return undefined
}

// 串行锁：同一时刻只能有一个浏览器实例（多账号按 user 串行排队，避免多 Chrome 并发冲突）
let lock = Promise.resolve()
let launching = false

/**
 * 以串行方式打开一个浏览器实例执行 fn(page)，结束后关闭。
 * headless=true 用于自动签到/渲染；headless=false 用于登录（需可见窗口操作）。
 * userId 指定独立的 userDataDir（多账号登录态隔离），默认空串 = 全局 profile。
 */
export async function withPage(headless, fn, userId) {
  const run = lock.then(async () => {
    if (launching) await new Promise((r) => setTimeout(r, 500))
    launching = true
    const executablePath = readChromiumPath() || undefined
    let browser
    try {
      browser = await puppeteer.launch({
        headless,
        userDataDir: profileDir(userId),
        executablePath,
        args: ARGS,
      })
    } catch (err) {
      launching = false
      logger?.error?.(`[Lotus-TapTap] 浏览器启动失败：${err.message}`)
      throw new Error(
        "浏览器启动失败：" +
          err.message +
          "。请确认已安装 Chromium（可在 Yunzai 根目录执行 node node_modules/puppeteer/install.js），或在 app/config/config/bot.yaml 设置 chromium_path。"
      )
    }
    try {
      const page = await browser.newPage()
      page.setDefaultTimeout(60000)
      page.setDefaultNavigationTimeout(60000)
      return await fn(page)
    } finally {
      await browser.close().catch(() => {})
      launching = false
    }
  })
  lock = run.then(
    () => {},
    () => {}
  )
  return run
}

/** 指定 user_id 的持久化 profile 是否已存在（即至少登录过一次） */
export function hasProfile(userId) {
  const dir = profileDir(userId)
  return (
    fs.existsSync(path.join(dir, "Default", "Cookies")) ||
    fs.existsSync(path.join(dir, "Cookies"))
  )
}
