// 预览微博超话签到专属卡片
import { renderWithSkia } from "./core/render/skia.js"

const mockResult = {
  ok: true,
  total: 15,
  signed: 11,
  skipped: 3,
  failed: 1,
  results: [
    { name: "原神", level: 5, status: "signed" },
    { name: "崩坏：星穹铁道", level: 7, status: "already_signed" },
    { name: "绝区零", level: 2, status: "signed" },
    { name: "崩坏3", level: 6, status: "signed" },
    { name: "未定事件簿", level: 4, status: "already_signed" },
    { name: "大别野", level: 3, status: "signed" },
    { name: "鸣潮", level: 1, status: "failed", reason: "http_403" },
    { name: "明日方舟", level: 8, status: "signed" },
    { name: "王者荣耀", level: 12, status: "signed" },
    { name: "英雄联盟", level: 9, status: "already_signed" },
    { name: "原神攻略", level: 4, status: "signed" },
    { name: "测试超话A", level: 2, status: "signed" },
  ],
}

await renderWithSkia("weibo-checkin", {
  title: "微博超话签到",
  subtitle: `签到 ${mockResult.signed}/${mockResult.total}`,
  message: `共 ${mockResult.total} 个超话：成功 ${mockResult.signed}，已签 ${mockResult.skipped}，失败 ${mockResult.failed}。`,
  result: mockResult,
  userId: "10001",
}, { path: "preview/weibo_checkin.png", imgType: "png", quality: 95 })

console.log("written preview/weibo_checkin.png")
