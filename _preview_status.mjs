import { renderWithSkia } from "./core/render/skia.js"
import path from "node:path"

const outDir = path.resolve("preview")

const cases = [
  {
    template: "status",
    file: "status-admin-resign",
    data: {
      title: "全员二次签到",
      subtitle: "管理员 账号 wxid_3t6vrie4sv522 · 跨群生效",
      badge: "29/31",
      message: "已为 31 个已扫码 profile 拉起二次签到（成功 29 / 失败 2）。当前「全局静默」模式：未向各用户推送结果卡，仅此汇总发给你（管理员）。社区签到（米游社）已包含在此次批量中。",
      items: [
        { label: "操作范围", value: "全体已扫码用户（跨群）" },
        { label: "补签 profile 数", value: "31" },
        { label: "成功", value: "29" },
        { label: "失败", value: "2" },
        { label: "账号 laominjian · P1", value: "成功" },
        { label: "账号 wgl806338006 · P1", value: "成功" },
        { label: "账号 wxid_0cryzhxja0r532 · P1", value: "成功" },
        { label: "账号 wxid_0kyenxzgl7hf22 · P1", value: "失败：cookie 已失效，请重新扫码登录" },
        { label: "账号 wxid_12qsrsfclhan12 · P1", value: "成功" },
        { label: "账号 wxid_21os40jdnijd22 · P1", value: "成功" },
        { label: "账号 wxid_3t6vrie4sv522 · P1", value: "成功" },
        { label: "账号 wxid_3t6vrie4sv522 · P2", value: "成功" },
        { label: "账号 wxid_5j0ncn6foe9112 · P1", value: "成功" },
        { label: "账号 wxid_840omie4nhbm12 · P1", value: "成功" },
        { label: "更多", value: "另有 19 个 profile" },
      ],
    },
  },
  {
    template: "schedule-notice",
    file: "status-schedule-notice",
    data: {
      title: "旅行者",
      subtitle: "2026-10-17 · profile 1",
      badge: "08:30",
      message: "明天将按计划为你自动签到（原神 / 星铁 / 绝区零 + 米游社社区）。如需调整，发送 #我的签到时间 查看，或 #签到固定模式 HH:MM 修改。",
      items: [
        { label: "签到时间", value: "08:30" },
        { label: "签到模式", value: "固定" },
        { label: "群号", value: "806338006" },
      ],
    },
  },
  {
    template: "status",
    file: "status-simple",
    data: {
      title: "登录信息已清除",
      subtitle: "账号 wxid_5j0ncn6foe9112 · Profile 1",
      badge: "完成",
      items: [
        { label: "已清除", value: "cookie / 设备指纹 / 缓存" },
        { label: "剩余 profile", value: "2" },
      ],
      message: "该档案的登录凭证已移除，相关自动签到已停止。重新使用请发送 #扫码登录。",
    },
  },
  {
    template: "status",
    file: "status-atlas",
    data: {
      title: "图鉴状态",
      subtitle: "荷花插件 · NanokaAtlas",
      badge: "正常",
      items: [
        { label: "角色总数", value: "287" },
        { label: "已缓存角色", value: "287" },
        { label: "缺失角色", value: "0" },
        { label: "上次更新", value: "2026-10-15 22:10" },
      ],
      message: "图鉴数据完整，无需更新。发送 #更新图鉴 可手动检查上游最新数据。",
    },
  },
  {
    template: "status",
    file: "status-roster",
    data: {
      title: "自动签到群 / 员名单",
      subtitle: "跨群 · 按群分组成员（已开启自动签到）",
      badge: "31",
      message: "已开启自动签到的账号 31 个（共 39 个 profile）。扫码登录现已自动加入名单；也可用 #全员注册签到 批量开启。#清理误注册群 可修正误写入的投递群。",
      items: [
        { label: "已开启账号", value: "31" },
        { label: "profile 总数", value: "39" },
        { label: "群 萤火小站", value: "12 人" },
        { label: "· 旅人（wxid_3t6vrie4sv522）", value: "" },
        { label: "· 小七（wgl806338006）", value: "" },
        { label: "· 阿澈（wxid_0cryzhxja0r532）", value: "P2" },
        { label: "· 柚子（wxid_12qsrsfclhan12）", value: "" },
        { label: "· …", value: "该群另有 8 人" },
        { label: "群 晨曦茶话会", value: "9 人" },
        { label: "· 星野（wxid_5j0ncn6foe9112）", value: "" },
        { label: "· 木木（wxid_840omie4nhbm12）", value: "" },
        { label: "· …", value: "该群另有 7 人" },
        { label: "未匹配到群", value: "2 人（仅 fallback / 无群成员记录）" },
      ],
    },
  },
  {
    template: "status",
    file: "status-sync",
    data: {
      title: "全量账号同步",
      subtitle: "genshin → 荷花 · 共扫描 39 个账号",
      badge: "6",
      message: "已把 genshin 侧账号批量同步到荷花档案：新同步 6 个，已有完整登录信息者自动跳过 31 个（不覆盖荷花侧数据），失败 2 个。",
      items: [
        { label: "新同步", value: "6" },
        { label: "已有跳过", value: "31" },
        { label: "失败", value: "2" },
        { label: "账号 wgl806338006", value: "失败：genshin 侧未找到该账号绑定的账号（无 CK）" },
        { label: "账号 wxid_21os40jdnijd22", value: "失败：请求超时" },
      ],
    },
  },
]

for (const c of cases) {
  const out = path.join(outDir, `${c.file}.png`)
  try {
    await renderWithSkia(c.template, c.data, { path: out, renderScale: 2 })
    console.log(`OK  ${c.file} (${c.template}) -> ${out}`)
  } catch (e) {
    console.error(`FAIL ${c.file}:`, e.message)
  }
}
