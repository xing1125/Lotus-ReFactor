import { renderWithSkia } from "./core/render/skia.js"
import { resolveDisplayName } from "./services/checkin/profileSignin.js"
import { accountAvatar } from "./services/checkin/account.js"
import { getRandomCharacter } from "./core/characterArt.js"
import fs from "fs"

// 读取真实 wxid 账号（user.nickname 为空，但 account.game_roles 有真实游戏昵称）
function readYamlUser(file) {
  const txt = fs.readFileSync(file, "utf-8")
  const user = {}
  const m = txt.match(/user:\s*\n\s*qq:\s*(.+)\n\s*nickname:\s*(.+)\n\s*platform:\s*(.+)/)
  if (m) { user.qq = m[1].trim(); user.nickname = m[2].trim().replace(/^"|"$/g, ""); user.platform = m[3].trim().replace(/^"|"$/g, "") }
  return user
}

const profile = {
  user: readYamlUser("data/users/wxid_0cryzhxja0r532.yaml"),
  profile: { id: 1 },
  account: {
    game_roles: {
      gs: [{ nickname: "王小呆", is_chosen: true }],
      sr: [{ nickname: "王小呆", is_chosen: true }],
      zzz: [{ nickname: "王小呆（上学中", is_chosen: true }],
    },
  },
  games: { cn: { enable: true, genshin: { checkin: true }, honkai_sr: { checkin: true }, zzz: { checkin: true } } },
}

const display = resolveDisplayName(profile)
console.log("resolveDisplayName =>", JSON.stringify(display))
console.log("avatar =>", accountAvatar(profile.user.qq, profile.user.platform, "ILLU"))

await renderWithSkia("checkin-result", {
  title: display,
  nickname: display,
  account: "profile 1",
  description: "今日全部账号签到成功，社区签到同步完成。",
  badge: "成功",
  message: "已连续签到 30 天",
  illustration: getRandomCharacter(),
  avatar: accountAvatar(profile.user.qq, profile.user.platform, getRandomCharacter()),
  userId: profile.user.qq,
  games: [
    { label: "原神", game: "签到成功", community: "签到成功", days: "128天" },
    { label: "星穹铁道", game: "签到成功", community: "签到成功", days: "98天" },
    { label: "绝区零", game: "签到成功", community: "签到成功", days: "51天" },
  ],
}, { path: "preview/nickname-demo.png", renderScale: 2 })
console.log("OK -> preview/nickname-demo.png")
