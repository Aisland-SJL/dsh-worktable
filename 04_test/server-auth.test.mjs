/**
 * 访问密码门禁回归测试（/api/worktable/* 全端点鉴权 + 终端 WS 握手门禁 + 首次设置 + 失败限速 + 跨进程持久化）。
 * 用法：node server-auth.test.mjs [lib/index.js 路径]（缺省 = 工作目录构建产物）
 *
 * 场景（全部在子进程隔离目录中运行，父进程不改环境变量、不残留临时目录）：
 *   A. 免鉴权端点：health 与 template 保持开放（保活探针/皮肤模板不能被门禁挡住）
 *   B. 未授权：file/site/fs/workspaces/write/mkdir/git 全部 401；浏览器导航返回内置登录页；
 *      write 被拦时**不落盘**（防「先写后判」）
 *   C. 首次登录即设置密码：200 + HttpOnly/SameSite=Strict Cookie + token；随后 Cookie / X-WT-Pin / ?auth= 三种凭据都能放行
 *   D. 失败限速：错误密码 401 → 同 IP 第 6 次 429；锁定期间既有 Cookie 会话不受影响；限速按 IP 隔离
 *   E. 跨进程持久化：换一个进程用同一 auth 文件 → 原密码与原 token 都仍然有效（门禁不是内存态）
 *   F. 终端 WS 握手门禁：无凭据回 401 并断开且**不升级**；带 token 才允许升级（ws/node-pty 用桩）
 *   G. 业务回归：带凭据的 workspaces 正常返回内容（门禁不改变原路由行为）
 * 说明：夹具里的 ws / node-pty 是**桩**（只为让终端路由注册并观察握手分支），不引入生产依赖。
 * 失败路径不调用 process.exit（避免跳过 finally），统一收口到 process.exitCode。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE_SRC = resolve(process.argv[2] ?? join(HERE, '..', '01_content', 'lib', 'index.js'))
const PIN = 'wt-test-pin-20260912'

let pass = 0
const failures = []
function fail(name, detail) {
  failures.push(name + ': ' + detail)
  console.error('FAIL(' + name + '): ' + detail)
}
const ok = (name) => { console.log('ok   ' + name); pass++ }

/** 临时 DSH 数据目录（含 storages/workspace.json 标记内容，无 BOM） */
function makeHome(marker) {
  const home = mkdtempSync(join(tmpdir(), 'wt-auth-home-'))
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['ws-' + marker], archivedSessionIds: [] },
    tables: { workspaces: { ['ws-' + marker]: { title: marker, sessionIds: ['s-' + marker] } } },
  }), 'utf8')
  return home
}

/** ws / node-pty 桩：让终端路由注册，并暴露「是否真的升级 / 起终端」的计数 */
function writeStubs(isoDir) {
  const wsDir = join(isoDir, 'node_modules', 'ws')
  mkdirSync(wsDir, { recursive: true })
  writeFileSync(join(wsDir, 'package.json'), JSON.stringify({ name: 'ws', version: '0.0.0-fixture', main: 'index.js' }), 'utf8')
  writeFileSync(join(wsDir, 'index.js'), [
    'class WebSocketServer {',
    '  handleUpgrade(req, socket, head, cb) {',
    '    globalThis.__wtUpgraded = (globalThis.__wtUpgraded || 0) + 1',
    '    cb({ readyState: 1, send() {}, close() {}, on() {} })',
    '  }',
    '}',
    'module.exports = { WebSocketServer }',
  ].join('\n'), 'utf8')
  const ptyDir = join(isoDir, 'node_modules', 'node-pty')
  mkdirSync(ptyDir, { recursive: true })
  writeFileSync(join(ptyDir, 'package.json'), JSON.stringify({ name: 'node-pty', version: '0.0.0-fixture', main: 'index.js' }), 'utf8')
  writeFileSync(join(ptyDir, 'index.js'), [
    'module.exports = {',
    '  spawn() {',
    '    globalThis.__wtSpawned = (globalThis.__wtSpawned || 0) + 1',
    '    return { onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }',
    '  },',
    '}',
  ].join('\n'), 'utf8')
}

