// preview-cold2.cjs — 冷会话 binding() 面对象方法侦察
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9376;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-pvcold2',
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
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshSessions"); if (ready === true) break; }
  await sleep(1200);
  const out = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    try {
      var svc = window.__dshSessions;
      out.svcKeys = Object.getOwnPropertyNames(svc ? Object.getPrototypeOf(svc) : {}).slice(0, 40);
      var listSnap = svc.list && svc.list.getSnapshot ? svc.list.getSnapshot() : null;
      out.ids = listSnap && listSnap.ids ? listSnap.ids.slice(0, 6) : null;
      out.byIdKeys = listSnap && listSnap.byId ? Object.keys(listSnap.byId).slice(0, 3) : null;
      var sid = listSnap && listSnap.ids ? listSnap.ids[0] : null;
      out.sid = sid;
      if (sid) {
        var b = svc.binding(sid);
        out.hasBinding = !!b;
        var face = b && b.session;
        out.faceKeys = face ? Object.getOwnPropertyNames(Object.getPrototypeOf(face)).slice(0, 40) : null;
        var snap = face && face.getSnapshot ? face.getSnapshot() : null;
        out.nodesLen = snap && snap.nodes ? snap.nodes.length : null;
        out.hasLoadOlder = !!(face && typeof face.loadOlder === 'function');
        // 试 loadOlder
        if (face && typeof face.loadOlder === 'function') {
          try {
            await face.loadOlder();
            await sleep(1500);
            var snap2 = face.getSnapshot();
            out.nodesLenAfterLoadOlder = snap2 && snap2.nodes ? snap2.nodes.length : null;
            out.hasMore = snap2 ? snap2.hasMore : null;
          } catch (e) { out.loadOlderErr = String(e); }
        }
        // 试原型上的 history 方法（非公开接口，只读侦察）
        out.historyProbe = null;
        if (face && typeof face.history === 'function') {
          try {
            var r1 = await face.history({ maxMessages: 100 });
            var res = r1 && r1.result;
            out.historyProbe = { type: typeof r1, isArray: Array.isArray(r1), len: r1 && r1.length != null ? r1.length : null, keys: r1 && typeof r1 === 'object' && !Array.isArray(r1) ? Object.keys(r1).slice(0, 10) : null };
            out.historyResult = null;
            try {
              if (res && res.ok !== false) {
                var val = res.value != null ? res.value : res;
                var items = val.items != null ? val.items : (val.entries != null ? val.entries : (val.messages != null ? val.messages : (Array.isArray(val) ? val : null)));
                out.historyResult = {
                  resKeys: Object.keys(res).slice(0, 12),
                  valType: val === null ? 'null' : typeof val,
                  valKeys: val && typeof val === 'object' && !Array.isArray(val) ? Object.keys(val).slice(0, 12) : null,
                  valSample: JSON.stringify(val).slice(0, 600),
                  itemsType: items ? (Array.isArray(items) ? 'array' : typeof items) : null,
                  itemsLen: items && items.length != null ? items.length : null,
                  first: items && items[0] ? JSON.stringify(items[0]).slice(0, 400) : null,
                  last: items && items.length ? JSON.stringify(items[items.length - 1]).slice(0, 400) : null,
                };
                // 事件类型分布 + 尾部寻找成品消息文本
                try {
                  var evs = val && Array.isArray(val.events) ? val.events : [];
                  var types = {};
                  evs.forEach(function(ev){ var tt = ev && ev.event && ev.event.type; types[tt] = (types[tt]||0)+1; });
                  out.eventTypes = types;
                  out.eventsLen = evs.length;
                  var tailTexts = [];
                  for (var i = evs.length - 1; i >= 0 && tailTexts.length < 4; i--) {
                    var ev = evs[i] && evs[i].event;
                    if (!ev) continue;
                    var d = ev.data || {};
                    if (ev.type === 'user/message' || ev.type === 'user') {
                      var blocks = d.content || d.blocks || [];
                      var s = '';
                      if (Array.isArray(blocks)) blocks.forEach(function(b){ if (b && typeof b.text === 'string') s += b.text; });
                      if (s) tailTexts.push({ type: ev.type, text: s.slice(0, 80) });
                    } else if (ev.type === 'assistant/message' || ev.type === 'assistant') {
                      var b2 = d.message || d;
                      var bl2 = b2.content || b2.blocks || [];
                      var s2 = '';
                      if (Array.isArray(bl2)) bl2.forEach(function(b){ if (b && typeof b.text === 'string') s2 += b.text; });
                      if (s2) tailTexts.push({ type: ev.type, text: s2.slice(0, 80) });
                    }
                  }
                  out.tailTexts = tailTexts;
                  // 成品消息事件样本
                  var samples = [];
                  for (var j = evs.length - 1; j >= 0 && samples.length < 2; j--) {
                    var evj = evs[j] && evs[j].event;
                    if (evj && (evj.type === 'user/message' || evj.type === 'assistant/message')) {
                      samples.push(JSON.stringify(evj).slice(0, 500));
                    }
                  }
                  out.msgSamples = samples;
                } catch (e4) { out.tailErr = String(e4); }
              } else {
                out.historyResult = { resKeys: Object.keys(res || {}).slice(0, 8), err: res && (res.error || res.code || JSON.stringify(res).slice(0, 120)) };
              }
            } catch (e3) { out.historyResultErr = String(e3); }
          } catch (e2) { out.historyErr = String(e2); }
        }
        // 找 history 类方法（原型链上）
        var protoNames = [];
        var p = Object.getPrototypeOf(face);
        var depth = 0;
        while (p && depth < 4) {
          protoNames = protoNames.concat(Object.getOwnPropertyNames(p));
          p = Object.getPrototypeOf(p); depth++;
        }
        out.historyLike = protoNames.filter(function(n){ return /histor|load|fetch|more|page/i.test(n); });
      }
    } catch (e) { out.err = String(e && e.stack || e); }
    return out;
  })()`);
  console.log('RESULT ' + JSON.stringify(out));
  try { ws.close(); } catch {}
  proc.kill();
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} });
