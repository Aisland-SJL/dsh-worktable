const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 9335;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-func2',
  'about:blank',
], { stdio: 'ignore' });

function getJSON(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } });
    }).on('error', rej);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await getJSON('/json/list'); if (list && list.length) break; } catch {}
    await sleep(500);
  }
  const target = list.find((t) => t.type === 'page') || list[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  const send = (method, params) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  await sleep(11000);

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const step1 = await evaluate("(function(){ var out={}; out.debugExport=!!window.__dshWorktable; var st=window.__dshWorktable&&window.__dshWorktable.splitStore; if(!st) return JSON.stringify(out); out.openResult=st.open({id:'t-diag',title:'diag',top:null,main:[{id:'p1',title:'1',min:200,content:null},{id:'p2',title:'2',min:200,content:null}],chatWidth:{default:320,min:240,max:600}}); out.afterOpen={active:st.active,spec:st.spec&&st.spec.id}; return JSON.stringify(out) })()");
  console.log('STEP1:', JSON.stringify(step1));
  await sleep(900);

  const step2 = await evaluate("(function(){ var out={}; out.pickers=document.querySelectorAll('.dsh-wt_panePicker').length; out.pickButtons=document.querySelectorAll('.dsh-wt_panePick').length; var st=window.__dshWorktable.splitStore; st.openTab('main',0,{kind:'builtin',type:'browser'}); st.openTab('main',1,{kind:'builtin',type:'explorer'}); return JSON.stringify(out) })()");
  console.log('STEP2:', JSON.stringify(step2));
  await sleep(900);

  const step3 = await evaluate("(function(){ var out={}; out.browserBar=document.querySelectorAll('.dsh-wt_browserBar').length; out.browserIframe=document.querySelectorAll('.dsh-wt_paneFrame').length; out.explorerBars=document.querySelectorAll('.dsh-wt_subBar').length; out.tabs=document.querySelectorAll('.dsh-wt_tab').length; return JSON.stringify(out) })()");
  console.log('STEP3:', JSON.stringify(step3));

  const step4 = await evaluate("(function(){ var st=window.__dshWorktable.splitStore; var tabId=st.spec.main[0].tabs[0].id; st.moveTab('main',0,tabId,'main',1); var out={pane0Tabs:(st.spec.main[0].tabs||[]).length,pane1Tabs:(st.spec.main[1].tabs||[]).length}; return JSON.stringify(out) })()");
  console.log('STEP4:', JSON.stringify(step4));
  await sleep(700);

  const step5 = await evaluate("(function(){ var out={}; out.pane0PickerBack=document.querySelectorAll('.dsh-wt_panePicker').length; var st=window.__dshWorktable.splitStore; st.close(); out.closed=st.active===false; return JSON.stringify(out) })()");
  console.log('STEP5:', JSON.stringify(step5));

  const errors = events.filter((e) =>
    e.method === 'Runtime.exceptionThrown' ||
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'),
  ).slice(0, 10).map((e) => e.method === 'Runtime.exceptionThrown'
    ? 'EXCEPTION: ' + ((e.params.exceptionDetails.exception || {}).description || e.params.exceptionDetails.text)
    : 'LOG: ' + (e.params.entry ? e.params.entry.text : '').slice(0, 200));
  console.log('ERRORS_COUNT:', errors.length);
  errors.forEach((x) => console.log(x));
  ws.close();
  proc.kill();
  process.exit(0);
})().catch((e) => { console.log('SCRIPT_FAIL:', e); proc.kill(); process.exit(1); });
