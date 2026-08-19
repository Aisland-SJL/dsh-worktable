// arrow-mini.cjs — 箭头字面中心与卡片/项目名中心对齐 + 圆点间距 4px
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9347;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-arrow',
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
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable"); if (ready === true) break; }
  await sleep(1500);
  const step = await evaluate(`(function(){
    var out = {};
    try {
      var card = document.querySelector('.dsh-wt_layout');
      var arrow = card && card.querySelector('.dsh-wt_layoutArrow');
      var name = card && card.querySelector('.dsh-wt_layoutName');
      var centerOf = function(r){ return (r.top + r.bottom) / 2; };
      if (card && arrow && name) {
        var cr = card.getBoundingClientRect();
        var nr = name.getBoundingClientRect();
        // 字面（glyph）真实矩形：Range 选箭头文本节点
        var range = document.createRange();
        range.selectNodeContents(arrow);
        var ar = range.getBoundingClientRect();
        out.cardCenter = Math.round(centerOf(cr) * 10) / 10;
        out.nameCenter = Math.round(centerOf(nr) * 10) / 10;
        out.arrowGlyphCenter = Math.round(centerOf(ar) * 10) / 10;
        out.arrowDeltaFromCard = Math.round((centerOf(ar) - centerOf(cr)) * 10) / 10;
        out.arrowDeltaFromName = Math.round((centerOf(ar) - centerOf(nr)) * 10) / 10;
        var cs = getComputedStyle(arrow);
        out.arrowLineHeight = cs.lineHeight; out.arrowFontSize = cs.fontSize;
      }
      // 圆点间距
      var btn = card && card.querySelector('.dsh-wt_bindBtn');
      if (btn) {
        var b4 = getComputedStyle(btn.querySelector('.dsh-wt_bindCircles'), '::before');
        var b5 = getComputedStyle(btn.querySelector('.dsh-wt_bindCircles'), '::after');
        out.gap = (parseFloat(b5.left)||0) - (parseFloat(b4.width)||0);
      }
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('ARROW:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
