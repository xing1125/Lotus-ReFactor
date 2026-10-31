// 单用户签到冒烟：验证重启后打码链路是否恢复（会真的执行签到）
import { ProfileSigninService } from "./services/checkin/profileSignin.js"

const qq = process.argv[2]
const profileId = Number(process.argv[3] || 1)

const svc = new ProfileSigninService({ render: false })
const startedAt = Date.now()
const outcome = await svc.run({ qq, profileId, refresh: false })

console.log("ok       :", outcome.ok)
console.log("stage    :", outcome.stage)
console.log("costMs   :", Date.now() - startedAt)
console.log("message  :", String(outcome.message || "").replace(/\n+/g, " | ").slice(0, 300))
if (outcome.error) console.log("error    :", String(outcome.error.message || outcome.error).slice(0, 200))
