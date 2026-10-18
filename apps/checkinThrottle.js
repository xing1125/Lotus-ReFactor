// 自动签到错峰延迟设置（git untracked，git pull 安全）
//
// 目的：固定模式下所有 profile 的计划时间都是同一个 fixed_time（如 00:10），
// 到点后 runDuePlan 会在同一分钟内串行逐个打连接器，profile 数量大时会把
// 连接器（米游社接口 / 本机代理）瞬时打满，导致卡顿、限流、甚至签到失败雪崩。
//
// 本文件提供管理员命令，把「每个签到之间随机等待 N 秒」的错峰策略写入
// config/global.yaml 的 scheduler.throttle，执行引擎（services/checkin/scheduled.js）
// 与管理员全体补签（apps/adminCheckin.js）都会读取它并自动错峰。
//
// 命令（bot 主人权限，permission: master）：
//   #签到错峰              查看当前错峰状态与用法
//   #签到错峰 开 / 关       开启 / 关闭错峰
//   #签到错峰 <秒>          固定间隔（如 #签到错峰 5 -> 每个之间等 5 秒）
//   #签到错峰 <最小> <最大> 随机区间（如 #签到错峰 3 8 -> 每个之间随机 3~8 秒）
// 别名：#错峰 / #延迟签到 / #签到延迟 / #错峰设置

const BasePlugin = globalThis.plugin

import { loadGlobalConfig, saveGlobalConfig } from "../core/config/global.js"
import { replyText, replyImage } from "../core/transport/reply.js"
import { renderStatusCard } from "../core/render/service.js"

const DEFAULT_THROTTLE = { enable: true, delay_ms_min: 3000, delay_ms_max: 6000 }

function readThrottle(config) {
  const t = config?.scheduler?.throttle
  if (!t) return { ...DEFAULT_THROTTLE }
  const min = Number(t.delay_ms_min ?? DEFAULT_THROTTLE.delay_ms_min)
  const max = Number(t.delay_ms_max ?? DEFAULT_THROTTLE.delay_ms_max)
  return {
    enable: t.enable !== false,
    delay_ms_min: Number.isFinite(min) && min >= 0 ? min : DEFAULT_THROTTLE.delay_ms_min,
    delay_ms_max: Number.isFinite(max) && max >= 0 ? max : DEFAULT_THROTTLE.delay_ms_max,
  }
}

export class LotusCheckinThrottle extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Checkin Throttle",
      dsc: "自动签到错峰延迟设置（防大规模签到打满连接器）",
      event: "message",
      priority: 19,
      rule: [
        {
          reg: "^#(签到错峰|错峰|延迟签到|签到延迟|错峰设置)(.*)$",
          fnc: "throttleManage",
          permission: "master",
        },
      ],
    })
  }

  async throttleManage() {
    const tail = String(this.e.msg).replace(/^#(签到错峰|错峰|延迟签到|签到延迟|错峰设置)/, "").trim()
    const tokens = tail.split(/\s+/).filter(Boolean)

    if (!tokens.length) {
      const t = readThrottle(await loadGlobalConfig())
      const status = t.enable ? "已开启" : "已关闭"
      const range = t.enable
        ? `每个签到之间随机等待 ${Math.round(t.delay_ms_min / 1000)}~${Math.round(t.delay_ms_max / 1000)} 秒`
        : "（关闭后大规模签到将无间隔连续执行，可能打满连接器）"
      const image = await renderStatusCard({
        title: "自动签到错峰",
        subtitle: "防止大规模签到瞬时打满连接器",
        badge: status,
        message: `${range}。错峰在自动调度（计划内 due）与管理员 #全员二次签到 时生效，避免同一分钟大量 profile 连续请求导致连接器卡顿 / 限流。用法：#签到错峰 开/关 · #签到错峰 <秒> · #签到错峰 <最小> <最大>。`,
        userId: this.e?.user_id,
        items: t.enable
          ? [
              { label: "状态", value: "已开启" },
              { label: "间隔下限", value: `${Math.round(t.delay_ms_min / 1000)}` },
              { label: "间隔上限", value: `${Math.round(t.delay_ms_max / 1000)}` },
            ]
          : [{ label: "状态", value: "已关闭" }],
      }, { saveId: `lotus-throttle-${this.e?.user_id || "master"}-${Date.now()}` })
      await replyImage(this, image, "[荷花插件]自动签到错峰状态。")
      return true
    }

    if (/^(开|on|enable|开启)$/i.test(tokens[0])) {
      await applyThrottle(this, { enable: true })
      return true
    }
    if (/^(关|off|disable|关闭)$/i.test(tokens[0])) {
      await applyThrottle(this, { enable: false })
      return true
    }

    const nums = tokens.map(Number).filter(n => Number.isFinite(n) && n >= 0)
    if (nums.length === 1) {
      const ms = Math.round(nums[0] * 1000)
      await applyThrottle(this, { delay_ms_min: ms, delay_ms_max: ms, enable: true })
      return true
    }
    if (nums.length >= 2) {
      const min = Math.round(nums[0] * 1000)
      const max = Math.round(nums[1] * 1000)
      await applyThrottle(this, { delay_ms_min: min, delay_ms_max: Math.max(min, max), enable: true })
      return true
    }

    await replyText(this, "[荷花插件]参数无法识别。用法：#签到错峰 [开|关|<秒>|<最小秒> <最大秒>]")
    return true
  }
}

async function applyThrottle(e, patch) {
  const config = await loadGlobalConfig()
  config.scheduler ||= {}
  config.scheduler.throttle ||= { ...DEFAULT_THROTTLE }
  Object.assign(config.scheduler.throttle, patch)
  // 归一化：确保 min <= max，避免配置写反导致延迟不生效
  if (config.scheduler.throttle.delay_ms_min > config.scheduler.throttle.delay_ms_max) {
    const tmp = config.scheduler.throttle.delay_ms_max
    config.scheduler.throttle.delay_ms_max = config.scheduler.throttle.delay_ms_min
    config.scheduler.throttle.delay_ms_min = tmp
  }
  await saveGlobalConfig(config)
  const t = config.scheduler.throttle
  const status = t.enable ? "已开启" : "已关闭"
  const range = t.enable
    ? `每个签到之间随机等待 ${Math.round(t.delay_ms_min / 1000)}~${Math.round(t.delay_ms_max / 1000)} 秒`
    : "（关闭）"
  const image = await renderStatusCard({
    title: "自动签到错峰已更新",
    subtitle: "配置已写入 config/global.yaml（scheduler.throttle）",
    badge: status,
    message: `${range}。修改即时生效，无需重启；自动调度与 #全员二次签到 均按此间隔错峰。`,
    userId: e?.e?.user_id,
    items: t.enable
      ? [
          { label: "间隔下限", value: `${Math.round(t.delay_ms_min / 1000)}` },
          { label: "间隔上限", value: `${Math.round(t.delay_ms_max / 1000)}` },
        ]
      : [{ label: "状态", value: "已关闭" }],
  }, { saveId: `lotus-throttle-set-${e?.e?.user_id || "master"}-${Date.now()}` })
  await replyImage(e, image, "[荷花插件]自动签到错峰已更新。")
}

export { readThrottle }
