# Lotus-Plugin 升级合并计划

- 基线 BASE: `349e1c4`  →  目标 TARGET: `origin/main`
- 生成时间: 2026-10-31T15:45:26.516Z
- 上游改动文件: **35**  →  COPY 25 · MERGE 10 · PROTECT 0
- 我方文件合计: **291**（自制 226 · 改过的上游文件 65）
- 覆盖保护: 被拦下的 COPY **0** 个（无风险）

| 动作 | 类型 | 文件 | 说明 |
| --- | --- | --- | --- |
| 取上游 | `M` | `MihoyoBBSTools` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 三方合并 | `M` | `README.md` | 双方都改 → 三方合并 |
| 取上游 | `A` | `apps/coinShop.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `apps/redeemCodes.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 三方合并 | `M` | `config/global.example.yaml` | 双方都改 → 三方合并 |
| 三方合并 | `M` | `core/config/defaults.js` | 双方都改 → 三方合并 |
| 取上游 | `M` | `core/config/global.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 三方合并 | `M` | `core/config/schema.js` | 双方都改 → 三方合并 |
| 三方合并 | `M` | `core/intercept/priority.js` | 双方都改 → 三方合并 |
| 三方合并 | `M` | `core/transport/notify.js` | 双方都改 → 三方合并 |
| 三方合并 | `M` | `docs/README.md` | 双方都改 → 三方合并 |
| 三方合并 | `M` | `docs/bilibili.md` | 双方都改 → 三方合并 |
| 三方合并 | `M` | `docs/commands.md` | 双方都改 → 三方合并 |
| 取上游 | `M` | `docs/features/README.md` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `docs/features/coin-shop.md` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `docs/features/redeem-codes.md` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `M` | `docs/features/tools.md` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 三方合并 | `M` | `index.js` | 双方都改 → 三方合并 |
| 取上游 | `M` | `nanoka-atlas-backend` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `M` | `package.json` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/coinShop/client.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/coinShop/service.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/coinShop/store.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/coinShop/tracking.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/coinShop/web.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/coinShop/web/app.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/coinShop/web/index.html` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/coinShop/web/style.css` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `M` | `services/media/files.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/redeemCodes/games.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/redeemCodes/http.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/redeemCodes/official.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/redeemCodes/service.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `M` | `services/tools/installer.js` | 上游改动、我方未改 → 取上游（仍要过校验） |
| 取上游 | `A` | `services/tools/startup.js` | 上游改动、我方未改 → 取上游（仍要过校验） |

## 受保护的自制文件（升级时永不覆盖，226 个）

