// probe-batch15.cjs — 绑定弹窗精简：文件夹框 + 绑定对话框（💬行点击右侧弹列表）+ 框内说明/解绑
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9372;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch15',
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
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{ if(location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.view.v1', JSON.stringify({query:'',searchOpen:false,orderBy:'manual',dock:'footer',floatTop:null,sortMigratedV2:true})); localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:['t-bind'],lastUsed:{},hidden:[],nameOverrides:{},iconOverrides:{},shortcuts:[],layouts:[{id:'t-bind',title:'\u7ed1\u5b9a\u6d4b\u8bd5',icon:'\ud83e\uddea',top:null,left:null,main:[{id:'p1',title:'\u5185\u5bb91',min:200,content:null,tabs:[],active:0}],leftWidth:{default:260,min:160,max:480},chatWidth:{default:360,min:240,max:600},topHeight:{default:200,min:120,max:480},chatSide:'right',chatFullHeight:false}],bindings:{},folders:{'t-bind':'C:\\Temp'},views:{},removed:[]})); } }catch(e){}",
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  let ready = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate("!!window.__dshWorktable"); if (ready === true) break; }
  await sleep(1500);
  await evaluate("(function(){ var b=document.querySelector('button[title=\"Open sidebar\"],button[aria-label=\"Open sidebar\"]'); if(b){b.click(); return true} return false })()");
  await sleep(1000);
  const out = await evaluate(`(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    try {
      // 打开绑定弹窗（布局卡右上 ●●）
      var card = vis('.dsh-wt_projects .dsh-wt_layout');
      out.cardFound = !!card;
      var bb = card && card.querySelector('.dsh-wt_bindBtn');
      if (bb) { bb.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(400);
      var pop = vis('.dsh-wt_bindPop');
      out.popOpen = !!pop;
      if (!pop) { return out; }
      // 结构：两个同格式框；主弹窗内不再有列表
      out.boxCount = pop.querySelectorAll('.dsh-wt_bindFolderBox').length;
      out.mainHasList = !!pop.querySelector('.dsh-wt_bindList');
      var boxes = pop.querySelectorAll('.dsh-wt_bindFolderBox');
      out.box0Label = boxes[0] ? boxes[0].querySelector('.dsh-wt_bindFolderLabel').textContent : null;
      out.box1Label = boxes[1] ? boxes[1].querySelector('.dsh-wt_bindFolderLabel').textContent : null;
      out.box0Path = boxes[0] ? boxes[0].querySelector('.dsh-wt_bindFolderPath').textContent : null;
      var chg = boxes[0] && boxes[0].querySelector('.dsh-wt_bindFolderChange');
      out.box0Change = !!chg;
      out.box0ChangeHasRefresh = chg ? chg.textContent.indexOf('\u21bb') >= 0 : false;
      // 弹窗左上角不再有「绑定对话」标题；两个框标题字号一致
      out.popTitleGone = !pop.querySelector('.dsh-wt_menuLabel');
      var lb0 = boxes[0] && boxes[0].querySelector('.dsh-wt_bindFolderLabel');
      var lb1 = boxes[1] && boxes[1].querySelector('.dsh-wt_bindFolderLabel');
      out.fontSizes = { folder: lb0 ? getComputedStyle(lb0).fontSize : null, bind: lb1 ? getComputedStyle(lb1).fontSize : null };
      out.fontSame = !!(lb0 && lb1 && getComputedStyle(lb0).fontSize === getComputedStyle(lb1).fontSize);
      // 未绑定态：行显示 未绑定对话·点击选择；无解绑；无右侧列表
      var rowNone = boxes[1] && boxes[1].querySelector('.dsh-wt_bindConvRow');
      out.unboundRow = rowNone ? rowNone.textContent : null;
      out.unbindAbsent = !pop.querySelector('.dsh-wt_bindUnbind');
      out.listClosed0 = !vis('.dsh-wt_bindListPop');
      // 点击行 → 右侧弹列表；再点一下 → 反选收起
      if (rowNone) { rowNone.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(400);
      var lpop = vis('.dsh-wt_bindListPop');
      out.listOpened = !!lpop;
      if (lpop) {
        var pr = pop.getBoundingClientRect(); var lr = lpop.getBoundingClientRect();
        out.debug = { prLeft: Math.round(pr.left), prRight: Math.round(pr.right), lrLeft: Math.round(lr.left), innerW: window.innerWidth };
        out.listOnRight = lr.left >= pr.right - 1;
        out.itemCount = lpop.querySelectorAll('.dsh-wt_selectItem').length;
        var rowNow = vis('.dsh-wt_bindPop .dsh-wt_bindConvRow');
        if (rowNow) { rowNow.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
        await sleep(400);
        out.toggledClosed = !vis('.dsh-wt_bindListPop');
        out.mainOpenAfterToggle = !!vis('.dsh-wt_bindPop');
        if (rowNow) { rowNow.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
        await sleep(400);
        lpop = vis('.dsh-wt_bindListPop');
        var item = lpop && lpop.querySelector('.dsh-wt_selectItem');
        if (item) { item.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
        await sleep(400);
      }
      out.listClosedAfterPick = !vis('.dsh-wt_bindListPop');
      out.mainStillOpen = !!vis('.dsh-wt_bindPop');
      var convName = vis('.dsh-wt_bindPop .dsh-wt_bindConvName');
      out.boundName = convName ? convName.textContent : null;
      out.boundFolderText = vis('.dsh-wt_bindPop .dsh-wt_bindFolder') ? vis('.dsh-wt_bindPop .dsh-wt_bindFolder').textContent : null;
      out.chevron = !!vis('.dsh-wt_bindPop .dsh-wt_bindConvChevron');
      out.unbindPresent = !!vis('.dsh-wt_bindPop .dsh-wt_bindUnbind');
      // 解绑按钮在第一行最右（与 💬 绑定对话 同一行右对齐）
      var ubRow = vis('.dsh-wt_bindPop .dsh-wt_bindUnbind');
      if (ubRow) {
        var row1 = boxes[1].querySelector('.dsh-wt_bindFolderRow');
        var rr = row1.getBoundingClientRect(); var ur = ubRow.getBoundingClientRect();
        out.unbindInRow1 = row1.contains(ubRow);
        out.unbindRightAligned = (rr.right - ur.right) < 16;
      }
      var saved = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      out.savedBinding = saved.bindings['t-bind'];
      // 解绑 → 恢复未绑定
      var ub = vis('.dsh-wt_bindPop .dsh-wt_bindUnbind');
      if (ub) { ub.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(400);
      out.unboundAfterUnbind = !!vis('.dsh-wt_bindPop .dsh-wt_bindConvRowNone');
      out.unbindGoneAfter = !vis('.dsh-wt_bindPop .dsh-wt_bindUnbind');
      // 关闭（backdrop）
      var bd = vis('.dsh-wt_popBackdrop');
      if (bd) { bd.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(300);
      out.closed = !vis('.dsh-wt_bindPop');
    } catch (e) { out.err = String(e && e.stack || e); }
    return out;
  })()`);
  console.log('RESULT ' + JSON.stringify(out));
  try { ws.close(); } catch {}
  proc.kill();
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} });
