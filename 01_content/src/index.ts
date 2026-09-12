import { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readdirSync, realpathSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve as pathResolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 基础数据目录解析：不加载任何官方包（loadPkg 的兜底只能用它，禁止反向调用包加载函数——否则成环）。
 * 规则与官方 @deepseek-ai/dsh-home-paths 的 resolveDshHome 一致：
 *   DSH_HOME 环境变量优先（空/纯空白视为未设置），否则 ~/.dsh；
 *   支持 ~、~/、~\ 前缀展开；相对路径按进程 cwd 解析；结果归一为绝对路径。
 * 禁止任何业务代码直接拼 homedir()/.dsh —— 自定义 DSH_HOME（Desktop/隔离测试）会读错数据。
 */
function baseDshHome(): string {
  const env = process.env.DSH_HOME
  // 与官方一致：trim 只用于判断是否全空白，实际路径保留原字符串（两端空格有含义）
  const value = env !== undefined && env.trim().length > 0 ? env : pathResolve(homedir(), '.dsh')
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return pathResolve(homedir(), value.slice(2))
  return pathResolve(value)
}

/** 解析 DSH 数据根目录：优先官方 @deepseek-ai/dsh-home-paths（显式配置/DSH_HOME/默认），
 *  不可用或返回非法值时回退 baseDshHome()（同官方规则）。带缓存。 */
let cachedDshHome: string | null = null
/** 本次解析实际走了哪条路径（供测试断言官方包是否真的被使用） */
let dshHomeSource: 'official' | 'fallback' = 'fallback'
function resolveDshHomeSafe(): string {
  if (cachedDshHome) return cachedDshHome
  try {
    const pkg = loadPkg('@deepseek-ai/dsh-home-paths') as any
    if (pkg && typeof pkg.resolveDshHome === 'function') {
      const home = pkg.resolveDshHome(undefined, process.env)
      if (typeof home === 'string' && home.trim() !== '') {
        dshHomeSource = 'official'
        cachedDshHome = home
        return cachedDshHome
      }
    }
  } catch {}
  dshHomeSource = 'fallback'
  cachedDshHome = baseDshHome()
  return cachedDshHome
}

/**
 * dsh-worktable 服务端：健康路由 + 工作区内容窗的数据路由。
 * 参考 dsh-better-sidebar 的架构——内容窗能力由本插件自己的服务端路由提供：
 *   - POST /api/worktable/fs     目录列表（资源管理器窗）
 *   - POST /api/worktable/git    git 状态（源代码管理窗）
 *   - WS   /api/worktable/term   node-pty 终端流（终端窗；依赖宿主 node_modules 中的
 *                                node-pty 与 ws，缺失时该路由不注册、终端窗降级提示）
 */

declare const __WT_VERSION__: string
const PLUGIN_VERSION = typeof __WT_VERSION__ === 'undefined' ? 'dev' : __WT_VERSION__

export const name = 'dsh-worktable'
export const inject = ['webServer', 'sessions']

export const HEALTH_PATH = '/api/worktable/health'

const MAX_ENTRIES = 500

/** 本地文件/站点静态资源的 MIME 映射（file 与 site 两条路由共用） */
const FILE_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
  pdf: 'application/pdf', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  wasm: 'application/wasm', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm',
}

const SITE_PREFIX = '/api/worktable/site'

// 原生皮肤模板（esbuild text loader 嵌入；/api/worktable/template 路由直接下发）
// @ts-ignore
import dshellCss from '../template/dshell.css'
// @ts-ignore
import dshellHtml from '../template/dshell.html'
const TEMPLATE_PREFIX = '/api/worktable/template'

/**
 * 从本插件模块位置向祖先方向查找并加载 node_modules 包（如 ws / node-pty）。
 * 本包经 junction 链接进 profile，普通 import 可能解析不到 profile 级依赖；
 * 同时尝试 junction 路径与 realpath 两条祖先链。
 */