- `_probe_env.py`
- `_route_rules.json`
- `apps/adminCheckin.js`
- `apps/allGroupReset.js`
- `apps/checkinDashboard.js`
- `apps/checkinRoster.js`
- `apps/checkinStats.js`
- `apps/checkinThrottle.js`
- `apps/genshinAbyss.js`
- `apps/genshinChallenge.js`
- `apps/genshinSync.js`
- `apps/globalCheckin.js`
- `apps/groupDeploy.js`
- `apps/luluPlaoToken.js`
- `apps/resignCheckin.js`
- `apps/schedulerWindow.js`
- `apps/starRailChallenge.js`
- `apps/taptap.js`
- `apps/weibo.js`
- `core/captcha/providers/luluPlao.js`
- `core/characterArt.js`
- `core/checkinLog.js`
- `core/config/modules.js`
- `core/render/daily-note.js`
- `core/render/genshin-abyss.js`
- `core/render/team-damage.js`
- `core/render/theme.js`
- `docs/UPGRADE-MERGE.md`
- `docs/crystal-mist-plan.md`
- `docs/plan-upstream-ui-port.md`
- `docs/route-conflict-audit-2026-10-21.md`
- `guoba.actions.js`
- `nk-cache/UI_EquipIcon_Bow_Windtalker.webp`
- `nk-cache/UI_EquipIcon_Catalyst_Bludnye.webp`
- `nk-cache/UI_EquipIcon_Catalyst_Chernaya.webp`
- `nk-cache/UI_EquipIcon_Catalyst_FrostScepter.webp`
- `nk-cache/UI_EquipIcon_Claymore_CrystallineSword.webp`
- `nk-cache/UI_EquipIcon_Sword_Fajian.webp`
- `nk-cache/UI_EquipIcon_Sword_Samosvist.webp`
- `nk-cache/UI_EquipIcon_Sword_SpikedStake.webp`
- `nk-cache/UI_EquipIcon_Sword_Swanlake.webp`
- `nk-cache/UI_EquipIcon_Sword_WeaponQuestSnezhnaya.webp`
- `nk-cache/UI_ItemIcon_112032.webp`
- `nk-cache/UI_ItemIcon_112033.webp`
- `nk-cache/UI_ItemIcon_112034.webp`
- `nk-cache/UI_ItemIcon_112041.webp`
- `nk-cache/UI_ItemIcon_112042.webp`
- `nk-cache/UI_ItemIcon_112043.webp`
- `nk-cache/UI_ItemIcon_112125.webp`
- `nk-cache/UI_ItemIcon_112126.webp`
- `nk-cache/UI_ItemIcon_112127.webp`
- `nk-cache/UI_ItemIcon_112143.webp`
- `nk-cache/UI_ItemIcon_112144.webp`
- `nk-cache/UI_ItemIcon_112145.webp`
- `nk-cache/UI_ItemIcon_112146.webp`
- `nk-cache/UI_ItemIcon_112147.webp`
- `nk-cache/UI_ItemIcon_112148.webp`
- `nk-cache/UI_ItemIcon_112149.webp`
- `nk-cache/UI_ItemIcon_112150.webp`
- `nk-cache/UI_ItemIcon_112151.webp`
- `nk-cache/UI_ItemIcon_112152.webp`
- `nk-cache/UI_ItemIcon_112153.webp`
- `nk-cache/UI_ItemIcon_112154.webp`
- `nk-cache/UI_ItemIcon_112155.webp`
- `nk-cache/UI_ItemIcon_112156.webp`
- `nk-cache/UI_ItemIcon_112157.webp`
- `nk-cache/UI_ItemIcon_112158.webp`
- `nk-cache/UI_ItemIcon_112159.webp`
- `nk-cache/UI_ItemIcon_112160.webp`
- `nk-cache/UI_ItemIcon_114021.webp`
- `nk-cache/UI_ItemIcon_114022.webp`
- `nk-cache/UI_ItemIcon_114023.webp`
- `nk-cache/UI_ItemIcon_114081.webp`
- `nk-cache/UI_ItemIcon_114082.webp`
- `nk-cache/UI_ItemIcon_114083.webp`
- `nk-cache/UI_ItemIcon_114084.webp`
- `nk-cache/UI_ItemIcon_114085.webp`
- `nk-cache/UI_ItemIcon_114086.webp`
- `nk-cache/UI_ItemIcon_114087.webp`
- `nk-cache/UI_ItemIcon_114089.webp`
- `nk-cache/UI_ItemIcon_114090.webp`
- `nk-cache/UI_ItemIcon_114091.webp`
- `nk-cache/UI_ItemIcon_114093.webp`
- `nk-cache/UI_ItemIcon_114094.webp`
- `nk-cache/UI_ItemIcon_114095.webp`
- `nk-cache/UI_RelicIcon_10002_1.webp`
- `nk-cache/UI_RelicIcon_10002_2.webp`
- `nk-cache/UI_RelicIcon_10002_4.webp`
- `nk-cache/UI_RelicIcon_10002_5.webp`
- `nk-cache/UI_RelicIcon_10008_1.webp`
- `nk-cache/UI_RelicIcon_10008_2.webp`
- `nk-cache/UI_RelicIcon_10008_3.webp`
- `nk-cache/UI_RelicIcon_10008_4.webp`
- `nk-cache/UI_RelicIcon_10008_5.webp`
- `nk-cache/UI_RelicIcon_14001_1.webp`
- `nk-cache/UI_RelicIcon_14001_2.webp`
- `nk-cache/UI_RelicIcon_14001_3.webp`
- `nk-cache/UI_RelicIcon_14001_4.webp`
- `nk-cache/UI_RelicIcon_14001_5.webp`
- `nk-cache/UI_RelicIcon_14003_1.webp`
- `nk-cache/UI_RelicIcon_14003_2.webp`
- `nk-cache/UI_RelicIcon_14003_3.webp`
- `nk-cache/UI_RelicIcon_14003_4.webp`
- `nk-cache/UI_RelicIcon_14003_5.webp`
- `nk-cache/UI_RelicIcon_14004_1.webp`
- `nk-cache/UI_RelicIcon_14004_2.webp`
- `nk-cache/UI_RelicIcon_14004_4.webp`
- `nk-cache/UI_RelicIcon_14004_5.webp`
- `nk-cache/UI_RelicIcon_15001_1.webp`
- `nk-cache/UI_RelicIcon_15001_2.webp`
- `nk-cache/UI_RelicIcon_15001_3.webp`
- `nk-cache/UI_RelicIcon_15001_4.webp`
- `nk-cache/UI_RelicIcon_15001_5.webp`
- `nk-cache/UI_RelicIcon_15002_1.webp`
- `nk-cache/UI_RelicIcon_15002_2.webp`
- `nk-cache/UI_RelicIcon_15002_3.webp`
- `nk-cache/UI_RelicIcon_15002_4.webp`
- `nk-cache/UI_RelicIcon_15002_5.webp`
- `nk-cache/UI_RelicIcon_15005_1.webp`
- `nk-cache/UI_RelicIcon_15005_2.webp`
- `nk-cache/UI_RelicIcon_15005_3.webp`
- `nk-cache/UI_RelicIcon_15005_4.webp`
- `nk-cache/UI_RelicIcon_15005_5.webp`
- `nk-cache/UI_RelicIcon_15006_1.webp`
- `nk-cache/UI_RelicIcon_15006_2.webp`
- `nk-cache/UI_RelicIcon_15006_3.webp`
- `nk-cache/UI_RelicIcon_15006_4.webp`
- `nk-cache/UI_RelicIcon_15006_5.webp`
- `nk-cache/UI_RelicIcon_15009_3.webp`
- `nk-cache/UI_RelicIcon_15010_3.webp`
- `nk-cache/UI_RelicIcon_15011_3.webp`
- `nk-cache/UI_RelicIcon_15013_3.webp`
- `nk-cache/UI_RelicIcon_15016_1.webp`
- `nk-cache/UI_RelicIcon_15016_2.webp`
- `nk-cache/UI_RelicIcon_15016_5.webp`
- `nk-cache/UI_RelicIcon_15018_1.webp`
- `nk-cache/UI_RelicIcon_15018_2.webp`
- `nk-cache/UI_RelicIcon_15018_3.webp`
- `nk-cache/UI_RelicIcon_15018_4.webp`
- `nk-cache/UI_RelicIcon_15018_5.webp`
- `nk-cache/UI_RelicIcon_15021_1.webp`
- `nk-cache/UI_RelicIcon_15021_2.webp`
- `nk-cache/UI_RelicIcon_15021_3.webp`
- `nk-cache/UI_RelicIcon_15021_4.webp`
- `nk-cache/UI_RelicIcon_15021_5.webp`
- `nk-cache/UI_RelicIcon_15022_1.webp`
- `nk-cache/UI_RelicIcon_15022_2.webp`
- `nk-cache/UI_RelicIcon_15022_3.webp`
- `nk-cache/UI_RelicIcon_15022_4.webp`
- `nk-cache/UI_RelicIcon_15022_5.webp`
- `nk-cache/UI_RelicIcon_15023_1.webp`
- `nk-cache/UI_RelicIcon_15023_2.webp`
- `nk-cache/UI_RelicIcon_15023_3.webp`
- `nk-cache/UI_RelicIcon_15023_4.webp`
- `nk-cache/UI_RelicIcon_15023_5.webp`
- `nk-cache/UI_RelicIcon_15030_1.webp`
- `nk-cache/UI_RelicIcon_15030_2.webp`
- `nk-cache/UI_RelicIcon_15030_3.webp`
- `nk-cache/UI_RelicIcon_15030_4.webp`
- `nk-cache/UI_RelicIcon_15030_5.webp`
- `nk-cache/UI_RelicIcon_15032_1.webp`
- `nk-cache/UI_RelicIcon_15032_2.webp`
- `nk-cache/UI_RelicIcon_15032_3.webp`
- `nk-cache/UI_RelicIcon_15032_4.webp`
- `nk-cache/UI_RelicIcon_15032_5.webp`
- `nk-cache/UI_RelicIcon_15034_1.webp`
- `nk-cache/UI_RelicIcon_15034_2.webp`
- `nk-cache/UI_RelicIcon_15034_3.webp`
- `nk-cache/UI_RelicIcon_15034_4.webp`
- `nk-cache/UI_RelicIcon_15034_5.webp`
- `nk-cache/UI_RelicIcon_15038_1.webp`
- `nk-cache/UI_RelicIcon_15038_2.webp`
- `nk-cache/UI_RelicIcon_15038_3.webp`
- `nk-cache/UI_RelicIcon_15038_4.webp`
- `nk-cache/UI_RelicIcon_15038_5.webp`
- `nk-cache/UI_RelicIcon_15042_1.webp`
- `nk-cache/UI_RelicIcon_15042_2.webp`
- `nk-cache/UI_RelicIcon_15042_3.webp`
- `nk-cache/UI_RelicIcon_15042_4.webp`
- `nk-cache/UI_RelicIcon_15042_5.webp`
- `nk-cache/UI_RelicIcon_15043_1.webp`
- `nk-cache/UI_RelicIcon_15043_2.webp`
- `nk-cache/UI_RelicIcon_15043_3.webp`
- `nk-cache/UI_RelicIcon_15043_4.webp`
- `nk-cache/UI_RelicIcon_15043_5.webp`
- `nk-cache/UI_RelicIcon_15044_1.webp`
- `nk-cache/UI_RelicIcon_15044_2.webp`
- `nk-cache/UI_RelicIcon_15044_3.webp`
- `nk-cache/UI_RelicIcon_15044_4.webp`
- `nk-cache/UI_RelicIcon_15044_5.webp`
- `nk-cache/UI_RelicIcon_15047_1.webp`
- `nk-cache/UI_RelicIcon_15047_2.webp`
- `nk-cache/UI_RelicIcon_15047_3.webp`
- `nk-cache/UI_RelicIcon_15047_4.webp`
- `nk-cache/UI_RelicIcon_15047_5.webp`
- `nk-cache/w-11437.json`
- `nk-cache/w-11438.json`
- `nk-cache/w-11520.json`
- `nk-cache/w-11521.json`
- `nk-cache/w-11522.json`
- `nk-cache/w-12516.json`
- `nk-cache/w-14437.json`
- `nk-cache/w-14524.json`
- `nk-cache/w-14525.json`
- `nk-cache/w-15437.json`
- `nk-w7.0.json`
- `nk-w7.1.json`
- `python/__pycache__/lotus_bbs_runner.cpython-313.pyc`
- `services/bilibili/relay.js`
- `services/bilibili/transcode.js`
- `services/checkin/account.js`
- `services/checkin/autoResign.js`
- `services/checkin/roster.js`
- `services/checkin/statsBuilder.js`
- `services/dailyNote/push.js`
- `services/genshinAbyss/service.js`
- `services/genshinBridge/load.js`
- `services/genshinBridge/reverseSync.js`
- `services/nanokaAtlas/guide-cards.js`
- `services/taptap/browser.js`
- `services/taptap/config.js`
- `services/taptap/eventResolver.js`
- `services/taptap/service.js`
- `services/taptap/signer.js`
- `services/weibo/api.js`
- `services/weibo/service.js`

