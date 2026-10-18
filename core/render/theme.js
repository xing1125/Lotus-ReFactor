// 主题真源（Theme SSOT）：色板 / 材质档 / 字体度量。
// 所有渲染器（source-cards.js 通用卡片、atlas-pages.js 图鉴、starrail-abyss.js 星铁挑战…）
// 一律从这里取色 —— 新增主题或切换默认主题即全局生效，零散落硬编码。
//
// 主题解析优先级：环境变量 LOTUS_THEME > 插件配置 config/global.yaml 的 render.theme > 默认 crystal。
// 配置走同步读取（模块加载期就要定色板，不能 await），且只解析这一项，不引入配置模块的重依赖。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const THEME_NAMES = ['crystal', 'mist', 'saas', 'ice', 'aurora', 'dawn', 'light', 'glass', 'dark', 'abyss', 'tide']

function readConfiguredTheme() {
  if (process.env.LOTUS_THEME) return process.env.LOTUS_THEME
  try {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config', 'global.yaml')
    if (!fs.existsSync(file)) return ''
    const YAML = createRequire(import.meta.url)('yaml')
    const config = YAML.parse(fs.readFileSync(file, 'utf8')) || {}
    return config?.render?.theme || ''
  } catch {
    return ''
  }
}

const THEME = (() => {
  const picked = String(readConfiguredTheme() || '').trim().toLowerCase()
  return THEME_NAMES.includes(picked) ? picked : 'crystal'
})()

