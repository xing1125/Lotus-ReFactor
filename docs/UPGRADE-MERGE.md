# Lotus-Plugin 上游升级：合并不覆盖（Merge, not Overwrite）

> 本文件是荷花插件「自维护 + 保留自制功能」的升级操作规范。
> 每次上游发新版本时，**必须按本流程合并**，禁止整包覆盖 live 插件。

## 一、现状基线

| 项 | 值 |
| --- | --- |
| live 所基于的上游提交（BASE） | `349e1c4`（2026-10-13 "Fall back to CPU when hardware card rendering is unavailable"） |
| 上游远程 | `https://github.com/MOPELotus/Lotus-ReFactor.git`（本机经 `gitclone.com` 代理只读拉取） |
| 评估克隆目录 | `D:\yunzai-yingbot\lotus-upstream-eval` |
| live 插件目录 | `D:\yunzai-yingbot\Yunzai\app\plugins\Lotus-Plugin` |
| 备份 `.git` | `D:\yunzai-yingbot\备份\Lotus-Plugin.git.bak.20260902-004855` |
| 我方自制文件 | **37 个**（永不覆盖，脚本自动推导） |
| 我方改过的上游文件 | **43 个**（升级时三方合并，脚本自动推导） |
| 清单文件 | `docs/upgrade-protected.json`（每次跑脚本自动重写，比本文件更权威） |

> 数字随开发增长，**不要手抄**——跑一次 `node scripts/upgrade-plan.mjs` 看 `docs/upgrade-protected.json`。

## 二、红线（务必遵守）

- **禁止在 live 目录执行 `git pull / merge / reset / checkout`**。live 的 `.git` 停在旧基线 `ace01d6`（2026-06-28），与工作树严重不一致，任何 git 合并操作都会覆盖荷花自制功能。
- 所有上游动作（fetch / 查看 / 取版本）**只在评估克隆 `lotus-upstream-eval` 内进行**。
- 升级采用「逐文件分类」：能自动 COPY 的 COPY，需要 MERGE 的三方合并，自制的一律 PROTECT。
- 改完必须 `node --check` + 冷重启 Yunzai。

## 三、标准升级流程

```bash
# 1) 拉取上游最新（在评估克隆里）
cd D:/yunzai-yingbot/lotus-upstream-eval
git fetch origin
git log --oneline -8 origin/main          # 看有哪些新提交

# 2) 生成升级计划（预演，不改任何文件）
cd D:/yunzai-yingbot/Yunzai/app/plugins/Lotus-Plugin
node scripts/upgrade-plan.mjs --base 349e1c4 --target origin/main
#    → 产出 docs/upgrade-plan.md（人类可读） + docs/upgrade-protected.json（机器可读）
#    → 预演阶段就会执行 COPY 铁闸预检，提前暴露风险

# 3) 审阅 docs/upgrade-plan.md：
#    - 「⛔ 需人工」有吗？有就先解决，否则 --apply 会被中止
#    - MERGE 清单与冲突项合理吗？

# 4) 执行合并（自动备份 → 自动 COPY + 三方 MERGE；PROTECT 自动跳过）
node scripts/upgrade-plan.mjs --base 349e1c4 --target origin/main --apply

# 5) 若报 *.conflict：人工解冲突 → 保存 → 删除 .conflict 文件

# 6) 校验
node --check <改动的每个 .js>

# 7) 冷重启 Yunzai
```

## 四、分类语义

| 动作 | 触发条件 | 处理 |
| --- | --- | --- |
| **COPY** | 上游改过、我方没碰 | 取上游新版（落盘前仍过铁闸，见第五节） |
| **MERGE** | 双方都改过 | 三方合并：base=旧上游版本、ours=live 文件、theirs=新上游版本 |
| **PROTECT** | 荷花自制文件（BASE 里不存在） | 永不覆盖，保持原样 |
| **冲突** | 上游新增了与我方自制同名的文件 / 上游删除了我方改过的文件 / 铁闸预检不通过 | 报告 → 人工决策 |

三方合并用 `git merge-file -p <ours> <base> <theirs>`；有冲突标记时写出 `<file>.conflict` 交人工处理，**不会静默丢弃任何一方**。

