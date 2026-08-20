// probe-batch16.cjs — 控制室：默认卡片首位/不可删 → 强制绑定（左现有/右新建）→ 面板网格 → 卡片动作 → 💬 跳转
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const PORT = 9373;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-batch16b',
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
    source: "try{ if(location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.view.v1', JSON.stringify({query:'',searchOpen:false,orderBy:'manual',dock:'footer',floatTop:null,sortMigratedV2:true})); localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:['t-bind'],lastUsed:{},hidden:[],nameOverrides:{},iconOverrides:{},shortcuts:[],layouts:[{id:'t-bind',title:'\u7ed1\u5b9a\u6d4b\u8bd5',icon:'\ud83e\uddea',top:null,left:null,main:[{id:'p1',title:'\u5185\u5bb91',min:200,content:null,tabs:[],active:0}],leftWidth:{default:260,min:160,max:480},chatWidth:{default:360,min:240,max:600},topHeight:{default:200,min:120,max:480},chatSide:'right',chatFullHeight:false}],bindings:{},folders:{},views:{\"wt-console\":{\"id\":\"wt-console\",\"title\":\"kz\",\"top\":null,\"main\":[{\"id\":\"console\",\"title\":\"kz\",\"min\":240,\"tabs\":[],\"active\":0}],\"chatWidth\":{\"default\":340,\"min\":280,\"max\":600},\"topHeight\":{\"default\":200,\"min\":120,\"max\":480},\"chatSide\":\"right\"}},removed:[]})); } }catch(e){}",
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
  const expr1 = `(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var st = window.__dshWorktable.splitStore;
    try {
      // 自愈验证：种子里的坏存档（控制室标签被关掉）应被挂载时修复
      var seeded = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      var cv = seeded && seeded.views && seeded.views['wt-console'];
      out.healTabs = cv && cv.main && cv.main[0] && cv.main[0].tabs ? cv.main[0].tabs.length : null;
      out.healType = cv && cv.main && cv.main[0] && cv.main[0].tabs && cv.main[0].tabs[0] ? cv.main[0].tabs[0].content.type : null;
      var cs = getComputedStyle(document.body);
      out.themeFill = cs.getPropertyValue('--dsw-alias-fill-l1').trim() || null;
      out.htmlDataTheme = document.documentElement.getAttribute('data-theme');
      var first = document.querySelector('.dsh-wt_projects > *');
      out.firstIsConsole = !!(first && first.classList && first.classList.contains('dsh-wt_consoleEntry'));
      out.consoleName = first ? (first.querySelector('.dsh-wt_layoutName') ? first.querySelector('.dsh-wt_layoutName').textContent : null) : null;
      var handle = document.querySelector('.dsh-wt_title');
      out.sectionTitle = handle ? (handle.textContent || '').trim() : null;
      out.sectionTitleRight = out.sectionTitle === '工作台';
      out.consoleIcon = first ? (first.querySelector('.dsh-wt_layoutIcon') ? first.querySelector('.dsh-wt_layoutIcon').textContent : null) : null;
      out.consoleOrder = first ? getComputedStyle(first).order : null;
      out.consoleHasBindBtn = !!(first && first.querySelector('.dsh-wt_bindBtn'));
      var btnS = document.querySelector('.dsh-wt_actions .dsh-wt_iconBtn:nth-child(2)');
      if (btnS) { btnS.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(400);
      var rows = document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow');
      out.manageRows = rows.length;
      out.consoleInManage = [].slice.call(rows).some(function(r){ return (r.textContent||'').indexOf('控制室') >= 0; });
      var done = document.querySelector('.dsh-wt_manageDone');
      if (done) { done.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(300);
      var card = vis('.dsh-wt_projects .dsh-wt_consoleEntry');
      card.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
      await sleep(600);
      var bpop = vis('.dsh-wt_consoleBindPop');
      out.bindPopOpen = !!bpop;
      if (bpop) {
        out.leftItems = bpop.querySelectorAll('.dsh-wt_consoleBindList .dsh-wt_selectItem').length;
        out.hasSelect = !!bpop.querySelector('.dsh-wt_consoleSelect');
        out.createBtn = bpop.querySelector('.dsh-wt_consoleCreateBtn') ? bpop.querySelector('.dsh-wt_consoleCreateBtn').textContent : null;
        var labels = bpop.querySelectorAll('.dsh-wt_consoleBindLabel');
        out.leftLabel = labels[0] ? labels[0].textContent : null;
        out.rightLabel = labels[1] ? labels[1].textContent : null;
        // 选一个「确实有历史文本」的会话（逐个冷拉 2 条消息验证；保证预热断言可测）
        var svc = window.__dshSessions;
        var snap = svc && svc.list ? svc.list.getSnapshot() : null;
        var byId = snap && snap.byId ? snap.byId : {};
        var ids = snap && snap.ids ? snap.ids : [];
        var chosen = null;
        for (var k = 0; k < Math.min(ids.length, 12) && !chosen; k++) {
          var sid = ids[k];
          try {
            var face = svc.binding(sid).session;
            var r1 = await face.history({ maxMessages: 2 });
            var evs = (r1 && r1.result && r1.result.value && r1.result.value.events) || [];
            for (var i = evs.length - 1; i >= 0 && !chosen; i--) {
              var ev = evs[i] && evs[i].event;
              var d = ev && ev.data ? ev.data : {};
              var blocks = null;
              if (ev && ev.type === 'user/message') blocks = d.content || d.blocks;
              else if (ev && ev.type === 'assistant/message') { var mm = d.message || d; blocks = mm.content || mm.blocks; }
              if (Array.isArray(blocks)) {
                for (var b = 0; b < blocks.length; b++) {
                  if (blocks[b] && typeof blocks[b].text === 'string' && blocks[b].text.trim()) {
                    var titleOf = byId[sid] && (byId[sid].title || byId[sid].displayTitle);
                    chosen = { title: titleOf, sid: sid };
                    break;
                  }
                }
              }
            }
          } catch (e) {}
        }
        out.chosenTitle = chosen ? chosen.title : null;
        var item = chosen ? [].slice.call(bpop.querySelectorAll('.dsh-wt_consoleBindList .dsh-wt_selectItem')).find(function(it){ return String(it.textContent) === String(chosen.title); }) : null;
        if (!item) item = bpop.querySelector('.dsh-wt_consoleBindList .dsh-wt_selectItem');
        if (item) { item.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
        await sleep(900);
      }
      out.bindPopClosed = !vis('.dsh-wt_consoleBindPop');
      out.specId = st.active && st.spec ? st.spec.id : null;
      // 控制室标签关不掉：标签栏存在但该标签无 ✕
      var tabBar = vis('.dsh-wt_tabBar');
      var ctab = tabBar && tabBar.querySelector('.dsh-wt_tab');
      out.consoleTabExists = !!ctab;
      out.consoleTabCloseGone = !!(ctab && !ctab.querySelector('.dsh-wt_tabClose'));
      out.consoleTabTitle = ctab ? (ctab.textContent || '').trim() : null;
      out.mainType = st.spec && st.spec.main[0] && st.spec.main[0].tabs && st.spec.main[0].tabs[0] ? st.spec.main[0].tabs[0].content.type : null;
      var saved = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      out.savedConsoleBinding = saved.bindings['wt-console'];
      await sleep(700);
      var grid = vis('.dsh-wt_consoleGrid');
      out.gridFound = !!grid;
      if (grid) {
        out.gridCols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        var cards = grid.querySelectorAll('.dsh-wt_consoleCard');
        out.cardCount = cards.length;
        var c0 = cards[0];
        out.firstCardSelf = !!(c0 && c0.classList.contains('dsh-wt_consoleCardSelf'));
        out.firstCardIcon = c0 ? c0.querySelector('.dsh-wt_consoleIcon').textContent : null;
        out.firstCardDot = c0 && c0.querySelector('.dsh-wt_consoleDot') ? c0.querySelector('.dsh-wt_consoleDot').className.replace('dsh-wt_consoleDot','').trim() : null;
        out.firstCardBadges = c0 ? c0.querySelectorAll('.dsh-wt_consoleBadge').length : 0;
        out.firstCardHasPreview = !!(c0 && c0.querySelector('.dsh-wt_consolePreview'));
        out.anyLayoutCard = [].slice.call(cards).some(function(c){ return (c.textContent||'').indexOf('绑定测试') >= 0; });
        out.layoutCardHasJump = [].slice.call(cards).some(function(c){ return (c.textContent||'').indexOf('绑定测试') >= 0 && !!c.querySelector('.dsh-wt_consoleJump'); });
        // 新版 UI：正方形比例、大字号状态、光效 CSS 接线（注入类验证，不依赖真实会话状态）
        var cardEl = c0;
        if (cardEl) {
          var cr = cardEl.getBoundingClientRect();
          out.cardAspect = Math.round((cr.width / Math.max(1, cr.height)) * 100) / 100;
          out.cardWidth = Math.round(cr.width);
          var statusEl = cardEl.querySelector('.dsh-wt_consoleStatus');
          out.statusFont = statusEl ? getComputedStyle(statusEl).fontSize : null;
          cardEl.classList.add('dsh-wt_consoleCard-busy');
          var bs = getComputedStyle(cardEl, '::before');
          out.busyBgImage = bs.backgroundImage ? bs.backgroundImage.slice(0, 60) : null;
          out.busyAnim = bs.animationName;
          cardEl.classList.remove('dsh-wt_consoleCard-busy');
          cardEl.classList.add('dsh-wt_consoleCard-glowDone');
          await sleep(300);
          var gs = getComputedStyle(cardEl, '::after');
          out.glowDoneBg = gs.backgroundImage ? gs.backgroundImage.slice(0, 60) : null;
          out.glowDoneShadow = getComputedStyle(cardEl).boxShadow.slice(0, 80);
          out.glowDoneBorder = getComputedStyle(cardEl).borderColor;
          cardEl.classList.remove('dsh-wt_consoleCard-glowDone');
          cardEl.classList.add('dsh-wt_consoleCard-glowNeed');
          await sleep(300);
          out.glowNeedShadow = getComputedStyle(cardEl).boxShadow.slice(0, 60);
          cardEl.classList.remove('dsh-wt_consoleCard-glowNeed');
        }
        var entry = vis('.dsh-wt_projects .dsh-wt_consoleEntry');
        if (entry) {
          var ecs = getComputedStyle(entry);
          out.entryBgGradient = ecs.backgroundImage.indexOf('linear-gradient') >= 0;
          out.entryBorder = ecs.borderColor;
        }
        // 冷会话预热：等 sweep 拉取后，自己卡片预览应有真实文本
        await sleep(4200);
        var selfPrev2 = c0 && c0.querySelector('.dsh-wt_consolePreview');
        out.selfPreviewAfterSweep = selfPrev2 ? selfPrev2.textContent.slice(0, 60) : null;
        out.selfPreviewFilled = !!(selfPrev2 && !selfPrev2.classList.contains('dsh-wt_consolePreviewNone'));
        var lcard = [].slice.call(cards).find(function(c){ return (c.textContent||'').indexOf('绑定测试') >= 0; });
        if (lcard) { lcard.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
        await sleep(800);
      }
      out.afterCardClickSpec = st.active && st.spec ? st.spec.id : null;
      st.close(); await sleep(300);
      out.boundSid = saved.bindings['wt-console'];
    } catch (e) { out.err = String(e && e.stack || e); }
    return out;
  })()`;
  const out1 = await evaluate(expr1);
  console.log('RESULT1 ' + JSON.stringify(out1));
  // 阶段2（不重载，走 UI）：给 t-bind 用绑定弹窗绑一个会话 → 重开控制室 → 💬 跳转不关控制室
  const expr2 = `(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var st = window.__dshWorktable.splitStore;
    try {
      var tcard = [].slice.call(document.querySelectorAll('.dsh-wt_projects .dsh-wt_layout')).find(function(b){ return (b.textContent||'').indexOf('绑定测试') >= 0; });
      out.tCardFound = !!tcard;
      var bb = tcard && tcard.querySelector('.dsh-wt_bindBtn');
      if (bb) { bb.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(500);
      out.bindPopOpen = !!vis('.dsh-wt_bindPop');
      var row = vis('.dsh-wt_bindPop .dsh-wt_bindConvRow');
      if (row) { row.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(500);
      var lpop = vis('.dsh-wt_bindListPop');
      out.listOpen = !!lpop;
      var item = lpop && lpop.querySelector('.dsh-wt_selectItem');
      if (item) { item.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(600);
      var saved = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      out.tBound = !!saved.bindings['t-bind'];
      var bd = vis('.dsh-wt_popBackdrop');
      if (bd) { bd.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(400);
      var card = vis('.dsh-wt_projects .dsh-wt_consoleEntry');
      card.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
      await sleep(1400);
      out.reopenSpec = st.active && st.spec ? st.spec.id : null;
      out.bindPopNotShown = !vis('.dsh-wt_consoleBindPop');
      var grid = vis('.dsh-wt_consoleGrid');
      var lc = grid && [].slice.call(grid.querySelectorAll('.dsh-wt_consoleCard')).find(function(c){ return (c.textContent||'').indexOf('绑定测试') >= 0; });
      out.layoutJumpBtn = !!(lc && lc.querySelector('.dsh-wt_consoleJump'));
      out.layoutCardStatus = lc && lc.querySelector('.dsh-wt_consoleDot') ? lc.querySelector('.dsh-wt_consoleDot').className.replace('dsh-wt_consoleDot','').trim() : null;
      if (lc && lc.querySelector('.dsh-wt_consoleJump')) {
        lc.querySelector('.dsh-wt_consoleJump').dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
        await sleep(700);
        out.specAfterJump = st.active && st.spec ? st.spec.id : null;
      }
      st.close(); await sleep(300);
    } catch (e) { out.err = String(e && e.stack || e); }
    return out;
  })()`;
  const out2 = await evaluate(expr2);
  console.log('RESULT2 ' + JSON.stringify(out2));
  // 阶段3：解绑控制室 → 点开走强制绑定 → 右侧「新建对话」（默认无分组）→ 自动绑定并打开控制室；
  // 顺带验证主题变量在控制室面板内实际解析（非空 = 跟随宿主深浅色）。
  const expr3 = `(async function(){
    var out = {};
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var vis = function(sel){ return [].slice.call(document.querySelectorAll(sel)).find(function(el){ return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0); }); };
    var st = window.__dshWorktable.splitStore;
    try {
      // 打开控制室 → 其卡片 ●● 打开绑定弹窗 → 解绑
      var card = vis('.dsh-wt_projects .dsh-wt_consoleEntry');
      card.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
      await sleep(1200);
      var bb = card.querySelector('.dsh-wt_bindBtn');
      if (bb) { bb.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(500);
      var ub = vis('.dsh-wt_bindPop .dsh-wt_bindUnbind');
      out.unbindBtnFound = !!ub;
      if (ub) { ub.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(500);
      var saved = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      out.unboundPersisted = !saved.bindings['wt-console'];
      var bd = vis('.dsh-wt_popBackdrop');
      if (bd) { bd.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(400);
      st.close(); await sleep(400);
      // 点控制室卡片 → 强制绑定弹窗 → 新建（默认无分组）
      card.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
      await sleep(600);
      var bpop = vis('.dsh-wt_consoleBindPop');
      out.forcedAgain = !!bpop;
      var cb = bpop && bpop.querySelector('.dsh-wt_consoleCreateBtn');
      out.groupDefault = bpop && bpop.querySelector('.dsh-wt_consoleSelect') ? bpop.querySelector('.dsh-wt_consoleSelect').value : null;
      if (cb) { cb.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(1800);
      out.panelClosedAfterCreate = !vis('.dsh-wt_consoleBindPop');
      out.specAfterCreate = st.active && st.spec ? st.spec.id : null;
      var saved2 = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1'));
      out.newBindingSet = !!saved2.bindings['wt-console'];
      out.newBindingDiffers = saved2.bindings['wt-console'] !== undefined;
      // 主题：三选一开关 + data-wt-theme 落定 + 持久化
      var con = vis('.dsh-wt_console');
      out.themeAttr0 = con ? con.getAttribute('data-wt-theme') : null;
      out.themeBtns = con ? con.querySelectorAll('.dsh-wt_consoleThemeBtn').length : 0;
      var btns = con ? con.querySelectorAll('.dsh-wt_consoleThemeBtn') : [];
      out.themeBtnTexts = [].slice.call(btns).map(function(b){ return b.textContent; });
      var cc = vis('.dsh-wt_consoleCard');
      out.cardBgDark = cc ? getComputedStyle(cc).backgroundColor : null;
      if (btns[1]) { btns[1].dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(400);
      out.themeAttrLight = con ? con.getAttribute('data-wt-theme') : null;
      out.cardBgLight = cc ? getComputedStyle(cc).backgroundColor : null;
      if (btns[2]) { btns[2].dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true})); }
      await sleep(400);
      out.themeAttrSystem = con ? con.getAttribute('data-wt-theme') : null;
      var sv = JSON.parse(localStorage.getItem('dsh.worktable.view.v1'));
      out.savedTheme = sv.consoleTheme;
      st.close(); await sleep(300);
    } catch (e) { out.err = String(e && e.stack || e); }
    return out;
  })()`;
  const out3 = await evaluate(expr3);
  console.log('RESULT3 ' + JSON.stringify(out3));
  try { ws.close(); } catch {}
  proc.kill();
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill(); } catch {} });
