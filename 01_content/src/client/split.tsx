import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import 'xterm/css/xterm.css'

/**
 * dsh-worktable 乐高式工作区 M1：通用分栏引擎（PRD §13）。
 * 布局模型：标题栏 + 顶部通栏行(可选) + 主行内容窗 + 聊天窗（官方会话视图区整体，
 * 贴右或贴左，由 chatSide 决定；marginLeft/marginRight + marginTop 组合挤法）。
 * 内容三态：null（未指派 → 6 选 1 选择器）/ iframe / builtin（浏览器/资源管理器/SCM/任务/终端）。
 * 窗位调整：标题栏拖拽换位（同行或跨行）；工具栏 ⇄ 切换聊天窗左右。
 * 会话切换重新锚定不关闭；宽度按 layoutId 持久化 dsh.worktable.split.v1；
 * 内容与 chatSide 的变更经 onSpecMutated 回调交给工作台持久化（布局条目）。
 */

export type BuiltinType = 'browser' | 'explorer' | 'scm' | 'tasks' | 'terminal'

export type SplitContent =
  | { kind: 'iframe'; url: string }
  | { kind: 'builtin'; type: BuiltinType }

export type SplitPane = { id: string; title: string; min: number; content: SplitContent | null }

export type LayoutSpec = {
  id: string
  title: string
  top: SplitPane[] | null
  main: SplitPane[]
  /** 左列整高内容窗（可选；存在时右侧列 = top 行 + 底部聊天，chatSide 固定 right） */
  left?: SplitPane | null
  leftWidth?: { default: number; min: number; max: number }
  chatWidth: { default: number; min: number; max: number }
  topHeight?: { default: number; min: number; max: number }
  /** 聊天窗贴边位置：'right'（右列/右下，默认）| 'left'（左列/左下） */
  chatSide?: 'left' | 'right'
  /** 聊天窗通高（整列）：为 true 时聊天占整条右/左列，内容区（含 top 行）全部排在其另一侧 */
  chatFullHeight?: boolean
}

type Geom = { left: number; top: number; right: number; bottom: number }

type PaneRow = 'left' | 'top' | 'main'

type SplitState = {
  active: boolean
  spec: LayoutSpec | null
  geom: Geom | null
  chatW: number
  topH: number
  leftW: number
  paneWs: number[]
  topWs: number[]
  leftWs: number[]
  root: HTMLElement | null
  header: HTMLElement | null
  viewArea: HTMLElement | null
  savedMarginLeft: string
  savedMarginRight: string
  savedMarginTop: string
  observer: ResizeObserver | null
  fallback: MutationObserver | null
  yieldObserver: MutationObserver | null
  lastMarginLeft: string
  lastMarginRight: string
  lastMarginTop: string
  onSpecMutated: ((spec: LayoutSpec) => void) | null
  listeners: Set<() => void>
  open(spec: LayoutSpec): boolean
  close(): void
  syncAnchor(): void
  refreshGeom(): void
  applyMargin(): void
  setChatW(w: number): void
  setTopH(h: number): void
  setLeftW(w: number): void
  setPaneW(i: number, w: number): void
  setTopW(i: number, w: number): void
  setPaneContent(row: PaneRow, i: number, content: SplitContent | null): void
  swapPanes(aRow: PaneRow, aI: number, bRow: PaneRow, bI: number): void
  setChatSide(side: 'left' | 'right'): void
  persist(): void
  subscribe(fn: () => void): () => void
  notify(): void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const DIVIDER = 6
const BAR_H = 26
const PERSIST_KEY = 'dsh.worktable.split.v1'

/** 内置内容窗图标 */
const BUILTIN_ICONS: Record<BuiltinType, string> = {
  browser: '🌐',
  explorer: '📁',
  scm: '🔀',
  tasks: '✅',
  terminal: '▸_',
}

/** 分栏 UI 文案提供者（由工作台注入 locale t） */
let uiT: ((key: string) => string) | null = null
export function setSplitT(fn: ((key: string) => string) | null) {
  uiT = fn
}
const T = (key: string): string => (uiT ? uiT(key) : key)

/** 工作区环境（由工作台注入：当前会话作用域与后台任务列表） */
export type SplitScope = { sessionId: string; cwd: string }
export type SplitJob = {
  id: string
  kind: string
  label: string
  status: string
  detail?: string
  startedAt: number
  finishedAt?: number
}
type SplitEnv = {
  getScope: () => SplitScope | null
  getJobs: () => SplitJob[]
}
let splitEnv: SplitEnv | null = null
export function setSplitEnv(env: SplitEnv | null) {
  splitEnv = env
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

function parentPathOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (idx <= 0) return p
  let parent = p.slice(0, idx)
  if (/^[A-Za-z]:$/.test(parent)) parent += '\\'
  return parent
}

/** 拖拽换位暂存 */
let dragPane: { row: PaneRow; index: number } | null = null

/** 找到会话根容器：data-phase 元素中排除输入框、取含子元素者；优先 phase=active；无活动会话返回 null */
function findConversationRoot(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-phase]'))
  const ok = (el: HTMLElement) => el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT' && el.children.length >= 2
  return candidates.find((el) => ok(el) && el.dataset.phase === 'active')
    ?? candidates.find(ok)
    ?? null
}

