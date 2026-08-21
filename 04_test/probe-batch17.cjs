// probe-batch17.cjs — 收起态方形按钮（可点击进项目）+ 管理面板睁眼/闭眼切换
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9378;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch17',
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
    source: "try{ if(location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.view.v1', JSON.stringify({query:'',searchOpen:false,orderBy:'manual',dock:'footer',floatTop:null,sortMigratedV2:true})); localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:['t-bind'],lastUsed:{},hidden:[],nameOverrides:{},iconOverrides:{},shortcuts:[],layouts:[{id:'t-bind',title:'\u7ed1\u5b9a\u6d4b\u8bd5',icon:'\ud83e\uddea',top:null,left:null,main:[{id:'p1',title:'\u5185\u5bb91',min:200,content:null,tabs:[],active:0}],leftWidth:{default:260,min:160,max:480},chatWidth:{default:360,min:240,max:600},topHeight:{default:200,min:120,max:480},chatSide:'right',chatFullHeight:false}],bindings:{},folders:{},views:{},removed:[]})); } }catch(e){}",
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
      // A. 管理面板眼睛图标
      var btnS = document.querySelector('.dsh-wt_actions .dsh-wt_iconBtn:nth-child(2)');
      if (btnS) { btnS.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(400);
      var rows = document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow');
      out.manageRows = rows.length;
      var row0 = rows[0];
      var hideBtn = row0 && [].slice.call(row0.querySelectorAll('.dsh-wt_manageBtn')).find(function(b){ var t = b.title || ''; return t.indexOf('显示') >= 0 || t.indexOf('隐藏') >= 0; });
      out.hideBtnFound = !!hideBtn;
      out.hasSvg = !!(hideBtn && hideBtn.querySelector('svg'));
      out.monkeyGone = !!(hideBtn && (hideBtn.textContent || '').indexOf('🙈') < 0);
      var titleBefore = hideBtn ? hideBtn.title : null;
      out.titleBefore = titleBefore;
      // 点击 → 隐藏（闭眼）
      if (hideBtn) { hideBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(400);
      var j = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      out.hiddenAfter = j.hidden;
      out.row0OffAfter = row0.classList.contains('dsh-wt_manageRowOff');
      var hideBtn2 = row0 && [].slice.call(row0.querySelectorAll('.dsh-wt_manageBtn')).find(function(b){ var t = b.title || ''; return t.indexOf('显示') >= 0 || t.indexOf('隐藏') >= 0; });
      out.titleAfter = hideBtn2 ? hideBtn2.title : null;
      var svgClosed = hideBtn2 && hideBtn2.querySelector('svg');
      out.closedHasLine = !!(svgClosed && svgClosed.querySelector('path[d*=\"3.6 8\"]'));
      // 再点 → 显示（睁眼）
      if (hideBtn2) { hideBtn2.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(400);
      var j2 = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      out.hiddenRestored = !(j2.hidden && j2.hidden.length);
      var done = document.querySelector('.dsh-wt_manageDone');
      if (done) { done.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(300);
      // B. 收起侧栏 → 方形按钮
      var collapseBtn = document.querySelector('button.hHd-Xa_toggle');
      out.collapseFound = !!collapseBtn;
      if (collapseBtn) { collapseBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(800);
      var rail = vis('.dsh-wt_rail');
      out.railShown = !!rail;
      var btns = document.querySelectorAll('.dsh-wt_railBtn');
      out.railBtnCount = btns.length;
      var b0 = btns[0];
      if (b0) {
        var br = b0.getBoundingClientRect();
        out.btnW = Math.round(br.width);
        out.btnH = Math.round(br.height);
        out.btn0Text = b0.textContent;
        out.btnRadius = getComputedStyle(b0).borderRadius;
        var box = b0.parentElement;
        out.boxGap = getComputedStyle(box).columnGap;
        out.btnPointer = getComputedStyle(b0).pointerEvents;
      }
      // 点击 t-bind 布局按钮（icon 🧪）→ 打开该项目
      var layoutBtn = [].slice.call(btns).find(function(b){ return b.textContent === '🧪'; });
      out.layoutBtnFound = !!layoutBtn;
      if (layoutBtn) { layoutBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(900);
      out.specAfterRailClick = st.active && st.spec ? st.spec.id : null;
      st.close(); await sleep(300);
      // 重新展开侧栏（同一 hHd-Xa_toggle 按钮标题翻转）
      var expandBtn = document.querySelector('button.hHd-Xa_toggle');
      if (expandBtn) { expandBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(800);
      out.railGoneAfterExpand = !vis('.dsh-wt_rail');
    } catch (e) { out.err = String(e && e.stack || e); }
    return out;
  })()`);
  console.log('RESULT ' + JSON.stringify(out));
  try { ws.close(); } catch {}
  proc.kill();
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} });
