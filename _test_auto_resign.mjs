// 自动补签 dryRun 自检：不执行真实签到、不写盘
// 1) 黑名单单元测试  2) 对 2026-10-26（2 个登录失效）与 2026-10-22（safe-delete 类）计划做 dryRun
import { isRetryableFailure, AutoResignService } from './services/checkin/autoResign.js'
import { loadGlobalConfig } from './core/config/global.js'
import { SchedulerService } from './core/scheduler/service.js'

const cases = [
  ['登录状态失效，请重新登录', false],
  ['profile 尚未保存 cookie，无法执行签到。', false],
  ['请先使用 #扫码登录 绑定当前 profile。', false],
  ['原神签到已被管理员全局关闭。', false],
  ['[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] ...', true],
  ['MihoyoBBSTools 执行超时（180000ms 未结束）', true],
  ['网络请求失败 ECONNRESET', true],
  ['', true],
]
let pass = 0
for (const [msg, expected] of cases) {
  const got = isRetryableFailure(msg)
  const ok = got === expected
  if (ok) pass++
  console.log(`${ok ? 'PASS' : 'FAIL'} [${msg.slice(0, 30)}] -> retryable=${got}`)
}
console.log(`blacklist: ${pass}/${cases.length}`)

const config = await loadGlobalConfig()
const scheduler = new SchedulerService({ config: config.scheduler })
const svc = new AutoResignService({ scheduler, signin: { run: async () => { throw new Error('dryRun 不应执行签到') } } })

for (const date of ['2026-10-26', '2026-10-22']) {
  const r = await svc.run({ config, date, dryRun: true })
  console.log(`\ndryRun ${date}: candidates=${r.candidates} skipped=${r.skipped}`)
  for (const item of r.results) {
    console.log(`  retry -> ${item.qq} p${item.profileId}: ${item.message.slice(0, 50)}`)
  }
}