/** 依赖探测尝试计数（供测试断言「有界探测、无循环重入」） */
let loadProbeAttempts = 0
function loadPkg(pkg: string): any | null {
  const starts = new Set<string>()
  try { starts.add(dirname(fileURLToPath(import.meta.url))) } catch {}
  try { starts.add(realpathSync(dirname(fileURLToPath(import.meta.url)))) } catch {}
  for (const start of starts) {
    let dir: string | null = start
    while (dir && dir !== pathResolve(dir, '..')) {
      loadProbeAttempts++
      try {
        const req = createRequire(pathToFileURL(pathResolve(dir, '__wt_probe__.js')).href)
        return req(pkg)
      } catch {}
      dir = pathResolve(dir, '..')
    }
  }
  // 兜底：DSH profiles/*/node_modules（按 baseDshHome 解析根目录——不能用 resolveDshHomeSafe，否则与本函数成环）
  try {
    const profilesDir = pathResolve(baseDshHome(), 'profiles')
    for (const profile of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!profile.isDirectory() && !profile.isSymbolicLink()) continue
      const nm = pathResolve(profilesDir, profile.name, 'node_modules')
      loadProbeAttempts++
      try {
        const req = createRequire(pathToFileURL(pathResolve(nm, '__wt_probe__.js')).href)
        return req(pkg)
      } catch {}
    }
  } catch {}
  return null
}

/** 测试钩子：依赖探测尝试次数 + 数据目录解析路径（循环回归与官方路径断言用） */
export function __wtLoadProbeStats(): { attempts: number; homeSource: 'official' | 'fallback' } {
  return { attempts: loadProbeAttempts, homeSource: dshHomeSource }
}

/** 解析会话工作目录：服务端 header.cwd 优先，其次客户端传入 cwd，最后进程 cwd */
function serverCwd(ctx: any, sessionId?: string, clientCwd?: string): string {
  if (sessionId) {
    try {
      const headerCwd = ctx.sessions?.get?.(sessionId)?.header?.cwd
      if (typeof headerCwd === 'string' && headerCwd) return headerCwd
    } catch {}
  }
  if (typeof clientCwd === 'string' && clientCwd) return clientCwd
  return process.cwd()
}

function json(res: any, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: any): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try { return JSON.parse(text) } catch { return {} }
}

/** 列出一个目录层级（目录在前、大小写不敏感排序、上限 500、隐藏项标注） */
async function listDirectory(path: string) {
  const abs = pathResolve(path)
  const dirents = await readdir(abs, { withFileTypes: true })
  const entries = dirents
    .map((d) => ({ name: d.name, path: abs + sep + d.name, isDir: d.isDirectory(), hidden: d.name.startsWith('.') }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  const truncated = entries.length > MAX_ENTRIES
  return { path: abs, entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries, truncated }
}

function gitExec(args: string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolvePromise(stdout)
    })
  })
}

/** git 状态快照（porcelain v1 -z；非仓库返回 isRepo:false） */
async function gitStatus(cwd: string) {
  try {
    const branchRaw = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    const porcelain = await gitExec(['status', '--porcelain=v1', '-z'], cwd)
    const entries = porcelain
      .split('\0')
      .filter((s) => s.length > 2)
      .map((s) => ({ xy: s.slice(0, 2), path: s.slice(3) }))
    return { isRepo: true, branch: branchRaw.trim() || 'HEAD', entries }
  } catch {
    return { isRepo: false, branch: undefined, entries: [] }
  }
}

