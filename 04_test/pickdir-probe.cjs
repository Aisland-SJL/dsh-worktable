// pickdir-probe.cjs — 探测 ctx.workspaces.pickDirectory 在 Web GUI 的行为
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9350;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-pickdir',
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
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorkspaces"); if (ready === true) break; }
  await sleep(1000);
  // 发起 pickDirectory（不 await 结果，先观察 UI 是否弹窗）
  const fire = await evaluate(`(function(){
    var W = window.__dshWorkspaces;
    if (!W || typeof W.pickDirectory !== 'function') return 'no-pick';
    window.__pickResult = 'pending';
    W.pickDirectory().then(function(p){ window.__pickResult = 'resolved:' + String(p); }).catch(function(e){ window.__pickResult = 'rejected:' + String(e && e.message || e); });
    return 'fired';
  })()`);
  console.log('FIRE:', JSON.stringify(fire));
  await sleep(2500);
  const check = await evaluate(`(function(){
    var out = { pick: window.__pickResult };
    // 是否出现宿主内嵌目录浏览 UI（常见的类名试探）
    out.dialogCount = document.querySelectorAll('[role=dialog], .dsh-dialog, [class*=picker], [class*=Picker]').length;
    out.bodyTextTail = document.body ? document.body.innerText.slice(-200) : '';
    return JSON.stringify(out);
  })()`);
  console.log('CHECK:', JSON.stringify(check));
  await sleep(3000);
  const check2 = await evaluate("JSON.stringify({ pick: window.__pickResult })");
  console.log('CHECK2:', JSON.stringify(check2));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
