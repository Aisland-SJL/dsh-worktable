// dumpstate-mini.cjs — 找出「待判断」在快照里的真实字段：dump 所有 running 会话的完整 byId 条目
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9359;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-dumpstate',
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
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshSessions"); if (ready === true) break; }
  await sleep(800);
  const step = await evaluate(`(function(){
    var snap = window.__dshSessions.list.getSnapshot();
    var byId = snap.byId || {};
    var out = { top: {}, entries: [] };
    out.topKeys = Object.keys(snap);
    Object.keys(byId).forEach(function(k){
      var e = byId[k];
      if (e.running === true || e.completed === true || e.pendingInteraction != null || e.blank === false && e.updatedAt > Date.now() - 3600000) {
        out.entries.push({ id: k.slice(0, 14), title: (e.displayTitle||'').slice(0, 24), keys: Object.keys(e), running: e.running, completed: e.completed, pending: e.pendingInteraction != null ? JSON.stringify(e.pendingInteraction).slice(0, 60) : null, phase: e.phase, projection: e.projectionValues ? JSON.stringify(e.projectionValues).slice(0, 120) : null });
      }
    });
    return JSON.stringify(out);
  })()`);
  console.log('DUMPSTATE:', JSON.stringify(step).slice(0, 3600));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
