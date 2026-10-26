// 离线探针：notifyUser 的 onlyPrivate 语义（微信环境防群发事故）
// 1) onlyPrivate=true + 私聊失败 → 不进群兜底（否则微信下会把卡片 @ 群发到 bot 全部群）
// 2) 缺省（无 onlyPrivate）→ 私聊失败仍群兜底（notifyProfile fallback 语义保持不变）
// 3) onlyPrivate=true + 私聊可用 → 直达 private
globalThis.logger = { info() {}, warn() {}, error() {}, debug() {} }

const groupSent = []
globalThis.Bot = {
  pickGroup: id => ({ sendMsg: async () => { groupSent.push(id) } }),
  getGroupList: () => [123],
  gml: new Map([[123, new Map([["wxid_a", {}]])]]),
}

const { notifyUser } = await import("./core/transport/notify.js")

let failed = 0
const check = (name, ok, detail = "") => {
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`)
}

const strict = await notifyUser("wxid_a", "hi", { onlyPrivate: true })
check("onlyPrivate 私聊失败不进群", strict.ok === false && groupSent.length === 0, JSON.stringify({ strict: strict.reason, groupSent }))

const loose = await notifyUser("wxid_a", "hi", {})
check("缺省仍群兜底", loose.ok === true && loose.channel === "group" && groupSent.length === 1, JSON.stringify({ loose: loose.channel, groupSent }))

const okPriv = await notifyUser("wxid_a", "hi", {
  onlyPrivate: true,
  onlyKnownFriend: false,
  bot: { pickUser: () => ({ sendMsg: async () => {} }) },
})
check("私聊可用直达", okPriv.ok === true && okPriv.channel === "private")

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