// ---- 主题 / 调色板（须最先定义：GOLD / WHITE 等模块常量由 DARK 派生 → 所有 builder 自动跟随主题）----
// theme = crystal（清透冰雾·Crystal Mist，默认）| mist（云雾奶油）| saas（扁平现代 SaaS）| ice（冰蓝毛玻璃）| aurora（赛博极光）| dawn（晨曦微光）| light（明亮通透）| glass（提亮玻璃）| dark（上游 miao 深色）
// crystal 四档材质：clear 次级浮层 / frost 中层 / solid 主内容卡（+ header 顶栏）；HIGHLIGHT 类装饰由 ACCENT_GRAD 承担
// 毛玻璃（Glassmorphism）三要素在 canvas 上的等价实现：
//   背景 = 线性渐变 + 多个大尺寸径向光晕（平滑无高频细节 → 半透明叠加即读作「磨砂」）
//   卡片 = 半透明白 + 真 1px 描边（roundRect+stroke）+ 顶部高光渐变 + 柔和投影
const PALETTES={
 dark:{GOLD:'#d3bc8e',WHITE:'#fff',LABEL:'rgba(255,255,255,.62)',MUTED:'rgba(255,255,255,.80)',
  PANEL:'rgba(0,0,0,.50)',HEADER:'rgba(0,0,0,.40)',STRIPE:'rgba(255,255,255,.045)',TRACK:'rgba(255,255,255,.14)',
  okFill:'rgba(211,188,142,.20)',okText:'#d3bc8e',failFill:'rgba(255,96,96,.18)',failText:'#ff9d9d',
  pendFill:'rgba(255,255,255,.12)',pendText:'rgba(255,255,255,.55)',
  BORDER:null,LINE:'rgba(255,255,255,.10)',CELL_BG:'rgba(0,0,0,.38)',CELL_BORDER:'rgba(255,255,255,.12)',FLOAT:'rgba(15,20,31,.78)',FLOAT_TEXT:'#c2c5cb',FLOAT_RULE:'rgba(211,188,142,.35)',DIVIDER:'rgba(255,255,255,.7)',SUB_TEXT:'#aaa',okBar:'#d3bc8e',failBar:'#ff6b6b',CANVAS:'#243344',ROWA:'#fff',ROWB:'#f0f0f0',CELL:'#333',
  SHEEN:null,GLASS_BLUR:null,SHADOW:null,WATERMARK:null,HINT_BG:null,ACCENT_GRAD:null,BG:null},
 glass:{GOLD:'#e6d0a0',WHITE:'#fff',LABEL:'rgba(255,255,255,.74)',MUTED:'rgba(255,255,255,.90)',
  PANEL:'rgba(255,255,255,.10)',HEADER:'rgba(255,255,255,.07)',STRIPE:'rgba(255,255,255,.05)',TRACK:'rgba(255,255,255,.22)',
  okFill:'rgba(211,188,142,.28)',okText:'#f0dcae',failFill:'rgba(255,120,120,.26)',failText:'#ffb8b8',
  pendFill:'rgba(255,255,255,.16)',pendText:'rgba(255,255,255,.72)',
  BORDER:'rgba(255,255,255,.14)',LINE:'rgba(255,255,255,.12)',CELL_BG:'rgba(255,255,255,.18)',CELL_BORDER:'rgba(255,255,255,.22)',FLOAT:'rgba(18,24,38,.55)',FLOAT_TEXT:'rgba(255,255,255,.72)',FLOAT_RULE:'rgba(255,255,255,.12)',DIVIDER:'rgba(255,255,255,.16)',SUB_TEXT:'rgba(255,255,255,.62)',okBar:'#e6d0a0',failBar:'#ff8a8a',CANVAS:'#3a4a60',ROWA:'rgba(255,255,255,.94)',ROWB:'rgba(255,255,255,.86)',CELL:'#2b3340',
  SHEEN:'rgba(255,255,255,.07)',GLASS_BLUR:12,SHADOW:'rgba(0,0,0,.30)',WATERMARK:'rgba(255,255,255,.32)',
  HINT_BG:'rgba(255,255,255,.06)',ACCENT_GRAD:null,BG:null},
 light:{GOLD:'#a8813f',WHITE:'#2b3340',LABEL:'#6b7684',MUTED:'#3d4756',
  PANEL:'#ffffff',HEADER:'#eef2f7',STRIPE:'rgba(20,30,50,.035)',TRACK:'rgba(20,30,50,.10)',
  okFill:'rgba(168,129,63,.15)',okText:'#8a6a34',failFill:'rgba(214,69,69,.12)',failText:'#c0392b',
  pendFill:'rgba(20,30,50,.06)',pendText:'#7b8794',
  BORDER:'rgba(20,30,50,.08)',LINE:'rgba(20,30,50,.08)',CELL_BG:'#f7f9fc',CELL_BORDER:'rgba(20,30,50,.10)',FLOAT:'rgba(255,255,255,.94)',FLOAT_TEXT:'#6b7684',FLOAT_RULE:'rgba(20,30,50,.08)',DIVIDER:'rgba(20,30,50,.08)',SUB_TEXT:'#7b8794',okBar:'#8a6a34',failBar:'#c0392b',CANVAS:'#eef1f6',ROWA:'#ffffff',ROWB:'#f7f9fc',CELL:'#2b3340',
  SHEEN:null,GLASS_BLUR:null,SHADOW:'rgba(31,41,55,.10)',WATERMARK:null,HINT_BG:null,ACCENT_GRAD:null,BG:null},
 // 赛博极光：深紫→藏青渐变底 + 霓虹蓝/紫/薄荷光晕；玻璃卡 + 霓虹状态色
 aurora:{GOLD:'#38BDF8',WHITE:'#FFFFFF',LABEL:'#94A3B8',MUTED:'#CBD5E1',
  PANEL:'rgba(255,255,255,.08)',HEADER:'rgba(255,255,255,.06)',STRIPE:'rgba(255,255,255,.05)',TRACK:'rgba(255,255,255,.12)',
  okFill:'rgba(0,255,170,.14)',okText:'#00FFAA',failFill:'rgba(255,77,77,.16)',failText:'#FF4D4D',
  pendFill:'rgba(255,255,255,.10)',pendText:'#94A3B8',
  BORDER:'rgba(255,255,255,.15)',LINE:'rgba(255,255,255,.12)',CELL_BG:'rgba(255,255,255,.10)',CELL_BORDER:'rgba(255,255,255,.16)',FLOAT:'rgba(20,24,40,.72)',FLOAT_TEXT:'#94A3B8',FLOAT_RULE:'rgba(255,255,255,.12)',DIVIDER:'rgba(255,255,255,.16)',SUB_TEXT:'#94A3B8',okBar:'#00FFAA',failBar:'#FF4D4D',CANVAS:'#1b1b2f',ROWA:'rgba(255,255,255,.10)',ROWB:'rgba(255,255,255,.05)',CELL:'#CBD5E1',
  SHEEN:'rgba(255,255,255,.09)',STREAK:'rgba(255,255,255,.16)',GLASS_BLUR:16,SHADOW:'rgba(0,0,0,.45)',SHADOW_TIGHT:null,WATERMARK:'rgba(255,255,255,.30)',
  SHADOW_LAYERS:[{c:'rgba(56,189,248,.26)',y:2,b:8},{c:'rgba(139,92,246,.16)',y:8,b:20}],
  RIM_LIGHT:'rgba(255,255,255,.22)',RIM_DARK:'rgba(56,189,248,.20)',
  HINT_BG:'rgba(255,255,255,.06)',ACCENT_GRAD:['#22D3EE','#8B5CF6'],ACCENT_GLOW:'rgba(56,189,248,.55)',
  BG:{angle:135,stops:[['#1B1B2F',0],['#232342',.5],['#2A2A40',1]],
   glows:[{c:'#38BDF8',x:.12,y:.04,r:.55,a:.30},{c:'#8B5CF6',x:.92,y:.16,r:.50,a:.32},{c:'#00FFAA',x:.78,y:.96,r:.45,a:.14}]}},
 // 晨曦微光（浅色毛玻璃·强化对比版）：
 //   底更深更饱和 → 白玻璃卡才有对比；卡更白 → 卡/底明度拉开；双层投影 + 双色边缘 → 层次立起来
 dawn:{GOLD:'#6D28D9',WHITE:'#0F172A',LABEL:'#42506B',MUTED:'#2A3448',
  // 层次感靠「卡间不透明度差」形成三层：标题栏 .68（最透、最贴底）→ 提示条 .74 → 面板 .82（最实）
  // 卡要「白」又要「强对比」：卡做到近纯白，对比交给鲜艳底色 + 亮边 + 接触投影承担
  // 浅色主题的斑马纹要「压暗」而非「提亮」（原本白色条纹叠在近白面上＝隐身）
  // 三方取舍（底克制 / 卡通透 / 对比强 无法同时拉满）：参照参考图的解法 —— 底色克制 + 卡接近实白 + 靠边框投影建秩序
  // 通透度再放一档（.76→.68）：磨砂感 = 透上来的背景占比，太实就只剩「白板」
  PANEL:'rgba(255,255,255,.68)',HEADER:'rgba(255,255,255,.58)',STRIPE:'rgba(15,23,42,.05)',TRACK:'rgba(15,23,42,.20)',
  // 浅底上的状态色需压暗才够对比（原 #10B981/#F43F5E 同色系但更浅，12px 下偏淡）
  // 胶囊底与状态的对比要够：.20/.16 在近白卡面上几乎看不出是一颗「胶囊」
  okFill:'rgba(5,150,105,.30)',okText:'#036B4E',failFill:'rgba(225,29,72,.26)',failText:'#B01234',
  pendFill:'rgba(15,23,42,.14)',pendText:'#44536B',
  // 浅底上靠「冷色细边」勾勒卡轮廓（借鉴参考图的浅蓝边框），纯白边在浅底上看不见
  BORDER:'rgba(255,255,255,.98)',BORDER_IN:'rgba(110,140,200,.30)',LINE:'rgba(15,23,42,.10)',CELL_BG:'rgba(255,255,255,.90)',CELL_BORDER:'rgba(120,150,205,.22)',
  FLOAT:'rgba(255,255,255,.90)',FLOAT_TEXT:'#4A5A73',FLOAT_RULE:'rgba(15,23,42,.10)',DIVIDER:'rgba(15,23,42,.10)',SUB_TEXT:'#5B6B84',okBar:'#10B981',failBar:'#F43F5E',CANVAS:'#829FCB',ROWA:'rgba(255,255,255,.88)',ROWB:'rgba(255,255,255,.70)',CELL:'#0B1220',
  // 模糊半径不能过大：22px 会把背景抹成均匀一片 → 读不出「磨砂」；14px 保留色块柔和形状才是毛玻璃
  SHEEN:'rgba(255,255,255,.55)',STREAK:'rgba(255,255,255,.34)',GLASS_BLUR:14,SHADOW:'rgba(23,32,58,.32)',SHADOW_TIGHT:null,WATERMARK:'rgba(17,24,39,.45)',
  // 光影质感（按设计规格）：双层「带色」外阴影 —— 用蓝色而非黑色，玻璃才像被环境光染色
  SHADOW_LAYERS:[{c:'rgba(18,101,232,.28)',y:2,b:8},{c:'rgba(14,98,231,.13)',y:8,b:20}],
  // 内阴影倒角：左上白色高光 + 右下冷蓝内影（反向偏移），这是玻璃立体感的来源
  RIM_LIGHT:'rgba(255,255,255,.58)',RIM_DARK:'rgba(174,209,254,.32)',
  HINT_BG:'rgba(255,255,255,.66)',ACCENT_GRAD:['#22D3EE','#8B5CF6'],ACCENT_GLOW:'rgba(109,40,217,.55)',
  // 磨砂的视觉信号 = 玻璃后面的「明暗变化」。底图保持低饱和蓝调，但用「白雾 ↔ 深蓝」交替光晕造明度差
  // （变化的是明度不是饱和度 → 不吵，但透过玻璃能看到柔和的明暗推移 = 磨砂感）
  BG:{angle:135,stops:[['#829FCB',0],['#A5A6CE',.48],['#8A95C4',1]],
   glows:[{c:'#FFFFFF',x:.10,y:.06,r:.30,a:.42},{c:'#3B82F6',x:.94,y:.12,r:.30,a:.40},
    {c:'#C7D2FE',x:.62,y:1.02,r:.32,a:.46},{c:'#1E40AF',x:.18,y:.94,r:.20,a:.26},
    {c:'#E0F2FE',x:.82,y:.58,r:.22,a:.36}]}},
 // 冰蓝毛玻璃（清新亮眼·真玻璃质感·全面落实版）：背景冰蓝/白/淡紫径向光斑可折射；主面板 rgba(255,255,255,.36)+blur(22)+内高光+顶部反射；内层卡片 rgba(255,255,255,.24) 分层；深色文字 #0F172A；青→蓝渐变强调；克制绿/红状态色
 ice:{GOLD:'#0369A1',WHITE:'#0F172A',LABEL:'#42506B',MUTED:'#2A3448',
  PANEL:'rgba(255,255,255,.30)',HEADER:'rgba(255,255,255,.58)',STRIPE:'rgba(15,23,42,.05)',TRACK:'rgba(148,163,184,.28)',
  okFill:'rgba(5,150,105,.30)',okText:'#036B4E',failFill:'rgba(225,29,72,.26)',failText:'#B01234',
  pendFill:'rgba(15,23,42,.14)',pendText:'#44536B',
  BORDER:'rgba(255,255,255,.82)',BORDER_IN:'rgba(110,140,200,.30)',LINE:'rgba(15,23,42,.10)',CELL_BG:'rgba(255,255,255,.24)',CELL_BORDER:'rgba(255,255,255,.68)',FLOAT:'rgba(255,255,255,.90)',FLOAT_TEXT:'#4A5A73',FLOAT_RULE:'rgba(15,23,42,.10)',DIVIDER:'rgba(15,23,42,.10)',SUB_TEXT:'#5B6B84',okBar:'#10B981',failBar:'#E11D48',CANVAS:'#e6f5ff',ROWA:'rgba(255,255,255,.24)',ROWB:'rgba(255,255,255,.16)',CELL:'#0B1220',
  SHEEN:'rgba(255,255,255,.55)',STREAK:'rgba(255,255,255,.34)',GLASS_BLUR:22,SHADOW:'rgba(65,133,185,.12)',SHADOW_TIGHT:null,WATERMARK:'rgba(17,24,39,.45)',
  SHADOW_LAYERS:[{c:'rgba(65,133,185,.18)',y:2,b:8},{c:'rgba(65,133,185,.09)',y:8,b:20}],
  RIM_LIGHT:'rgba(255,255,255,.58)',RIM_DARK:'rgba(174,209,254,.32)',
  HINT_BG:'rgba(255,255,255,.55)',ACCENT_GRAD:['#67E8F9','#00A3FF'],ACCENT_GLOW:'rgba(0,163,255,.55)',
  BG:{angle:135,stops:[['#dff1ff',0],['#e6f5ff',.5],['#eef6ff',1]],
   glows:[{c:'#74D3FF',x:.15,y:.10,r:.45,a:.48},{c:'#FFFFFF',x:.85,y:.20,r:.40,a:.88},
    {c:'#A8B6FF',x:.80,y:.90,r:.45,a:.38},{c:'#BAE6FD',x:.30,y:.85,r:.38,a:.40}]}},
 // 扁平现代 SaaS（无边框 · 纯白卡 + 留白 + 极淡阴影）：破「盒子套盒子」，靠留白 / 字重 / 色块对比分区。
 // 关掉玻璃（无模糊/高光/内棱/反光带/双描边）→ openPanel 退化为「纯色填充 + 极淡柔影」。
 saas:{GOLD:'#2563EB',WHITE:'#1E293B',LABEL:'#64748B',MUTED:'#475569',
  PANEL:'#FFFFFF',HEADER:'#FFFFFF',STRIPE:'rgba(15,23,42,.025)',TRACK:'#EDF1F7',
  okFill:'#E6F6EF',okText:'#0E9F6E',failFill:'#FDECEF',failText:'#E11D48',
  pendFill:'#F1F5F9',pendText:'#94A3B8',
  BORDER:null,BORDER_IN:null,LINE:'rgba(15,23,42,.06)',CELL_BG:'#F8FAFC',CELL_BORDER:null,
  FLOAT:'#FFFFFF',FLOAT_TEXT:'#475569',FLOAT_RULE:'rgba(15,23,42,.08)',DIVIDER:'rgba(15,23,42,.06)',SUB_TEXT:'#64748B',
  okBar:'#10B981',failBar:'#F43F5E',CANVAS:'#F4F7FB',ROWA:'#FFFFFF',ROWB:'#F8FAFC',CELL:'#1E293B',
  SHEEN:null,STREAK:null,GLASS_BLUR:null,RIM_LIGHT:null,RIM_DARK:null,SHADOW_LAYERS:null,
  SHADOW:'rgba(15,23,42,.06)',SHADOW_TIGHT:null,SHADOW_K:0.28,WATERMARK:'#94A3B8',
  HINT_BG:'#F8FAFC',ACCENT_GRAD:['#38BDF8','#2563EB'],ACCENT_GLOW:'rgba(56,189,248,.35)',
  BG:{angle:180,stops:[['#F4F7FB',0],['#F4F7FB',1]],glows:[]}},
 // 云雾奶油 · Mist Glass（浅色真毛玻璃）：暖白/冷白底 + 淡紫·冰蓝·薄荷低饱和环境光晕。
 // 【v2 清晰化】原 .62 半透明被吐槽「糊一起」→ 面板提到 .88/.96（近实白），把背景光晕压到 .50 以下，
 // 避免透出成斑驳色块；分隔线 .13、次级文字加深、白高光雾降到 .45/.16；blur 34 让背景成为均匀的柔光底。
 // 【清晰版】面板近乎实白 → 杜绝背景光晕透出成斑驳；分隔线加深；去掉白色高光雾；文字加深
 mist:{GOLD:'#8D83E8',WHITE:'#22242E',LABEL:'#5F6472',MUTED:'#4A4E5C',
  PANEL:'rgba(255,255,255,.88)',HEADER:'rgba(255,255,255,.96)',STRIPE:'rgba(41,43,54,.04)',TRACK:'rgba(41,43,54,.10)',
  okFill:'rgba(110,170,135,.20)',okText:'#356E4E',failFill:'rgba(214,120,150,.18)',failText:'#A9486E',
  pendFill:'rgba(41,43,54,.06)',pendText:'#7C818F',
  BORDER:'rgba(255,255,255,.92)',BORDER_IN:'rgba(205,207,221,.36)',LINE:'rgba(41,43,54,.13)',CELL_BG:'rgba(255,255,255,.78)',CELL_BORDER:'rgba(255,255,255,.86)',
  FLOAT:'rgba(255,255,255,.96)',FLOAT_TEXT:'#4A4E5C',FLOAT_RULE:'rgba(41,43,54,.10)',DIVIDER:'rgba(41,43,54,.10)',SUB_TEXT:'#6A6F7C',
  okBar:'#5FA37A',failBar:'#CC6E8F',CANVAS:'#F5F3EF',ROWA:'rgba(255,255,255,.80)',ROWB:'rgba(255,255,255,.62)',CELL:'#22242E',
  SHEEN:'rgba(255,255,255,.45)',STREAK:'rgba(255,255,255,.16)',GLASS_BLUR:34,SHADOW:'rgba(50,48,84,.16)',SHADOW_TIGHT:null,SHADOW_K:0.85,
  SHADOW_LAYERS:[{c:'rgba(50,48,84,.16)',y:5,b:16},{c:'rgba(50,48,84,.07)',y:1,b:4}],
  RIM_LIGHT:'rgba(255,255,255,.95)',RIM_DARK:'rgba(205,207,221,.34)',
  WATERMARK:'#9AA0AC',
  HINT_BG:'rgba(255,255,255,.90)',ACCENT_GRAD:['#8D83E8','#7AAFE5'],ACCENT_GLOW:'rgba(141,131,232,.35)',
  BG:{angle:135,stops:[['#F5F3EF',0],['#F3F3F2',.5],['#F1F4F8',1]],
   glows:[{c:'#D8D3F7',x:.12,y:.07,r:.58,a:.50},{c:'#FFFFFF',x:.87,y:.15,r:.42,a:.70},
    {c:'#C6E4F7',x:.89,y:.90,r:.52,a:.46},{c:'#CFE7D8',x:.20,y:.95,r:.44,a:.40}]}},
// 深境螺旋 · Abyss（深蓝金）：与原神深渊品牌面板（genshin-abyss.js）同源的上游配色 ——
//   页底 #07091B + 层卡蓝紫 #1C1B3D + 金 #D3BC8D，绿 #45B97C / 红 #FF5722 状态色。
// 用途：喜欢深渊卡那套深蓝金的话，其余全部主题化卡片一键切过来；四块品牌面板本就是这套色，视觉完全一致。
abyss:{GOLD:'#D3BC8D',WHITE:'#FFFFFF',LABEL:'#8F9BC7',MUTED:'#C8D1F6',TITLE_COLOR:'#E6EBFF',
  PANEL:'rgba(28,27,61,.66)',HEADER:'rgba(24,23,54,.88)',STRIPE:'rgba(255,255,255,.04)',TRACK:'rgba(255,255,255,.14)',
  okFill:'rgba(69,185,124,.18)',okText:'#6FD598',failFill:'rgba(255,87,34,.20)',failText:'#FF8A65',
  pendFill:'rgba(255,255,255,.10)',pendText:'rgba(230,235,255,.55)',
  BORDER:'rgba(255,255,255,.14)',BORDER_IN:'rgba(120,130,190,.28)',LINE:'rgba(255,255,255,.12)',
  CELL_BG:'rgba(255,255,255,.07)',CELL_BORDER:'rgba(255,255,255,.14)',
  FLOAT:'rgba(18,17,44,.90)',FLOAT_TEXT:'#C8D1F6',FLOAT_RULE:'rgba(211,188,141,.35)',DIVIDER:'rgba(255,255,255,.30)',
  SUB_TEXT:'#AAB4DF',okBar:'#45B97C',failBar:'#FF5722',CANVAS:'#07091B',
  ROWA:'rgba(255,255,255,.08)',ROWB:'rgba(255,255,255,.04)',CELL:'#E6EBFF',
  SHEEN:'rgba(255,255,255,.06)',STREAK:'rgba(255,255,255,.10)',GLASS_BLUR:18,
  SHADOW:'rgba(0,0,0,.45)',SHADOW_TIGHT:null,SHADOW_K:1.0,
  SHADOW_LAYERS:[{c:'rgba(0,0,0,.38)',y:6,b:20},{c:'rgba(211,188,141,.08)',y:2,b:8}],
  RIM_LIGHT:'rgba(255,255,255,.20)',RIM_DARK:'rgba(0,0,0,.38)',
  WATERMARK:'rgba(255,255,255,.28)',
  HINT_BG:'rgba(255,255,255,.06)',ACCENT_GRAD:['#D3BC8D','#62A8EA'],ACCENT_GLOW:'rgba(211,188,141,.40)',
  BG:{angle:160,stops:[['#07091B',0],['#0B0E26',.52],['#12163A',1]],
   glows:[{c:'#2E3F8F',x:.08,y:.04,r:.62,a:.38},{c:'#5B4A9E',x:.92,y:.18,r:.55,a:.30},
    {c:'#D3BC8D',x:.82,y:.96,r:.42,a:.14},{c:'#1C1B3D',x:.30,y:.90,r:.50,a:.40}]}},
 // 深海冰蓝 · Tide（对标 waves-js 面板）：深海蓝底 #0A192F/#102A43 + 冰蓝强调 #4FC3F7 + 浅天蓝 #B3E5FC + 冷灰 #B0BEC5。
 // 拒绝紫调：背景光晕全走青色/深蓝，强调渐变青→冰蓝，状态成功用冰蓝、失败保留暖红。
 tide:{GOLD:'#4FC3F7',WHITE:'#EAF6FF',LABEL:'#8FB3D1',MUTED:'#B3E5FC',TITLE_COLOR:'#EAF6FF',
  PANEL:'rgba(16,42,67,.72)',HEADER:'rgba(16,42,67,.90)',STRIPE:'rgba(255,255,255,.04)',TRACK:'rgba(79,195,247,.16)',
  okFill:'rgba(79,195,247,.20)',okText:'#7AD2FF',failFill:'rgba(255,107,107,.20)',failText:'#FF9D9D',
  pendFill:'rgba(255,255,255,.10)',pendText:'rgba(176,190,197,.60)',
  BORDER:'rgba(79,195,247,.22)',BORDER_IN:'rgba(79,195,247,.16)',LINE:'rgba(255,255,255,.10)',
  CELL_BG:'rgba(255,255,255,.06)',CELL_BORDER:'rgba(79,195,247,.14)',
  FLOAT:'rgba(10,25,47,.92)',FLOAT_TEXT:'#B3E5FC',FLOAT_RULE:'rgba(79,195,247,.30)',DIVIDER:'rgba(255,255,255,.26)',
  SUB_TEXT:'#A9C4D8',okBar:'#4FC3F7',failBar:'#FF6B6B',CANVAS:'#0A192F',
  ROWA:'rgba(255,255,255,.07)',ROWB:'rgba(255,255,255,.04)',CELL:'#EAF6FF',
  SHEEN:'rgba(255,255,255,.05)',STREAK:'rgba(79,195,247,.10)',GLASS_BLUR:18,
  SHADOW:'rgba(0,0,0,.42)',SHADOW_TIGHT:null,SHADOW_K:1.0,
  SHADOW_LAYERS:[{c:'rgba(0,0,0,.36)',y:6,b:20},{c:'rgba(79,195,247,.08)',y:2,b:8}],
  RIM_LIGHT:'rgba(255,255,255,.16)',RIM_DARK:'rgba(0,0,0,.34)',
  WATERMARK:'rgba(179,229,252,.24)',
  HINT_BG:'rgba(255,255,255,.05)',ACCENT_GRAD:['#4FC3F7','#00A3FF'],ACCENT_GLOW:'rgba(79,195,247,.40)',
  BG:{angle:160,stops:[['#0A192F',0],['#0B2036',.52],['#102A43',1]],
   glows:[{c:'#164E75',x:.08,y:.04,r:.62,a:.42},{c:'#4FC3F7',x:.90,y:.14,r:.50,a:.30},
    {c:'#0E3A5C',x:.82,y:.96,r:.46,a:.34},{c:'#102A43',x:.30,y:.90,r:.52,a:.42}]}},
// 深海潮汐 · Tide（深底冰蓝·参考 waves 项目 #0A192F / #4FC3F7）：深海蓝底 + 半透明深海蓝卡 + 冰蓝强调。
// 与参考大屏一致：极暗底色、青蓝光晕、冰蓝进度条、白蓝文字；失败保留暖红、浅底配色不在此主题。
tide:{GOLD:'#4FC3F7',WHITE:'#E6F7FF',LABEL:'rgba(179,229,252,.62)',MUTED:'rgba(179,229,252,.85)',TITLE_COLOR:'#E6F7FF',
  PANEL:'rgba(16,42,67,.72)',HEADER:'rgba(10,25,47,.88)',STRIPE:'rgba(255,255,255,.04)',TRACK:'rgba(179,229,252,.16)',
  okFill:'rgba(79,195,247,.16)',okText:'#4FC3F7',failFill:'rgba(255,107,107,.18)',failText:'#FF8A8A',
  pendFill:'rgba(179,229,252,.10)',pendText:'rgba(179,229,252,.55)',
  BORDER:'rgba(79,195,247,.18)',BORDER_IN:'rgba(79,195,247,.32)',LINE:'rgba(179,229,252,.12)',CELL_BG:'rgba(255,255,255,.05)',CELL_BORDER:'rgba(255,255,255,.10)',
  FLOAT:'rgba(10,25,47,.92)',FLOAT_TEXT:'#B3E5FC',FLOAT_RULE:'rgba(79,195,247,.35)',DIVIDER:'rgba(179,229,252,.30)',SUB_TEXT:'#8AB4D4',okBar:'#4FC3F7',failBar:'#FF6B6B',CANVAS:'#0A192F',
  ROWA:'rgba(255,255,255,.06)',ROWB:'rgba(255,255,255,.03)',CELL:'#E6F7FF',
  SHEEN:'rgba(255,255,255,.04)',STREAK:'rgba(255,255,255,.08)',GLASS_BLUR:18,
  SHADOW:'rgba(0,0,0,.45)',SHADOW_TIGHT:null,SHADOW_K:1.0,
  SHADOW_LAYERS:[{c:'rgba(0,0,0,.40)',y:6,b:20},{c:'rgba(79,195,247,.10)',y:2,b:8}],
  RIM_LIGHT:'rgba(255,255,255,.16)',RIM_DARK:'rgba(0,0,0,.40)',
  WATERMARK:'rgba(255,255,255,.22)',
  HINT_BG:'rgba(79,195,247,.06)',ACCENT_GRAD:['#4FC3F7','#00A3FF'],ACCENT_GLOW:'rgba(79,195,247,.45)',
  BG:{angle:160,stops:[['#0A192F',0],['#0D2138',.52],['#102A43',1]],
   glows:[{c:'#1E4D6B',x:.08,y:.04,r:.62,a:.38},{c:'#4FC3F7',x:.92,y:.18,r:.45,a:.18},
    {c:'#00A3FF',x:.82,y:.96,r:.42,a:.12},{c:'#0A192F',x:.30,y:.90,r:.50,a:.40}]}},
// 清透冰雾 · Crystal Mist（冷调浅色毛玻璃）：珍珠白/浅蓝灰底 + 冰川蓝主视觉 + 淡薰衣草辅助 + 薄荷点缀。
 // 核心：GLASS_TIERS 四档材质 —— clear(轻浮层) / frost(中层) / solid(主内容卡)。
 // 修正原则：主内容卡走厚乳白(solid)防止「糊」，透度差靠 clear/frost 体现，而非把主卡做透。
 crystal:{GOLD:'#2F86C4',WHITE:'#1B2430',LABEL:'#6B7280',MUTED:'#4B5563',TITLE_COLOR:'#1B2430',
  PANEL:'rgba(255,255,255,.78)',HEADER:'rgba(255,255,255,.86)',STRIPE:'rgba(38,55,70,.035)',TRACK:'rgba(38,55,70,.10)',
  okFill:'rgba(134,196,166,.18)',okText:'#2E7A58',failFill:'rgba(214,142,170,.18)',failText:'#A9496B',
  pendFill:'rgba(38,55,70,.06)',pendText:'#8296A6',
  BORDER:'rgba(255,255,255,.96)',BORDER_IN:'rgba(183,205,222,.52)',LINE:'rgba(38,55,70,.12)',CELL_BG:'rgba(255,255,255,.70)',CELL_BORDER:'rgba(255,255,255,.88)',
  FLOAT:'rgba(255,255,255,.94)',FLOAT_TEXT:'#4B5563',FLOAT_RULE:'rgba(38,55,70,.10)',DIVIDER:'rgba(38,55,70,.10)',SUB_TEXT:'#6B7280',
  okBar:'#63B189',failBar:'#CE7C9B',CANVAS:'#F7F9FC',ROWA:'rgba(255,255,255,.72)',ROWB:'rgba(255,255,255,.52)',CELL:'#1B2430',
  SHEEN:'rgba(255,255,255,.60)',STREAK:'rgba(255,255,255,.32)',GLASS_BLUR:30,SHADOW:'rgba(66,103,132,.16)',SHADOW_TIGHT:null,SHADOW_K:1.0,
  SHADOW_LAYERS:[{c:'rgba(66,103,132,.15)',y:10,b:32},{c:'rgba(66,103,132,.06)',y:2,b:9}],
  RIM_LIGHT:'rgba(255,255,255,.98)',RIM_DARK:'rgba(183,205,222,.58)',
  WATERMARK:'#9AA3AE',
  HINT_BG:'rgba(255,255,255,.60)',ACCENT_GRAD:['#8CCFF0','#2F86C4'],ACCENT_GLOW:'rgba(140,207,240,.34)',
  // 四档材质：a=白玻璃不透明度 / blur=背景漫射 / tint=玻璃底色 / shadowK=该档投影倍率 / sheenR & rimK=光泽与棱线倍率
  GLASS_TIERS:{
   clear:{a:.34,blur:18,tint:'255,255,255',shadowK:.55,sheenR:.85,rimK:.72},
   frost:{a:.54,blur:28,tint:'255,255,255',shadowK:1.0,sheenR:1.0,rimK:.95},
   solid:{a:.72,blur:38,tint:'255,255,255',shadowK:1.25,sheenR:1.05,rimK:1.05},
  },
  // BG 是玻璃感的「底料」：必须有大面积、可辨认的色场（冰蓝/薰衣草/薄荷），
  // 否则面板再透也只会透出一片白 → 看起来就是实心白卡。色场要够大够柔（r .55+），
  // 大到 blur 采样后仍是平滑色晕、而不是斑驳小块 —— 这才是「通透不糊」的分界线。
  BG:{angle:160,stops:[['#EFF5FB',0],['#E7EFF8',.55],['#DDE8F3',1]],
   glows:[{c:'#8FCCF2',x:.06,y:.04,r:.68,a:.80},{c:'#C3B2FF',x:.94,y:.26,r:.62,a:.66},
    {c:'#A3E2C6',x:.74,y:.98,r:.62,a:.60},{c:'#CFE7FA',x:.46,y:.56,r:.56,a:.46}]}},
}
// 底图（荧底片）铺层透明度：有 BG 色场的主题在「渐变之上、光晕之下」铺一层低透明度 masked 底图，
// 玻璃面板的离屏模糊会真实采样到它 → 毛玻璃质感更立体。null/缺省 = 不铺（env LOTUS_BG_ART=off 全局关）。
// 注意必须在 DARK 展开之前注入，否则冻结的 DARK 里没有 BG_ART 字段。
const BG_ART_OPACITY={abyss:.22,crystal:.18,mist:.18,ice:.18,aurora:.18,dawn:.16,saas:.12,tide:.18}
for(const[themeName,palette]of Object.entries(PALETTES)){
 if(palette.BG&&palette.BG_ART===undefined)palette.BG_ART=BG_ART_OPACITY[themeName]??null
}
// THEME 已在上面白名单校验过，这里仍保留兜底：任何未知取值一律回到 crystal
const DARK=Object.freeze({...PALETTES.dark,...(PALETTES[THEME]||PALETTES.crystal)})
const GOLD=DARK.GOLD,WHITE=DARK.WHITE,INK='#414e64'
const TEXT='"SourceMiao", MiSans, sans-serif'
const NUMBER='"SourceNumber", "SourceMiao", MiSans, sans-serif'
const TITLE='"SourceTitle", "SourceMiao", MiSans, sans-serif'
// 字重层次（MiSans 变量字体实测支持任意 wght：300 轻 → 700 粗，900 封顶到 700）。
// 目的：解决「全部同一字重 → 标题/标签/数值无区分 → 费眼」。按字族给默认权重，调用点零改动即得层次：
//   标题 700（Bold）/ 数值 600（Semibold）/ 正文·标签 500（Medium，CJK 小字比 Regular 更抗疲劳）。
const WEIGHTS={title:700,value:600,body:500}
const weightFor=(font)=>{const f=String(font||'');return f.includes('SourceTitle')?WEIGHTS.title:f.includes('SourceNumber')?WEIGHTS.value:WEIGHTS.body}
const fstr=(size,font,weight)=>`${weight||weightFor(font)} ${size}px ${font}`

