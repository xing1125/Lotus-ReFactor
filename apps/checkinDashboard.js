// 签到实时后台（HTTP 看板）
//
// 需求：管理员想在浏览器里看到「实时签到状态 + 滚动日志」，而不用发 #签到看板 刷卡片。
//
// 实现：
//   - 挂载在 TRSS-Yunzai 自带 express（Bot.express，默认端口 2536）上：
//       GET /lotus/checkin                看板页面（深色 tide 主题，手机可用）
//       GET /lotus/checkin/api/status     状态：当日计划汇总 + 按群成员明细 + 正在签到
//       GET /lotus/checkin/api/logs       日志：内存事件环形缓冲增量轮询（core/checkinLog.js）
//   - 访问令牌：data/checkin-dashboard-token.txt（缺失自动随机生成）。API 带 ?token= 校验。
//   - 指令 #签到后台（master）：私发带令牌的看板链接。
//
// 状态单一数据源复用 statsBuilder（与 #签到看板 完全同口径），日志由各签到链路打点：
//   services/checkin/scheduled.js（自动签到）、apps/adminCheckin.js（全员二次签到）、
//   apps/resignCheckin.js（单用户补签）。

const BasePlugin = globalThis.plugin

import fs from "node:fs/promises"
import crypto from "node:crypto"
import os from "node:os"
import { resolveData } from "../core/path.js"
import { replyText } from "../core/transport/reply.js"
import { listAllProfiles } from "../core/config/profile.js"
import { SchedulerService, dateString } from "../core/scheduler/service.js"
import { buildCheckinStatsData } from "../services/checkin/statsBuilder.js"
import { resolveDisplayName } from "../services/checkin/profileSignin.js"
import {
  getCheckinLogs,
  getCheckinLogTail,
  getCheckinLogSeq,
} from "../core/checkinLog.js"

const ROUTE_FLAG = "__lotusCheckinDashboardRoutes"
const TOKEN_FILE = resolveData("checkin-dashboard-token.txt")

// ---- 令牌 ----

async function ensureDashboardToken() {
  try {
    const raw = (await fs.readFile(TOKEN_FILE, "utf8")).trim()
    if (raw) return raw
  } catch { /* ENOENT → 生成 */ }
  const token = crypto.randomBytes(12).toString("hex")
  await fs.mkdir(TOKEN_FILE.replace(/[^/\\]+$/, ""), { recursive: true })
  await fs.writeFile(TOKEN_FILE, token, "utf8")
  return token
}

function tokenOk(req, token) {
  const given = String(req?.query?.token || req?.headers?.["x-lotus-token"] || "")
  return given.length > 0 && given === token
}

// ---- 状态聚合（与 #签到看板 同口径）----

let profilesCache = { at: 0, list: [] }
async function getProfilesCached() {
  if (Date.now() - profilesCache.at > 60_000) {
    profilesCache = {
      at: Date.now(),
      list: await listAllProfiles().catch(() => []),
    }
  }
  return profilesCache.list
}

async function displayNameOf(qq, profileId) {
  const profiles = await getProfilesCached()
  const profile = profiles.find(p =>
    String(p?.user?.qq || "") === String(qq) && Number(p?.profile?.id || 1) === Number(profileId || 1))
  return resolveDisplayName(profile) || `${qq.slice(-6)}·P${profileId}`
}

export async function buildStatusPayload() {
  const scheduler = new SchedulerService()
  const plan = await scheduler.getPlan(dateString()).catch(() => null)
  const profiles = await getProfilesCached()
  const data = buildCheckinStatsData(plan, profiles)

  // 计划条目里 runningAt 未删 = 自动签到正在跑这一条 → pending 升级为 signing
  const runningKeys = new Set()
  if (plan?.entries?.length) {
    for (const e of plan.entries) {
      if (e?.runningAt) runningKeys.add(`${String(e.qq)}|${Number(e.profileId || 1)}`)
    }
  }
  for (const g of data.groups) {
    for (const m of g.members) {
      if (m.status === "pending" && runningKeys.has(`${m.qq}|${m.profileId}`)) {
        m.status = "signing"
      }
      if (m.message) m.message = String(m.message).slice(0, 120)
    }
  }
  return {
    now: new Date().toISOString(),
    date: dateString(),
    summary: data.totals,
    groups: data.groups,
  }
}