/**
 * 子进程跑一个隔离场景：把构建产物与桩复制进隔离目录，用假宿主捕获路由/升级，
 * 打印一行 JSON（{ results: [{ name, ok, detail }], ...extra }）供父进程断言。
 */
function runChild(script, { home, authFile, marker, extraEnv = {} }) {
  const isoDir = mkdtempSync(join(tmpdir(), 'wt-auth-iso-'))
  try {
    mkdirSync(join(isoDir, 'lib'), { recursive: true })
    copyFileSync(BUNDLE_SRC, join(isoDir, 'lib', 'index.js'))
    writeStubs(isoDir)
    const runner = join(isoDir, 'run.mjs')
    writeFileSync(runner, script, 'utf8')
    const r = spawnSync(process.execPath, [runner, join(isoDir, 'lib', 'index.js')], {
      env: { ...process.env, DSH_HOME: home, DSH_WORKTABLE_AUTH_FILE: authFile, WT_PIN: PIN, ...extraEnv },
      encoding: 'utf8',
      timeout: 30000,
    })
    if (r.error) { fail(marker, 'spawn error: ' + r.error.message); return null }
    if (r.status !== 0) { fail(marker, 'exit=' + r.status + ' stderr=' + (r.stderr || '').slice(0, 600)); return null }
    const line = (r.stdout || '').trim().split('\n').pop()
    try { return JSON.parse(line) } catch { fail(marker, 'child output not JSON: ' + String(line).slice(0, 300)); return null }
  } finally {
    rmSync(isoDir, { recursive: true, force: true })
  }
}

/** 共用夹具前导：假宿主 + 请求/响应构造（子进程内以字符串拼接，避免转义） */
const HARNESS = `
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
// argv[2] = 构建产物路径（argv[1] 是本运行器自身）
const mod = await import(pathToFileURL(process.argv[2]).href)
const results = []
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) })
const routes = []
const upgrades = []
const ctx = {
  webServer: { register: (r) => routes.push(r), registerUpgrade: (r) => upgrades.push(r) },
  effect: (fn) => fn(),
  logger: { info() {}, warn() {} },
}
mod.apply(ctx)
const route = (p) => routes.find((r) => r.path === p)
const mkReq = (o = {}) => ({
  method: o.method || 'GET',
  url: o.url || '/',
  headers: o.headers || {},
  socket: { remoteAddress: o.ip || '127.0.0.1' },
  async *[Symbol.asyncIterator]() { yield Buffer.from(o.body || '') },
})
const mkRes = () => {
  const r = {
    status: 0, headers: {}, body: '',
    writeHead(s, h) { r.status = s; r.headers = h || {}; return r },
    end(b) { r.body = String(b === undefined ? '' : b); return r },
  }
  return r
}
const call = async (path, o) => { const res = mkRes(); await route(path).handler(mkReq(o), res); return res }
const post = (path, body, o = {}) => call(path, { method: 'POST', url: path, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...o })
const json = (res) => { try { return JSON.parse(res.body) } catch { return null } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const home = process.env.DSH_HOME
const readTarget = home + '/storages/workspace.json'
const writeTarget = home + '/storages/should-not-land.json'
`

