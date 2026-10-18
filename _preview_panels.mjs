import { renderWithSkia } from "./core/render/skia.js"
import path from "node:path"

const outDir = path.resolve("preview")

const games = (ok) => ([
  { label: "原神", game: ok ? "成功" : "失败", community: ok ? "成功" : "失败", days: "12" },
  { label: "星铁", game: ok ? "成功" : "失败", community: ok ? "成功" : "失败", days: "8" },
  { label: "绝区零", game: ok ? "成功" : "待执行", community: ok ? "成功" : "待执行", days: "5" },
  { label: "社区", game: "", community: ok ? "成功" : "失败", days: "" },
])

const panelCases = [
  {
    template: "checkin-stats",
    file: "panel-checkin-stats",
    data: {
      title: "实时签到看板",
      subtitle: "2026-10-16 · 跨群汇总",
      summary: [
        { label: "部署群", value: "3" },
        { label: "已部署成员", value: "31" },
        { label: "今日已签", value: "28" },
        { label: "成功", value: "27" },
        { label: "失败", value: "2" },
        { label: "待签", value: "3" },
      ],
      groups: [
        {
          groupId: "806338006", total: 12, ok: 11, fail: 1, pending: 0, done: 12, rate: "92%",
          members: [
            { name: "旅人", status: "ok", time: "08:12", games: games(true) },
            { name: "小七", status: "ok", time: "08:15", games: games(true) },
            { name: "阿澈", status: "fail", time: "08:20", games: games(false) },
            { name: "柚子", status: "ok", time: "08:24", games: games(true) },
            { name: "星野", status: "pending", time: "", games: [] },
          ],
        },
        {
          groupId: "112233445", total: 9, ok: 8, fail: 1, pending: 0, done: 9, rate: "89%",
          members: [
            { name: "木木", status: "ok", time: "08:31", games: games(true) },
            { name: "凉凉", status: "ok", time: "08:36", games: games(true) },
            { name: "橙子", status: "fail", time: "08:40", games: games(false) },
          ],
        },
      ],
    },
  },
  {
    template: "help-menu",
    file: "panel-help-menu",
    data: {
      title: "荷花插件 · 命令菜单",
      subtitle: "按模块分组 · 输入 #荷花帮助 <分组> 查看细化说明",
      // 与 apps/help.js GROUPS 对齐（全 7 分组），用于验证全览排版
      groups: [
        {
          name: "基础与账号",
          desc: "运行状态 · 配置 · 更新 · 登录绑定 · 账号贯通",
          items: [
            { title: "#荷花状态 / #荷花配置 / #荷花帮助", desc: "运行状态 · 配置面板 · 本命令菜单" },
            { title: "#荷花插件更新 / #荷花插件检查更新", desc: "更新插件 / 检查是否有新版本" },
            { title: "#扫码登录 / #米哈游登录 / #账号密码登录", desc: "米游社登录（扫码 / 账号密码）" },
            { title: "#刷新cookie / #登录列表", desc: "刷新登录态 · 查看已登录账号" },
            { title: "#同步账号 / #同步全部账号", desc: "荷花 ↔ 原神档案双向贯通" },
            { title: "#绑定设备 / #设备信息", desc: "绑定设备信息（社区签到兜底用）" },
            { title: "#ta登录 / #捐赠", desc: "TapTap 账号登录 · 捐赠支持方式" },
          ],
          note: "多账号加后缀 2..255，如 #扫码登录2。",
        },
        {
          name: "自动签到（个人）",
          desc: "（荷花自制）注册 · 时间 · 补签 · 开关",
          items: [
            { title: "#注册自动签到", desc: "注册本人自动签到" },
            { title: "#我的签到时间 / #生成签到计划", desc: "查看 / 重新生成个人签到计划" },
            { title: "#签到随机模式 / #签到固定模式", desc: "随机时间窗口 or 固定时刻" },
            { title: "#随机签到时间 / #固定签到时间", desc: "设置签到时间窗口" },
            { title: "#手动签到 / #补签 / #补签重试", desc: "立即签到 · 补签 · 重试失败项" },
            { title: "#签到错峰", desc: "错开签到时间避免拥堵" },
            { title: "#绑定通知群 / #启用（关闭）签到通知", desc: "结果通知群 · 通知开关" },
            { title: "#启用（关闭）社区签到", desc: "米游社社区签到开关" },
            { title: "#启用（关闭）游戏签到 <游戏> / 全部游戏签到", desc: "按游戏 / 一键切换签到开关" },
          ],
        },
        {
          name: "自动签到（管理 · 群部署）",
          desc: "（荷花自制）全局控制 · 群部署 · 看板",
          items: [
            { title: "#群签到部署", desc: "部署群签到（可指定时间 / 群号）" },
            { title: "#全员注册签到 / #全员二次签到", desc: "批量注册 / 批量补签（两步确认）" },
            { title: "#全员进群重置 / #批量刷新签到", desc: "重置全群签到 · 批量刷新数据" },
            { title: "#自动签到名单 / #自动签到日志", desc: "已注册名单 · 签到执行日志" },
            { title: "#清理误注册群", desc: "清理误注册的群记录" },
            { title: "#签到看板 / #签到人数 / #签到统计", desc: "主人汇总看板（恒私聊发送）" },
          ],
          note: "全员指令两步确认：先看预览，再 #确认二次签到 / #确认注册签到；#取消全员签到 放弃（10 分钟有效）。",
        },
        {
          name: "游戏查询",
          desc: "图鉴成就 · 体力便笺 · 日历素材 · 面板战绩 · 抽卡",
          items: [
            { title: "#图鉴 <角色名> / #图鉴状态 / #更新图鉴", desc: "角色武器图鉴 · 状态 · 手动更新" },
            { title: "#成就 / #成就导入", desc: "成就查漏 · 导入成就数据" },
            { title: "#体力 / #全部体力 / #星铁体力 / #绝区零体力", desc: "原神 / 星铁 / 绝区零 实时便笺" },
            { title: "#日历 / #今日素材 / #明日天赋 / #周一材料", desc: "活动日历 · 养成素材查询" },
            { title: "#更新面板 / #修复面板", desc: "更新 / 修复角色面板数据" },
            { title: "#队伍伤害 / #星铁队伍伤害", desc: "队伍伤害计算" },
            { title: "#获取抽卡记录 / #更新抽卡记录 / #抽卡分析", desc: "祈愿历史 · 抽卡分析" },
          ],
          note: "分类名中点号可省略，如 #星见雅。本部署体力查询按路由主要由 ji-plugin 承接。",
        },
        {
          name: "视频与社交",
          desc: "B站 / 抖音 / 微博 / TapTap（微博 · TapTap 为荷花自制）",
          items: [
            { title: "#荷花搜视频", desc: "搜索 B站 / 抖音视频" },
            { title: "#B站下载 / #抖音下载", desc: "视频直链自动解析下载" },
            { title: "#wb扫码 / #wb签到", desc: "微博超话扫码 / 签到" },
            { title: "#开启（关闭）wb自动签到", desc: "微博自动签到开关" },
            { title: "#ta活动 / #ta签到", desc: "TapTap 活动查询 · 签到" },
            { title: "#开启（关闭）ta自动签到", desc: "TapTap 自动签到开关" },
          ],
          note: "微信端视频 < 20MB 直发；20~100MB 自动压缩；超限或压缩失败发送文件。",
        },
        {
          name: "工具与权限",
          desc: "远程 · 权限 · 群管 · 合伙人",
          items: [
            { title: "#初始化工具环境", desc: "初始化运行依赖" },
            { title: "#权限列表 / #自动签到黑白名单", desc: "指令权限配置 · 签到黑白名单" },
            { title: "#群成员 / #群清理退群", desc: "群成员列表 · 清理退群记录" },
            { title: "#远程2FA状态 / #远程spawn", desc: "远程执行（仅主人 · 需 TOTP）" },
            { title: "#TuneWeave状态 / #testnine状态", desc: "外部服务状态查询" },
            { title: "#合伙人登录", desc: "合伙人账号登录" },
          ],
          note: "远程相关指令仅 bot 主人可用，须带 6 位 TOTP。",
        },
        {
          name: "管理命令",
          desc: "全局开关 · 仅 bot 主人可用",
          auth: "master",
          items: [
            { title: "#全局开启（关闭）签到", desc: "一键开关全插件签到" },
            { title: "#全局开启（关闭）游戏签到 <游戏>", desc: "按游戏全局开关" },
            { title: "#全局开启（关闭）社区签到", desc: "社区签到全局开关" },
            { title: "#全局静默 / #全局开启通知", desc: "全局通知静默 / 恢复" },
            { title: "#全局纯文字 / #全局图文", desc: "全局推送纯文字 / 图文" },
            { title: "#设置主人 <wxid>", desc: "绑定主人 wxid（看板接收者）" },
            { title: "#全局签到状态", desc: "查看全局开关当前状态" },
          ],
        },
      ],
    },
  },
  {
    // 下钻视图：单独一个模块（单分组 → 单栏条目）
    template: "help-menu",
    file: "panel-help-single",
    data: {
      title: "荷花插件 · 自动签到（管理 · 群部署）",
      subtitle: "（荷花自制）全局控制 · 群部署 · 看板",
      groups: [
        {
          name: "自动签到（管理 · 群部署）",
          desc: "（荷花自制）全局控制 · 群部署 · 看板",
          items: [
            { title: "#群签到部署", desc: "部署群签到（可指定时间 / 群号）" },
            { title: "#全员注册签到 / #全员二次签到", desc: "批量注册 / 批量补签（两步确认）" },
            { title: "#全员进群重置 / #批量刷新签到", desc: "重置全群签到 · 批量刷新数据" },
            { title: "#自动签到名单 / #自动签到日志", desc: "已注册名单 · 签到执行日志" },
            { title: "#清理误注册群", desc: "清理误注册的群记录" },
            { title: "#签到看板 / #签到人数 / #签到统计", desc: "主人汇总看板（恒私聊发送）" },
          ],
          note: "全员指令两步确认：先看预览，再 #确认二次签到 / #确认注册签到；#取消全员签到 放弃（10 分钟有效）。",
        },
      ],
    },
  },
  {
    // 多分组下钻：同一张图里排两个相关分组（COLS=2 分支）
    template: "help-menu",
    file: "panel-help-two",
    data: {
      title: "荷花插件 · 自动签到",
      subtitle: "相关分组",
      groups: [
        {
          name: "自动签到（个人）",
          desc: "（荷花自制）注册 · 时间 · 补签 · 开关",
          items: [
            { title: "#注册自动签到", desc: "注册本人自动签到" },
            { title: "#我的签到时间 / #生成签到计划", desc: "查看 / 重新生成个人签到计划" },
            { title: "#签到随机模式 / #签到固定模式", desc: "随机时间窗口 or 固定时刻" },
            { title: "#手动签到 / #补签 / #补签重试", desc: "立即签到 · 补签 · 重试失败项" },
            { title: "#签到错峰", desc: "错开签到时间避免拥堵" },
            { title: "#启用（关闭）游戏签到 <游戏> / 全部游戏签到", desc: "按游戏 / 一键切换签到开关" },
          ],
        },
        {
          name: "自动签到（管理 · 群部署）",
          desc: "（荷花自制）全局控制 · 群部署 · 看板",
          items: [
            { title: "#群签到部署", desc: "部署群签到（可指定时间 / 群号）" },
            { title: "#全员注册签到 / #全员二次签到", desc: "批量注册 / 批量补签（两步确认）" },
            { title: "#全员进群重置 / #批量刷新签到", desc: "重置全群签到 · 批量刷新数据" },
            { title: "#自动签到名单 / #自动签到日志", desc: "已注册名单 · 签到执行日志" },
            { title: "#清理误注册群", desc: "清理误注册的群记录" },
            { title: "#签到看板 / #签到人数 / #签到统计", desc: "主人汇总看板（恒私聊发送）" },
          ],
          note: "全员指令两步确认：先看预览，再 #确认二次签到 / #确认注册签到；#取消全员签到 放弃（10 分钟有效）。",
        },
      ],
    },
  },
  {
    template: "weibo-checkin",
    file: "panel-weibo",
    data: {
      title: "微博超话签到",
      subtitle: "账号 wxid_3t6vrie4sv522",
      result: { signed: 6, skipped: 2, failed: 1, total: 9 },
      message: "已完成 6 个超话签到，2 个今日已签、1 个失败（超话限制或 cookie 过期）。",
    },
  },
]

for (const c of panelCases) {
  const out = path.join(outDir, `${c.file}.png`)
  try {
    await renderWithSkia(c.template, c.data, { path: out, renderScale: 2 })
    console.log(`OK  ${c.file} (${c.template}) -> ${out}`)
  } catch (e) {
    console.error(`FAIL ${c.file}:`, e.message)
  }
}
