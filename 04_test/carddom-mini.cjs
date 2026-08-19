// carddom-mini.cjs — 打印入驻卡与布局卡的子元素结构，找箭头
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9348;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-carddom',
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
  await sleep(1800);
  const step = await evaluate(`(function(){
    var out = {};
    var dump = function(card){
      var kids = [];
      [].slice.call(card.children).forEach(function(el){
        var r = el.getBoundingClientRect();
        kids.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), text: String(el.textContent).trim().slice(0, 12), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), lineH: getComputedStyle(el).lineHeight, fs: getComputedStyle(el).fontSize });
      });
      return kids;
    };
    var ta = document.querySelector('.dsh-wt_projects .ta_card') || document.querySelector('.ta_card');
    var pr = document.querySelector('.dsh-wt_projects .pr_card') || document.querySelector('.pr_card');
    var lay = document.querySelector('.dsh-wt_projects .dsh-wt_layout');
    out.taExists = !!ta; out.prExists = !!pr; out.layExists = !!lay;
    var centerOf = function(r){ return (r.top + r.bottom) / 2; };
    var measureArrow = function(card){
      var a = card.querySelector('.dsh-wt_resArrow') || card.querySelector('.ta_cardArrow') || card.querySelector('.pr_cardArrow');
      if (!a) return null;
      var cr = card.getBoundingClientRect();
      var range = document.createRange();
      range.selectNodeContents(a);
      var ar = range.getBoundingClientRect();
      return { cls: String(a.className).slice(0,40), glyphCenter: Math.round(centerOf(ar)*10)/10, cardCenter: Math.round(centerOf(cr)*10)/10, delta: Math.round((centerOf(ar)-centerOf(cr))*10)/10 };
    };
    out.taArrow = measureArrow(ta);
    out.prArrow = measureArrow(pr);
    out.layArrow = measureArrow(lay);
    if (ta) { var r = ta.getBoundingClientRect(); out.taRect = { top: Math.round(r.top), h: Math.round(r.height), center: Math.round(r.top + r.height/2) }; out.taKids = dump(ta); }
    if (pr) { var r2 = pr.getBoundingClientRect(); out.prRect = { top: Math.round(r2.top), h: Math.round(r2.height), center: Math.round(r2.top + r2.height/2) }; out.prKids = dump(pr); }
    if (lay) { var r3 = lay.getBoundingClientRect(); out.layRect = { top: Math.round(r3.top), h: Math.round(r3.height), center: Math.round(r3.top + r3.height/2) }; out.layKids = dump(lay); }
    return JSON.stringify(out);
  })()`);
  console.log('CARDDOM:', JSON.stringify(step));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
