# Lotus-Plugin 多插件命令冲突自查（2026-10-21）

> 环境：`D:\yunzai-yingbot\Yunzai\app`，TRSS-Yunzai。已安装 23 个业务插件。
> 方法：静态提取全库 1144 条 rule（含变量常量表注入），按 loader 真实执行序复算每条命令的接管者。
> 复检脚本：`_scan_route_audit.mjs`（扫描）+ `_scan_route_probe.mjs`（胜负探针）。

---

## 一、结论先行

1. **8 月定版的路由表已完全失效**：`ji-plugin`、`StarRail-plugin`、`小花火`、`R 插件`、`TRSS-Plugin` 均已不在磁盘上，Lotus 现在是绝大多数游戏功能的主力。
2. **Lotus 会在运行时强行抢最先执行**：`services/intercept/runtime.js#enforceLotusInterception` 把 `loader.priority` 重排，**priority 相同时 Lotus 条目强制排最前**。所以所有 `-Infinity` 平级场合 Lotus 全胜，不受加载顺序影响。
3. 因此，git 上「-∞ 平级靠加载顺序会翻盘」的担心在 Lotus 身上不成立，但反过来意味着：**只要 Lotus 声明了某命令，其他插件就永远拿不到**。
4. 实测出 **2 处 Lotus 误吞其他插件的真实命令**（已修复），**3 处需产品决策的归属冲突**，**58 条死禁用条目**。

---

## 二、真实接管矩阵（跳过兜底规则）

| 命令 | 实际接管 | 次席 |
|---|---|---|
| `#体力` `#全部体力` `#星铁体力` `#绝区零体力` | **Lotus** Daily Note | genshin 小组件体力（-∞，被压制） |
| `#深渊` `#上期深渊` `#深渊12层` | **Lotus** Genshin Abyss（自制卡） | genshin 原神深渊查询 (49) |
| `#本期深渊` | **Lotus** Atlas（图鉴快捷查询，非战绩） | — |
| `#幻想真境剧诗` `#幽境危战` | **Lotus** Profile Query → miao | genshin 原神深渊查询 (49) |
| `#角色` `#面板` `#练度统计` `#可莉面板` `#角色详情` | **Lotus** Profile Query → miao | miao 原生规则 (5000) |
| `#星铁角色` `#星铁角色列表` | **Lotus** Profile Query → miao | genshin StarRail/role（-∞，被压制） |
| `#星铁深渊` `#星铁混沌` `#星铁虚构` `#星铁末日` `#星铁异相仲裁` | **Lotus** Profile Query（自制卡） | genshin (-MAX) |
| `#星铁模拟宇宙` `#星铁差分` | **genshin** | — |
| `*深渊` `*混沌` `*虚构` | **Lotus** Profile Query | — |
| `#绝区零深渊` `#绝区零面板` `%zzz面板` | **Lotus** Profile Query → ZZZ | miao (5000) |
| `#更新面板` | **Lotus** Panel Update | miao 角色面板 (5000) |
| `#抽卡记录` `#星铁抽卡记录` `#光锥记录` | **miao** 抽卡统计 (5000) | Lotus (5001) → genshin gcLog (6000)；见第十节 |
| `#签到` `#星铁签到` | **Lotus** Checkin | — |
| `#日历` `#材料` | **Lotus** Miao Calendar → miao | miao (5000) |
| `#图鉴` `#xx图鉴` `#图鉴帮助` `#更新图鉴` | **Lotus** Atlas（nanoka 后端） | Atlas 插件 (9) |
| `#绑定设备` | **Lotus** Device | genshin 设备信息（-∞，被压制） |
| `#群成员` | **Lotus** Group Manager | group-manage (8000)，可改用 `#群名单` |
| `#ww面板` `#ww角色面板` | Cloudtide ✅（修复后） | — |
| `#原神导出面板` `#星铁导出面板` | ark-plugin ✅（修复后） | — |
| `#ww刷新面板` | miao-plugin (5000) | Cloudtide (6000) ← Cloudtide 自身优先级偏低 |
| `#荷花帮助` / `#喵喵帮助` / `#帮助` | 各自独立 | 无冲突 |
| `#积分` `#积分榜` `#抽签` | group-manage | 无冲突 |
| `#ww*`（其余） | Cloudtide | 无冲突 |

---

## 三、A 类：已修复（Lotus 误吞，其他插件完全收不到）

