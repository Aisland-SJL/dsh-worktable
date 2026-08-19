// probe-repending.cjs — 复现用户场景：旧 ack 压住新一轮待决 → 必须重新亮黄
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9364;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-repending',
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
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{ if(window===window.top && location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[],layouts:[{id:'t-layout',title:'L',top:null,left:null,main:[{id:'p1',title:'W',min:200,content:null}],chatWidth:{default:320,min:240,max:600},chatSide:'right',chatFullHeight:false}],bindings:{},folders:{}})); localStorage.removeItem('dsh.worktable.notifyAck.v1'); } }catch(e){}",
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable && !!window.__dshSyncSessionScope"); if (ready === true) break; }
  await sleep(1500);
  const step = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    try {
      var S = window.__dshSessions;
      var card = document.querySelector('.dsh-wt_layout');
      var bbtn = card.querySelector('.dsh-wt_bindBtn');
      bbtn.click();
      await sleep(900);
      var items = [].slice.call(document.querySelectorAll('.dsh-wt_bindList .dsh-wt_selectItem'));
      if (items[0]) { items[0].click(); }
      await sleep(800);
      var boundId = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).bindings['t-layout'];
      var listStore = S.list;
      var orig = listStore.getSnapshot.bind(listStore);
      var fake = function(patch){ return function(){ var s = orig(); var e = s.byId && s.byId[boundId]; if (e) { s.byId = Object.assign({}, s.byId); s.byId[boundId] = Object.assign({}, e, patch); } return s; }; };
      // 第一轮：待决出现 → 黄
      listStore.getSnapshot = fake({ pendingInteraction: 'question', running: true });
      window.__dshSyncSessionScope();
      await sleep(500);
      var b1 = card.querySelector('.dsh-wt_bindBtn');
      out.firstPending = b1.getAttribute('data-bound');
      // 用户点开项目 → ack → 恢复常态（实心 true）
      card.click();
      await sleep(900);
      var b2 = card.querySelector('.dsh-wt_bindBtn');
      out.afterAck = b2.getAttribute('data-bound');
      out.ackStored = (JSON.parse(localStorage.getItem('dsh.worktable.notifyAck.v1')||'{}')[boundId]) || null;
      // 用户在对话里回答了 → 待决消失，仍在运行 → 蓝
      listStore.getSnapshot = fake({ running: true });
      window.__dshSyncSessionScope();
      await sleep(500);
      var b3 = card.querySelector('.dsh-wt_bindBtn');
      out.afterResolved = b3.getAttribute('data-bound');
      out.ackAfterResolve = (JSON.parse(localStorage.getItem('dsh.worktable.notifyAck.v1')||'{}')[boundId]) || null;
      // 新一轮问题 → 必须重新亮黄（旧 ack 不得压住）
      listStore.getSnapshot = fake({ pendingInteraction: 'question', running: true });
      window.__dshSyncSessionScope();
      await sleep(500);
      var b4 = card.querySelector('.dsh-wt_bindBtn');
      out.repending = b4.getAttribute('data-bound');
      out.rependingColor = getComputedStyle(b4).color;
      // 清理
      listStore.getSnapshot = orig;
      st = window.__dshWorktable.splitStore;
      st.close();
      await sleep(400);
      bbtn = card.querySelector('.dsh-wt_bindBtn');
      bbtn.click();
      await sleep(900);
      var unbind = vis('.dsh-wt_bindUnbind');
      if (unbind) { unbind.click(); }
      await sleep(500);
      localStorage.removeItem('dsh.worktable.notifyAck.v1');
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('REPENDING:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
