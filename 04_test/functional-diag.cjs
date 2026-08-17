const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const fs = require('fs');

// MD 编辑模式的临时夹具（保存测试写这个文件，跑完还原，不动仓库文件）
const TEMP_MD = 'C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-edit-test.md';
fs.writeFileSync(TEMP_MD, '# ORIG\n', 'utf8');

const PORT = 9335;
const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=C:\\Users\\SJL\\AppData\\Local\\Temp\\wt-chrome-func3',
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
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{ if(location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.view.v1', JSON.stringify({query:'',searchOpen:false,orderBy:'manual',dock:'footer',floatTop:null,sortMigratedV2:true})); localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[{id:'t-sc',name:'\u6d4b\u8bd5\u5feb\u6377',icon:'\ud83d\udd17',href:'https://example.com'}],layouts:[{id:'t-layout',title:'\u6d4b\u8bd5\u5e03\u5c40',top:null,left:null,main:[{id:'p1',title:'\u5185\u5bb91',min:200,content:null,tabs:[{id:'t1',title:'Browser',content:{kind:'builtin',type:'browser'}}],active:0}],leftWidth:{default:260,min:160,max:480},chatWidth:{default:360,min:240,max:600},topHeight:{default:200,min:120,max:480},chatSide:'right',chatFullHeight:false}]})); } }catch(e){}",
  });
  await send('Page.navigate', { url: 'http://127.0.0.1:3080/' });
  await sleep(11000);

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  // 展开侧栏（宿主默认折叠，宽侧栏下工作台才渲染项目卡片）
  const expanded = await evaluate("(function(){ var b=document.querySelector('button[title=\"Open sidebar\"],button[aria-label=\"Open sidebar\"]'); if(b){b.click(); return true} return false })()");
  console.log('SIDEBAR_EXPAND:', JSON.stringify(expanded));
  await sleep(900);

  const step1 = await evaluate("(function(){ var out={}; out.debugExport=!!window.__dshWorktable; var st=window.__dshWorktable&&window.__dshWorktable.splitStore; if(!st) return JSON.stringify(out); out.openResult=st.open({id:'t-diag',title:'diag',top:null,main:[{id:'p1',title:'1',min:200,content:null},{id:'p2',title:'2',min:200,content:null}],chatWidth:{default:320,min:240,max:600}}); out.afterOpen={active:st.active,spec:st.spec&&st.spec.id}; out.paneWs=st.paneWs&&st.paneWs.slice(); out.chatW=st.chatW; out.geom=st.geom; return JSON.stringify(out) })()");
  console.log('STEP1:', JSON.stringify(step1));
  await sleep(900);

  const step2 = await evaluate("(function(){ var out={}; out.pickers=document.querySelectorAll('.dsh-wt_panePicker').length; out.pickButtons=document.querySelectorAll('.dsh-wt_panePick').length; out.pickerModes=Array.prototype.map.call(document.querySelectorAll('.dsh-wt_panePicker'),function(el){return el.className}); out.pickSize=(function(){var b=document.querySelector('.dsh-wt_panePick'); if(!b) return null; var r=b.getBoundingClientRect(); return {w:r.width,h:r.height};})(); out.dividerAlign=(function(){ var panes=document.querySelectorAll('.dsh-wt_pane'); var divs=document.querySelectorAll('.dsh-wt_splitDivider:not(.dsh-wt_splitDividerH)'); if(panes.length<2||divs.length<1) return null; var p0=panes[0].getBoundingClientRect(); var d=divs[0].getBoundingClientRect(); return {paneRight:Math.round(p0.right),divLeft:Math.round(d.left),divWidth:Math.round(d.width),centerOffset:Math.round((d.left+d.width/2)-(p0.right+3))}; })(); var st=window.__dshWorktable.splitStore; st.openTab('main',0,{kind:'builtin',type:'browser'}); st.openTab('main',1,{kind:'builtin',type:'explorer'}); return JSON.stringify(out) })()");
  console.log('STEP2:', JSON.stringify(step2));
  await sleep(900);

  const step3 = await evaluate("(function(){ var out={}; out.browserBar=document.querySelectorAll('.dsh-wt_browserBar').length; out.browserIframe=document.querySelectorAll('.dsh-wt_paneFrame').length; out.explorerBars=document.querySelectorAll('.dsh-wt_subBar').length; out.tabs=document.querySelectorAll('.dsh-wt_tab').length; return JSON.stringify(out) })()");
  console.log('STEP3:', JSON.stringify(step3));

  const step4 = await evaluate("(function(){ var st=window.__dshWorktable.splitStore; var tabId=st.spec.main[0].tabs[0].id; st.moveTab('main',0,tabId,'main',1); var out={pane0Tabs:(st.spec.main[0].tabs||[]).length,pane1Tabs:(st.spec.main[1].tabs||[]).length}; return JSON.stringify(out) })()");
  console.log('STEP4:', JSON.stringify(step4));
  await sleep(700);

  const step5 = await evaluate("(function(){ var out={}; out.pane0PickerBack=document.querySelectorAll('.dsh-wt_panePicker').length; var st=window.__dshWorktable.splitStore; st.close(); out.closed=st.active===false; return JSON.stringify(out) })()");
  console.log('STEP5:', JSON.stringify(step5));

  const step6 = await evaluate(`(async function(){
    var out={};
    out.cards=document.querySelectorAll('.dsh-wt_layout').length;
    var card=document.querySelector('.dsh-wt_layout');
    if(card){
      var ic=card.querySelector('.dsh-wt_layoutIcon');
      out.icon0=ic?ic.textContent:null;
      if(ic){ ic.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); }
      await new Promise(function(r){setTimeout(r,250)});
      out.popup=!!document.querySelector('.dsh-wt_iconPop');
      out.cells=document.querySelectorAll('.dsh-wt_iconCell').length;
      var cells=document.querySelectorAll('.dsh-wt_iconCell');
      if(cells[1]){ cells[1].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); }
      await new Promise(function(r){setTimeout(r,250)});
      out.icon1=card.querySelector('.dsh-wt_layoutIcon').textContent;
      try{ out.saved=JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).layouts[0].icon }catch(e){ out.saved='ERR:'+e.message }
    }
    out.layoutDesc=document.querySelectorAll('.dsh-wt_layoutDesc').length;
    out.layoutBadge=document.querySelectorAll('.dsh-wt_layoutBadge').length;
    out.headerSvgs=document.querySelectorAll('.dsh-wt_actions .dsh-wt_iconBtn svg').length;
    var ta=document.querySelector('.dsh-wt_projects .ta_card');
    if(ta){ var cs=getComputedStyle(ta); out.taBorder=cs.borderTopColor; var desc=ta.querySelector('.ta_cardDesc'); out.taDescDisplay=desc?getComputedStyle(desc).display:null; }
    var pr=document.querySelector('.dsh-wt_projects .pr_card');
    if(pr){ var cs2=getComputedStyle(pr); out.prBorder=cs2.borderTopColor; var desc2=pr.querySelector('.pr_cardDesc'); out.prDescDisplay=desc2?getComputedStyle(desc2).display:null; }
    // 常驻项目图标换选：点 ta_cardIcon → 选择器 → 选第 5 项 ✈️ → data-wt-icon + 持久化
    var taIcon=document.querySelector('.dsh-wt_projects .ta_cardIcon');
    if(taIcon){
      taIcon.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      await new Promise(function(r){setTimeout(r,250)});
      out.taPopup=!!document.querySelector('.dsh-wt_iconPop');
      var cells2=document.querySelectorAll('.dsh-wt_iconCell');
      if(cells2[4]){ cells2[4].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); }
      await new Promise(function(r){setTimeout(r,250)});
      out.taIconAttr=taIcon.getAttribute('data-wt-icon');
      try{ out.taSaved=JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).iconOverrides.travelatlas }catch(e){ out.taSaved='ERR:'+e.message }
    }
    return JSON.stringify(out);
  })()`);
  console.log('STEP6:', JSON.stringify(step6));

  // 唯一性互斥：本引擎布局打开时，点开旅行 Atlas（其浮层 .ta_split 出现）→ 本引擎自动关闭
  const step7 = await evaluate(`(async function(){
    var out={};
    var st=window.__dshWorktable.splitStore;
    st.open({id:'t-mutex',title:'mutex',top:null,main:[{id:'m1',title:'m',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
    out.engineOpenAfterOpen=st.active;
    var ta=document.querySelector('.ta_card');
    if(ta){ ta.click(); }
    await new Promise(function(r){setTimeout(r,700)});
    out.taSplitPresent=!!document.querySelector('.ta_split');
    out.engineClosedByTa=st.active===false;
    // 合成验证：直接向 body 挂 .ta_split（模拟 travelatlas 浮层出现）→ 观察器应关闭本引擎
    if(st.active){
      var fake=document.createElement('div');
      fake.className='ta_split';
      document.body.appendChild(fake);
      await new Promise(function(r){setTimeout(r,400)});
      out.engineClosedByFakeTa=st.active===false;
      fake.remove();
    }
    if(st.active){ st.close(); }
    var taClose=document.querySelector('.ta_splitClose');
    if(taClose){ taClose.click(); }
    await new Promise(function(r){setTimeout(r,400)});
    return JSON.stringify(out);
  })()`);
  console.log('STEP7:', JSON.stringify(step7));

  // 设置弹窗：右侧 fixed，直接内嵌「排序方式 + 管理项目（展开列表）」
  const step8 = await evaluate(`(async function(){
    var out={};
    var btn=document.querySelector('.dsh-wt_actions .dsh-wt_iconBtn:nth-child(2)');
    if(btn){ btn.click(); }
    await new Promise(function(r){setTimeout(r,300)});
    var sp=document.querySelector('.dsh-wt_settings');
    if(sp){ var cs=getComputedStyle(sp); out.pos=cs.position; out.left=sp.getBoundingClientRect().left; out.sortItems=sp.querySelectorAll('.dsh-wt_sortBtn').length; out.rows=sp.querySelectorAll('.dsh-wt_manageRow').length; }
    out.backdrop=!!document.querySelector('.dsh-wt_popBackdrop');
    var bd=document.querySelector('.dsh-wt_popBackdrop');
    if(bd){ bd.click(); }
    await new Promise(function(r){setTimeout(r,200)});
    out.closedAfterBackdrop=!document.querySelector('.dsh-wt_settings');
    return JSON.stringify(out);
  })()`);
  console.log('STEP8:', JSON.stringify(step8));

  // 变更视图：常驻项目与布局项目通用 🧩 → 选择新预设 → 拓扑重建 + 内容标签自动迁入
  const step9 = await evaluate(`(async function(){
    var out={};
    var btn=document.querySelector('.dsh-wt_actions .dsh-wt_iconBtn:nth-child(2)');
    if(btn){ btn.click(); }
    await new Promise(function(r){setTimeout(r,300)});
    var rows=document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow:not(.dsh-wt_manageRowSc)');
    out.rowsCount=rows.length;
    out.row0Btns=rows[0]?rows[0].querySelectorAll('.dsh-wt_manageBtn').length:0;
    var resPuzzle=rows[0]&&rows[0].querySelectorAll('.dsh-wt_manageBtn')[rows[0].querySelectorAll('.dsh-wt_manageBtn').length-2];
    if(resPuzzle){ resPuzzle.click(); }
    await new Promise(function(r){setTimeout(r,300)});
    out.viewPicker1=!!document.querySelector('.dsh-wt_pop .dsh-wt_presets');
    var presets1=document.querySelectorAll('.dsh-wt_presets .dsh-wt_preset');
    if(presets1[1]){ presets1[1].click(); }
    await new Promise(function(r){setTimeout(r,400)});
    try{
      var vv=JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).views||{};
      out.viewsKeys=Object.keys(vv);
      var rv=vv['planreview'];
      if(rv){ out.resTop=(rv.top||[]).length; out.resMain=rv.main.length; out.resChatFull=rv.chatFullHeight===true; out.resId=rv.id; }
    }catch(e){ out.resErr=String(e) }
    var rows2=document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow:not(.dsh-wt_manageRowSc)');
    var layoutRow=rows2[rows2.length-1];
    out.layoutRowBtns=layoutRow?layoutRow.querySelectorAll('.dsh-wt_manageBtn').length:0;
    var puzzle=layoutRow&&layoutRow.querySelectorAll('.dsh-wt_manageBtn')[layoutRow.querySelectorAll('.dsh-wt_manageBtn').length-2];
    if(puzzle){ puzzle.click(); }
    await new Promise(function(r){setTimeout(r,300)});
    var presets=document.querySelectorAll('.dsh-wt_presets .dsh-wt_preset');
    out.presetCount=presets.length;
    if(presets[2]){ presets[2].click(); }
    await new Promise(function(r){setTimeout(r,400)});
    try{
      var lay=JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).layouts[0];
      out.newTop=(lay.top||[]).length; out.newMain=lay.main.length; out.chatFull=lay.chatFullHeight===true;
      out.migrated=(lay.top&&lay.top[0]&&lay.top[0].tabs||[]).length; out.mainTabs=lay.main[0].tabs?lay.main[0].tabs.length:0;
    }catch(e){ out.savedErr=String(e) }
    var bd=document.querySelector('.dsh-wt_popBackdrop');
    if(bd){ bd.click(); }
    await new Promise(function(r){setTimeout(r,200)});
    return JSON.stringify(out);
  })()`);
  console.log('STEP9:', JSON.stringify(step9));

  // 工作台状态持久化：布局项目与视图覆盖项目切换回来都保持上一次内容
  const step14 = await evaluate(`(async function(){
    var out={};
    try{
      var st=window.__dshWorktable.splitStore;
      // A) 布局项目：卡片打开 → 加终端标签 → 关闭 → 再开 → 标签还在
      var layCard=document.querySelector('.dsh-wt_layout');
      if(layCard){ layCard.click(); }
      await new Promise(function(r){setTimeout(r,400)});
      out.layoutOpenId=st.spec?st.spec.id:null;
      st.openTab('main',0,{kind:'builtin',type:'terminal'});
      await new Promise(function(r){setTimeout(r,300)});
      try{ out.layoutSavedTabs=JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).layouts[0].main[0].tabs.length }catch(e){ out.layoutSavedTabs='ERR' }
      st.close();
      await new Promise(function(r){setTimeout(r,300)});
      layCard=document.querySelector('.dsh-wt_layout');
      if(layCard){ layCard.click(); }
      await new Promise(function(r){setTimeout(r,400)});
      out.layoutRestoredTabs=st.spec?st.spec.main[0].tabs.length:null;
      st.close();
      await new Promise(function(r){setTimeout(r,300)});
      // B) 视图覆盖项目（旅行）：先经 UI 设置视图 → 卡片打开 → 加资源管理器标签 → 关闭 → 再开 → 标签还在
      var btnS=document.querySelector('.dsh-wt_actions .dsh-wt_iconBtn:nth-child(2)');
      if(btnS){ btnS.click(); }
      await new Promise(function(r){setTimeout(r,300)});
      var rows=document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow:not(.dsh-wt_manageRowSc):not(.dsh-wt_manageRowRemoved)');
      var taRow=rows[1];
      var puzzle=taRow&&taRow.querySelectorAll('.dsh-wt_manageBtn')[taRow.querySelectorAll('.dsh-wt_manageBtn').length-2];
      if(puzzle){ puzzle.click(); }
      await new Promise(function(r){setTimeout(r,300)});
      var presets=document.querySelectorAll('.dsh-wt_presets .dsh-wt_preset');
      if(presets[0]){ presets[0].click(); }
      await new Promise(function(r){setTimeout(r,400)});
      var bd=document.querySelector('.dsh-wt_popBackdrop');
      if(bd){ bd.click(); }
      await new Promise(function(r){setTimeout(r,300)});
      var ta=document.querySelector('.dsh-wt_projects .ta_card');
      if(ta){ ta.click(); }
      await new Promise(function(r){setTimeout(r,400)});
      out.taOpenId=st.spec?st.spec.id:null;
      st.openTab('main',0,{kind:'builtin',type:'explorer'});
      await new Promise(function(r){setTimeout(r,300)});
      try{ out.taSavedTabs=JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).views['travelatlas'].main[0].tabs.length }catch(e){ out.taSavedTabs='ERR' }
      st.close();
      await new Promise(function(r){setTimeout(r,300)});
      ta=document.querySelector('.dsh-wt_projects .ta_card');
      if(ta){ ta.click(); }
      await new Promise(function(r){setTimeout(r,400)});
      out.taRestoredTabs=(st.spec&&st.spec.id==='travelatlas')?st.spec.main[0].tabs.length:null;
      st.close();
      await new Promise(function(r){setTimeout(r,300)});
    }catch(err){ out.err=String(err) }
    return JSON.stringify(out);
  })()`);
  console.log('STEP14:', JSON.stringify(step14));

  // tsx/css 代码文件预览：点击后新标签页显示内容（同 MD 模式）
  const step15 = await evaluate(`(async function(){
    var out={};
    try{
      var st=window.__dshWorktable.splitStore;
      st.open({id:'t-code',title:'code',top:null,main:[{id:'c1',title:'c',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
      await new Promise(function(r){setTimeout(r,400)});
      st.openTab('main',0,{kind:'file',path:'E:\\\\AI_Workspace\\\\DeepseekHarness\\\\Projects\\\\dsh-worktable\\\\01_content\\\\src\\\\client\\\\index.tsx'});
      await new Promise(function(r){setTimeout(r,1200)});
      out.tsxTab=st.spec.main[0].tabs[0].title;
      var codeEl=[].slice.call(document.querySelectorAll('.dsh-wt_code')).find(function(el){return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0)});
      out.tsxView=!!codeEl;
      out.tsxHljs=codeEl?codeEl.querySelectorAll('.hljs-keyword').length:0;
      out.tsxHasText=codeEl?String(codeEl.textContent).indexOf('WorktableSection')>=0:false;
      st.openTab('main',0,{kind:'file',path:'E:\\\\AI_Workspace\\\\DeepseekHarness\\\\Projects\\\\dsh-worktable\\\\01_content\\\\src\\\\client\\\\styles.ts'});
      await new Promise(function(r){setTimeout(r,900)});
      out.cssTab=st.spec.main[0].tabs[1].title;
      out.tabsCount=st.spec.main[0].tabs.length;
      // 代码文件编辑模式（tsx/css/txt 通用）
      var ebtn=document.querySelectorAll('.dsh-wt_mdBtn')[1];
      if(ebtn){ ebtn.click(); }
      await new Promise(function(r){setTimeout(r,250)});
      var ta=document.querySelector('.dsh-wt_mdEdit');
      out.editArea=!!ta;
      out.editHasText=ta?ta.value.indexOf('dsh-wt_')>=0:false;
      var pbtn=document.querySelectorAll('.dsh-wt_mdBtn')[0];
      if(pbtn){ pbtn.click(); }
      await new Promise(function(r){setTimeout(r,200)});
      out.previewBack=!!document.querySelector('.dsh-wt_code');
      st.close();
    }catch(err){ out.err=String(err) }
    return JSON.stringify(out);
  })()`);
  console.log('STEP15:', JSON.stringify(step15));

  // 删除二次确认：常驻项目/布局 ✕ → 警告弹窗 → 取消不删 / 确认删除；emoji 字号与名称字重统一
  const step10 = await evaluate(`(async function(){
    var out={};
    var prIcon=document.querySelector('.dsh-wt_projects .pr_cardIcon');
    var taIcon=document.querySelector('.dsh-wt_projects .ta_cardIcon');
    var layIcon=document.querySelector('.dsh-wt_layoutIcon');
    var scIcon=document.querySelector('.dsh-wt_shortcutIcon');
    var taName=document.querySelector('.dsh-wt_projects .ta_cardName');
    var laName=document.querySelector('.dsh-wt_layoutName');
    if(prIcon) out.prIconSize=getComputedStyle(prIcon).fontSize;
    if(taIcon) out.taIconBeforeSize=getComputedStyle(taIcon,'::before').fontSize;
    if(layIcon) out.layIconSize=getComputedStyle(layIcon).fontSize;
    if(scIcon) out.scIconSize=getComputedStyle(scIcon).fontSize;
    if(taName) out.taNameWeight=getComputedStyle(taName).fontWeight;
    if(laName) out.laNameWeight=getComputedStyle(laName).fontWeight;
    function h(sel){ var el=document.querySelector(sel); return el?Math.round(el.getBoundingClientRect().height):null; }
    out.heights={ta:h('.dsh-wt_projects .ta_card'),pr:h('.dsh-wt_projects .pr_card'),layout:h('.dsh-wt_layout'),shortcut:h('.dsh-wt_shortcut')};
    out.cardsBefore={ta:document.querySelectorAll('.dsh-wt_projects .ta_card').length,pr:document.querySelectorAll('.dsh-wt_projects .pr_card').length};
    var btn=document.querySelector('.dsh-wt_actions .dsh-wt_iconBtn:nth-child(2)');
    if(btn){ btn.click(); }
    await new Promise(function(r){setTimeout(r,300)});
    var rows=document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow');
    out.rows0=rows.length;
    if(rows[0]) out.row0BtnCount=rows[0].querySelectorAll('.dsh-wt_manageBtn').length;
    var xBtn=rows[0]&&rows[0].querySelectorAll('.dsh-wt_manageBtn')[rows[0].querySelectorAll('.dsh-wt_manageBtn').length-1];
    if(xBtn){ xBtn.click(); }
    await new Promise(function(r){setTimeout(r,250)});
    out.confirmShown=!!document.querySelector('.dsh-wt_confirm');
    var cancel=document.querySelector('.dsh-wt_confirmCancel');
    if(cancel){ cancel.click(); }
    await new Promise(function(r){setTimeout(r,200)});
    out.confirmGoneAfterCancel=!document.querySelector('.dsh-wt_confirm');
    out.taStillThere=!!document.querySelector('.dsh-wt_projects .ta_card');
    var rows2=document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow');
    var xBtn2=rows2[0]&&rows2[0].querySelectorAll('.dsh-wt_manageBtn')[rows2[0].querySelectorAll('.dsh-wt_manageBtn').length-1];
    if(xBtn2){ xBtn2.click(); }
    await new Promise(function(r){setTimeout(r,250)});
    var del=document.querySelector('.dsh-wt_confirmDelete');
    if(del){ del.click(); }
    await new Promise(function(r){setTimeout(r,300)});
    out.cardsAfter={ta:document.querySelectorAll('.dsh-wt_projects .ta_card').length,pr:document.querySelectorAll('.dsh-wt_projects .pr_card').length};
    try{ out.removed=JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).removed }catch(e){ out.removed='ERR' }
    out.rowsAfterDelete=document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow').length;
    var rows3=document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow:not(.dsh-wt_manageRowSc):not(.dsh-wt_manageRowRemoved)');
    var lastRow=rows3[rows3.length-1];
    var xBtn3=lastRow&&lastRow.querySelectorAll('.dsh-wt_manageBtn')[lastRow.querySelectorAll('.dsh-wt_manageBtn').length-1];
    if(xBtn3){ xBtn3.click(); }
    await new Promise(function(r){setTimeout(r,250)});
    var del2=document.querySelector('.dsh-wt_confirmDelete');
    if(del2){ del2.click(); }
    await new Promise(function(r){setTimeout(r,300)});
    out.layoutGoneAfterDelete=!document.querySelector('.dsh-wt_layout');
    try{ out.layoutsLeft=JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).layouts.length }catch(e){ out.layoutsLeft='ERR' }
    // 真删除：「已删除的项目」区块出现，重新添加可逆（无恢复默认按钮）
    out.removedSection=!!document.querySelector('.dsh-wt_settings .dsh-wt_manageRowRemoved');
    out.resetBtnGone=!document.querySelector('.dsh-wt_manageReset');
    var readdBtn=document.querySelector('.dsh-wt_settings .dsh-wt_manageRowRemoved .dsh-wt_manageBtn');
    if(readdBtn){ readdBtn.click(); }
    await new Promise(function(r){setTimeout(r,300)});
    try{ out.removedAfterReadd=JSON.parse(localStorage.getItem('dsh.worktable.projects.v1')).removed }catch(e){ out.removedAfterReadd='ERR' }
    out.prBackAfterReadd=document.querySelectorAll('.dsh-wt_projects .pr_card').length;
    var done=document.querySelector('.dsh-wt_manageDone');
    if(done){ done.click(); }
    await new Promise(function(r){setTimeout(r,200)});
    return JSON.stringify(out);
  })()`);
  console.log('STEP10:', JSON.stringify(step10));

  // 文件预览：MD 渲染 / TXT 文本 / 标签去重
  const step11 = await evaluate(`(async function(){
    var out={};
    var st=window.__dshWorktable.splitStore;
    st.open({id:'t-file',title:'file',top:null,main:[{id:'f1',title:'f',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
    await new Promise(function(r){setTimeout(r,400)});
    st.openTab('main',0,{kind:'file',path:'E:\\\\AI_Workspace\\\\DeepseekHarness\\\\Projects\\\\dsh-worktable\\\\02_process\\\\PRD.md'});
    await new Promise(function(r){setTimeout(r,1200)});
    out.mdTitle=st.spec.main[0].tabs[0].title;
    out.mdView=!!document.querySelector('.dsh-wt_md');
    out.mdText=document.querySelector('.dsh-wt_md')?String(document.querySelector('.dsh-wt_md').textContent).slice(0,50):null;
    st.openTab('main',0,{kind:'file',path:'E:\\\\AI_Workspace\\\\DeepseekHarness\\\\Projects\\\\dsh-worktable\\\\02_process\\\\PRD.md'});
    out.tabsAfterDup=st.spec.main[0].tabs.length;
    st.openTab('main',0,{kind:'file',path:'E:\\\\AI_Workspace\\\\DeepseekHarness\\\\Projects\\\\dsh-worktable\\\\01_content\\\\package.json'});
    await new Promise(function(r){setTimeout(r,900)});
    out.jsonView=!!document.querySelector('.dsh-wt_code');
    out.jsonHljs=document.querySelectorAll('.dsh-wt_code .hljs-keyword, .dsh-wt_code .hljs-string').length;
    out.tabsNow=st.spec.main[0].tabs.length;
    st.close();
    return JSON.stringify(out);
  })()`);
  console.log('STEP11:', JSON.stringify(step11));

  // 本地站点目录级托管：index.html 的相对资源（./assets/...）应随目录一起解析渲染
  const step12 = await evaluate(`(async function(){
    var out={};
    try{
      var st=window.__dshWorktable.splitStore;
      st.open({id:'t-site',title:'site',top:null,main:[{id:'s1',title:'s',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
      await new Promise(function(r){setTimeout(r,400)});
      var rootToken=encodeURIComponent('E:\\\\AI_Workspace\\\\DeepseekHarness\\\\Projects\\\\dsh-worktable\\\\04_test\\\\fixture-site');
      var pr=await fetch('/api/worktable/site/'+rootToken+'/index.html').catch(function(e){ return null; });
      out.routeReady=!!(pr&&pr.ok);
      out.probeStatus=pr?pr.status:null;
      if(out.routeReady){
        st.openTab('main',0,{kind:'iframe',url:'/api/worktable/site/'+rootToken+'/index.html',title:'site'});
        await new Promise(function(r){setTimeout(r,1800)});
        out.tabTitle=st.spec.main[0].tabs[0].title;
        var f=document.querySelector('.dsh-wt_paneFrame');
        var doc=f&&f.contentDocument;
        if(doc){
          var app=doc.getElementById('app');
          out.appText=app?app.textContent:null;
          out.appColor=app?doc.defaultView.getComputedStyle(app).color:null;
        }
      }
      st.close();
    }catch(err){ out.err=String(err) }
    return JSON.stringify(out);
  })()`);
  console.log('STEP12:', JSON.stringify(step12));

  // 选中态统一：引擎打开的项目卡片高亮（含视图覆盖打开的常驻项目）；新建项目同规则
  const step13 = await evaluate(`(async function(){
    var out={};
    try{
      var st=window.__dshWorktable.splitStore;
      var ta=document.querySelector('.dsh-wt_projects .ta_card');
      var pr=document.querySelector('.dsh-wt_projects .pr_card');
      // 布局项目打开 → 常驻卡 data-on=false
      st.open({id:'t-layout',title:'L',top:null,main:[{id:'p1',title:'1',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
      await new Promise(function(r){setTimeout(r,400)});
      out.taOnWhenLayoutOpen=ta?ta.getAttribute('data-on'):null;
      out.prOnWhenLayoutOpen=pr?pr.getAttribute('data-on'):null;
      st.close();
      await new Promise(function(r){setTimeout(r,300)});
      // 给旅行设置视图覆盖（走 UI：设置 → 旅行行 🧩 → 2h）
      var btn=document.querySelector('.dsh-wt_actions .dsh-wt_iconBtn:nth-child(2)');
      if(btn){ btn.click(); }
      await new Promise(function(r){setTimeout(r,300)});
      var rows=document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow:not(.dsh-wt_manageRowSc):not(.dsh-wt_manageRowRemoved)');
      var taRow=rows[1];
      var puzzle=taRow&&taRow.querySelectorAll('.dsh-wt_manageBtn')[taRow.querySelectorAll('.dsh-wt_manageBtn').length-2];
      if(puzzle){ puzzle.click(); }
      await new Promise(function(r){setTimeout(r,300)});
      var presets=document.querySelectorAll('.dsh-wt_presets .dsh-wt_preset');
      if(presets[0]){ presets[0].click(); }
      await new Promise(function(r){setTimeout(r,400)});
      var bd=document.querySelector('.dsh-wt_popBackdrop');
      if(bd){ bd.click(); }
      await new Promise(function(r){setTimeout(r,300)});
      // 点旅行卡片 → 视图覆盖 → 引擎打开 → 卡片高亮
      if(ta){ ta.click(); }
      await new Promise(function(r){setTimeout(r,500)});
      out.taOnAfterOpen=ta?ta.getAttribute('data-on'):null;
      out.engineSpecId=st.spec?st.spec.id:null;
      // 反选：再点一次卡片 → 引擎关闭 + 高亮熄灭
      if(ta){ ta.click(); }
      await new Promise(function(r){setTimeout(r,400)});
      out.activeAfterSecondClick=st.active;
      out.taOnAfterSecondClick=ta?ta.getAttribute('data-on'):null;
      st.close();
      await new Promise(function(r){setTimeout(r,300)});
    }catch(err){ out.err=String(err) }
    return JSON.stringify(out);
  })()`);
  console.log('STEP13:', JSON.stringify(step13));

  // MD 编辑模式：预览/编辑切换 + 保存回磁盘
  const step16 = await evaluate(`(async function(){
    var out={};
    try{
      var st=window.__dshWorktable.splitStore;
      var probe=await fetch('/api/worktable/write',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).catch(function(){return null;});
      out.writeRouteReady=!!(probe&&probe.status===400);
      if(out.writeRouteReady){
        st.open({id:'t-mdedit',title:'md',top:null,main:[{id:'m1',title:'m',min:200,content:null}],chatWidth:{default:320,min:240,max:600}});
        await new Promise(function(r){setTimeout(r,400)});
        st.openTab('main',0,{kind:'file',path:'C:\\\\Users\\\\SJL\\\\AppData\\\\Local\\\\Temp\\\\wt-edit-test.md'});
        await new Promise(function(r){setTimeout(r,1200)});
        out.bar=!![].slice.call(document.querySelectorAll('.dsh-wt_mdBar')).find(function(el){return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0)});
        var bar=[].slice.call(document.querySelectorAll('.dsh-wt_mdBar')).find(function(el){return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0)});
        var btns=bar?bar.querySelectorAll('.dsh-wt_mdBtn'):[];
        if(btns[1]){ btns[1].click(); }
        await new Promise(function(r){setTimeout(r,250)});
        var ta=[].slice.call(document.querySelectorAll('.dsh-wt_mdEdit')).find(function(el){return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0)});
        out.editArea=!!ta;
        out.draft0=ta?ta.value.slice(0,8):null;
        if(ta){
          var setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
          setter.call(ta,'# EDITED_OK');
          ta.dispatchEvent(new Event('input',{bubbles:true}));
        }
        await new Promise(function(r){setTimeout(r,250)});
        var saveBtn=[].slice.call(document.querySelectorAll('.dsh-wt_mdSave')).find(function(el){return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0)});
        // fail-safe：保存前强制校验激活标签的目标路径就是临时夹具，防止测试误写真实文件
        var curTab=st.spec&&st.spec.main[0]?st.spec.main[0].tabs[st.spec.main[0].active||0]:null;
        out.curPath=curTab?String(curTab.content.path||'').slice(-20):null;
        if(saveBtn && curTab && String(curTab.content.path).indexOf('wt-edit-test.md')>=0){ saveBtn.click(); }
        await new Promise(function(r){setTimeout(r,900)});
        out.previewBack=!![].slice.call(document.querySelectorAll('.dsh-wt_md')).find(function(el){return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0)});
        var chk=await fetch('/api/worktable/file?path='+encodeURIComponent('C:\\\\Users\\\\SJL\\\\AppData\\\\Local\\\\Temp\\\\wt-edit-test.md')).then(function(r){return r.text()}).catch(function(){return null});
        out.savedContent=chk?String(chk).indexOf('EDITED_OK')>=0:false;
        st.close();
      }
    }catch(err){ out.err=String(err) }
    return JSON.stringify(out);
  })()`);
  console.log('STEP16:', JSON.stringify(step16));

  // 工作区状态保活：切换项目后激活标签/MD滚动位置/iframe 实例原样保留
  const step17 = await evaluate(`(async function(){
    var out={};
    try{
      var st=window.__dshWorktable.splitStore;
      var spec={id:'t-pool',title:'pool',top:null,main:[{id:'p1',title:'p',min:200,content:null}],chatWidth:{default:320,min:240,max:600}};
      st.open(spec);
      await new Promise(function(r){setTimeout(r,400)});
      st.openTab('main',0,{kind:'file',path:'E:\\\\AI_Workspace\\\\DeepseekHarness\\\\Projects\\\\dsh-worktable\\\\02_process\\\\PRD.md'});
      await new Promise(function(r){setTimeout(r,900)});
      st.openTab('main',0,{kind:'file',path:'E:\\\\AI_Workspace\\\\DeepseekHarness\\\\Projects\\\\dsh-worktable\\\\01_content\\\\src\\\\client\\\\styles.ts'});
      await new Promise(function(r){setTimeout(r,900)});
      st.setActiveTab('main',0,st.spec.main[0].tabs[1].id);
      // 轮询等待代码视图渲染（fetch 完成后 .dsh-wt_fileView 才出现；只取可见元素，避开保活池里的隐藏层）
      var fv=null;
      for(var w=0;w<20 && !fv;w++){ await new Promise(function(r){setTimeout(r,150)}); fv=[].slice.call(document.querySelectorAll('.dsh-wt_fileView')).find(function(el){return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0)}); }
      out.fileViewReady=!!fv;
      if(fv){ fv.scrollTop=320; }
      await new Promise(function(r){setTimeout(r,200)});
      out.scrollBeforeClose=fv?fv.scrollTop:null;
      var savedSpec=st.spec;
      st.close();
      await new Promise(function(r){setTimeout(r,300)});
      st.open(savedSpec);
      await new Promise(function(r){setTimeout(r,500)});
      out.activeAfter=st.spec.main[0].active;
      var fv2=[].slice.call(document.querySelectorAll('.dsh-wt_fileView')).find(function(el){return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0)});
      out.scrollAfter=fv2?fv2.scrollTop:null;
      // iframe 保活：加一个站点 iframe 标签 → 关闭 → 重开 → 同一 DOM 实例
      var rootToken=encodeURIComponent('E:\\\\AI_Workspace\\\\DeepseekHarness\\\\Projects\\\\dsh-worktable\\\\04_test\\\\fixture-site');
      st.openTab('main',0,{kind:'iframe',url:'/api/worktable/site/'+rootToken+'/index.html',title:'site'});
      await new Promise(function(r){setTimeout(r,1500)});
      var f1=document.querySelector('.dsh-wt_paneFrame');
      var savedSpec2=st.spec;
      st.close();
      await new Promise(function(r){setTimeout(r,300)});
      st.open(savedSpec2);
      await new Promise(function(r){setTimeout(r,500)});
      var f2=document.querySelector('.dsh-wt_paneFrame');
      out.iframeSameRef=f1===f2;
      out.activeAfter2=st.spec.main[0].active;
      st.close();
      await new Promise(function(r){setTimeout(r,200)});
    }catch(err){ out.err=String(err) }
    return JSON.stringify(out);
  })()`);
  console.log('STEP17:', JSON.stringify(step17));

  // 改名输入框：清空不会立刻弹回原名（本地草稿）；真实鼠标点击别处触发 blur 提交后回显原名
  const step18pre = await evaluate(`(async function(){
    var out={};
    try{
      var btn=document.querySelector('.dsh-wt_actions .dsh-wt_iconBtn:nth-child(2)');
      if(btn){ btn.click(); }
      await new Promise(function(r){setTimeout(r,300)});
      var rows=document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow:not(.dsh-wt_manageRowSc):not(.dsh-wt_manageRowRemoved)');
      var inp=rows[0]?rows[0].querySelector('.dsh-wt_manageInput'):null;
      if(inp){
        var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        setter.call(inp,'');
        inp.dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise(function(r){setTimeout(r,250)});
        out.cleared=inp.value==='';
        inp.focus();
        await new Promise(function(r){setTimeout(r,100)});
      }
      var sr=document.querySelector('.dsh-wt_sortRow').getBoundingClientRect();
      out.x=Math.round(sr.left+10);
      out.y=Math.round(sr.top+10);
    }catch(err){ out.err=String(err) }
    return JSON.stringify(out);
  })()`);
  console.log('STEP18pre:', JSON.stringify(step18pre));
  const p18 = JSON.parse(step18pre);
  if (p18 && p18.x != null && p18.y != null) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p18.x, y: p18.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p18.x, y: p18.y, button: 'left', clickCount: 1 });
    await sleep(300);
  }
  const step18 = await evaluate(`(function(){
    var out={};
    try{
      var rows=document.querySelectorAll('.dsh-wt_settings .dsh-wt_manageRow:not(.dsh-wt_manageRowSc):not(.dsh-wt_manageRowRemoved)');
      var inp=rows[0]?rows[0].querySelector('.dsh-wt_manageInput'):null;
      out.revertedToOriginal=inp?inp.value!=='':false;
      var bd=document.querySelector('.dsh-wt_popBackdrop');
      if(bd){ bd.click(); }
    }catch(err){ out.err=String(err) }
    return JSON.stringify(out);
  })()`);
  console.log('STEP18:', JSON.stringify(step18));

  // 网页 iframe 内部滚动位置保活（visibility 保活，尺寸不被压缩）
  const step19 = await evaluate(`(async function(){
    var out={};
    try{
      var st=window.__dshWorktable.splitStore;
      var spec={id:'t-webkeep',title:'w',top:null,main:[{id:'p1',title:'p',min:200,content:null}],chatWidth:{default:320,min:240,max:600}};
      st.open(spec);
      await new Promise(function(r){setTimeout(r,400)});
      var rt=encodeURIComponent('E:\\\\AI_Workspace\\\\DeepseekHarness\\\\Projects\\\\dsh-worktable\\\\04_test\\\\fixture-site');
      st.openTab('main',0,{kind:'iframe',url:'/api/worktable/site/'+rt+'/index.html',title:'index'});
      await new Promise(function(r){setTimeout(r,1800)});
      var f=[].slice.call(document.querySelectorAll('.dsh-wt_paneFrame')).find(function(el){return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0)});
      var doc=f&&f.contentDocument;
      if(doc&&doc.defaultView){ doc.defaultView.scrollTo(0,400); }
      await new Promise(function(r){setTimeout(r,200)});
      out.scrollSet=doc&&doc.defaultView?doc.defaultView.scrollY:null;
      var saved=st.spec;
      st.close();
      await new Promise(function(r){setTimeout(r,300)});
      st.open(saved);
      await new Promise(function(r){setTimeout(r,600)});
      var f2=[].slice.call(document.querySelectorAll('.dsh-wt_paneFrame')).find(function(el){return (getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0)});
      var doc2=f2&&f2.contentDocument;
      out.scrollBack=doc2&&doc2.defaultView?doc2.defaultView.scrollY:null;
      st.close();
    }catch(err){ out.err=String(err) }
    return JSON.stringify(out);
  })()`);
  console.log('STEP19:', JSON.stringify(step19));

  // 还原临时夹具
  try { fs.writeFileSync(TEMP_MD, '# ORIG\n', 'utf8') } catch {}

  const errors = events.filter((e) => {
    const ent = e.method === 'Log.entryAdded' ? e.params.entry : null;
    const txt = ent ? (ent.text || '') + '|' + (ent.url || '') : '';
    if (txt.indexOf('/api/worktable/write') >= 0) return false;
    return true;
  }).filter((e) => {
    // 站点路由属新增服务端能力：运行中的服务器未重启前该 404 属预期（重启后移除本过滤）
    const ent = e.method === 'Log.entryAdded' ? e.params.entry : null;
    const txt = ent ? (ent.text || '') + '|' + (ent.url || '') : '';
    if (txt.indexOf('/api/worktable/site') >= 0) return false;
    return true;
  }).filter((e) =>
    e.method === 'Runtime.exceptionThrown' ||
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'),
  ).slice(0, 10).map((e) => e.method === 'Runtime.exceptionThrown'
    ? 'EXCEPTION: ' + ((e.params.exceptionDetails.exception || {}).description || e.params.exceptionDetails.text)
    : 'LOG: ' + (e.params.entry ? e.params.entry.text : '').slice(0, 200));
  console.log('ERRORS_COUNT:', errors.length);
  errors.forEach((x) => console.log(x));
  ws.close();
  proc.kill();
  process.exit(0);
})().catch((e) => { console.log('SCRIPT_FAIL:', e); proc.kill(); process.exit(1); });