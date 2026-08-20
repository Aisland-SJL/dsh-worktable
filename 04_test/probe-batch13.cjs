// probe-batch13.cjs — 已删除项目区块移除 + iframe 标签右上角刷新
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9370;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch13',
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
  const step = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var st = window.__dshWorktable.splitStore;
    try {
      // A. iframe 标签右上角刷新
      st.open({id:'t-frame',title:'f',top:null,main:[{id:'p1',title:'W',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
      await sleep(600);
      st.openTab('main', 0, { kind: 'iframe', url: 'https://example.com', title: 'web' });
      await sleep(900);
      out.frameWrap = !!vis('.dsh-wt_frameWrap');
      var rb = vis('.dsh-wt_frameRefresh');
      out.refreshBtn = !!rb;
      out.refreshTitle = rb ? rb.getAttribute('title') : null;
      var f1 = vis('.dsh-wt_frameWrap iframe');
      if (rb) { rb.click(); }
      await sleep(700);
      var f2 = vis('.dsh-wt_frameWrap iframe');
      out.remounted = !!f1 && !!f2 && f1 !== f2;
      st.close();
      await sleep(300);
      // B. 已删除项目区块：删除常驻项目后设置面板里不得再有该区块
      var btnS = document.querySelector('.dsh-wt_actions .dsh-wt_iconBtn:nth-child(2)');
      if (btnS) { btnS.click(); }
      await sleep(300);
      var rows = document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow');
      out.rowsBefore = rows.length;
      // 删除第一个常驻项目行（其最后一个按钮 = ✕）
      var xBtn = rows[0] && rows[0].querySelectorAll('.dsh-wt_manageBtn')[rows[0].querySelectorAll('.dsh-wt_manageBtn').length-1];
      if (xBtn) { xBtn.click(); }
      await sleep(250);
      var del = document.querySelector('.dsh-wt_confirmDelete');
      if (del) { del.click(); }
      await sleep(350);
      out.removedSectionGone = !document.querySelector('.dsh-wt_settings .dsh-wt_manageRowRemoved');
      out.rowsAfter = document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow').length;
      // 清理：把删除的项目恢复（直接改 localStorage + 刷新页面状态不便——用 removed 还原）
      var j = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      j.removed = [];
      localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify(j));
      var done = document.querySelector('.dsh-wt_manageDone');
      if (done) { done.click(); }
      await sleep(200);
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('BATCH13:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
