// probe-update-scenarios.cjs — 更新检查五场景定向验证（CDP Fetch 拦截；fulfill 带 CORS 头）
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9398;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1200,800', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-updscn2',
  'about:blank',
], { stdio: 'ignore' });
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OK_BODY = Buffer.from(JSON.stringify({ tag_name: 'v0.1.0', body: 'scenario test', html_url: 'https://example.com/x' })).toString('base64');
const FAIL_BODY = Buffer.from('{"message":"boom"}').toString('base64');
const HI_BODY = Buffer.from(JSON.stringify({ tag_name: 'v0.2.3', body: 'v0.2.3 release notes', html_url: 'https://example.com/hi' })).toString('base64');
const HDRS = [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }];
let mode = 'success';
let reqCount = 0;
let fulfillCount = 0;
(async () => {
  let list = null;
  for (let i = 0; i < 40; i++) { try { list = await getJSON('/json/list'); if (list && list.length) break; } catch {} await sleep(500); }
  const target = list.find((t) => t.type === 'page') || list[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Fetch.requestPaused') {
      reqCount++;
      const rid = m.params.requestId;
      if (mode === 'pending') {
        setTimeout(() => { try { ws.send(JSON.stringify({ id: ++id, method: 'Fetch.continueRequest', params: { requestId: rid } })); } catch {} }, 9000);
      } else if (mode === 'fail500') {
        ws.send(JSON.stringify({ id: ++id, method: 'Fetch.fulfillRequest', params: { requestId: rid, responseCode: 500, responseHeaders: HDRS, body: FAIL_BODY } }));
      } else if (mode === 'twothenok') {
        if (fulfillCount < 2) { fulfillCount++; ws.send(JSON.stringify({ id: ++id, method: 'Fetch.fulfillRequest', params: { requestId: rid, responseCode: 500, responseHeaders: HDRS, body: FAIL_BODY } })); }
        else { ws.send(JSON.stringify({ id: ++id, method: 'Fetch.fulfillRequest', params: { requestId: rid, responseCode: 200, responseHeaders: HDRS, body: OK_BODY } })); }
      } else if (mode === 'slowok') {
        setTimeout(() => { try { ws.send(JSON.stringify({ id: ++id, method: 'Fetch.fulfillRequest', params: { requestId: rid, responseCode: 200, responseHeaders: HDRS, body: OK_BODY } })); } catch {} }, 2500);
      } else if (mode === 'hiok') {
        ws.send(JSON.stringify({ id: ++id, method: 'Fetch.fulfillRequest', params: { requestId: rid, responseCode: 200, responseHeaders: HDRS, body: HI_BODY } }));
      } else {
        ws.send(JSON.stringify({ id: ++id, method: 'Fetch.fulfillRequest', params: { requestId: rid, responseCode: 200, responseHeaders: HDRS, body: OK_BODY } }));
      }
    }
  });
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*api.github.com*' }] });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: String(r.result.exceptionDetails.text) };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const rowSnap = () => evaluate("(function(){ var r=document.querySelector('.dsh-wt_versionRow'); if(!r) return null; var btn=Array.from(r.querySelectorAll('button')).find(function(b){ return b.textContent.indexOf('检查')>=0 || b.textContent.indexOf('Check')>=0; }); return { text: r.innerText.replace(/\\s+/g,' '), disabled: btn ? btn.disabled : null, label: btn ? btn.textContent.trim() : null }; })()");
  const openSettings = async () => {
    await evaluate("(function(){ var b=document.querySelector('button[title=\"设置\"]')||document.querySelector('button[title=\"Settings\"]'); if(b) b.click(); })()");
    await sleep(500);
  };
  const clickCheck = async () => {
    await evaluate("(function(){ var r=document.querySelector('.dsh-wt_versionRow'); if(!r) return; var btn=Array.from(r.querySelectorAll('button')).find(function(b){ return b.textContent.indexOf('检查')>=0 || b.textContent.indexOf('Check')>=0; }); if(btn) btn.click(); })()");
  };
  async function scenario(name, opts) {
    mode = opts.mode; fulfillCount = 0;
    // 预热加载：让首屏自动检查在计数前跑完
    await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
    await sleep(6000);
    const rail = await evaluate("!!document.querySelector('.dsh-wt_rail')");
    if (rail) { await evaluate("(function(){ var b=document.querySelector('button.hHd-Xa_toggle'); if(b) b.click(); })()"); await sleep(1500); }
    await evaluate("localStorage.setItem('dsh.worktable.lastUpdateCheck.v1', String(Date.now())); localStorage.removeItem('dsh.worktable.skipVersion.v1');");
    reqCount = 0;
    await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
    await sleep(6000);
    const rail2 = await evaluate("!!document.querySelector('.dsh-wt_rail')");
    if (rail2) { await evaluate("(function(){ var b=document.querySelector('button.hHd-Xa_toggle'); if(b) b.click(); })()"); await sleep(1500); }
    await openSettings();
    const before = await rowSnap();
    await clickCheck();
    if (opts.reentry) { for (let i = 0; i < 4; i++) { await clickCheck(); } }
    await sleep(Math.min(900, opts.waitMs));
    const mid = await rowSnap();
    await sleep(opts.waitMs);
    const end = await rowSnap();
    console.log('SCENARIO[' + name + '] requests=' + reqCount);
    console.log('  mid:', JSON.stringify(mid));
    console.log('  end:', JSON.stringify(end));
    return { before, mid, end, requests: reqCount };
  }
  const results = [];
  results.push(['1-success', await scenario('1-success', { mode: 'success', waitMs: 4000 })]);
  results.push(['2-pending-timeout', await scenario('2-pending-timeout', { mode: 'pending', waitMs: 26000 })]);
  results.push(['3-twothenok', await scenario('3-twothenok', { mode: 'twothenok', waitMs: 5000 })]);
  results.push(['4-fail-all', await scenario('4-fail-all', { mode: 'fail500', waitMs: 4000 })]);
  results.push(['5-reentry', await scenario('5-reentry', { mode: 'slowok', waitMs: 4000, reentry: true })]);
  results.push(['6-higher-version', await scenario('6-higher-version', { mode: 'hiok', waitMs: 4000 })]);
  const hiState = await evaluate("(function(){ var b=document.querySelector('.dsh-wt_updateBadge'); if(!b) return {badge:false}; b.click(); return {badge:true}; })()");
  await sleep(700);
  const hiCard = await evaluate("(function(){ var c=document.querySelector('.dsh-wt_updateCard'); if(!c) return {card:false}; return {card:true, text:c.innerText.replace(/\\s+/g,' ')}; })()");
  console.log('HI_BADGE:', JSON.stringify(hiState), 'HI_CARD:', JSON.stringify(hiCard));
  let pass = true;
  const ok = (cond, label) => { if (!cond) { pass = false; console.log('  ❌ ' + label); } else { console.log('  ✓ ' + label); } };
  const [, s1] = results[0]; ok(s1.requests >= 1 && /已是最新版本|Up to date/.test(s1.end.text || ''), '成功 → 已是最新版本');
  const [, s2] = results[1]; ok(s2.requests === 3 && /上次检查未成功|Last check failed/.test(s2.end.text || ''), 'pending×3 超时 → 失败提示'); ok(s2.mid && s2.mid.disabled === true && /检查中|Checking/.test(s2.mid.label || ''), '检查中按钮禁用+文案');
  const [, s3] = results[2]; ok(s3.requests === 3 && /已是最新版本|Up to date/.test(s3.end.text || ''), '两败一成 → 已是最新版本');
  const [, s4] = results[3]; ok(s4.requests === 3 && /上次检查未成功|Last check failed/.test(s4.end.text || ''), '三败 → 失败提示');
  const [, s5] = results[4]; ok(s5.requests === 1, '慢响应期间连点 5 次仅 1 个 in-flight（防重入）'); ok(s5.mid && s5.mid.disabled === true, '请求进行中按钮保持禁用');
  const [, s6] = results[5]; ok(s6.requests >= 1 && hiState && hiState.badge === true && hiCard && hiCard.card === true && /v0\.2\.3/.test(hiCard.text || ''), '更高版本 → 徽标亮起 + 更新卡显示 v0.2.3');
  console.log(pass ? 'ALL SCENARIOS PASS' : 'SCENARIO FAILURES PRESENT');
  ws.close(); proc.kill(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} process.exit(1); });