// ============================ 访问密码（/api/worktable/* 门禁） ============================
// 背景：这些路由能读任意文件、写任意文件、建目录、按任意 cwd 跑 git，终端那条 WebSocket 更是
// 直接给出交互式 shell。服务只绑回环并不构成防护——CORS 只限制响应可读性，不阻止请求到达；
// JSON POST 用简单请求即可免预检；WebSocket 握手本来就不受同源策略约束。也就是说，用户浏览器里
// 打开的任意网页都能跨源打到这些端点。因此全部敏感端点统一加一道访问密码门禁：
//   - 浏览器：POST /api/worktable/login 换 HttpOnly + SameSite=Strict 会话 Cookie，同源请求自带；
//   - 脚本/终端：X-WT-Pin 头直接过门禁，或 ?auth=<token>（WebSocket 无法自定义握手头）；
//   - 首次使用即设置密码（与 dsh-timetable-mobile 的 mobile-server PIN 机制同语义）；
//   - 密码失败按 IP 限速；浏览器导航被拦时返回内置登录页，不破坏页面流。
// 密码只存 scrypt 加盐哈希，落 <DSH_HOME>/storages/worktable-auth.json（DSH_WORKTABLE_AUTH_FILE 可覆盖）。
const AUTH_COOKIE = 'wt_auth'
const AUTH_HEADER = 'x-wt-pin'
const AUTH_SESSION_MAX = 20
const AUTH_SESSION_TTL = 30 * 24 * 3600 * 1000
const AUTH_FAIL_WINDOW = 60 * 1000
const AUTH_FAIL_LIMIT = 5
const AUTH_LOCK_MS = 10 * 60 * 1000

interface AuthSession { token: string; lastSeen: number }
interface AuthData { pinHash?: { salt: string; hash: string }; sessions?: AuthSession[] }
interface AuthGateResult { status: number; error: string; firstTime?: boolean }

/** 密码状态文件路径（测试与自定义部署可用 DSH_WORKTABLE_AUTH_FILE 重定向） */
function authFilePath(): string {
  const override = process.env.DSH_WORKTABLE_AUTH_FILE
  if (override && override.trim()) return pathResolve(override)
  return pathResolve(resolveDshHomeSafe(), 'storages', 'worktable-auth.json')
}

const authState: { loaded: boolean; data: AuthData | null } = { loaded: false, data: null }

async function loadAuth(force = false): Promise<AuthData> {
  if (authState.loaded && !force) return authState.data as AuthData
  try {
    const raw = await readFile(authFilePath(), 'utf8')
    // 容忍 BOM（外部编辑器保存可能带 EF BB BF，JSON.parse 会抛错）
    authState.data = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw)
  } catch {
    authState.data = {}
  }
  authState.loaded = true
  return authState.data as AuthData
}

async function saveAuth(data: AuthData): Promise<void> {
  authState.data = data
  authState.loaded = true
  const fsx = await import('node:fs/promises')
  const file = authFilePath()
  try { await fsx.mkdir(dirname(file), { recursive: true }) } catch {}
  await fsx.writeFile(file, JSON.stringify(data), 'utf8')
}

function hashPin(pin: string) {
  const salt = randomBytes(16).toString('hex')
  return { salt, hash: scryptSync(String(pin), salt, 32, { N: 16384 }).toString('hex') }
}

function verifyPin(given: string, data: AuthData): boolean {
  const stored = data?.pinHash
  if (!stored?.salt || !stored?.hash) return false
  try {
    const calc = scryptSync(String(given), stored.salt, 32, { N: 16384 })
    return timingSafeEqual(calc, Buffer.from(stored.hash, 'hex'))
  } catch {
    return false
  }
}

