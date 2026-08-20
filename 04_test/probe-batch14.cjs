// probe-batch14.cjs — 标签栏最左 ↻ 统一刷新（撤地址栏/悬浮两套旧刷新）
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9371;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch14',
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
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var st = window.__dshWorktable.splitStore;
    try {
      // A. iframe 网页标签：标签栏最左 ↻，无悬浮/无 wrap
      st.open({id:'t-frame',title:'f',top:null,main:[{id:'p1',title:'W',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
      await sleep(600);
      st.openTab('main', 0, { kind: 'iframe', url: 'https://example.com', title: 'web' });
      await sleep(900);
      var tab = vis('.dsh-wt_tab');
      var first = tab && tab.firstElementChild;
      out.iframe_tabRefreshFirst = !!first && first.className === 'dsh-wt_tabRefresh';
      out.iframe_refreshTitle = first ? first.getAttribute('title') : null;
      out.iframe_noWrap = !vis('.dsh-wt_frameWrap');
      out.iframe_noFloat = !vis('.dsh-wt_frameRefresh');
      var f1 = vis('.dsh-wt_paneFrame');
      if (first) { first.click(); }
      await sleep(700);
      var f2 = vis('.dsh-wt_paneFrame');
      out.iframe_remounted = !!f1 && !!f2 && f1 !== f2;
      st.close(); await sleep(300);
      // B. 浏览器内置窗：地址栏只剩 ↗（无 ↻），标签栏有 ↻ 且点击重挂载
      st.open({id:'t-br',title:'b',top:null,main:[{id:'p2',title:'B',min:200,content:{kind:'builtin',type:'browser'}}],chatWidth:{default:320,min:240,max:600}});
      await sleep(1200);
      var bar = vis('.dsh-wt_browserBar');
      out.browser_goCount = bar ? bar.querySelectorAll('.dsh-wt_browserGo').length : null;
      var btab = vis('.dsh-wt_tab');
      var bfirst = btab && btab.firstElementChild;
      out.browser_tabRefreshFirst = !!bfirst && bfirst.className === 'dsh-wt_tabRefresh';
      var g1 = vis('.dsh-wt_paneFrame');
      if (bfirst) { bfirst.click(); }
      await sleep(700);
      var g2 = vis('.dsh-wt_paneFrame');
      out.browser_remounted = !!g1 && !!g2 && g1 !== g2;
      st.close(); await sleep(300);
      // C. 动画窗：同样地址栏无 ↻、标签栏有 ↻
      st.open({id:'t-anim',title:'a',top:null,main:[{id:'p3',title:'A',min:200,content:{kind:'builtin',type:'anim'}}],chatWidth:{default:320,min:240,max:600}});
      await sleep(800);
      var abar = vis('.dsh-wt_browserBar');
      out.anim_goCount = abar ? abar.querySelectorAll('.dsh-wt_browserGo').length : null;
      var atab = vis('.dsh-wt_tab');
      var afirst = atab && atab.firstElementChild;
      out.anim_tabRefreshFirst = !!afirst && afirst.className === 'dsh-wt_tabRefresh';
      st.close(); await sleep(300);
      // D. 非网页标签（tasks）：不放刷新按钮
      st.open({id:'t-tasks',title:'t',top:null,main:[{id:'p4',title:'T',min:200,content:{kind:'builtin',type:'tasks'}}],chatWidth:{default:320,min:240,max:600}});
      await sleep(800);
      var ttab = vis('.dsh-wt_tab');
      var tfirst = ttab && ttab.firstElementChild;
      out.tasks_noRefresh = !!(tfirst && tfirst.className !== 'dsh-wt_tabRefresh');
      out.tasks_firstClass = tfirst ? tfirst.className : null;
      st.close(); await sleep(200);
    } catch (e) { out.err = String(e && e.stack || e); }
    return out;
  })()`);
  console.log('RESULT ' + JSON.stringify(out));
  try { ws.close(); } catch {}
  proc.kill();
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} });
