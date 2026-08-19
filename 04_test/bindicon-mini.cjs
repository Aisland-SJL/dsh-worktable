// bindicon-mini.cjs — 绑定图标：尺寸/黑白单色/hover气泡（data-tip 解析）
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9345;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-bindicon',
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
      var read = function(b){
        var cs = getComputedStyle(b);
        var c4 = getComputedStyle(b.querySelector('.dsh-wt_bindCircles'), '::before');
        var aft = getComputedStyle(b, '::after');
        var c5 = getComputedStyle(b.querySelector('.dsh-wt_bindCircles'), '::after');
        return { w: cs.width, h: cs.height, radius: cs.borderRadius, color: cs.color, circleW: c4.width, circleBorder: c4.borderTopWidth, circleFill: c4.backgroundColor, circleLeft: c4.left, circle2Left: c5.left, gap: (parseFloat(c5.left)||0) - (parseFloat(c4.width)||0), tip: aft.content, tipRight: aft.right, tipLeft: aft.left, hoverBg: cs.backgroundColor };
      };
      // 未绑定态
      out.unbound = read(btn);
      // 绑定（UI 路径：点按钮 → 选第一项）
      btn.click();
      await sleep(900);
      var items = [].slice.call(document.querySelectorAll('.dsh-wt_bindList .dsh-wt_selectItem'));
      if (items[0]) { items[0].click(); }
      await sleep(900);
      var btn2 = card.querySelector('.dsh-wt_bindBtn');
      var bound = read(btn2);
      out.bound = bound;
      out.boundSolid = bound.circleFill !== 'rgba(0, 0, 0, 0)' && bound.circleFill !== 'transparent';
      out.boundColorIsAccent = /4f8ef7|accent/i.test(bound.color);
      out.tipHasName = bound.tip && bound.tip.indexOf('\u5df2\u7ed1\u5b9a') >= 0 && bound.tip.length > 6;
      // 清理：解绑
      btn2.click();
      await sleep(900);
      var unbind = vis('.dsh-wt_bindUnbind');
      if (unbind) { unbind.click(); }
      await sleep(400);
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('BINDICON:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