function loadSaved(layoutId: string): { chatW: number; topH: number; leftW: number; paneWs: number[]; topWs: number[]; leftWs: number[] } | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)?.[layoutId]
    if (!s || typeof s !== 'object') return null
    return {
      chatW: Number.isFinite(s.chatW) ? s.chatW : -1,
      topH: Number.isFinite(s.topH) ? s.topH : -1,
      leftW: Number.isFinite(s.leftW) ? s.leftW : -1,
      paneWs: Array.isArray(s.paneWs) ? s.paneWs : [],
      topWs: Array.isArray(s.topWs) ? s.topWs : [],
      leftWs: Array.isArray(s.leftWs) ? s.leftWs : [],
    }
  } catch {
    return null
  }
}

function persistSaved(layoutId: string, s: { chatW: number; topH: number; leftW: number; paneWs: number[]; topWs: number[]; leftWs: number[] }) {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    const all = raw ? JSON.parse(raw) : {}
    all[layoutId] = s
    localStorage.setItem(PERSIST_KEY, JSON.stringify(all))
  } catch {}
}

/** 共享互斥协议：其他接入本协议的分栏引擎声明占用时，本引擎让位（同一时刻仅一个分栏工作区） */
window.addEventListener('dsh:split-claim', ((e: any) => {
  const id = e?.detail?.id
  if (splitStore.active && id && id !== splitStore.spec?.id) splitStore.close()
}) as EventListener)

