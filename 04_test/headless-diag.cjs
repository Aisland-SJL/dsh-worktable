
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const WebSocket = require('ws');

const PORT = 9333;
const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chrome = candidates.find((p) => fs.existsSync(p));
if (!chrome) { console.log('NO_BROWSER_FOUND'); process.exit(1); }
console.log('browser:', chrome);

const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-debug',
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
  if (!list || !list.length) { console.log('NO_DEBUG_TARGET'); proc.kill(); process.exit(1); }
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
  await sleep(12000);
  const result = await send('Runtime.evaluate', {
    expression: "JSON.stringify({ wtSection: !!document.querySelector('.dsh-wt_section'), taCard: !!document.querySelector('.ta_card'), prCard: !!document.querySelector('.pr_card'), taEntry: !!document.querySelector('.dsh-ta_entry'), usageDock: !!document.querySelector('.u_dock'), railBox: !!document.querySelector('.dsh-wt_railBox'), readyState: document.readyState, bodyText: (document.body ? document.body.innerText.slice(0,200) : '') })",
    returnByValue: true,
  });
  console.log('DOM_STATE:', result.result && result.result.result && result.result.result.value);
  const errors = events.filter((e) =>
    e.method === 'Runtime.exceptionThrown' ||
    (e.method === 'Log.entryAdded' && (e.params.entry.level === 'error' || e.params.entry.level === 'warning')) ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'),
  ).slice(0, 25).map((e) => {
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params.exceptionDetails;
      return 'EXCEPTION: ' + (d.exception && d.exception.description || d.text) + ' @ ' + (d.url || '') + ':' + (d.lineNumber || 0);
    }
    if (e.method === 'Log.entryAdded') return 'LOG[' + e.params.entry.level + ']: ' + (e.params.entry.text || '').slice(0, 300);
    return 'CONSOLE_ERROR: ' + (e.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300);
  });
  console.log('ERRORS_COUNT:', errors.length);
  errors.forEach((x) => console.log(x));
  ws.close();
  proc.kill();
  process.exit(0);
})().catch((e) => { console.log('SCRIPT_FAIL:', e); proc.kill(); process.exit(1); });
