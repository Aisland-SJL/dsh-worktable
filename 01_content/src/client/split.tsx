import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import 'xterm/css/xterm.css'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import hljsTypescript from 'highlight.js/lib/languages/typescript'
import hljsJavascript from 'highlight.js/lib/languages/javascript'
import hljsCss from 'highlight.js/lib/languages/css'
import hljsJson from 'highlight.js/lib/languages/json'

hljs.registerLanguage('typescript', hljsTypescript)
hljs.registerLanguage('javascript', hljsJavascript)
hljs.registerLanguage('css', hljsCss)
hljs.registerLanguage('json', hljsJson)

/**
 * dsh-worktable 乐高式工作区 M1：通用分栏引擎（PRD §13）。
 * 布局模型：标题栏 + 顶部通栏行(可选) + 主行内容窗 + 聊天窗（官方会话视图区整体，
 * 贴右或贴左，由 chatSide 决定；marginLeft/marginRight + marginTop 组合挤法）。
 * 内容三态：null（未指派 → 6 选 1 选择器）/ iframe / builtin（浏览器/资源管理器/SCM/任务/终端）。
 * 窗位调整：标题栏拖拽换位（同行或跨行）；工具栏 ⇄ 切换聊天窗左右。
 * 会话切换重新锚定不关闭；宽度按 layoutId 持久化 dsh.worktable.split.v2；
 * 内容与 chatSide 的变更经 onSpecMutated 回调交给工作台持久化（布局条目）。
 */

export type BuiltinType = 'browser' | 'explorer' | 'scm' | 'tasks' | 'terminal'

export type SplitContent =
  | { kind: 'iframe'; url: string; title?: string }
  | { kind: 'builtin'; type: BuiltinType }
  | { kind: 'file'; path: string }

/** 一个内容标签页 */
export type PaneTab = { id: string; title: string; content: SplitContent }

export type SplitPane = {
  id: string
  title: string
  min: number
  /** 向后兼容：单内容声明（打开时归一化为一个标签页） */
  content?: SplitContent | null
  /** 标签页模型：内容标签列表（空 = 未指派，显示 6 选 1 选择器） */
  tabs?: PaneTab[]
  /** 激活的标签下标 */
  active?: number
}

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
  /** 布局条目图标（emoji；工作台侧栏展示，点击可换） */
  icon?: string
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
  openTab(row: PaneRow, i: number, content: SplitContent): void
  closeTab(row: PaneRow, i: number, tabId: string): void
  setActiveTab(row: PaneRow, i: number, tabId: string): void
  moveTab(fromRow: PaneRow, fromI: number, tabId: string, toRow: PaneRow, toI: number): void
  swapPanes(aRow: PaneRow, aI: number, bRow: PaneRow, bI: number): void
  setChatSide(side: 'left' | 'right'): void
  persist(): void
  subscribe(fn: () => void): () => void
  notify(): void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const DIVIDER = 6
const BAR_H = 26
const PERSIST_KEY = 'dsh.worktable.split.v2'

/** 内置内容窗图标 */
const BUILTIN_ICONS: Record<BuiltinType, string> = {
  browser: '🌐',
  explorer: '📁',
  scm: '🔀',
  tasks: '✅',
  terminal: '▸_',
}

const BUILTIN_LABEL_KEYS: Record<BuiltinType, string> = {
  browser: 'pane.browser',
  explorer: 'pane.explorer',
  scm: 'pane.scm',
  tasks: 'pane.tasks',
  terminal: 'pane.terminal',
}

function tabTitleOf(content: SplitContent): string {
  if (content.kind === 'builtin') return T(BUILTIN_LABEL_KEYS[content.type])
  if (content.kind === 'file') return basenameOf(content.path)
  if (content.kind === 'iframe' && content.title) return content.title
  try {
    const u = new URL(content.url)
    return u.hostname || content.url
  } catch {
    return content.url
  }
}

/** 取路径最后一段作为标签标题 */
function basenameOf(p: string): string {
  const parts = String(p).replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || String(p)
}