// rgba 字符串的 alpha 缩放（openPanel 按层级/材质档调整阴影与高光浓度时用）
const scaleAlpha=(c,k)=>{if(!c)return c;const m=/rgba?\(([^)]+)\)/.exec(c);if(!m)return c;const a=m[1].split(',').map(s=>s.trim());if(a.length<4)return c;const na=Math.min(1,Math.max(0,parseFloat(a[3])*k));return `rgba(${a[0]},${a[1]},${a[2]},${na.toFixed(3)})`}

// #RGB / #RRGGBB + alpha → rgba()（背景光晕用）
const hexA=(hex,a)=>{const h=String(hex).replace('#','');const n=h.length===3?h.split('').map(c=>c+c).join(''):h;const v=parseInt(n,16);return `rgba(${(v>>16)&255},${(v>>8)&255},${v&255},${a})`}

// 浅底主题判定：看正文色 WHITE 的亮度 —— 深色正文 ⇒ 浅底卡主题。
// 用途：给「整页底色」类渲染器（图鉴页 / 星铁挑战页）判断该走浅底还是上游深底。
// 注意不能只看 DARK.BG：light 主题没有 BG 色场，但底色依然是浅的。
const luminance = hex => {
  const h = String(hex || '').replace('#', '')
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(n)) return 0
  const v = parseInt(n, 16)
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255
}
export const LIGHT_BASE = luminance(DARK.WHITE) > 0 && luminance(DARK.WHITE) < 0.5

