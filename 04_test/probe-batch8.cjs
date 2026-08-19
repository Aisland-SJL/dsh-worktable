// probe-batch8.cjs — 复现用户流程：新建对话后项目不得关闭 + 自动绑定新会话（真发一条消息，末尾清理归档）
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9352;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch8',
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
    source: "try{ if(window===window.top && location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[],layouts:[{id:'t-layout',title:'L',top:null,left:null,main:[{id:'p1',title:'\u7a97\u53e31',min:200,content:null}],chatWidth:{default:320,min:240,max:600},chatSide:'right',chatFullHeight:false}],bindings:{},folders:{}})); } }catch(e){}",
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
  console.log('READY:', JSON.stringify(ready));
  // 第一阶段：打开项目 + 打开自定义窗 + 切到新建对话模式 + 聚焦需求输入框
  const step1 = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var st = window.__dshWorktable.splitStore;
    var S = window.__dshSessions;
    var card = document.querySelector('.dsh-wt_layout');
    if (card) { card.click(); }
    await sleep(1200);
    out.projectOpen = st.active;
    out.current0 = S.list.getSnapshot().current;
    // 窗内点 ✨ 自定义 → 切「新建对话」
    var picks = [].slice.call(document.querySelectorAll('.dsh-wt_panePick')).filter(function(el){ return (getComputedStyle(el).visibility!=='hidden'); });
    var cp = picks.find(function(el){ return String(el.textContent).indexOf('\u81ea\u5b9a\u4e49') >= 0; });
    if (cp) { cp.click(); }
    await sleep(400);
    var modeBtns = [].slice.call(document.querySelectorAll('.dsh-wt_customModeBtn'));
    out.modeBtn1Text = modeBtns[1] ? String(modeBtns[1].textContent).trim() : null;
    if (modeBtns[1]) { modeBtns[1].click(); }
    await sleep(300);
    var ta = document.querySelector('.dsh-wt_customInput');
    if (ta) { ta.focus(); out.focused = true; }
    return JSON.stringify(out);
  })()`);
  console.log('STEP1:', JSON.stringify(step1));
  // CDP 真实输入需求文本
  await send('Input.insertText', { text: '这是自动化自测消息：请只回复"测试通过"。' });
  await sleep(400);
  const step2 = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var out = {};
    var sendBtn = vis('.dsh-wt_customSend');
    out.sendDisabled = sendBtn ? sendBtn.disabled : null;
    if (sendBtn && !sendBtn.disabled) { sendBtn.click(); out.clicked = true; }
    await sleep(8000);
    var st = window.__dshWorktable.splitStore;
    var S = window.__dshSessions;
    out.projectStillOpen = st.active;
    var snap = S.list.getSnapshot();
    out.currentAfter = snap.current;
    var j = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
    out.binding = j.bindings['t-layout'] || null;
    out.boundToNew = !!out.binding && out.binding === snap.current;
    var note = vis('.dsh-wt_customDoneBind');
    out.autoNote = note ? String(note.textContent).trim().slice(0, 30) : null;
    // 清理：归档新会话、恢复种子、关项目
    var W = window.__dshWorkspaces;
    try { await W.archiveSession(snap.current); out.archived = true; } catch(e) { out.archiveErr = String(e); }
    j.bindings = {}; localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify(j));
    st.close();
    await sleep(1200);
    return JSON.stringify(out);
  })()`);
  console.log('STEP2:', JSON.stringify(step2));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
