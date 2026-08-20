// diagload-mini.cjs — 诊断插件加载：控制台错误 + 关键全局 + 区块 DOM
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9366;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-diagload',
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
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{ if(window===window.top && location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[],layouts:[{id:'t-layout',title:'L',top:null,left:null,main:[{id:'p1',title:'W',min:200,content:null}],chatWidth:{default:320,min:240,max:600},chatSide:'right',chatFullHeight:false}],bindings:{},folders:{}})); } }catch(e){}",
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await sleep(10000);
  // 新 UI：点击「展开侧边栏」
  const exp = await evaluate(`(function(){ var b = document.querySelector('button[aria-label=\"展开侧边栏\"]'); if (b) { b.click(); return true; } return false; })()`);
  console.log('EXPAND:', JSON.stringify(exp));
  await sleep(1500);
  const pre = await evaluate(`(function(){
    // 找侧栏开关：dump 所有带 title/aria-label 的按钮
    var btns = [].slice.call(document.querySelectorAll('button[title], button[aria-label]')).slice(0, 30).map(function(b){ return { t: b.title || '', a: b.getAttribute('aria-label') || '', cls: String(b.className).slice(0, 50) }; });
    return JSON.stringify(btns);
  })()`);
  console.log('BUTTONS:', JSON.stringify(pre).slice(0, 2200));
  const step = await evaluate(`(function(){
    var out = {};
    out.dsh = !!window.__dshWorktable;
    // 侧栏结构：找可能的 section 容器并 dump 文本
    var cands = [].slice.call(document.querySelectorAll('aside, nav, [class*=sidebar], [class*=Sidebar], [class*=rail], [class*=Rail]')).slice(0, 8).map(function(el){ return { cls: String(el.className).slice(0, 60), text: String(el.innerText).slice(0, 120).replace(/\\n/g, ' | ') }; });
    out.sidebarCands = cands;
    // 顶层结构：body 直接子元素
    out.bodyKids = [].slice.call(document.body.children).map(function(el){ return { tag: el.tagName, cls: String(el.className).slice(0, 80), text: String(el.innerText).slice(0, 100).replace(/\\n/g, ' | ') }; });
    out.section = !!document.querySelector('.dsh-wt_section');
    out.root = !!document.querySelector('.dsh-wt_root');
    out.cards = document.querySelectorAll('.dsh-wt_layout').length;
    out.worktableText = document.body ? (document.body.innerText.indexOf('工作台') >= 0) : null;
    return JSON.stringify(out);
  })()`);
  console.log('DIAGLOAD:', JSON.stringify(step));
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
    .slice(-10).map((e) => e.method === 'Runtime.exceptionThrown'
      ? 'EXC: ' + ((e.params.exceptionDetails.exception || {}).description || '').slice(0, 260)
      : 'LOG: ' + (e.params.entry.text || '').slice(0, 200) + ' | ' + (e.params.entry.url || '').slice(0, 120));
  console.log('ERRORS:', JSON.stringify(errs, null, 1));
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
