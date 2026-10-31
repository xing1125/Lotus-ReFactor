// 单用户 runner 计时拆解：保留工作目录，输出事件时间线，定位耗时大头
import { loadProfile } from "./core/config/profile.js"
import { MihoyoBbsToolsRunner } from "./services/mihoyoBbsTools/runner.js"
import { prepareRunnableProfile } from "./services/checkin/profileSignin.js"

const qq = process.argv[2]
const profileId = Number(process.argv[3] || 1)

const profile = await loadProfile(qq, profileId)
if (!profile) {
  console.error("profile not found")
  process.exit(1)
}

const t0 = Date.now()
const runner = new MihoyoBbsToolsRunner({})
let result
try {
  result = await runner.runProfile(prepareRunnableProfile(profile), {
    keepWorkDir: true,
    installRequirements: false,
  })
} catch (error) {
  console.error("FAILED:", error.message)
  if (error.stderr) console.error("--- python stderr ---\n" + error.stderr)
  process.exit(2)
}
const cost = Date.now() - t0

console.log("totalMs  :", cost)
console.log("ok       :", result.ok)
console.log("workDir  :", result.workDir)

let prev = t0
for (const ev of result.events || []) {
  const ts = Date.parse(String(ev.time || "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))
  const at = Number.isFinite(ts) ? ts : prev
  console.log(
    `+${String(at - prev).padStart(6)}ms  T+${String(at - t0).padStart(6)}ms  ${ev.stage || "-"}  ${String(ev.message || "").slice(0, 60)}`,
  )
  prev = at
}
console.log(`+${String(Date.now() - prev).padStart(6)}ms  (收尾)`)
console.log("message  :", String(result.message || "").replace(/\n+/g, " | ").slice(0, 200))
