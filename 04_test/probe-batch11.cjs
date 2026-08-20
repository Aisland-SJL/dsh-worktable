// probe-batch11.cjs — 自动挂载：完成后读 widget-result.json → 产物自动挂进窗口；项目未开则补挂
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9367;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch11',
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
    source: "try{ if(window===window.top && location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[],layouts:[{id:'t-layout',title:'L',top:null,left:null,main:[{id:'p1',title:'\u7a97\u53e31',min:200,content:null}],chatWidth:{default:320,min:240,max:600},chatSide:'right',chatFullHeight:false}],bindings:{},folders:{'t-layout':'C:\\\\Users\\\\SJL\\\\AppData\\\\Local\\\\Temp\\\\wt-mount-fixture'}})); localStorage.removeItem('dsh.worktable.notifyAck.v1'); localStorage.removeItem('dsh.worktable.pendingMount.v1'); } }catch(e){}",
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
    var postJson = async function(url, body){ return await fetch(url, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) }); };
    try {
      // 提示词握手
      var prompt = window.__dshBuildWindowTaskText('t-layout', '测试项目', '窗口1', '做个鲜花页面', 'E:\\foo', 'new');
      out.promptHasHandshake = prompt.indexOf('widget-result.json') >= 0 && prompt.indexOf('窗口1') >= 0;
      // 准备夹具：目录 + page.html + widget-result.json
      var fix = 'C:\\\\Users\\\\SJL\\\\AppData\\\\Local\\\\Temp\\\\wt-mount-fixture';
      await postJson('/api/worktable/mkdir', { path: fix });
      await postJson('/api/worktable/write', { path: fix + '\\\\page.html', content: '<html><body><h1>FLOWER</h1></body></html>' });
      await postJson('/api/worktable/write', { path: fix + '\\\\widget-result.json', content: JSON.stringify({ window: '\u7a97\u53e31', path: 'page.html', kind: 'html' }) });
      // 绑定到第一个会话
      var S = window.__dshSessions;
      var card = document.querySelector('.dsh-wt_layout');
      var bbtn = card.querySelector('.dsh-wt_bindBtn');
      bbtn.click();
      await sleep(900);
      var items = [].slice.call(document.querySelectorAll('.dsh-wt_bindList .dsh-wt_selectItem'));
      if (items[0]) { items[0].click(); }
      await sleep(800);
      var boundId = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).bindings['t-layout'];
      // 打开项目（窗口1 无内容）
      card.click();
      await sleep(1200);
      var st = window.__dshWorktable.splitStore;
      out.projectOpen = st.active;
      out.tabsBefore = st.spec && st.spec.main[0].tabs ? st.spec.main[0].tabs.length : null;
      // 伪造完成事件 → 自动挂载
      var listStore = S.list;
      var orig = listStore.getSnapshot.bind(listStore);
      listStore.getSnapshot = function(){ var s = orig(); var e = s.byId && s.byId[boundId]; if (e) { s.byId = Object.assign({}, s.byId); s.byId[boundId] = Object.assign({}, e, { completed: true, running: false }); } return s; };
      window.__dshSyncSessionScope();
      await sleep(2000);
      var tabs = st.spec && st.spec.main[0].tabs;
      out.tabsAfter = tabs ? tabs.map(function(t){ return { kind: t.content && t.content.kind, url: t.content && t.content.url ? t.content.url.slice(0, 90) : null, title: t.title }; }) : null;
      out.mounted = !!(tabs && tabs.some(function(t){ return t.content && t.content.url && t.content.url.indexOf('wt-mount-fixture') >= 0; }));
      // 挂起路径：关项目 → 未完成 → 再完成 → 重开项目补挂
      st.close();
      await sleep(400);
      listStore.getSnapshot = function(){ var s = orig(); var e = s.byId && s.byId[boundId]; if (e) { s.byId = Object.assign({}, s.byId); s.byId[boundId] = Object.assign({}, e, { completed: false, running: false }); } return s; };
      window.__dshSyncSessionScope();
      await sleep(400);
      listStore.getSnapshot = function(){ var s = orig(); var e = s.byId && s.byId[boundId]; if (e) { s.byId = Object.assign({}, s.byId); s.byId[boundId] = Object.assign({}, e, { completed: true, running: false }); } return s; };
      window.__dshSyncSessionScope();
      await sleep(1800);
      out.pendingStored = !!(JSON.parse(localStorage.getItem('dsh.worktable.pendingMount.v1')||'{}')['t-layout']);
      card.click();
      await sleep(1400);
      var tabs2 = st.spec && st.spec.main[0].tabs;
      out.mountedAfterReopen = !!(tabs2 && tabs2.some(function(t){ return t.content && t.content.url && t.content.url.indexOf('wt-mount-fixture') >= 0; }));
      // 清理
      listStore.getSnapshot = orig;
      st.close();
      await sleep(400);
      bbtn = card.querySelector('.dsh-wt_bindBtn');
      bbtn.click();
      await sleep(900);
      var unbind = vis('.dsh-wt_bindUnbind');
      if (unbind) { unbind.click(); }
      await sleep(500);
      localStorage.removeItem('dsh.worktable.pendingMount.v1');
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('BATCH11:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