function parseCookies(header: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

function pruneSessions(data: AuthData) {
  const now = Date.now()
  data.sessions = (data.sessions ?? []).filter((s) => now - s.lastSeen < AUTH_SESSION_TTL)
}

async function issueSession(data: AuthData): Promise<string> {
  const token = randomBytes(24).toString('hex')
  data.sessions = data.sessions ?? []
  pruneSessions(data)
  data.sessions.push({ token, lastSeen: Date.now() })
  while (data.sessions.length > AUTH_SESSION_MAX) data.sessions.shift()
  await saveAuth(data)
  return token
}

/** 会话校验（滚动续期只改内存，不逐次写盘） */
function hasSession(data: AuthData, token: string): boolean {
  if (!token) return false
  const now = Date.now()
  const hit = (data.sessions ?? []).find((s) => s.token === token)
  if (!hit) return false
  if (now - hit.lastSeen >= AUTH_SESSION_TTL) return false
  hit.lastSeen = now
  return true
}

/** 密码失败限速：单 IP 60s 窗口 5 次 → 锁 10 分钟（Cookie/token 会话不受影响） */
const authFails = new Map<string, { win: number; count: number; lockUntil: number }>()
function clientIp(req: any): string {
  return req?.socket?.remoteAddress || 'unknown'
}
function rateState(ip: string) {
  const now = Date.now()
  let b = authFails.get(ip)
  if (!b || now - b.win > AUTH_FAIL_WINDOW) {
    b = { win: now, count: 0, lockUntil: 0 }
    authFails.set(ip, b)
  }
  return b
}
function rateFail(ip: string) {
  const b = rateState(ip)
  b.count += 1
  if (b.count >= AUTH_FAIL_LIMIT) b.lockUntil = Date.now() + AUTH_LOCK_MS
}
function rateLocked(ip: string): number {
  return Math.max(0, rateState(ip).lockUntil - Date.now())
}

/** 门禁判定：通过返回 null，否则返回应回给客户端的状态 */
async function authGate(req: any, urlObj: URL): Promise<AuthGateResult | null> {
  const data = await loadAuth()
  const first = !data.pinHash
  const cookies = parseCookies(req?.headers?.cookie)
  if (hasSession(data, cookies[AUTH_COOKIE])) return null
  const urlToken = urlObj.searchParams.get('auth') || ''
  if (urlToken && hasSession(data, urlToken)) return null
  // 未设密码：放行到登录页/登录接口去设置，其余一律拦下
  const ip = clientIp(req)
  const locked = rateLocked(ip)
  if (locked > 0) return { status: 429, error: '密码错误次数过多，锁定 ' + Math.ceil(locked / 1000) + ' 秒', firstTime: first }
  const header = String(req?.headers?.[AUTH_HEADER] ?? '')
  if (header && verifyPin(header, data)) return null
  if (header) rateFail(ip)
  return { status: 401, error: first ? 'worktable pin not set yet — 首次访问请设置访问密码' : 'pin required', firstTime: first }
}

/** 浏览器导航被拦 → 内置登录页（首次访问即设置密码）；其余客户端 → JSON 401 */
function deny(req: any, res: any, gate: AuthGateResult) {
  const wantsHtml = req?.method === 'GET' && String(req?.headers?.accept ?? '').includes('text/html')
  const status = gate.status === 429 ? 429 : 401
  // x-wt-first：客户端据此把浮层文案切成「首次设置密码」
  const headers: Record<string, string> = { 'cache-control': 'no-store', 'x-wt-first': gate.firstTime ? '1' : '0' }
  if (wantsHtml) {
    res.writeHead(status, { ...headers, 'content-type': 'text/html; charset=utf-8' })
    res.end(loginPageHtml(!!gate.firstTime))
    return
  }
  res.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: gate.error }))
}

/** 各路由处理器统一入口：被拦（或出错）时已写好响应，返回 true 表示本次请求结束 */
async function gateReq(req: any, res: any): Promise<boolean> {
  const gate = await authGate(req, new URL(req?.url ?? '/', 'http://dsh.internal'))
  if (!gate) return false
  deny(req, res, gate)
  return true
}