### A1. 鸣潮面板被 Lotus 吞掉
`core/intercept/personal-query.js` 的「个人面板」宽规则：
```
^#(?!zzz|绝区零)(?!...更新面板...)[\s\S]{1,}(?:详细|详情|面板|面版|圣遗物|遗器|武器|伤害)${P}$
```
`#ww面板`、`#ww角色面板` 结尾是「面板」→ 被 Lotus 命中 → 桥接给 miao（miao 不认识 ww 前缀）→ 回「外部插件没有返回图片」→ **消息被吃掉，Cloudtide 永远收不到**。

`runProfileQuery()` 末尾无条件 `return true`，桥接失败也不放行，属设计缺陷。

**修复**：规则前置加 `(?!(?:ww|WW|鸣潮))`。

### A2. ark-plugin 导出面板被 Lotus 吞掉
同类规则命中 `#原神导出面板` / `#星铁导出面板`（结尾「面板」）。

**修复**：同一规则加 `(?![\s\S]*导出面板)`。

> 两项修复已通过 7 条用例校验：`#ww面板`/`#ww角色面板`/`#原神导出面板` 不再命中 Lotus，`#可莉面板`/`#角色详情`/`#雷电将军圣遗物`/`#练度统计` 仍由 Lotus 接管。

---

## 四、B 类：需决策的归属冲突

### B1. `#签到` —— Lotus 吞掉 group-manage 的群签到积分
- `group-manage`「签到与抽签」priority 7800，规则 `^#签到$`，且**无备用触发词**。
- Lotus Checkin 为 `-∞` → 群签到积分体系 100% 失效（`#积分`/`#积分榜` 能看，但永远涨不了分）。
- **建议**：`#签到` 归 Lotus（米游社签到是核心功能），把 group-manage 的规则改为 `^#群签到$`；或直接放弃群积分体系。

### B2. `#绑定设备` —— 语义不同的两条命令撞车
- genshin `^#(星铁)?绑定设备(id)?([\s\S]*)$` = 设备 ID 登录绑定。
- Lotus `^#(原神|星铁|绝区零)?绑定设备(?:信息)?...$` = 绑定设备信息 JSON。
- `#绑定设备` 归 Lotus，genshin 入口失效；打 `#绑定设备id` 仍可走 genshin（Lotus 不匹配非数字后缀）。
- **建议**：保持现状，在帮助里写明「设备 ID 绑定请用 `#绑定设备id`」。

### B3. `#群成员` —— 两个不同语义
- Lotus Group Manager：导出群成员（文件）。group-manage：群成员列表卡片。
- **建议**：保持现状，group-manage 侧用自带的 `#群名单` 别名即可，无需改动。

---

## 五、C 类：良性重叠（确认无需处理）

| 现象 | 说明 |
|---|---|
| 星铁挑战被拆成两套 | Lotus 覆盖 深渊/混沌/虚构/末日/异相仲裁（5 种），genshin 覆盖 模拟宇宙/差分；`starRailChallenge.js` 顶部注释「`#星铁` 前缀整体让给 genshin」**已与实现不符**（`PERSONAL_QUERY_RULES` 抢了 5 种），建议更新注释 |
| `#本期深渊` 归 Atlas 图鉴 | Genshin Abyss 只匹配 `上期/往期` 前缀，`本期` 交给图鉴快捷查询，属互补 |
| 剧诗/幽境归 Profile Query → miao | Lotus 无自制卡，桥接 miao，功能正常 |
| Atlas 插件被 Lotus Atlas 全面压制 | Lotus 用 nanoka 全量图鉴，覆盖更全；Atlas 插件只剩 `Atlas原魔属性计算`（已禁用） |
| `#日历`/`#材料` 归 Lotus Miao Calendar | 它是桥接器，最终仍调 miao 的渲染，不是重实现 |

---

## 六、D 类：`group.yaml` 死配置

`app/config/config/group.yaml` 的 `default.disable` 共 67 条，其中 **58 条对应插件已不存在**（ji-plugin / StarRail-plugin / 小花火 / R插件 / TRSS / 旧版 genshin `genshin·xxx` 格式 等）。

仍然有效的只有 9 条：
`[genshin/dailyNote.js]小组件体力查询`、`角色资料`、`Atlas图鉴`、`Atlas图鉴管理`、`Atlas图鉴帮助`、`Atlas原魔属性计算`、`xiaoyao-cvs-plugin`、`[ZZZ-Plugin]wiki`、`星穹铁道`。