export const splitStore: SplitState = {
  active: false,
  spec: null,
  geom: null,
  chatW: 320,
  topH: 200,
  leftW: 260,
  paneWs: [],
  topWs: [],
  leftWs: [],
  root: null,
  header: null,
  viewArea: null,
  savedMarginLeft: '',
  savedMarginRight: '',
  savedMarginTop: '',
  observer: null,
  fallback: null,
  yieldObserver: null,
  lastMarginLeft: '',
  lastMarginRight: '',
  lastMarginTop: '',
  onSpecMutated: null,
  listeners: new Set(),

  open(spec) {
    if (this.active) {
      // 反选：同一布局再点 = 关闭；不同布局 = 替换（先关旧的）
      if (this.spec?.id === spec.id) {
        this.close()
        return true
      }
      this.close()
    }
    // 兼容桥：travelatlas 尚未接入共享引擎（不改动其代码），打开本引擎布局前运行时点击其关闭按钮
    try {
      const taClose = document.querySelector<HTMLElement>('.ta_splitClose')
      taClose?.click()
    } catch {}
    // 声明占用：接入共享协议的其他引擎收到后让位
    try {
      window.dispatchEvent(new CustomEvent('dsh:split-claim', { detail: { id: spec.id } }))
    } catch {}
    const root = findConversationRoot()
    if (!root || root.dataset.phase !== 'active') return false
    const header = root.children[0] as HTMLElement | undefined
    const viewArea = root.children[1] as HTMLElement | undefined
    if (!header || !viewArea) return false
    this.spec = { ...spec, chatSide: spec.chatSide === 'left' ? 'left' : 'right' }
    const main = spec.main ?? []
    const top = spec.top ?? []
    const left = spec.left ?? null
    const saved = loadSaved(spec.id)
    this.chatW = saved && saved.chatW >= 0 ? saved.chatW : spec.chatWidth.default
    this.topH = saved && saved.topH >= 0 ? saved.topH : (spec.topHeight?.default ?? 200)
    this.leftW = saved && saved.leftW >= 0 ? saved.leftW : (spec.leftWidth?.default ?? 260)
    this.paneWs = saved && saved.paneWs.length === main.length ? [...saved.paneWs] : main.map((p) => p.min)
    this.topWs = saved && saved.topWs.length === top.length ? [...saved.topWs] : top.map((p) => p.min)
    this.leftWs = saved && saved.leftWs.length === (left ? 1 : 0) ? [...saved.leftWs] : (left ? [left.min] : [])
    this.root = root
    this.header = header
    this.viewArea = viewArea
    this.savedMarginLeft = viewArea.style.marginLeft
    this.savedMarginRight = viewArea.style.marginRight
    this.savedMarginTop = viewArea.style.marginTop
    this.refreshGeom()
    this.applyMargin()
    this.observer = new ResizeObserver(() => {
      const r = this.root
      if (!(r && r.isConnected && r.dataset.phase === 'active')) {
        this.syncAnchor()
        return
      }
      this.refreshGeom()
      this.applyMargin()
      this.notify()
    })
    this.observer.observe(root)
    // 兜底：会话根被替换/phase 变化时 RO 可能不再回调，用 body 级 MutationObserver 驱动重锚定
    this.fallback = new MutationObserver(() => {
      const r = this.root
      if (r && r.isConnected && r.dataset.phase === 'active') return
      this.syncAnchor()
    })
    this.fallback.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] })
    // 让位观察器：会话视图区 margin 被外部改写（其他未接入协议的分栏引擎接管）时关闭自身
    this.yieldObserver = new MutationObserver(() => {
      if (!this.active || !this.viewArea) return
      if (this.viewArea.style.marginLeft !== this.lastMarginLeft
        || this.viewArea.style.marginRight !== this.lastMarginRight
        || this.viewArea.style.marginTop !== this.lastMarginTop) {
        this.close()
      }
    })
    this.yieldObserver.observe(viewArea, { attributes: true, attributeFilter: ['style'] })
    this.active = true
    this.notify()
    return true
  },

  /** 会话根失效（切换会话）时重新锚定：左侧内容保持不关闭；无会话才关闭 */
  syncAnchor() {
    if (!this.active) return
    const next = findConversationRoot()
    if (!next) {
      this.close()
      return
    }
    if (next.dataset.phase !== 'active') return // 过渡态：保持等待（phase 变化会再次触发）
    if (next === this.root) {
      this.refreshGeom()
      this.applyMargin()
      this.notify()
      return
    }
    const header = next.children[0] as HTMLElement | undefined
    const viewArea = next.children[1] as HTMLElement | undefined
    if (!header || !viewArea) {
      this.close()
      return
    }
    // 恢复旧视图区 margin（若仍连接），锚定到新会话根
    if (this.viewArea && this.viewArea.isConnected && this.viewArea !== viewArea) {
      this.viewArea.style.marginLeft = this.savedMarginLeft
      this.viewArea.style.marginRight = this.savedMarginRight
      this.viewArea.style.marginTop = this.savedMarginTop
    }
    this.root = next
    this.header = header
    this.viewArea = viewArea
    this.savedMarginLeft = viewArea.style.marginLeft
    this.savedMarginRight = viewArea.style.marginRight
    this.savedMarginTop = viewArea.style.marginTop
    this.observer?.disconnect()
    this.observer.observe(next)
    this.refreshGeom()
    this.applyMargin()
    this.notify()
  },

  refreshGeom() {
    const root = this.root
    const header = this.header
    if (!root || !header) return
    const rr = root.getBoundingClientRect()
    const hr = header.getBoundingClientRect()
    this.geom = { left: rr.left, top: hr.bottom, right: rr.right, bottom: rr.bottom }
  },

  applyMargin() {
    const viewArea = this.viewArea
    const g = this.geom
    const spec = this.spec
    if (!viewArea || !g || !spec) return
    const colW = g.right - g.left
    const rowH = g.bottom - g.top
    const hasLeft = !!spec.left
    const hasTop = !!(spec.top && spec.top.length > 0)
    const chatW = clamp(this.chatW, spec.chatWidth.min, Math.max(spec.chatWidth.min, colW - 60))
    const topH = hasTop
      ? clamp(this.topH, spec.topHeight?.min ?? 80, Math.max(spec.topHeight?.min ?? 80, rowH - BAR_H - 80))
      : 0
    const leftW = hasLeft
      ? clamp(this.leftW, spec.leftWidth?.min ?? 160, Math.max(spec.leftWidth?.min ?? 160, colW - 260))
      : 0
    const chatFull = spec.chatFullHeight === true
    const gap = Math.max(0, colW - chatW) + 'px'
    const mt = (BAR_H + (hasTop && !chatFull ? topH : 0)) + 'px'
    const chatLeft = !hasLeft && spec.chatSide === 'left'
    this.lastMarginLeft = hasLeft ? leftW + 'px' : (chatLeft ? '' : gap)
    this.lastMarginRight = hasLeft ? '' : (chatLeft ? gap : '')
    this.lastMarginTop = mt
    viewArea.style.marginLeft = this.lastMarginLeft
    viewArea.style.marginRight = this.lastMarginRight
    viewArea.style.marginTop = mt
  },

  setChatW(w) {
    const g = this.geom
    const spec = this.spec
    if (!g || !spec) return
    const colW = g.right - g.left
    const main = spec.main ?? []
    const minContent = main.reduce((a, p) => a + p.min, 0) + Math.max(0, main.length - 1) * DIVIDER
    const hi = Math.max(spec.chatWidth.min, colW - minContent)
    this.chatW = clamp(Math.round(w), spec.chatWidth.min, hi)
    this.applyMargin()
    this.persist()
    this.notify()
  },

  setTopH(h) {
    const g = this.geom
    const spec = this.spec
    if (!g || !spec) return
    const rowH = g.bottom - g.top
    const lo = spec.topHeight?.min ?? 80
    const hi = Math.max(lo, rowH - BAR_H - 80)
    this.topH = clamp(Math.round(h), lo, hi)
    this.applyMargin()
    this.persist()
    this.notify()
  },

  setLeftW(w) {
    const g = this.geom
    const spec = this.spec
    if (!g || !spec || !spec.left) return
    const colW = g.right - g.left
    const lo = spec.leftWidth?.min ?? 160
    const hi = Math.max(lo, colW - 260)
    this.leftW = clamp(Math.round(w), lo, hi)
    this.applyMargin()
    this.persist()
    this.notify()
  },

  setPaneW(i, w) {
    const g = this.geom
    const spec = this.spec
    if (!g || !spec) return
    const main = spec.main ?? []
    if (i < 0 || i >= main.length) return
    const colW = g.right - g.left
    const chatW = clamp(this.chatW, spec.chatWidth.min, Math.max(spec.chatWidth.min, colW - 60))
    const contentW = Math.max(0, colW - chatW)
    const othersMin = main.reduce((a, p, k) => a + (k === i ? 0 : p.min), 0)
    const lo = main[i].min
    const hi = Math.max(lo, contentW - othersMin - Math.max(0, main.length - 1) * DIVIDER)
    const next = this.paneWs.slice()
    next[i] = clamp(Math.round(w), lo, hi)
    this.paneWs = next
    this.persist()
    this.notify()
  },

  setTopW(i, w) {
    const g = this.geom
    const spec = this.spec
    if (!g || !spec) return
    const top = spec.top ?? []
    if (i < 0 || i >= top.length) return
    const colW = g.right - g.left
    const othersMin = top.reduce((a, p, k) => a + (k === i ? 0 : p.min), 0)
    const lo = top[i].min
    const hi = Math.max(lo, colW - othersMin - Math.max(0, top.length - 1) * DIVIDER)
    const next = this.topWs.slice()
    next[i] = clamp(Math.round(w), lo, hi)
    this.topWs = next
    this.persist()
    this.notify()
  },

  setPaneContent(row, i, content) {
    const spec = this.spec
    if (!spec) return
    if (row === 'left') {
      if (!spec.left || i !== 0) return
      this.spec = { ...spec, left: { ...spec.left, content } }
      this.onSpecMutated?.(this.spec)
      this.persist()
      this.notify()
      return
    }
    const top = [...(spec.top ?? [])]
    const main = [...spec.main]
    const arr = row === 'top' ? top : main
    if (!arr[i]) return
    arr[i] = { ...arr[i], content }
    this.spec = { ...spec, top: top.length > 0 ? top : null, main }
    this.onSpecMutated?.(this.spec)
    this.persist()
    this.notify()
  },

  swapPanes(aRow, aI, bRow, bI) {
    const spec = this.spec
    if (!spec) return
    const top = [...(spec.top ?? [])]
    const main = [...spec.main]
    const left = spec.left ? { ...spec.left } : null
    const arrOf = (row: PaneRow): SplitPane[] => (row === 'left' ? (left ? [left] : []) : row === 'top' ? top : main)
    const setOf = (row: PaneRow, i: number, pane: SplitPane) => {
      if (row === 'left') spec.left = pane
      else if (row === 'top') top[i] = pane
      else main[i] = pane
    }
    const a = arrOf(aRow)[aI]
    const b = arrOf(bRow)[bI]
    if (!a || !b) return
    setOf(aRow, aI, b)
    setOf(bRow, bI, a)
    const wsOf = (row: PaneRow): number[] => (row === 'left' ? this.leftWs : row === 'top' ? this.topWs : this.paneWs)
    const setWs = (row: PaneRow, i: number, v: number) => {
      if (row === 'left') { const n = this.leftWs.slice(); n[i] = v; this.leftWs = n }
      else if (row === 'top') { const n = this.topWs.slice(); n[i] = v; this.topWs = n }
      else { const n = this.paneWs.slice(); n[i] = v; this.paneWs = n }
    }
    const aW = wsOf(aRow)[aI]
    const bW = wsOf(bRow)[bI]
    setWs(aRow, aI, bW)
    setWs(bRow, bI, aW)
    this.spec = { ...spec, left: left ?? null, top: top.length > 0 ? top : null, main }
    this.onSpecMutated?.(this.spec)
    this.persist()
    this.notify()
  },

  setChatSide(side) {
    const spec = this.spec
    if (!spec) return
    if (spec.left) return // 左列布局：聊天固定右下
    this.spec = { ...spec, chatSide: side }
    this.onSpecMutated?.(this.spec)
    this.applyMargin()
    this.persist()
    this.notify()
  },

  persist() {
    if (!this.spec) return
    persistSaved(this.spec.id, { chatW: this.chatW, topH: this.topH, leftW: this.leftW, paneWs: this.paneWs, topWs: this.topWs, leftWs: this.leftWs })
  },

  close() {
    if (this.viewArea) {
      this.viewArea.style.marginLeft = this.savedMarginLeft
      this.viewArea.style.marginRight = this.savedMarginRight
      this.viewArea.style.marginTop = this.savedMarginTop
    }
    this.observer?.disconnect()
    this.observer = null
    this.fallback?.disconnect()
    this.fallback = null
    this.yieldObserver?.disconnect()
    this.yieldObserver = null
    this.root = null
    this.header = null
    this.viewArea = null
    this.geom = null
    this.spec = null
    this.active = false
    this.notify()
  },

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  },

  notify() {
    for (const fn of this.listeners) fn()
  },
}