/** 内容同一性（openTab 去重：同窗内同内容只保留一个标签，再次打开切过去） */
function sameContent(a: SplitContent, b: SplitContent): boolean {
  if (a.kind === 'iframe' && b.kind === 'iframe') return a.url === b.url
  if (a.kind === 'file' && b.kind === 'file') return a.path === b.path
  if (a.kind === 'builtin' && b.kind === 'builtin') return a.type === b.type
  return false
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
  getSubagents: () => any[]
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
/** 标签拖拽暂存（跨窗移动） */
let dragTab: { row: PaneRow; index: number; tabId: string } | null = null
/** 标签拖放目标（吸附高亮；模块级，PaneBody 与窗容器共用） */
let dropTarget: { row: PaneRow; index: number } | null = null
let dropTargetListeners: Set<() => void> = new Set()
function setDropTarget(t: { row: PaneRow; index: number } | null) {
  if (dropTarget === t) return
  dropTarget = t
  for (const fn of dropTargetListeners) fn()
}

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
    // 跨插件互操作桥：自带分栏实现的入驻插件（未接入共享引擎）打开时，运行时点击其关闭按钮让位
    try {
      const taClose = document.querySelector<HTMLElement>('.ta_splitClose')
      taClose?.click()
    } catch {}
    // 声明占用：接入共享协议的其他引擎收到后让位
    try {
      window.dispatchEvent(new CustomEvent('dsh:split-claim', { detail: { id: spec.id } }))
    } catch {}
    const root = findConversationRoot()
    if (!root) return false
    const header = root.children[0] as HTMLElement | undefined
    const viewArea = root.children[1] as HTMLElement | undefined
    if (!header || !viewArea) return false
    this.spec = { ...spec, chatSide: spec.chatSide === 'left' ? 'left' : 'right' }
    // 向后兼容归一化：单内容声明 → 一个标签页
    const normalize = (p: SplitPane): SplitPane => {
      if (p.tabs && p.tabs.length > 0) return p
      if (p.content) {
        return { ...p, content: null, tabs: [{ id: 't1', title: tabTitleOf(p.content), content: p.content }], active: 0 }
      }
      return { ...p, content: null, tabs: [], active: 0 }
    }
    if (spec.top) this.spec.top = spec.top.map(normalize)
    if (spec.left) this.spec.left = normalize(spec.left)
    this.spec.main = (spec.main ?? []).map(normalize)
    const main = this.spec.main ?? []
    const top = spec.top ?? []
    const left = spec.left ?? null
    const saved = loadSaved(spec.id)
    const hasChatW = !!saved && saved.chatW >= 0
    const hasTopH = !!saved && saved.topH >= 0
    const hasLeftW = !!saved && saved.leftW >= 0
    const hasPaneWs = !!saved && saved.paneWs.length === main.length
    const hasTopWs = !!saved && saved.topWs.length === top.length
    const hasLeftWs = !!saved && saved.leftWs.length === (left ? 1 : 0)
    this.chatW = hasChatW ? saved!.chatW : spec.chatWidth.default
    this.topH = hasTopH ? saved!.topH : (spec.topHeight?.default ?? 200)
    this.leftW = hasLeftW ? saved!.leftW : (spec.leftWidth?.default ?? 260)
    this.paneWs = hasPaneWs ? [...saved!.paneWs] : main.map((p) => p.min)
    this.topWs = hasTopWs ? [...saved!.topWs] : top.map((p) => p.min)
    this.leftWs = hasLeftWs ? [...saved!.leftWs] : (left ? [left.min] : [])
    this.root = root
    this.header = header
    this.viewArea = viewArea
    this.savedMarginLeft = viewArea.style.marginLeft
    this.savedMarginRight = viewArea.style.marginRight
    this.savedMarginTop = viewArea.style.marginTop
    this.refreshGeom()
    // 均衡默认：无存档尺寸时按当前可用空间比例分配，
    // 不再出现“其余窗全部贴 min、最后一个吃掉全部余量”的悬殊观感。
    const g0 = this.geom
    if (g0) {
      const colW0 = g0.right - g0.left
      const rowH0 = g0.bottom - g0.top
      if (!hasChatW) {
        const hi = Math.max(spec.chatWidth.min, colW0 - 60)
        this.chatW = clamp(Math.round(colW0 * 0.3), spec.chatWidth.min, hi)
      }
      if (left && !hasLeftW) {
        const lo = spec.leftWidth?.min ?? 160
        this.leftW = clamp(Math.round(colW0 * 0.38), lo, Math.max(lo, colW0 - 260))
      }
      if (top.length > 0 && !hasTopH) {
        const lo = spec.topHeight?.min ?? 80
        this.topH = clamp(Math.round(rowH0 * 0.35), lo, Math.max(lo, rowH0 - BAR_H - 80))
      }
      if (!hasPaneWs) {
        const contentW = Math.max(0, colW0 - this.chatW)
        const avail = Math.max(main.length * 120, contentW - Math.max(0, main.length - 1) * DIVIDER)
        const share = Math.round(avail / main.length)
        this.paneWs = main.map((p) => Math.max(p.min, share))
      }
      if (!hasTopWs) {
        const rowW = Math.max(0, colW0 - (left ? this.leftW : 0))
        const avail = Math.max(top.length * 120, rowW - Math.max(0, top.length - 1) * DIVIDER)
        const share = Math.round(avail / top.length)
        this.topWs = top.map((p) => Math.max(p.min, share))
      }
      if (left && !hasLeftWs) this.leftWs = [Math.max(left.min, this.leftW)]
    }
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
    if (content) this.openTab(row, i, content)
  },

  openTab(row, i, content) {
    const spec = this.spec
    if (!spec) return
    const mutate = (pane: SplitPane): SplitPane => {
      const tabs = [...(pane.tabs ?? [])]
      // 去重：同内容已有标签 → 直接激活
      const existing = tabs.findIndex((t) => sameContent(t.content, content))
      if (existing >= 0) return { ...pane, content: null, tabs, active: existing }
      const tab: PaneTab = { id: 't' + Date.now().toString(36), title: tabTitleOf(content), content }
      tabs.push(tab)
      return { ...pane, content: null, tabs, active: tabs.length - 1 }
    }
    if (row === 'left') {
      if (!spec.left || i !== 0) return
      this.spec = { ...spec, left: mutate(spec.left) }
    } else if (row === 'top') {
      const top = [...(spec.top ?? [])]
      if (!top[i]) return
      top[i] = mutate(top[i])
      this.spec = { ...spec, top }
    } else {
      const main = [...spec.main]
      if (!main[i]) return
      main[i] = mutate(main[i])
      this.spec = { ...spec, main }
    }
    this.onSpecMutated?.(this.spec)
    this.persist()
    this.notify()
  },

  closeTab(row, i, tabId) {
    const spec = this.spec
    if (!spec) return
    const mutate = (pane: SplitPane): SplitPane => {
      const tabs = (pane.tabs ?? []).filter((t) => t.id !== tabId)
      return { ...pane, tabs, active: 0 }
    }
    if (row === 'left') {
      if (!spec.left || i !== 0) return
      this.spec = { ...spec, left: mutate(spec.left) }
    } else if (row === 'top') {
      const top = [...(spec.top ?? [])]
      if (!top[i]) return
      top[i] = mutate(top[i])
      this.spec = { ...spec, top }
    } else {
      const main = [...spec.main]
      if (!main[i]) return
      main[i] = mutate(main[i])
      this.spec = { ...spec, main }
    }
    this.onSpecMutated?.(this.spec)
    this.persist()
    this.notify()
  },

  moveTab(fromRow, fromI, tabId, toRow, toI) {
    const spec = this.spec
    if (!spec) return
    if (fromRow === toRow && fromI === toI) return
    const top = [...(spec.top ?? [])]
    const main = [...spec.main]
    const left = spec.left ? { ...spec.left } : null
    const arrOf = (row: PaneRow): SplitPane[] => (row === 'left' ? (left ? [left] : []) : row === 'top' ? top : main)
    const fromArr = arrOf(fromRow)
    const toArr = arrOf(toRow)
    const fromPane = fromArr[fromI]
    const toPane = toArr[toI]
    if (!fromPane || !toPane) return
    const tab = (fromPane.tabs ?? []).find((t) => t.id === tabId)
    if (!tab) return
    const fromTabs = (fromPane.tabs ?? []).filter((t) => t.id !== tabId)
    const toTabs = [...(toPane.tabs ?? []), tab]
    const setPane = (row: PaneRow, i: number, pane: SplitPane) => {
      if (row === 'left') spec.left = pane
      else if (row === 'top') top[i] = pane
      else main[i] = pane
    }
    setPane(fromRow, fromI, { ...fromPane, tabs: fromTabs, active: 0 })
    setPane(toRow, toI, { ...toPane, tabs: toTabs, active: toTabs.length - 1 })
    this.spec = { ...spec, left: left ?? null, top: top.length > 0 ? top : null, main }
    this.onSpecMutated?.(this.spec)
    this.persist()
    this.notify()
  },

  setActiveTab(row, i, tabId) {
    const spec = this.spec
    if (!spec) return
    const mutate = (pane: SplitPane): SplitPane => {
      const idx = (pane.tabs ?? []).findIndex((t) => t.id === tabId)
      if (idx < 0) return pane
      return { ...pane, active: idx }
    }
    if (row === 'left') {
      if (!spec.left || i !== 0) return
      this.spec = { ...spec, left: mutate(spec.left) }
    } else if (row === 'top') {
      const top = [...(spec.top ?? [])]
      if (!top[i]) return
      top[i] = mutate(top[i])
      this.spec = { ...spec, top }
    } else {
      const main = [...spec.main]
      if (!main[i]) return
      main[i] = mutate(main[i])
      this.spec = { ...spec, main }
    }
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

/** 跨插件互操作桥：自带分栏实现的插件其浮层（.ta_split）出现 = 其引擎打开 → 本引擎让位。
 * 不改动对方插件代码，仅在 DOM 层观察其浮层挂载。 */
if (typeof document !== 'undefined' && document.body) {
  const taObserver = new MutationObserver(() => {
    if (!splitStore.active) return
    if (document.querySelector('.ta_split')) splitStore.close()
  })
  taObserver.observe(document.body, { childList: true, subtree: true })
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
  const [url, setUrl] = useState('https://example.com')
  const [src, setSrc] = useState('https://example.com')
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

/** 文件夹图标（重绘 SVG，与 better-sidebar 同款风格） */
function FolderIcon() {
  return (
    <svg className="dsh-wt_treeIcon" width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M1.75 3.25A1.75 1.75 0 0 1 3.5 1.5h2.63a1.75 1.75 0 0 1 1.34.66l.62.79a1.75 1.75 0 0 0 1.34.66H12.5a1.75 1.75 0 0 1 1.75 1.75v7.39A1.75 1.75 0 0 1 12.5 14.5h-9a1.75 1.75 0 0 1-1.75-1.75V3.25Z" fill="var(--dsw-alias-state-accent-primary,#4f8ef7)" opacity="0.9" />
      <path d="M1.75 5.75h12.5v7a1.75 1.75 0 0 1-1.75 1.75h-9a1.75 1.75 0 0 1-1.75-1.75v-7Z" fill="var(--dsw-alias-state-accent-primary,#4f8ef7)" opacity="0.4" />
    </svg>
  )
}

/** 文件图标（重绘 SVG） */
function FileIcon() {
  return (
    <svg className="dsh-wt_treeIcon" width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M4 1.5h5.25a1 1 0 0 1 .71.29l3.25 3.25a1 1 0 0 1 .29.71V13.5a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z" fill="var(--dsw-alias-fill-l1,rgba(255,255,255,.06))" stroke="var(--dsw-alias-label-secondary,#9aa4b2)" strokeWidth="1.1" />
      <path d="M9.25 1.5V4.75h3.25" fill="none" stroke="var(--dsw-alias-label-secondary,#9aa4b2)" strokeWidth="1.1" />
    </svg>
  )
}

/** 资源管理器窗：树形展开（懒加载子目录；刷新/上一级均可用；.html 点击开浏览器标签） */
function ExplorerPane(props: { row: PaneRow; index: number }) {
  const cacheRef = useRef<Record<string, any[]>>({})
  const expandedRef = useRef<Set<string>>(new Set())
  const [rootPath, setRootPath] = useState('')
  const [error, setError] = useState('')
  const [, setTick] = useState(0)
  const rerender = () => setTick((t) => t + 1)

  const fetchDir = useCallback(async (path: string, force = false) => {
    if (!force && cacheRef.current[path]) return { path, entries: cacheRef.current[path] }
    try {
      const d = await postJson('/api/worktable/fs', {
        path,
        sessionId: splitEnv?.getScope()?.sessionId ?? '',
        cwd: splitEnv?.getScope()?.cwd ?? '',
      })
      const entries: any[] = d.entries ?? []
      cacheRef.current[d.path] = entries
      setError(d.error ? String(d.error) : '')
      return { path: d.path, entries }
    } catch (e) {
      setError(String(e))
      return { path, entries: [] }
    } finally {
      rerender()
    }
  }, [])

  const initRoot = useCallback(async () => {
    const r = await fetchDir(splitEnv?.getScope()?.cwd ?? '')
    setRootPath(r.path)
    rerender()
  }, [fetchDir])

  useEffect(() => { initRoot() }, [initRoot])

  const toggle = (path: string) => {
    if (expandedRef.current.has(path)) expandedRef.current.delete(path)
    else { expandedRef.current.add(path); fetchDir(path) }
    rerender()
  }

  const refresh = () => {
    cacheRef.current = {}
    expandedRef.current.clear()
    setError('')
    initRoot()
  }

  const goUp = () => {
    if (!rootPath) return
    const parent = parentPathOf(rootPath)
    if (parent === rootPath) return
    cacheRef.current = {}
    expandedRef.current.clear()
    setError('')
    fetchDir(parent).then((r) => { setRootPath(r.path); rerender() })
  }

  const renderLevel = (path: string, depth: number): any[] => {
    const entries = cacheRef.current[path]
    if (!entries) return []
    const nodes: any[] = []
    for (const e of entries) {
      const isOpen = expandedRef.current.has(e.path)
      nodes.push(
        <div key={e.path}>
          <button
            type="button"
            className="dsh-wt_treeRow"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => {
              if (e.isDir) { toggle(e.path); return }
              if (/\.html?$/i.test(e.name)) {
                // 目录级静态托管：相对引用（./assets/...）在所在目录下解析，页面可完整渲染
                const dir = parentPathOf(e.path)
                splitStore.openTab(props.row, props.index, {
                  kind: 'iframe',
                  url: '/api/worktable/site/' + encodeURIComponent(dir) + '/' + encodeURIComponent(e.name),
                  title: e.name,
                })
              } else if (/\.(md|markdown|mdown|txt|log|tsx|ts|jsx|js|css|json|pdf|png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(e.name)) {
                splitStore.openTab(props.row, props.index, { kind: 'file', path: e.path })
              } else {
                setError(T('pane.openLater'))
              }
            }}
          >
            <span className={'dsh-wt_treeArrow' + (e.isDir && isOpen ? ' dsh-wt_treeArrowOpen' : '')} aria-hidden>{e.isDir ? '▸' : ''}</span>
            {e.isDir ? <FolderIcon /> : <FileIcon />}
            <span className="dsh-wt_treeName">{e.name}</span>
          </button>
          {e.isDir && isOpen && renderLevel(e.path, depth + 1)}
        </div>,
      )
    }
    return nodes
  }

  return (
    <>
      <div className="dsh-wt_subBar">
        <button type="button" className="dsh-wt_subBtn" title="上一级" onClick={goUp}>⬆</button>
        <button type="button" className="dsh-wt_subBtn" title="刷新" onClick={refresh}>↻</button>
        <span className="dsh-wt_subPath">{rootPath || '…'}</span>
      </div>
      <div className="dsh-wt_subList">
        {error && <div className="dsh-wt_subEmpty">{error}</div>}
        {!error && cacheRef.current[rootPath]?.length === 0 && <div className="dsh-wt_subEmpty">—</div>}
        {renderLevel(rootPath, 0)}
      </div>
    </>
  )
}

/** 源代码管理窗（服务端 /api/worktable/git） */
function GitPane() {
  const [snap, setSnap] = useState<{ isRepo: boolean; branch?: string; entries: any[] } | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    postJson('/api/worktable/git', {
      sessionId: splitEnv?.getScope()?.sessionId ?? '',
      cwd: splitEnv?.getScope()?.cwd ?? '',
    })
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

/** 任务管理窗：后台任务 + 子代理（Agent 情况；2s 刷新） */
function JobsPane() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 2000)
    return () => window.clearInterval(timer)
  }, [])
  const jobs = splitEnv?.getJobs?.() ?? []
  const subagents = splitEnv?.getSubagents?.() ?? []
  return (
    <div className="dsh-wt_subList">
      <div className="dsh-wt_subSection">{T('pane.jobsTitle')}</div>
      {jobs.length === 0 && <div className="dsh-wt_subEmpty">{T('pane.jobsEmpty')}</div>}
      {jobs.map((j) => (
        <div key={j.id} className="dsh-wt_subRow dsh-wt_subRowStatic">
          <span className={'dsh-wt_jobDot dsh-wt_jobDot-' + j.status} aria-hidden>●</span>
          <span className="dsh-wt_subName">{j.label}</span>
          <span className="dsh-wt_subTag">{j.kind}</span>
        </div>
      ))}
      <div className="dsh-wt_subSection">{T('pane.subagents')}</div>
      {subagents.length === 0 && <div className="dsh-wt_subEmpty">{T('pane.subagentsEmpty')}</div>}
      {subagents.map((s: any, i: number) => (
        <div key={s?.id ?? i} className="dsh-wt_subRow dsh-wt_subRowStatic" style={{ paddingLeft: 8 + (s?.depth ?? 0) * 12 }}>
          <span className={'dsh-wt_jobDot dsh-wt_jobDot-' + (s?.status ?? 'stopping')} aria-hidden>●</span>
          <span className="dsh-wt_subName">{s?.label ?? s?.title ?? s?.name ?? '—'}</span>
          {s?.status && <span className="dsh-wt_subTag">{s.status}</span>}
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
    const focusTerm = () => { try { term.focus() } catch {} }
    focusTerm()
    el.addEventListener('pointerdown', focusTerm)
    const scope = splitEnv?.getScope?.()
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = proto + '//' + location.host + '/api/worktable/term?sessionId=' + encodeURIComponent(scope?.sessionId ?? '') + '&cwd=' + encodeURIComponent(scope?.cwd ?? '') + '&cols=80&rows=24'
    try {
      ws = new WebSocket(url)
    } catch {
      term.dispose()
      setFailed(T('pane.termFail'))
      return
    }
    ws.onopen = () => { focusTerm() }
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

const mdRenderer = new MarkdownIt({ linkify: true })

const IMAGE_EXTS = /[.](png|jpe?g|gif|webp|svg|bmp|ico)$/i
const MD_EXTS = /[.](md|markdown|mdown)$/i

/** 本地文件预览：PDF 走原生 iframe（Chrome 内置阅读器）、图片居中、MD 渲染、其余纯文本 */
function FileViewer(props: { path: string }) {
  const ext = (props.path.split('.').pop() || '').toLowerCase()
  const fileUrl = '/api/worktable/file?path=' + encodeURIComponent(props.path)
  if (ext === 'pdf') {
    return <iframe className="dsh-wt_paneFrame" src={fileUrl} title={basenameOf(props.path)} />
  }
  if (IMAGE_EXTS.test('.' + ext)) {
    return (
      <div className="dsh-wt_imgView">
        <img src={fileUrl} alt={basenameOf(props.path)} />
      </div>
    )
  }
  return <TextViewer path={props.path} fileUrl={fileUrl} isMd={MD_EXTS.test('.' + ext)} />
}

/** 代码文件语言映射（预览语法着色） */
const CODE_LANGS: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', css: 'css', json: 'json' }
const CODE_EXTS = /[.](tsx|ts|jsx|js|css|json)$/i

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function codeHtml(text: string, ext: string): string {
  const lang = CODE_LANGS[ext] ?? ''
  if (lang) {
    try { return hljs.highlight(text, { language: lang }).value } catch { return escapeHtml(text) }
  }
  return escapeHtml(text)
}

/** 文本预览（fetch 原文 → MD 渲染 / 代码高亮 / <pre> 等宽展示）；全部文本类型支持编辑/预览切换并可保存回磁盘 */
function TextViewer(props: { path: string; fileUrl: string; isMd: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveFail, setSaveFail] = useState(false)
  useEffect(() => {
    let dead = false
    setText(null)
    setError('')
    fetch(props.fileUrl)
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.text()
      })
      .then((t) => { if (!dead) setText(t) })
      .catch((e) => { if (!dead) setError(String(e)) })
    return () => { dead = true }
  }, [props.fileUrl])
  const enterEdit = () => { setDraft(text ?? ''); setSaveFail(false); setMode('edit') }
  const save = async () => {
    setSaving(true)
    setSaveFail(false)
    try {
      const r = await fetch('/api/worktable/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: props.path, content: draft }),
      })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      setText(draft)
      setMode('preview')
    } catch {
      setSaveFail(true)
    } finally {
      setSaving(false)
    }
  }
  if (error) {
    return <div className="dsh-wt_paneWip"><span className="dsh-wt_paneWipText">{T('file.fail')}：{error}</span></div>
  }
  if (text == null) {
    return <div className="dsh-wt_paneWip"><span className="dsh-wt_paneWipText">{T('file.loading')}</span></div>
  }
  const ext = (props.path.split('.').pop() || '').toLowerCase()
  const isCode = CODE_EXTS.test('.' + ext)
  return (
    <>
      <div className="dsh-wt_mdBar">
        <button type="button" className={'dsh-wt_mdBtn' + (mode === 'preview' ? ' dsh-wt_mdBtnOn' : '')} onClick={() => setMode('preview')}>{T('file.preview')}</button>
        <button type="button" className={'dsh-wt_mdBtn' + (mode === 'edit' ? ' dsh-wt_mdBtnOn' : '')} onClick={enterEdit}>{T('file.edit')}</button>
        {mode === 'edit' && (
          <button type="button" className="dsh-wt_mdSave" disabled={saving} onClick={save}>{saving ? '…' : T('file.save')}</button>
        )}
        {saveFail && <span className="dsh-wt_mdMsg">{T('file.saveFail')}</span>}
      </div>
      {mode === 'edit'
        ? <textarea className="dsh-wt_mdEdit" value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} />
        : props.isMd
          ? (
            <div className="dsh-wt_fileView">
              <div
                className="dsh-wt_md"
                dangerouslySetInnerHTML={{ __html: mdRenderer.render(text) }}
                onClick={(e: any) => {
                  const a = e.target && e.target.closest ? (e.target.closest('a') as HTMLAnchorElement | null) : null
                  if (!a) return
                  e.preventDefault()
                  const href = a.getAttribute('href') || ''
                  if (/^(https?:|mailto:)/i.test(href)) window.open(href, '_blank', 'noopener')
                }}
              />
            </div>
          )
          : isCode
            ? (
              <div className="dsh-wt_fileView">
                <pre className="dsh-wt_code"><code dangerouslySetInnerHTML={{ __html: codeHtml(text, ext) }} /></pre>
              </div>
            )
            : <div className="dsh-wt_fileView"><pre className="dsh-wt_txt">{text}</pre></div>}
    </>
  )
}

/** 单个标签页的内容渲染 */
function PaneTabBody(props: { tab: PaneTab; row: PaneRow; index: number }) {
  const content = props.tab.content
  if (content.kind === 'iframe') {
    return <iframe className="dsh-wt_paneFrame" src={content.url} title={props.tab.title} />
  }
  if (content.kind === 'file') {
    return <FileViewer path={content.path} />
  }
  if (content.type === 'browser') return <BrowserPane />
  if (content.type === 'explorer') return <ExplorerPane row={props.row} index={props.index} />
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

/** 窗内容：标签页模型（无标签 = 6 选 1 选择器；标签可切换/关闭，关完回到选择器） */
function PaneBody(props: { pane: SplitPane; row: PaneRow; index: number }) {
  const { pane, row, index } = props
  const tabs = pane.tabs ?? []
  const active = Math.min(pane.active ?? 0, Math.max(0, tabs.length - 1))
  if (tabs.length === 0) {
    return <PanePicker row={row} index={index} />
  }
  return (
    <>
      <div className="dsh-wt_tabBar">
        {tabs.map((t, i) => (
          <span
            key={t.id}
            className={'dsh-wt_tab' + (i === active ? ' dsh-wt_tabOn' : '')}
            title={t.title}
            draggable
            onDragStart={(e: any) => { dragTab = { row, index, tabId: t.id }; try { e.dataTransfer.effectAllowed = 'move' } catch {} }}
            onDragEnd={() => { dragTab = null; setDropTarget(null) }}
            onClick={() => splitStore.setActiveTab(row, index, t.id)}
          >
            <span className="dsh-wt_tabTitle">{t.title}</span>
            <button
              type="button"
              className="dsh-wt_tabClose"
              title={T('pane.closeTab')}
              onClick={(e) => { e.stopPropagation(); splitStore.closeTab(row, index, t.id) }}
            >✕</button>
          </span>
        ))}
      </div>
      <PaneTabBody tab={tabs[active]} row={row} index={index} />
    </>
  )
}

/** 未指派内容：4 选 1 选择器。按钮固定大小、整体居中；
 * 按窗位宽高比自适应排列：宽窗横排 4 连 / 方窗 2×2 / 竖窗竖排。 */
function PanePicker(props: { row: PaneRow; index: number }) {
  const [custom, setCustom] = useState(false)
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'row' | 'grid' | 'col'>('grid')
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const aspect = h > 0 ? w / h : 1
      setMode(aspect > 1.4 ? 'row' : aspect > 0.72 ? 'grid' : 'col')
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const pick = (content: SplitContent) => splitStore.openTab(props.row, props.index, content)
  const applyCustom = () => {
    const u = url.trim()
    if (/^(\/|https?:\/\/)/i.test(u)) pick({ kind: 'iframe', url: u })
  }
  return (
    <div ref={hostRef} className={'dsh-wt_panePicker dsh-wt_panePicker-' + mode}>
      {custom ? (
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
      ) : (
        <>
          <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'browser' })}>
            <span aria-hidden>🌐</span>{T('pane.browser')}
          </button>
          <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'explorer' })}>
            <span aria-hidden>📁</span>{T('pane.explorer')}
          </button>
          <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'terminal' })}>
            <span aria-hidden>▸_</span>{T('pane.terminal')}
          </button>
          <button type="button" className="dsh-wt_panePick" onClick={() => setCustom(true)}>
            <span aria-hidden>✨</span>{T('pane.custom')}
          </button>
        </>
      )}
    </div>
  )
}

