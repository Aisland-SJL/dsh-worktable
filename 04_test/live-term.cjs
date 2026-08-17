
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:3080/api/worktable/term?cwd=' + encodeURIComponent('E:/AI_Workspace') + '&cols=80&rows=24');
const received = [];
const timer = setTimeout(() => { console.log('RESULT: FAIL 15s 无任何输出'); process.exit(1); }, 15000);
ws.on('open', () => { console.log('WS_OPEN'); setTimeout(() => { console.log('SEND pwd'); ws.send('pwd\r'); }, 1500); });
ws.on('message', (d) => {
  const t = String(d);
  received.push(t);
  console.log('FRAME[' + received.length + ']:', JSON.stringify(t.slice(0, 100)));
  if (t.includes('E:\\AI_Workspace') || /[A-Za-z]:[\\/]/.test(t)) {
    clearTimeout(timer);
    console.log('RESULT: PASS pwd 真实回显 OK');
    ws.close(); process.exit(0);
  }
});
ws.on('close', (code) => { console.log('WS_CLOSE code=' + code); clearTimeout(timer); process.exit(0); });
ws.on('error', (e) => { console.log('WS_ERROR:', String(e)); clearTimeout(timer); process.exit(1); });
