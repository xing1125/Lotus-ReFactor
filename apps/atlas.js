const BasePlugin = globalThis.plugin

import { resolvePriority } from "../core/intercept/priority.js"
import { renderStatusCard, renderTemplate, renderAtlasBook } from "../core/render/service.js"
import { replyImage, replyText, replyForward } from "../core/transport/reply.js"
import { loadGlobalConfig } from "../core/config/global.js"
import { PermissionService } from "../core/permissions/service.js"
import {
  buildAtlasRenderData,
  buildAtlasShortcutRules,
  NanokaAtlasService,
  parseAtlasShortcutMessage,
  resetAtlasAliasCache,
  resolveAtlasAliasName,
  resolveSignatureWeapon,
  selectAtlasTemplate,
} from "../services/nanokaAtlas/service.js"
import { AtlasUpdateService, readLocalVersionSnapshot } from "../services/nanokaAtlas/update.js"
import { submitAtlasUpdate } from "../services/nanokaAtlas/updateTask.js"
import { notifyUser } from "../core/transport/notify.js"
import { findGuideCard, guideCardStats } from "../services/nanokaAtlas/guide-cards.js"
import {
  getAtlasBlacklistStatus,
  isAtlasBlacklisted,
} from "../services/nanokaAtlas/blacklist.js"
import { formatDelta, formatNumber } from "../services/nanokaAtlas/stats.js"

// view.kind → 图鉴三模块（成品卡目录）
const GUIDE_KIND_BY_VIEW = { character: "character", weapon: "weapon", relic: "artifact" }
const GUIDE_KIND_LABEL = { character: "角色攻略", weapon: "武器图鉴", relic: "圣遗物图鉴" }

// 查图鉴插件的成品卡；命中返回可直接发送的图片段，否则 null（由调用方回退渲染）
function findPresetGuideCard(data) {
  const kind = GUIDE_KIND_BY_VIEW[data.view?.kind]
  if (!kind) return null
  const title = data.view?.title || data.title
  const file = findGuideCard(kind, title)?.file
  if (!file) return null
  // 与 core/render 其它渲染器保持一致：优先包装成图片段，无 segment 时退回本地路径
  return globalThis.segment?.image ? globalThis.segment.image(`file://${file}`) : `file://${file}`
}

/**
 * 用户黑名单守卫：命中时返回 false，Yunzai loader 会继续把消息交给后续插件。
 * 注意不能用 accept() 返回 "return" —— 那会掐断所有插件，不是放行。
 * 任何读取 / 解析异常都 fail-open，绝不因为黑名单本身卡住消息。
 */
async function atlasBlacklistHit(e) {
  return isAtlasBlacklisted(e)
}