// —— A + B + C + D + F + G：主链路（单进程） ——
const mainScript = HARNESS + `
let token = ''
{
  // A. 免鉴权端点
  const health = await call('/api/worktable/health')
  check('A.health 免鉴权 200', health.status === 200 && json(health)?.ok === true, health.status + ' ' + health.body.slice(0, 60))
  const tpl = await call('/api/worktable/template', { url: '/api/worktable/template/dshell.css' })
  check('A.template 免鉴权 200（皮肤模板不受门禁影响）', tpl.status === 200 && tpl.body.length > 0, tpl.status)

  // B. 未授权：全部敏感端点 401，write 不落盘
  const cases = [
    ['file', () => call('/api/worktable/file', { url: '/api/worktable/file?path=' + encodeURIComponent(readTarget) })],
    ['site', () => call('/api/worktable/site', { url: '/api/worktable/site/' + encodeURIComponent(home) + '/storages/workspace.json' })],
    ['fs', () => post('/api/worktable/fs', { path: home })],
    ['workspaces', () => call('/api/worktable/workspaces')],
    ['write', () => post('/api/worktable/write', { path: writeTarget, content: '{"should":"not land"}' })],
    ['mkdir', () => post('/api/worktable/mkdir', { path: writeTarget + '.dir' })],
    ['git', () => post('/api/worktable/git', { cwd: home })],
  ]
  for (const [name, fn] of cases) {
    const res = await fn()
    check('B.' + name + ' 未授权 401', res.status === 401, res.status + ' ' + res.body.slice(0, 80))
  }
  let landed = true
  try { readFileSync(writeTarget, 'utf8') } catch { landed = false }
  check('B.write 被拦后未落盘', landed === false)
  const nav = await call('/api/worktable/file', { url: '/api/worktable/file?path=' + encodeURIComponent(readTarget), headers: { accept: 'text/html' } })
  check('B.浏览器导航 401 + 内置设置页', nav.status === 401 && nav.body.includes('访问密码') && nav.body.includes('/api/worktable/login'), nav.status)
  check('B.未设密码时带 x-wt-first:1（客户端据此切「设置密码」文案）', nav.headers['x-wt-first'] === '1', nav.headers['x-wt-first'])

  // C. 首次登录即设置密码 + 三种凭据放行
  const login = await post('/api/worktable/login', { pin: process.env.WT_PIN })
  const setCookie = login.headers['set-cookie'] || ''
  token = json(login)?.token || ''
  check('C.首次 login 设置密码：200 + token', login.status === 200 && !!token, login.status + ' ' + login.body.slice(0, 80))
  check('C.Cookie 为 HttpOnly + SameSite=Strict', /HttpOnly/.test(setCookie) && /SameSite=Strict/i.test(setCookie), setCookie.slice(0, 120))
  const viaCookie = await call('/api/worktable/workspaces', { headers: { cookie: (setCookie.match(/wt_auth=[0-9a-f]+/) || [''])[0] } })
  check('C.Cookie 会话放行', viaCookie.status === 200, viaCookie.status + ' ' + viaCookie.body.slice(0, 80))
  const viaHeader = await call('/api/worktable/workspaces', { headers: { 'x-wt-pin': process.env.WT_PIN } })
  check('C.X-WT-Pin 头放行', viaHeader.status === 200, viaHeader.status)
  const viaQuery = await call('/api/worktable/workspaces', { url: '/api/worktable/workspaces?auth=' + token })
  check('C.?auth=token 放行（WS 与脚本场景）', viaQuery.status === 200, viaQuery.status)
  const probeOk = await call('/api/worktable/auth', { headers: { 'x-wt-pin': process.env.WT_PIN } })
  check('C.鉴权探针带凭据 200', probeOk.status === 200 && json(probeOk)?.ok === true, probeOk.status)
  const probeNo = await call('/api/worktable/auth')
  check('C.鉴权探针无凭据 401', probeNo.status === 401, probeNo.status)

  // D. 失败限速（独立 IP，避免影响其它断言）
  const wrong = () => post('/api/worktable/login', { pin: 'wrong-pin' }, { ip: '127.0.0.9' })
  const first = await wrong()
  check('D.错误密码 401', first.status === 401, first.status + ' ' + first.body.slice(0, 80))
  for (let i = 0; i < 4; i++) await wrong()
  const sixth = await wrong()
  check('D.同 IP 第 6 次尝试 429 锁定', sixth.status === 429, sixth.status + ' ' + sixth.body.slice(0, 80))
  const locked = await call('/api/worktable/workspaces', { headers: { cookie: 'wt_auth=' + token } })
  check('D.锁定期间既有会话不受影响', locked.status === 200, locked.status)
  const otherIp = await call('/api/worktable/workspaces', { ip: '127.0.0.10', headers: { 'x-wt-pin': process.env.WT_PIN } })
  check('D.限速按 IP 隔离', otherIp.status === 200, otherIp.status)

  // F. 终端 WS 握手门禁
  check('F.终端升级路由已注册（桩 ws/node-pty 生效）', upgrades.length === 1, upgrades.length)
  if (upgrades.length === 1) {
    const up = upgrades[0]
    const mkSock = () => { const s = { wrote: '', destroyed: false, write(t) { s.wrote += t }, destroy() { s.destroyed = true } }; return s }
    const s1 = mkSock()
    await up.handler(mkReq({ url: '/api/worktable/term?cwd=.' }), s1, null)
    await sleep(300)
    check('F.WS 无凭据 → 401 + 断开 + 未升级', s1.wrote.includes('401') && s1.destroyed && !globalThis.__wtUpgraded && !globalThis.__wtSpawned, s1.wrote.slice(0, 60))
    const s2 = mkSock()
    await up.handler(mkReq({ url: '/api/worktable/term?cwd=.&auth=' + token }), s2, null)
    await sleep(300)
    check('F.WS 带 token → 允许升级并起终端', globalThis.__wtUpgraded === 1 && globalThis.__wtSpawned === 1, JSON.stringify({ up: globalThis.__wtUpgraded, spawn: globalThis.__wtSpawned }))
  }

  // G. 业务回归
  const ws = await call('/api/worktable/workspaces', { headers: { 'x-wt-pin': process.env.WT_PIN } })
  check('G.带凭据 workspaces 内容不变', json(ws)?.tables?.workspaces?.['ws-MAIN']?.title === 'MAIN', ws.status + ' ' + ws.body.slice(0, 120))
}
console.log(JSON.stringify({ results, token }))
`

