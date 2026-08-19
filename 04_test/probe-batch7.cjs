// probe-batch7.cjs — 自定义窗默认模式对调 + 文件夹弹窗选择（桩 pickDirectory）
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9351;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch7',
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
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable && !!window.__dshWorkspaces"); if (ready === true) break; }
  await sleep(1500);
  const step = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var setInput = function(el, v){ var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})); };
    var st = window.__dshWorktable.splitStore;
    try {
      // 桩住 pickDirectory（避免无头环境拉起真实系统对话框）
      var W = window.__dshWorkspaces;
      try { W.pickDirectory = function(){ return Promise.resolve('C:\\\\Picked\\\\ProjFolder'); }; } catch(e) { out.stubErr = String(e); }
      // A. 自定义窗默认模式 = 发送到会话
      st.open({id:'t-cust',title:'c',top:null,main:[{id:'p1',title:'\u7a97\u53e31',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
      await sleep(400);
      var pick = [].slice.call(document.querySelectorAll('.dsh-wt_panePick')).find(function(el){ var t=el.textContent||''; return t.indexOf('\u81ea\u5b9a\u4e49')>=0; });
      if (pick) { pick.click(); }
      await sleep(400);
      var modeBtns = [].slice.call(document.querySelectorAll('.dsh-wt_customModeBtn'));
      out.modeBtn0 = modeBtns[0] ? String(modeBtns[0].textContent).trim() : null;
      out.modeBtn0On = modeBtns[0] ? modeBtns[0].className.indexOf('dsh-wt_customModeBtnOn') >= 0 : null;
      out.modeBtn1 = modeBtns[1] ? String(modeBtns[1].textContent).trim() : null;
      out.sessionRowDefault = !!vis('.dsh-wt_customRow') && !!vis('.dsh-wt_selectBtn');
      out.groupRowHiddenDefault = !document.querySelector('.dsh-wt_customRow .dsh-wt_selectBtn') ? null : true;
      st.close();
      await sleep(300);
      // B. 新建项目面板：路径显示 + 选择位置…按钮（桩返回路径）
      document.querySelectorAll('.dsh-wt_actions .dsh-wt_iconBtn')[2].click();
      await sleep(350);
      out.addPathShown = !!vis('.dsh-wt_addFolderPath');
      var pickBtn = [].slice.call(document.querySelectorAll('.dsh-wt_bindFolderChange')).find(function(el){ return el.textContent.indexOf('\u9009\u62e9\u4f4d\u7f6e') >= 0; });
      out.pickBtn = !!pickBtn;
      if (pickBtn) { pickBtn.click(); }
      await sleep(500);
      out.addPathAfterPick = vis('.dsh-wt_addFolderPath') ? String(vis('.dsh-wt_addFolderPath').textContent).trim() : null;
      var inps = [].slice.call(document.querySelectorAll('.dsh-wt_addForm input'));
      out.addInputs = inps.length;
      setInput(inps[0], 'PICK测试');
      await sleep(200);
      document.querySelector('.dsh-wt_addBtn').click();
      await sleep(700);
      var saved = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      var lid = saved.layouts[saved.layouts.length-1].id;
      out.folderSaved = saved.folders[lid];
      st.close();
      await sleep(300);
      // C. 绑定弹窗「更改」→ 桩路径直接写入
      var card0 = document.querySelectorAll('.dsh-wt_layout')[0];
      var bbtn = card0 && card0.querySelector('.dsh-wt_bindBtn');
      if (bbtn) { bbtn.click(); }
      await sleep(900);
      var changeBtn = vis('.dsh-wt_bindFolderChange');
      if (changeBtn) { changeBtn.click(); }
      await sleep(500);
      var saved2 = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      out.bindFolderSaved = saved2.folders['t-layout'];
      var bd = [].slice.call(document.querySelectorAll('.dsh-wt_popBackdrop')).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); });
      if (bd) { bd.click(); }
      await sleep(300);
      // 清理
      var j = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      j.layouts = j.layouts.filter(function(l){ return l.id !== lid; });
      delete j.folders[lid]; delete j.folders['t-layout'];
      localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify(j));
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('BATCH7:', JSON.stringify(step));
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').slice(-4).map((e) => ((e.params.exceptionDetails.exception || {}).description || '').slice(0, 150));
  console.log('EXCEPTIONS:', JSON.stringify(errs));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
