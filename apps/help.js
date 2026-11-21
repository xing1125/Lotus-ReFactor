// 荷花帮助菜单（模块化分组式，覆盖插件全部当前功能 = 上游模块 + 荷花自制模块）
//
// 触发：
//   #荷花帮助 / #lotus帮助 / #Lotus help …   → 显示全部分组的命令索引
//   #荷花帮助 <分组>                        → 下钻该分组的逐条功能说明
//   #自动签到帮助 [<分组>]                  → 直接跳到「自动签到」相关分组
//
// 结构（对标 miao-plugin 的 help 数据模型）：
//   分组（功能域）→ 条目（一组相关指令 + 说明）
//   条目 title = 指令组（同族指令写在一行，如「#荷花状态 / #荷花配置」）
//   条目 desc  = 该组指令的用途说明
//   GROUPS 为唯一权威指令索引，按当前 apps/*.js 实际注册规则整理。
//
// 版式：
//   总览固定的 index 索引模式（只显示指令，避免大图过长）；
//   分组下钻固定 full 图文模式（指令 + 说明 + 注意事项）。
//   仅在本文件内临时切换 LOTUS_HELP_STYLE，不改渲染器，也不影响其它卡片。

const BasePlugin = globalThis.plugin

import { replyText, replyImage } from "../core/transport/reply.js"
import { renderWithSkia } from "../core/render/skia.js"

