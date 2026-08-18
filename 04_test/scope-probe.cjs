// scope-probe.cjs — 只读实测会话寻址路径（不发消息）
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9337;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-scopeprobe',
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
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshSessions"); if (ready === true) break; }
  console.log('READY:', JSON.stringify(ready));
  const step = await evaluate(`(function(){
    var out = {};
    var S = window.__dshSessions;
    var snap = S.list && S.list.getSnapshot ? S.list.getSnapshot() : null;
    var probeId = snap && snap.current;
    out.probeId = probeId;
    out.sessMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(S) || {}).slice(0, 40);
    // 路径 A：scope(id).conversation
    var sc = null;
    try { sc = S.scope(probeId); } catch(e) { out.scopeErr = e.message; }
    if (sc) {
      out.scopeType = typeof sc;
      try { out.scopeKeys = Object.keys(sc); } catch(e) { out.scopeKeysErr = e.message; }
      try { out.convType = typeof sc.conversation; } catch(e) { out.convErr = e.message; }
      try { out.getConvType = typeof (sc.get ? sc.get('conversation') : null); } catch(e) { out.getConvErr = e.message; }
    }
    // 路径 B：binding(id).session.prompt
    var b = null;
    try { b = S.binding(probeId); } catch(e) { out.bindingErr = e.message; }
    if (b) {
      try { out.bindingKeys = Object.keys(b); } catch(e) { out.bindingKeysErr = e.message; }
      try {
        var sess = b.session;
        out.sessionType = typeof sess;
        var proto = sess && Object.getPrototypeOf(sess);
        out.sessionProtoMethods = proto ? Object.getOwnPropertyNames(proto).slice(0, 40) : null;
        out.hasPrompt = !!(sess && typeof sess.prompt === 'function');
        out.hasSend = !!(sess && typeof sess.send === 'function');
      } catch(e) { out.sessionErr = e.message; }
    }
    // 路径 C：conversation.sendSession(sessionFace, ...)
    out.convSendSessionArgs = null;
    var C = window.__dshSessions ? null : null;
    return JSON.stringify(out);
  })()`);
  console.log('PROBE:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
