// probe-batch4.cjs — 预设7/8几何 + ＋磁贴提示词 + 对话绑定全流程（末尾恢复原会话）
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9341;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch4',
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
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{ if(location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[],layouts:[],bindings:{}})); } }catch(e){} try { Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{ writeText: async function(t){ window.__copied = t; } }}); } catch(e) { window.__clipErr1 = String(e); } try { document.execCommand = function(cmd){ if (cmd === 'copy') { var ae = document.activeElement; window.__copied = ae && ae.value != null ? ae.value : window.__copied; return true; } return false; }; } catch(e) { window.__clipErr2 = String(e); }",
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable && !!window.__dshSessions"); if (ready === true) break; }
  await sleep(1500);
  console.log('READY:', JSON.stringify(ready));
  const step = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var setInput = function(el, v){ var s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})); };
    var setTA = function(el, v){ var s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; s.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})); };
    var st = window.__dshWorktable.splitStore;
    try {
      // A. 预设网格：8 预设 + 1 加号；保存 g4 与 l23
      document.querySelectorAll('.dsh-wt_actions .dsh-wt_iconBtn')[2].click();
      await sleep(300);
      var tiles = [].slice.call(document.querySelectorAll('.dsh-wt_presets .dsh-wt_preset'));
      out.tileCount = tiles.length;
      out.thumbCells = tiles.map(function(t){ return t.querySelectorAll('.dsh-wt_thumbCell').length; });
      out.plusTileLast = tiles.length > 0 && tiles[tiles.length-1].className.indexOf('dsh-wt_presetAdd') >= 0;
      var savePreset = async function(idx, name){
        var ts = [].slice.call(document.querySelectorAll('.dsh-wt_presets .dsh-wt_preset'));
        ts[idx].click();
        await sleep(250);
        var inp = document.querySelector('.dsh-wt_addForm input');
        setInput(inp, name);
        await sleep(250);
        document.querySelector('.dsh-wt_addBtn').click();
        await sleep(600);
      };
      await savePreset(6, 'G4');
      await sleep(300);
      document.querySelectorAll('.dsh-wt_actions .dsh-wt_iconBtn')[2].click();
      await sleep(400);
      await savePreset(7, 'L23');
      var saved = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).layouts;
      out.savedLen = saved.length;
      var g4 = saved[saved.length-2]; var l23 = saved[saved.length-1];
      out.g4 = { top: (g4.top||[]).length, main: g4.main.length, chatFull: g4.chatFullHeight===true, ratio: g4.topHeightRatio, titles: [...(g4.top||[]), ...g4.main].map(function(p){return p.title}) };
      out.l23 = { top: (l23.top||[]).length, main: l23.main.length, chatFull: l23.chatFullHeight===true, ratio: l23.topHeightRatio };
      // 打开 g4 验证几何（田字格四窗等大）
      if (st.active) { st.close(); await sleep(300); }
      st.open(g4);
      await sleep(1100);
      var panes = [].slice.call(document.querySelectorAll('.dsh-wt_pane')).filter(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); });
      out.g4Panes = panes.length;
      if (panes.length >= 4) {
        var rs = panes.map(function(p){ var r = p.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; });
        out.g4Rects = rs;
        out.g4TopEqualW = Math.abs(rs[0].w - rs[1].w) <= 8;
        out.g4BotEqualW = Math.abs(rs[2].w - rs[3].w) <= 8;
        out.g4RowsEqualH = Math.abs(rs[0].h - rs[2].h) <= 8;
        out.g4TopAbove = rs[0].top < rs[2].top;
      }
      st.close();
      await sleep(300);
      // C. 对话绑定全流程（用第一张布局卡的真实 id）
      var layouts = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).layouts;
      var lid = layouts[0].id;
      out.lid = lid;
      var S = window.__dshSessions;
      var snap0 = S.list.getSnapshot();
      var current0 = snap0.current;
      var ids0 = (snap0.ids || []).slice();
      out.idsAvail = ids0.length;
      var card0 = document.querySelectorAll('.dsh-wt_layout')[0];
      out.layoutCards = document.querySelectorAll('.dsh-wt_layout').length;
      var bindBtn = card0 && card0.querySelector('.dsh-wt_bindBtn');
      out.layoutBindBtn = !!bindBtn;
      if (bindBtn) { bindBtn.click(); }
      await sleep(900);
      out.bindPop = !!vis('.dsh-wt_bindPop');
      var items = [].slice.call(document.querySelectorAll('.dsh-wt_bindList .dsh-wt_selectItem'));
      out.bindItemCount = items.length;
      if (items[0]) { items[0].click(); }
      await sleep(900);
      var boundVal = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).bindings[lid];
      out.boundSaved = typeof boundVal === 'string' && boundVal.length > 0;
      out.boundIsSession = boundVal ? ids0.indexOf(boundVal) >= 0 : false;
      // 点卡 → 右侧对话应切到绑定会话
      if (card0) { card0.click(); }
      await sleep(1800);
      var snap1 = S.list.getSnapshot();
      out.currentAfterOpen = snap1.current;
      out.switchedToBound = boundVal ? snap1.current === boundVal : false;
      // 解绑 → 再点卡不切换
      var bindBtn2 = card0 && card0.querySelector('.dsh-wt_bindBtn');
      if (bindBtn2) { bindBtn2.click(); }
      await sleep(900);
      var unbind = vis('.dsh-wt_bindUnbind');
      out.unbindShown = !!unbind;
      if (unbind) { unbind.click(); }
      await sleep(500);
      out.bindingsAfterUnbind = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).bindings[lid] || null;
      if (current0) { window.__dshOpenSession(current0); }
      await sleep(1500);
      out.restored = S.list.getSnapshot().current === current0;
      // D. 入驻卡片注入绑定按钮
      out.injectedBindBtns = [].slice.call(document.querySelectorAll('button[data-wt-id] > .dsh-wt_bindBtn')).length;
    } catch(e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log('BATCH4:', JSON.stringify(step));

  // B. ＋磁贴 → 自定义布局弹窗 → CDP 真实输入 → 复制提示词（校验 __dshLastPrompt）
  const b1 = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    document.querySelectorAll('.dsh-wt_actions .dsh-wt_iconBtn')[2].click();
    await sleep(350);
    var tilesB = [].slice.call(document.querySelectorAll('.dsh-wt_presets .dsh-wt_preset'));
    tilesB[tilesB.length-1].click();
    await sleep(350);
    var out = {};
    out.customOpen = !!vis('.dsh-wt_customLayoutInput');
    var ta = vis('.dsh-wt_customLayoutInput');
    if (ta) { ta.focus(); out.focused = true; }
    return JSON.stringify(out);
  })()`);
  console.log('BATCH4B1:', JSON.stringify(b1));
  await send('Input.insertText', { text: '我要一个右侧竖长对话窗，左侧上下两个等大的窗口。' });
  await sleep(400);
  const b2 = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var out = {};
    var copyBtn = vis('.dsh-wt_customLayoutBtn');
    if (copyBtn) { copyBtn.click(); }
    await sleep(500);
    var prompt = window.__dshLastPrompt || '';
    out.promptHasReq = prompt.indexOf('左侧上下两个等大') >= 0;
    out.promptHasRules = prompt.indexOf('PRESET_DEFS') >= 0 && prompt.indexOf('g4') >= 0 && prompt.indexOf('topHeightRatio') >= 0 && prompt.indexOf('2h / 3h') >= 0;
    out.promptLastRule = prompt.indexOf('用户需求') >= 0 && prompt.slice(prompt.indexOf('用户需求')).indexOf('左侧上下两个等大') >= 0;
    out.promptLen = prompt.length;
    var toast = vis('.dsh-wt_customLayoutToast');
    out.toastShown = !!toast;
    out.toastFail = toast ? toast.className.indexOf('ToastFail') >= 0 : null;
    var bd = [].slice.call(document.querySelectorAll('.dsh-wt_popBackdrop')).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); });
    if (bd) { bd.click(); }
    await sleep(300);
    return JSON.stringify(out);
  })()`);
  console.log('BATCH4B2:', JSON.stringify(b2));

  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); try { proc.kill(); } catch {} process.exit(1); });
