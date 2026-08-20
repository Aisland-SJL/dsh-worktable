// termraw-mini.cjs — 直连终端 WS 抓原始输出：判断服务端是否已用 -NoProfile
const WebSocket = require('ws');
const http = require('http');
const ws = new WebSocket('ws://127.0.0.1:3080/api/worktable/term?sessionId=&cwd=E:\\AI_Workspace\\DeepseekHarness&cols=100&rows=24');
let buf = '';
const timer = setTimeout(() => {
  console.log('RAW:', JSON.stringify(buf.slice(0, 700)));
  ws.close();
  process.exit(0);
}, 5000);
ws.on('open', () => { console.log('OPEN'); ws.send('\r'); });
ws.on('message', (d) => { buf += String(d); if (buf.indexOf('>') >= 0 && buf.length > 40) { clearTimeout(timer); console.log('RAW:', JSON.stringify(buf.slice(0, 700))); ws.close(); process.exit(0); } });
ws.on('error', (e) => { console.log('ERR', e.message); process.exit(1); });