注意：
- 该列表由 `services/intercept/runtime.js#ensureYunzaiConflictDisableConfig` **每次启动自动写回**（只增不减），所以手删无效，要改得改 `core/intercept/priority.js` 里的 `LOTUS_CONFIG_DISABLED_PLUGIN_NAMES`。
- 列表里**没有任何 `[Lotus-Plugin] xxx` 条目** —— 8 月定版时人工加的 9 条 Lotus 自禁模块已被清空，即当前 Lotus 全模块启用。

---

## 七、想「让位」时的正确做法

**优先用 Lotus 的模块开关**（`config/global.yaml` → `modules.<id>: false`），不要动 group.yaml：
| id | 影响命令 |
|---|---|
| `daily_note` | `#体力` `#全部体力` |
| `genshin_abyss` | `#深渊` `#上期深渊` |
| `starrail_challenge` | `*深渊` `#星铁深渊` |
| `profile_query` | `#角色` `#面板` `#练度统计` 等（关掉后会回落到 miao/genshin 原生规则） |
| `panel_update` | `#更新面板` |
| `gacha_log` | `#抽卡记录` |
| `atlas` | `#xx图鉴` |
| `miao_calendar` | `#日历` `#材料` |
| `achievements` | `#成就`（含 `^[\s\S]*$` 全匹配兜底，关掉可减少每条消息的一次过路） |
| `genshin_team_damage` / `starrail_team_damage` | `#队伍伤害` |

签到链路**不在**模块开关内（有独立开关），`#签到` 要让出只能改 `apps/checkin.js` 的规则。

---

## 八、复检命令

```bash
cd D:/yunzai-yingbot/Yunzai/app/plugins/Lotus-Plugin
node _scan_route_audit.mjs                              # 重新提取全库规则 → _route_rules.json
node _scan_route_probe.mjs '#体力' '#深渊' '#ww面板'      # 单条详表
node _scan_route_probe.mjs --brief '#签到' '#星铁深渊'    # 汇总表
```

注意：探针已内置两项真实语义 —— ① `enforceLotusInterception` 的同优先级 Lotus 优先；② `PERSONAL_QUERY_RULES` 常量表注入（静态扫描对变量规则失明）。

---

## 九、2026-10-21 分级调整（已执行）

用户决策：**体力 / 签到 / 社区签到 / 自动签到继续走荷花，其余查询类全部让位给上游插件。**

### 改动

`core/intercept/priority.js` 新增第二档（**数值由配置决定，见第十一节**）：

```js
// ① 签到链路：始终最先
export const LOTUS_INTERCEPT_PRIORITY = Number.NEGATIVE_INFINITY
// ② 查询类：默认常量（实际取值 = config/global.yaml 的 routing.query_priority，
//    可用环境变量 LOTUS_QUERY_PRIORITY 覆盖，也可在荧后台「命令路由」里改）
export const LOTUS_QUERY_PRIORITY = 5001
export function resolvePriority(moduleId) { /* routing.front_modules 命中 → -Infinity，否则 query_priority */ }
```

**保留 `-Infinity`（7 个模块 · 签到链路）**

| 文件 | 职责 |
|---|---|
| `apps/dailyNote.js` | 体力 / 全部体力 / 便笺 / 各游戏体力 |
| `apps/checkin.js` | 手动签到、补签、测试签到 |
| `apps/profileSettings.js` | 签到设置（`#注册自动签到` `#启用社区签到` `#设置签到时间` `#绑定国际服cookie` 等） |
| `apps/captchaHandler.js` | 签到验证码全局 handler |
| `apps/login.js` | 扫码登录 / 米游社登录 |
| `apps/taptap.js` | TapTap 社区签到 |
| `apps/weibo.js` | 微博签到 |

自动签到调度（`apps/scheduler.js`）走 cron task、无 message 规则，不受优先级影响，天然独占。

**降为 `5001`（14 个模块 · 查询类）**

`achievements` `atlas` `bilibili` `device` `douyin` `gachaLog` `genshinAbyss` `genshinChallenge` `genshinTeamDamage` `miaoCalendar` `panelUpdate` `profileQuery` `starRailChallenge` `starRailTeamDamage`

