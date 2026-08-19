// promptform-mini.cjs — 验证提示词已按任务分形式（不再默认 HTML）
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9356;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-promptform',
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
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshBuildWindowTaskText"); if (ready === true) break; }
  const step = await evaluate(`(function(){
    var t = window.__dshBuildWindowTaskText('t-layout', '测试项目', '窗口2', '帮我做一个PPT', 'E:\\foo', 'new');
    var out = {};
    out.hasTable = t.indexOf('产出形式请按任务类型选择') >= 0;
    out.hasPptx = t.indexOf('.pptx') >= 0;
    out.hasMp4 = t.indexOf('.mp4') >= 0;
    out.hasBuiltinAdvice = t.indexOf('不要重复造轮子') >= 0;
    out.noPriorityHtml = t.indexOf('优先直接产出') < 0 && t.indexOf('优先') < 0;
    out.knowledgeNeutral = t.indexOf('不要一律 HTML') >= 0;
    out.stillHasHtmlForTools = t.indexOf('单文件 HTML') >= 0;
    return JSON.stringify(out);
  })()`);
  console.log('PROMPTFORM:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
