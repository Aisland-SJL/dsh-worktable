// preview-dbg.cjs — 对绑定会话直接拉 history，看消息事件形态
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9377;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-pvdbg',
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
  await sleep(1200);
  const out = await evaluate(`(async function(){
    var out = {};
    try {
      var svc = window.__dshSessions;
      var snap = svc.list.getSnapshot();
      // 对所有会话逐个拉 2 条消息，统计哪些能提取到文本
      var sids = (snap.ids || []).slice(0, 8);
      var results = [];
      for (var k = 0; k < sids.length; k++) {
        var sid = sids[k];
        try {
          var face = svc.binding(sid).session;
          var r1 = await face.history({ maxMessages: 2 });
          var evs = (r1 && r1.result && r1.result.value && r1.result.value.events) || [];
          var userShape = null, asstShape = null, anyText = '';
          for (var i = evs.length - 1; i >= 0; i--) {
            var ev = evs[i] && evs[i].event;
            if (!ev) continue;
            var d = ev.data || {};
            if (ev.type === 'user/message' && !userShape) userShape = JSON.stringify(d).slice(0, 260);
            if (ev.type === 'assistant/message' && !asstShape) asstShape = JSON.stringify(d).slice(0, 260);
            var blocks = null;
            if (ev.type === 'user/message') blocks = d.content || d.blocks;
            else if (ev.type === 'assistant/message') { var m = d.message || d; blocks = m.content || m.blocks; }
            if (Array.isArray(blocks) && !anyText) {
              for (var b = 0; b < blocks.length; b++) {
                if (blocks[b] && typeof blocks[b].text === 'string' && blocks[b].text.trim()) { anyText = blocks[b].text.trim().slice(0, 50); break; }
              }
            }
          }
          results.push({ sid: sid.slice(-8), evsLen: evs.length, userShape: userShape, asstShape: asstShape, anyText: anyText });
        } catch (e) { results.push({ sid: sid.slice(-8), err: String(e).slice(0, 90) }); }
      }
      out.results = results;
    } catch (e) { out.err = String(e && e.stack || e); }
    return out;
  })()`);
  console.log('RESULT ' + JSON.stringify(out));
  try { ws.close(); } catch {}
  proc.kill();
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} });
