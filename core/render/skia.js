import fs from 'node:fs/promises'
import {renderStarRailAbyss} from './starrail-abyss.js'
import {renderAtlasPage} from './atlas-pages.js'
import {renderDailyNotePanel} from './daily-note.js'
import {renderTeamDamage} from './team-damage.js'
import {renderGenshinAbyss} from './genshin-abyss.js'
import {renderSourceCard,SOURCE_CARD_TEMPLATES} from './source-cards.js'

// Every registered card enters an implementation adapted from an identified
// Yunzai / genshin / Miao source. The former Lotus renderer is removed entirely.
export async function renderWithSkia(templateName,data={},options={}){
 const normalized={pluginName:'荷花插件',...data}
 if(templateName==='atlas-page'||['atlas-item','atlas-challenge'].includes(templateName)){
  return renderAtlasPage({...normalized,template:templateName,view:normalized.view||{
   game:normalized.item?.game||'',page:normalized.item?.page||'图鉴资料',description:normalized.message||'',
  }},options)
 }
 if(templateName==='starrail-challenge'){
  const buffer=await renderStarRailAbyss(normalized,options)
  if(options.path)await fs.writeFile(options.path,buffer)
  return globalThis.segment?.image?globalThis.segment.image(buffer):buffer
 }
 // 体力 / 开拓力 / 电量面板：原生复刻 ji-plugin dailyNote 版式（不走通用 source-card 构建器）
 if(templateName==='daily-note-summary'){
  const buffer=await renderDailyNotePanel(normalized,options)
  if(options.path)await fs.writeFile(options.path,buffer)
  return globalThis.segment?.image?globalThis.segment.image(buffer):buffer
 }
 // 队伍伤害（原神 / 星铁）：原生复刻 genshin resources/Genshin/html/dmg/damage.* 版式（品牌面板，不走主题真源）
if(templateName==='genshin-team-damage'||templateName==='starrail-team-damage'){
 const buffer=await renderTeamDamage({...normalized,sr:templateName==='starrail-team-damage'},options)
 if(options.path)await fs.writeFile(options.path,buffer)
 return globalThis.segment?.image?globalThis.segment.image(buffer):buffer
}
// 原神深境螺旋：原生复刻 genshin resources/Genshin/html/abyss/abyss.* 版式（品牌面板，不走主题真源）
if(templateName==='genshin-abyss'){
 const buffer=await renderGenshinAbyss(normalized,options)
 if(options.path)await fs.writeFile(options.path,buffer)
 return globalThis.segment?.image?globalThis.segment.image(buffer):buffer
}
if(SOURCE_CARD_TEMPLATES[templateName])return renderSourceCard(templateName,normalized,options)
 throw new Error(`未注册来源模板：${templateName}`)
}
