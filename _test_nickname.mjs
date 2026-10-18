// 验证微信昵称/头像解析：模拟 ComWeChat 适配器填充的 bot.fl / bot.gml
globalThis.Bot = {
  fl: new Map([
    ["wxid_laominjian", { nickname: "老闽建", "wx.avatar": "https://wx.example.com/a.jpg" }],
    ["wgl806338006", { nickname: "小七" }],
  ]),
  gml: new Map([
    ["806338006", new Map([
      ["wxid_0cryzhxja0r532", { nickname: "阿澈" }],
      ["12345", { name: "QQ号成员" }],
    ])],
    ["112233445", new Map([
      ["wxid_12qsrsfclhan12", { nickname: "柚子" }],
    ])],
  ]),
}

const { lookupNickname, lookupAvatarUrl, accountDisplay, accountLabel, accountAvatar } = await import("./services/checkin/account.js")

const cases = [
  ["好友表命中",        lookupNickname("wxid_laominjian"),        "老闽建"],
  ["群成员表命中",      lookupNickname("wxid_0cryzhxja0r532"),    "阿澈"],
  ["第二个群命中",      lookupNickname("wxid_12qsrsfclhan12"),    "柚子"],
  ["name 字段兜底",     lookupNickname("12345"),                  "QQ号成员"],
  ["数字 id（QQ）",     lookupNickname("wgl806338006"),           "小七"],
  ["解析不到 → 空",     lookupNickname("wxid_unknown"),           ""],
  ["accountDisplay(微信有昵称)", accountDisplay("wxid_laominjian", "wechat"), "老闽建"],
  ["accountDisplay(微信无名)",   accountDisplay("wxid_unknown", "wechat"),    "wxid_unknown"],
  ["accountDisplay(QQ无名)",     accountDisplay("123456789", "qq"),           "账号 123456789"],
  ["显式昵称优先",      accountDisplay("wxid_unknown", "wechat", "手工名"),   "手工名"],
  ["真实头像 URL",      lookupAvatarUrl("wxid_laominjian"),       "https://wx.example.com/a.jpg"],
  ["无头像 → 空",       lookupAvatarUrl("wxid_unknown"),          ""],
]

let pass = 0
for (const [name, got, want] of cases) {
  const ok = got === want
  if (ok) pass++
  console.log(`${ok ? "✓" : "✗"} ${name}\n    got: ${JSON.stringify(got)}  want: ${JSON.stringify(want)}`)
}
console.log(`\n通过 ${pass}/${cases.length}`)
console.log(`accountAvatar(微信有真实头像) → ${accountAvatar("wxid_laominjian", "wechat").slice(0, 40)}`)
console.log(`accountAvatar(微信无头像→立绘) → ${String(accountAvatar("wxid_unknown", "wechat")).slice(-28)}`)
console.log(`accountLabel(QQ 兜底)         → ${accountLabel("123456789", "qq")}`)