/** 分配各窗宽度（最后一个拿余量） */
function allocate(panes: SplitPane[], ws: number[], total: number) {
  const out: { pane: SplitPane; left: number; width: number }[] = []
  const gapTotal = Math.max(0, panes.length - 1) * DIVIDER
  const avail = Math.max(0, total - gapTotal)
  let x = 0
  panes.forEach((p, i) => {
    const w = i === panes.length - 1 ? Math.max(0, avail - x) : ws[i]
    out.push({ pane: p, left: x, width: w })
    x += w + DIVIDER
  })
  return out
}

/** 通用分隔线拖拽（chat/top/pane/topPane） */
function makeDividerHandler(kind: 'left' | 'chat' | 'top' | 'pane' | 'topPane', index?: number) {
  return (e: any) => {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    try { target.setPointerCapture(e.pointerId) } catch {}
    const onMove = (ev: PointerEvent) => {
      const g = splitStore.geom
      if (!g) return
      if (kind === 'left') {
        splitStore.setLeftW(ev.clientX - g.left)
      } else if (kind === 'chat') {
        splitStore.setChatW(g.right - ev.clientX)
      } else if (kind === 'top') {
        splitStore.setTopH(ev.clientY - g.top - BAR_H)
      } else if (kind === 'pane' && index != null) {
        const prefix = splitStore.paneWs.slice(0, index).reduce((a, b) => a + b, 0) + index * DIVIDER
        splitStore.setPaneW(index, ev.clientX - (g.left + prefix))
      } else if (kind === 'topPane' && index != null) {
        const prefix = splitStore.topWs.slice(0, index).reduce((a, b) => a + b, 0) + index * DIVIDER
        splitStore.setTopW(index, ev.clientX - (g.left + prefix))
      }
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }
}

/** 浏览器内置窗：地址栏 + iframe */
function BrowserPane() {
  const [url, setUrl] = useState('https://www.bing.com')
  const [src, setSrc] = useState('https://www.bing.com')
  const go = () => {
    const u = url.trim()
    setSrc(/^(\/|https?:\/\/)/i.test(u) ? u : 'about:blank')
  }
  return (
    <>
      <div className="dsh-wt_browserBar">
        <input
          className="dsh-wt_browserInput"
          value={url}
          placeholder="https://"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go() }}
        />
        <button type="button" className="dsh-wt_browserGo" onClick={go}>↗</button>
      </div>
      <iframe className="dsh-wt_paneFrame" src={src} title="browser" />
    </>
  )
}