/** 内置登录页（自包含，不引外链；登录成功 location.reload() 回到原页面） */
function loginPageHtml(firstTime: boolean): string {
  const head = firstTime ? '设置工作台访问密码' : '工作台访问密码'
  const sub = firstTime
    ? '首次使用：给本机工作台接口设置一个访问密码（只保存加盐哈希）'
    : '本机工作台接口受访问密码保护'
  const btn = firstTime ? '设置并进入' : '进入'
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + head + '</title><style>'
    + 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-base,#0b0e14);color:var(--dsw-alias-label-primary,#e6e8eb);font:14px/1.7 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}'
    + 'main{max-width:380px;padding:28px;background:var(--dsw-alias-fill-l1,#12161e);border:1px solid var(--dsw-alias-border-l1,#262b36);border-radius:14px;text-align:center}'
    + 'input{width:100%;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#262b36);background:rgba(255,255,255,.05);color:inherit;font:inherit;outline:none;box-sizing:border-box}'
    + 'button{margin-top:10px;width:100%;padding:10px;border:none;border-radius:8px;background:#3fb950;color:#07130a;font-weight:600;cursor:pointer}'
    + 'p{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa4b2)}#m{min-height:18px;font-size:12px;color:#f85149}'
    + '</style></head><body><main><h2>' + head + '</h2><p>' + sub + '</p>'
    + '<input id="p" type="password" placeholder="访问密码" autofocus><button id="b">' + btn + '</button><div id="m"></div>'
    + '</main><script>'
    + 'var i=document.getElementById("p"),b=document.getElementById("b"),m=document.getElementById("m");'
    + 'function go(){fetch("/api/worktable/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pin:i.value})})'
    + '.then(function(r){return r.json()}).then(function(j){if(j.ok){location.reload()}else{m.textContent=j.error||"密码错误"}})'
    + '.catch(function(e){m.textContent=String(e)})}'
    + 'b.onclick=go;i.addEventListener("keydown",function(e){if(e.key==="Enter")go()});'
    + '<\/script></body></html>'
}

/** 终端 WebSocket 升级路由（同步注册 + ctx.effect，同 better-sidebar；node-pty 缺失时不注册） */
function setupTerminal(webServer: any, ctx: any) {
  if (typeof webServer.registerUpgrade !== 'function') return
  const wsMod = loadPkg('ws')
  const ptyMod = loadPkg('node-pty')
  ctx.logger?.info?.('[dsh-worktable] term deps: ws=' + (wsMod ? 'ok' : 'MISSING') + ' node-pty=' + (ptyMod ? 'ok' : 'MISSING'))
  if (!wsMod || !ptyMod) {
    ctx.logger?.warn('[dsh-worktable] 终端路由未注册：ws/node-pty 不可用')
    return
  }
  const WebSocketServer = wsMod.WebSocketServer ?? wsMod.default?.WebSocketServer
  if (!WebSocketServer) return
  const pty = ptyMod.default ?? ptyMod
  const wss = new WebSocketServer({ noServer: true })
  const spawnShell = (): { cmd: string; args: string[] } =>
    process.platform === 'win32'
      ? { cmd: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] } // -NoProfile：跳过用户配置（oh-my-posh 花哨提示符在 xterm 里是乱码，PSReadLine 长输入行不换行被截断）
      : { cmd: process.env.SHELL || '/bin/bash', args: [] }
  const clampDim = (v: number, fallback: number) => Math.min(1024, Math.max(2, Number.isFinite(v) ? v : fallback))

  ctx.effect(() => webServer.registerUpgrade({
    path: '/api/worktable/term',
    handler: (req: any, socket: any, head: any) => {
      const uGate = new URL(req.url ?? '/', 'http://dsh.internal')
      // WebSocket 没有同源约束、也没有预检：门禁必须在握手前判掉，未授权直接回 401 并断开
      authGate(req, uGate).then((gate) => {
        if (gate) {
          try {
            socket.write('HTTP/1.1 401 Unauthorized\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\nworktable: ' + gate.error + '\n')
          } catch {}
          try { socket.destroy() } catch {}
          return
        }
        wss.handleUpgrade(req, socket, head, (ws: any) => {
          const u = new URL(req.url ?? '/', 'http://dsh.internal')
          const cwd = serverCwd(ctx, u.searchParams.get('sessionId') || undefined, u.searchParams.get('cwd') || undefined)
          const cols = clampDim(Number(u.searchParams.get('cols')), 80)
          const rows = clampDim(Number(u.searchParams.get('rows')), 24)
          let term: any = null
          try {
            const shell = spawnShell()
            term = pty.spawn(shell.cmd, shell.args, { name: 'xterm-256color', cols, rows, cwd, env: process.env })
          } catch (err) {
            try { ws.send('\r\n[worktable] 终端启动失败：' + String(err)) } catch {}
            try { ws.close() } catch {}
            return
          }
          term.onData((d: string) => { try { ws.send(d) } catch {} })
          term.onExit(() => { try { ws.close() } catch {} })
          ws.on('message', (raw: any) => {
            const text = String(raw)
            try {
              const msg = JSON.parse(text)
              if (msg && msg.type === 'resize' && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
                term.resize(clampDim(msg.cols, cols), clampDim(msg.rows, rows))
                return
              }
            } catch {}
            try { term.write(text) } catch {}
          })
          ws.on('close', () => { try { term.kill() } catch {} })
        })
      }).catch(() => { try { socket.destroy() } catch {} })
    },
  }), 'dsh-worktable: terminal upgrade')
}

