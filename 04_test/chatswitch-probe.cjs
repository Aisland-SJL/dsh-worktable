// chatswitch-probe.cjs — 非破坏性验证：sessions.open 能否把右侧对话窗切到目标会话
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 9336;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-switchprobe',
  'about:blank',
], { stdio: 'ignore' });

const getJSON = (path) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path }, (r) => {
    let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } });
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await getJSON('/json/list'); if (list && list.length) break; } catch {}
    await sleep(500);
  }
  const target = list.find((t) => t.type === 'page') || list[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  // 轮询等待插件模块就绪（最长 30s）
  let ready = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    ready = await evaluate("(function(){ return { w: !!window.__dshWorktable, o: typeof window.__dshOpenSession, s: !!window.__dshSessions, t: document.title, ml: !!window.__ModuleLoader__ } })()");
    if (ready && !ready.__error && ready.s) break;
  }
  console.log('READY:', JSON.stringify(ready));
  if (!ready || ready.__error || !ready.s) {
    const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded')
      .slice(-12).map((e) => (e.params.exceptionDetails && (e.params.exceptionDetails.exception || {}).description) || (e.params.entry && e.params.entry.text) || e.method);
    console.log('RECENT_EVENTS:', JSON.stringify(errs));
    const bodySnip = await evaluate("(function(){ var t=document.body?document.body.innerText.slice(0,400):'(no body)'; return t })()");
    console.log('BODY:', JSON.stringify(bodySnip));
    ws.close(); proc.kill(); process.exit(2);
  }

  // 展开侧栏（若按钮存在）
  const expanded = await evaluate("(function(){ var b=document.querySelector('button[title=\"Open sidebar\"],button[aria-label=\"Open sidebar\"]'); if(b){b.click(); return true} return false })()");
  console.log('SIDEBAR_EXPAND:', JSON.stringify(expanded));
  await sleep(1500);

  const step = await evaluate(`(async function(){
    var out = {};
    var S = window.__dshSessions;
    var getSnap = function(){ return S && S.list && typeof S.list.getSnapshot === 'function' ? S.list.getSnapshot() : null; };
    var snap = getSnap();
    if (!snap) { out.snapMissing = true; return JSON.stringify(out); }
    out.idsCount = (snap.ids || []).length;
    out.currentBefore = snap.current;
    var ids = (snap.ids || []).slice();
    var byId = snap.byId || {};
    var targetId = null, targetTitle = null;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] !== snap.current && byId[ids[i]]) { targetId = ids[i]; targetTitle = byId[ids[i]].displayTitle || byId[ids[i]].title || ids[i]; break; }
    }
    out.targetId = targetId;
    out.targetTitle = targetTitle;
    if (!targetId) { out.noTarget = true; return JSON.stringify(out); }
    window.__dshOpenSession(targetId);
    await new Promise(function(r){ setTimeout(r, 2500); });
    var snap2 = getSnap();
    out.currentAfter = snap2 ? snap2.current : null;
    out.switched = snap2 && snap2.current === targetId;
    out.domTitleRight = false;
    out.domMatches = [];
    if (targetTitle) {
      var vw = document.documentElement.clientWidth;
      var all = document.querySelectorAll('*');
      var max = Math.min(all.length, 12000);
      for (var j = 0; j < max; j++) {
        var el = all[j];
        if (el.children.length === 0 && el.textContent && el.textContent.trim() === targetTitle) {
          var r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            out.domMatches.push({ x: Math.round(r.x), w: Math.round(r.width) });
            if (r.x >= vw * 0.55) out.domTitleRight = true;
          }
        }
      }
    }
    if (snap.current) { window.__dshOpenSession(snap.current); }
    await new Promise(function(r){ setTimeout(r, 2500); });
    var snap3 = getSnap();
    out.currentRestored = snap3 ? snap3.current : null;
    out.restoredOk = snap3 && snap3.current === snap.current;
    return JSON.stringify(out);
  })()`);
  console.log('PROBE:', JSON.stringify(step));

  ws.close();
  proc.kill();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
