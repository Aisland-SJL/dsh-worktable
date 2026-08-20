// theme-probe.cjs — 找宿主 --dsw-alias-* 变量定义位置
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9374;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-theme1',
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
  await sleep(1200);
  const out = await evaluate(`(function(){
    var out = {};
    var v = function(el, name){ return el ? (getComputedStyle(el).getPropertyValue(name)||'').trim() : null; };
    out.html = v(document.documentElement, '--dsw-alias-fill-l1');
    out.body = v(document.body, '--dsw-alias-fill-l1');
    // 逐层向上找第一个解析出变量的元素（限深 6 层，从工作台卡片起）
    var el = document.querySelector('.dsh-wt_projects');
    var chain = [];
    var cur = el; var d = 0;
    while (cur && d < 8) {
      var val = v(cur, '--dsw-alias-fill-l1');
      chain.push({ tag: cur.tagName, cls: String(cur.className||'').slice(0,60), val: val });
      if (val) break;
      cur = cur.parentElement; d++;
    }
    out.chain = chain;
    // 侧栏卡片同变量解析情况
    var card = document.querySelector('.dsh-wt_consoleEntry');
    out.entryVal = v(card, '--dsw-alias-fill-l1');
    // 全文档扫描前 30 个解析出该变量的元素（类名采样）
    var found = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length && found.length < 12; i++) {
      if (v(all[i], '--dsw-alias-fill-l1')) {
        found.push({ tag: all[i].tagName, cls: String(all[i].className||'').slice(0,50) });
        if (found.length === 1) {
          var cs = getComputedStyle(all[i]);
          out.firstVals = {
            fill1: cs.getPropertyValue('--dsw-alias-fill-l1').trim(),
            labelPrimary: cs.getPropertyValue('--dsw-alias-label-primary').trim(),
            bgBase: cs.getPropertyValue('--dsw-alias-bg-base').trim(),
            accent: cs.getPropertyValue('--dsw-alias-state-accent-primary').trim(),
          };
        }
      }
    }
    out.foundSample = found;
    // 主题切换类名线索
    out.themeClsHints = [].slice.call(document.querySelectorAll('[class*=theme i],[class*=dark i],[class*=light i]')).slice(0,8).map(function(e){ return String(e.className).slice(0,60); });
    out.colorSchemeHtml = getComputedStyle(document.documentElement).colorScheme;
    out.prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    // 宿主根元素背景色（判断实际渲染主题）
    var app = document.querySelector('.hHd-Xa_root') || document.body;
    out.hostBg = getComputedStyle(app).backgroundColor;
    out.hostColor = getComputedStyle(app).color;
    return out;
  })()`);
  console.log('RESULT ' + JSON.stringify(out));
  try { ws.close(); } catch {}
  proc.kill();
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} });
