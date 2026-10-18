import fs from 'node:fs/promises'
import path from 'node:path'
import {existsSync,readFileSync} from 'node:fs'
import {Canvas,FontLibrary,loadImage} from 'skia-canvas'
import {rootPath,resourcesPath} from '../path.js'
import {fetchImageBytes} from './image.js'
import {plainGameText} from './plain-text.js'
import {encodeGpuCanvas} from './gpu-buffer.js'
// 主题真源（色板 / 材质档 / 字体度量）——统一从 theme.js 取，见 core/render/theme.js
import {THEME,PALETTES,DARK,GOLD,WHITE,INK,TEXT,NUMBER,TITLE,WEIGHTS,weightFor,fstr,scaleAlpha,LIGHT_BASE} from './theme.js'

const ROOT=path.join(resourcesPath,'source-templates')
let fontsLoaded=false
const cache=new Map()

export const SOURCE_CARD_TEMPLATES=Object.freeze({
 'donate':'miao/help/index.html',
 'profile-card':'genshin/html/user/uid-list.html',
 'checkin-result':'miao/character/profile-stat.html',
 'schedule-notice':'miao/help/version-info.html',
 'checkin-stats':'miao/character/profile-stat.html',
 'help-menu':'miao/help/index.html',
 'weibo-checkin':'miao/character/profile-stat.html',
 'status':'miao/help/version-info.html',
 'qr-login':'miao/help/index.html',
 'genshin-team-damage':'miao/character/profile-stat.html',
 'starrail-team-damage':'miao/character/profile-stat.html',
 'achievement-index':'miao/character/profile-stat.html',
 'achievement-category':'miao/character/profile-stat.html',
 'zzz-rank':'miao/character/rank-profile-list.html',
 'douyin-info':'genshin/html/mysNews/mysNews.html',
 'douyin-article':'genshin/html/mysNews/mysNews.html',
 'bilibili-info':'genshin/html/mysNews/mysNews.html',
 'atlas-result':'genshin/html/mysNews-list/mysNews-list.html',
})

