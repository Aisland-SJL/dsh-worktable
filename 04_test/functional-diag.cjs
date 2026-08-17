const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

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
    source: "try{ if(location.origin==='http://127.0.0.1:3080'){ localStorage.setItem('dsh.worktable.view.v1', JSON.stringify({query:'',searchOpen:false,orderBy:'manual',dock:'footer',floatTop:null,sortMigratedV2:true})); localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},shortcuts:[],layouts:[{id:'t-layout',title:'\u6d4b\u8bd5\u5e03\u5c40',top:null,left:null,main:[{id:'p1',title:'\u5185\u5bb91',min:200,content:null}],leftWidth:{default:260,min:160,max:480},chatWidth:{default:360,min:240,max:600},topHeight:{default:200,min:120,max:480},chatSide:'right',chatFullHeight:false}]})); } }catch(e){}",
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

  const step2 = await evaluate("(function(){ var out={}; out.pickers=document.querySelectorAll('.dsh-wt_panePicker').length; out.pickButtons=document.querySelectorAll('.dsh-wt_panePick').length; out.pickerModes=Array.prototype.map.call(document.querySelectorAll('.dsh-wt_panePicker'),function(el){return el.className}); out.pickSize=(function(){var b=document.querySelector('.dsh-wt_panePick'); if(!b) return null; var r=b.getBoundingClientRect(); return {w:r.width,h:r.height};})(); var st=window.__dshWorktable.splitStore; st.openTab('main',0,{kind:'builtin',type:'browser'}); st.openTab('main',1,{kind:'builtin',type:'explorer'}); return JSON.stringify(out) })()");
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
    var ta=document.querySelector('.dsh-wt_projects .ta_card');
    if(ta){ var cs=getComputedStyle(ta); out.taBorder=cs.borderTopColor; var desc=ta.querySelector('.ta_cardDesc'); out.taDescDisplay=desc?getComputedStyle(desc).display:null; }
    var pr=document.querySelector('.dsh-wt_projects .pr_card');
    if(pr){ var cs2=getComputedStyle(pr); out.prBorder=cs2.borderTopColor; var desc2=pr.querySelector('.pr_cardDesc'); out.prDescDisplay=desc2?getComputedStyle(desc2).display:null; }
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

  const errors = events.filter((e) =>
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
