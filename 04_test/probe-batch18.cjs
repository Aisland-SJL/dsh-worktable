// probe-batch18.cjs — 端到端验证：新建并绑定 → 直接 prompt，确认无 model-unavailable
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9381;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch18',
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
    source: "try{ if(location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.view.v1', JSON.stringify({query:'',searchOpen:false,orderBy:'manual',dock:'footer',floatTop:null,sortMigratedV2:true})); localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},iconOverrides:{},shortcuts:[],layouts:[],bindings:{},folders:{},views:{},removed:[]})); } }catch(e){}",
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable"); if (ready === true) break; }
  await sleep(1500);
  await evaluate("(function(){ var b=document.querySelector('button[title=\"Open sidebar\"],button[aria-label=\"Open sidebar\"]'); if(b){b.click(); return true} return false })()");
  await sleep(1000);
  const out = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var st = window.__dshWorktable.splitStore;
    try {
      // 模拟用户真实场景：先切到一个 Pro 模型的会话（用户正在用 Pro）
      var hApi = window.__dshHostApi && window.__dshHostApi.sessions;
      var snap0 = window.__dshSessions.list.getSnapshot();
      var proSid = null;
      for (var k = 0; k < Math.min((snap0.ids || []).length, 10); k++) {
        var sid2 = snap0.ids[k];
        try {
          var mr = await hApi.models({ sessionId: sid2 });
          if (mr && mr.result && mr.result.ok && mr.result.value.routable && (mr.result.value.current.model || '').indexOf('pro') >= 0) { proSid = sid2; break; }
        } catch (e) {}
      }
      out.proSessionFound = !!proSid;
      if (proSid) { window.__dshSessions.open(proSid); }
      await sleep(700);
      // 诊断：①分支会看到的 current 与模型
      var snapChk = window.__dshSessions.list.getSnapshot();
      out.curAfterOpen = snapChk.current;
      try {
        var cRes = await hApi.models({ sessionId: snapChk.current });
        out.curModel = cRes && cRes.result && cRes.result.ok ? cRes.result.value.current.model : null;
        out.curRoutable = cRes && cRes.result && cRes.result.ok ? cRes.result.value.routable : null;
      } catch (e) { out.curModel = 'err'; }
      // 控制室未绑定 → 点开 → 强制绑定 → 新建并绑定
      var card = vis('.dsh-wt_projects .dsh-wt_consoleEntry');
      card.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
      await sleep(600);
      var bpop = vis('.dsh-wt_consoleBindPop');
      out.panelOpen = !!bpop;
      var cb = bpop && bpop.querySelector('.dsh-wt_consoleCreateBtn');
      if (cb) { cb.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(2500);
      var saved = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      var sid = saved.bindings['wt-console'];
      out.sid = sid;
      out.specId = st.active && st.spec ? st.spec.id : null;
      // 会话面 prompt 实测
      var svc = window.__dshSessions;
      var snap = svc.list.getSnapshot();
      var row = snap.byId[sid];
      out.agentPreset = row ? (row.agentPreset || '(none)') : '(missing)';
      var face = svc.binding(sid).session;
      out.hasPrompt = typeof face.prompt === 'function';
      // 修复后实际选中的模型（继承结果）
      try {
        var mRes = await window.__dshHostApi.sessions.models({ sessionId: sid });
        out.repairedSelection = mRes && mRes.result && mRes.result.ok ? { provider: mRes.result.value.current.provider, model: mRes.result.value.current.model, routable: mRes.result.value.routable } : null;
      } catch (e) { out.repairedSelection = 'err:' + String(e); }
      var r1 = null;
      try {
        r1 = await face.prompt([{ type: 'text', text: '回复一个字：好' }], 'queue');
        out.promptOk = !!(r1 && r1.ok);
        out.promptErr = r1 && !r1.ok ? (r1.error && (r1.error.code || r1.error.message)) : null;
      } catch (e) { out.promptThrew = String(e).slice(0, 120); }
      await sleep(2000);
      st.close(); await sleep(200);
    } catch (e) { out.err = String(e && e.stack || e); }
    return out;
  })()`);
  console.log('RESULT ' + JSON.stringify(out));
  try { ws.close(); } catch {}
  proc.kill();
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} });
