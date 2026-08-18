// group-cycle-test.cjs — 分组全周期自测（可清理）：新建目录 → 注册工作区 → 按 workspaceId 建会话 → 验证 → 删除工作区 + 归档会话
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9339;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-grouptest',
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
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorkspaces && !!window.__dshSessions"); if (ready === true) break; }
  console.log('READY:', JSON.stringify(ready));
  const step = await evaluate(`(async function(){
    var out = {};
    var W = window.__dshWorkspaces;
    var S = window.__dshSessions;
    var parent = 'C:\\\\Users\\\\SJL\\\\AppData\\\\Local\\\\Temp';
    var name = 'wt-grouptest-' + Date.now();
    out.parent = parent;
    out.name = name;
    try {
      out.dirCreated = await W.createDirectory(parent, name);
      var view = await W.create({ path: out.dirCreated });
      out.workspaceId = view && (view.workspaceId || view.id);
      out.workspaceTitle = view && view.title;
      var newId = await S.create({ workspaceId: out.workspaceId });
      out.sessionId = newId;
      await new Promise(function(r){ setTimeout(r, 1200); });
      var wsnap = W.list.getSnapshot();
      var row = (wsnap.items || []).find(function(w){ return (w.workspaceId || w.id) === out.workspaceId; });
      out.wsInList = !!row;
      out.sessionInWs = row ? (row.sessionIds || []).indexOf(newId) >= 0 : false;
      var ssnap = S.list.getSnapshot();
      out.sessionListed = !!(ssnap.byId && ssnap.byId[newId]);
      out.sessionCwd = ssnap.byId && ssnap.byId[newId] ? ssnap.byId[newId].cwd : null;
      // 清理：归档会话 + 删除工作区
      try { await W.archiveSession(newId); out.archived = true; } catch(e) { out.archiveErr = e && e.message; }
      try { await W.delete(out.workspaceId); out.wsDeleted = true; } catch(e) { out.deleteErr = e && e.message; }
      await new Promise(function(r){ setTimeout(r, 1200); });
      var wsnap2 = W.list.getSnapshot();
      out.wsGone = !(wsnap2.items || []).some(function(w){ return (w.workspaceId || w.id) === out.workspaceId; });
    } catch(e) { out.fatal = e && e.message; }
    return JSON.stringify(out);
  })()`);
  console.log('GROUPCYCLE:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
