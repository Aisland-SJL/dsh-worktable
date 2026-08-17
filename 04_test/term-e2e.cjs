
/**
 * 终端端到端测试：模拟宿主加载方式（经 profile junction 路径 import 服务端 bundle），
 * 用真实 http server + ws 客户端验证 /api/worktable/term 能否拉起 shell。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

(async () => {
  const bundleUrl = 'file:///C:/Users/SJL/.dsh/profiles/web/node_modules/dsh-worktable/lib/index.js';
  const mod = await import(bundleUrl);
  const upgrades = [];
  const routes = [];
  const ctx = {
    logger: {
      warn: (...a) => console.log('[logger-warn]', ...a),
      info: (...a) => console.log('[logger-info]', ...a),
    },
    sessions: { get: () => undefined },
    webServer: {
      register(r) { routes.push(r); return () => {} },
      registerUpgrade(r) { upgrades.push(r); return () => {} },
    },
  };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 2500)); // 等异步 setupTerminal 完成（真实宿主进程长驻）
  console.log('routes:', routes.map((r) => r.path).join(', '));
  console.log('upgrade routes:', upgrades.map((r) => r.path).join(', ') || '(none)');
  if (upgrades.length === 0) { console.log('RESULT: NO_TERMINAL_ROUTE'); process.exit(1); }

  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const route = upgrades.find((r) => u.pathname === r.path);
    if (!route) { socket.destroy(); return; }
    route.handler(req, socket, head);
  });
  await new Promise((r) => server.listen(19087, '127.0.0.1', r));

  const ws = new WebSocket('ws://127.0.0.1:19087/api/worktable/term?cwd=' + encodeURIComponent(process.cwd()) + '&cols=80&rows=24');
  const received = [];
  const done = (code, msg) => { console.log('RESULT: ' + code + ' ' + msg); try { ws.close(); } catch {} server.close(); process.exit(code === 'PASS' ? 0 : 1); };
  const timer = setTimeout(() => done('FAIL', '10s 内无输出'), 10000);
  ws.on('open', () => { ws.send('echo __WT_TERM_OK__\r'); });
  ws.on('message', (d) => {
    const t = String(d);
    received.push(t);
    if (t.includes('__WT_TERM_OK__')) { clearTimeout(timer); done('PASS', 'shell 回显正常 (' + received.length + ' 帧)'); }
  });
  ws.on('error', (e) => { clearTimeout(timer); done('FAIL', String(e)); });
})().catch((e) => { console.log('RESULT: HARNESS_FAIL', e); process.exit(1); });
