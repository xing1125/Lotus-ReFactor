// 离线探针：星铁挑战请求层修复（虚构叙事 invalid request 根因）
// 验证：1) 请求 URL 不含 isPrev/need_all；2) story/boss 带 time，chaos/peak 不带；
//       3) normalize 正确按 groups[time] 取周期 + floors；4) has_data=false 返回空结构不崩。
globalThis.logger = { info() {}, warn() {}, error() {}, debug() {} }

const { StarRailChallengeService } = await import("./services/starRailChallenge/service.js")

const captures = []
let failed = 0
const check = (name, ok, detail = "") => {
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`)
}

const storyJson = {
  retcode: 0,
  message: "OK",
  data: {
    has_data: true,
    star_num: 24,
    groups: { "0": { begin_time: { year: 2026, month: 10, day: 6 }, end_time: { year: 2026, month: 10, day: 20 } } },
    all_floor_detail: [
      { name: "第一关", score: 12000, star_num: 3, node_1: { score: 6000, avatars: [{ id: 8001 }] } },
      { name: "第二关", is_fast: true, score: 0 },
    ],
  },
}
const emptyJson = { retcode: 0, message: "OK", data: { has_data: false } }

const mkService = (json) => new StarRailChallengeService({
  fetch: async (url) => {
    captures.push(url)
    return { ok: true, status: 200, json: async () => json }
  },
})
const ctx = { uid: "100000001", server: "prod_gf_cn", isCn: true, cookie: "cookie", deviceFp: "fp", deviceId: "id", profile: {} }

// 1. story 本期：URL 不含 isPrev/need_all，含 time=0
captures.length = 0
let r = await mkService(storyJson).queryChallenge({ ...ctx, parsed: { kind: "story", last: false, recent: false } })
check("story 本期请求含 time=0", captures[0].includes("time=0"))
check("story 无 isPrev", !captures[0].includes("isPrev"))
check("story 无 need_all", !captures[0].includes("need_all"))
check("story 端点 challenge_story", captures[0].includes("challenge_story"))
check("story 周期解析正确", r.period.includes("2026.10.06"), r.period)
check("story 过滤 is_fast 关卡", r.floors.length === 1 && r.floors[0].title === "第一关", JSON.stringify(r.floors.map(f => f.title)))
check("story 星级", String(r.stars) === "24", String(r.stars))

// 2. story 上期：time=1，groups["1"]
captures.length = 0
const storyJson2 = JSON.parse(JSON.stringify(storyJson))
storyJson2.data.groups["1"] = { begin_time: { year: 2026, month: 9, day: 22 }, end_time: { year: 2026, month: 10, day: 6 } }
r = await mkService(storyJson2).queryChallenge({ ...ctx, parsed: { kind: "story", last: true, recent: false } })
check("story 上期请求含 time=1", captures[0].includes("time=1"))
check("story 上期取 groups[1] 周期", r.period.includes("2026.09.22"), r.period)

// 3. chaos 端点 challenge_chaos + 不带 time
captures.length = 0
r = await mkService(storyJson).queryChallenge({ ...ctx, parsed: { kind: "hall", last: false, recent: false } })
check("chaos 端点 challenge（非 challenge_chaos）", captures[0].includes("/hkrpg/api/challenge?") && !captures[0].includes("challenge_chaos"))
check("chaos 不带 time", !captures[0].includes("time="))

// 4. has_data=false → 空结构、不崩
r = await mkService(emptyJson).queryChallenge({ ...ctx, parsed: { kind: "story", last: false, recent: false } })
check("has_data=false 返回空结构", r.hasData === false && r.floors.length === 0)

// 5. boss 带 time
captures.length = 0
r = await mkService(storyJson).queryChallenge({ ...ctx, parsed: { kind: "boss", last: false, recent: false } })
check("boss 端点 challenge_boss", captures[0].includes("challenge_boss"))
check("boss 带 time=0", captures[0].includes("time=0"))

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