export class LotusAtlas extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Atlas",
      dsc: "Lotus nanoka atlas query",
      event: "message",
      priority: resolvePriority("atlas"),
      rule: getSharedAtlasRules(),
    })
    this.shortcutRouteStats = { ...sharedRouteStats }
    this.task = [
      ...this.buildAtlasTasks(),
    ]
  }

  async init() {
    try {
      const globalConfig = await loadGlobalConfig()
      await this.refreshShortcutRoutes()
      this.task = this.buildAtlasTasks(globalConfig)
      void this.runAtlasChallengeAutoUpdate({ startup: true }).catch(() => {})
    } catch (error) {
      logger?.warn?.(`[Lotus-Plugin] load atlas cron failed, fallback default: ${error.message}`)
    }
  }

  buildAtlasTasks(globalConfig = {}) {
    return [
      {
        name: "荷花插件图鉴版本检查",
        cron: globalConfig.atlas?.auto_update?.check_cron || "0 0 */6 * * ? *",
        fnc: this.runAtlasAutoUpdate.bind(this),
        log: false,
      },
      {
        name: "荷花插件图鉴快捷路由刷新",
        cron: "0 0 0 * * ? *",
        fnc: this.refreshShortcutRoutes.bind(this),
        log: false,
      },
      {
        name: "荷花插件图鉴挑战刷新",
        cron: globalConfig.atlas?.auto_update?.challenge_cron || "0 15 */2 * * ? *",
        fnc: this.runAtlasChallengeAutoUpdate.bind(this),
        log: false,
      },
    ]
  }

  async refreshShortcutRoutes(options = {}) {
    // 别名源（xiaoyao Atlas_alias/*.yaml 等）可能已变动，先让别名缓存失效，
    // 使本次路由刷新重建时重新读取最新别名，实现热重载（无需重启 bot）。
    resetAtlasAliasCache()
    const result = await buildAtlasShortcutRules(options)
    // 原地替换共享数组：priority 实例 / init 实例 / 每条消息新建实例同时生效
    this.rule = replaceSharedAtlasRules(result.rules || [], result.stats || { rules: 0 })
    this.shortcutRouteStats = { ...sharedRouteStats }
    globalThis.logger?.mark?.(`[Lotus-Plugin] atlas shortcut routes refreshed: ${this.shortcutRouteStats.rules || 0} rule(s), ${this.shortcutRouteStats.directNames || 0} direct name(s), ${this.shortcutRouteStats.roleNames || 0} role name(s)`)
    return result
  }

  async status() {
    const status = await new NanokaAtlasService().status()
    const cards = guideCardStats()
    const blacklist = await getAtlasBlacklistStatus()
    const cardText = [
      `角色 ${cards.character?.count || 0}`,
      `武器 ${cards.weapon?.count || 0}`,
      `圣遗物 ${cards.artifact?.count || 0}`,
    ].join(" / ")
    const image = await renderStatusCard({
      title: "图鉴状态",
      subtitle: status.root,
      badge: status.itemsReady ? "READY" : "MISSING",
      message: status.itemsReady
        ? `已找到 ${status.locale} 图鉴条目。`
        : "图鉴数据未初始化，请准备 nanoka-atlas-backend 输出目录。",
      userId: this.e?.user_id || "user",
      items: [
        { label: "Items", value: status.itemsReady ? `${status.itemCount} 个 JSON` : "缺失" },
        { label: "Modules", value: status.itemsReady ? `${status.moduleCount} 个模块` : "缺失" },
        { label: "Gallery", value: status.galleryReady ? "已找到" : "缺失" },
        { label: "Locale", value: status.locale },
        { label: "成品卡", value: cardText },
        { label: "卡面来源", value: Object.values(cards).some(c => c.source === "local") ? "Lotus 本地" : "借 Atlas 源" },
        { label: "黑名单", value: blacklist.exists ? `${blacklist.count} 条生效 / ${blacklist.invalid.length} 条无效` : "未配置" },
      ],
    }, {
      saveId: `lotus-atlas-status-${this.e.user_id || "user"}`,
    })
    await replyImage(this, image, "[荷花插件]图鉴状态生成完成。")
    return true
  }

  async updateAtlas() {
    const permission = await this.assertUpdatePermission("图鉴更新")
    if (!permission) return true

    const globalConfig = await loadGlobalConfig()
    return submitAtlasTaskInteractive(this, {
      config: globalConfig.atlas || {},
      mode: "check",
      label: "图鉴更新",
      startText: "[荷花插件]正在检查图鉴版本；首次缺数据会全量拉取，后续版本变化才增量更新。",
    })
  }

  async checkAtlasUpdate() {
    const permission = await this.assertUpdatePermission("图鉴版本检查")
    if (!permission) return true

    const globalConfig = await loadGlobalConfig()
    return submitAtlasTaskInteractive(this, {
      config: globalConfig.atlas || {},
      mode: "check",
      label: "图鉴版本检查",
      startText: "[荷花插件]正在检查图鉴版本差异。",
    })
  }

  async fullUpdateAtlas() {
    const permission = await this.assertUpdatePermission("图鉴全量更新")
    if (!permission) return true

    const globalConfig = await loadGlobalConfig()
    return submitAtlasTaskInteractive(this, {
      config: globalConfig.atlas || {},
      mode: "initial",
      label: "图鉴全量更新",
      startText: "[荷花插件]正在启动 nanoka-atlas-backend 全量抓取，首次初始化会比较久。",
    })
  }

  async resetAtlas() {
    const permission = await this.assertUpdatePermission("图鉴重置")
    if (!permission) return true

    const globalConfig = await loadGlobalConfig()
    const result = await new AtlasUpdateService().reset(globalConfig.atlas || {})
    await this.refreshShortcutRoutes()
    const image = await renderStatusCard({
      title: "图鉴重置",
      subtitle: "Nanoka Atlas",
      badge: result.ok ? "DONE" : "STOP",
      message: result.message || "图鉴缓存清理失败。",
      userId: this.e.user_id,
      items: [
        { label: "目录", value: result.root || "未知" },
        { label: "后续", value: "执行 #全量更新图鉴 重新初始化" },
      ],
    }, {
      saveId: "lotus-atlas-reset-" + (this.e.user_id || "master"),
    })
    await replyImage(this, image, result.ok ? "[荷花插件]图鉴缓存已重置。" : "[荷花插件]图鉴重置失败。")
    return true
  }

  async assertUpdatePermission(title) {
    const globalConfig = await loadGlobalConfig()
    const permission = new PermissionService({ permissions: globalConfig.permissions })
      .explain(this.e, "atlas.update")
    if (!permission.ok) {
      const image = await renderStatusCard({
        title: "图鉴更新",
        subtitle: "Nanoka Atlas",
        badge: "拒绝",
        message: `只有 bot 主人可以触发${title}。`,
        userId: this.e.user_id,
        items: [
          { label: "原因", value: permission.reason },
        ],
      }, {
        saveId: `lotus-atlas-update-deny-${this.e.user_id || "user"}`,
      })
      await replyImage(this, image, "[荷花插件]没有图鉴更新权限。")
      return false
    }
    return true
  }

  async runAtlasAutoUpdate() {
    const globalConfig = await loadGlobalConfig()
    if (globalConfig.atlas?.auto_update?.enable === false) {
      return { ok: true, skipped: true, reason: "auto_update_disabled" }
    }
    return submitAtlasTaskScheduled(this, {
      config: globalConfig.atlas || {},
      mode: "check",
      label: "定时版本检查",
    })
  }

  async runAtlasChallengeAutoUpdate({ startup = false } = {}) {
    const globalConfig = await loadGlobalConfig()
    const config = globalConfig.atlas || {}
    if (config.auto_update?.enable === false) {
      return { ok: true, skipped: true, reason: "auto_update_disabled" }
    }
    const local = await readLocalVersionSnapshot(config)
    if (!local.ready) {
      return { ok: true, skipped: true, reason: "base_atlas_missing" }
    }
    return submitAtlasTaskScheduled(this, {
      config,
      mode: "challenge",
      label: "挑战刷新",
      startup,
    })
  }

  async refreshRoutesAfterAtlasUpdate(result) {
    if (!result?.ok || result.skipped) return
    await this.refreshShortcutRoutes().catch(error => {
      globalThis.logger?.warn?.(`[Lotus-Plugin] refresh atlas shortcut routes after update failed: ${error.message}`)
    })
  }

  async query() {
    const query = String(this.e.msg || "").replace(/^#?(Lotus|lotus|荷花)?图鉴/i, "").trim()
    if (!query) {
      await replyText(this, "[荷花插件]请在图鉴后面输入要查询的名称。")
      return true
    }

    const result = await new NanokaAtlasService().search(query)
    await sendAtlasSearchResult(this, result)
    return true
  }

  // #角色名专武 → 别名表解析专武 → 成品卡直发；找不到武器卡时回退通用查询
  async weaponByChar() {
    const raw = String(this.e.msg || "").replace(/^[#＃]/, "").replace(/专武$/u, "").trim()
    if (!raw) return false
    // 排除常见误触（攻略/统计类长句）
    if (/攻略|练度|统计|面板/.test(raw)) return false
    // 群聊裸文本（无 #）需指向荧，避免闲聊「我的专武」误触
    const isExplicit = /^[#＃]/.test(String(this.e.msg || ""))
    if (!isExplicit && this.e.isGroup) {
      const text = String(this.e.msg || "")
      const atSelf = Array.isArray(this.e.message) && this.e.message.some(
        s => s && s.type === "at" && String(s.qq || s.user_id || "") === String(this.e.self_id || "")
      )
      if (!/荧|Ying/i.test(text) && !atSelf) return false
    }
    const candidates = []
    const sig = await resolveSignatureWeapon(raw).catch(() => null)
    if (sig) candidates.push(sig)
    candidates.push(raw) // 回退：输入本身可能是武器名/别名（如 蝶变专武→蝶变）
    for (const name of candidates) {
      const card = findGuideCard("weapon", name)
      if (!card?.file) continue
      const seg = globalThis.segment?.image ? globalThis.segment.image(`file://${card.file}`) : `file://${card.file}`
      await replyImage(this, seg, "")
      return true
    }
    return false
  }

  // #xx套 / #xx套装 → 别名表解析圣遗物套装 → 成品卡直发，无卡走 nanoka 渲染，查无此名放行
  async artifactBySet() {
    const msg = String(this.e.msg || "")
    const isExplicit = /^[#＃]/.test(msg)
    const raw = msg.replace(/^[#＃]/, "").replace(/(?:套装|套)$/u, "").trim()
    if (!raw) return false
    // 群聊裸文本（无 #）需指向荧，防闲聊「一套」「三件套」误触
    if (!isExplicit && this.e.isGroup) {
      const atSelf = Array.isArray(this.e.message) && this.e.message.some(
        s => s && s.type === "at" && String(s.qq || s.user_id || "") === String(this.e.self_id || "")
      )
      if (!/荧|Ying/i.test(msg) && !atSelf) return false
    }
    // 候选名：本名 + 别名解析出的标准名
    const names = [raw]
    const alias = await resolveAtlasAliasName(raw).catch(() => null)
    if (alias?.value) names.unshift(alias.value)
    // ① 成品卡直发
    for (const name of names) {
      const card = findGuideCard("artifact", name)
      if (!card?.file) continue
      const seg = globalThis.segment?.image ? globalThis.segment.image(`file://${card.file}`) : `file://${card.file}`
      await replyImage(this, seg, `${name} · 圣遗物图鉴`)
      return true
    }
    // ② nanoka 数据渲染兜底（血红之证等新套装在数据里但无成品卡）
    for (const name of names) {
      const result = await new NanokaAtlasService().search(name, {
        game: "原神", pages: ["artifact"], minScore: 100, strict: true,
      }).catch(() => null)
      if (!result?.ok) continue
      const image = await renderAtlasSearchResult(result, this.e.user_id)
      await replyImage(this, image, "[荷花插件]圣遗物图鉴查询完成。")
      return true
    }
    return false
  }

  async shortcutQuery() {
    const parsed = parseAtlasShortcutMessage(this.e.msg)
    if (!parsed.ok) return false

    let result
    try {
      result = await new NanokaAtlasService().search(parsed.query, {
        challenge: parsed.challenge,
        game: parsed.game,
        pages: parsed.pages,
        minScore: parsed.challenge ? undefined : 100,
        strict: !parsed.challenge,
      })
      if (!result.ok) {
        // 成品卡兜底：nanoka 数据缺失但本地三模块有成品图时直发（圣遗物/角色/武器都查一遍）
        for (const kind of ["character", "weapon", "artifact"]) {
          const card = findGuideCard(kind, parsed.query)
          if (!card?.file) continue
          const seg = globalThis.segment?.image ? globalThis.segment.image(`file://${card.file}`) : `file://${card.file}`
          await replyImage(this, seg, `${parsed.query} · 图鉴`)
          return true
        }
        if (shouldPassThroughShortcutFailure(parsed, result)) return false
        const image = await renderAtlasSearchResult(result, this.e.user_id)
        await replyImage(this, image, atlasFailureReply(result))
        return true
      }
    } catch (error) {
      logger?.warn?.(`[Lotus-Plugin] atlas shortcut failed: ${error.stack || error.message}`)
      const image = await renderStatusCard({
        title: "图鉴查询",
        subtitle: parsed.query,
        badge: "失败",
        message: `图鉴查询失败：${error.message || error}`,
        userId: this.e.user_id,
        items: [
          { label: "类型", value: parsed.challenge ? parsed.challenge.label : "图鉴" },
          { label: "查询", value: parsed.query },
          { label: "处理", value: "已由荷花插件拦截，未继续交给后续插件。" },
        ],
      }, {
        saveId: `lotus-atlas-shortcut-error-${this.e.user_id || "user"}`,
      })
      await replyImage(this, image, "[荷花插件]图鉴查询失败。")
      return true
    }

    await sendAtlasSearchResult(this, result)
    return true
  }

  async help() {
    const image = await renderStatusCard({
      title: "图鉴帮助",
      subtitle: "Nanoka Atlas",
      badge: "HELP",
      message: "图鉴数据由本地 nanoka-atlas-backend 输出目录提供，荷花插件只负责更新、索引、查询和图片渲染；挑战个人数据指令不会被图鉴直查抢占。",
      userId: this.e?.user_id || "user",
      items: [
        { label: "直查", value: "#星见雅 / #雾切之回光 / #雾切 / #冰封迷途的勇士" },
        { label: "显式", value: "#图鉴 神里绫华 / #荷花图鉴 星见雅" },
        { label: "挑战图鉴", value: "#本期幽境图鉴 / #本期幻想图鉴 / *上期末日图鉴 / %下期防卫战图鉴" },
        { label: "不抢占", value: "#深渊 / #幻想 / #幽境 / *混沌 / %防卫战 仍交给挑战数据插件" },
        { label: "状态", value: "#图鉴状态" },
        { label: "避让", value: "#图鉴黑名单 / config/atlas-blacklist.yaml" },
        { label: "更新", value: "#更新图鉴" },
        { label: "全量", value: "#全量更新图鉴" },
        { label: "重置", value: "#重置图鉴（只清插件缓存）" },
        { label: "数据目录", value: "global.yaml: atlas.data_root" },
        { label: "后端目录", value: "global.yaml: atlas.backend_root" },
      ],
    }, {
      saveId: `lotus-atlas-help-${this.e.user_id || "user"}`,
    })
    await replyImage(this, image, "[荷花插件]图鉴帮助生成完成。")
    return true
  }

  // 用户黑名单诊断：查看当前生效规则 / 无效规则，验证 yaml 热重载是否已生效
  async blacklistStatus() {
    const info = await getAtlasBlacklistStatus()
    const preview = info.patterns.slice(0, 8).map((item, index) =>
      `${index + 1}. ${item.source}${item.flags ? ` [${item.flags}]` : ""}`,
    )
    const image = await renderStatusCard({
      title: "图鉴黑名单",
      subtitle: info.file,
      badge: info.exists ? (info.enabled && info.count ? "ON" : "OFF") : "MISSING",
      message: info.exists
        ? "命中完整消息的正则时，图鉴不接管、不回复，直接放行给其它插件；保存 yaml 后约 0.5 秒自动生效，无需重启。"
        : "尚未创建黑名单文件；把 config/atlas-blacklist.yaml.example 复制为 atlas-blacklist.yaml 即可启用。",
      userId: this.e?.user_id || "user",
      items: [
        { label: "状态", value: info.exists ? (info.enabled ? "已启用" : "已停用") : "未配置" },
        { label: "生效规则", value: `${info.count} 条` },
        { label: "无效规则", value: `${info.invalid.length} 条` },
        { label: "解析错误", value: info.error || "无" },
        { label: "规则预览", value: preview.length ? preview.join("\n") : "（空）" },
      ],
    }, {
      saveId: `lotus-atlas-blacklist-${this.e?.user_id || "user"}`,
    })
    await replyImage(this, image, "[荷花插件]图鉴黑名单状态生成完成。")
    return true
  }
}

/**
 * 给每条 rule 套一层「用户黑名单」守卫。
 *
 * 为什么改 fnc 而不是逐方法加判断：Yunzai loader 用的是
 *   i.plugin.rule（加载期实例） + new i.class(e)[v.fnc]（每条消息新建实例）
 * 两个不同实例，所以守卫方法必须挂在 prototype 上才能对所有实例生效；
 * 同时本插件还有 gatePluginModules / silencePluginLogs 两层包装子类，
 * 保持原 fnc 名不变、只在外层加一道 fnc，模块开关与日志抑制行为都不会变。
 *
 * 守卫命中 → 返回 false：loader 的 `if (res === false) continue` 会继续匹配
 * 本插件后续 rule，最终交给后面的插件；不回复、不渲染、不吞消息。
 */
/**
 * 修「启动刷新的快捷路由没落到消息处理实例」的既有 BUG。
 *
 * Yunzai 的 loadPlugin() 在第一个实例上 await init()，随后 new 第二个实例塞进 priority；
 * deal() 用的是 i.plugin.rule（第二个实例）。以前 init() 里刷出来的 221 条快捷路由
 * 只留在被丢弃的第一个实例上，消息侧永远只有 20 条基础规则。
 *
 * 修法：所有实例共用同一份 rule 数组引用。构造器取共享数组；刷新时原地 splice，
 * 于是任何实例（含 loader.priority 里那个）都立刻看到最新规则，无需访问 loader 单例。
 * 运行期替换的条目必须：
 *   ① reg 已是 RegExp —— loader 只在加载期做字符串→RegExp 转换，之后直接 v.reg.test()；
 *   ② 复刻 silencePluginLogs 的 log / __lotusExplicitRule 约定，避免日志与模块开关语义漂移。
 * 第二个实例在 init() 之后才构造，因此也能直接读到 sharedShortcutRules。
 */
let sharedAtlasRules = null
let sharedShortcutRules = []
let sharedRouteStats = { rules: 0 }

function makeAtlasRules(shortcutRules) {
  return guardAtlasRules(composeAtlasRules(shortcutRules)).map(rule => ({
    ...rule,
    reg: rule.reg instanceof RegExp ? rule.reg : new RegExp(rule.reg),
    __lotusExplicitRule: rule.__lotusExplicitRule ?? (rule.log !== false),
    log: false,
  }))
}

function getSharedAtlasRules() {
  if (!sharedAtlasRules) sharedAtlasRules = makeAtlasRules(sharedShortcutRules)
  return sharedAtlasRules
}

function replaceSharedAtlasRules(shortcutRules, stats) {
  sharedShortcutRules = shortcutRules || []
  sharedRouteStats = stats || { rules: 0 }
  const next = makeAtlasRules(sharedShortcutRules)
  const current = getSharedAtlasRules()
  current.splice(0, current.length, ...next)
  return current
}

const GUARD_PREFIX = "__atlasGuarded_"

function guardAtlasRules(rules = []) {
  return rules.map(rule => {
    if (!rule?.fnc) return rule
    const original = String(rule.fnc).startsWith(GUARD_PREFIX)
      ? String(rule.fnc).slice(GUARD_PREFIX.length)
      : String(rule.fnc)
    const name = `${GUARD_PREFIX}${original}`
    if (typeof LotusAtlas.prototype[name] !== "function") {
      Object.defineProperty(LotusAtlas.prototype, name, {
        configurable: true,
        writable: true,
        value: async function atlasGuardedEntry(e) {
          if (await atlasBlacklistHit(e)) return false
          return this[original]?.(e)
        },
      })
    }
    return { ...rule, fnc: name }
  })
}

function composeAtlasRules(shortcutRules = []) {
  return [
    {
      reg: "^#?(Lotus|lotus|荷花)?图鉴状态$",
      fnc: "status",
    },
    {
      reg: "^#?(Lotus|lotus|荷花)?(更新图鉴|图鉴更新)$",
      fnc: "updateAtlas",
    },
    {
      reg: "^#?(Lotus|lotus|荷花)?(检查图鉴更新|图鉴检查更新)$",
      fnc: "checkAtlasUpdate",
    },
    {
      reg: "^#?(Lotus|lotus|荷花)?(全量更新图鉴|图鉴全量更新)$",
      fnc: "fullUpdateAtlas",
    },
    {
      reg: "^#?(Lotus|lotus|荷花)?(重置图鉴|图鉴重置|清空图鉴)$",
      fnc: "resetAtlas",
    },
    {
      reg: "^#?(Lotus|lotus|荷花)?图鉴帮助$",
      fnc: "help",
    },
    {
      reg: "^#?(Lotus|lotus|荷花)?图鉴黑名单$",
      fnc: "blacklistStatus",
    },
    {
      reg: "^#?(Lotus|lotus|荷花)?图鉴\\s*[\\s\\S]+$",
      fnc: "query",
    },
    {
      reg: "^(?![#*%％][\\s\\S]*(?:攻略|练度统计)[\\s\\S]*$)[#*%％][\\s\\S]{1,}图鉴$",
      fnc: "shortcutQuery",
    },
    {
      reg: "^(?!#[\\s\\S]*(?:攻略|练度统计)[\\s\\S]*$)#(?:星铁|星穹铁道|崩坏星穹铁道|崩铁|绝区零|绝区|原神)?[\\s\\S]{1,}图鉴$",
      fnc: "shortcutQuery",
    },
    {
      reg: "^#?(.+?)专武$",
      fnc: "weaponByChar",
    },
    {
      // #血红套 / #深廊套 / #冰风套 → 别名表解析套装 → 成品卡 / nanoka 渲染兜底
      reg: "^#?(.+?)(?:套装|套)$",
      fnc: "artifactBySet",
    },
    {
      reg: "^(?!#(?:今日|今天|每日|我的|明天|明日|周(?:[1-7]|一|二|三|四|五|六|日))*(?:素材|材料|天赋)[ |0-9]*(?:图鉴)?$)[#*%％][\\s\\S]{1,}(?:命座|星魂|影画|天赋)(?:图鉴)?$",
      fnc: "shortcutQuery",
    },
    {
      reg: "^(?!#(?:今日|今天|每日|我的|明天|明日|周(?:[1-7]|一|二|三|四|五|六|日))*(?:素材|材料|天赋)[ |0-9]*(?:图鉴)?$)#(?:星铁|星穹铁道|崩坏星穹铁道|崩铁|绝区零|绝区|原神)?[\\s\\S]{1,}(?:命座|星魂|影画|天赋)(?:图鉴)?$",
      fnc: "shortcutQuery",
    },
    {
      reg: "^#(?:\\d{4}[./年-]\\d{1,2}[./月-]\\d{1,2}日?)?(?:上期|本期|当期|下期)(?:深渊|深境螺旋|幻想|幻想真境剧诗|剧诗|幽境|危战|幽境危战)$",
      fnc: "shortcutQuery",
    },
    {
      reg: "^\\*(?:\\d{4}[./年-]\\d{1,2}[./月-]\\d{1,2}日?)?(?:上期|本期|当期|下期)(?:混沌|混沌回忆|忘却|忘却之庭|末日|末日幻影|虚构|虚构叙事|异相|异相仲裁)$",
      fnc: "shortcutQuery",
    },
    {
      reg: "^[%％](?:\\d{4}[./年-]\\d{1,2}[./月-]\\d{1,2}日?)?(?:上期|本期|当期|下期)(?:防卫|防卫战|式舆|式舆防卫|式舆防卫战|危局|危局强袭战|强袭|强袭战)$",
      fnc: "shortcutQuery",
    },
    {
      reg: "^#星铁(?:\\d{4}[./年-]\\d{1,2}[./月-]\\d{1,2}日?)?(?:上期|本期|当期|下期)(?:混沌|混沌回忆|忘却|忘却之庭|末日|末日幻影|虚构|虚构叙事|异相|异相仲裁)$",
      fnc: "shortcutQuery",
    },
    {
      reg: "^#绝区零(?:\\d{4}[./年-]\\d{1,2}[./月-]\\d{1,2}日?)?(?:上期|本期|当期|下期)(?:防卫|防卫战|式舆|式舆防卫|式舆防卫战|危局|危局强袭战|强袭|强袭战)$",
      fnc: "shortcutQuery",
    },
    {
      reg: "^[^#*%\\s][\\s\\S]{1,}(?:命座|星魂|影画|天赋)(?:图鉴)?$",
      fnc: "shortcutQuery",
      log: false,
    },
    ...shortcutRules,
  ]
}

async function renderAtlasSearchResult(result, userId) {
  const renderData = buildAtlasRenderData(result)
  return renderTemplate(selectAtlasTemplate(renderData), renderData, {
    saveId: `lotus-atlas-${userId || "user"}`,
  })
}

export async function sendAtlasSearchResult(target, result, options = {}) {
  const data = buildAtlasRenderData(result)
  // 优先直发图鉴插件的成品卡（角色攻略 / 武器图鉴 / 圣遗物图鉴三模块），
  // 视觉与原插件完全一致；只在没有成品图时才走 nanoka 数据渲染兜底。
  const preset = options.disablePresetCard ? null : findPresetGuideCard(data)
  if (preset) return replyImage(target, preset, `${data.title} · ${GUIDE_KIND_LABEL[data.view?.kind] || "图鉴"}`)
  if (selectAtlasTemplate(data) === "atlas-item" && data.view) {
    const images = await (options.renderBook || renderAtlasBook)(data, { saveId: `lotus-atlas-${target.e?.user_id || "user"}` })
    // Every character suffix produces the complete book, with one image per node.
    if (data.view.kind === "character" || images.length > 1) {
      const sections = [...new Set(images.map(image => image.section))]
      return replyForward(target, [`${data.title}完整图鉴\n${sections.join(" → ")}\n共 ${images.length} 页`, ...images.map(image => image.image)], { description: `${data.title} · ${data.view.kind === "character" ? "完整角色图鉴" : "图鉴资料"}` })
    }
    return replyImage(target, images[0]?.image, "[荷花插件]图鉴查询完成。")
  }
  return replyImage(target, await renderAtlasSearchResult(result, target.e?.user_id), result.ok ? "[荷花插件]图鉴查询完成。" : "[荷花插件]没有找到图鉴结果。")
}

/**
 * 手动指令入口：提交后台任务并立即回一条受理提示，完成后由 onDone 发结果图。
 * 全量抓取最长 30 分钟且会重建 data/，因此所有入口统一走 updateTask 的互斥队列。
 */
async function submitAtlasTaskInteractive(plugin, { config = {}, mode = "check", label = "图鉴更新", startText = "" } = {}) {
  const submission = submitAtlasUpdate({
    config,
    mode,
    label,
    onDone: async result => {
      await plugin.refreshRoutesAfterAtlasUpdate(result)
      const image = await renderAtlasUpdateResult(result, plugin.e?.user_id)
      await replyImage(plugin, image, atlasUpdateMessage(result))
    },
  })

  if (!submission.started) {
    const tip = submission.reason === "update_in_progress"
      ? "[荷花插件]已有图鉴更新任务在后台执行，请等待完成通知。"
      : `[荷花插件]图鉴更新刚执行过，请 ${Math.ceil((submission.retryAfterMs || 0) / 1000)} 秒后再试。`
    await replyText(plugin, tip)
    return true
  }

  const head = startText || "[荷花插件]已提交图鉴更新任务。"
  await replyText(plugin, `${head}\n[荷花插件]已转入后台执行（${submission.taskId}），完成后会发结果图，期间不影响其它指令。`)
  return true
}

/** 定时 / 启动入口：共用同一把锁，完成后刷新路由 + 写日志 + 私聊主人一条文本 */
function submitAtlasTaskScheduled(plugin, { config = {}, mode = "check", label = "定时更新", startup = false } = {}) {
  const submission = submitAtlasUpdate({
    config,
    mode,
    label,
    onDone: async result => {
      await plugin.refreshRoutesAfterAtlasUpdate(result)
      if (result.ok && !result.skipped) {
        globalThis.logger?.mark?.(`[Lotus-Plugin] atlas ${result.mode || mode} completed`)
        if (!startup) await notifyAtlasMasters(`[荷花插件]图鉴定时更新完成：${atlasUpdateMessage(result)}`)
      } else if (!result.ok) {
        globalThis.logger?.warn?.(`[Lotus-Plugin] atlas update failed: ${result.reason || result.message || "unknown"}`)
      }
    },
  })
  if (!submission.started) {
    return { ok: true, skipped: true, reason: submission.reason }
  }
  return { ok: true, started: true, taskId: submission.taskId }
}

/** 主人文本通知：微信下 master 可能是 botWxid:ownerWxid 映射，取冒号后的 owner */
async function notifyAtlasMasters(text) {
  const bot = globalThis.Bot
  const raw = bot?.config?.master || bot?.cfg?.master || []
  const values = Array.isArray(raw) ? raw : Object.values(raw)
  const owners = [...new Set(values.map(item => String(item).split(":").pop()).filter(Boolean))]
  for (const owner of owners) {
    try {
      await notifyUser(owner, text, { prefer: "private", onlyKnownFriend: true })
    } catch (error) {
      globalThis.logger?.debug?.(`[Lotus-Plugin] atlas notify skipped: ${error?.message || error}`)
    }
  }
}

/** 结果卡数据（纯函数，便于自检）：逐游戏旧→新版本 + 条目 / 图片增减 + 「无变化」结论 */
export function buildAtlasUpdateCardData(result) {
  const diff = result.stats?.diff?.available ? result.stats.diff : null
  const fallbackChanges = result.check?.diff?.changes || result.diff?.changes || []

  const versionText = diff
    ? (diff.versionChanges.length
      ? diff.versionChanges.map(item => `${item.game} ${item.from} → ${item.to}`).join("\n")
      : "无变化（逐游戏版本均未变）")
    : (fallbackChanges.length
      ? fallbackChanges.map(item => `${item.game}:${item.local?.latest || "-"} -> ${item.remote?.latest || "-"}`).join(" / ")
      : "无")
  const countText = pair => pair
    ? `${formatNumber(pair.from)} → ${formatNumber(pair.to)}（${formatDelta(pair.delta)}）`
    : "未统计"

  const items = [
    { label: "模式", value: result.skipped ? "skip" : result.mode || "-" },
    { label: "耗时", value: formatAtlasDuration(result.durationMs) },
  ]
  if (!result.skipped) {
    items.push(
      { label: "命令", value: `${result.command || "-"} ${(result.args || []).join(" ")}`.trim() },
      { label: "退出码", value: result.code ?? "-" },
    )
  }
  items.push(
    { label: "版本变化", value: versionText },
    { label: "条目", value: countText(diff?.itemFiles) },
    { label: "图片", value: countText(diff?.imageFiles) },
  )
  if (diff && diff.fetchedAt.from !== diff.fetchedAt.to) {
    items.push({ label: "抓取时间", value: `${shortAtlasTime(diff.fetchedAt.from)} → ${shortAtlasTime(diff.fetchedAt.to)}` })
  }
  items.push(
    { label: "变化结论", value: diff ? diff.summary : (result.skipped ? "已跳过，未改动数据" : "未统计") },
    {
      label: "同步",
      value: result.sync?.sameRoot
        ? "同目录，无需复制"
        : result.sync?.ok
          ? `${(result.sync.copied || []).join(" / ")} -> ${result.sync.targetRoot}`
          : "未执行",
    },
  )
  if (!result.skipped) {
    items.push({ label: "输出", value: (result.stdout || result.stderr || "").slice(0, 80) || "无" })
  }

  return {
    title: "图鉴更新",
    subtitle: result.root || "Nanoka Atlas",
    badge: result.skipped ? "跳过" : result.ok ? "完成" : "失败",
    message: atlasUpdateSummary(result),
    items,
  }
}

async function renderAtlasUpdateResult(result, userId) {
  return renderStatusCard({
    ...buildAtlasUpdateCardData(result),
    userId,
  }, {
    saveId: `lotus-atlas-update-${userId || "system"}`,
  })
}

function formatAtlasDuration(ms) {
  const value = Number(ms || 0)
  if (!Number.isFinite(value) || value <= 0) return "-"
  if (value < 1000) return `${value} ms`
  if (value < 60_000) return `${(value / 1000).toFixed(1)} 秒`
  return `${Math.floor(value / 60_000)} 分 ${Math.round((value % 60_000) / 1000)} 秒`
}

function shortAtlasTime(value) {
  const text = String(value || "")
  if (!text || text === "-") return "-"
  return text.replace("T", " ").replace(/\.\d+Z$/, "Z").slice(0, 19)
}

function atlasUpdateSummary(result) {
  const diff = result.stats?.diff?.available ? result.stats.diff : null
  const tail = diff ? (diff.changed ? `本次变化：${diff.summary}。` : "本地条目 / 图片统计也无变化。") : ""
  if (!result.ok) return `更新失败：${result.reason || "unknown"}`
  if (result.skipped) {
    if (result.reason === "versions_unchanged") return `远端版本号未变化，已跳过增量抓取。${tail}`
    if (result.reason === "local_data_missing") return "本地图鉴数据缺失，但配置关闭了缺失时全量拉取。"
    return `已跳过：${result.reason || "skip"}`
  }
  if (result.mode === "initial") return `本地图鉴缺失或手动要求全量，已执行 nanoka-atlas-backend 全量抓取。${tail}`
  return `远端版本号变化，已执行 nanoka-atlas-backend 增量抓取。${tail}`
}

function atlasUpdateMessage(result) {
  const diff = result.stats?.diff?.available ? result.stats.diff : null
  const tail = diff?.changed ? `（${diff.summary}）` : ""
  if (!result.ok) return "[荷花插件]图鉴更新失败。"
  if (result.skipped) return `[荷花插件]图鉴版本未变化，已跳过更新。${diff && !diff.changed ? "（条目 / 图片统计也无变化）" : ""}`
  if (result.mode === "initial") return `[荷花插件]图鉴全量更新完成${tail}。`
  return `[荷花插件]图鉴增量更新完成${tail}。`
}

function atlasFailureReply(result) {
  if (result.reason === "atlas_data_missing") return "[荷花插件]图鉴数据未初始化。"
  return "[荷花插件]没有找到图鉴结果。"
}

function shouldPassThroughShortcutFailure(parsed, result) {
  if (result?.reason === "atlas_data_missing") return false
  if (parsed?.challenge || parsed?.detailSuffix || parsed?.explicit || parsed?.explicitSuffix) return false
  return true
}
