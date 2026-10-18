// 账号平台自适应助手
//
// 背景：本插件的身份主键是 profile.user.qq。在 QQ 适配器下它存放的是纯数字 QQ 号；
// 在微信适配器下它存放的是微信 id（如 wxid_xxx，非纯数字）。此前所有卡片都无条件
// 拼 qlogo.cn 的 QQ 头像地址并写死「QQ <id>」昵称前缀，导致：
//   1) 微信环境下头像请求 qlogo.cn 必然拉到破损图；
//   2) qq 为空时 qqAvatar 会回退到硬编码的他人 QQ 头像（1102305070），造成串号/隐私泄露；
//   3) 昵称前缀「QQ 」在微信下是误导。
//
// 这里统一按平台区分：
//   - 优先用 profile.user.platform（适配器显式给的 'qq' / 'wechat'，登录/绑定时写入）；
//   - 缺失时回退到 user.qq 形态正则（/^\d{5,}$/，兼容历史 profile）。
// QQ 保持原行为；非 QQ（微信等）不请求外部 CDN、不写「QQ 」前缀，头像交由 skia 渲染「头像」占位。

// QQ 号：5 位及以上纯数字。微信 id 等通常含字母/下划线，不匹配。
const QQ_ACCOUNT_RE = /^\d{5,}$/

// 角色立绘库：拿不到真实头像时作为头像兜底（本地文件，loadImage 直接可吃）
import { getRandomCharacter } from "../../core/characterArt.js"

// 是否为 QQ 数字账号。仅在没有显式 platform 时用作回退判别。
export function isQQAccount(id) {
  return QQ_ACCOUNT_RE.test(String(id || ""))
}

// 权威平台判别：显式 platform 优先；缺失时回退 user.qq 形态正则。
export function isQQUser(user = {}) {
  if (user.platform === "qq") return true
  if (user.platform === "wechat") return false
  return isQQAccount(user.qq)
}

// 从 Yunzai 事件里读取适配器平台标识。
// ComWeChat-Client(OneBot V12) 在事件 self.platform 里给 'wechat'；不同适配器落点可能不同，
// 故多源防御取值。取不到返回 ""，调用方退化为正则判别（当前行为，不破坏）。
export function readEventPlatform(e = {}) {
  return String(
    e?.self?.platform
    || e?.platform
    || e?.bot?.adapter?.platform
    || e?.bot?.platform
    || ""
  )
}

function qqAvatarUrl(id) {
  return `https://q1.qlogo.cn/g?b=qq&nk=${String(id)}&s=640`
}

// 头像地址：platform==='qq' → qlogo URL；微信/非QQ/空 id 拿不到真实头像，
//           → 回退到角色立绘（优先使用调用方显式传入的 fallback，否则随机一张；库为空则空串）。
// 该回退逻辑内聚在 account.js（未跟踪文件，git pull 不丢），调用方无需改动即可获得「角色头像」兜底。
export function accountAvatar(id, platform, fallback = "") {
  if (platform === "qq") return qqAvatarUrl(id)
  // 微信：优先用适配器缓存里的真实头像（wx.avatar）；拿不到再回退角色立绘
  const real = lookupAvatarUrl(id)
  if (real) return real
  // 非QQ id / 空 id：回退到角色立绘作为头像
  if (platform === "wechat" || !isQQAccount(id)) return fallback || getRandomCharacter() || ""
  return qqAvatarUrl(id)
}

// 昵称回退标签：platform==='wechat' → 原始 id（无前缀）；platform==='qq' 或回退正则判 QQ
// →「账号 <id>」。当 profile.user.nickname 已存在时，调用方不应使用此回退。
export function accountLabel(id, platform) {
  const s = String(id || "")
  if (platform === "wechat") return s
  if (platform === "qq") return `账号 ${s}`
  if (!isQQAccount(s)) return s
  return `账号 ${s}`
}

// ---------------- 微信(ComWeChat) 昵称 / 头像解析 ----------------
// 微信的消息事件不带昵称，但适配器（app/plugins/adapter/ComWeChat.js）启动时会全量拉好：
//   bot.fl  : Map<userId, friendInfo>              ← get_friend_list，nickname = user_remark|user_displayname|user_name
//   bot.gml : Map<groupId, Map<userId, memberInfo>> ← get_group_member_list，nickname = nickname|name|user_remark|user_displayname
// 因此这里按 id（可选群）就能解析出真实昵称与头像，无需再等消息事件带 sender。
const nicknameCache = new Map()
const avatarCache = new Map()

function looseGet(map, id) {
  if (!(map instanceof Map)) return null
  const s = String(id || "")
  return map.get(s) ?? map.get(Number(s)) ?? null
}

function cleanNick(v) {
  const s = String(v ?? "").trim()
  return s && s !== "null" && s !== "undefined" ? s : ""
}

// 解析昵称：好友表 → 群成员表（任意群命中即可）。取不到返回 ""。
export function lookupNickname(id) {
  const s = String(id || "")
  if (!s) return ""
  if (nicknameCache.has(s)) return nicknameCache.get(s)
  const bot = globalThis.Bot
  let nick = cleanNick(looseGet(bot?.fl, s)?.nickname)
  if (!nick && bot?.gml instanceof Map) {
    for (const members of bot.gml.values()) {
      const m = looseGet(members, s)
      const n = cleanNick(m?.nickname || m?.name)
      if (n) { nick = n; break }
    }
  }
  if (nick) nicknameCache.set(s, nick)
  return nick
}

// 解析真实头像 URL（适配器条目里的 wx.avatar），仅接受 http(s)。
export function lookupAvatarUrl(id) {
  const s = String(id || "")
  if (!s) return ""
  if (avatarCache.has(s)) return avatarCache.get(s)
  const bot = globalThis.Bot
  const cands = [looseGet(bot?.fl, s)]
  if (bot?.gml instanceof Map) {
    for (const members of bot.gml.values()) {
      const m = looseGet(members, s)
      if (m) cands.push(m)
    }
  }
  let url = ""
  for (const c of cands) {
    const u = c?.["wx.avatar"] || c?.avatar
    if (u && /^https?:\/\//i.test(String(u))) { url = String(u); break }
  }
  if (url) avatarCache.set(s, url)
  return url
}

// 卡片身份行统一入口：真实昵称 > 调用方显式昵称 > 平台标签。
// 例：微信 `accountDisplay("wxid_x")` → "旅人"；解析不到 → "wxid_x"（不再出现「QQ 」前缀）。
export function accountDisplay(id, platform, nickname = "") {
  return cleanNick(nickname) || lookupNickname(id) || accountLabel(id, platform)
}

// 手动预热/回写缓存（扫码登录、#同步账号 等已拿到昵称的场景调用）
export function rememberNickname(id, nickname) {
  const s = String(id || "")
  const n = cleanNick(nickname)
  if (s && n) nicknameCache.set(s, n)
  return n
}
