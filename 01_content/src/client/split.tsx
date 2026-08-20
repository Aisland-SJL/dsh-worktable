import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'

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

export type BuiltinType = 'browser' | 'anim' | 'explorer' | 'scm' | 'tasks' | 'terminal' | 'custom' | 'console'

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
  /** 顶行首次打开时高度占可用高度比例（0~1；0.5 = 上下等分）；拖动后由存档值覆盖 */
  topHeightRatio?: number
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
  /** 锁定窗格：清空原有标签，把内容作为该窗唯一的固定标签（挂载产物的「锁死」语义） */
  lockPane(row: PaneRow, i: number, content: SplitContent): void
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
  anim: '🎬',
  explorer: '📁',
  scm: '🔀',
  tasks: '✅',
  terminal: '▸_',
  custom: '✨',
  console: '🖥️',
}

const BUILTIN_LABEL_KEYS: Record<BuiltinType, string> = {
  browser: 'pane.browser',
  anim: 'pane.anim',
  explorer: 'pane.explorer',
  scm: 'pane.scm',
  tasks: 'pane.tasks',
  terminal: 'pane.terminal',
  custom: 'pane.custom',
  console: 'pane.console',
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
let uiT: ((key: string, params?: Record<string, string>) => string) | null = null
export function setSplitT(fn: ((key: string, params?: Record<string, string>) => string) | null) {
  uiT = fn
}
const T = (key: string, params?: Record<string, string>): string => (uiT ? uiT(key, params) : key)

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
/** 控制室卡片数据（index.tsx 组装；纯读镜像，零轮询零 Token） */
export type ConsoleCardData = {
  id: string
  name: string
  icon: string
  /** 三态 + 空闲：need(待决黄) > done(完成绿) > busy(工作中蓝) > idle */
  status: 'idle' | 'busy' | 'need' | 'done'
  /** 正在运行时的本轮已用毫秒；非运行态 null */
  runtimeMs: number | null
  /** 子代理数量 */
  kids: number
  /** 最近一条消息预览（单行文本，可能为空） */
  preview: string
  /** 是否绑定对话 */
  bound: boolean
  /** 是否为「工作台」自己（卡片点击无操作） */
  self: boolean
  /** 完成/待决且未被确认：卡片发对应色光（点击确认后熄灭） */
  glow: boolean
}

type SplitEnv = {
  getScope: () => SplitScope | null
  getJobs: () => SplitJob[]
  getSubagents: () => any[]
  /** 自定义窗口：项目列表 + 会话列表 + 当前项目 + 新建会话 / 发送到已有会话 */
  custom?: {
    getProjects: () => { id: string; name: string }[]
    currentProjectId: () => string | null
    getSessions: () => Promise<{ groups: { title: string; sessions: { id: string; title: string; isCurrent: boolean }[] }[]; current: string }>
    submit: (projectId: string, projectName: string, requirement: string) => Promise<void>
    sendToSession: (sessionId: string, projectName: string, requirement: string) => Promise<void>
  }
  /** 控制室：卡片数据订阅 + 打开项目 / 跳绑定对话 + 主题 */
  console?: {
    subscribe: (fn: () => void) => () => void
    getCards: () => ConsoleCardData[]
    onOpen: (id: string) => void
    onJump: (id: string) => void
    /** 点发光卡片：确认（熄灭光）再打开 */
    onAck: (id: string) => void
    /** 冷会话消息预热（打开控制室时拉最近消息） */
    refreshPreviews: () => void
    getTheme: () => 'dark' | 'light' | 'system'
    setTheme: (th: 'dark' | 'light' | 'system') => void
  }
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
        const ratio = spec.topHeightRatio ?? 0.35
        this.topH = clamp(Math.round((rowH0 - BAR_H) * ratio), lo, Math.max(lo, rowH0 - BAR_H - 80))
      }
      if (!hasPaneWs) {
        const contentW = Math.max(0, colW0 - this.chatW)
        const avail = Math.max(main.length * 120, contentW - Math.max(0, main.length - 1) * DIVIDER)
        const share = Math.round(avail / main.length)
        this.paneWs = main.map((p) => Math.max(p.min, share))
      }
      if (!hasTopWs) {
        // chatFull 时顶行只占内容侧（扣除聊天列宽）
        const chatW0 = spec.chatFullHeight === true ? this.chatW : 0
        const rowW = Math.max(0, colW0 - chatW0 - (left ? this.leftW : 0))
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

  lockPane(row, i, content) {
    const spec = this.spec
    if (!spec) return
    const tab: PaneTab = { id: 't' + Date.now().toString(36), title: tabTitleOf(content), content, active: 0 }
    const mutate = (pane: SplitPane): SplitPane => ({ ...pane, content: null, tabs: [tab], active: 0 })
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

/** 浏览器内置窗：地址栏 + 前往；刷新统一在标签栏最左（重挂载 iframe，跨域也可靠） */
function BrowserPane(props: { reloadKey: number }) {
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
      <iframe key={props.reloadKey} className="dsh-wt_paneFrame" src={src} title="browser" />
    </>
  )
}

/** iframe 内容标签（网页/站点产物）：刷新统一在标签栏最左（重挂载整页刷新，跨域可靠） */
function IframePane(props: { url: string; title?: string; reloadKey: number }) {
  return <iframe key={props.reloadKey} className="dsh-wt_paneFrame" src={props.url} title={props.title ?? ''} />
}

/** 动画播放窗：iframe 壳 + 地址栏（站内自带项目/场景列表、播放、画幅切换、导出等全部控件） */
function AnimPane(props: { reloadKey: number }) {
  const [url, setUrl] = useState('')
  const [src, setSrc] = useState('about:blank')
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
          placeholder={T('pane.animUrlPh')}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go() }}
        />
        <button type="button" className="dsh-wt_browserGo" onClick={go}>↗</button>
      </div>
      <iframe key={props.reloadKey} className="dsh-wt_paneFrame" src={src} title="anim" />
    </>
  )
}