export const GROUPS = [
  {
    name: "基础与面板",
    desc: "运行状态 · 配置面板 · 更新 · 环境初始化 · 捐赠",
    items: [
      { title: "#荷花状态 / #荷花测试 / #Lotus status", desc: "插件加载状态与冒烟自检" },
      { title: "#荷花帮助 / #自动签到帮助", desc: "命令总览 · 下钻签到分组" },
      { title: "#荷花配置 / #荷花管理面板", desc: "个人配置面板 · 主人管理面板（Web）" },
      { title: "#米游社功能 / #荷花面板 / #米游币商城 / #米游币兑换", desc: "米游社功能入口 · 角色面板 · 米游币兑换" },
      { title: "#荷花插件更新 / #荷花插件检查更新", desc: "安全更新插件 · 仅检查是否有新版本" },
      { title: "#初始化环境 / #初始化签到环境 / #初始化工具环境", desc: "修复运行依赖 · 验证码环境 · 工具环境" },
      { title: "#捐赠", desc: "查看荷花插件的捐赠支持方式" },
    ],
  },
  {
    name: "登录与 Cookie",
    desc: "扫码登录 · 刷新凭据 · 账号映射 · 设备",
    items: [
      { title: "#扫码登录 / #二维码登录 / #辅助登录 / #米哈游登录", desc: "扫码绑定米游社账号，可加编号指定档案" },
      { title: "#登录列表 / #账号列表", desc: "查看档案编号与账号映射" },
      { title: "#刷新cookie / #刷新ck / #刷新自动签到", desc: "刷新登录态与自动签到凭据" },
      { title: "#清除登录 / #删除cookie", desc: "删除指定档案的登录态" },
      { title: "#同步角色 / #同步UID / #同步登录", desc: "同步游戏 UID 或登录信息到插件档案" },
      { title: "#绑定设备 / #设备信息", desc: "绑定或查看设备信息（社区签到兜底）" },
      { title: "#注入lulutk <token> / #注入plaotk <token>", desc: "注入外部验证码 token（主人）" },
      { title: "#切换lulutk / #切换plaotk / #yzm次数查询", desc: "切换验证码 token · 查剩余次数（主人）" },
    ],
    note: "密码登录已停用。扫码只返回 stoken 时会自动换票；若米游社判定登录方式失效，会提示重新扫码。",
  },
  {
    name: "自动签到（个人）",
    desc: "注册 · 计划 · 时间 · 手动签到 · 档案开关",
    items: [
      { title: "#注册自动签到 / #注册本群签到", desc: "注册个人或本群自动签到" },
      { title: "#我的签到时间 / #生成签到计划 / #执行到期签到", desc: "查看 · 重建签到计划 · 手动触发到期任务" },
      { title: "#签到随机模式 / #签到固定模式 / #签到随机窗口", desc: "随机窗口 · 固定时刻 · 自定义随机时间范围" },
      { title: "#固定签到时间 HH:MM / #签到计划生成 HH:MM", desc: "设置固定签到时刻 · 设置计划生成时刻" },
      { title: "#手动签到 / #签到 / #开始签到 / #测试签到", desc: "立即签到，可带游戏前缀与档案编号" },
      { title: "#全部签到 / #签到任务 / #社区签到任务", desc: "跑全部游戏签到 · 米游社社区签到任务" },
      { title: "#补签 / #补签重试 / #二次签到 / #重新签到", desc: "失败补签与有限重试" },
      { title: "#绑定通知群 / #设置通知私聊 / #设置通知群聊", desc: "设置结果通知目标与通知形式" },
      { title: "#启用/关闭签到通知 / #启用/关闭社区签到", desc: "按档案开关通知与社区签到" },
      { title: "#启用/关闭<游戏>签到 / #启用/关闭全部游戏签到", desc: "按游戏或一键切换游戏签到" },
      { title: "#跟随/继承全局签到时间", desc: "让个人档案使用全局计划时间" },
      { title: "#绑定国际服cookie / #启用国际服签到 / #设置国际服语言", desc: "国际服签到配置" },
      { title: "#绑定云原神token / #绑定云绝区零token / #启用云签到", desc: "云原神 · 云绝区零签到配置" },
    ],
    note: "所有档案级设置都支持在命令末尾加档案编号；编号见 #登录列表。",
  },
  {
    name: "自动签到（管理 · 全局）",
    desc: "群部署 · 批量操作 · 名单日志 · 看板 · 错峰",
    items: [
      { title: "#群签到部署", desc: "一键部署群签到：注册全员 + 通知群 + 时间" },
      { title: "#全员注册签到 / #全员二次签到 / #全员补签", desc: "批量注册或补跑，两步确认后执行" },
      { title: "#确认注册签到 / #确认二次签到 / #取消全员签到", desc: "确认 · 取消批量操作（10 分钟内有效）" },
      { title: "#清理误注册群 / #确认清理误注册群", desc: "两步清理误注册的群记录" },
      { title: "#全员进群重置", desc: "强制把签到结果投递到对应的群" },
      { title: "#自动签到名单 / #签到名单列表 / #自动签到日志", desc: "查看签到群员名单与执行日志" },
      { title: "#签到看板 / #签到人数 / #签到统计", desc: "私聊发送今日各群实时签到进度" },
      { title: "#签到后台", desc: "私聊发送带令牌的 HTTP 实时看板链接（主人）" },
      { title: "#批量刷新签到", desc: "批量刷新账号状态与登录态" },
      { title: "#签到错峰 / #错峰设置 / #签到延迟", desc: "设置签到延迟，避免大规模签到打满连接器" },
    ],
    note: "批量指令先出预览，确认后再执行；看板类结果默认私聊发送给触发者。",
  },
  {
    name: "体力与推送",
    desc: "原神 / 星铁 / 绝区零便笺 · 阈值推送",
    items: [
      { title: "#体力 / #全部体力 / #原神体力 / #树脂 / #便笺", desc: "原神实时便笺；裸 #体力默认查三游戏" },
      { title: "*体力 / #星铁体力 / #开拓力", desc: "星穹铁道实时便笺" },
      { title: "%体力 / zzz体力 / #绝区零体力", desc: "绝区零实时便笺" },
      { title: "#开启体力推送 / #关闭体力推送", desc: "按游戏或档案开关体力阈值推送" },
      { title: "#体力推送阈值 <数值>", desc: "设置体力推送阈值" },
    ],
    note: "裸 #体力会查询原神 + 星铁 + 绝区零；未绑定 UID 的账号静默跳过。",
  },
  {
    name: "游戏战绩与面板",
    desc: "深渊挑战 · 队伍伤害 · 抽卡统计 · 面板 · 日历",
    items: [
      { title: "#深渊 / #上期深渊 / #深境螺旋", desc: "原神深境螺旋战绩" },
      { title: "*混沌 / *虚构 / *末日 / *异相", desc: "星铁混沌、虚构、末日、异相挑战记录" },
      { title: "%式舆 / %防卫战 / %危局 / %强袭", desc: "绝区零式舆防卫战与危局强袭战记录" },
      { title: "#队伍伤害 / *队伍伤害 / #星铁队伍伤害", desc: "队伍伤害计算与过程回放" },
      { title: "#更新抽卡记录 / *更新抽卡记录 / zzz更新抽卡", desc: "更新原神 / 星铁 / 绝区零抽卡记录" },
      { title: "#版本统计 / *版本统计 / #抽卡分析 / %抽卡分析", desc: "祈愿、跃迁、调频记录统计" },
      { title: "#更新面板 / *更新面板 / zzz更新面板 / #修复面板", desc: "角色面板更新与面板缓存修复" },
      { title: "#强制刷新天赋 / #重载面板 / #删除面板数据", desc: "喵喵桥面板数据维护" },
      { title: "#日历 / *日历 / %日历 / #今日素材 / #明日天赋", desc: "活动日历 · 养成素材与天赋材料" },
    ],
    note: "游戏前缀可省略；档案编号写在命令末尾，见 #登录列表。",
  },
  {
    name: "图鉴与成就",
    desc: "角色武器图鉴 · 命座星魂影画 · 成就",
    items: [
      { title: "#图鉴 <名称> / #XX图鉴", desc: "查询角色、武器图鉴" },
      { title: "#XX专武 / #XX套", desc: "按角色查专武 · 按套装名查圣遗物/遗器" },
      { title: "#命座图鉴 / *星魂图鉴 / %影画图鉴 / #天赋图鉴", desc: "命座 · 星魂 · 影画 · 天赋图鉴" },
      { title: "#图鉴状态 / #图鉴帮助 / #图鉴黑名单", desc: "图鉴运行状态 · 帮助 · 黑名单" },
      { title: "#更新图鉴 / #检查图鉴更新 / #全量更新图鉴 / #重置图鉴", desc: "增量更新 · 检查更新 · 全量更新 · 重置" },
      { title: "#成就 / #成就导入", desc: "成就查漏 · 导入成就数据" },
      { title: "#捕获挑战数据", desc: "采集剧诗 / 幽境原始报文（主人，用于自制卡）" },
    ],
  },
  {
    name: "音乐与视频",
    desc: "B站 / 抖音 / 多平台点歌",
    items: [
      { title: "#搜视频 <关键词> / #看视频 <关键词> / #看N", desc: "搜索 B站视频 · 按序号选择播放" },
      { title: "#B站下载 <链接> / #B站登录", desc: "B站视频下载 · B站账号登录" },
      { title: "B站 / b23 链接自动解析", desc: "识别 B站视频、直播、BV/av 号链接" },
      { title: "#抖音下载 <链接> / 抖音链接自动解析", desc: "抖音作品下载与链接识别" },
      { title: "#点歌 / #搜歌 / #音乐登录 / #音乐帮助", desc: "网易云、QQ、酷狗、酷我、咪咕、汽水点歌" },
      { title: "#听N / #下一页 / #取消", desc: "点歌结果选择 · 翻页 · 取消" },
    ],
  },
  {
    name: "微博 / TapTap / 兑换码",
    desc: "微博超话 · TapTap · 前瞻兑换码",
    items: [
      { title: "#wb扫码 / #取消wb扫码 / #wb签到 / #wb签到状态", desc: "微博扫码登录 · 超话签到 · 状态查询" },
      { title: "#绑定微博ck / #wbcookie / #wb链接 / #清除wb登录", desc: "微博 cookie · app 链接绑定与清除" },
      { title: "#开启/关闭wb自动签到", desc: "微博自动签到开关" },
      { title: "#微博cdk / #微博cdk帮助 / #更新微博cdk", desc: "微博「天签到礼包」兑换码与说明" },
      { title: "#ta帮助 / #ta登录 / #ta活动 / #ta签到 / #ta状态", desc: "TapTap 登录 · 活动 · 签到 · 状态" },
      { title: "#开启/关闭ta自动签到 / #ta", desc: "TapTap 自动签到开关 / 状态别名" },
      { title: "#兑换码 / #星布谷地公测兑换码", desc: "官方前瞻兑换码 · 星布谷地公测兑换码" },
      { title: "#注册自动兑换前瞻兑换码 / #关闭自动兑换前瞻兑换码", desc: "前瞻兑换码自动兑换开关" },
    ],
    note: "微博 CDK 兑换需要先绑定微博 ck 或 #wb链接 <cardlist 链接>。",
  },
  {
    name: "工具 · 权限 · 远程",
    desc: "权限配置 · 群管 · 验证码服务 · 远程执行",
    items: [
      { title: "#权限列表 / #权限配置 / #自动签到黑/白名单", desc: "查看指令权限 · 签到黑白名单" },
      { title: "#添加/删除黑/白名单 / #权限设置", desc: "增删名单 · 设置指令权限" },
      { title: "#权限允许/拒绝/移除用户/群", desc: "细粒度用户与群组权限配置" },
      { title: "#群成员 / #群清理退群 <群号>", desc: "导出群成员文件 · 清理退群记录" },
      { title: "#testnine状态 / #启动testnine服务 / #停止testnine服务", desc: "本地验证码服务状态与启停" },
      { title: "#初始化TuneWeave / #TuneWeave状态", desc: "网易云合伙人运行环境初始化与状态" },
      { title: "#合伙人登录 / #合伙人日志 / #合伙人测试", desc: "合伙人账号登录 · 日志 · 手动测试" },
      { title: "#同步角色库 / #刷新角色库", desc: "同步 miao 新角色并清理过期攻略图（主人）" },
      { title: "#远程2FA初始化 / #远程2FA状态", desc: "远程执行 TOTP 绑定与状态（主人）" },
      { title: "#远程spawn / #远程下载 / #远程上传", desc: "受 6 位 TOTP 保护的远程执行与文件传输（主人）" },
    ],
    note: "远程执行、文件传输、角色库同步仅主人可用；远程执行必须带 6 位 TOTP。",
  },
  {
    name: "管理命令（主人）",
    desc: "全局开关 · 通知模式 · 代执行 · 仅 bot 主人可用",
    auth: "master",
    items: [
      { title: "#全局开启签到 / #全局关闭签到", desc: "全插件签到总开关" },
      { title: "#全局开启/关闭游戏签到 <游戏>", desc: "按游戏设置全局签到开关" },
      { title: "#全局开启/关闭社区签到", desc: "米游社社区签到全局开关" },
      { title: "#全局静默 / #全局开启通知 / #全局通知", desc: "全局推送静默与恢复" },
      { title: "#全局纯文字 / #全局图文", desc: "全局推送使用纯文字或图文" },
      { title: "#设置主人 <wxid> / #全局签到状态", desc: "绑定看板接收者 · 查看全局开关状态" },
      { title: "#执行 <命令> / #代 <命令>", desc: "代执行命令（主人）" },
      { title: "#荷花管理面板", desc: "打开主人 Web 配置面板" },
    ],
  },
]