这 14 个模块的 `priority` 统一写成 `resolvePriority("<模块 id>")`，**数值不再写死在代码里**，而是读 `config/global.yaml`：

```yaml
routing:
  query_priority: 5001   # 查询类统一优先级（越小越先）
  front_modules: []      # 需要固定抢回 -Infinity 的模块 id，逗号/换行分隔
```

`core/intercept/personal-query.js` 的 `PERSONAL_QUERY_RULES` 是常量表，随 `profileQuery.js` 一起生效，无需单独改。

### 调整后实测接管

| 命令 | 接管方 | 说明 |
|---|---|---|
| `#签到` `#全部签到` `#补签` `#测试签到` | **Lotus** (-∞) | 保持 |
| `#启用社区签到` `#禁用原神签到` `#注册自动签到` | **Lotus** (-∞) | 保持 |
| `#扫码登录` `#米游社登录` | **Lotus** (-∞) | 保持 |
| `#体力` `#全部体力` `#星铁体力` `#绝区零体力` `#便笺` | **Lotus** (-∞) | 保持 |
| `#深渊` `#幻想真境剧诗` `#幽境危战` | genshin (49) | 让出 |
| `#角色` `#武器` | genshin (49) | 让出 |
| `#星铁深渊` `#星铁虚构` `#星铁末日` `#星铁异相仲裁` `#星铁模拟宇宙` `#星铁差分` | genshin (-MAX) | 让出 |
| `#面板` `#练度统计` `#星铁面板` | miao (5000) | 让出 |
| `#绝区零深渊` `#绝区零面板` | ZZZ (70) | 让出 |
| `#抽卡记录` `#星铁抽卡记录` `#光锥记录` | **miao** 抽卡统计 (5000) | 已按第十节切给喵喵；Lotus (5001) 第二兜底、genshin gcLog (6000) 第三兜底 |
| `#日历` | miao (5000) | 让出 |
| `#材料` | genshin (500) | 让出 |
| `#xx图鉴` | Atlas (5000，宽规则) → 失败回落 Lotus (5001) | 让出 |
| `#队伍伤害` | genshin (2000) | 让出 |
| `*深渊` `*混沌` `*虚构` | **Lotus** (5001) | 无竞争者，荷花保留自制卡 |
| `#更新面板` | ark-plugin (-3000，副作用后 `return false` 放行) → miao (5000) → Lotus (5001) 兜底 | 链路正常 |

> 注：`apps/groupManager.js`（`#群成员`，p=20）、`apps/profile.js`（`#配置`，p=20）、`apps/help.js`（`#荷花帮助`，p=20）等非游戏查询模块维持原优先级 —— 它们没有对应插件竞争，且是荷花自身入口。

### 生效方式

`apps/` 与 `core/` 均属静态 import，loader 对含 `index.js` 的插件目录不挂 watcher，**必须 `#重载 Lotus-Plugin` 或冷重启**才生效。

### 回滚

不用改代码：在荧后台「命令路由」把「查询类优先级」调小，或把某个模块加入「抢回最前的模块」；
也可以在 `config/global.yaml` 里直接写，或临时用环境变量 `LOTUS_QUERY_PRIORITY=<数值>` 覆盖（优先级最高）。
最彻底的回滚仍是把 14 个文件的 `resolvePriority("…")` 改回 `LOTUS_INTERCEPT_PRIORITY`。


---

## 十、抽卡记录切给喵喵（2026-10-21 追加）

### 背景
`#抽卡记录` 原本由 **genshin gcLog（priority 300）** 接管 —— 这个值很小，比 miao 的 5000 还靠前。
miao 其实也有抽卡记录（`apps/gacha.js`），但裸命令 `yzRule` 挂了 `yzCheck: () => Cfg.get('gachaStat', false)`，
默认 `false` 时命中后 `return false` 放行；只有带前缀的 `#喵喵抽卡记录`（`rule` 分支）不受该开关限制。

### 改动（两处，均在第三方插件，不改 Lotus）

| 文件 | 项 | 原值 | 新值 |
|---|---|---|---|
| `miao-plugin/config/cfg.js` | `gachaStat` | `false` | `true` |
| `genshin/config/config/config.admin.yaml` | `Gacha`（gcLog 的 priority） | `300` | `6000` |