/** 控制室面板：项目卡片网格（每行 3 张、超出换行）；数据由工作台组装推送（纯读镜像）。
 *  主题：dark/light 直接生效；system = 跟随宿主 html 的 color-scheme（DSH 深色/白色/跟随系统都会反映到它） */
function ConsolePane() {
  const [, setTick] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [themeMode, setThemeMode] = useState<'dark' | 'light' | 'system'>(() => splitEnv?.console?.getTheme?.() ?? 'system')
  const [sysDark, setSysDark] = useState(() => {
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return true }
  })
  useEffect(() => {
    const env = splitEnv?.console
    if (!env) return
    const bump = () => { setTick((t) => t + 1); setThemeMode(env.getTheme?.() ?? 'system') }
    const un = env.subscribe(bump)
    bump()
    return un
  }, [])
  // 跟随系统：监听 OS 深浅切换（仅 themeMode==='system' 时影响渲染）
  useEffect(() => {
    let mq: MediaQueryList | null = null
    try { mq = window.matchMedia('(prefers-color-scheme: dark)') } catch {}
    if (!mq) return
    const f = (e: any) => setSysDark(!!e?.matches)
    try { mq.addEventListener('change', f) } catch { try { (mq as any).addListener(f) } catch {} }
    return () => { try { mq.removeEventListener('change', f) } catch { try { (mq as any).removeListener(f) } catch {} } }
  }, [])
  // 打开控制室 = 预热所有绑定会话的最近消息（冷会话走宿主 history 只读通道）
  useEffect(() => {
    splitEnv?.console?.refreshPreviews?.()
  }, [])
  // 运行时长的分钟级刷新：每秒重渲染一次（仅控制室开着时存在）
  useEffect(() => {
    const iv = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(iv)
  }, [])
  void now
  const env = splitEnv?.console
  const cards = env ? env.getCards() : []
  const resolvedTheme: 'dark' | 'light' = (() => {
    if (themeMode !== 'system') return themeMode
    try {
      const cs = getComputedStyle(document.documentElement).colorScheme || ''
      if (cs.includes('dark') && !cs.includes('light')) return 'dark'
      if (cs.includes('light') && !cs.includes('dark')) return 'light'
    } catch {}
    return sysDark ? 'dark' : 'light'
  })()
  const setTheme = (th: 'dark' | 'light' | 'system') => { setThemeMode(th); env?.setTheme?.(th) }
  const fmtDur = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const ss = s % 60
    return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0') : m + ':' + String(ss).padStart(2, '0')
  }
  const statusLabel: Record<string, string> = { idle: T('console.idle'), busy: T('console.busy'), need: T('console.need'), done: T('console.done') }
  const themeOpts: { mode: 'dark' | 'light' | 'system'; icon: string; key: string }[] = [
    { mode: 'dark', icon: '🌙', key: 'console.themeDark' },
    { mode: 'light', icon: '☀️', key: 'console.themeLight' },
    { mode: 'system', icon: '🖥️', key: 'console.themeSystem' },
  ]
  return (
    <div className="dsh-wt_console" data-wt-theme={resolvedTheme}>
      <div className="dsh-wt_consoleHead">
        <span className="dsh-wt_consoleTitle">🖥️ {T('console.title')}</span>
        <div className="dsh-wt_consoleTheme" role="group" aria-label={T('console.themeLabel')}>
          {themeOpts.map((o) => (
            <button
              key={o.mode}
              type="button"
              className={'dsh-wt_consoleThemeBtn' + (themeMode === o.mode ? ' dsh-wt_consoleThemeBtnOn' : '')}
              title={T(o.key)}
              aria-label={T(o.key)}
              onClick={() => setTheme(o.mode)}
            ><span aria-hidden>{o.icon}</span></button>
          ))}
        </div>
      </div>
      <div className="dsh-wt_consoleGrid">
        {cards.map((c) => (
          <div
            key={c.id}
            role={c.self ? undefined : 'button'}
            tabIndex={c.self ? -1 : 0}
            className={'dsh-wt_consoleCard' + (c.self ? ' dsh-wt_consoleCardSelf' : '')
              + (c.status === 'busy' ? ' dsh-wt_consoleCard-busy' : '')
              + (c.glow && c.status === 'done' ? ' dsh-wt_consoleCard-glowDone' : '')
              + (c.glow && c.status === 'need' ? ' dsh-wt_consoleCard-glowNeed' : '')}
            title={c.name}
            onClick={() => {
              if (c.self || !env) return
              if (c.glow) env.onAck?.(c.id) // 点发光卡片：先确认熄光，再进入
              env.onOpen(c.id)
            }}
          >
            <div className="dsh-wt_consoleCardHead">
              <span className="dsh-wt_consoleIcon" aria-hidden>{c.icon}</span>
              <span className="dsh-wt_consoleName">{c.name}</span>
              <span className={'dsh-wt_consoleDot dsh-wt_consoleDot-' + c.status} aria-hidden />
            </div>
            <div className="dsh-wt_consoleStatusRow">
              <span className={'dsh-wt_consoleStatus dsh-wt_consoleStatus-' + c.status}>{statusLabel[c.status]}</span>
              {c.runtimeMs != null && <span className="dsh-wt_consoleRuntime">⏱ {fmtDur(c.runtimeMs)}</span>}
            </div>
            <div className="dsh-wt_consoleBadges">
              <span className="dsh-wt_consoleBadge">{T('console.kids')} {c.kids}</span>
            </div>
            <div className={'dsh-wt_consolePreview' + (c.preview ? '' : ' dsh-wt_consolePreviewNone')} title={c.preview}>
              {c.preview || (c.bound ? T('console.noPreview') : T('console.unboundShort'))}
            </div>
            {c.bound && !c.self && (
              <button
                type="button"
                className="dsh-wt_consoleJump"
                title={T('console.jump')}
                aria-label={T('console.jump')}
                onClick={(e) => { e.stopPropagation(); env?.onJump(c.id) }}
              >💬</button>
            )}
          </div>
        ))}
      </div>
      {cards.length === 0 && <div className="dsh-wt_consoleEmpty">{T('console.empty')}</div>}
    </div>
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
        fontFamily: 'Cascadia Code, Cascadia Mono, Consolas, Menlo, monospace',
        fontSize: 12,
        convertEol: true,
        theme: { background: '#010409' },
      })
    } catch {
      setFailed(T('pane.termFail'))
      return
    }
    term.open(el)
    // 强制自动换行（DECAWM on）：超长行在窗口宽度处换行，不被截断
    try { term.write('\x1b[?7h') } catch {}
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
    ws.onopen = () => { focusTerm(); try { term.write('\x1b[?7h') } catch {} }
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