// 旧分类名 / 常用简称 → 新分组名（保证老用户习惯的入口仍可用）
// 注意：不要登记「自动签到 / 签到」——交给模糊匹配，好让它们同时命中两个签到分组。
const ALIAS = {
  基础: "基础与面板", 状态: "基础与面板", 面板总览: "基础与面板", 更新: "基础与面板", 配置: "基础与面板", 环境: "基础与面板",
  登录: "登录与 Cookie", 账号: "登录与 Cookie", Cookie: "登录与 Cookie", cookie: "登录与 Cookie", 扫码: "登录与 Cookie",
  自动签到个人: "自动签到（个人）", 个人: "自动签到（个人）", 签到设置: "自动签到（个人）", 计划: "自动签到（个人）", 补签: "自动签到（个人）",
  自动签到管理: "自动签到（管理 · 全局）", 签到管理: "自动签到（管理 · 全局）", 群部署: "自动签到（管理 · 全局）", 全员: "自动签到（管理 · 全局）", 看板: "自动签到（管理 · 全局）", 后台: "自动签到（管理 · 全局）",
  体力: "体力与推送", 便笺: "体力与推送", 推送: "体力与推送", 树脂: "体力与推送", 开拓力: "体力与推送",
  游戏: "游戏战绩与面板", 战绩: "游戏战绩与面板", 深渊: "游戏战绩与面板", 抽卡: "游戏战绩与面板", 面板: "游戏战绩与面板", 日历: "游戏战绩与面板", 伤害: "游戏战绩与面板",
  图鉴: "图鉴与成就", 成就: "图鉴与成就", 专武: "图鉴与成就", 套装: "图鉴与成就",
  音乐: "音乐与视频", 视频: "音乐与视频", B站: "音乐与视频", 抖音: "音乐与视频", 点歌: "音乐与视频",
  微博: "微博 / TapTap / 兑换码", TapTap: "微博 / TapTap / 兑换码", ta: "微博 / TapTap / 兑换码", wb: "微博 / TapTap / 兑换码", 兑换码: "微博 / TapTap / 兑换码", 社交: "微博 / TapTap / 兑换码",
  工具: "工具 · 权限 · 远程", 权限: "工具 · 权限 · 远程", 远程: "工具 · 权限 · 远程", 群管: "工具 · 权限 · 远程", 合伙人: "工具 · 权限 · 远程", 验证码: "工具 · 权限 · 远程",
  管理命令: "管理命令（主人）", 全局: "管理命令（主人）", 主人: "管理命令（主人）", master: "管理命令（主人）",
}