function init(){
 if(fontsLoaded)return
 // 字体文件多为未初始化的子模块资源（miao-theme / source-templates），缺失时跳过并回退 MiSans
 const regFont=(name,p)=>{ try{ if(existsSync(p)) FontLibrary.use(name,[p]) }catch{} }
 regFont('SourceMiao', path.join(resourcesPath,'miao-theme/fonts/HYWH-65W.ttf'))
 regFont('SourceNumber', path.join(ROOT,'miao-stat/fonts/tttgbnumber.ttf'))
 regFont('SourceTitle', path.join(ROOT,'miao-stat/fonts/NZBZ.ttf'))
 regFont('MiSans', path.join(resourcesPath,'fonts/MiSans-VF.ttf'))
 fontsLoaded=true
}
function resolveImage(src){
 if(/^\/meta-(?:gs|sr)\//.test(src))return path.join(process.cwd(),'plugins/miao-plugin/resources',src)
 if(/^file:\/\//.test(src))return new URL(src)
 return src
}
async function getImage(src){
 if(!src)return null
 const key=String(src)
 if(!cache.has(key)){
  const resolved=resolveImage(key)
  cache.set(key,(async()=>loadImage(/^https?:\/\//i.test(key)?await fetchImageBytes(key):resolved))().catch(()=>{cache.delete(key);return null}))
  if(cache.size>96)cache.delete(cache.keys().next().value)
 }
 return cache.get(key)
}

// Drawing primitives only. Layout and information order are defined separately
// for each original HTML/CSS template below; no old Lotus hero/grid/card shell.
class SourceCanvas{
 constructor(width){this.width=width;this.y=20;this.commands=[];this.refs=new Set();this.canvas=new Canvas(width,10);this.ctx=this.canvas.getContext('2d');this.bgPaint=null}
 lines(value,width,size=16,font=TEXT,weight){
  this.ctx.font=fstr(size,font,weight)
  const lines=[]
  for(const paragraph of plainGameText(value).split(/\r?\n/)){
   let line=''
   for(const token of paragraph.match(/[-+]?\d+(?:\.\d+)?%?|[A-Za-z][A-Za-z0-9.-]*|./gu)||[]){
    if(this.ctx.measureText(token).width<=width){if(line&&this.ctx.measureText(line+token).width>width){lines.push(line);line=''}line+=token}
    else for(const ch of token){if(line&&this.ctx.measureText(line+ch).width>width){lines.push(line);line=''}line+=ch}
   }
   lines.push(line)
  }
  return lines
 }
 rect(x,y,w,h,fill,radius=0){this.commands.push(ctx=>{ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,radius);ctx.fill()})}
 clip(x,y,w,h,radius=10){this.commands.push(ctx=>{ctx.save();ctx.beginPath();ctx.roundRect(x,y,w,h,radius);ctx.clip()})}
 restore(){this.commands.push(ctx=>ctx.restore())}
 rule(x,y,w,color='#ddd'){this.rect(x,y,w,1,color)}
 text(value,x,y,width,size=16,color=WHITE,options={}){
  const font=options.font||TEXT,weight=options.weight
  let lines
  if(options.singleLine){
   lines=[plainGameText(value).replace(/\s*\n\s*/g,' ')]
   this.ctx.font=fstr(size,font,weight)
   while(this.ctx.measureText(lines[0]).width>width&&size>(options.minSize||10)){size-=.5;this.ctx.font=fstr(size,font,weight)}
  }else lines=this.lines(value,width,size,font,weight)
  // 文字阴影只服务于「浅字压深底」的场景；浅底主题下深字再叠白晕只会糊成一团，直接不画
  const useShadow=!!options.shadow&&!LIGHT_BASE
  const leading=options.leading||size*1.5
  this.commands.push(ctx=>{ctx.save();ctx.font=fstr(size,font,weight);ctx.textBaseline='top';ctx.fillStyle=color;ctx.textAlign=options.align||'left';if(useShadow){ctx.shadowColor=DARK.WHITE;ctx.shadowBlur=2;ctx.shadowOffsetX=1;ctx.shadowOffsetY=1}lines.forEach((line,i)=>ctx.fillText(line,x+(options.align==='right'?width:options.align==='center'?width/2:0),y+i*leading));ctx.restore()})
  return lines.length*leading
 }
 image(src,x,y,w,h,options={}){
  if(!src)return
  this.refs.add(src)
  this.commands.push((ctx,images)=>{
   const img=images.get(src);if(!img)return
   ctx.save()
   if(options.radius){ctx.beginPath();ctx.roundRect(x,y,w,h,options.radius);ctx.clip()}
   const ratio=(options.cover?Math.max:Math.min)(w/img.width,h/img.height),dw=img.width*ratio,dh=img.height*ratio
   ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);ctx.restore()
  })
 }
 paragraph(value,size=14,color=WHITE,x=35,width=this.width-70){const h=this.text(value,x,this.y,width,size,color);this.y+=h+8;return h}
 heading(data){this.y+=10;this.y+=this.text(data.title||'荷花插件',35,this.y,this.width-70,36,WHITE,{font:TITLE,leading:42,shadow:true});if(data.subtitle)this.y+=this.text(data.subtitle,35,this.y+3,this.width-70,16,WHITE,{shadow:true})+6;this.y+=14}
 log(title,rows,lead=''){
  const top=this.y,w=this.width-25,x=10
  const titleH=this.lines(title,w-40,20).length*28+16
  const contents=[lead,...rows.map(row=>typeof row==='string'?row:`${row.label||row.title||''}：${row.value??row.body??''}`)].filter(Boolean)
  const heights=contents.map(value=>this.lines(value,w-65,14).length*22+8)
  const h=titleH+heights.reduce((a,b)=>a+b,0)+20
  this.clip(x,top,w,h,10)
  this.rect(x,top,w,h,DARK.PANEL)
  this.rect(x,top,w,titleH,DARK.HEADER)
  this.text(title,x+20,top+10,w-40,20,GOLD,{leading:28})
  let y=top+titleH+10
  contents.forEach((value,i)=>{this.text('•',x+20,y,15,14,WHITE);this.text(value,x+40,y,w-65,14,WHITE,{leading:22});y+=heights[i]})
  this.restore();this.y+=h+10
 }
 async render(template,data,options){
  const height=Math.max(240,this.y+50),displayScale=720/this.width
  this.height=height
  const wanted=Number(options.renderScale??data.renderScale??process.env.LOTUS_RENDER_SCALE??4)
  const scale=Number.isFinite(wanted)?Math.min(4,Math.max(1,wanted)):4
  this.canvas.width=Math.round(this.width*displayScale*scale);this.canvas.height=Math.ceil(height*displayScale*scale)
  const ctx=this.ctx;ctx.scale(displayScale*scale,displayScale*scale);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high'
  const images=new Map()
  await Promise.all([...this.refs].map(async src=>images.set(src,await getImage(src))))
  // 背景先画。毛玻璃需要在「离屏画布」上另渲一份，供玻璃面板做真·背景模糊采样
  // （背景渐变/光晕需要最终高度，故不能用普通 command）
   this.__deviceScale=displayScale*scale
   if(typeof this.bgPaint==='function'){
    const off=new Canvas(this.canvas.width,this.canvas.height)
    const octx=off.getContext('2d')
    octx.scale(this.__deviceScale,this.__deviceScale)
    octx.imageSmoothingEnabled=true;octx.imageSmoothingQuality='high'
    this.bgPaint(octx,height,images)
    this.__bgCanvas=off
   ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(off,0,0);ctx.restore()
  }
  for(const draw of this.commands)draw(ctx,images)
  const {buffer,tiles,format}=await encodeGpuCanvas(this.canvas,options)
  options.onRender?.({gpu:this.canvas.gpu,...this.canvas.engine,width:this.canvas.width,height:this.canvas.height,tiles,format,template,source:SOURCE_CARD_TEMPLATES[template],missingImages:[...images].filter(([,img])=>!img).map(([src])=>src)})
  if(options.path)await fs.writeFile(options.path,buffer)
  return globalThis.segment?.image?globalThis.segment.image(buffer):buffer
 }
}
// 元素背景图：优先 Lotus 自带 miao-theme，缺失时回退上游 miao-plugin 的 common/bg（自维护模式下子模块资源未初始化）
function themeBg(file){
 const own=path.join(resourcesPath,'miao-theme/bg',file)
 if(existsSync(own))return own
 const upstream=path.join(process.cwd(),'plugins/miao-plugin/resources/common/bg',file)
 return existsSync(upstream)?upstream:own
}
function elemental(p){
 // 毛玻璃主题：背景完全交给 bgPaint（渐变+光晕），这里绝不能再 push 纯色 command
 // —— commands 在背景 blit 之后执行，会整片盖掉渐变与光晕。
 if(DARK.BG){glassCanvas(p);return}
 p.rect(0,0,p.width,100000,DARK.CANVAS)
 if(THEME==='light')return            // 明亮主题：纯浅色底，不叠元素背景图
 const img=themeBg('bg-hydro.webp')
 p.commands.push((ctx,images)=>{const im=images.get(img);if(im)ctx.drawImage(im,0,0,p.width,p.height)})
 p.refs.add(img)
}
// #RGB / #RRGGBB + alpha → rgba()
function hexA(hex,a){
 const s=String(hex).replace('#','')
 const full=s.length===3?s.split('').map(c=>c+c).join(''):s
 const n=parseInt(full,16)
 return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`
}
// 荧底片：YingAIPrivate（荧·私聊端）ArtLibrary 管理的立绘清单，随机选一张作主题卡底图。
// 目录解析：env LOTUS_YING_ART_DIR > 兄弟插件目录 ../YingAIPrivate/resources/art；缺失/损坏一律 null（零回归）。
// env LOTUS_BG_ART=off 全局关闭。60s 缓存：同一分钟内多张卡共用同一张底片，避免视觉跳变。
let yingArtCache={at:0,file:null}
function yingArtPath(){
 if(String(process.env.LOTUS_BG_ART||'').toLowerCase()==='off')return null
 const now=Date.now()
 if(yingArtCache.file&&now-yingArtCache.at<60000)return yingArtCache.file
 yingArtCache={at:now,file:null}
 try{
  const dir=process.env.LOTUS_YING_ART_DIR||path.resolve(rootPath,'..','YingAIPrivate','resources','art')
  const manifestPath=path.join(dir,'manifest.json')
  if(existsSync(manifestPath)){
   const manifest=JSON.parse(readFileSync(manifestPath,'utf8'))
   const files=(manifest?.stickers||[]).map(item=>item?.file).filter(Boolean)
   if(files.length)yingArtCache.file=path.join(dir,files[Math.floor(Math.random()*files.length)])
  }
 }catch{}
 return yingArtCache.file
}
// 底图铺层：cover 铺满 → 离屏 destination-in 纵向遮罩（顶部全透、底部最实）→ 主题透明度叠到渐变上。
// 方形贴纸在长页上会被大幅放大成柔焦色斑 —— 低透明度下读作环境光纹理，不与文字抢对比。
function paintBgArt(ctx,img,w,h,opacity){
 try{
  const ratio=Math.max(w/img.width,h/img.height)
  const dw=img.width*ratio,dh=img.height*ratio
  const layer=new Canvas(Math.max(2,Math.round(w)),Math.max(2,Math.round(h)))
  const lc=layer.getContext('2d')
  lc.drawImage(img,(w-dw)/2,(h-dh)/2,dw,dh)
  lc.globalCompositeOperation='destination-in'
  const mask=lc.createLinearGradient(0,0,0,h)
  mask.addColorStop(0,'rgba(0,0,0,0)');mask.addColorStop(.45,'rgba(0,0,0,.45)');mask.addColorStop(1,'rgba(0,0,0,1)')
  lc.fillStyle=mask;lc.fillRect(0,0,w,h)
  ctx.save();ctx.globalAlpha=opacity;ctx.drawImage(layer,0,0,w,h);ctx.restore()
 }catch{}
}
// 毛玻璃背景：线性渐变（135°）+ 多个大尺寸径向光晕。用 bgPaint 在 render 阶段按最终高度绘制
function glassCanvas(p){
 const spec=DARK.BG
 const artFile=DARK.BG_ART?yingArtPath():null
 if(artFile)p.refs.add(artFile)
 p.bgPaint=(ctx,h,images)=>{
  const{stops,angle=135}=spec
  // CSS 语义角度：0°=向上、90°=向右、135°=右下。按「渐变线过画布中心 + 投影长度」计算，
  // 不能用 (cos,sin) 直接当终点（135° 会指向左下出界 → 全区被钳成单色）。
  const rad=angle*Math.PI/180
  const dx=Math.sin(rad),dy=-Math.cos(rad)
  const len=Math.abs(dx)*p.width+Math.abs(dy)*h
  const cx=p.width/2,cy=h/2
  const g=ctx.createLinearGradient(cx-dx*len/2,cy-dy*len/2,cx+dx*len/2,cy+dy*len/2)
  for(const[c,pos]of stops)g.addColorStop(pos,c)
  ctx.fillStyle=g;ctx.fillRect(0,0,p.width,h)
  // 荧底片：铺在渐变之上、光晕之下 —— 光晕最后叠，把底图染色融进主题色场
  const art=artFile&&images?images.get(artFile):null
  if(art)paintBgArt(ctx,art,p.width,h,DARK.BG_ART)
  for(const gl of spec.glows||[]){
   const cx=gl.x*p.width,cy=gl.y*h,rr=gl.r*Math.max(p.width,h)
   const rg=ctx.createRadialGradient(cx,cy,0,cx,cy,rr)
   rg.addColorStop(0,hexA(gl.c,gl.a));rg.addColorStop(1,hexA(gl.c,0))
   ctx.fillStyle=rg;ctx.fillRect(0,0,p.width,h)
  }
 }
}
function table(p,headers,rows,widths,caption){
 // 左边线与面板共用 SIDE（否则表格比同卡内的面板缩进 6px，看得出错位）；
 // 调用方给的列宽按可用宽度等比归一 —— 主题改过 SIDE 后也不至于让最后一列溢出被裁。
 const x=UI.SIDE,w=p.width-UI.SIDE*2
 widths ||= headers.map(()=>w/headers.length)
 const scale=w/(widths.reduce((sum,v)=>sum+v,0)||1)
 widths=widths.map(v=>v*scale)
 let y=p.y
 const entries=[headers,...rows].map(cells=>({cells,h:Math.max(36,...cells.map((cell,i)=>p.lines(cell?.label??cell,widths[i]-12-(cell?.image?36:0),14).length*21+14))}))
 const captionH=caption?p.lines(caption.title,w-40,18).length*26+20+(caption.description?p.lines(caption.description,w-40,14).length*22+16:0):0
 p.clip(x,y,w,captionH+entries.reduce((sum,row)=>sum+row.h,0),10)
 if(caption){
  p.rect(x,y,w,captionH,DARK.HEADER)
  const titleH=p.text(caption.title,x+20,y+10,w-40,18,GOLD,{leading:26})
  if(caption.description)p.text(caption.description,x+20,y+titleH+20,w-40,14,WHITE,{leading:22})
  y+=captionH
 }
 const grid=DARK.BORDER||'rgba(100,100,100,.3)'
 const paint=({cells,h},head,index)=>{
  p.rect(x,y,w,h,head?DARK.HEADER:index%2?DARK.ROWB:DARK.ROWA)
  let xx=x
  cells.forEach((cell,i)=>{if(cell?.image)p.image(cell.image,xx+3,y+3,30,30);const indent=cell?.image?36:0;p.text(cell?.label??cell,xx+6+indent,y+7,widths[i]-12-indent,14,head?GOLD:DARK.CELL,{leading:21});p.rule(xx,y,widths[i],grid);p.rect(xx,y,1,h,grid);xx+=widths[i]})
  y+=h
 }
 entries.forEach((row,i)=>paint(row,i===0,i-1));p.restore();p.y=y+14
}

function profile(p,data){
 elemental(p)
 p.heading({...data,title:data.title||'账号资料卡'})
 const groups=data.roleGroups?.length?data.roleGroups:data.roles?.map(role=>({label:role.label,rows:[{name:role.value}]}))||[]
 for(const group of groups){
  const top=p.y,x=10,w=p.width-25
  const rows=group.rows?.length?group.rows:[{name:'未同步游戏角色'}]
  const h=42+rows.length*76
  p.clip(x,top,w,h,10)
  p.rect(x,top,w,h,DARK.CELL_BG);p.rect(x,top,w,34,DARK.CELL_BG)
  p.text(group.label,x+15,top+8,w-30,16,DARK.WHITE)
  rows.forEach((row,i)=>{
   const y=top+42+i*76
   p.rect(x+9,y+20,18,22,row.active?GOLD:WHITE,6);p.text(i+1,x+9,y+23,18,14,DARK.WHITE,{align:'center'})
   p.rect(x+32,y,w-43,64,DARK.CELL_BG,33)
   if(row.banner)p.image(row.banner,x+32,y,w-43,64,{cover:true,radius:33})
   if(row.image){p.rect(x+36,y+4,56,56,DARK.CELL_BG,30);p.image(row.image,x+38,y+6,52,52,{cover:true,radius:30})}
   const xx=x+(row.image?104:48)
   p.text(row.uid||row.name,xx,y+9,w-(xx-x)-22,row.uid?24:16,DARK.MUTED,{font:row.uid?NUMBER:TEXT,leading:21})
   if(row.uid)p.text([row.name,row.level?`Lv.${row.level}`:'',row.active?'当前 UID':''].filter(Boolean).join(' · '),xx,y+38,w-(xx-x)-22,12,DARK.MUTED)
  });p.restore();p.y+=h+10
 }
 p.log('账号状态',data.account||[],data.summary)
 p.log('签到设置',data.settings||[])
 if(data.warnings?.length)p.log('提示',data.warnings)
}
// 体力 / 开拓力 / 电量面板已迁到 core/render/daily-note.js（ji-plugin dailyNote 版式复刻），
// 不再走通用 source-card 构建器 —— 旧的 beige 行表版 daily() 已删除。
// 每用户签到结果卡（checkin-result）：上游 miao `.cont` 深色卡。
// 精修：① 标题栏与其它签到卡统一（darkHeader 金字 + 右上徽标），去掉过重的 36px 白字标题；
//      ② 浅底深字表格 → 深色行 + 语义状态胶囊（原 16 个纯文字状态变为可扫视色块）；
//      ③ 列宽 / 行高 / 分隔线统一到 8pt 节奏。
function checkin(p,data){
 const {GOLD,WHITE,HEADER}=DARK
 bg(p);p.y=20
 const sub=[data.title,data.subtitle].filter(Boolean).join(' · ')
 darkHeader(p,'签到结果',sub,data.badge)
 const rows=Array.isArray(data.games)?data.games:[]
 if(rows.length){
  const x=UI.SIDE,w=p.width-UI.SIDE*2,pad=UI.PAD
  const c1=Math.round(w*0.36),c2=Math.round(w*0.32),c3=w-c1-c2
  const rowH=46,headH=42
  const h=headH+rows.length*rowH
  openPanel(p,x,p.y,w,h,UI.R.panel,DARK.PANEL,2,'solid')
  p.rect(x,p.y,w,headH,HEADER)
  const hy=p.y+14
  const headOpt={leading:UI.T.label[1],singleLine:true,minSize:10}
  // 列头统一走「标签＝中性灰」规则（不再用强调蓝，避免蓝色泛滥）
  p.text('游戏 / 社区',x+pad,hy,c1-pad-8,UI.T.label[0],DARK.LABEL,headOpt)
  p.text('游戏签到',x+c1,hy,c2-8,UI.T.label[0],DARK.LABEL,headOpt)
  p.text('社区签到',x+c1+c2,hy,c3-pad-8,UI.T.label[0],DARK.LABEL,headOpt)
  let ry=p.y+headH
  rows.forEach((r,i)=>{
   if(i%2===1)p.rect(x,ry,w,rowH,DARK.STRIPE)
   p.text(r.label||'-',x+pad,ry+15,c1-pad-8,UI.T.body[0],WHITE,{leading:UI.T.body[1],singleLine:true,minSize:11})
   pill(p,r.game||'未执行',x+c1,ry+13,c2-16)
   pill(p,r.community||'未执行',x+c1+c2,ry+13,c3-pad-8)
   if(i<rows.length-1)p.rule(x+pad,ry+rowH-1,w-pad*2,DARK.LINE)
   ry+=rowH
  })
  p.restore()
  p.y+=h+UI.SECTION
 }
 messageBlock(p,data.message)
}
// （主题 / 调色板已上移至文件头部：GOLD / WHITE 等模块常量由 DARK 派生，故所有 builder 自动跟随主题）
// 画布背景统一入口：由 elemental() 内部按主题处理（light → 浅色底；dark / glass → 元素背景图）
function bg(p){ elemental(p) }
// 面板材质（真 · 毛玻璃）：① 接触投影 → ② 主体填充+柔和投影 → ③ 真·背景模糊采样 → ④ 染色
// → ⑤ 顶部高光 → ⑥ 底部内阴影 → ⑦ 双色边缘。调用方画完内容后自行 p.restore()
// elev=1 小元件（磁贴/胶囊条）；elev=2 主卡（标题栏/分组卡）→ 投影更深，形成层级
// ⚠️ p.__bgCanvas 在 render() 阶段才创建，所以「是否走玻璃」必须在**命令执行期**判定；
//    构建期判定会恒为 false → 模糊/染色被跳过、接触投影裸露把卡面压暗（已踩过此坑）。
// 数值框（信息设计核心）：给数值一个独立「容器」，与标签分离 —— 借自工控屏 UI 的「标签 + 白框」栅格。
// 数据不再直接浮在玻璃上，而是各占一个白框；框体比面板更白 + 细边，形成清晰的cell感。
function valueBox(p,x,y,w,h,text,opt={}){
 const size=opt.size||14,align=opt.align||'left',pad=opt.pad??10
 const bg=opt.bg||DARK.CELL_BG||DARK.PANEL,bd=opt.border||DARK.CELL_BORDER
 p.commands.push(ctx=>{
  ctx.save()
  ctx.fillStyle=bg
  ctx.beginPath();ctx.roundRect(x,y,w,h,UI.R.cell);ctx.fill()
  if(bd){ctx.lineWidth=1;ctx.strokeStyle=bd;ctx.beginPath();ctx.roundRect(x+.5,y+.5,w-1,h-1,UI.R.cell);ctx.stroke()}
  ctx.restore()
 })
 if(text==null||text==='')return
 p.text(String(text),align==='center'?x:x+pad,y+(h-size*1.3)/2+1,align==='center'?w:w-pad*2,size,
  opt.color||DARK.WHITE,{font:opt.font||NUMBER,align,leading:size*1.3,singleLine:true,minSize:9})
}
// 内棱（内阴影倒角）：在「面板」与「反向偏移后的面板」之间挖出一条带 → 形成边缘棱线。
// 左上白高光用正向偏移、右下冷色内影用反向偏移，两条棱叠加＝玻璃的立体感。
function innerRim(p,x,y,w,h,r,dx,dy,color){
 p.commands.push(ctx=>{
  ctx.save()
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.clip()
  ctx.beginPath()
  ctx.roundRect(x+dx,y+dy,w,h,r)
  ctx.rect(-99999,-99999,199998,199998)
  ctx.fillStyle=color
  ctx.fill('evenodd')
  ctx.restore()
 })
}
// 透明度倍率：把 rgba 颜色的 alpha 乘 k（按层级缩放边缘反光 / 高光强度，不改色相）
function openPanel(p,x,y,w,h,r,fill=DARK.PANEL,elev=1,mat=null){
 // 层级阶梯：z3 标题栏（浮在内容之上）/ z2 主内容卡 / z1 小元件（磁贴 · 胶囊）。
 // 四要素同增形成明确「上 / 下」层次感：投影更大更深 + 边缘反光更强 + 顶部高光更亮 + 玻璃更厚。
 const z=elev>=3?3:elev>=2?2:1
 // 材质档（Crystal Mist）：mat='clear'|'frost'|'solid' → 决定白玻璃不透明度 a 与背景漫射 blur。
 // 未配置 GLASS_TIERS 的主题忽略 mat，退回「调用方 fill + 主题 GLASS_BLUR」旧行为（零回归）。
 const tier=(mat&&DARK.GLASS_TIERS)?DARK.GLASS_TIERS[mat]:null
 const blurPx=tier?tier.blur:DARK.GLASS_BLUR
 const paint =tier?`rgba(${tier.tint||'255,255,255'},${tier.a})`:fill
 const glass=()=>!!(blurPx&&p.__bgCanvas)
 const sk      =(DARK.SHADOW_K||1)*(tier&&tier.shadowK?tier.shadowK:1) // 主题 × 材质投影缩放
 const kShadow=(z===3?3.2:z===2?1.8:1)*sk // 双层带色阴影倍率
 const shBlur =(z===3?60:z===2?32:20)*sk  // 柔和投影模糊半径
 const shY    =(z===3?22:z===2?11:5)*sk   // 柔和投影下移
 const rimK   =(z===3?1.5:z===2?0.95:0.68)*(tier&&tier.rimK?tier.rimK:1) // 内棱反光强度倍率
 const sheenK =(z===3?1.35:z===2?0.95:0.78)*(tier&&tier.sheenR?tier.sheenR:1) // 顶高光 / 镜面反光带 / 玻璃厚度倍率
 // ⓪ 双层「带色」外阴影（设计规格：紧层 #1265E8 22% / 宽层 #0E62E7 7%，模糊按卡尺度放大）。
 //    必须用**不透明**填充：canvas 阴影不透明度会乘以源 alpha，半透明填充会把阴影一起削弱。
 //    这两块填充随后被 ② 的模糊背景整片覆盖，只在卡外留下投影。
 if(DARK.SHADOW_LAYERS)p.commands.push(ctx=>{
  if(!glass())return
  const k=kShadow
  for(const sh of DARK.SHADOW_LAYERS){
   ctx.save()
   ctx.shadowColor=sh.c;ctx.shadowBlur=sh.b*k;ctx.shadowOffsetY=sh.y*k
   ctx.fillStyle=DARK.WHITE
   ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill()
   ctx.restore()
  }
 })
 // ① 接触投影（未配置 SHADOW_LAYERS 的主题的回退方案）
 if(DARK.SHADOW_TIGHT)p.commands.push(ctx=>{
  if(!glass())return
  ctx.save()
  ctx.filter=`blur(${z===3?10:z===2?8:5}px)`
  ctx.fillStyle=DARK.SHADOW_TIGHT
  ctx.beginPath();ctx.roundRect(x+3,y+(z===3?11:z===2?8:5),w-6,h-3,r);ctx.fill();ctx.restore()
 })
 // ② 主体填充 + 柔和投影（不裁剪，否则投影被裁掉）
 p.commands.push(ctx=>{
  ctx.save()
  if(DARK.SHADOW){ctx.shadowColor=DARK.SHADOW;ctx.shadowBlur=shBlur;ctx.shadowOffsetY=shY}
  ctx.fillStyle=paint
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill()
  ctx.restore()
 })
 p.clip(x,y,w,h,r)
 // ③ 真·背景模糊采样（磨砂核心）：把玻璃后方的背景替换成它的模糊版本（模糊半径随材质档变化）
 p.commands.push(ctx=>{
  if(!glass())return
  ctx.save();ctx.setTransform(1,0,0,1,0,0)
  ctx.filter=`blur(${(blurPx*((p.__deviceScale)||1)).toFixed(1)}px)`
  ctx.drawImage(p.__bgCanvas,0,0)
  ctx.filter='none';ctx.restore()
 })
 // ④ 玻璃染色（③是不透明的模糊背景，需再单独上一次色）
 p.commands.push(ctx=>{
  if(!glass())return
  ctx.save();ctx.fillStyle=paint
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();ctx.restore()
 })
 // ⑤ 顶部高光（玻璃光泽）
 if(DARK.SHEEN)p.commands.push(ctx=>{
  const g=ctx.createLinearGradient(x,y,x,y+Math.min(h*.55,90))
  g.addColorStop(0,scaleAlpha(DARK.SHEEN,sheenK));g.addColorStop(1,'rgba(255,255,255,0)')
  ctx.save();ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();ctx.restore()
 })
 // ⑤b 镜面反光带：对角亮条 —— 玻璃最典型的「反光」符号，比单纯顶部渐变更像玻璃
 if(DARK.STREAK)p.commands.push(ctx=>{
  const g=ctx.createLinearGradient(x,y+h,x+w,y)
  g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(.30,'rgba(255,255,255,0)')
  g.addColorStop(.44,scaleAlpha(DARK.STREAK,sheenK));g.addColorStop(.60,'rgba(255,255,255,0)')
  g.addColorStop(1,'rgba(255,255,255,0)')
  ctx.save();ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();ctx.restore()
 })
 // ⑥ 底部内阴影（玻璃厚度感）
 p.commands.push(ctx=>{
  if(!glass())return
  const g=ctx.createLinearGradient(x,y+h*.52,x,y+h)
  g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,'+(0.075*sheenK).toFixed(3)+')')
  ctx.save();ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();ctx.restore()
 })
 // ⑥ 1px 高光描边
 // ⑥b 内阴影倒角（光影质感核心）：左上白高光 + 右下冷蓝内影，反向偏移挖带
 const ri=Math.max(0,r-1)
 if(DARK.RIM_LIGHT)innerRim(p,x+1,y+1,w-2,h-2,ri,2,2,scaleAlpha(DARK.RIM_LIGHT,rimK))
 if(DARK.RIM_DARK)innerRim(p,x+1,y+1,w-2,h-2,ri,-2,-2,scaleAlpha(DARK.RIM_DARK,rimK))
 // ⑦ 双色边缘：外层亮白高光 + 内层极淡冷色暗边 → 玻璃棱线立起来（白卡上单靠白边看不见）
 if(DARK.BORDER){
  p.commands.push(ctx=>{
   ctx.save();ctx.lineWidth=1.4;ctx.strokeStyle=DARK.BORDER
   ctx.beginPath();ctx.roundRect(x+.7,y+.7,w-1.4,h-1.4,r);ctx.stroke();ctx.restore()
  })
  p.commands.push(ctx=>{
   ctx.save();ctx.lineWidth=1;ctx.strokeStyle=DARK.BORDER_IN||'rgba(15,23,42,.10)'
   ctx.beginPath();ctx.roundRect(x+2.2,y+2.2,w-4.4,h-4.4,Math.max(0,r-1.5));ctx.stroke();ctx.restore()
  })
 }
}
// 强调竖条：有 ACCENT_GRAD → 发光渐变条（青→紫）；否则纯色（dark/light 保持原样）
function accentBar(p,x,y,w,h,r=2){
 if(!DARK.ACCENT_GRAD){p.rect(x,y,w,h,DARK.GOLD,r);return}
 p.commands.push(ctx=>{
  ctx.save()
  ctx.shadowColor=DARK.ACCENT_GLOW||DARK.ACCENT_GRAD[0];ctx.shadowBlur=12
  const g=ctx.createLinearGradient(x,y,x,y+h)
  g.addColorStop(0,DARK.ACCENT_GRAD[0]);g.addColorStop(1,DARK.ACCENT_GRAD[1])
  ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();ctx.restore()
 })
}
// 横向强调条（分组卡顶部）：有 ACCENT_GRAD → 渐变；否则纯色
function accentBarH(p,x,y,w,h=4){
 if(!DARK.ACCENT_GRAD){p.rect(x,y,w,h,DARK.GOLD);return}
 p.commands.push(ctx=>{
  const g=ctx.createLinearGradient(x,y,x+w,y)
  g.addColorStop(0,DARK.ACCENT_GRAD[0]);g.addColorStop(1,DARK.ACCENT_GRAD[1])
  ctx.save();ctx.fillStyle=g;ctx.fillRect(x,y,w,h);ctx.restore()
 })
}
// ---- 签到卡片设计 token（8pt 栅格 + 统一圆角 / 字号阶梯；色板沿用上游 DARK，不改调性）----
// SIDE 侧边距 · GAP 组件间隙 · PAD 面板内边距 · SECTION 区块间距
// R   圆角（面板/磁贴/进度条）
// T   字号阶梯 [size, lineHeight]：display(英雄数字) / title / sub / section / label / value / body / note / pill
// 系统化原则（v3）：① 拉开字阶 —— 大得更大（display 34）、小得更小（label 11.5），中间层收敛；
//   ② 留白加大 —— SIDE/PAD/SECTION 全上调；③ 圆角成「节奏」而非单一值（面板 28 / 磁贴 20 / 控件 12 / 胶囊 999）。
// LINE 行分隔线 · ROW_ALT 斑马纹 · TRACK 进度条轨道（提高深色底对比度）
const UI=Object.freeze({
 SIDE:16,GAP:14,PAD:20,SECTION:20,
 R:{panel:28,tile:20,cell:12,bar:999},
 T:{display:[34,40],title:[22,28],sub:[13.5,19],section:[16,23],label:[11.5,16],value:[19,25],body:[13.5,20],note:[12,18],pill:[12,16]},
 // 分隔线 / 斑马纹 / 进度条底色一律走 DARK.LINE / DARK.STRIPE / DARK.TRACK（随主题），
 // 不要在 UI 里另留一套固定白色 alpha token —— 那会在浅底主题上隐身。
})
// 状态归一：成功族→ok / 失败族→fail / 关闭·未执行·无→off
function statusKind(v){
 const s=String(v??'').trim()
 if(!s)return 'off'
 if(/成功|已完成|已开启|已注册|已发送|已投递|正常|通过|已重写|已签/.test(s))return 'ok'
 if(/失败|错误|异常|不可用|拒绝|超时/.test(s))return 'fail'
 return 'off'
}
// 统一状态胶囊：文本自适应宽度，二/三态语义配色一致；返回实际占用宽度（便于横向排布）
function pill(p,text,x,y,maxW=200,kind){
 const k=kind||statusKind(text)
 const fill=k==='ok'?DARK.okFill:k==='fail'?DARK.failFill:DARK.pendFill
 const tc=k==='ok'?DARK.okText:k==='fail'?DARK.failText:DARK.pendText
 const size=UI.T.pill[0]
 p.ctx.font=fstr(size,TEXT)
 const w=Math.min(maxW,Math.max(46,Math.ceil(p.ctx.measureText(String(text)).width)+18))
 const h=20
 p.rect(x,y,w,h,fill,10)
 p.text(String(text),x,y+3,w,size,tc,{align:'center',leading:UI.T.pill[1],singleLine:true,minSize:10})
 return w
}
// 统一说明块：左金色强调条 + 半透明黑面板
// 说明块：毛玻璃主题下渲染为「更扁的胶囊 + 更小字号 + 极低透明度」（HINT_BG）
function messageBlock(p,text){
 if(!text)return
 const {PANEL,MUTED,HINT_BG}=DARK
 const x=UI.SIDE,w=p.width-UI.SIDE*2
 const glass=!!HINT_BG
 const size=glass?12:UI.T.body[0],lh=glass?18:UI.T.body[1]
 const padY=glass?9:UI.PAD/2+2
 const h=p.lines(text,w-UI.PAD*2-6,size).length*lh+padY*2+4
 openPanel(p,x,p.y,w,h,glass?Math.min(16,h/2):UI.R.panel,HINT_BG||PANEL,1,'clear')
 p.text(text,x+UI.PAD,p.y+padY,w-UI.PAD*2,size,MUTED,{leading:lh})
 p.restore();p.y+=h+UI.SECTION
}
// 深色卡标题栏（上游 .cont-title）：rgba(0,0,0,.40) + 金色标题 + 金色左标（可带右上徽标）
function darkHeader(p,title,subtitle,badge){
 const {GOLD,HEADER,okFill,failFill,okText,failText}=DARK
 const topY=p.y
 const btext=badge!=null&&String(badge)!==''?String(badge):''
 let bw=0
 if(btext){p.ctx.font=fstr(15,NUMBER);bw=Math.min(190,Math.max(56,p.ctx.measureText(btext).width+28))}
 const tw=p.width-UI.SIDE*2-UI.PAD*2-(bw?bw+UI.GAP:0)
 const titleLines=p.lines(title,tw,UI.T.title[0],TITLE).length||1
 const subLines=subtitle?p.lines(subtitle,tw,UI.T.sub[0]).length:0
 const h=UI.PAD+titleLines*UI.T.title[1]+(subLines?subLines*UI.T.sub[1]+4:0)+UI.PAD
 openPanel(p,UI.SIDE,topY,p.width-UI.SIDE*2,h,UI.R.panel,HEADER,3,'solid')
 let ty=topY+UI.PAD-2
 ty+=p.text(title,UI.SIDE+UI.PAD,ty,tw,UI.T.title[0],DARK.TITLE_COLOR||GOLD,{font:TITLE,leading:UI.T.title[1]})
 if(subtitle)p.text(subtitle,UI.SIDE+UI.PAD,ty+2,tw,UI.T.sub[0],DARK.LABEL,{leading:UI.T.sub[1]})
 p.restore()
 if(btext){
  const bad=statusKind(btext)==='fail'
  const bx=p.width-UI.SIDE-UI.PAD-bw,by=topY+UI.PAD-1
  p.clip(bx,by,bw,24,12)
  p.rect(bx,by,bw,24,bad?failFill:okFill)
  p.text(btext,bx,by+5,bw,15,bad?failText:okText,{font:NUMBER,align:'center',singleLine:true,minSize:11})
  p.restore()
 }
 p.y=topY+h+UI.SECTION
}
// 主人汇总看板（checkin-stats）：现代 SaaS 版式（去边框 / 留白分区 / 单色进度 / 网格对齐）
// 数据来自 services/checkin/statsBuilder.js（与自动推送、手动 #签到看板 同源）。
function checkinStats(p,data){
 const {GOLD,WHITE,LABEL,SUB_TEXT,TRACK,okText,failText,pendText,LINE}=DARK
 const accent=DARK.ACCENT_GRAD?DARK.ACCENT_GRAD[1]:GOLD
 bg(p);p.y=20
 darkHeader(p,data.title||'实时签到看板',data.subtitle)
 const S=UI.SIDE,P=UI.PAD,G=UI.GAP

 // 概览：6 项合并为一条横向指标长条（单面板 + 浅灰竖线分隔；数字加粗在上、标签在下）
 const summary=data.summary||[]
 if(summary.length){
  const cols=Math.min(6,summary.length),x=S,w=p.width-S*2,barH=88,cw=w/cols
  openPanel(p,x,p.y,w,barH,UI.R.panel,DARK.PANEL,1,'frost')
  summary.forEach((it,i)=>{
   const cx=x+i*cw
   if(i>0)p.rect(cx,p.y+22,1,barH-44,LINE)
   p.text(String(it.value),cx+P,p.y+18,cw-P*2,32,WHITE,{font:NUMBER,leading:38,singleLine:true,minSize:18})
   p.text(it.label,cx+P,p.y+60,cw-P*2,11.5,LABEL,{leading:16,singleLine:true,minSize:10})
  })
  p.restore()
  p.y+=barH+UI.SECTION
 }

 // 群组卡（纯白卡 · 无边框 · 无内部嵌套框）
 const PRIMARY=['原神','星铁','绝区零','社区']
 const STYLE=(process.env.LOTUS_ROW_STYLE||'text').toLowerCase()
 const kindOf=(m,k)=>{
  const gr=(Array.isArray(m.games)?m.games:[]).find(z=>z&&z.label===k)
  if(!gr)return {k:'none',gr:null}
  const sv=k==='社区'?(gr.community||'?'):(gr.game||'?')
  if(sv==='关闭')return {k:'off',gr}
  return {k:statusKind(sv),gr}
 }
 for(const g of data.groups||[]){
  const members=Array.isArray(g.members)?g.members:[]
  const x=S,w=p.width-S*2,gy=p.y
  const headH=118,rowH=46
  const kpiH=STYLE==='minimal'?74:0
  const colH=(STYLE==='text'||STYLE==='bar')?30:0
  const h=Math.max(124,headH+kpiH+colH+members.length*rowH+10)
  openPanel(p,x,gy,w,h,UI.R.panel,DARK.PANEL,1,'solid')

  // 群名（标题级）+ 达成率（英雄级大字 · 强调色，与进度条同色）
  p.text(`群 ${g.groupId}`,x+P,gy+P,w-P*2-170,UI.T.title[0],WHITE,{leading:UI.T.title[1],singleLine:true,minSize:15})
  p.text(g.rate||'-',x+w-P-176,gy+P-8,176,UI.T.display[0],accent,{font:NUMBER,align:'right',leading:UI.T.display[1],singleLine:true,minSize:22})

  // 单色进度条（加粗到 8px，更像「数据条」而非细线）
  const barX=x+P,barY=gy+P+48,barW=w-P*2,barH=8
  const okR=g.total?Math.min(1,(g.ok||0)/g.total):0
  p.rect(barX,barY,barW,barH,TRACK,UI.R.bar)
  if(okR>0)p.rect(barX,barY,Math.max(barH,barW*okR),barH,accent,UI.R.bar)

  // 统计：单行内联（不再用第二套 4 列网格，避免与下方游戏列错位打架）
  if(STYLE!=='minimal'){
   const statLine=`已签 ${g.done||0}/${g.total||0}　·　成功 ${g.ok||0}　·　失败 ${g.fail||0}　·　待签 ${g.pending||0}`
   p.text(statLine,x+P,gy+P+72,w-P*2,UI.T.label[0],SUB_TEXT,{leading:UI.T.label[1],singleLine:true,minSize:11})
  }

  // 成员区（三种候选版式：LOTUS_ROW_STYLE = text | bar | minimal）
  const iconW=22,nameW=112,timeW=62
  const leftW=iconW+nameW
  let cy=gy+headH

  // —— minimal：把「逐游戏明细」上提为群级 4 格 KPI，成员行只留姓名+达成+时间
  if(STYLE==='minimal'){
   const gw=(w-P*2-G*3)/4,lim=g.total||members.length||1
   PRIMARY.forEach((k,i)=>{
    const sx=x+P+i*(gw+G)
    let okC=0
    for(const m of members)if(kindOf(m,k).k==='ok')okC++
    const r=lim?Math.min(1,okC/lim):0
    p.text(k,sx,cy,60,UI.T.label[0],LABEL,{leading:UI.T.label[1],singleLine:true,minSize:10})
    p.text(`${okC}/${lim}`,sx,cy-2,gw,20,WHITE,{font:NUMBER,align:'right',leading:24,singleLine:true,minSize:13})
    const my=cy+32,mh=5
    p.rect(sx,my,gw,mh,TRACK,UI.R.bar)
    if(r>0)p.rect(sx,my,Math.max(mh,gw*r),mh,accent,UI.R.bar)
   })
   cy+=kpiH
  }

  // —— text / bar：表头只写一次游戏名；bar 的表头按段落对齐
  let segX=0,segW=0
  if(STYLE==='text'){
   const gx=x+P+leftW+10
   const gW=Math.max(200,w-P*2-leftW-10-timeW-10),colW=gW/4
   PRIMARY.forEach((k,i)=>p.text(k,gx+i*colW,cy+4,colW-6,UI.T.label[0],LABEL,{leading:UI.T.label[1],singleLine:true,minSize:9}))
   p.rule(x+P,cy+24,w-P*2,LINE)
   cy+=colH
  }else if(STYLE==='bar'){
   segX=x+P+leftW+16
   segW=Math.min(244,Math.max(160,(x+w-P)-segX-timeW-16))
   const unit=(segW-12)/4
   PRIMARY.forEach((k,i)=>p.text(k,segX+i*(unit+4),cy+4,unit,UI.T.label[0],LABEL,{leading:UI.T.label[1],singleLine:true,minSize:9}))
   p.rule(x+P,cy+24,w-P*2,LINE)
   cy+=colH
  }

  if(!members.length){
   p.text('（该群暂无已部署成员）',x+P,cy+6,w-P*2,UI.T.body[0],LABEL,{leading:UI.T.body[1]})
  }else{
   const rowsY=cy
   for(let i=0;i<members.length;i++){
    const m=members[i],ry=rowsY+i*rowH
    const st=m.status==='ok'?'ok':m.status==='fail'?'fail':'off'
    const icon=st==='ok'?'✓':st==='fail'?'✕':'○'
    const iconColor=st==='ok'?okText:st==='fail'?failText:pendText
    p.text(icon,x+P,ry+13,iconW,15,iconColor,{align:'center',leading:20})
    p.text(String(m.name||m.qq||'未知'),x+P+iconW,ry+13,nameW,14,WHITE,{leading:20,singleLine:true,minSize:11})

    if(STYLE==='text'){
     const gx=x+P+leftW+10
     const gW=Math.max(200,w-P*2-leftW-10-timeW-10),colW=gW/4
     PRIMARY.forEach((k,ci)=>{
      const cx=gx+ci*colW,{k:kind,gr}=kindOf(m,k)
      const cellW=colW-6
      if(kind==='none'){p.text('—',cx,ry+14,cellW,UI.T.note[0],pendText,{leading:UI.T.note[1],singleLine:true});return}
      const isComm=k==='社区'
      // 双色单元格：状态字形着色 + 文案回归中性墨色（仅失败保留红）→ 消掉「彩虹文字墙」
      const gch=kind==='ok'?'✓':kind==='fail'?'✕':kind==='off'?'—':'·'
      const gcol=kind==='ok'?okText:kind==='fail'?failText:pendText
      const txt=kind==='ok'?(isComm?'已签':(gr.days?`${gr.days}天`:'已签')):kind==='fail'?'失败':kind==='off'?'关闭':'待签'
      const tcol=kind==='fail'?failText:(kind==='ok'?SUB_TEXT:pendText)
      p.text(gch,cx,ry+14,14,UI.T.note[0],gcol,{leading:UI.T.note[1],singleLine:true})
      p.text(txt,cx+17,ry+14,cellW-17,UI.T.note[0],tcol,{leading:UI.T.note[1],singleLine:true,minSize:10})
     })
    }else if(STYLE==='bar'){
     const unit=(segW-12)/4
     PRIMARY.forEach((k,ci)=>{
      const {k:kind}=kindOf(m,k)
      const color=kind==='ok'?accent:kind==='fail'?failText:TRACK
      p.rect(segX+ci*(unit+4),ry+17,unit,11,color,5.5)
     })
    }else{
     // minimal：右侧「已签 n/4」整体达成，无逐游戏明细
     let n=0,off=0
     for(const k of PRIMARY){const r=kindOf(m,k);if(r.k==='ok')n++;if(r.k!=='none')off++}
     const okAll=off>0&&n===off
     const txt=off?`已签 ${n}/${off}`:'—'
     const color=off?(okAll?okText:n===0?failText:LABEL):pendText
     p.text(txt,x+w-P-timeW-70-14,ry+14,70,UI.T.note[0],color,{align:'right',leading:UI.T.note[1],singleLine:true,minSize:10})
    }

    if(m.time)p.text(m.time,x+w-P-timeW,ry+14,timeW,UI.T.note[0],LABEL,{font:NUMBER,align:'right',leading:UI.T.note[1],singleLine:true})
    if(i<members.length-1)p.rule(x+P,ry+rowH-1,w-P*2,LINE)
   }
  }
  p.restore()
  p.y+=h+UI.SECTION
 }
}
// 帮助菜单（help-menu）：**对标 Mys-plugin 帮助大图的分区版式重构** ——
//   ① 每分组一条「渐变分区头」（圆角条：白粗组名 + 组说明 + 右侧条目数徽标，配色走主题 ACCENT_GRAD）；
//   ② 条目 = 图标磁贴网格：每条 = 渐变图标块（取指令首字）+ 粗体指令组 + 灰色说明，双栏栅格；
//   ③ 底部统一提示条「输入 #荷花帮助 <分组> 查看分组详情」。
//   色彩全部来自主题系统色板（DARK / ACCENT_GRAD），不引入新调色板。
// 数据来自 apps/help.js（GROUPS 为唯一权威索引）。`#荷花帮助 <分组>` 下钻单组（单栏更易读）。
// 两种全览版式（LOTUS_HELP_STYLE，仅影响「多分组总览」；单分组下钻恒为图文详情）：
//   full （默认）= 分区头 + 双栏「图标+指令+说明」磁贴网格
//   index        = 分区头 + 单行内联指令索引（指令扁平化后 · 分隔，不给逐条说明）
function helpMenu(p,data){
 const {WHITE,LABEL,GOLD,MUTED,PANEL,LINE,HINT_BG,ACCENT_GRAD,ACCENT_GLOW}=DARK
 bg(p);p.y=20
 darkHeader(p,data.title||'荷花插件 · 命令菜单',data.subtitle)
 const S=UI.SIDE,P=UI.PAD
 const groups=data.groups||data.categories||[]
 const HSTYLE=(process.env.LOTUS_HELP_STYLE||'full').toLowerCase()
 const INDEX=HSTYLE==='index'&&groups.length>1
 const COLS=groups.length>1?2:1      // 全览双栏；下钻单组单栏（条目更长，单栏更好读）
 const GUT=UI.GAP*2
 const tSize=13.5,tLH=19,dSize=11.5,dLH=16,cSize=12.5,cLH=19,ROWGAP=12,ICON=26,HEADH=46
 // 渐变圆角条（分区头 / 图标块共用）：有 ACCENT_GRAD → 主题渐变 + 微光；否则回退 HEADER 纯色
 const gradRect=(x,y,w,h,r,glow)=>{
  if(!ACCENT_GRAD){p.rect(x,y,w,h,DARK.HEADER,r);return}
  p.commands.push(ctx=>{
   ctx.save()
   if(glow){ctx.shadowColor=ACCENT_GLOW||ACCENT_GRAD[0];ctx.shadowBlur=9}
   const g=ctx.createLinearGradient(x,y,x,y+h)
   g.addColorStop(0,ACCENT_GRAD[0]);g.addColorStop(1,ACCENT_GRAD[1])
   ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();ctx.restore()
  })
 }
 groups.forEach(grp=>{
  const items=grp.items||grp.list||[]
  const x=S,w=p.width-S*2,gy=p.y,innerW=w-P*2
  const noteLines=grp.note?p.lines(grp.note,innerW,dSize).length:0
  const noteH=noteLines?12+16+noteLines*dLH:0        // 上留白 + 分隔线 + 提示文字

  // —— 先测量（与绘制严格一致，否则卡高会错）——
  let gridH=0,rows=null,cmdText='',colW=0
  if(INDEX){
   // 精简索引：条目只保留指令，按 / 扁平化后用 · 内联排布
   const cmds=[]
   for(const it of items)for(const c of String(it.title||'').split('/'))if(c.trim())cmds.push(c.trim())
   cmdText=cmds.join('   ·   ')
   gridH=p.lines(cmdText,innerW,cSize,TEXT,500).length*cLH
  }else{
   colW=(innerW-GUT*(COLS-1))/COLS
   rows=[]
   for(let i=0;i<items.length;i+=COLS){
    const cells=[]
    for(let c=0;c<COLS&&i+c<items.length;c++){
     const it=items[i+c]
     const textW=colW-ICON-10
     const tl=Math.max(1,p.lines(String(it.title||''),textW,tSize,NUMBER,600).length)
     const dl=it.desc?p.lines(String(it.desc),textW,dSize).length:0
     cells.push({it,tl,dl,h:Math.max(ICON,tl*tLH+(dl?2+dl*dLH:0))})
    }
    rows.push({cells,h:Math.max(...cells.map(c=>c.h))})
   }
   gridH=rows.length?rows.reduce((s,r)=>s+r.h,0)+(rows.length-1)*ROWGAP:0
  }
  const h=P+HEADH+10+gridH+noteH+P
  openPanel(p,x,gy,w,h,UI.R.panel,PANEL,2,'frost')
  // ① 渐变分区头：组名（白粗）+ 组说明（半透明白）+ 右侧条目数徽标
  const hy=gy+P,hh=HEADH-8,hw=w-P*2
  gradRect(x+P,hy,hw,hh,14,true)
  p.text(grp.name,x+P+14,hy+6,hw-130,15,DARK.WHITE,{font:TITLE,leading:20,singleLine:true,weight:700,minSize:12})
  if(grp.desc)p.text(grp.desc,x+P+14,hy+25,hw-140,10,'rgba(255,255,255,.72)',{leading:13,singleLine:true,minSize:8.5})
  const cnt=grp.auth?`仅主人 · ${items.length} 项`:`${items.length} 项`
  p.text(cnt,x+P+hw-124,hy+13,110,10.5,'rgba(255,255,255,.85)',{align:'right',leading:14,singleLine:true,minSize:9})
  // ② 条目区
  let ly=gy+P+HEADH+10
  const bodyTop=ly
  if(INDEX){
   p.text(cmdText,x+P,ly,innerW,cSize,WHITE,{leading:cLH,weight:500})
  }else{
   rows.forEach(row=>{
    row.cells.forEach((c,ci)=>{
     const cx=x+P+ci*(colW+GUT)
     // 图标磁贴：渐变圆角块 + 指令首字
     gradRect(cx,ly,ICON,ICON,8,false)
     const glyph=String(c.it.title||'').replace(/^#+/,'').trim().charAt(0)||'?'
     p.text(glyph,cx,ly+5,ICON,13,DARK.WHITE,{font:TITLE,align:'center',leading:16,singleLine:true})
     // 指令组（粗体）+ 说明（次级灰）
     p.text(String(c.it.title||''),cx+ICON+10,ly,colW-ICON-10,tSize,WHITE,{font:NUMBER,leading:tLH,weight:600})
     if(c.it.desc)p.text(String(c.it.desc),cx+ICON+10,ly+c.tl*tLH+2,colW-ICON-10,dSize,LABEL,{leading:dLH})
    })
    ly+=row.h+ROWGAP
   })
  }
  // 提示行：细分隔线 + 弱化小字（注意事项 / 使用约束）
  if(noteLines){
   ly=bodyTop+gridH+12
   p.rule(x+P,ly,innerW,LINE)
   ly+=16
   p.text(grp.note,x+P,ly,innerW,dSize,MUTED,{leading:dLH})
  }
  p.restore()
  p.y=gy+h+UI.SECTION
 })
 // ③ 底部提示条（对标参考图「如需功能详细说明请输入…」）：胶囊条 + 左侧渐变竖标
 if(groups.length){
  const tip='如需功能详细说明，请输入  #荷花帮助 <分组>  查看对应分组'
  const th=36
  openPanel(p,S,p.y,p.width-S*2,th,18,HINT_BG||PANEL,1,'clear')
  accentBar(p,S+12,p.y+12,4,12,2)
  p.text(tip,S+26,p.y+10,p.width-S*2-40,12,MUTED,{leading:16,singleLine:true,minSize:10})
  p.restore()
  p.y+=th+UI.SECTION
 }
}
// 微博超话签到结果卡（weibo-checkin）：上游 miao `.cont` 深色卡配色。数据来自 apps/weibo.js。
// 精修：磁贴与说明块统一到 token 节奏（内嵌金色强调条替代贴边全高色条），标题栏支持徽标。
function weiboCheckin(p,data){
 const {GOLD,WHITE,LABEL}=DARK
 bg(p);p.y=20
 darkHeader(p,data.title||'微博超话签到',data.subtitle,data.badge)
 const r=data.result||{}
 const summary=[{label:'成功',value:String(r.signed||0)},{label:'已签',value:String(r.skipped||0)},{label:'失败',value:String(r.failed||0)},{label:'总计',value:String(r.total||0)}]
 const S=UI.SIDE,P=UI.PAD,G=UI.GAP
 const cols=4,tileW=(p.width-S*2-G*(cols-1))/cols,tileH=76
 for(let i=0;i<summary.length;i++){
  const col=i%cols,row=Math.floor(i/cols)
  const tx=S+col*(tileW+G),ty=p.y+row*(tileH+G)
  openPanel(p,tx,ty,tileW,tileH,UI.R.tile)
  p.text(summary[i].label,tx+P,ty+11,tileW-P*2,12,LABEL,{leading:17,singleLine:true,minSize:9})
  valueBox(p,tx+P,ty+32,tileW-P*2,32,String(summary[i].value),{size:17})
  p.restore()
 }
 p.y+=Math.ceil(summary.length/cols)*(tileH+G)+UI.SECTION
 messageBlock(p,data.message)
}

// 通用状态 / 结果卡（status / schedule-notice）：沿用上游 miao `.cont` 深色卡配色——
//   元素背景图 (elemental) + 半透明黑面板 rgba(0,0,0,.40/.50) + 金色标题 #d3bc8e + 白色正文，
//   与上游 help/version-info.css 的 .cont-title(rgba(0,0,0,.4)/#d3bc8e) 与 .cont-body(rgba(0,0,0,.5)/#fff) 一致。
// 覆盖全部 renderStatusCard({title,subtitle,badge,message,items:[{label,value}]}) 调用（约 45 处）。
// 数据契约不变：数值型 items → 顶部磁贴；其余 → 明细行（成功/失败渲染为状态胶囊）；message → 底部说明。
// 精修：① 标题栏/徽标改用共享 darkHeader（消除重复实现）；② 磁贴与行内边距统一到 token；
//      ③ 短状态值改为「右对齐胶囊」（label …… [成功] 形成规整栅格），长文案仍左对齐并换行；
//      ④ 斑马纹/分隔线宽度与内边距对齐，纵向节奏统一 8pt。
function logs(p,data){
 const {GOLD,WHITE,LABEL,MUTED}=DARK
 bg(p);p.y=20
 darkHeader(p,data.title||'荷花插件',data.subtitle,data.badge)
 const S=UI.SIDE,P=UI.PAD,G=UI.GAP

 // 归一化 items（兼容字符串项 / label|title / value|body）
 const items=(Array.isArray(data.items)?data.items:[])
  .map(it=>typeof it==='string'?{label:it,value:''}:{label:String(it?.label??it?.title??''),value:String(it?.value??it?.body??'')})
  .filter(it=>it.label||it.value)
 const IDENT=/^账号|^群号|^UID|^uid|^QQ|^qq|wxid/
 const smallNum=v=>/^\d{1,4}(?:\s*\/\s*\d{1,4})?$|^\d{1,2}:\d{2}$/.test(String(v).trim())
 const tiles=[],rows=[]
 for(const it of items){
  if(tiles.length<4&&smallNum(it.value)&&!IDENT.test(it.label))tiles.push(it)
  else rows.push(it)
 }
 const w=p.width-S*2

 // 数值磁贴（成功数 / 失败数 / 总数 …）：半透明黑面板 + 内嵌金色强调条
 // 只有一个磁贴时按 3 列宽渲染，避免独占整行显得空旷
 if(tiles.length){
  const cols=tiles.length===1?3:Math.min(4,tiles.length)
  const tileW=(w-G*(cols-1))/cols,tileH=76
  for(let i=0;i<tiles.length;i++){
   const col=i%cols,row=Math.floor(i/cols),tx=S+col*(tileW+G),ty=p.y+row*(tileH+G)
   openPanel(p,tx,ty,tileW,tileH,UI.R.tile,DARK.PANEL,1,'clear')
   p.text(tiles[i].label,tx+P,ty+11,tileW-P*2,12,LABEL,{leading:17,singleLine:true,minSize:9})
   valueBox(p,tx+P,ty+32,tileW-P*2,32,String(tiles[i].value),{size:17})
   p.restore()
  }
  p.y+=Math.ceil(tiles.length/cols)*(tileH+G)+UI.SECTION
 }

 // 明细行（上游 .cont-body：rgba(0,0,0,.5) + 白字）
 if(rows.length){
  const x=S,pad=P
  const labelW=Math.min(320,Math.floor(w*0.46))
  const valueX=x+pad+labelW+G
  const valueW=x+w-pad-valueX
  const laid=rows.map(r=>{
   const st=statusKind(r.value)
   const isPill=!!r.value&&st!=='off'&&String(r.value).length<=10
   const vl=isPill?1:(r.value?p.lines(r.value,valueW,UI.T.body[0]).length:1)
   return{r,st,isPill,h:Math.max(36,vl*UI.T.body[1]+14)}
  })
  const h=laid.reduce((s,r)=>s+r.h,0)+8
  openPanel(p,x,p.y,w,h,UI.R.panel,DARK.PANEL,2,'solid')
  accentBarH(p,x,p.y,w,4)
  let ry=p.y+4
  laid.forEach((row,i)=>{
   const rh=row.h
   if(i%2===1)p.rect(x+2,ry,w-4,rh,DARK.STRIPE)
   p.text(row.r.label,x+pad,ry+Math.max(9,(rh-UI.T.body[1])/2),labelW,UI.T.body[0],WHITE,{leading:UI.T.body[1],singleLine:true,minSize:11})
   if(row.isPill){
    p.ctx.font=fstr(UI.T.pill[0],TEXT)
    const pw=Math.min(valueW,Math.max(52,Math.ceil(p.ctx.measureText(row.r.value).width)+22))
    pill(p,row.r.value,valueX+valueW-pw,ry+(rh-22)/2,pw,row.st)
   }else if(row.r.value){
    const vs=String(row.r.value)
    if(vs.length<=16){
     // 短值也进白框（容器化）；长文案保持整段排布，避免被框切碎
     p.ctx.font=fstr(13,NUMBER)
     const bw=Math.min(valueW,Math.ceil(p.ctx.measureText(vs).width)+26),bh=26
     valueBox(p,valueX+valueW-bw,ry+(rh-bh)/2,bw,bh,vs,{size:13,align:'center',color:MUTED})
    }else{
     p.text(vs,valueX,ry+Math.max(8,(rh-UI.T.body[1])/2),valueW,UI.T.body[0],MUTED,{leading:UI.T.body[1]})
    }
   }
   if(i<laid.length-1)p.rule(x+pad,ry+rh-1,w-pad*2,DARK.LINE)
   ry+=rh
  })
  p.restore();p.y+=h+UI.SECTION
 }

 messageBlock(p,data.message)
}
async function donate(p,data){
 // Miao help/index: head-box followed by titled cont-box groups. Replace
 // each help-table's entries with the original payment poster and caption.
 // 配色已接入主题：浅底主题用主题色场 + darkHeader/说明块 + 玻璃面板；
 // 只有上游深底主题才铺那张深色背景照片（否则「深色照片 + 深墨正文」不可读）。
 if(DARK.BG)bg(p)
 else{
  const background=path.join(ROOT,'miao/common/theme/bg-01.jpg')
  p.refs.add(background)
  p.commands.push((ctx,images)=>{
   const img=images.get(background);if(!img)return
   for(let y=0;y<p.height;y+=img.height)for(let x=0;x<p.width;x+=img.width)ctx.drawImage(img,x,y)
  })
  p.image(path.join(ROOT,'miao/common/theme/main-01.png'),0,0,p.width,800)
 }
 p.y=20
 darkHeader(p,data.title||'赏赞')
 messageBlock(p,data.message)
 const S=UI.SIDE,P=UI.PAD
 const methods=await Promise.all((data.methods||[]).map(async method=>{
  const image=await getImage(method.image)
  if(!image)throw new Error(`捐赠收款码加载失败：${method.title}`)
  return {...method,src:method.image,ratio:image.height/image.width}
 }))
 if(!methods.length)return
 const cols=Math.min(2,methods.length),gap=UI.GAP,labelH=30
 const columnWidth=(p.width-S*2-gap*(cols-1))/cols,imageWidth=columnWidth-P*2
 const posters=methods.map(m=>({...m,height:imageWidth*m.ratio}))
 const posterHeight=Math.max(...posters.map(m=>m.height))
 const captionHeight=Math.max(...posters.map(m=>p.lines(m.notice,columnWidth-P*2,UI.T.note[0]).length*UI.T.note[1]))
 const panelHeight=P+labelH+posterHeight+16+captionHeight+P
 const top=p.y
 posters.forEach((method,index)=>{
  const x=S+(index%cols)*(columnWidth+gap),y=top+Math.floor(index/cols)*(panelHeight+gap)
  openPanel(p,x,y,columnWidth,panelHeight,UI.R.panel,DARK.PANEL,2,'solid')
  p.text(method.title,x+P,y+P,columnWidth-P*2,UI.T.sub[0],GOLD,{align:'center',weight:600,leading:labelH,singleLine:true,minSize:11})
  p.image(method.src,x+P,y+P+labelH+(posterHeight-method.height)/2,imageWidth,method.height)
  p.text(method.notice,x+P,y+P+labelH+posterHeight+16,columnWidth-P*2,UI.T.note[0],DARK.SUB_TEXT,{align:'center',leading:UI.T.note[1]})
  p.restore()
 })
 p.y=top+Math.ceil(posters.length/cols)*(panelHeight+gap)
}
function qr(p,data){
 bg(p);p.y=20
 darkHeader(p,data.title||'扫码登录',data.subtitle||`profile ${data.profileId||1}`,data.badge)
 const S=UI.SIDE,P=UI.PAD
 const gy=p.y,w=p.width-S*2,qrSize=360
 const notice=data.notice||'请使用对应 App 扫码确认。'
 const noticeLines=p.lines(notice,w-P*2,UI.T.body[0]).length
 const labelH=26,labelGap=14,platePad=14
 const qrTop=P+labelH+labelGap
 const h=qrTop+qrSize+platePad*2+22+noticeLines*UI.T.body[1]+P
 openPanel(p,S,gy,w,h,UI.R.panel,DARK.PANEL,2,'solid')
 p.text('扫码确认',S+P,gy+P,w-P*2,UI.T.sub[0],GOLD,{align:'center',weight:600,leading:labelH})
 // 二维码底盘：QR 必须高对比，固定近白底 + 1px 描边（先描边层再白底层，等价于 stroke），不随深色主题反转
 const qx=(p.width-qrSize)/2,qy=gy+qrTop
 p.rect(qx-platePad-1,qy-platePad-1,qrSize+platePad*2+2,qrSize+platePad*2+2,DARK.BORDER_IN||DARK.LINE,UI.R.cell)
 p.rect(qx-platePad,qy-platePad,qrSize+platePad*2,qrSize+platePad*2,'#FFFFFF',UI.R.cell)
 p.image(data.qrDataUrl,qx,qy,qrSize,qrSize)
 p.text(notice,S+P,qy+qrSize+platePad+22,w-P*2,UI.T.body[0],DARK.SUB_TEXT,{align:'center',leading:UI.T.body[1]})
 p.restore()
 p.y=gy+h+UI.SECTION
}

function statBackground(p,sr=false){
 // 有主题色场（crystal/mist/saas…）时直接用主题背景；上游深底主题才铺深色元素照片。
 // 否则浅底主题会变成「深色照片 + 深墨色标题」= 不可读。
 if(DARK.BG){bg(p);return}
 p.rect(0,0,p.width,100000,DARK.CANVAS)
 const background=path.join(ROOT,`miao/character/imgs/bg-0${sr?2:1}.jpg`)
 p.refs.add(background)
 p.commands.push((ctx,images)=>{
  const img=images.get(background);if(!img)return
  // Match profile-stat's CSS: background-size: 100% auto; left center; repeat.
  const tileHeight=p.width*img.height/img.width,origin=(p.height-tileHeight)/2
  const first=origin-Math.ceil(origin/tileHeight)*tileHeight
  for(let y=first;y<p.height;y+=tileHeight)ctx.drawImage(img,0,y,p.width,tileHeight)
 })
 p.image(path.join(ROOT,`miao/character/imgs/main-0${sr?2:1}.png`),0,-25,p.width,900)
}
function summaries(p,rows){if(rows?.length)table(p,rows.map(r=>r.label),[rows.map(r=>r.value)])}
const damageNumber=n=>Number(n||0).toLocaleString('zh-CN',{maximumFractionDigits:1})
// ================= 队伍伤害：已迁移到 core/render/team-damage.js =================
// 原生复刻 genshin resources/Genshin/html/dmg/damage.*（提瓦特小助手 / FanSky_Qs 版式，
// 参考图页脚 Designed by Aozaki Arina）。它是「自带底色的品牌面板」（miao bg-{elem}.webp 元素星云底
// + 深色半透面板），不读 DARK/LOTUS_THEME，与 daily-note.js / starrail-abyss.js 同类。
// skia.js 对 genshin-team-damage / starrail-team-damage 直接分发到 renderTeamDamage，不再走本文件。
function achievements(p,data){
 statBackground(p);p.heading(data);summaries(p,data.summary)
 if(data.categories?.length)table(p,['分类','已完成','原石','完成率'],data.categories.map(c=>[{label:c.name,image:c.icon},`${c.completed}/${c.total}`,`${c.pointsDone}/${c.pointsTotal}`,`${c.percent}%`]),[270,100,105,p.width-500])
 for(const group of data.groups||[]){
  const title=`${group.name} · ${group.completed}/${group.total} · 原石 ${group.pointsDone}/${group.pointsTotal}`
  table(p,['阶段 / 状态','成就说明','原石 / 进度'],(group.stages||[]).map(s=>[`${s.stageTotal>1?`${s.stageIndex}/${s.stageTotal}`:'单项'} · ${s.done?'已完成':'未完成'}${s.date?'\n'+s.date:''}`,s.desc||s.name,`${s.points} 原石\n${s.progress||'未记录'}`]),[120,p.width-240,95],{title,description:group.desc})
 }
 if(data.message)p.log('说明',[data.message])
 if(data.hiddenCount)p.log('下一页',[`还有 ${data.hiddenCount} 个分组，请使用下一页指令继续查看。`])
}
function rank(p,data){
 elemental(p);p.heading(data)
 if(!data.list?.length){p.log('群排名',['群成员尚未保存该代理人的面板。']);return}
 for(const [i,row]of data.list.entries()){
  const x=10,y=p.y,w=p.width-25
  // rank-profile-list's single horizontal strip: rank, circular face, name/UID,
  // six talent badges, weapon, score. More height only when names need wrapping.
  const skills=['普攻','闪避','支援','特殊','连携','核心'].map((name,j)=>({name,level:row.skills?.[[0,2,5,1,3,4][j]]?.level??'未记录'}))
  const titleLines=p.lines(row.name||data.character,110,18)
  const h=Math.max(74,28+titleLines.length*24)
  p.rect(x,y,w,h,DARK.PANEL,10)
  p.text(i+1,x+3,y+24,32,18,GOLD,{align:'center'})
  p.image(row.icon,x+43,y+10,50,50,{cover:true,radius:25})
  p.text(row.name||data.character,x+103,y+8,110,18,GOLD,{leading:24})
  p.text(`${row.uid} · ${row.rank??0}影`,x+103,y+10+titleLines.length*24,110,12,WHITE)
  const skillX=x+224,skillW=37
  skills.forEach((s,j)=>{const xx=skillX+j*skillW;p.text(s.name,xx,y+10,skillW,11,WHITE,{align:'center'});p.rect(xx+5,y+33,27,21,DARK.CELL_BG,5);p.text(s.level,xx+5,y+37,27,12,DARK.WHITE,{align:'center'})})
  const weaponX=skillX+6*skillW+12,weaponW=150
  p.rect(weaponX-6,y+8,1,h-16,DARK.DIVIDER)
  if(row.weapon?.icon)p.image(row.weapon.icon,weaponX,y+16,36,36)
  p.text(row.weapon?.name||'音擎未装配',weaponX+40,y+10,weaponW-42,13,GOLD,{leading:18})
  p.text(row.weapon?`Lv.${row.weapon.level} · ${row.weapon.star}星`:'',weaponX+40,y+47,weaponW-42,12,WHITE)
  const scoreX=weaponX+weaponW+12,scoreW=w-(scoreX-x)-5
  p.rect(scoreX-6,y+8,1,h-16,DARK.DIVIDER)
  p.text(row.score_label,scoreX,y+12,scoreW,12,DARK.SUB_TEXT);p.text(row.score_value,scoreX,y+34,scoreW,18,WHITE,{font:NUMBER})
  p.y+=h+10
 }
}
async function newsImage(p,src){
 if(!src)return
 const img=await getImage(src)
 if(!img){p.image(src,30,p.y,p.width-60,200);p.y+=215;return}
 const w=p.width-60,h=w*img.height/img.width
 p.image(src,30,p.y,w,h,{radius:14});p.y+=h+20
}
function mediaStats(data,template){
 const s=data.stat||{},format=n=>n===undefined?'未记录':damageNumber(n)
 const stats=data.type==='live'?[['直播状态',data.liveStatus],['在线人数',format(data.online)]]:[['点赞',format(s.like)],['评论',format(s.reply)],['收藏',format(s.favorite)],...(template==='bilibili-info'?[['投币',format(s.coin)],['播放',format(s.view)],['弹幕',format(s.danmaku)]]:[['分享',format(s.share)]])]
 return stats.map(([label,value])=>`${label} ${value||'未记录'}`).join('    ')
}
async function news(p,data,template){
 // genshin mysNews content order inside Miao help/index's elemental, rounded
 // group container. Keep the article typography and real cover/media content.
 elemental(p)
 const frame={height:0}
 p.commands.push(ctx=>{ctx.fillStyle=DARK.FLOAT;ctx.beginPath();ctx.roundRect(15,20,p.width-30,frame.height,15);ctx.fill()})
 p.y=40
 const owner=data.owner||'作者资料未记录'
 if(data.avatar)p.image(data.avatar,35,p.y,90,90,{cover:true,radius:45})
 p.text(owner,data.avatar?143:35,p.y+16,p.width-(data.avatar?178:70),30,GOLD,{leading:50})
 p.text(template==='douyin-article'?`第 ${data.page||1} 页`:data.id||'',data.avatar?143:35,p.y+66,p.width-(data.avatar?178:70),22,DARK.FLOAT_TEXT)
 p.y+=130
 p.rule(30,p.y-5,p.width-60,DARK.FLOAT_RULE)
 p.y+=p.text(data.title||'作品信息',30,p.y,p.width-60,44,WHITE,{leading:60})+20
 if(template==='douyin-article'){
  for(const block of data.blocks||[]){
   if(block.type==='image')for(const src of block.urls||[])await newsImage(p,src)
   else if(block.text)p.y+=p.text(block.text,30,p.y,p.width-60,22,WHITE,{leading:36})+16
  }
 }else{
  const metadata=[data.type==='live'?'直播':data.type==='gallery'?'图集':data.type==='article'?'文章':'视频',data.duration?`${Math.floor(data.duration/60)}分${Math.floor(data.duration%60)}秒`:'',data.createdAt?new Date(data.createdAt*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'',data.media?.length?`${data.media.length} 个媒体项`:''].filter(Boolean).join(' · ')
  p.y+=p.text(metadata,30,p.y,p.width-60,18,GOLD,{leading:28})+20
  await newsImage(p,data.cover||data.image)
  if(data.desc)p.y+=p.text(data.desc,30,p.y,p.width-60,22,WHITE,{leading:36})+20
  if(data.music?.title)p.y+=p.text(`音乐：${data.music.title} · ${data.music.author||''}`,30,p.y,p.width-60,18,DARK.FLOAT_TEXT)+20
  if(data.collection?.title)p.y+=p.text(`合集：${data.collection.title}`,30,p.y,p.width-60,18,DARK.FLOAT_TEXT)+20
  if(data.sources?.length)p.y+=p.text(`可用视频源：${data.sources.map(source=>[source.quality||'清晰度未记录',source.width&&source.height?`${source.width}×${source.height}`:'',source.codec||''].filter(Boolean).join(' ')).join(' / ')}`,30,p.y,p.width-60,18,DARK.FLOAT_TEXT)+20
  for(const warning of data.warnings||[])p.y+=p.text(warning,30,p.y,p.width-60,18,DARK.FLOAT_TEXT)+16
  p.rule(30,p.y,p.width-60,DARK.FLOAT_RULE);p.y+=22
  p.y+=p.text(mediaStats(data,template),30,p.y,p.width-60,18,GOLD,{leading:28})+18
 }
 frame.height=p.y-10;p.y+=15
}
function searchResults(p,data){
 bg(p);p.y=20
 const titleHeight=p.lines(data.title||'图鉴搜索结果',p.width-110,30).length*36+70
 p.rect(15,p.y,p.width-30,titleHeight,DARK.CELL_BG,15)
 p.image(path.join(ROOT,'genshin/html/mysNews-list/蒙德.png'),15,p.y,p.width-30,titleHeight,{cover:true,radius:15})
 p.text(data.title||'图鉴搜索结果',55,p.y+35,p.width-110,30,DARK.WHITE,{font:NUMBER,leading:36});p.y+=titleHeight+20
 const rows=data.items||[]
 if(!rows.length){p.rect(15,p.y,p.width-30,90,DARK.CELL_BG,15);p.text(data.message||'没有找到图鉴结果。',35,p.y+24,p.width-70,18,DARK.SUB_TEXT);p.y+=110}
 for(const [i,row]of rows.entries()){
  const y=p.y,w=p.width-30,textWidth=row.image?325:p.width-124
  const titleH=p.lines(row.title,textWidth,22).length*28,descH=p.lines(row.desc||'',textWidth,18).length*30
  const h=Math.max(row.image?166:90,titleH+descH+70)
  p.rect(15,y,w,h,DARK.CELL_BG,15)
  p.text(i+1,35,y+24,40,26,DARK.WHITE,{font:NUMBER,align:'center'})
  p.text(row.title,89,y+24,textWidth,22,DARK.WHITE,{leading:28})
  p.text(row.desc||'',89,y+titleH+38,textWidth,18,DARK.SUB_TEXT,{leading:30})
  p.text(row.meta||'',89,y+titleH+descH+49,textWidth,14,DARK.SUB_TEXT)
  if(row.image)p.image(row.image,p.width-277,y+26,242,124,{radius:8})
  if(i<rows.length-1)p.rule(35,y+h-1,p.width-70)
  p.y+=h+8
 }
}

export async function renderSourceCard(template,data={},options={}){
 init()
 const widths={'profile-card':450,'checkin-result':600,'qr-login':620,'status':600,'schedule-notice':600,'checkin-stats':1120,'help-menu':720,'weibo-checkin':600,'achievement-index':760,'achievement-category':760,'zzz-rank':820,'douyin-info':900,'douyin-article':900,'bilibili-info':900,'atlas-result':700}
 const p=new SourceCanvas(template==='donate'?830:widths[template]||600)
 const builders={'profile-card':profile,'checkin-result':checkin,'status':logs,'schedule-notice':logs,'checkin-stats':checkinStats,'help-menu':helpMenu,'weibo-checkin':weiboCheckin,'qr-login':qr,'achievement-index':achievements,'achievement-category':achievements,'zzz-rank':rank,'douyin-info':news,'douyin-article':news,'bilibili-info':news,'atlas-result':searchResults}
 builders.donate=donate
 if(!builders[template])throw new Error(`No source template implementation: ${template}`)
 await builders[template](p,data,template)
 // footer 字色：light 主题全局用浅字；dark/glass 下仅 genshin 浅底模板（atlas-result）用浅字
 const light=THEME==='light'||template==='atlas-result'
 const footer=[...(p.footerNotes||[]),`荷花插件${data.generatedAt?' · '+data.generatedAt:''}`]
 // 页脚：毛玻璃主题降为水印级（WATERMARK 低透明度、去投影）；浅底用更深的灰保证 12px 对比度
 const footerColor=DARK.WATERMARK||(light?(THEME==='light'?'#55606d':'#597487'):WHITE)
 p.text(footer.join('\n'),15,p.y+15,p.width-30,12,footerColor,{align:'center',shadow:!light&&!DARK.WATERMARK,leading:18})
 p.y+=(footer.length-1)*18
 return p.render(template,data,options)
}
