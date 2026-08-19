// sessionface-mini.cjs — 读 auto-robot 会话面的真实状态（binding.session.getSnapshot）+ 搜索 API
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9360;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-sessionface',
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
  const step = await evaluate(`(async function(){
    var out = {};
    var S = window.__dshSessions;
    var snap = S.list.getSnapshot();
    var byId = snap.byId || {};
    var target = Object.keys(byId).find(function(k){ return (byId[k].displayTitle||'').indexOf('auto-robot') >= 0 || (byId[k].displayTitle||'').indexOf('助理') >= 0; });
    out.targetId = target;
    if (!target) { out.noTarget = true; return JSON.stringify(out); }
    try {
      var b = S.binding(target);
      out.bindingKeys = b ? Object.keys(b) : null;
      var sess = b && b.session;
      out.hasSession = !!sess;
      if (sess && typeof sess.getSnapshot === 'function') {
        var ss = sess.getSnapshot();
        out.snapKeys = ss ? Object.keys(ss) : null;
        out.phase = ss ? ss.phase : null;
        out.pendingInteraction = ss ? ss.pendingInteraction : null;
        out.running = ss ? ss.running : null;
        out.completed = ss ? ss.completed : null;
        // 逐字段安全序列化（绕过 toJSON 代理）
        var safe = {};
        if (ss) Object.keys(ss).forEach(function(k){
          var v = ss[k];
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') safe[k] = v;
          else if (v == null) safe[k] = null;
          else if (typeof v === 'object') safe[k] = '[object ' + (Array.isArray(v) ? 'array len=' + v.length : 'obj keys=' + Object.keys(v).slice(0,8).join(',')) + ']';
        });
        out.safe = safe;
      }
      // 搜索 API 结果（服务端 summaries 可能带 pendingInteraction）
      try {
        var sr = await S.search('auto-robot');
        out.searchResult = sr && sr.result ? { ok: sr.result.ok, valueType: typeof sr.result.value } : String(sr).slice(0, 80);
      } catch(e) { out.searchErr = String(e); }
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('SESSIONFACE:', JSON.stringify(step).slice(0, 3200));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
