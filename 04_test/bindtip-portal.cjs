// bindtip-portal.cjs — body 级气泡：向右伸出、z-index 高于分栏浮层、hover 显隐
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9346;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-bindtip',
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
    source: "try{ if(window===window.top && location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[],layouts:[{id:'t-layout',title:'L',top:null,left:null,main:[{id:'p1',title:'W',min:200,content:null}],chatWidth:{default:320,min:240,max:600},chatSide:'right',chatFullHeight:false}],bindings:{}})); } }catch(e){}",
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
      var card = document.querySelector('.dsh-wt_layout');
      var btn = card && card.querySelector('.dsh-wt_bindBtn');
      // 绑定一个对话（UI 路径）
      btn.click();
      await sleep(900);
      var items = [].slice.call(document.querySelectorAll('.dsh-wt_bindList .dsh-wt_selectItem'));
      if (items[0]) { items[0].click(); }
      await sleep(900);
      // 打开一个分栏工作区（浮层 z 68-72），验证气泡层级压得过它
      var st = window.__dshWorktable.splitStore;
      st.open({id:'t-over',title:'over',top:null,main:[{id:'p1',title:'W',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
      await sleep(900);
      var btn2 = card.querySelector('.dsh-wt_bindBtn');
      var br = btn2.getBoundingClientRect();
      window.__testFired = false;
      document.addEventListener('mouseover', function(){ window.__testFired = true; }, true);
      btn2.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
      await sleep(120);
      out.testFired = window.__testFired;
      var tip = document.querySelector('.dsh-wt_bindTip');
      out.tipEl = !!tip;
      out.tipDisplay = tip ? getComputedStyle(tip).display : null;
      out.btnTipAttr = btn2.getAttribute('data-tip');
      out.tipCalls = window.__tipCalls || 0;
      out.listenersFlag = window.__bindTipListeners === true;
      out.runs = window.__bindTipRuns || 0; out.cleans = window.__bindTipCleans || 0;
      out.overCalls = window.__overCalls || 0; out.overDocIsMain = window.__overDocIsMain;
      out.overTarget = window.__overTarget; out.overClosest = window.__overClosest;
      out.tipShown = !!tip && getComputedStyle(tip).display !== 'none';
      if (tip) {
        var tr = tip.getBoundingClientRect();
        out.tipText = tip.textContent;
        out.tipParentIsBody = tip.parentElement === document.body;
        out.tipZ = getComputedStyle(tip).zIndex;
        out.tipRightOfBtn = tr.left >= br.right - 1;
        out.tipLeft = Math.round(tr.left); out.btnRight = Math.round(br.right);
        var overlay = document.querySelector('.dsh-wt_pane');
        out.overlayZ = overlay ? getComputedStyle(overlay).zIndex : null;
      }
      btn2.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
      await sleep(120);
      out.tipHiddenAfterOut = !tip || getComputedStyle(tip).display === 'none';
      st.close();
      // 清理：解绑
      btn2.click();
      await sleep(900);
      var unbind = vis('.dsh-wt_bindUnbind');
      if (unbind) { unbind.click(); }
      await sleep(400);
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('BINDTIP:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