## 我方改过的上游文件（升级时三方合并，保留我方改动，65 个）

> 这些文件上游存在、我方也改过。升级时**绝不整包覆盖**：走 `git merge-file` 三方合并；
> 冲突则落盘为 `<文件>.conflict` 交人工，且 COPY 前还有内容校验兜底，我方改动不会静默丢失。

- `.gitignore`
- `README.md`
- `apps/achievements.js`
- `apps/atlas.js`
- `apps/bilibili.js`
- `apps/checkin.js`
- `apps/checkinAdmin.js`
- `apps/dailyNote.js`
- `apps/device.js`
- `apps/douyin.js`
- `apps/gachaLog.js`
- `apps/genshinTeamDamage.js`
- `apps/help.js`
- `apps/login.js`
- `apps/miaoCalendar.js`
- `apps/panelUpdate.js`
- `apps/profile.js`
- `apps/profileQuery.js`
- `apps/profileSettings.js`
- `apps/remote.js`
- `apps/scheduler.js`
- `apps/starRailTeamDamage.js`
- `config/global.example.yaml`
- `core/captcha/events.js`
- `core/captcha/http.js`
- `core/captcha/mysHandler.js`
- `core/captcha/notify.js`
- `core/captcha/providers/testNine.js`
- `core/captcha/service.js`
- `core/config/defaults.js`
- `core/config/profileSettings.js`
- `core/config/schema.js`
- `core/intercept/personal-query.js`
- `core/intercept/priority.js`
- `core/mihoyo/starrailCharacters.js`
- `core/render/atlas-pages.js`
- `core/render/image.js`
- `core/render/skia.js`
- `core/render/source-cards.js`
- `core/render/starrail-abyss.js`
- `core/transport/notify.js`
- `core/transport/reply.js`
- `docs/README.md`
- `docs/atlas.md`
- `docs/bilibili.md`
- `docs/commands.md`
- `docs/features/challenge-query.md`
- `docs/features/gacha-log.md`
- `docs/features/netease-partner.md`
- `docs/installation.md`
- `docs/remote-spawn.md`
- `guoba.support.js`
- `index.js`
- `python/lotus_bbs_runner.py`
- `services/bilibili/service.js`
- `services/checkin/profileSignin.js`
- `services/checkin/scheduled.js`
- `services/dailyNote/service.js`
- `services/genshinBridge/profile.js`
- `services/intercept/runtime.js`
- `services/mihoyoBbsTools/config.js`
- `services/mihoyoBbsTools/runner.js`
- `services/nanokaAtlas/service.js`
- `services/python/env.js`
- `services/starRailChallenge/service.js`