type PoolItem = { spec: LayoutSpec; chatW: number; topH: number; leftW: number; paneWs: number[]; topWs: number[] }

/** 单个工作区渲染层（geom 为 null 时用 0 几何渲染，外层 display:none 保活，保留网页/MD 滚动/激活标签等状态） */
function WorkspaceLayer(props: { spec: LayoutSpec; geom: Geom | null; chatW: number; topH: number; leftW: number; paneWs: number[]; topWs: number[] }) {
  const g = props.geom ?? { left: 0, top: 0, right: 0, bottom: 0 }
  const spec = props.spec
  const top = spec.top ?? []
  const main = spec.main ?? []
  const hasLeft = !!spec.left
  const hasTop = top.length > 0
  const chatLeft = !hasLeft && spec.chatSide === 'left'
  const colW = g.right - g.left
  const rowH = g.bottom - g.top
  const chatW = clamp(props.chatW, spec.chatWidth.min, Math.max(spec.chatWidth.min, colW - 60))
  const topH = hasTop
    ? clamp(props.topH, spec.topHeight?.min ?? 80, Math.max(spec.topHeight?.min ?? 80, rowH - BAR_H - 80))
    : 0
  const leftW = hasLeft
    ? clamp(props.leftW, spec.leftWidth?.min ?? 160, Math.max(spec.leftWidth?.min ?? 160, colW - 260))
    : 0
  const chatFull = spec.chatFullHeight === true
  const contentW = Math.max(0, colW - chatW)
  const contentX = hasLeft ? g.left + leftW : (chatLeft ? g.left + chatW : g.left)
  const topRowX = hasLeft ? g.left + leftW : contentX
  const topRowW = hasLeft ? Math.max(0, colW - leftW) : (chatFull ? contentW : colW)

  const topItems = allocate(top, props.topWs, topRowW)
  const mainItems = allocate(main, props.paneWs, contentW)
  const leftItem = spec.left ? { pane: spec.left, left: 0, width: leftW } : null

  const barTop = g.top
  const bodyTop = barTop + BAR_H + topH
  const paneBottom = g.bottom
  const mainH = paneBottom - bodyTop
  const topY = barTop + BAR_H

  const renderPane = (it: { pane: SplitPane; left: number; width: number }, row: PaneRow, index: number, x: number, y: number, h: number) => (
    <div
      key={it.pane.id}
      className="dsh-wt_pane"
      data-drop-hover={dropTarget && dropTarget.row === row && dropTarget.index === index ? 'true' : undefined}
      style={{ position: 'fixed', left: x + it.left, top: y, width: it.width, height: h, zIndex: 68 }}
      onDragOver={(e: any) => {
        if (!dragTab) return
        e.preventDefault()
        setDropTarget({ row, index })
      }}
      onDragLeave={(e: any) => {
        if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) setDropTarget(null)
      }}
      onDrop={(e: any) => {
        e.preventDefault()
        const s = dragTab
        dragTab = null
        setDropTarget(null)
        if (s && (s.row !== row || s.index !== index)) {
          splitStore.moveTab(s.row, s.index, s.tabId, row, index)
        }
      }}
    >
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
          style={{ position: 'fixed', left: topRowX + it.left + it.width, top: topY, width: DIVIDER, height: topH, zIndex: 72 }}
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
          style={{ position: 'fixed', left: contentX + it.left + it.width, top: bodyTop, width: DIVIDER, height: mainH, zIndex: 72 }}
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

/** 分栏工作区浮层（shell.overlay 座位；订阅 splitStore 快照渲染）。
 * 切换项目时旧工作区不销毁：全部挂载在池中、仅当前可见（display:none 保活），
 * 网页子页面/滚动位置、MD 滚动位置、激活标签等在切回时原样保留。 */
function SplitWorkspace() {
  const [snap, setSnap] = useState({
    active: splitStore.active,
    spec: splitStore.spec,
    geom: splitStore.geom,
    chatW: splitStore.chatW,
    topH: splitStore.topH,
    leftW: splitStore.leftW,
    paneWs: [...splitStore.paneWs],
    topWs: [...splitStore.topWs],
  })
  const poolRef = useRef<Map<string, PoolItem>>(new Map())
  const [, setPoolTick] = useState(0)

  useEffect(() => splitStore.subscribe(() => {
    const spec = splitStore.spec
    if (splitStore.active && spec) {
      poolRef.current.set(spec.id, {
        spec,
        chatW: splitStore.chatW,
        topH: splitStore.topH,
        leftW: splitStore.leftW,
        paneWs: [...splitStore.paneWs],
        topWs: [...splitStore.topWs],
      })
      // 保活池上限 6 个（LRU：删最老的），避免长时间使用内存膨胀
      while (poolRef.current.size > 6) {
        const first = poolRef.current.keys().next().value
        if (first != null) poolRef.current.delete(first)
      }
    }
    setSnap({
      active: splitStore.active,
      spec: splitStore.spec,
      geom: splitStore.geom,
      chatW: splitStore.chatW,
      topH: splitStore.topH,
      leftW: splitStore.leftW,
      paneWs: [...splitStore.paneWs],
      topWs: [...splitStore.topWs],
    })
    setPoolTick((t) => t + 1)
  }), [])

  useEffect(() => {
    if (!snap.active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') splitStore.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [snap.active])

  // 标签拖放高亮 → 重渲染
  const [, setDropTick] = useState(0)
  useEffect(() => {
    const fn = () => setDropTick((t) => t + 1)
    dropTargetListeners.add(fn)
    return () => { dropTargetListeners.delete(fn) }
  }, [])

  const activeId = snap.active && snap.spec ? snap.spec.id : null
  const entries = Array.from(poolRef.current.entries())
  if (entries.length === 0) return null
  return (
    <>
      {entries.map(([id, item]) => {
        const isActive = id === activeId
        return (
          <div key={id} style={isActive ? undefined : { display: 'none' }}>
            <WorkspaceLayer
              spec={item.spec}
              geom={isActive ? snap.geom : null}
              chatW={isActive ? snap.chatW : item.chatW}
              topH={isActive ? snap.topH : item.topH}
              leftW={isActive ? snap.leftW : item.leftW}
              paneWs={isActive ? snap.paneWs : item.paneWs}
              topWs={isActive ? snap.topWs : item.topWs}
            />
          </div>
        )
      })}
    </>
  )
}

/** 调试出口（自动化验证用；必须在 store 定义之后） */
try { (window as any).__dshWorktable = { splitStore } } catch {}

export { SplitWorkspace }