/** 资源管理器窗（服务端 /api/worktable/fs） */
function ExplorerPane() {
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<any[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const load = useCallback((p: string, push: boolean) => {
    if (!p) { setError(T('pane.explorerNoCwd')); return }
    setLoading(true)
    postJson('/api/worktable/fs', { path: p })
      .then((d) => {
        setPath(d.path ?? p)
        setEntries(d.entries ?? [])
        setError('')
        setHistory((h) => (push && p !== d.path ? [...h, p] : h))
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    load(splitEnv?.getScope()?.cwd ?? '', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const back = () => {
    setHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      load(prev, false)
      return h.slice(0, -1)
    })
  }
  return (
    <>
      <div className="dsh-wt_subBar">
        <button type="button" className="dsh-wt_subBtn" title="上一级" onClick={() => load(parentPathOf(path), true)}>⬆</button>
        <button type="button" className="dsh-wt_subBtn" title="后退" onClick={back}>↩</button>
        <button type="button" className="dsh-wt_subBtn" title="刷新" onClick={() => load(path, false)}>↻</button>
        <span className="dsh-wt_subPath">{path || '…'}</span>
      </div>
      <div className="dsh-wt_subList">
        {error && <div className="dsh-wt_subEmpty">{error}</div>}
        {!error && !loading && entries.length === 0 && <div className="dsh-wt_subEmpty">—</div>}
        {entries.map((e) => (
          <button
            key={e.path}
            type="button"
            className="dsh-wt_subRow"
            onClick={() => (e.isDir ? load(e.path, true) : setError(T('pane.openLater')))}
          >
            <span className="dsh-wt_subIcon" aria-hidden>{e.isDir ? '📁' : '📄'}</span>
            <span className="dsh-wt_subName">{e.name}</span>
          </button>
        ))}
      </div>
    </>
  )
}

/** 源代码管理窗（服务端 /api/worktable/git） */
function GitPane() {
  const [snap, setSnap] = useState<{ isRepo: boolean; branch?: string; entries: any[] } | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    const cwd = splitEnv?.getScope()?.cwd ?? ''
    if (!cwd) { setError(T('pane.explorerNoCwd')); return }
    postJson('/api/worktable/git', { cwd })
      .then(setSnap)
      .catch((e) => setError(String(e)))
  }, [])
  useEffect(() => { load() }, [load])
  return (
    <>
      <div className="dsh-wt_subBar">
        <button type="button" className="dsh-wt_subBtn" title="刷新" onClick={load}>↻</button>
        <span className="dsh-wt_subPath">{snap?.isRepo ? ('⎇ ' + snap.branch) : ''}</span>
      </div>
      <div className="dsh-wt_subList">
        {error && <div className="dsh-wt_subEmpty">{error}</div>}
        {!error && snap && !snap.isRepo && <div className="dsh-wt_subEmpty">{T('pane.gitNotRepo')}</div>}
        {!error && snap?.isRepo && snap.entries.length === 0 && <div className="dsh-wt_subEmpty">{T('pane.gitClean')}</div>}
        {!error && snap?.isRepo && snap.entries.map((e, i) => (
          <div key={i} className="dsh-wt_subRow dsh-wt_subRowStatic">
            <span className={'dsh-wt_gitXY dsh-wt_gitXY' + (e.xy.includes('A') || e.xy.includes('M') ? 'Mod' : 'New')}>{e.xy.trim()}</span>
            <span className="dsh-wt_subName">{e.path}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/** 任务管理窗（客户端 sessions 快照 jobsBySession；2s 刷新） */
function JobsPane() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 2000)
    return () => window.clearInterval(timer)
  }, [])
  const jobs = splitEnv?.getJobs?.() ?? []
  return (
    <div className="dsh-wt_subList">
      {jobs.length === 0 && <div className="dsh-wt_subEmpty">{T('pane.jobsEmpty')}</div>}
      {jobs.map((j) => (
        <div key={j.id} className="dsh-wt_subRow dsh-wt_subRowStatic">
          <span className={'dsh-wt_jobDot dsh-wt_jobDot-' + j.status} aria-hidden>●</span>
          <span className="dsh-wt_subName">{j.label}</span>
          <span className="dsh-wt_subTag">{j.kind}</span>
        </div>
      ))}
    </div>
  )
}

/** 终端窗（WS /api/worktable/term + node-pty） */
function TerminalPane() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState('')
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let term: any = null
    let ws: WebSocket | null = null
    let disposed = false
    try {
      term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: 12,
        convertEol: true,
        theme: { background: '#010409' },
      })
    } catch {
      setFailed(T('pane.termFail'))
      return
    }
    term.open(el)
    const scope = splitEnv?.getScope?.()
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = proto + '//' + location.host + '/api/worktable/term?cwd=' + encodeURIComponent(scope?.cwd ?? '') + '&cols=80&rows=24'
    try {
      ws = new WebSocket(url)
    } catch {
      term.dispose()
      setFailed(T('pane.termFail'))
      return
    }
    ws.onmessage = (ev) => { try { term.write(String(ev.data)) } catch {} }
    ws.onclose = () => { if (!disposed) { try { term.write('\r\n[连接已关闭]') } catch {} } }
    ws.onerror = () => { if (!disposed) setFailed(T('pane.termFail')) }
    term.onData((d: string) => { if (ws && ws.readyState === 1) ws.send(d) })
    const ro = new ResizeObserver(() => {
      if (typeof term.fit === 'function') {
        try { term.fit() } catch {}
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    })
    ro.observe(el)
    return () => {
      disposed = true
      ro.disconnect()
      try { ws?.close() } catch {}
      try { term.dispose() } catch {}
    }
  }, [])
  if (failed) {
    return <div className="dsh-wt_paneWip"><span className="dsh-wt_paneWipText">{failed}</span></div>
  }
  return <div ref={hostRef} className="dsh-wt_termHost" />
}

