
const http = require('http');
const WebSocket = require('ws');
(async () => {
  const mod = await import('file:///C:/Users/SJL/.dsh/profiles/web/node_modules/dsh-worktable/lib/index.js');
  const routes = [];
  const upgrades = [];
  const ctx = {
    logger: { warn: (...a) => console.log('[warn]', ...a), info: (...a) => console.log('[info]', ...a) },
    sessions: { get: () => undefined },
    effect: (fn) => fn && fn(),
    webServer: {
      register(r) { routes.push(r); return () => {} },
      registerUpgrade(r) { upgrades.push(r); return () => {} },
    },
  };
  mod.apply(ctx);
  console.log('upgrades:', upgrades.map((r) => r.path).join(', ') || '(none)');
  const fsRoute = routes.find((r) => r.path === '/api/worktable/fs');
  let captured = null;
  const fakeRes = { writeHead: (s) => { captured = { status: s }; }, end: (b) => { captured.body = String(b); } };
  const fakeReq = { [Symbol.asyncIterator]() { let done = false; return { next: () => (done ? Promise.resolve({ done: true }) : (done = true, Promise.resolve({ done: false, value: Buffer.from('{"path":"E:/AI_Workspace"}') }))) }; } };
  await fsRoute.handler(fakeReq, fakeRes);
  console.log('fs direct:', captured && captured.status, captured && captured.body ? captured.body.slice(0, 160) : '');
  // file 路由直调（真实 README.md）
  const fileRoute = routes.find((r) => r.path === '/api/worktable/file');
  let fc = null;
  const fRes = { writeHead: (s) => { fc = { status: s }; }, end: (b) => { fc.body = String(b); } };
  const fReq = { url: '/api/worktable/file?path=' + encodeURIComponent('E:/AI_Workspace/DeepseekHarness/Projects/dsh-worktable/README.md') };
  await fileRoute.handler(fReq, fRes);
  console.log('file direct:', fc && fc.status, fc && fc.body ? fc.body.slice(0, 60) : '');
  if (upgrades.length === 0) { console.log('RESULT: NO_TERMINAL_ROUTE'); process.exit(1); }
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const route = upgrades.find((r) => u.pathname === r.path);
    if (!route) { socket.destroy(); return; }
    route.handler(req, socket, head);
  });
  await new Promise((r) => server.listen(19088, '127.0.0.1', r));
  const ws = new WebSocket('ws://127.0.0.1:19088/api/worktable/term?cwd=' + encodeURIComponent(process.cwd()) + '&cols=80&rows=24');
  const timer = setTimeout(() => { console.log('RESULT: FAIL 超时'); process.exit(1); }, 10000);
  ws.on('open', () => ws.send('pwd\r'));
  ws.on('message', (d) => {
    const t = String(d);
    if (t.length > 3 && /[A-Za-z]:[\\\/]/.test(t)) {
      clearTimeout(timer);
      console.log('RESULT: PASS pwd 回显正常: ' + t.slice(0, 90).replace(/\r?\n/g, ' | '));
      ws.close(); server.close(); process.exit(0);
    }
  });
  ws.on('error', (e) => { clearTimeout(timer); console.log('RESULT: FAIL ' + e); process.exit(1); });
})().catch((e) => { console.log('RESULT: HARNESS_FAIL', e); process.exit(1); });
