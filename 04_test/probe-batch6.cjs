// probe-batch6.cjs — 项目文件夹 + 项目×对话联动 + 窗口提示词升级
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9349;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch6',
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
  let id = 0; const pending = new Map(); const events = [];
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
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
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable && !!window.__dshBuildWindowTaskText"); if (ready === true) break; }
  await sleep(1500);
  console.log('READY:', JSON.stringify(ready));
  const step = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var setInput = function(el, v){ var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})); };
    var st = window.__dshWorktable.splitStore;
    var S = window.__dshSessions;
    try {
      // A. 提示词内容（不发送）：窗口身份 + 文件夹 + 知识包
      var p1 = window.__dshBuildWindowTaskText('t-layout', '测试项目', '窗口2', '做一个计算器', 'E:\\foo\\bar', 'new');
      out.promptHasWindow = p1.indexOf('窗口2') >= 0 && p1.indexOf('测试项目') >= 0;
      out.promptHasFolder = p1.indexOf('E:\\foo\\bar') >= 0 && p1.indexOf('项目文件夹') >= 0;
      out.promptHasPack = p1.indexOf('插件知识包') >= 0 && p1.indexOf('不要重新侦察') >= 0;
      out.promptHasReq = p1.indexOf('做一个计算器') >= 0;
      // B. 新建项目强制文件夹：填名称+父目录+文件夹名 → 保存 → folders 持久化 + 目录真实创建
      document.querySelectorAll('.dsh-wt_actions .dsh-wt_iconBtn')[2].click();
      await sleep(300);
      var inps = [].slice.call(document.querySelectorAll('.dsh-wt_addForm input'));
      out.addInputs = inps.length;
      var foldName = 'wt-diag-' + Date.now();
      setInput(inps[0], 'FOLD测试');
      await sleep(150);
      setInput(inps[1], 'C:\\\\Users\\\\SJL\\\\AppData\\\\Local\\\\Temp');
      await sleep(150);
      setInput(inps[2], foldName);
      await sleep(200);
      document.querySelector('.dsh-wt_addBtn').click();
      await sleep(800);
      var saved = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      var lid = saved.layouts[saved.layouts.length-1].id;
      out.folderSaved = saved.folders[lid];
      out.folderNameUsed = foldName;
      out.dirExists = await (async function(){
        try { var r = await fetch('/api/worktable/fs', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ path: 'C:\\\\Users\\\\SJL\\\\AppData\\\\Local\\\\Temp' }) }); var d = await r.json(); return (d.entries||[]).some(function(e){ return e.name === foldName; }); } catch(e) { return 'ERR'; }
      })();
      // 关掉刚开的工作区
      st.close();
      await sleep(300);
      // C. 绑定弹窗内的项目文件夹区：未设置 → 更改 → 保存
      var card0 = document.querySelectorAll('.dsh-wt_layout')[0];
      var bbtn = card0.querySelector('.dsh-wt_bindBtn');
      if (bbtn) { bbtn.click(); }
      await sleep(900);
      out.bindFolderLabel = vis('.dsh-wt_bindFolderLabel') ? String(vis('.dsh-wt_bindFolderLabel').textContent).trim() : null;
      out.bindFolderNone = vis('.dsh-wt_bindFolderPathNone') ? true : false;
      var changeBtn = vis('.dsh-wt_bindFolderChange');
      if (changeBtn) { changeBtn.click(); }
      await sleep(300);
      var fins = [].slice.call(document.querySelectorAll('.dsh-wt_bindFolderForm input'));
      out.bindFolderFormInputs = fins.length;
      var foldName2 = 'wt-bind-' + Date.now();
      if (fins[0]) { setInput(fins[0], 'C:\\\\Users\\\\SJL\\\\AppData\\\\Local\\\\Temp'); await sleep(150); }
      if (fins[1]) { setInput(fins[1], foldName2); await sleep(150); }
      var saveBtn = vis('.dsh-wt_bindFolderForm .dsh-wt_customLayoutBtn');
      if (saveBtn) { saveBtn.click(); }
      await sleep(800);
      var saved2 = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      out.bindFolderSaved = saved2.folders['t-layout'];
      out.bindFolderNameUsed = foldName2;
      var bd = [].slice.call(document.querySelectorAll('.dsh-wt_popBackdrop')).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); });
      if (bd) { bd.click(); }
      await sleep(300);
      // D. 联动：打开项目 → 切到别的会话 → 自动关项目（保留新会话）
      var snap0 = S.list.getSnapshot();
      var current0 = snap0.current;
      var ids = (snap0.ids||[]).filter(function(x){ return x !== current0; });
      out.current0 = current0; out.otherCount = ids.length;
      if (card0) { card0.click(); }
      await sleep(1200);
      out.projectOpenAfterClick = st.active;
      out.currentAfterOpen = S.list.getSnapshot().current;
      if (ids[0]) { window.__dshOpenSession(ids[0]); }
      await sleep(1200);
      out.projectAutoClosed = !st.active;
      out.currentAfterSwitch = S.list.getSnapshot().current;
      out.keptNewSession = S.list.getSnapshot().current === ids[0];
      // E. 关闭项目 → 回切打开前会话（用没绑定的项目测：attached=打开前会话）
      if (card0) { card0.click(); }
      await sleep(1200);
      var curBeforeClose = S.list.getSnapshot().current;
      st.close();
      await sleep(1200);
      out.restoredToPrev = S.list.getSnapshot().current === curBeforeClose;
      // 清理：恢复原会话、删测试文件夹与测试布局
      if (current0) { window.__dshOpenSession(current0); }
      await sleep(1200);
      var j = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      j.layouts = j.layouts.filter(function(l){ return l.id !== lid; });
      if (j.folders) { delete j.folders[lid]; delete j.folders['t-layout']; }
      localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify(j));
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('BATCH6:', JSON.stringify(step));
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').slice(-4).map((e) => ((e.params.exceptionDetails.exception || {}).description || '').slice(0, 150));
  console.log('EXCEPTIONS:', JSON.stringify(errs));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