/** 窗内容三态渲染 */
function PaneBody(props: { pane: SplitPane; row: PaneRow; index: number }) {
  const { pane, row, index } = props
  const content = pane.content
  if (content && content.kind === 'iframe') {
    return <iframe className="dsh-wt_paneFrame" src={content.url} title={pane.title} />
  }
  if (content && content.kind === 'builtin') {
    if (content.type === 'browser') return <BrowserPane />
    if (content.type === 'explorer') return <ExplorerPane />
    if (content.type === 'scm') return <GitPane />
    if (content.type === 'tasks') return <JobsPane />
    if (content.type === 'terminal') return <TerminalPane />
    return (
      <div className="dsh-wt_paneWip">
        <span className="dsh-wt_paneWipIcon" aria-hidden>{BUILTIN_ICONS[content.type]}</span>
        <span className="dsh-wt_paneWipText">{T('pane.wip')}</span>
      </div>
    )
  }
  return <PanePicker row={row} index={index} />
}

/** 未指派内容：6 选 1 选择器（better-sidebar 风格 5 项 + 自定义） */
function PanePicker(props: { row: PaneRow; index: number }) {
  const [custom, setCustom] = useState(false)
  const [url, setUrl] = useState('')
  const pick = (content: SplitContent) => splitStore.setPaneContent(props.row, props.index, content)
  const applyCustom = () => {
    const u = url.trim()
    if (/^(\/|https?:\/\/)/i.test(u)) pick({ kind: 'iframe', url: u })
  }
  if (custom) {
    return (
      <div className="dsh-wt_paneCustom">
        <input
          autoFocus
          type="text"
          placeholder={T('pane.customUrlPh')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyCustom() }}
        />
        <button type="button" className="dsh-wt_paneCustomGo" onClick={applyCustom}>{T('pane.open')}</button>
      </div>
    )
  }
  return (
    <div className="dsh-wt_panePicker">
      <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'browser' })}>
        <span aria-hidden>🌐</span>{T('pane.browser')}
      </button>
      <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'explorer' })}>
        <span aria-hidden>📁</span>{T('pane.explorer')}
      </button>
      <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'scm' })}>
        <span aria-hidden>🔀</span>{T('pane.scm')}
      </button>
      <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'tasks' })}>
        <span aria-hidden>✅</span>{T('pane.tasks')}
      </button>
      <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'terminal' })}>
        <span aria-hidden>▸_</span>{T('pane.terminal')}
      </button>
      <button type="button" className="dsh-wt_panePick" onClick={() => setCustom(true)}>
        <span aria-hidden>✨</span>{T('pane.custom')}
      </button>
    </div>
  )
}

