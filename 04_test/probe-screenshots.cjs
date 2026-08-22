// probe-screenshots.cjs — 真实界面截图：侧栏工作台 / 控制室 / 分栏工作区 → docs/assets/*.png
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const PORT = 9382;
const OUT_DIR = path.join(__dirname, '..', 'docs', 'assets');
fs.mkdirSync(OUT_DIR, { recursive: true });
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1600,1000', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-shots',
  'about:blank',
], { stdio: 'ignore' });
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}) }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) { try { list = await getJSON('/json/list'); if (list && list.length) break; } catch {} await sleep(500); }
  const target = list.find((t) => t.type === 'page') || list[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{ if(location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.view.v1', JSON.stringify({query:'',searchOpen:false,orderBy:'manual',dock:'footer',floatTop:null,sortMigratedV2:true})); localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:['t-shot'],lastUsed:{},hidden:[],nameOverrides:{},iconOverrides:{},shortcuts:[],layouts:[{id:'t-shot',title:'Demo Workspace',icon:'🧱',top:null,left:null,main:[{id:'p1',title:'Pane 1',min:200,content:null,tabs:[],active:0}],leftWidth:{default:260,min:160,max:480},chatWidth:{default:360,min:240,max:600},topHeight:{default:200,min:120,max:480},chatSide:'right',chatFullHeight:false}],bindings:{},folders:{},views:{},removed:[]})); } }catch(e){}",
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable"); if (ready === true) break; }
  await sleep(1800);
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, file), Buffer.from(r.result.data, 'base64'));
    console.log('SHOT', file);
  };
  // 1) 展开侧栏 → 工作台区块
  await evaluate("(function(){ var b=document.querySelector('button[title=\"Open sidebar\"],button[aria-label=\"Open sidebar\"]'); if(b){b.click(); return true} return false })()");
  await sleep(1600);
  await shot('shot-1-sidebar.png');
  // 2) 控制室（未绑定 → 绑定第一个会话 → 打开面板）
  const r2 = await evaluate("(async function(){ var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})}; var vis=function(sel){return [].slice.call(document.querySelectorAll(sel)).find(function(el){return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0)})}; var card=vis('.dsh-wt_projects .dsh-wt_consoleEntry'); if(!card) return 'no-card'; card.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); await sleep(600); var bpop=vis('.dsh-wt_consoleBindPop'); var item=bpop&&bpop.querySelector('.dsh-wt_consoleBindList .dsh-wt_selectItem'); if(item){ item.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); } await sleep(3000); return 'ok'; })()");
  console.log('CONSOLE:', JSON.stringify(r2));
  await shot('shot-2-console.png');
  // 3) 分栏工作区（浏览器 + 终端）
  await evaluate("(function(){ var st=window.__dshWorktable.splitStore; st.open({id:'shot-demo',title:'Worktable',top:[{id:'tp',title:'Browser',min:120,content:{kind:'builtin',type:'browser'}}],main:[{id:'mp',title:'Terminal',min:120,content:{kind:'builtin',type:'terminal'}}],chatWidth:{default:360,min:240,max:600},topHeight:{default:220,min:120,max:480},chatSide:'right'}); return 'ok'; })()");
  await sleep(2500);
  await shot('shot-3-workspace.png');
  try { ws.close(); } catch {}
  proc.kill();
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} });
