# Crystal Mist 设计系统 · 评估与落地方案

> 输入：用户提供的《清透冰雾 · Crystal Mist》完整设计规范（交互式网页/桌面 UI 版）。
> 目标载体：**Lotus-Plugin 看板 = skia-canvas 离线渲染成 PNG**（非 DOM、无交互）。
> 结论：**方法论全盘采纳，实现方式必须翻译与裁剪**；透度与圆角两处需修正，否则会重蹈「糊一起」。

---

## 一、评估结论

这套规范比我们现有的 `mist v2` 更**系统**：它把玻璃拆成四种材质，并规定每种材质必须同时处理
「表面色+透度 / 背景漫射 / 边缘反光 / 底部暗边 / 环境阴影」，且禁止"只改透明度不处理其余属性"。
这正是我们此前反复调参却治不好「糊」与「平」的根因——**我们只有一档材质，它要求四档**。

但它是一份**交互式**规范：含 `backdrop-filter saturate()`、`:hover/:active/focus-visible`、
`transition`、`@supports` 降级、`prefers-reduced-motion`。我们的产物是**一次成像的静态图**，
这些条目**结构上不适用**，需明确标注而非当成未完成项。

---

## 二、可直接采纳（方法论）

1. **四种材质分级**（Clear / Frost / Solid / Highlight）——破解「要玻璃又怕糊」的矛盾：
   **让不同层用不同透度**，而不是所有卡共用一个透明度。
2. **材质四件套**：表面色透度 + 背景漫射 + 顶高光&底暗边 + 环境阴影。我们已有对应实现位
   （`SHEEN` / `RIM_LIGHT` / `RIM_DARK` / `SHADOW_LAYERS`）。
3. **多层低饱和环境光背景**（radial 冰蓝·淡紫·薄荷）——`BG.glows` 已是同构结构。
4. **圆角 / 间距节奏**：大面板 28–32 / 卡片 20–24 / 控件 12–16 / 卡间距 16–24 / 内边距 20–32。
5. **字重梯度**（标题/正文/说明）与 **6 条视觉验收清单**——直接可用作验收表。

## 三、需翻译到 skia-canvas（技术映射）

| Crystal Mist | 我们的落地方式 | 现状 |
| --- | --- | --- |
| CSS Variables | JS 常量对象 `PALETTES`（+ `DARK` 派生） | ✅ 已具备 |
| `backdrop-filter: blur()` | 离屏 `p.__bgCanvas` 采样 + `ctx.filter='blur()'` | ✅ 已具备（单一值） |
| `backdrop-filter: saturate()` | **无原生支持** → 只能靠配色本身提"清透感" | ⚠️ 做不到，需说明 |
| `radial-gradient()` 环境光 | `BG.glows` 列表 | ✅ 已具备 |
| `box-shadow` 多层扩散 | `SHADOW_LAYERS` | ✅ 已具备 |
| 圆角 / 间距 token | `UI.R` / `UI.SIDE,GAP,PAD` | ⚠️ 需上调数值 |
| **材质四档 alpha + blur** | `openPanel` **需新增材质档位参数** | ❌ **缺**，本次核心改造 |

## 四、必须剔除（静态图不适用）

`hover` / `active` / `focus-visible` / `transition` / `@supports` 降级块 / `prefers-reduced-motion`
——产物无交互、无媒体查询、无 DOM 降级路径。**在验收时标注"不适用"，不计入未完成。**

## 五、必须修正（否则复糊 / 显胖）

1. **主内容卡不要用 52%–70% 那么透。**
   我们此前因 `PANEL .62` 被判定「糊一起」，才推到 `.88`。若照搬核心材质 B（52–70%）会**打回原形**。
   → 方案：**内容卡走 C 厚乳白（.78–.86）；只有次级层/装饰才用 A 清透（.30–.48）**。
   "透度差"照样成立，但文字不糊——这恰是"不同材质不同透度"的正确用法。
2. **圆角不要拉满。**
   规范要面板 28–32px；我们卡宽约 540px、内部元素 20+，30px 会显胖。
   → 方案：面板 22–24 / 卡 16 / 控件 10–12。
3. **背景保底光晕。** 规范强调"玻璃后必须有可被模糊的颜色信息"；我们已把光晕压到 `.50` 防斑驳，
   需保证**卡面下方仍有可见色**，否则模糊后趋近纯白、玻璃发假。

## 六、建议落地步骤（新建 `crystal` 主题，不动 `mist`，可对比回滚）

1. **加 `crystal` 调色板**：冷调（文字 `#263746`/`#687D8E`/`#91A1AF`；蓝 `#8CCFF0`+`#459DCE`；
   薰衣草 `#E7E3FF`；薄荷 `#DDF5E9`）+ **三档材质 token**
   `GLASS_TIERS:{clear:{a:.40,blur:16},frost:{a:.62,blur:26},solid:{a:.80,blur:34}}`
   + 三层环境光 + 蓝灰扩散影（`rgba(66,103,132,·)`）。
2. **改造 `openPanel(p,…,fill,elev,mat)`**：新增 `mat='clear'|'frost'|'solid'`，
   每档取各自的 alpha + blur + 顶高光 + 底暗边；`elev` 继续管视觉深度（z1/z2/z3 → 对齐 L1–L4）。
   **这是结构性升级**：目前 `GLASS_BLUR` 是模块级单值、填充由调用方传死。
3. **版面按层级重排** + `UI.R`/`UI.SIDE,GAP,PAD` 对齐规范节奏。
4. **真机渲染 → 用规范 6 条验收清单逐条核对**（出对照图）；全主题冒烟 + `node --check`。

## 七、决策点（待用户确认）

- A. `crystal` 建成后：**替代 `mist` 做默认**，还是**并存**让你挑？
- B. 是否保留 `mist v2 清晰版` 作为 fallback？
- C. 成员区版式（行1 色条 / 行2 文字列 / 行3 极简）仍待定，是否与新主题一并落地？

---

## 八、实施记录（已完成）

按本方案全量重构，落地如下：

- 新增 `PALETTES.crystal`，**设为默认**（`LOTUS_THEME=crystal`）；`mist/saas/ice/aurora/dawn/light/glass/dark` 全部保留可回滚（决策 A/B 取"并存 + crystal 为默认"）。
- `openPanel` 新增第 9 参 `mat='clear'|'frost'|'solid'`，读 `DARK.GLASS_TIERS[mat]` 决定 `a/blur/tint/shadowK/sheenR/rimK`；**无 `GLASS_TIERS` 的主题忽略该参数 → 零回归**。
- 材质分配：标题栏/群卡/内容卡 = `solid`；指标长条/菜单分类卡 = `frost`；说明块/小磁贴 = `clear`。
- 几何 token 上调：`SIDE 12 / PAD 18 / SECTION 14`，`R {panel 22, tile 16, cell 10}`。
- 验证：`node --check` 通过；9 主题 × 全模板冒烟 10/10；主要卡片目视复核通过；六条验收清单自检全过。
- 遗留：成员区版式（`LOTUS_ROW_STYLE`，默认 `text`）待定。
