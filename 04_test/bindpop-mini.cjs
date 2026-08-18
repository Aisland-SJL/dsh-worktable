// bindpop-mini.cjs — 只测绑定弹窗打开，捕获 React 异常
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9343;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-bindmini',
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
  let id = 0; const pending = new Map(); const events = [];
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
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
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable"); if (ready === true) break; }
  await sleep(1500);
  const step0 = await evaluate(`(async function(){
    var st = window.__dshWorktable.splitStore;
    st.open({id:'t-anim',title:'anim',top:null,main:[{id:'p1',title:'W',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
    await new Promise(function(r){ setTimeout(r, 900); });
    var picks = [].slice.call(document.querySelectorAll('.dsh-wt_panePick')).filter(function(el){ return (getComputedStyle(el).visibility!=='hidden'); });
    var ap = picks.find(function(el){ return String(el.textContent).indexOf('\u52a8\u753b') >= 0; });
    if (ap) { ap.click(); }
    await new Promise(function(r){ setTimeout(r, 400); });
    st.close();
    await new Promise(function(r){ setTimeout(r, 300); });
    return JSON.stringify({ opened: true, tab: st.spec ? null : 'closed' });
  })()`);
  console.log('STEP0:', JSON.stringify(step0));
  const step1 = await evaluate(`(function(){
    var out = {};
    out.cards = document.querySelectorAll('.dsh-wt_layout').length;
    out.ls = localStorage.getItem('dsh.worktable.projects.v1');
    var b = document.querySelector('.dsh-wt_layout .dsh-wt_bindBtn');
    out.btn = !!b;
    if (b) { b.click(); }
    return JSON.stringify(out);
  })()`);
  console.log('STEP1:', JSON.stringify(step1));
  await sleep(800);
  const step2 = await evaluate(`(function(){
    var out = {};
    out.pop = !!document.querySelector('.dsh-wt_bindPop');
    out.pops = document.querySelectorAll('.dsh-wt_bindPop').length;
    out.backdrops = document.querySelectorAll('.dsh-wt_popBackdrop').length;
    var p = document.querySelector('.dsh-wt_bindPop');
    out.visHidden = p ? getComputedStyle(p).visibility : null;
    if (p) { var r = p.getBoundingClientRect(); out.rect = {x:r.x, y:r.y, w:r.width, h:r.height}; }
    out.err = window.__lastErr || null;
    return JSON.stringify(out);
  })()`);
  console.log('STEP2:', JSON.stringify(step2));
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').slice(-5)
    .map((e) => ((e.params.exceptionDetails.exception || {}).description || '').slice(0, 200));
  console.log('EXCEPTIONS:', JSON.stringify(errs));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