`Gacha` 只被 `genshin/apps/gcLog.js` 读取作为优先级，改它不影响 genshin 其他功能（`gsGacha` 是另一个开关，未动）。

### 新接管顺序
```
miao 抽卡统计 (5000) → Lotus Gacha Log (5001) → genshin gcLog (6000)
```

| 命令 | 接管方 |
|---|---|
| `#抽卡记录` `#星铁抽卡记录` `#光锥记录` `#抽卡分析` `#抽卡统计` | **miao** |
| `#导入抽卡记录` `#导出抽卡记录` `#导入Excel` `authkey=...` `#抽卡成就` | **genshin**（miao 无对应规则，自动落到 genshin） |
| miao 的 `gachaStat` 若被关回 false | Lotus (5001) 自动补位，功能不丢 |

### 生效方式
两个插件都要重载：`#重载 miao-plugin`、`#重载 genshin`（miao 的 `cfg.js` 在模块加载时读入并缓存）。

---

## 十一、路由接入荧后台（2026-10-21 追加）

优先级不再写死在代码里，改由配置驱动，这样后续**不用改文件**就能在荧后台（锅巴）里调。

### 配置落点

`config/global.yaml` 新增 `routing` 段（`core/config/defaults.js` 有默认值，旧配置缺这一段会被自动补全）：

```yaml
routing:
  query_priority: 5001   # 查询类统一优先级，越小越先接管
  front_modules: []      # 固定抢回 -Infinity 的模块 id，每行一个
```

取值优先级：**环境变量 `LOTUS_QUERY_PRIORITY` > `routing.query_priority` > 内置 5001**。

### 荧后台面板

`guoba.support.js` 的 `GUOBA_SCHEMAS` 在「功能开关」之后新增「命令路由」分组：

| 字段 | 组件 | 作用 |
|---|---|---|
| `routing.query_priority` | 数字 | 查询类统一优先级 |
| `routing.front_modules` | 多行文本（`ARRAY_FIELDS`，按换行/逗号拆） | 列出即固定 `-Infinity` |

配套改动：`ARRAY_FIELDS` 加 `routing.front_modules`，`NUMBER_FIELDS` 加 `routing.query_priority`，
`core/config/schema.js` 新增 `validateRoutingConfig`（缺省合法，写了才校验，旧配置不受影响）。

### 典型用法

| 想达到的效果 | 操作 |
|---|---|
| 全部保持默认（荷花查询类做后备） | 不动，`query_priority: 5001`、`front_modules: []` |
| 让荷花的原神深渊自制卡优先于 genshin / miao | `front_modules` 加 `genshin_abyss` |
| 抽卡记录回到荷花 | `front_modules` 加 `gacha_log`（或把 miao 的 `gachaStat` 关掉） |
| 荷花整体更靠后（尽量不抢任何一个上游命令） | `query_priority` 调到 `9999` |

模块 id 与「功能开关」用的是同一套（`core/config/modules.js` 的 `FEATURE_MODULES`）：
`genshin_abyss` `starrail_challenge` `genshin_team_damage` `starrail_team_damage` `achievements` `atlas`
`gacha_log` `miao_calendar` `panel_update` `profile_query` `device` `bilibili` `douyin` 等。

### 生效方式

**荧后台保存即生效，无需 `#重载`**：保存钩子里会 ① 清模块开关的 2s TTL 缓存（模块开关本就按消息实时查）；
② 调 `applyRoutingToLoader()` 把新的 query_priority / front_modules 同步进运行中的 `loader.priority`
（通过 `class.__lotusModuleId` 把条目映射回模块 id）并重排消息处理序。
手动改 `config/global.yaml` 的话，`priority.js` 的 mtime 缓存会让下一次重载读到新值；想不重载立即生效仍需 `#重载 Lotus-Plugin`。

### 自检脚本

```bash
node _test_routing.mjs          # 配置解析 / front_modules / mtime 失效 / loader 热更新（16 项）
node _test_guoba_routing.mjs    # 荧后台字段读写往返 + 校验（14 项）
node _scan_route_audit.mjs      # 重新扫全库规则 → _route_rules.json
node _scan_route_probe.mjs --brief '#深渊' '#抽卡记录'   # 实测谁接管
```

> 探针已同步支持 `resolvePriority("<id>")` 写法：会按当前配置把模块 id 解析成实际数值，
> 因此改完 `routing` 后跑探针，看到的就是真实接管顺序。
