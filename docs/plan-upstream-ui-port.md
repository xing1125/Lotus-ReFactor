# 队伍伤害 / 深渊面板 · 上游 UI 移植方案

> 目标：Lotus **自渲染**的队伍伤害与深渊面板，套用「各自对应上游插件」的版式，而不是当前的通用表格。

## 一、现状盘点（判断依据）

| 面板 | Lotus 触发 / 模板 | 当前渲染方 | 当前 UI | 真正对应的上游 | 差距 |
|---|---|---|---|---|---|
| 原神队伍伤害 | `#队伍伤害` → `genshin-team-damage` | Lotus 自渲染 `source-cards.js` `team()` | 主题化**通用表格**（概览表 + 角色表 + 面板属性表 + 伤害贡献表） | genshin `resources/Genshin/html/dmg/damage.html|.css`（数据源：提瓦特小助手） | **大** |
| 星铁队伍伤害 | `*队伍伤害` → `starrail-team-damage` | 同上（共用 `team()`） | 同上 + 战斗记录表 | 上游无独立 dmg 模板；沿用 genshin dmg 版式（数据侧有 `pie` / `actionTrack` / `battleRecords` / `damageLogs`） | **大** |
| 星铁深渊 | `*混沌` / `*忘却` / `*虚构` / `*末日` / `*异相` → `starrail-challenge` | Lotus 自渲染 `starrail-abyss.js` | 现版移植自 genshin 的 **`Genshin/html/abyss/abyss-floor`**（原神深境螺旋版式） | **ji-plugin** `resources/StarRail/html/abyss/abyss.html`（星铁命令归属方） | 中 |
| 原神深渊 | `#深渊` → `miaoAbyssSummary` | **委派 miao** | miao 上游自带（`resources/stat/abyss-summary`） | 同上 | 无（已是上游 UI） |
| 绝区零式舆防卫战 | `%深渊` → `zzzAbyss` | **委派 ZZZ-Plugin** | ZZZ 上游自带（`resources/abyss`） | 同上 | 无（已是上游 UI） |

**结论**：真正需要动的是 ① 队伍伤害（两游戏，差距最大）、② 星铁深渊（对齐 ji-plugin）。
原神深渊 / 绝区零深渊走委派，UI 本身就是上游的，**无需改**。

## 二、方案

样式底座保持不变：`DARK.*`（主题真源）/ `openPanel`（玻璃层级）/ `UI`（几何+字号 token）/ `fstr`（字重）。
**不引入 g2plot 等新依赖**——环形图用 Skia `arc` 自绘。

### A. 队伍伤害重构（`team()` → 专用版式）

上游 genshin `damage.html` 的信息块，逐块用 Skia 复刻：

1. **评级四宫格**（`.TopLeftPanel > .rank`）
   - UID 徽章（圆角高亮底）+ 2×2 指标：`伤害评级` / `DPS` / `输出轴长` / `输出总伤`。
   - 评级按档位上色（ACE / S / A / B / C）。数据：`renderData.summary` + `renderData.rank`。
2. **输出比例环形图**（`#pie`）
   - Skia 自绘 donut：`pie[].color` 逐段，中心显示总伤，右侧图例 `角色 · 伤害 · 占比`。
3. **角色卡**（`.Avatars > .avatar`）
   - 头像（按稀有度着色底）+ **命座徽章** + 等级
   - 武器（图标 / 名称 / `精N` / 等级）
   - 圣遗物套（图标 / 件数）
   - 关键属性：双爆（暴击 / 暴伤）+ 关键属性 + 充能（小环形）+ 同色球 / 异色球
   - 天赋图标行（含额外等级 `+N` 高亮）
   - 数据：`renderData.avatars[]`（rarity / level / cons / icon / face / keyProp / keyValue / weapon / stats / skills / relicSet / recharge）。
4. **操作手法**（`.Actions`）：指令 chip 流。数据：`renderData.actions`。
5. **伤害过程**（`.Damages`）：时间 / 动作 / 暴击伤害 / 未暴击伤害 / 期望伤害（仅 `detail`）。数据：`renderData.damages`。
6. **Buff 情况**（`.Buffs`）：时间 / 增益 / 说明（仅 `detail`）。数据：`renderData.buffs`。

星铁侧同一版式：角色卡用 SR 字段（命座=魂、光锥、遗器），把「伤害过程」换为**战斗记录轴**（`battleRecords`）并保留 `actionTrack` 起手序列。

### B. 星铁深渊对齐 ji-plugin

- 标题/星级对齐 ji-plugin：`ID:{uid}` / `忘却之庭·混沌回忆` / `star_num/36`。
- 每间：`{floor.name}` + 日期 + `使用轮：{round_num}`。
- 角色格：比例 52×68，`命N` 徽标（life1–6 分档色），`Lv.N` 条，右下 `fill` 角标。
- `split-text-1/2` 改「节点1 / 节点2」（现为「上半/下半」）；`star-box` 3 星（`nostar` 半透明）。
- 外层仍走 Lotus 主题（浅底主题不铺深色场景图）。

## 三、交付与验收

- **改动文件**：`core/render/source-cards.js`（`team()` 重构，或拆出新 `core/render/team-damage.js`）、`core/render/starrail-abyss.js`（对齐 ji-plugin）。
- **预览**：扩充 `_preview_render.mjs`（两游戏队伍伤害全字段）→ 9 主题全量截图；`_preview_atlas.mjs` 覆盖深渊。
- **回归**：`node --check` + 9 主题 × 模板 smoke + 记忆更新。
- **零回归**：`dark` 主题（上游色）输出与改造前逐像素对照。
