// preset-l13-probe.cjs — 验证预设重排 + 新 5 视窗预设（缩略图/持久化/几何）
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9340;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-l13',
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
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{ if(location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[],layouts:[]})); } }catch(e){}",
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable"); if (ready === true) break; }
  await sleep(1000);
  const step = await evaluate(`(async function(){
    var out = {};
    try {
      var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
      // 打开添加面板
      var addBtn = document.querySelectorAll('.dsh-wt_actions .dsh-wt_iconBtn')[2];
      if (addBtn) { addBtn.click(); }
      await new Promise(function(r){ setTimeout(r, 300); });
      var presets = [].slice.call(document.querySelectorAll('.dsh-wt_presets .dsh-wt_preset'));
      out.presetCount = presets.length;
      out.thumbCells = presets.map(function(p){ return p.querySelectorAll('.dsh-wt_thumbCell').length; });
      out.chatCells = presets.map(function(p){ return p.querySelectorAll('.dsh-wt_thumbChat').length; });
      // 点第 6 个（新 l13）并保存
      if (presets[5]) { presets[5].click(); }
      await new Promise(function(r){ setTimeout(r, 200); });
      var inp = document.querySelector('.dsh-wt_addForm input');
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, 'L13-probe');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(function(r){ setTimeout(r, 200); });
      var saveBtn = document.querySelector('.dsh-wt_addBtn');
      if (saveBtn) { saveBtn.click(); }
      await new Promise(function(r){ setTimeout(r, 400); });
      var saved = null;
      try { saved = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).layouts[0]; } catch(e) {}
      out.savedTop = saved && saved.top ? saved.top.length : null;
      out.savedMain = saved && saved.main ? saved.main.length : null;
      out.savedChatFull = saved ? saved.chatFullHeight === true : null;
      out.savedTopDefault = saved && saved.topHeight ? saved.topHeight.default : null;
      // 打开该布局验证几何（失败则等 2s 重试一次）
      var st = window.__dshWorktable.splitStore;
      if (saved) { out.openResult = st.open(saved); }
      await new Promise(function(r){ setTimeout(r, 900); });
      if (!st.active) { out.openResult2 = saved ? st.open(saved) : null; }
      await new Promise(function(r){ setTimeout(r, 900); });
      out.active = st.active;
      out.specId = st.spec && st.spec.id;
      out.geom = st.geom;
      var panes = [].slice.call(document.querySelectorAll('.dsh-wt_pane')).filter(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); });
      out.paneCount = panes.length;
      if (panes.length >= 4) {
        var r0 = panes[0].getBoundingClientRect();
        var r1 = panes[1].getBoundingClientRect();
        out.topW = Math.round(r0.width);
        out.botW0 = Math.round(r1.width);
        out.topTaller = r0.height > r1.height;
        out.topOnTop = r0.top < r1.top;
      }
      st.close();
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('L13PROBE:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