## 五、覆盖保护铁闸（v2 加固）★

v1 只靠「分类正确」来保命；v2 在此之上加了三道**不依赖分类正确性**的硬保证：

1. **COPY 落盘前内容校验（铁闸本体）**
   任何 COPY 要写/删一个 live 已存在的文件之前，先比对 `live` 与 `BASE` 的内容。
   - 允许 ⟺ live 无此文件（补入不覆盖任何东西）**或** live 与 BASE 完全一致（= 我方确实没碰过）
   - 只要 `live ≠ BASE`（= 我方改过）→ **拒绝落盘**，记为冲突交人工
   - 预检不通过时 `--apply` **整体中止（退出码 2），一个文件都不改**
   → 「静默覆盖我方改动」在结构上不可能发生，即使分类逻辑有 bug 也兜得住。

2. **全量「我方文件」识别（补盲区）**
   v1 只扫 `apps/ core/ services/ config/` + 3 个根文件；
   v2 改为对上游 BASE 的**全部跟踪文件**逐一比对，因此
   `docs/**`、`.gitignore`、`README.md`、`pnpm-lock.yaml`、`python/**` 等
   我方改动同样会被识别为 MERGE，不再有「改了却没登记、于是被上游覆盖」的盲区。

3. **`--apply` 前自动备份**
   将被改动的文件复制到 `.workbuddy/upgrade-backup/<时间戳>/`（含 `MANIFEST.json`）。
   出任何问题，把该目录内容覆盖回 live 即可回滚。可用 `--no-backup` 关闭（不建议）。

4. **偏安全地处理「无法比对」**
   评估克隆是部分克隆（`--filter=blob:none`），个别 BASE blob 本地可能没有。
   这类文件一律进 `uncomparable` 清单并**转人工确认**，绝不会被自动覆盖 —— 宁可少合，不可误覆盖。

> 沙箱验证（2026-10-17）：合成仓库覆盖 5 种情形全部符合预期 ——
> 双方都改→冲突保留我方；我方未改→取上游；**上游删除+我方改过→不删，转人工**；
> 自制撞名→保留我方；上游新增→补入。另验证「人为删掉 BASE blob 制造分类漏判」时，
> `--apply` 被铁闸整体中止且未动任何文件。

## 六、我方文件清单（自动生成，不要手抄）

跑 `node scripts/upgrade-plan.mjs` 后看：

- `docs/upgrade-protected.json` — 机器可读，含 `selfBuilt` / `modified` / `uncomparable` 三个数组
- `docs/upgrade-plan.md` — 人类可读，含本次升级的逐文件动作表

分类要点（供人工复核）：

- **自制（PROTECT）**：`apps/{adminCheckin,allGroupReset,checkinRoster,checkinStats,checkinThrottle,genshinAbyss,genshinChallenge,genshinSync,globalCheckin,groupDeploy,resignCheckin,schedulerWindow,starRailChallenge,taptap,weibo}.js`；`core/characterArt.js`、`core/config/modules.js`、`core/render/{theme,daily-note,team-damage,genshin-abyss}.js`；`services/checkin/{account,roster,statsBuilder}.js`、`services/genshinAbyss/service.js`、`services/genshinBridge/reverseSync.js`、`services/{taptap,weibo,bilibili/transcode}/*` 等。
- **改过的上游文件（MERGE）**：`core/render/source-cards.js`（主题/玻璃层级基元）、`core/render/starrail-abyss.js`、`core/render/atlas-pages.js`、`core/render/skia.js`、`apps/help.js`（帮助菜单全功能）、`apps/{bilibili,checkin,checkinAdmin,dailyNote,gachaLog,login,panelUpdate,profile,profileQuery,remote,scheduler}.js`、`index.js`、`guoba.support.js`、`core/config/{defaults,schema}.js`、`core/intercept/personal-query.js`、`docs/**` 等。

## 七、升级后的收尾

1. 把本文件第一节的 **BASE 更新为本次的 TARGET 提交号**。
2. 同步更新 `.workbuddy/memory/MEMORY.md` 的「git 状态」小节。
3. `docs/upgrade-plan.md` / `docs/upgrade-protected.json` 每次跑脚本自动重写，无需手维护。