/** 自制下拉列表（原生 select 无法美化）：文件夹分组标题 + 1px 细分隔线 + 选项列表 */
function SelectPop(props: {
  value: string | null
  groups: { title: string; items: { id: string; label: string; isCurrent?: boolean }[] }[]
  placeholder?: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const flat = props.groups.flatMap((g) => g.items)
  const selected = flat.find((i) => i.id === props.value)
  return (
    <div className="dsh-wt_select">
      <button type="button" className="dsh-wt_selectBtn" onClick={() => setOpen((v) => !v)}>
        <span className={'dsh-wt_selectVal' + (selected ? '' : ' dsh-wt_selectPh')}>{selected?.label ?? props.placeholder ?? ''}</span>
        <span className="dsh-wt_selectCaret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="dsh-wt_selectList">
          {props.groups.map((g, gi) => (
            <Fragment key={g.title || 'g' + gi}>
              {g.title && (
                <>
                  <div className="dsh-wt_selectDivider" />
                  <div className="dsh-wt_selectGroup">📁 {g.title}</div>
                </>
              )}
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={'dsh-wt_selectItem' + (it.id === props.value ? ' dsh-wt_selectItemOn' : '')}
                  onClick={() => { props.onChange(it.id); setOpen(false) }}
                >
                  <span className="dsh-wt_selectItemTitle">{it.label}</span>
                  {it.isCurrent && <span className="dsh-wt_selectCurrent">{T('custom.sessionCurrent')}</span>}
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

/** 自定义窗口：居中对话框。两种模式：新建专属会话 / 发送到已有会话（默认当前会话）。 */
function CustomPane(props: { paneTitle?: string }) {
  const paneTitle = props.paneTitle ?? ''
  try { (window as any).__dshLastCustomPaneTitle = paneTitle } catch {}
  const custom = splitEnv?.custom
  const [requirement, setRequirement] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projects, setProjects] = useState<{ id: string; name: string }[]>(() => custom?.getProjects?.() ?? [])
  const [mode, setMode] = useState<'new' | 'existing'>('existing')
  const [sessionGroups, setSessionGroups] = useState<{ title: string; sessions: { id: string; title: string; isCurrent: boolean }[] }[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  // 分组（宿主工作区）三态：未分组 / 现有组 / 新建组
  const [wsGroups, setWsGroups] = useState<{ id: string; title: string; path: string }[]>([])
  const [groupMode, setGroupMode] = useState<'none' | 'existing' | 'new'>('none')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [newGroupParent, setNewGroupParent] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [fail, setFail] = useState('')
  const [bindNote, setBindNote] = useState<'auto' | 'kept' | 'none'>('none')
  // 默认项目 = 当前工作区所属项目；默认会话 = 当前会话；默认分组 = 当前会话所在工作区
  useEffect(() => {
    const list = custom?.getProjects?.() ?? []
    setProjects(list)
    const cur = custom?.currentProjectId?.() ?? null
    setProjectId(cur && list.some((p) => p.id === cur) ? cur : (list[0]?.id ?? null))
    setWsGroups((custom?.getWorkspaces?.() ?? []).map((w) => ({ id: w.id, title: w.title, path: w.path })))
    custom?.getSessions?.().then((res) => {
      setSessionGroups(res.groups)
      const flat = res.groups.flatMap((g) => g.sessions)
      setSessionId(flat.find((s) => s.isCurrent)?.id ?? flat[0]?.id ?? null)
      const curId = flat.find((s) => s.isCurrent)?.id
      const home = curId ? (custom?.getWorkspaces?.() ?? []).find((w) => (w.sessionIds ?? []).includes(curId)) : null
      if (home) { setGroupMode('existing'); setGroupId(home.id) }
    }).catch(() => { setSessionGroups([]) })
  }, [custom])
  const submit = async () => {
    const text = requirement.trim()
    if (!text || !projectId || !custom) return
    setBusy(true)
    setFail('')
    try {
      const proj = projects.find((p) => p.id === projectId)
      const pname = proj?.name ?? projectId
      if (mode === 'new') {
        let group: any = { kind: 'none' }
        if (groupMode === 'existing' && groupId) group = { kind: 'existing', workspaceId: groupId }
        else if (groupMode === 'new') {
          if (!newGroupParent.trim() || !newGroupName.trim()) { setFail(T('custom.groupNeedPath')); return }
          group = { kind: 'new', parent: newGroupParent.trim(), name: newGroupName.trim() }
        }
        const sid = await custom.submit(projectId, pname, text, group, paneTitle)
        setBindNote((custom.autoBind?.(sid) ?? 'none') as any)
      } else {
        if (!sessionId) return
        await custom.sendToSession(sessionId, projectId, pname, text, paneTitle)
        setBindNote((custom.autoBind?.(sessionId) ?? 'none') as any)
      }
      setDone(true)
    } catch (e) {
      setFail(String(e))
    } finally {
      setBusy(false)
    }
  }
  if (!custom) {
    return <div className="dsh-wt_paneWip"><span className="dsh-wt_paneWipText">{T('pane.wip')}</span></div>
  }
  if (done) {
    return (
      <div className="dsh-wt_customBox">
        <span className="dsh-wt_customDone" aria-hidden>✅</span>
        <p className="dsh-wt_customDoneText">{mode === 'new' ? T('custom.done') : T('custom.sent')}</p>
        <p className="dsh-wt_customDoneHint">{T('custom.doneHint')}</p>
        {bindNote !== 'none' && (
          <p className="dsh-wt_customDoneBind">{bindNote === 'auto' ? T('custom.autoBound') : T('custom.keptBinding')}</p>
        )}
      </div>
    )
  }
  return (
    <div className="dsh-wt_customBox">
      <div className="dsh-wt_customCard">
        <span className="dsh-wt_customTitle">✨ {T('custom.title')}</span>
        <div className="dsh-wt_customModes">
          <button type="button" className={'dsh-wt_customModeBtn' + (mode === 'existing' ? ' dsh-wt_customModeBtnOn' : '')} onClick={() => setMode('existing')}>{T('custom.modeSend')}</button>
          <button type="button" className={'dsh-wt_customModeBtn' + (mode === 'new' ? ' dsh-wt_customModeBtnOn' : '')} onClick={() => setMode('new')}>{T('custom.modeNew')}</button>
        </div>
        <p className="dsh-wt_customHint">{mode === 'new' ? T('custom.hint') : T('custom.hintSend')}</p>
        <textarea
          className="dsh-wt_customInput"
          autoFocus
          placeholder={T('custom.placeholder')}
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
        />
        {mode === 'existing' && (
          <div className="dsh-wt_customRow">
            <span className="dsh-wt_customLabel">{T('custom.session')}</span>
            <SelectPop
              value={sessionId}
              groups={sessionGroups.map((g) => ({
                title: g.title,
                items: g.sessions.map((s) => ({ id: s.id, label: s.title, isCurrent: s.isCurrent })),
              }))}
              placeholder={T('custom.session')}
              onChange={setSessionId}
            />
          </div>
        )}
        <div className="dsh-wt_customRow">
          <span className="dsh-wt_customLabel">{T('custom.project')}</span>
          <SelectPop
            value={projectId}
            groups={[{ title: '', items: projects.map((p) => ({ id: p.id, label: p.name })) }]}
            placeholder={T('custom.project')}
            onChange={setProjectId}
          />
        </div>
        {mode === 'new' && (
          <div className="dsh-wt_customRow">
            <span className="dsh-wt_customLabel">{T('custom.group')}</span>
            <SelectPop
              value={groupMode === 'none' ? '__none' : groupMode === 'new' ? '__new' : groupId}
              groups={[{
                title: '',
                items: [
                  { id: '__none', label: T('custom.groupNone') },
                  ...wsGroups.map((w) => ({ id: w.id, label: w.title })),
                  { id: '__new', label: T('custom.groupNew') },
                ],
              }]}
              placeholder={T('custom.group')}
              onChange={(id) => {
                if (id === '__none') setGroupMode('none')
                else if (id === '__new') setGroupMode('new')
                else { setGroupMode('existing'); setGroupId(id) }
              }}
            />
          </div>
        )}
        {mode === 'new' && groupMode === 'new' && (
          <>
            <div className="dsh-wt_customRow">
              <span className="dsh-wt_customLabel">{T('custom.groupNewParent')}</span>
              <input
                className="dsh-wt_customPathInput"
                placeholder={T('custom.groupNewParentPh')}
                value={newGroupParent}
                onChange={(e) => setNewGroupParent(e.target.value)}
              />
            </div>
            <div className="dsh-wt_customRow">
              <span className="dsh-wt_customLabel">{T('custom.groupNewName')}</span>
              <input
                className="dsh-wt_customPathInput"
                placeholder={T('custom.groupNewNamePh')}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
              />
            </div>
          </>
        )}
        <button
          type="button"
          className="dsh-wt_customSend"
          disabled={busy || !requirement.trim() || !projectId || (mode === 'existing' && !sessionId) || (mode === 'new' && groupMode === 'new' && (!newGroupParent.trim() || !newGroupName.trim()))}
          onClick={submit}
        >{busy ? '…' : (mode === 'new' ? T('custom.send') : T('custom.sendToSession'))}</button>
        {fail && <p className="dsh-wt_customFail">{T('custom.fail')}：{fail}</p>}
      </div>
    </div>
  )
}

/** 单个标签页的内容渲染 */
function PaneTabBody(props: { tab: PaneTab; row: PaneRow; index: number; paneTitle?: string; reloadKey: number }) {
  const content = props.tab.content
  if (content.kind === 'iframe') {
    return <IframePane url={content.url} title={content.title ?? props.tab.title} reloadKey={props.reloadKey} />
  }
  if (content.kind === 'file') {
    return <FileViewer path={content.path} />
  }
  if (content.type === 'browser') return <BrowserPane reloadKey={props.reloadKey} />
  if (content.type === 'anim') return <AnimPane reloadKey={props.reloadKey} />
  if (content.type === 'console') return <ConsolePane />
  if (content.type === 'explorer') return <ExplorerPane row={props.row} index={props.index} />
  if (content.type === 'scm') return <GitPane />
  if (content.type === 'tasks') return <JobsPane />
  if (content.type === 'terminal') return <TerminalPane />
  if (content.type === 'custom') return <CustomPane paneTitle={props.paneTitle ?? ''} />
  return (
    <div className="dsh-wt_paneWip">
      <span className="dsh-wt_paneWipIcon" aria-hidden>{BUILTIN_ICONS[content.type]}</span>
      <span className="dsh-wt_paneWipText">{T('pane.wip')}</span>
    </div>
  )
}

/** 需要标签栏刷新按钮的内容类型：网页类（iframe / 浏览器 / 动画）统一在标签最左放 ↻ */
function refreshableTab(t: PaneTab): boolean {
  const c = t.content
  return c.kind === 'iframe' || (c.kind === 'builtin' && (c.type === 'browser' || c.type === 'anim'))
}

/** 窗内容：标签页模型（无标签 = 6 选 1 选择器；标签可切换/关闭，关完回到选择器）
 *  网页类标签最左侧固定一个 ↻ 刷新按钮（标签名之前），点击重挂载该标签内容。 */
function PaneBody(props: { pane: SplitPane; row: PaneRow; index: number }) {
  const { pane, row, index } = props
  const tabs = pane.tabs ?? []
  const active = Math.min(pane.active ?? 0, Math.max(0, tabs.length - 1))
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({})
  if (tabs.length === 0) {
    return <PanePicker row={row} index={index} />
  }
  const refreshTab = (t: PaneTab) => {
    setReloadKeys((m) => ({ ...m, [t.id]: (m[t.id] ?? 0) + 1 }))
    splitStore.setActiveTab(row, index, t.id)
  }
  return (
    <>
      <div className="dsh-wt_tabBar">
        {tabs.map((t, i) => {
          // 控制室标签不可关闭：关掉后窗格变选择器，用户回不到控制室（不可逆操作）
          const locked = t.content?.kind === 'builtin' && t.content.type === 'console'
          return (
          <span
            key={t.id}
            className={'dsh-wt_tab' + (i === active ? ' dsh-wt_tabOn' : '')}
            title={t.title}
            draggable={!locked}
            onDragStart={(e: any) => { dragTab = { row, index, tabId: t.id }; try { e.dataTransfer.effectAllowed = 'move' } catch {} }}
            onDragEnd={() => { dragTab = null; setDropTarget(null) }}
            onClick={() => splitStore.setActiveTab(row, index, t.id)}
          >
            {refreshableTab(t) && (
              <button
                type="button"
                className="dsh-wt_tabRefresh"
                title={T('pane.refresh')}
                aria-label={T('pane.refresh')}
                onClick={(e) => { e.stopPropagation(); refreshTab(t) }}
              >↻</button>
            )}
            <span className="dsh-wt_tabTitle">{t.title}</span>
            {!locked && (
              <button
                type="button"
                className="dsh-wt_tabClose"
                title={T('pane.closeTab')}
                onClick={(e) => { e.stopPropagation(); splitStore.closeTab(row, index, t.id) }}
              >✕</button>
            )}
          </span>
          )
        })}
      </div>
      <PaneTabBody tab={tabs[active]} row={row} index={index} paneTitle={pane.title} reloadKey={reloadKeys[tabs[active].id] ?? 0} />
    </>
  )
}

/** 未指派内容：4 选 1 选择器。按钮固定大小、整体居中；
 * 按窗位宽高比自适应排列：宽窗横排 4 连 / 方窗 2×2 / 竖窗竖排。 */
function PanePicker(props: { row: PaneRow; index: number }) {
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
  return (
    <div ref={hostRef} className={'dsh-wt_panePicker dsh-wt_panePicker-' + mode}>
      <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'browser' })}>
        <span aria-hidden>🌐</span>{T('pane.browser')}
      </button>
      <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'anim' })}>
        <span aria-hidden>🎬</span>{T('pane.anim')}
      </button>
      <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'explorer' })}>
        <span aria-hidden>📁</span>{T('pane.explorer')}
      </button>
      <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'terminal' })}>
        <span aria-hidden>▸_</span>{T('pane.terminal')}
      </button>
      <button type="button" className="dsh-wt_panePick" onClick={() => pick({ kind: 'builtin', type: 'custom' })}>
        <span aria-hidden>✨</span>{T('pane.custom')}
      </button>
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
          <div key={id} style={isActive ? undefined : { visibility: 'hidden' as const }}>
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