const GROUP_NAMES = GROUPS.map(g => g.name)

// 把用户输入解析为一组分组（支持精确名 / 别名 / 模糊包含；「自动签到」可命中两个分组）
export function resolveGroups(arg) {
  const a = String(arg || "").trim()
  if (!a) return GROUPS
  const exact = GROUPS.filter(g => g.name === a)
  if (exact.length) return exact
  if (ALIAS[a]) {
    const mapped = GROUPS.filter(g => g.name === ALIAS[a])
    if (mapped.length) return mapped
  }
  const hit = GROUPS.filter(g => g.name.includes(a) || a.includes(g.name) || a.includes(g.name.replace(/[（(].*?[)）]/g, "")))
  if (hit.length) return hit
  return []
}

// 只在帮助卡渲染期间切换版式，结束后恢复原环境值。
async function renderHelp(data, style) {
  const previous = process.env.LOTUS_HELP_STYLE
  if (style) process.env.LOTUS_HELP_STYLE = style
  else delete process.env.LOTUS_HELP_STYLE
  try {
    return await renderWithSkia("help-menu", data)
  } finally {
    if (previous === undefined) delete process.env.LOTUS_HELP_STYLE
    else process.env.LOTUS_HELP_STYLE = previous
  }
}

export class LotusHelp extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] Help",
      dsc: "Lotus 模块化帮助菜单",
      event: "message",
      priority: 20,
      rule: [
        { reg: "^#?(Lotus|lotus|荷花)(帮助|help)(\\s.*)?$", fnc: "help" },
        { reg: "^#自动签到帮助(\\s.*)?$", fnc: "help" },
      ],
    })
  }

  async help() {
    const msg = String(this.e.msg || "").trim()
    let arg = ""

    if (/^#自动签到帮助/.test(msg)) {
      arg = msg.replace(/^#自动签到帮助\s*/, "").trim() || "自动签到"
    } else {
      arg = msg.replace(/^#?(Lotus|lotus|荷花)(帮助|help)\s*/, "").trim()
    }

    if (arg) return this.showGroup(arg)
    return this.showIndex()
  }

  async showIndex() {
    const image = await renderHelp({
      title: "荷花插件 · 命令菜单",
      subtitle: "命令索引总览 · 输入 #荷花帮助 <分组> 查看详细说明",
      groups: GROUPS,
    }, "index")
    await replyImage(this, image)
    return true
  }

  async showGroup(arg) {
    const found = resolveGroups(arg)
    if (!found.length) {
      await replyText(this, `[荷花插件]未找到分组「${arg}」。可用分组：\n${GROUP_NAMES.join(" / ")}`)
      return true
    }
    const title = found.length === 1 ? `荷花插件 · ${found[0].name}` : `荷花插件 · ${arg}`
    const subtitle = found.length === 1 ? (found[0].desc || "") : "相关分组"
    const image = await renderHelp({
      title,
      subtitle,
      groups: found,
    })
    await replyImage(this, image)
    return true
  }
}
