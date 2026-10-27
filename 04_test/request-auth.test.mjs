import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const require = createRequire(new URL('../01_content/package.json', import.meta.url))
const { buildSync } = require('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'wt-auth-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))
for (const [pkg, source] of Object.entries({
  ws: `const {EventEmitter}=require('node:events'); exports.WebSocketServer = class {
    clients=new Set();
    handleUpgrade(req,socket,head,callback){
      globalThis.__wtTestUpgrade=true;
      if(!globalThis.__wtAllowFakeShell) throw Error('TEST: unexpected authorized upgrade');
      const ws=new EventEmitter(); ws.send=()=>{}; ws.close=()=>{this.clients.delete(ws);ws.emit('close')};
      ws.terminate=()=>{globalThis.__wtSocketTerminated=true;ws.close()};this.clients.add(ws);callback(ws);
    }
    close(){}
  }`,
  'node-pty': `exports.spawn = () => {
    if(!globalThis.__wtAllowFakeShell)throw Error('TEST: unexpected shell');
    return {onData(){},onExit(){},write(){},resize(){},kill(){globalThis.__wtShellKilled=true}};
  }`,
})) {
  mkdirSync(join(temp, 'node_modules', pkg), { recursive: true })
  writeFileSync(join(temp, 'node_modules', pkg, 'index.js'), source)
}
const entry = fileURLToPath(new URL('../01_content/src/index.ts', import.meta.url))
buildSync({ entryPoints: [entry], bundle: true, outfile: join(temp, 'server.mjs'), platform: 'node', format: 'esm', external: ['@deepseek-ai/*', 'ws', 'node-pty'], loader: { '.css': 'text', '.html': 'text' } })
const server = await import(pathToFileURL(join(temp, 'server.mjs')).href)
const owner = { principal: { kind: 'owner' } }
function harness(connection) {
  const routes = new Map(), upgrades = new Map(), disposers = []
  const ctx = { get: () => connection.current, sessions: {}, logger: { info(){},warn(){} },
    webServer: { register(r){ routes.set(r.path,r); return () => routes.delete(r.path) }, registerUpgrade(r){upgrades.set(r.path,r); return () => upgrades.delete(r.path)} },
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d) },
  }
  server.apply(ctx)
  return { routes, upgrades, close(){for (const d of disposers.reverse()) d()} }
}
async function invoke(route, body, method = 'POST', url = route.path) {
  let consumed = false
  const req = { method, url, headers: {}, async *[Symbol.asyncIterator](){consumed=true;yield Buffer.from(JSON.stringify(body ?? {}))} }
  const result = { status: 0, headers: {}, body: '' }
  await route.handler(req, { writeHead(s,h){result.status=s;result.headers=h??{}},end(b){result.body=b?.toString()??''} })
  return { ...result, consumed }
}

