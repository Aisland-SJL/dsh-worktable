// send-self-test.cjs — 端到端自测：新建一次性会话 → promptIntoSession 真发一条消息 → 验证送达
// 会创建一个一次性会话并触发一次极小 LLM 轮次，跑完请用户删除该会话。
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9338;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-sendtest',
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
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshPromptIntoSession"); if (ready === true) break; }
  console.log('READY:', JSON.stringify(ready));
  const step = await evaluate(`(async function(){
    var out = {};
    var S = window.__dshSessions;
    try {
      var newId = await S.create({});
      out.newId = newId;
      try { await S.open(newId); } catch(e) { out.openErr = e.message; }
      var sentinel = '【dsh-worktable 自动测试】这是一条自测消息，请只回复：测试通过';
      var t0 = Date.now();
      try { await window.__dshPromptIntoSession(newId, sentinel); out.promptOk = true; } catch(e) { out.promptErr = e && e.message; }
      out.promptMs = Date.now() - t0;
      // 送达证据：列表快照里该会话 running=true（轮次已启动）
      var snap = S.list.getSnapshot();
      var entry = snap.byId && snap.byId[newId];
      out.listEntry = entry ? { running: entry.running, blank: entry.blank, title: entry.displayTitle } : null;
      // 会话面快照：找哨兵文本
      var binding = S.binding(newId);
      var sess = binding && binding.session;
      out.hasSession = !!sess;
      var raw = '';
      try { var ss = sess.getSnapshot(); raw = JSON.stringify(ss).slice(0, 4000); out.snapKeys = ss ? Object.keys(ss) : null; } catch(e) { out.snapErr = e.message; }
      out.sentinelInSnapshot = raw.indexOf('自测消息') >= 0;
      out.snapPreview = raw.slice(0, 300);
    } catch(e) { out.fatal = e && e.message; }
    return JSON.stringify(out);
  })()`);
  console.log('SELFTEST:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