{
  const home = makeHome('MAIN')
  const authDir = mkdtempSync(join(tmpdir(), 'wt-auth-file-'))
  const authFile = join(authDir, 'worktable-auth.json')
  const out = runChild(mainScript, { home, authFile, marker: 'MAIN' })
  if (!out || !out.results) fail('MAIN', 'child did not return results')
  else for (const r of out.results) { if (r.ok) ok(r.name); else fail(r.name, r.detail) }

  // —— E. 跨进程持久化（同一 auth 文件，新进程） ——
  if (out && out.token) {
    const home2 = makeHome('PERSIST')
    const persistScript = HARNESS + `
{
  const viaPin = await call('/api/worktable/workspaces', { headers: { 'x-wt-pin': process.env.WT_PIN } })
  check('E.新进程：原密码仍有效', viaPin.status === 200, viaPin.status)
  const viaOldToken = await call('/api/worktable/workspaces', { url: '/api/worktable/workspaces?auth=' + process.env.WT_TOKEN })
  check('E.新进程：上一进程签发的 token 仍有效（会话持久化）', viaOldToken.status === 200, viaOldToken.status)
  const saved = JSON.parse(readFileSync(process.env.DSH_WORKTABLE_AUTH_FILE, 'utf8'))
  check('E.只落 scrypt 哈希，无明文密码', !!saved.pinHash?.salt && !!saved.pinHash?.hash && !JSON.stringify(saved).includes(process.env.WT_PIN))
  const nav = await call('/api/worktable/file', { url: '/api/worktable/file?path=' + encodeURIComponent(readTarget), headers: { accept: 'text/html' } })
  check('E.已设密码后登录页不再是「首次设置」文案', nav.headers['x-wt-first'] === '0', nav.headers['x-wt-first'])
}
console.log(JSON.stringify({ results }))
`
    const out2 = runChild(persistScript, { home: home2, authFile, marker: 'PERSIST', extraEnv: { WT_TOKEN: out.token } })
    if (!out2 || !out2.results) fail('PERSIST', 'child did not return results')
    else for (const r of out2.results) { if (r.ok) ok(r.name); else fail(r.name, r.detail) }
    try {
      const saved = JSON.parse(readFileSync(authFile, 'utf8'))
      if (!saved.pinHash?.hash) fail('E.auth 文件落盘', 'missing pinHash')
      else ok('E.auth 文件落在 DSH_WORKTABLE_AUTH_FILE 指定路径')
    } catch (e) { fail('E.auth 文件落盘', String(e)) }
    rmSync(home2, { recursive: true, force: true })
  } else {
    fail('PERSIST', '主链路子进程未返回 token —— 跨进程断言被跳过')
  }

  rmSync(home, { recursive: true, force: true })
  rmSync(authDir, { recursive: true, force: true })
}

console.log('all server-auth tests passed: ' + pass + ' assertions, ' + failures.length + ' failures')
process.exitCode = failures.length > 0 ? 1 : 0