test('Every private HTTP route rejects unauthenticated requests before reading a body or file', async () => {
  const h = harness({ current: { admit: () => ({ rejection: 401 }) } })
  try {
    for (const [path, route] of h.routes) {
      if (path === server.HEALTH_PATH || path.endsWith('/preview-static')) continue
      const r = await invoke(route, {path: join(temp,'not-created'),content:'no'})
      assert.equal(r.status,401,path);assert.equal(r.consumed,false,path)
    }
    assert.equal(existsSync(join(temp,'not-created')),false)
  } finally { h.close() }
})
test('Missing auth, exceptions, malformed admissions and non-owner API peers fail closed', async () => {
  for (const [connection,status] of [[undefined,503],[{requestRejection:()=>undefined},503],[{admit(){throw Error('unavailable')}},503],[{admit:()=>null},503],[{admit:()=>({})},403],[{admit:()=>({peer:{principal:{kind:'agent'}}})},403]]) {
    const h=harness({current:connection})
    try { assert.equal((await invoke(h.routes.get('/api/worktable/write'),{})).status,status) } finally { h.close() }
  }
})
test('An admitted owner writes normally; revocation is checked on the next request', async () => {
  const connection={current:{admit:()=>({peer:owner})}}
  const h=harness(connection), path=join(temp,'authorized.txt')
  try {
    assert.equal((await invoke(h.routes.get('/api/worktable/write'),{path,content:'authorized'})).status,200)
    connection.current={admit:()=>({rejection:403})}
    assert.equal((await invoke(h.routes.get('/api/worktable/write'),{path,content:'blocked'})).status,403)
    assert.equal(readFileSync(path,'utf8'),'authorized')
  } finally {h.close()}
})
test('0.2.0 single operator identity remains supported', async () => {
  const operator={id:'isolated-operator'}
  for(const connection of [{operator,admit:()=>({peer:operator})}]) {
    const h=harness({current:connection})
    try { assert.equal((await invoke(h.routes.get('/api/worktable/mkdir'),{})).status,400) } finally {h.close()}
  }
})
test('Terminal denies before upgrading or starting a shell; no auth service also denies', async () => {
  for (const [connection,status] of [[{admit:()=>({rejection:401})},401],[undefined,503]]) {
    const h=harness({current:connection});let response='';globalThis.__wtTestUpgrade=false
    try {
      const route=h.upgrades.get('/api/worktable/term');assert.ok(route)
      await route.handler({headers:{},url:route.path},{end(s){response=s}},Buffer.alloc(0))
      assert.match(response,new RegExp('HTTP/1.1 '+status));assert.equal(globalThis.__wtTestUpgrade,false)
    } finally {h.close()}
  }
})
test('Health discloses only status; route effects and preview grants are disposed', async () => {
  const h=harness({current:undefined})
  assert.equal((await invoke(h.routes.get(server.HEALTH_PATH),undefined,'GET')).status,200)
  h.close();assert.equal(h.routes.size,0);assert.equal(h.upgrades.size,0)
})
test('Plugin disposal terminates its shell/socket and refuses a pending upgrade', async () => {
  globalThis.__wtAllowFakeShell=true;globalThis.__wtShellKilled=false;globalThis.__wtSocketTerminated=false
  const h=harness({current:{admit:()=>({peer:owner})}})
  try {
    await h.upgrades.get('/api/worktable/term').handler({url:'/api/worktable/term?cwd='+encodeURIComponent(temp)}, {}, Buffer.alloc(0))
    h.close();assert.equal(globalThis.__wtShellKilled,true);assert.equal(globalThis.__wtSocketTerminated,true)
  } finally {globalThis.__wtAllowFakeShell=false}
  let finish, response='';globalThis.__wtTestUpgrade=false
  const pending=harness({current:{admit:()=>new Promise(resolve=>{finish=resolve})}})
  const call=pending.upgrades.get('/api/worktable/term').handler({}, {end(s){response=s}}, Buffer.alloc(0))
  pending.close();finish({peer:owner});await call
  assert.match(response,/HTTP\/1.1 503/);assert.equal(globalThis.__wtTestUpgrade,false)
})
test('Only an authenticated owner can mint a preview; a capability is read-only and revocable', async () => {
  const h=harness({current:{admit:()=>({peer:owner})}})
  try {
    writeFileSync(join(temp,'page.html'),'<h1>fixture</h1>')
    const grant=JSON.parse((await invoke(h.routes.get('/api/worktable/preview'),{root:temp})).body)
    assert.match(grant.token,/^[\w-]{32}$/)
    const route=h.routes.get('/api/worktable/preview-static'), url=grant.base+'page.html'
    const r=await invoke(route,undefined,'GET',url)
    assert.equal(r.status,200);assert.equal(r.body,'<h1>fixture</h1>');
    assert.equal((await invoke(route,undefined,'HEAD',url)).status,200);
    assert.match(r.headers['content-security-policy'],/sandbox allow-scripts/)
    assert.doesNotMatch(r.headers['content-security-policy'],/allow-same-origin/)
    assert.equal(r.headers['referrer-policy'],'no-referrer');assert.equal(r.headers['access-control-allow-origin'],'*')
    assert.equal((await invoke(route,{},'POST',url)).status,405)
    await invoke(h.routes.get('/api/worktable/preview'),{revoke:grant.token})
    assert.equal((await invoke(route,undefined,'GET',url)).status,404)
  } finally {h.close()}
})
