# Lotus-Plugin 升级合并计划

- 基线 BASE: `349e1c4`  →  目标 TARGET: `origin/main`
- 生成时间: 2026-10-17T00:05:07.884Z
- 上游改动文件: **0**  →  COPY 0 · MERGE 0 · PROTECT 0
- 我方文件合计: **80**（自制 37 · 改过的上游文件 43）
- 覆盖保护: 被拦下的 COPY **0** 个（无风险）

> 上游自 BASE 起无源码改动（已是最新）。

## 受保护的自制文件（升级时永不覆盖，37 个）

- `apps/adminCheckin.js`
- `apps/allGroupReset.js`
- `apps/checkinRoster.js`
- `apps/checkinStats.js`
- `apps/checkinThrottle.js`
- `apps/genshinAbyss.js`
- `apps/genshinChallenge.js`
- `apps/genshinSync.js`
- `apps/globalCheckin.js`
- `apps/groupDeploy.js`
- `apps/resignCheckin.js`
- `apps/schedulerWindow.js`
- `apps/starRailChallenge.js`
- `apps/taptap.js`
- `apps/weibo.js`
- `core/characterArt.js`
- `core/config/modules.js`
- `core/render/daily-note.js`
- `core/render/genshin-abyss.js`
- `core/render/team-damage.js`
- `core/render/theme.js`
- `docs/UPGRADE-MERGE.md`
- `docs/crystal-mist-plan.md`
- `docs/plan-upstream-ui-port.md`
- `services/bilibili/transcode.js`
- `services/checkin/account.js`
- `services/checkin/roster.js`
- `services/checkin/statsBuilder.js`
- `services/genshinAbyss/service.js`
- `services/genshinBridge/reverseSync.js`
- `services/taptap/browser.js`
- `services/taptap/config.js`
- `services/taptap/eventResolver.js`
- `services/taptap/service.js`
- `services/taptap/signer.js`
- `services/weibo/api.js`
- `services/weibo/service.js`

## 我方改过的上游文件（升级时三方合并，保留我方改动，43 个）

> 这些文件上游存在、我方也改过。升级时**绝不整包覆盖**：走 `git merge-file` 三方合并；
> 冲突则落盘为 `<文件>.conflict` 交人工，且 COPY 前还有内容校验兜底，我方改动不会静默丢失。

- `.gitignore`
- `README.md`
- `apps/achievements.js`
- `apps/bilibili.js`
- `apps/checkin.js`
- `apps/checkinAdmin.js`
- `apps/dailyNote.js`
- `apps/gachaLog.js`
- `apps/genshinTeamDamage.js`
- `apps/help.js`
- `apps/login.js`
- `apps/panelUpdate.js`
- `apps/profile.js`
- `apps/profileQuery.js`
- `apps/remote.js`
- `apps/scheduler.js`
- `apps/starRailTeamDamage.js`
- `config/global.example.yaml`
- `core/captcha/notify.js`
- `core/config/defaults.js`
- `core/config/schema.js`
- `core/intercept/personal-query.js`
- `core/mihoyo/starrailCharacters.js`
- `core/render/atlas-pages.js`
- `core/render/skia.js`
- `core/render/source-cards.js`
- `core/render/starrail-abyss.js`
- `core/transport/notify.js`
- `docs/README.md`
- `docs/atlas.md`
- `docs/bilibili.md`
- `docs/commands.md`
- `docs/features/challenge-query.md`
- `docs/features/gacha-log.md`
- `docs/features/netease-partner.md`
- `docs/remote-spawn.md`
- `guoba.support.js`
- `index.js`
- `services/bilibili/service.js`
- `services/checkin/profileSignin.js`
- `services/checkin/scheduled.js`
- `services/nanokaAtlas/service.js`
- `services/starRailChallenge/service.js`