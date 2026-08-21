// rail-toggle-probe.cjs — 找宿主侧栏收起按钮
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9379;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-rail1',
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
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable"); if (ready === true) break; }
  await sleep(1500);
  const out = await evaluate(`(function(){
    var out = {};
    var btns = [].slice.call(document.querySelectorAll('button'));
    // 收集所有带 title/aria 的按钮（去重），找疑似侧栏开关
    var cand = [];
    btns.forEach(function(b, i){
      var t = b.title || b.getAttribute('aria-label') || '';
      var cls = String(b.className || '');
      var r = b.getBoundingClientRect();
      if (r.width > 0 && (t || /side|collapse|rail|panel|bar/i.test(cls))) {
        cand.push({ t: t.slice(0,40), cls: cls.slice(0,60), w: Math.round(r.width), x: Math.round(r.left), y: Math.round(r.top) });
      }
    });
    out.candidates = cand.slice(0, 25);
    // 侧栏列内最顶部的按钮
    var col = document.querySelector('.pI_x6G_sidebarCol') || document.querySelector('[class*=sidebarCol]');
    out.sidebarColFound = !!col;
    return out;
  })()`);
  console.log('RESULT ' + JSON.stringify(out));
  try { ws.close(); } catch {}
  proc.kill();
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} });