export function apply(ctx: Context) {
  const webServer = (ctx as any).webServer
  if (!webServer) {
    ctx.logger?.warn('[dsh-worktable] ctx.webServer 不可用（headless profile？），跳过服务端路由')
    return
  }

  webServer.register({
    kind: 'exact',
    path: HEALTH_PATH,
    handler: (_req: any, res: any) => {
      json(res, 200, { plugin: 'dsh-worktable', version: PLUGIN_VERSION, ok: true })
    },
  })

  // 访问密码登录：首次调用即设置密码。成功返回会话 token（WebSocket 的 ?auth= 与脚本用），
  // 同时下发 HttpOnly + SameSite=Strict 的会话 Cookie（浏览器同源请求自动携带，跨源页面带不上）。
  webServer.register({
    kind: 'exact',
    path: '/api/worktable/login',
    handler: async (req: any, res: any) => {
      try {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        const body = await readJsonBody(req)
        const pin = String(body.pin ?? '')
        if (!pin) { json(res, 400, { ok: false, error: 'missing pin' }); return }
        const data = await loadAuth()
        if (!data.pinHash) {
          data.pinHash = hashPin(pin)
        } else {
          const ip = clientIp(req)
          const locked = rateLocked(ip)
          if (locked > 0) {
            json(res, 429, { ok: false, error: '密码错误次数过多，锁定 ' + Math.ceil(locked / 1000) + ' 秒' })
            return
          }
          if (!verifyPin(pin, data)) {
            rateFail(ip)
            json(res, 401, { ok: false, error: '密码错误' })
            return
          }
        }
        const token = await issueSession(data)
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'set-cookie': AUTH_COOKIE + '=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + (30 * 24 * 3600),
        })
        res.end(JSON.stringify({ ok: true, token }))
      } catch (err) {
        json(res, 500, { ok: false, error: String(err) })
      }
    },
  })

  // 轻量鉴权探针：客户端开终端 WebSocket 前先探一次（握手失败在浏览器侧读不到 401）
  webServer.register({
    kind: 'exact',
    path: '/api/worktable/auth',
    handler: async (req: any, res: any) => {
      if (await gateReq(req, res)) return
      json(res, 200, { ok: true })
    },
  })

  // 本地文件读取（资源管理器点击 .html 后浏览器标签内打开）
  webServer.register({
    kind: 'exact',
    path: '/api/worktable/file',
    handler: async (req: any, res: any) => {
      try {
        if (await gateReq(req, res)) return
        const u = new URL(req.url ?? '/', 'http://dsh.internal')
        const p = u.searchParams.get('path') || ''
        if (!p) { json(res, 400, { error: 'missing path' }); return }
        const abs = pathResolve(p)
        const stat = await import('node:fs/promises').then((m) => m.stat(abs))
        if (stat.size > 20 * 1024 * 1024) { json(res, 413, { error: 'file too large' }); return }
        const data = await readFile(abs)
        const ext = (abs.split('.').pop() || '').toLowerCase()
        const types: Record<string, string> = {
          html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
          css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
          json: 'application/json; charset=utf-8', md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
          pdf: 'application/pdf', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
        }
        res.writeHead(200, { 'content-type': FILE_TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(data)
      } catch (err) {
        json(res, 404, { error: String(err) })
      }
    },
  })

  // 本地站点（目录级静态托管）：点开 index.html 时挂载整个所在目录，
  // 让 ./assets/... 等相对引用正常解析（前缀路由，余下路径 = <rootToken>/<相对路径>）。
  // 原生皮肤模板：HTML 骨架 + 设计系统样式表（随插件分发，主题自动适配）
  webServer.register({
    kind: 'prefix',
    path: TEMPLATE_PREFIX,
    handler: (req: any, res: any) => {
      try {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        const rel = pathname.slice(TEMPLATE_PREFIX.length)
        if (rel === '/dshell.css') {
          res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' })
          res.end(dshellCss)
        } else {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(dshellHtml)
        }
      } catch (err) {
        res.writeHead(404); res.end(String(err))
      }
    },
  })

  webServer.register({
    kind: 'prefix',
    path: SITE_PREFIX,
    handler: async (req: any, res: any) => {
      try {
        if (await gateReq(req, res)) return
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        const segs = pathname.slice(SITE_PREFIX.length).split('/').filter(Boolean)
        const rootToken = decodeURIComponent(segs.shift() ?? '')
        const rel = segs.map((s) => { try { return decodeURIComponent(s) } catch { return s } }).join('/')
        if (!rootToken) { json(res, 400, { error: 'missing root' }); return }
        const root = pathResolve(rootToken)
        let abs = pathResolve(root, rel)
        if (abs !== root && !abs.startsWith(root + sep)) { json(res, 403, { error: 'outside root' }); return }
        const statMod = await import('node:fs/promises')
        let info = await statMod.stat(abs).catch(() => null)
        if (info && info.isDirectory()) {
          abs = pathResolve(abs, 'index.html')
          info = await statMod.stat(abs).catch(() => null)
        }
        if (!info || !info.isFile()) { json(res, 404, { error: 'not found' }); return }
        if (info.size > 40 * 1024 * 1024) { json(res, 413, { error: 'file too large' }); return }
        const data = await readFile(abs)
        const ext = (abs.split('.').pop() || '').toLowerCase()
        res.writeHead(200, { 'content-type': FILE_TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(data)
      } catch (err) {
        json(res, 404, { error: String(err) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/worktable/fs',
    handler: async (req: any, res: any) => {
      try {
        if (await gateReq(req, res)) return
        const body = await readJsonBody(req)
        const path = typeof body.path === 'string' && body.path
          ? body.path
          : serverCwd(ctx, body.sessionId, body.cwd)
        json(res, 200, await listDirectory(path))
      } catch (err) {
        json(res, 500, { path: '', entries: [], truncated: false, error: String(err) })
      }
    },
  })

  // 工作区列表（自定义窗口会话分组用）：
  // 优先走宿主正式服务 ctx.workspaceRegistry（0.1.1/0.1.2 均有，正确感知 DSH_HOME 与存储后端）；
  // 不可用时回退按 resolveDshHomeSafe() 读 storages/workspace.json（只读）。
  // 返回结构是客户端契约，两种来源都映射成同一 shape。
  webServer.register({
    kind: 'exact',
    path: '/api/worktable/workspaces',
    handler: async (req: any, res: any) => {
      try {
        if (await gateReq(req, res)) return
        // cordis 对未 inject 服务的属性访问会直接 throw（不返回 undefined），必须 try-catch 探测
        let registry: any = null
        try { registry = (ctx as any).workspaceRegistry ?? null } catch {}
        if (!registry) {
          try { registry = ctx.get?.('workspaceRegistry') ?? null } catch {}
        }
        if (registry && typeof registry.list === 'function') {
          const list = registry.list() ?? []
          const workspaceIds: string[] = []
          const tables: Record<string, { title?: string; sessionIds?: string[] }> = {}
          for (const ws of list) {
            const id = String(ws?.id ?? '')
            if (!id) continue
            workspaceIds.push(id)
            tables[id] = {
              title: typeof ws?.title === 'string' ? ws.title : undefined,
              sessionIds: Array.isArray(ws?.sessionIds) ? ws.sessionIds.map(String) : [],
            }
          }
          let archived: string[] = []
          try { archived = (registry.archivedSessionIds ?? []).map(String) } catch {}
          json(res, 200, {
            unit: { name: 'workspace', version: 2 },
            global: { initialized: true, workspaceIds, archivedSessionIds: archived },
            tables: { workspaces: tables },
          })
          return
        }
        const file = pathResolve(resolveDshHomeSafe(), 'storages', 'workspace.json')
        const raw = await readFile(file, 'utf8')
        // 容忍 BOM（外部工具改写可能带 EF BB BF，JSON.parse 会抛错）
        json(res, 200, JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw))
      } catch (err) {
        json(res, 404, { error: String(err) })
      }
    },
  })

  // 本地文件写入（MD 编辑模式保存回磁盘）
  webServer.register({
    kind: 'exact',
    path: '/api/worktable/write',
    handler: async (req: any, res: any) => {
      try {
        if (await gateReq(req, res)) return
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        const body = await readJsonBody(req)
        const p = typeof body.path === 'string' ? body.path : ''
        const content = typeof body.content === 'string' ? body.content : ''
        if (!p) { json(res, 400, { error: 'missing path' }); return }
        if (content.length > 20 * 1024 * 1024) { json(res, 413, { error: 'content too large' }); return }
        const abs = pathResolve(p)
        await import('node:fs/promises').then((m) => m.writeFile(abs, content, 'utf8'))
        json(res, 200, { ok: true })
      } catch (err) {
        json(res, 500, { error: String(err) })
      }
    },
  })

  // 新建分组：创建目录（仅当父目录已存在，避免递归误建深层垃圾目录）
  webServer.register({
    kind: 'exact',
    path: '/api/worktable/mkdir',
    handler: async (req: any, res: any) => {
      try {
        if (await gateReq(req, res)) return
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
        const body = await readJsonBody(req)
        const p = typeof body.path === 'string' ? body.path.trim() : ''
        if (!p) { json(res, 400, { error: 'missing path' }); return }
        const abs = pathResolve(p)
        const fsx = await import('node:fs/promises')
        const parent = dirname(abs)
        try { await fsx.access(parent) } catch { json(res, 400, { error: 'parent not found' }); return }
        await fsx.mkdir(abs)
        json(res, 200, { ok: true, path: abs })
      } catch (err: any) {
        json(res, err?.code === 'EEXIST' ? 200 : 500, err?.code === 'EEXIST' ? { ok: true, exists: true } : { error: String(err) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/worktable/git',
    handler: async (req: any, res: any) => {
      try {
        if (await gateReq(req, res)) return
      } catch (err) {
        json(res, 500, { error: String(err) })
        return
      }
      const body = await readJsonBody(req)
      const cwd = serverCwd(ctx, body.sessionId, body.cwd)
      json(res, 200, await gitStatus(cwd))
    },
  })

  // 启动自检：门禁默认开启，未设密码时给一行明确日志（浏览器首次访问会落到设置页）
  loadAuth().then((d) => ctx.logger?.info?.('[dsh-worktable] 访问密码：' + (d.pinHash
    ? '已配置（/api/worktable/* 全部需鉴权）'
    : '未配置——首次访问工作台接口时会要求在页面上设置（或 POST /api/worktable/login）')))

  setupTerminal(webServer, ctx)
}
