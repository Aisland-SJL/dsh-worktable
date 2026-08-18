// autobind-mini.cjs — 未绑定项目：autoBind 应返回 'auto' 并写入；二次调用 'kept' 不改
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9344;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-autobind',
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
    source: "try{ if(window===window.top && location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[],layouts:[{id:'t-layout',title:'L',top:null,left:null,main:[{id:'p1',title:'W',min:200,content:null}],chatWidth:{default:320,min:240,max:600},chatSide:'right',chatFullHeight:false}],bindings:{}})); } }catch(e){}",
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshCustomEnv"); if (ready === true) break; }
  await sleep(1200);
  const step = await evaluate(`(async function(){
    var out = {};
    var st = window.__dshWorktable.splitStore;
    var env = window.__dshCustomEnv;
    st.open(JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).layouts[0]);
    await new Promise(function(r){ setTimeout(r, 600); });
    var pid = st.spec && st.spec.id;
    out.pid = pid;
    out.r1 = env.custom.autoBind('fake-session-1');
    await new Promise(function(r){ setTimeout(r, 400); });
    out.binding1 = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).bindings[pid];
    out.r2 = env.custom.autoBind('fake-session-2');
    await new Promise(function(r){ setTimeout(r, 400); });
    out.binding2 = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).bindings[pid];
    out.unchanged = out.binding2 === out.binding1;
    st.close();
    var j = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
    delete j.bindings[pid];
    localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify(j));
    return JSON.stringify(out);
  })()`);
  console.log('AUTOBIND:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
