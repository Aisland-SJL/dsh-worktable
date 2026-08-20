// preview-cold.cjs — 冷会话文本可读性实测：绑定→binding() 实例化后 nodes 是否有文本；无则试 loadOlder
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9375;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-pvcold',
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
  const out = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    try {
      // 宿主会话列表快照：window.__dshWorktable 不暴露；改从 worktable 页面内部可见线索拿不到——
      // 改用宿主侧全局：dsh 的 session list store 常挂在 window 下的模块图里。
      // 兜底：直接探测 binding 是否存在（从控制室绑定一个已知真实会话 id 太难），
      // 因此这里改为：读取 window 上可能的会话入口。
      out.probeKeys = Object.keys(window).filter(function(k){ return /session|Session/.test(k); }).slice(0, 20);
      // 尝试从 dsh 全局取 session list（宿主暴露与否取决于实现）
      var anySid = null;
      try {
        var st = window.__dshWorktable;
        // 用控制室 env 的 getCards 前需要绑定；先拿会话列表：宿主 ctx.sessions 不在 window。
        // 通过 fetchSessionGroups 的网络接口 /api/worktable/workspaces 拿会话 id 不可行（无会话列表）。
        // 改用 localStorage 已存绑定（本机真实用户的浏览器里才有；这个 headless 是空档）→ 跳过。
      } catch (e) { out.err1 = String(e); }
      // 最终方案：给控制室项目绑定弹窗左列里有一个「当前」会话——用 DOM 拿它的 data 不可行，
      // 因此改为在页面内调用 __dshWorktable 的 bind 流程拿一个真实会话 id（走绑定弹窗 UI）。
      var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
      var st2 = window.__dshWorktable.splitStore;
      var card = vis('.dsh-wt_projects .dsh-wt_consoleEntry');
      card.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
      await sleep(600);
      var bpop = vis('.dsh-wt_consoleBindPop');
      var items = bpop ? bpop.querySelectorAll('.dsh-wt_consoleBindList .dsh-wt_selectItem') : [];
      out.itemCount = items.length;
      var title = items[0] ? items[0].textContent : null;
      // 点击第一个会话 → 绑定并打开控制室
      if (items[0]) { items[0].dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(1400);
      var j = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      var sid = j.bindings['wt-console'];
      out.boundSid = sid;
      out.boundTitle = title;
      // 读会话面快照（binding() 实例化后的冷读结果）
      out.faceInfo = null;
      try {
        var faces = window.__dshWorktable;
        // 尝试 window 上的会话桥（插件内部 sessionBridge 不导出）
        out.bridgeOnWindow = typeof window.__dshSessionBridge;
      } catch (e) { out.err2 = String(e); }
      // 看控制室自己卡片的预览是否非空（lastTextOf 走 binding() 冷读路径）
      var grid = vis('.dsh-wt_consoleGrid');
      var selfCard = grid && [].slice.call(grid.querySelectorAll('.dsh-wt_consoleCard')).find(function(c){ return c.classList.contains('dsh-wt_consoleCardSelf'); });
      var prev = selfCard && selfCard.querySelector('.dsh-wt_consolePreview');
      out.selfPreviewText = prev ? prev.textContent : null;
      out.selfPreviewIsEmpty = prev ? (prev.classList.contains('dsh-wt_consolePreviewNone')) : null;
      await sleep(2500);
      out.selfPreviewAfterWait = prev ? prev.textContent : null;
      st2.close(); await sleep(300);
    } catch (e) { out.err = String(e && e.stack || e); }
    return out;
  })()`);
  console.log('RESULT ' + JSON.stringify(out));
  try { ws.close(); } catch {}
  proc.kill();
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} });
