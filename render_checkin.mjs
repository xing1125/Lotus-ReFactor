import { renderWithSkia } from "./core/render/skia.js"
import { getRandomCharacter } from "./core/characterArt.js"

const cases = [
  {
    name: "status",
    data: {
      title: "荷花插件",
      subtitle: "Lotus Plugin · 运行状态",
      badge: "OK",
      message: "所有服务模块运行正常，定时任务已加载 12 项，昨日签到成功率 92%。",
      items: [
        { label: "机器人账号", value: "LotusBot#1234" },
        { label: "已连接群", value: "38 个" },
        { label: "今日签到", value: "完成 92%" },
        { label: "待办提醒", value: "3 条" },
        { label: "缓存命中", value: "98.6%" },
        { label: "运行时间", value: "14 天" },
      ],
    },
  },
  {
    name: "profile-card",
    data: {
      title: "配置资料卡",
      subtitle: "LotusBot 主账号",
      badge: "PROFILE",
      summary: "这是一份用于演示蓝色玻璃主题的资料卡。",
      account: [
        { label: "登录状态", value: "已登录" },
        { label: "Cookie", value: "有效" },
        { label: "绑定游戏", value: "原神 / 星铁" },
      ],
      roles: [
        { label: "主角A", value: "Lv.60" },
        { label: "主角B", value: "Lv.58" },
        { label: "主角C", value: "Lv.55" },
      ],
      settings: [
        { label: "自动签到", value: "开启" },
        { label: "推送群", value: "群①" },
        { label: "静默模式", value: "关闭" },
      ],
    },
  },
  {
    name: "checkin-result",
    data: {
      nickname: "旅行者",
      account: "每日自动签到 · UID 100123456",
      description: "今日全部账号签到成功，社区签到同步完成。",
      badge: "成功",
      illustration: getRandomCharacter(),
      games: [
        { label: "原神", game: "签到成功", community: "签到成功", days: "128天" },
        { label: "崩坏3", game: "签到成功", community: "签到成功", days: "64天" },
        { label: "星穹铁道", game: "签到成功", community: "签到成功", days: "98天" },
        { label: "绝区零", game: "签到成功", community: "签到成功", days: "51天" },
        { label: "未定事件簿", game: "签到成功", community: "签到成功", days: "30天" },
        { label: "崩坏2", game: "签到成功", community: "签到成功", days: "12天" },
        { label: "大别野", game: "签到成功", community: "签到成功", days: "7天" },
        { label: "因缘精灵", game: "签到成功", community: "签到成功", days: "3天" },
      ],
    },
  },
]

for (const c of cases) {
  const out = `preview/${c.name}-preview.png`
  await renderWithSkia(c.name, c.data, { path: out, renderScale: 2 })
  console.log("OK ->", out)
}

