// probe-batch5.cjs — 动画窗类型 + 绑定按钮对齐/双圆图标 + 弹窗状态行 + 自动绑定规则
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9342;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch5',
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
    source: "try{ window.__seedRan = (window.__seedRan||0)+1; if(window===window.top && location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[],layouts:[{id:'t-layout',title:'L',top:null,left:null,main:[{id:'p1',title:'W',min:200,content:null}],chatWidth:{default:320,min:240,max:600},chatSide:'right',chatFullHeight:false}],bindings:{}})); window.__seedDone = true; } }catch(e){ window.__seedErr = String(e); }",
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable && !!window.__dshCustomEnv"); if (ready === true) break; }
  await sleep(1500);
  console.log('READY:', JSON.stringify(ready));
  const step = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var st = window.__dshWorktable.splitStore;
    try {
      // A. 动画窗类型：打开工作区 → 6选1选择器多一项 → 打开 anim 标签 → 地址栏+iframe
      st.open({id:'t-anim',title:'anim',top:null,main:[{id:'p1',title:'\u7a97\u53e31',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
      await sleep(900);
      var picks = [].slice.call(document.querySelectorAll('.dsh-wt_panePick')).filter(function(el){ return (getComputedStyle(el).visibility!=='hidden'); });
      out.pickCount = picks.length;
      out.pickHasAnim = picks.some(function(el){ return String(el.textContent).indexOf('\u52a8\u753b') >= 0; });
      var animPick = picks.find(function(el){ return String(el.textContent).indexOf('\u52a8\u753b') >= 0; });
      if (animPick) { animPick.click(); }
      await sleep(400);
      out.tabType = st.spec.main[0].tabs && st.spec.main[0].tabs[0].content.type;
      out.animBar = !!vis('.dsh-wt_browserBar');
      out.animIframe = !!vis('.dsh-wt_paneFrame');
      st.close();
      await sleep(300);
      // B. 绑定按钮：双圆 CSS 图标 + 竖向对齐（所有卡片按钮中心与各自卡片中心偏差 <= 2px）
      var btns = [].slice.call(document.querySelectorAll('.dsh-wt_bindBtn')).filter(function(el){ return el.getBoundingClientRect().height > 0; });
      out.bindBtnCount = btns.length;
      out.aligns = btns.map(function(b){
        var card = b.closest('button');
        var br = b.getBoundingClientRect(); var cr = card ? card.getBoundingClientRect() : null;
        var ps = getComputedStyle(b);
        var b4 = getComputedStyle(b.querySelector('.dsh-wt_bindCircles'), '::before');
        return { pos: ps.position, right: ps.right, w: Math.round(br.width), h: Math.round(br.height), delta: card ? Math.round((br.top+br.height/2) - (cr.top+cr.height/2)) : null, circleW: b4.width, circleBorder: b4.borderTopWidth, circleFill: b4.backgroundColor };
      });
      out.allAbsAligned = out.aligns.every(function(a){ return a.pos === 'absolute' && Math.abs(a.delta) <= 2; });
      out.circleStyle = out.aligns[0] || null;
      // C. 绑定弹窗：未绑定状态行 → 绑定后状态行（📂 | [框]）
      out.lsBeforeC = localStorage.getItem('dsh.worktable.projects.v1');
      out.seedRan = window.__seedRan; out.seedDone = window.__seedDone; out.seedErr = window.__seedErr || null;
      out.layoutCards = document.querySelectorAll('.dsh-wt_layout').length;
      var card0 = document.querySelector('.dsh-wt_layout');
      var bbtn = card0 && card0.querySelector('.dsh-wt_bindBtn');
      if (bbtn) { bbtn.click(); }
      await sleep(900);
      out.popup = !!vis('.dsh-wt_bindPop');
      out.popupRaw = document.querySelectorAll('.dsh-wt_bindPop').length;
      var pp = document.querySelector('.dsh-wt_bindPop');
      if (pp) { var prr = pp.getBoundingClientRect(); out.popupRect = { x: Math.round(prr.x), y: Math.round(prr.y), w: Math.round(prr.width), h: Math.round(prr.height), vis: getComputedStyle(pp).visibility }; }
      out.unboundText = vis('.dsh-wt_bindNoneText') ? String(vis('.dsh-wt_bindNoneText').textContent).trim() : null;
      out.noConvBoxWhenUnbound = !vis('.dsh-wt_bindConv');
      var items = [].slice.call(document.querySelectorAll('.dsh-wt_bindList .dsh-wt_selectItem'));
      out.bindItemCount = items.length;
      if (items[0]) { items[0].click(); }
      await sleep(900);
      var lid = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).layouts[0].id;
      var boundVal = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).bindings[lid];
      out.boundSaved = typeof boundVal === 'string' && boundVal.length > 0;
      if (bbtn) { bbtn.click(); }
      await sleep(900);
      out.popup2 = !!vis('.dsh-wt_bindPop');
      out.folderShown = vis('.dsh-wt_bindFolder') ? String(vis('.dsh-wt_bindFolder').textContent).trim() : null;
      out.sepShown = !!vis('.dsh-wt_bindSep');
      var conv = vis('.dsh-wt_bindConv');
      out.convBox = conv ? { text: String(conv.textContent).trim(), border: getComputedStyle(conv).borderTopWidth, bg: getComputedStyle(conv).backgroundColor } : null;
      out.noNoneTextWhenBound = !vis('.dsh-wt_bindNoneText');
      var bd = [].slice.call(document.querySelectorAll('.dsh-wt_popBackdrop')).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); });
      if (bd) { bd.click(); }
      await sleep(300);
      // D. 自动绑定规则：直接调 env.autoBind
      var env = window.__dshCustomEnv;
      st.open(JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).layouts[0]);
      await sleep(600);
      var pid = st.spec && st.spec.id;
      out.autoPid = pid;
      var r1 = env.custom.autoBind('fake-session-1');
      out.auto1 = r1;
      out.bindingAfter1 = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).bindings[pid];
      var r2 = env.custom.autoBind('fake-session-2');
      out.auto2 = r2;
      out.bindingAfter2 = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).bindings[pid];
      st.close();
      // 清理：解绑
      var layouts2 = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      delete layouts2.bindings[pid];
      localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify(layouts2));
      // 恢复原会话
      var S = window.__dshSessions;
      var snap0 = S.list.getSnapshot();
      if (snap0.current) { window.__dshOpenSession(snap0.current); }
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('BATCH5:', JSON.stringify(step));
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').slice(-6)
    .map((e) => ((e.params.exceptionDetails.exception || {}).description || '').slice(0, 300));
  console.log('EXCEPTIONS:', JSON.stringify(errs));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
