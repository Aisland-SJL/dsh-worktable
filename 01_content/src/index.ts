import { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { readdir, realpathSync } from 'node:fs'
import { dirname, resolve as pathResolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * dsh-worktable 服务端：健康路由 + 工作区内容窗的数据路由。
 * 参考 dsh-better-sidebar 的架构——内容窗能力由本插件自己的服务端路由提供：
 *   - POST /api/worktable/fs     目录列表（资源管理器窗）
 *   - POST /api/worktable/git    git 状态（源代码管理窗）
 *   - WS   /api/worktable/term   node-pty 终端流（终端窗；依赖宿主 node_modules 中的
 *                                node-pty 与 ws，缺失时该路由不注册、终端窗降级提示）
 */

export const name = 'dsh-worktable'
export const inject = ['webServer', 'sessions']

export const HEALTH_PATH = '/api/worktable/health'

const MAX_ENTRIES = 500

/**
 * 从本插件模块位置向祖先方向查找并加载 node_modules 包（如 ws / node-pty）。
 * 本包经 junction 链接进 profile，普通 import 可能解析不到 profile 级依赖；
 * 同时尝试 junction 路径与 realpath 两条祖先链。
 */
function loadPkg(pkg: string): any | null {
  const starts = new Set<string>()
  try { starts.add(dirname(fileURLToPath(import.meta.url))) } catch {}
  try { starts.add(realpathSync(dirname(fileURLToPath(import.meta.url)))) } catch {}
  for (const start of starts) {
    let dir: string | null = start
    while (dir && dir !== pathResolve(dir, '..')) {
      try {
        const req = createRequire(pathToFileURL(pathResolve(dir, '__wt_probe__.js')).href)
        return req(pkg)
      } catch {}
      dir = pathResolve(dir, '..')
    }
  }
  return null
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
  const abs = resolve(path)
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

/** 终端 WebSocket 升级路由（node-pty 缺失时不注册，终端窗降级为提示） */
async function setupTerminal(webServer: any, ctx: any) {
  if (typeof webServer.registerUpgrade !== 'function') return
  let wsMod: any = null
  let ptyMod: any = null
  try { wsMod = await import('ws') } catch {}
  try { ptyMod = await import('node-pty') } catch {}
  if (!wsMod) wsMod = loadPkg('ws')
  if (!ptyMod) ptyMod = loadPkg('node-pty')
  if (!wsMod || !ptyMod) {
    ctx.logger?.warn('[dsh-worktable] 终端路由未注册：ws/node-pty 均不可用')
    return
  }
  const WebSocketServer = wsMod.WebSocketServer ?? wsMod.default?.WebSocketServer
  if (!WebSocketServer) return
  const pty = ptyMod.default ?? ptyMod
  const wss = new WebSocketServer({ noServer: true })
  const spawnShell = (): string =>
    process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/bash')
  const clampDim = (v: number, fallback: number) => Math.min(1024, Math.max(2, Number.isFinite(v) ? v : fallback))

  webServer.registerUpgrade({
    path: '/api/worktable/term',
    handler: (req: any, socket: any, head: any) => {
      wss.handleUpgrade(req, socket, head, (ws: any) => {
        const u = new URL(req.url ?? '/', 'http://dsh.internal')
        const cwd = serverCwd(ctx, u.searchParams.get('sessionId') || undefined, u.searchParams.get('cwd') || undefined)
        const cols = clampDim(Number(u.searchParams.get('cols')), 80)
        const rows = clampDim(Number(u.searchParams.get('rows')), 24)
        let term: any = null
        try {
          term = pty.spawn(spawnShell(), [], { name: 'xterm-256color', cols, rows, cwd, env: process.env })
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
    },
  })
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
      json(res, 200, { plugin: 'dsh-worktable', version: '0.2.0', ok: true })
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/worktable/fs',
    handler: async (req: any, res: any) => {
      try {
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

  webServer.register({
    kind: 'exact',
    path: '/api/worktable/git',
    handler: async (req: any, res: any) => {
      const body = await readJsonBody(req)
      const cwd = serverCwd(ctx, body.sessionId, body.cwd)
      json(res, 200, await gitStatus(cwd))
    },
  })

  setupTerminal(webServer, ctx).catch(() => {})
}
