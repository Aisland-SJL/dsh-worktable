// probe-batch9.cjs — 未分组会话进入列表 + 新建面板文件夹行左对齐
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9353;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch9',
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
    source: "try{ if(window===window.top && location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[],layouts:[{id:'t-layout',title:'L',top:null,left:null,main:[{id:'p1',title:'W',min:200,content:null}],chatWidth:{default:320,min:240,max:600},chatSide:'right',chatFullHeight:false}],bindings:{},folders:{}})); } }catch(e){}",
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable && !!window.__dshSessions"); if (ready === true) break; }
  await sleep(1500);
  const step = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    try {
      // 期望的未分组会话集合（与 fetchSessionGroups 同逻辑）
      var snap = window.__dshSessions.list.getSnapshot();
      var ws = await (await fetch('/api/worktable/workspaces')).json();
      var accounted = {};
      var order = ws.global.workspaceIds || [];
      order.forEach(function(wid){ (ws.tables.workspaces[wid].sessionIds||[]).forEach(function(s){ accounted[s]=true; }); });
      var archived = (ws.global.archivedSessionIds||[]).slice();
      var expectedUngrouped = (snap.ids||[]).filter(function(s){ return !accounted[s] && archived.indexOf(s) < 0; });
      out.expectedUngroupedCount = expectedUngrouped.length;
      // 打开绑定弹窗（第一个布局卡）
      var card = document.querySelector('.dsh-wt_layout');
      var bbtn = card && card.querySelector('.dsh-wt_bindBtn');
      if (bbtn) { bbtn.click(); }
      await sleep(900);
      var groups = [].slice.call(document.querySelectorAll('.dsh-wt_bindList .dsh-wt_selectGroup'));
      out.groupTitles = groups.map(function(g){ return String(g.textContent).trim(); });
      out.hasUngroupedHeader = groups.some(function(g){ return String(g.textContent).indexOf('未分组') >= 0; });
      var allItems = [].slice.call(document.querySelectorAll('.dsh-wt_bindList .dsh-wt_selectItem'));
      out.listItemCount = allItems.length;
      out.expectedAllIn = expectedUngrouped.every(function(sid){
        return allItems.length > 0;
      });
      var bd = [].slice.call(document.querySelectorAll('.dsh-wt_popBackdrop')).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); });
      if (bd) { bd.click(); }
      await sleep(300);
      // 新建面板文件夹行：标签左对齐 + 地址条宽度
      document.querySelectorAll('.dsh-wt_actions .dsh-wt_iconBtn')[2].click();
      await sleep(350);
      var label = vis('.dsh-wt_addFolderRow .dsh-wt_customLabel');
      var path = vis('.dsh-wt_addFolderPath');
      out.folderLabelAlign = label ? getComputedStyle(label).textAlign : null;
      out.folderLabelWidth = label ? label.getBoundingClientRect().width : null;
      out.folderPathWidth = path ? Math.round(path.getBoundingClientRect().width) : null;
      var rowRect = vis('.dsh-wt_addFolderRow').getBoundingClientRect();
      var nameInput = document.querySelector('.dsh-wt_addForm input');
      out.nameLeft = nameInput ? Math.round(nameInput.getBoundingClientRect().left) : null;
      out.rowLeft = Math.round(rowRect.left);
      out.labelLeft = label ? Math.round(label.getBoundingClientRect().left) : null;
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('BATCH9:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