/** 分栏工作区浮层（shell.overlay 座位；订阅 splitStore 快照渲染） */
function SplitWorkspace() {
  const [snap, setSnap] = useState({
    active: splitStore.active,
    spec: splitStore.spec,
    geom: splitStore.geom,
    chatW: splitStore.chatW,
    topH: splitStore.topH,
    paneWs: [...splitStore.paneWs],
    topWs: [...splitStore.topWs],
  })

  useEffect(() => splitStore.subscribe(() => {
    setSnap({
      active: splitStore.active,
      spec: splitStore.spec,
      geom: splitStore.geom,
      chatW: splitStore.chatW,
      topH: splitStore.topH,
      paneWs: [...splitStore.paneWs],
      topWs: [...splitStore.topWs],
    })
  }), [])

  useEffect(() => {
    if (!snap.active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') splitStore.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [snap.active])

  if (!snap.active || !snap.spec || !snap.geom) return null
  const g = snap.geom
  const spec = snap.spec
  const top = spec.top ?? []
  const main = spec.main ?? []
  const hasLeft = !!spec.left
  const hasTop = top.length > 0
  const chatLeft = !hasLeft && spec.chatSide === 'left'
  const colW = g.right - g.left
  const rowH = g.bottom - g.top
  const chatW = clamp(snap.chatW, spec.chatWidth.min, Math.max(spec.chatWidth.min, colW - 60))
  const topH = hasTop
    ? clamp(snap.topH, spec.topHeight?.min ?? 80, Math.max(spec.topHeight?.min ?? 80, rowH - BAR_H - 80))
    : 0
  const leftW = hasLeft
    ? clamp(snap.leftW, spec.leftWidth?.min ?? 160, Math.max(spec.leftWidth?.min ?? 160, colW - 260))
    : 0
  const chatFull = spec.chatFullHeight === true
  const contentW = Math.max(0, colW - chatW)
  const contentX = hasLeft ? g.left + leftW : (chatLeft ? g.left + chatW : g.left)
  const topRowX = hasLeft ? g.left + leftW : contentX
  const topRowW = hasLeft ? Math.max(0, colW - leftW) : (chatFull ? contentW : colW)

  const topItems = allocate(top, snap.topWs, topRowW)
  const mainItems = allocate(main, snap.paneWs, contentW)
  const leftItem = spec.left ? { pane: spec.left, left: 0, width: leftW } : null

  const barTop = g.top
  const bodyTop = barTop + BAR_H + topH
  const paneBottom = g.bottom
  const mainH = paneBottom - bodyTop
  const topY = barTop + BAR_H

  const renderPane = (it: { pane: SplitPane; left: number; width: number }, row: PaneRow, index: number, x: number, y: number, h: number) => (
    <div key={it.pane.id} className="dsh-wt_pane" style={{ position: 'fixed', left: x + it.left, top: y, width: it.width, height: h, zIndex: 68 }}>
      <div
        className="dsh-wt_paneBar"
        title={T('split.dragSwap')}
        draggable
        onDragStart={(e: any) => { dragPane = { row, index }; try { e.dataTransfer.effectAllowed = 'move' } catch {} }}
        onDragOver={(e: any) => e.preventDefault()}
        onDrop={(e: any) => {
          e.preventDefault()
          const s = dragPane
          if (s && (s.row !== row || s.index !== index)) splitStore.swapPanes(s.row, s.index, row, index)
          dragPane = null
        }}
        onDragEnd={() => { dragPane = null }}
      >
        <span className="dsh-wt_paneTitle">{it.pane.title}</span>
      </div>
      <PaneBody pane={it.pane} row={row} index={index} />
    </div>
  )

  return (
    <>
      {/* 标题栏 */}
      <div className="dsh-wt_splitBar" style={{ position: 'fixed', left: g.left, top: barTop, width: hasLeft || chatFull ? contentW : (hasTop ? colW : contentW), zIndex: 70 }}>
        <span className="dsh-wt_splitTitle">{spec.title}</span>
        {!hasLeft && (
          <button
            type="button"
            className="dsh-wt_splitFlip"
            title={T('split.flip')}
            onClick={() => splitStore.setChatSide(chatLeft ? 'right' : 'left')}
          >⇄</button>
        )}
        <button type="button" className="dsh-wt_splitClose" aria-label="退出分栏（Esc）" onClick={() => splitStore.close()}>✕</button>
      </div>
      {/* 左列整高内容窗 */}
      {leftItem && renderPane(leftItem, 'left', 0, g.left, barTop + BAR_H, g.bottom - barTop - BAR_H)}
      {/* 顶部通栏行（左列布局时为右侧列顶行） */}
      {hasTop && topItems.map((it, i) => renderPane(it, 'top', i, topRowX, topY, topH))}
      {/* 主行内容窗 */}
      {mainItems.map((it, i) => renderPane(it, 'main', i, contentX, bodyTop, mainH))}
      {/* 顶部/主行水平分隔线 */}
      {hasTop && (
        <div
          className="dsh-wt_splitDivider dsh-wt_splitDividerH"
          role="separator"
          title="拖动调整上下分区"
          style={{ position: 'fixed', left: topRowX, top: bodyTop - DIVIDER / 2, width: topRowW, height: DIVIDER, zIndex: 72 }}
          onPointerDown={makeDividerHandler('top')}
        />
      )}
      {/* 顶部行内垂直分隔线 */}
      {hasTop && topItems.slice(0, -1).map((it, i) => (
        <div
          key={'tv' + it.pane.id}
          className="dsh-wt_splitDivider"
          role="separator"
          title="拖动调整宽度"
          style={{ position: 'fixed', left: topRowX + it.left + it.width + DIVIDER / 2, top: topY, width: DIVIDER, height: topH, zIndex: 72 }}
          onPointerDown={makeDividerHandler('topPane', i)}
        />
      ))}
      {/* 主行内容窗垂直分隔线 */}
      {mainItems.slice(0, -1).map((it, i) => (
        <div
          key={'v' + it.pane.id}
          className="dsh-wt_splitDivider"
          role="separator"
          title="拖动调整宽度"
          style={{ position: 'fixed', left: contentX + it.left + it.width + DIVIDER / 2, top: bodyTop, width: DIVIDER, height: mainH, zIndex: 72 }}
          onPointerDown={makeDividerHandler('pane', i)}
        />
      ))}
      {/* 聊天分隔线（左列布局 = 左/右列边界；其余 = 内容与聊天之间） */}
      <div
        className="dsh-wt_splitDivider"
        role="separator"
        title={hasLeft ? '拖动调整左右列宽' : '拖动调整聊天宽度'}
        style={{
          position: 'fixed',
          left: (hasLeft ? g.left + leftW : (chatLeft ? g.left + chatW : g.right - chatW)) - DIVIDER / 2,
          top: hasLeft || chatFull ? barTop + BAR_H : bodyTop,
          width: DIVIDER,
          height: hasLeft || chatFull ? g.bottom - barTop - BAR_H : mainH,
          zIndex: 72,
        }}
        onPointerDown={makeDividerHandler(hasLeft ? 'left' : 'chat')}
      />
    </>
  )
}

export { SplitWorkspace }