export async function buildLogsPayload(since) {
  const raw = Number(since) > 0 ? getCheckinLogs(since) : getCheckinLogTail(80)
  const logs = []
  for (const e of raw) {
    const item = { ...e }
    if (!item.name && item.qq) item.name = await displayNameOf(item.qq, item.profileId)
    logs.push(item)
  }
  return { seq: getCheckinLogSeq(), logs }
}

// ---- HTTP 路由注册 ----

export function ensureDashboardRoutes() {
  const Bot = globalThis.Bot
  const app = Bot?.express
  if (!app) return false
  if (Bot[ROUTE_FLAG]) return true

  // 令牌鉴权在路由内部做；宿主的 serverAuth 若日后启用，这里声明豁免（页面自带令牌校验）
  if (Array.isArray(app.skip_auth) && !app.skip_auth.includes("/lotus/checkin")) {
    app.skip_auth.push("/lotus/checkin", "/lotus/checkin/")
  }

  app.get("/lotus/checkin", (req, res) => {
    res.type("html").send(DASHBOARD_HTML)
  })

  app.get("/lotus/checkin/api/status", async (req, res) => {
    const token = await ensureDashboardToken()
    if (!tokenOk(req, token)) return res.status(401).json({ error: "token required" })
    try {
      res.json(await buildStatusPayload())
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  app.get("/lotus/checkin/api/logs", async (req, res) => {
    const token = await ensureDashboardToken()
    if (!tokenOk(req, token)) return res.status(401).json({ error: "token required" })
    try {
      res.json(await buildLogsPayload(req.query.since))
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  Bot[ROUTE_FLAG] = true
  return true
}

function lanIPv4() {
  const nets = os.networkInterfaces()
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) return net.address
    }
  }
  return "127.0.0.1"
}

function dashboardPort() {
  try {
    const addr = globalThis.Bot?.server?.address?.()
    if (addr?.port) return addr.port
  } catch { }
  return 2536
}

// 构造带令牌的看板链接（#签到后台 指令与锅巴动作共用）。
// 返回 { ok, url, lanUrl, reason? }
export async function buildDashboardLink() {
  if (!ensureDashboardRoutes()) {
    return { ok: false, reason: "HTTP 服务未就绪（Bot.express 不可用）" }
  }
  const token = await ensureDashboardToken()
  const port = dashboardPort()
  const ip = lanIPv4()
  const url = `http://${ip}:${port}/lotus/checkin?token=${token}`
  const lanUrl = `http://localhost:${port}/lotus/checkin?token=${token}`
  return { ok: true, url, lanUrl }
}

// ---- 插件主类：#签到后台 ----

export class LotusCheckinDashboard extends BasePlugin {
  constructor() {
    super({
      name: "[Lotus-Plugin] CheckinDashboard",
      dsc: "签到实时后台（HTTP 看板）",
      event: "message",
      priority: 22,
      rule: [
        {
          reg: "^#签到后台$",
          fnc: "sendDashboardLink",
          permission: "master",
        },
      ],
    })
    // 模块加载即尝试挂路由；Bot 未就绪时由 #签到后台 兜底重试
    ensureDashboardRoutes()
  }

  async sendDashboardLink() {
    const link = await buildDashboardLink()
    if (!link.ok) {
      await replyText(this, `[荷花插件]${link.reason}，无法开启签到后台。`)
      return true
    }
    await replyText(this,
      `[荷花插件]签到实时后台：\n${link.url}\n`
      + `（与 BOT 同一局域网的浏览器/手机打开；电脑本机可用 ${link.lanUrl}）\n`
      + `令牌存于插件 data/checkin-dashboard-token.txt，删除该文件重启后可重新生成。`)
    return true
  }
}

// ---- 页面（静态，深色 tide 主题；页面 JS 不用模板字符串避免转义地狱）----

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>荷花插件 · 实时签到看板</title>
<style>
  :root{
    --bg:#0A192F; --panel:#102A43; --panel2:#0d2038; --line:#1e3a5f;
    --accent:#4FC3F7; --txt:#E3F2FD; --sub:#8FB3CC;
    --ok:#66BB6A; --fail:#EF5350; --wait:#90A4AE; --sign:#4FC3F7;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--txt);font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:14px;max-width:860px;margin:0 auto}
  h1{font-size:18px;display:flex;align-items:center;gap:8px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 6px var(--ok);display:inline-block}
  .sub{color:var(--sub);font-size:12px;margin:2px 0 12px}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
  .chip{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:6px 12px;font-size:13px}
  .chip b{font-size:16px;margin-left:4px}
  .chip.ok b{color:var(--ok)} .chip.fail b{color:var(--fail)} .chip.sign b{color:var(--sign)}
  .now{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:12px;font-size:13px}
  .now.sign{border-color:var(--sign);color:var(--sign)}
  .group{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:10px}
  .ghead{display:flex;justify-content:space-between;color:var(--sub);font-size:12px;margin-bottom:6px}
  .row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-top:1px solid rgba(30,58,95,.5)}
  .row .nm{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .tm{color:var(--sub);font-size:11px;margin-left:8px}
  .pill{font-size:11px;border-radius:99px;padding:2px 10px;flex-shrink:0;margin-left:8px}
  .pill.ok{background:rgba(102,187,106,.15);color:var(--ok)}
  .pill.fail{background:rgba(239,83,80,.15);color:var(--fail)}
  .pill.pending{background:rgba(144,164,174,.15);color:var(--wait)}
  .pill.signing{background:rgba(79,195,247,.18);color:var(--sign);animation:pulse 1.2s infinite}
  @keyframes pulse{50%{opacity:.5}}
  .logs{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-top:14px}
  .logline{font:12px/1.7 Consolas,Menlo,monospace;border-top:1px solid rgba(30,58,95,.4);padding:3px 0;word-break:break-all}
  .badge{display:inline-block;border-radius:4px;padding:0 6px;margin-right:6px;font-size:11px}
  .b-sign{background:rgba(79,195,247,.18);color:var(--sign)}
  .b-ok{background:rgba(102,187,106,.15);color:var(--ok)}
  .b-fail{background:rgba(239,83,80,.15);color:var(--fail)}
  .b-sys{background:rgba(143,179,204,.15);color:var(--sub)}
  .empty{color:var(--sub);text-align:center;padding:20px}
  #mask{position:fixed;inset:0;background:rgba(4,14,28,.92);display:flex;align-items:center;justify-content:center;z-index:9}
  #mask .box{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;width:88%;max-width:380px}
  #mask input{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:8px;margin:10px 0;font-size:14px}
  #mask button{width:100%;background:var(--sign);border:0;border-radius:8px;color:#06263c;padding:9px;font-size:14px;font-weight:600}
  .err{color:var(--fail)}
</style>
</head>
<body>
<h1><span class="dot" id="dot"></span>实时签到看板</h1>
<div class="sub" id="meta">加载中…</div>
<div class="chips" id="chips"></div>
<div class="now" id="now">空闲</div>
<div id="groups"><div class="empty">等待状态数据…</div></div>
<div class="logs"><div class="ghead">实时日志（最近事件，自动滚动）</div><div id="logs"><div class="empty">暂无日志</div></div></div>
<div id="mask" style="display:none"><div class="box">
  <b>访问令牌</b>
  <div class="sub">请输入看板令牌（#签到后台 获取，存于 data/checkin-dashboard-token.txt）</div>
  <input id="tk" placeholder="token">
  <button onclick="saveTk()">进入</button>
</div></div>
<script>
var TK=new URLSearchParams(location.search).get('token')||localStorage.getItem('lotus_ck_token')||'';
var lastSeq=0, firstLogs=true;
function tk(){return TK}
function saveTk(){TK=document.getElementById('tk').value.trim();if(TK){localStorage.setItem('lotus_ck_token',TK);location.search='?token='+TK}}
function needToken(){document.getElementById('mask').style.display='flex'}
function esc(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML}
async function jget(u){
  var r=await fetch(u+'&token='+encodeURIComponent(TK));
  if(r.status===401){needToken();throw new Error('auth')}
  if(!r.ok)throw new Error('http '+r.status);
  return r.json();
}
function statusPill(s){
  var map={ok:['ok','成功'],fail:['fail','失败'],pending:['pending','待签'],signing:['signing','签到中']};
  var m=map[s]||['pending',s];return '<span class="pill '+m[0]+'">'+m[1]+'</span>';
}
async function pollStatus(){
  try{
    var d=await jget('api/status?_=' + Date.now());
    document.getElementById('dot').style.background='var(--ok)';
    document.getElementById('meta').textContent=d.date+' · 每 2.5s 自动刷新 · 更新于 '+new Date(d.now).toLocaleTimeString();
    var s=d.summary;
    document.getElementById('chips').innerHTML=
      '<span class="chip">已部署<b>'+s.all+'</b></span>'+
      '<span class="chip">已签<b>'+s.done+'</b></span>'+
      '<span class="chip ok">成功<b>'+s.ok+'</b></span>'+
      '<span class="chip fail">失败<b>'+s.fail+'</b></span>'+
      '<span class="chip">待签<b>'+s.pending+'</b></span>'+
      '<span class="chip">成功率<b>'+s.rate+'</b></span>';
    var h='';
    for(var g of d.groups){
      h+='<div class="group"><div class="ghead"><span>群 '+(g.groupId==='未分组'?'未分组':esc(g.groupId))+'</span><span>'+g.rate+'</span></div>';
      for(var m of g.members){
        var extra=(m.status==='fail'&&m.message)?('<div class="sub" style="font-size:11px">'+esc(m.message)+'</div>'):'';
        h+='<div class="row"><span class="nm">'+esc(m.name)+' · P'+m.profileId+
           (m.time?'<span class="tm">'+esc(m.time)+'</span>':'')+'</span>'+statusPill(m.status)+'</div>'+extra;
      }
      h+='</div>';
    }
    document.getElementById('groups').innerHTML=h||'<div class="empty">今日暂无签到计划</div>';
  }catch(e){ if(e.message!=='auth'){document.getElementById('dot').style.background='var(--fail)'} }
}
async function pollLogs(){
  try{
    var u='api/logs?'+(lastSeq?('since='+lastSeq):'tail=80')+'&_='+Date.now();
    var d=await jget(u);
    if(!d.logs.length){lastSeq=d.seq||lastSeq;return}
    var box=document.getElementById('logs');
    if(firstLogs){box.innerHTML='';firstLogs=false}
    var atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<40;
    var h='';
    for(var e of d.logs){
      lastSeq=Math.max(lastSeq,e.seq);
      var cls=e.type==='done'?(e.ok?'b-ok':'b-fail'):(e.type==='signing'?'b-sign':'b-sys');
      var label=e.type==='done'?(e.ok?'成功':'失败'):(e.type==='signing'?'签到中':(e.type==='batch-start'?'开始':(e.type==='batch-end'?'本轮结束':'事件')));
      h+='<div class="logline"><span style="color:var(--sub)">'+esc((e.t||'').slice(11,19))+'</span> <span class="badge '+cls+'">'+label+'</span>'+
         esc(e.name||e.qq||'')+(e.profileId?('·P'+e.profileId):'')+
         (e.message?' <span style="color:var(--sub)">'+esc(e.message.slice(0,120))+'</span>':'')+'</div>';
    }
    box.insertAdjacentHTML('beforeend',h);
    if(atBottom)box.scrollTop=box.scrollHeight;
  }catch(e){}
}
(function(){
  if(!TK)needToken();
  pollStatus();pollLogs();
  setInterval(pollStatus,2500);setInterval(pollLogs,2000);
})();
</script>
</body>
</html>`
