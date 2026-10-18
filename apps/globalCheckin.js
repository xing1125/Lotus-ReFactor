/**
 * 全局签到控制命令 — 管理员强制开关所有用户的签到行为
 *
 * 用法：
 *   #全局开启签到         — 解除整体签到达锁（所有人可签到）
 *   #全局关闭签到         — 强制所有人停止签到
 *   #全局开启游戏签到 原神  — 解除指定游戏的强制关闭
 *   #全局关闭游戏签到 原神  — 强制关闭指定游戏的签到（无视个人设置）
 *   #全局开启社区签到     — 解除社区签到的强制关闭
 *   #全局关闭社区签到     — 强制关闭所有人的社区签到
 *   #全局签到状态         — 查看当前全局控制状态
 *
 * 支持的游戏名：原神 / 星铁 / 崩铁 / 绝区零
 */

import { loadGlobalConfig, saveGlobalConfig } from "../core/config/global.js"

const GAME_KEY_MAP = {
  原神: "genshin",
  星铁: "honkai_sr",
  崩铁: "honkai_sr",
  绝区零: "zzz",
  绝: "zzz",
}

const KEY_LABEL = {
  checkin_all: "整体签到",
  genshin: "原神签到",
  honkai_sr: "星铁签到",
  zzz: "绝区零签到",
  mihoyobbs: "社区签到",
}