// 主题背景绘制：有 BG 规格 → 线性渐变 + 大尺寸径向色场；无 → 纯色 DARK.CANVAS。
// 供「不走 SourceCanvas(bgPaint)」的渲染器复用（图鉴页 / 星铁挑战页），保证底色与通用卡片一致。
// 返回 true 表示已画渐变背景（有色场）；无色场时返回 false，但仍会填好 DARK.CANVAS 底色。
export function paintThemeBackground(ctx,w,h,spec=DARK.BG){
 if(!spec){ctx.fillStyle=DARK.CANVAS;ctx.fillRect(0,0,w,h);return false}
 const{stops,angle=135}=spec
 const rad=angle*Math.PI/180
 const dx=Math.sin(rad),dy=-Math.cos(rad)
 const len=Math.abs(dx)*w+Math.abs(dy)*h
 const cx=w/2,cy=h/2
 const g=ctx.createLinearGradient(cx-dx*len/2,cy-dy*len/2,cx+dx*len/2,cy+dy*len/2)
 for(const[c,pos]of stops)g.addColorStop(pos,c)
 ctx.fillStyle=g;ctx.fillRect(0,0,w,h)
 for(const gl of spec.glows||[]){
  const gx=gl.x*w,gy=gl.y*h,rr=gl.r*Math.max(w,h)
  const rg=ctx.createRadialGradient(gx,gy,0,gx,gy,rr)
  rg.addColorStop(0,hexA(gl.c,gl.a));rg.addColorStop(1,hexA(gl.c,0))
  ctx.fillStyle=rg;ctx.fillRect(0,0,w,h)
 }
 return true
}
export {THEME,PALETTES,DARK,GOLD,WHITE,INK,TEXT,NUMBER,TITLE,WEIGHTS,weightFor,fstr,scaleAlpha}