export class GlobalCheckinControl extends plugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Global Checkin Control",
      dsc: "全局签到控制（管理员）",
      event: "message",
      priority: 10,
      rule: [
        {
          reg: /^#全局开启签到$/,
          fnc: "enableAll",
          permission: "master",
        },
        {
          reg: /^#全局关闭签到$/,
          fnc: "disableAll",
          permission: "master",
        },
        {
          reg: /^#全局开启游戏签到\s+(原神|星铁|崩铁|绝区零|绝)$/,
          fnc: "enableGame",
          permission: "master",
        },
        {
          reg: /^#全局关闭游戏签到\s+(原神|星铁|崩铁|绝区零|绝)$/,
          fnc: "disableGame",
          permission: "master",
        },
        {
          reg: /^#全局开启社区签到$/,
          fnc: "enableBbs",
          permission: "master",
        },
        {
          reg: /^#全局关闭社区签到$/,
          fnc: "disableBbs",
          permission: "master",
        },
        {
          reg: /^#全局静默通知$/,
          fnc: "silenceNotify",
          permission: "master",
        },
        {
          reg: /^#全局静默$/,
          fnc: "silenceNotify",
          permission: "master",
        },
        {
          reg: /^#全局开启通知$/,
          fnc: "enableNotify",
          permission: "master",
        },
        {
          reg: /^#全局通知$/,
          fnc: "enableNotify",
          permission: "master",
        },
        {
          reg: /^#全局纯文字$/,
          fnc: "silentImage",
          permission: "master",
        },
        {
          reg: /^#全局图文$/,
          fnc: "enableImage",
          permission: "master",
        },
        {
          reg: /^#设置主人\s+(\S+)$/,
          fnc: "setMaster",
          permission: "master",
        },
        {
          reg: /^#全局签到状态$/,
          fnc: "showStatus",
          permission: "master",
        },
      ],
    })
  }

  async enableAll(e) {
    await setForcedDisable("checkin_all", false)
    await e.reply("已解除全局签到达锁，所有人可正常签到。", true)
    return true
  }

  async disableAll(e) {
    await setForcedDisable("checkin_all", true)
    await e.reply("已全局关闭签到，所有人的签到将被跳过（无视个人设置）。", true)
    return true
  }

  async enableGame(e) {
    const match = e.msg.match(/^#全局开启游戏签到\s+(原神|星铁|崩铁|绝区零|绝)$/)
    const key = GAME_KEY_MAP[match[1]]
    await setForcedDisable(key, false)
    await e.reply(`已解除${KEY_LABEL[key]}的全局关闭，按个人设置执行。`, true)
    return true
  }

  async disableGame(e) {
    const match = e.msg.match(/^#全局关闭游戏签到\s+(原神|星铁|崩铁|绝区零|绝)$/)
    const key = GAME_KEY_MAP[match[1]]
    await setForcedDisable(key, true)
    await e.reply(`已全局关闭${KEY_LABEL[key]}，所有人的${KEY_LABEL[key]}将被跳过（无视个人设置）。`, true)
    return true
  }

  async enableBbs(e) {
    await setForcedDisable("mihoyobbs", false)
    await e.reply("已解除社区签到的全局关闭，按个人设置执行。", true)
    return true
  }

  async disableBbs(e) {
    await setForcedDisable("mihoyobbs", true)
    await e.reply("已全局关闭社区签到，所有人的社区签到将被跳过（无视个人设置）。", true)
    return true
  }

  // 主开关②：全局静默通知 —— 抑制"每人签到结果"通知（不影响主人专属汇总看板）
  async silenceNotify(e) {
    await setSchedulerFlag("notify_enabled", false)
    await e.reply("已开启全局静默：所有用户的签到结果通知将被抑制（不发送）。\n注：BOT主人专属汇总看板不受影响，仍会在每日全部签到完成后私聊发给你。", true)
    return true
  }

  async enableNotify(e) {
    await setSchedulerFlag("notify_enabled", true)
    await e.reply("已恢复通知：每人签到后会收到各自的签到结果。", true)
    return true
  }

  // 主开关③：纯文字模式 —— 签到结果只发文字、不发图（主人汇总看板也只发文字）
  async silentImage(e) {
    await setSchedulerFlag("notify_image", false)
    await e.reply("已开启纯文字模式：签到结果只发文字、不发图（主人汇总看板也只发文字）。", true)
    return true
  }

  async enableImage(e) {
    await setSchedulerFlag("notify_image", true)
    await e.reply("已恢复图文模式：签到结果将带图发送。", true)
    return true
  }

  // 绑定 BOT主人账号（wxid 或 QQ号），供每日汇总看板自动私聊推送
  async setMaster(e) {
    const match = e.msg.match(/^#设置主人\s+(\S+)$/)
    const wxid = String(match?.[1] || "").trim()
    if (!wxid) {
      await e.reply("用法：#设置主人 [wxid 或 QQ号]，例如 #设置主人 wxid_abc123", true)
      return true
    }
    const config = await loadGlobalConfig()
    config.master = config.master || {}
    config.master.wxid = wxid
    await saveGlobalConfig(config)
    await e.reply(`已将 BOT主人账号绑定为 ${wxid}。每日全部签到完成后，汇总看板会私聊发到该账号。`, true)
    return true
  }

  async showStatus(e) {
    const config = await loadGlobalConfig()
    const fd = config.scheduler?.forced_disables || {}
    const sched = config.scheduler || {}
    const notifyEnabled = sched.notify_enabled !== false
    const notifyImage = sched.notify_image !== false
    const masterWxid = config.master?.wxid

    const lines = ["当前全局签到控制状态："]
    for (const [key, label] of Object.entries(KEY_LABEL)) {
      const disabled = fd[key] === true
      lines.push(`  ${label}：${disabled ? "🔴 强制关闭" : "🟢 正常（按个人设置）"}`)
    }
    lines.push("")
    lines.push(`  通知（每人结果）：${notifyEnabled ? "🟢 开启" : "🔴 静默（不发每人结果）"}`)
    lines.push(`  图文模式：${notifyImage ? "🟢 图文" : "🟡 纯文字（不发图）"}`)
    lines.push(`  BOT主人：${masterWxid ? masterWxid : "（未绑定，运行 #签到看板 或 #设置主人 绑定）"}`)

    await e.reply(lines.join("\n"), true)
    return true
  }
}

async function setForcedDisable(key, value) {
  const config = await loadGlobalConfig()
  config.scheduler = config.scheduler || {}
  config.scheduler.forced_disables = config.scheduler.forced_disables || {}
  config.scheduler.forced_disables[key] = value
  await saveGlobalConfig(config)
}

// 设置 scheduler 下的通知类主开关（notify_enabled / notify_image）。
async function setSchedulerFlag(key, value) {
  const config = await loadGlobalConfig()
  config.scheduler = config.scheduler || {}
  config.scheduler[key] = value
  await saveGlobalConfig(config)
}
