import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { parentPathOf } from './pathutil'
import { CHANGELOG_V030 } from './changelog'
import { LOCAL_VERSION, checkUpdate, getAutoCheck, readCache, setAutoCheck as storeAutoCheck, setSkipVersion, type UpdateInfo, type UpdateStatus } from './updateCheck'
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
  | { kind: 'builtin'; type: BuiltinType; url?: string }
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
  /** 头部折叠：true = 隐藏窗格标题与标签栏（内容占满；随 spec 持久化） */
  collapsed?: boolean
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
  toggleCollapsed(row: PaneRow, i: number): void
  moveTab(fromRow: PaneRow, fromI: number, tabId: string, toRow: PaneRow, toI: number): void
  swapPanes(aRow: PaneRow, aI: number, bRow: PaneRow, bI: number): void
  setChatSide(side: 'left' | 'right'): void
  persist(): void
  subscribe(fn: () => void): () => void
  notify(): void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const GAP = 1           // 窗格之间真实布局间隙：1px（分隔细线即间隙，底色贴线）
const DIVIDER = 4       // 分隔条热区宽度：透明覆盖层，细线画在热区中间与两侧内容贴齐
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
    /** 创建卡片：打开「添加项目」流程（同侧栏 ＋） */
    onAdd: () => void
    getTheme: () => 'dark' | 'light' | 'system'
    setTheme: (th: 'dark' | 'light' | 'system') => void
    getCols: () => number
    setCols: (n: number) => void
    getShape: () => 'square' | 'circle'
    setShape: (s: 'square' | 'circle') => void
    getBg: () => 'plain' | 'glow' | 'photo'
    setBg: (m: 'plain' | 'glow' | 'photo') => void
    getPhotoLib: () => Promise<{ list: { id: string; kind: 'photo' | 'video'; url: string }[]; activeId: string | null }>
    addPhoto: (blob: Blob) => Promise<{ id: string; kind: 'photo' | 'video'; url: string }>
    setPhotoId: (id: string) => void
    getPhotoHsl: (id: string) => { h: number; s: number; l: number }
    setPhotoHsl: (id: string, v: { h: number; s: number; l: number }) => void
    removePhoto: (id: string) => Promise<void>
    reorderPhotos: (ids: string[]) => Promise<void>
    getPhotoGrid: () => boolean
    setPhotoGrid: (v: boolean) => void
    getGridOpacity: () => number
    setGridOpacity: (v: number) => void
    getCardBlur: () => number
    setCardBlur: (v: number) => void
    getPlainBlur: () => number
    setPlainBlur: (v: number) => void
    getGlowBlur: () => number
    setGlowBlur: (v: number) => void
    getPlainGrid: () => number
    setPlainGrid: (v: number) => void
    getGlowGrid: () => number
    setGlowGrid: (v: number) => void
    getGlowSpeed: () => number
    setGlowSpeed: (v: number) => void
    getPlainHsl: () => { h: number; s: number; l: number }
    setPlainHsl: (v: { h: number; s: number; l: number }) => void
    getGlowHsl: () => { h: number; s: number; l: number }
    setGlowHsl: (v: { h: number; s: number; l: number }) => void
    getPhotoHsl: () => { h: number; s: number; l: number }
    setPhotoHsl: (v: { h: number; s: number; l: number }) => void
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

/** ——「指哪打哪」标注引擎：按钮 → 蓝色冒泡光标 → 点击弹输入框 → ✓ 打包进对话框（不发送） —— */
type AnnotState = {
  on: boolean
  started: boolean
  drawing: boolean
  px: number
  py: number
  bx0: number
  by0: number
  bx1: number
  by1: number
  ex: number
  ey: number
  draft: string
  resp: string
  stat: string
}
let annotState: AnnotState = { on: false, started: false, drawing: false, px: 0, py: 0, bx0: 0, by0: 0, bx1: 0, by1: 0, ex: 0, ey: 0, draft: '', resp: '', stat: '' }
const annotListeners = new Set<() => void>()
function setAnnot(patch: Partial<AnnotState>) {
  annotState = { ...annotState, ...patch }
  for (const fn of annotListeners) fn()
}
function subscribeAnnot(fn: () => void) { annotListeners.add(fn); return () => { annotListeners.delete(fn) } }

/** 进入瞄准模式（resp = 窗口编号等上下文，由调用方拼好） */
function startAnnot(resp: string) {
  document.body.classList.add('dsh-wt-annotating')
  setAnnot({ on: true, started: false, drawing: false, resp, stat: '', draft: '' })
}
function cancelAnnot() {
  document.body.classList.remove('dsh-wt-annotating')
  setAnnot({ on: false, started: false, drawing: false })
}

/** 窗口身份（约定：左栏 → 顶行 → 主行，从 1 起；附窗格标题与内容类型/URL，让接收方无需猜"这是哪个界面"） */
function windowLabelOf(row: PaneRow, index: number): string {
  const spec = splitStore.spec
  if (!spec) return '窗口?'
  let num = spec.left ? 2 : 1
  if (row === 'left') num = 1
  else if (row === 'top') num = num + index
  else { num += (spec.top?.length ?? 0) + index }
  let label = '窗口' + num
  const pane = row === 'left' ? spec.left : row === 'top' ? spec.top?.[index] : spec.main?.[index]
  const title = pane?.title
  if (title) label += '「' + title + '」'
  const tab = pane?.tabs?.[pane.active ?? 0]
  const c = tab?.content
  if (c) {
    try {
      if (c.kind === 'iframe' && c.url) label += '（网页 ' + new URL(c.url).hostname + '）'
      else if (c.kind === 'builtin') {
        label += '（内置·' + c.type
        try { if (c.url) label += ' ' + new URL(c.url).hostname } catch {}
        label += '）'
      }
      else if (c.kind === 'file') label += '（文件）'
    } catch {}
  }
  return label
}

/** 被点元素上下文（标签 + 类名 + 文字） */
function ctxOf(t: EventTarget | null): string {
  const el = t instanceof Element ? t : null
  if (!el || el === document.documentElement || el === document.body) return ''
  const tag = el.tagName.toLowerCase()
  const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 4).join('.')
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  let out = '<' + tag + (cls ? ' .' + cls : '') + '>'
  if (text) out += '「' + text + '」'
  try { const cs = getComputedStyle(el); out += '（字号 ' + cs.fontSize + '）' } catch {}
  return out
}

/** 框选 payload v3.1：主目标 = 框中心点【光标下的字符】所在的 Text 节点（caretPositionFromPoint，
 *  标签即使不是独立元素也能取到真正的词/段）；样式取该 Text 节点的父元素（真实渲染值）；
 *  整行 = 最近的高度≤44px 祖先的内容（供「这行字是什么」类问题）；候选 = 相交的独立短文本。 */
function boxPayload(x0: number, y0: number, x1: number, y1: number): { primary: { text: string; fontSize: string; lineHeight: string; color: string } | null; line: string; candidates: string[]; limited: boolean; src: string } {
  const L = Math.min(x0, x1)
  const T = Math.min(y0, y1)
  const R = Math.max(x0, x1)
  const B = Math.max(y0, y1)
  const cx = (L + R) / 2
  const cy = (T + B) / 2
  let primary: { text: string; fontSize: string; lineHeight: string; color: string } | null = null
  let line = ''
  let candidates: string[] = []
  let limited = false
  let src = ''
  // 在某 document 内取字（rect = 该 doc 视口在顶层页面的偏移）
  const readDoc = (doc: Document, ox: number, oy: number): boolean => {
    let ok = false
    let textParent: HTMLElement | null = null
    try {
      const pd = doc as any
      const px = cx - ox
      const py = cy - oy
      let pos: any = null
      try { if (pd.caretPositionFromPoint) pos = pd.caretPositionFromPoint(px, py) } catch {}
      if (!pos) { try { if (pd.caretRangeFromPoint) pos = pd.caretRangeFromPoint(px, py) } catch {} }
      const textNode: Node | null = pos ? (pos.offsetNode ?? pos.startContainer ?? null) : null
      if (textNode) {
        const parent = textNode.parentElement
        if (parent) {
          textParent = parent
          const text = (textNode.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
          if (text) {
            const cs = getComputedStyle(parent)
            primary = { text, fontSize: cs.fontSize, lineHeight: cs.lineHeight, color: cs.color }
            ok = true
          }
        }
      }
    } catch {}
    // 整行
    if (textParent) {
      try {
        let el: HTMLElement | null = textParent
        while (el && el !== doc.body) {
          const r = el.getBoundingClientRect()
          if (r.height >= 8 && r.height <= 44 && r.width > 0) {
            const t = (el.innerText || '').replace(/\s+/g, ' ').trim()
            if (t) { line = t.slice(0, 120); break }
          }
          el = el.parentElement
        }
      } catch {}
    }
    // 候选
    const seen = new Set<string>()
    if (primary) seen.add(primary.text)
    const cs: string[] = []
    try {
      for (const el of Array.from(doc.querySelectorAll<HTMLElement>('*'))) {
        const tag = el.tagName.toLowerCase()
        if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path' || tag === 'br' || tag === 'template' || tag === 'iframe') continue
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        if (rect.right + ox < L || rect.left + ox > R || rect.bottom + oy < T || rect.top + oy > B) continue
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ')
        if (text.length < 1 || text.length > 30) continue
        if (seen.has(text)) continue
        seen.add(text)
        cs.push(text)
        if (cs.length >= 4) break
      }
    } catch {}
    if (ok || cs.length > 0) candidates = cs
    return ok
  }
  // 1) 顶层文档
  readDoc(document, 0, 0)
  // 2) 顶层取不到 → 中心点所在 iframe 下钻（同源可读；跨域标记受限于 src）
  if (!primary) {
    try {
      for (const iframe of Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'))) {
        try {
          const r = iframe.getBoundingClientRect()
          if (r.width <= 0 || r.height <= 0) continue
          if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue
          src = iframe.getAttribute('src') ?? ''
          let inner: Document | null = null
          try { inner = iframe.contentDocument } catch { inner = null }
          if (inner) readDoc(inner, r.left, r.top)
          else limited = true
          break
        } catch { continue }
      }
    } catch {}
  }
  return { primary, line, candidates, limited, src }
}

/** 更新方法：复制给 AI 的升级指令（插件不自更新；升级由用户或其 Agent 执行 + 重启） */
const UPGRADE_CMD = 'dsh plugin --profile web add "https://github.com/Aisland-SJL/dsh-worktable/releases/latest/download/dsh-worktable.tgz"'
const UPGRADE_AI = '帮我升级 dsh-worktable：执行 ' + UPGRADE_CMD + '，完成后提醒我重启 dsh web 并刷新页面'

async function copyTextSafe(text: string): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true } } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

/** 注入宿主对话框输入框（不发送）；失败返回 false */
function fillHostInput(text: string): boolean {
  try {
    const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-phase]')
      ?? Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea')).pop()
    if (!ta) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    // 连续标注：已有内容不顶掉，换行追加（用户可以同一对话连续标注多处）
    const next = ta.value && ta.value.trim() ? ta.value + '\n\n' + text : text
    if (setter) setter.call(ta, next)
    else ta.value = next
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    try {
      ta.focus()
      ta.dispatchEvent(new Event('change', { bubbles: true }))
      ta.setSelectionRange(ta.value.length, ta.value.length)
    } catch {}
    return true
  } catch {
    return false
  }
}

/** ✓ 确认：打包并注入，不发送 */
function confirmAnnot() {
  const s = annotState
  const text = '📌 标注-' + s.resp + '\n' + (s.stat || '') + '\n要求：' + (s.draft.trim() || '（未填写）')
    + '\n【工作台标注·已定位，直接作答，无需再问；仅当确实无法从标注定位时才问一次。数据缺失或标注标注读取受限时，如实说明无法确定，禁止编造数值；可建议提供截图或使用视觉模型会话】'
  const ok = fillHostInput(text)
  if (!ok) {
    try {
      navigator.clipboard?.writeText(text).catch(() => { try { window.prompt('标注已生成，请手动复制：', text) } catch {} })
    } catch {
      try { window.prompt('标注已生成，请手动复制：', text) } catch {}
    }
  }
  cancelAnnot()
}

/** 标注浮层：瞄准气泡 + 输入编辑器（每个工作区渲染一次；fixed 定位） */
function AnnotationOverlay() {
  const [, setTick] = useState(0)
  useEffect(() => subscribeAnnot(() => setTick((t) => t + 1)), [])
  const s = annotState
  useEffect(() => {
    if (!s.on || s.started) return
    let sx = 0
    let sy = 0
    let dragging = false
    const isUi = (e: MouseEvent) => e.target instanceof Element && e.target.closest('.dsh-wt_annotUi') != null
    const onMove = (e: MouseEvent) => {
      if (!annotState.on || annotState.started) return
      if (annotState.drawing) setAnnot({ bx1: e.clientX, by1: e.clientY, px: e.clientX, py: e.clientY })
      else setAnnot({ px: e.clientX, py: e.clientY })
    }
    const onDown = (e: MouseEvent) => {
      if (!annotState.on || annotState.started || isUi(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      sx = e.clientX
      sy = e.clientY
      dragging = true
      setAnnot({ drawing: true, bx0: sx, by0: sy, bx1: sx, by1: sy })
    }
    const onUp = (e: MouseEvent) => {
      if (!annotState.on || annotState.started || !dragging) return
      e.preventDefault()
      e.stopImmediatePropagation()
      dragging = false
      const w = Math.abs(e.clientX - sx)
      const h = Math.abs(e.clientY - sy)
      const paneEl = (e.target instanceof Element ? e.target.closest('.dsh-wt_pane') : null) as HTMLElement | null
      let stat = ''
      if (Math.max(w, h) >= 8) {
        // 框选：中心/宽高 + 窗口内百分比 + 框内可见文字聚合
        const L = Math.min(sx, e.clientX)
        const T = Math.min(sy, e.clientY)
        const R = Math.max(sx, e.clientX)
        const B = Math.max(sy, e.clientY)
        stat = '框选屏幕 (' + Math.round(L) + ',' + Math.round(T) + ') → (' + Math.round(R) + ',' + Math.round(B) + ') 宽高 (' + Math.round(w) + '×' + Math.round(h) + 'px)'
        if (paneEl) {
          const pr = paneEl.getBoundingClientRect()
          const rx1 = (((L - pr.left) / Math.max(1, pr.width)) * 100).toFixed(1)
          const ry1 = (((T - pr.top) / Math.max(1, pr.height)) * 100).toFixed(1)
          const rx2 = (((R - pr.left) / Math.max(1, pr.width)) * 100).toFixed(1)
          const ry2 = (((B - pr.top) / Math.max(1, pr.height)) * 100).toFixed(1)
          stat += '，窗口内 (' + rx1 + '%,' + ry1 + '%)→(' + rx2 + '%,' + ry2 + '%)'
        }
        const hit = boxPayload(L, T, R, B)
        if (hit.primary) stat += '，主目标：' + hit.primary.text + '（字号 ' + hit.primary.fontSize + '，行高 ' + hit.primary.lineHeight + '）'
        if (hit.line) stat += '；整行：' + hit.line
        if (hit.limited) stat += '；读取受限：跨域页面内容不可见（浏览器安全限制），窗口身份见上（' + (hit.src ? hit.src : '无URL') + '）'
        if (hit.candidates.length > 0) stat += '；候选：' + hit.candidates.map((t, i) => '[' + (i + 1) + ']' + t).join(' ')
      } else {
        stat = '屏幕坐标 (' + Math.round(e.clientX) + ', ' + Math.round(e.clientY) + ')'
        if (paneEl) {
          const r = paneEl.getBoundingClientRect()
          const rx = (((e.clientX - r.left) / Math.max(1, r.width)) * 100).toFixed(1)
          const ry = (((e.clientY - r.top) / Math.max(1, r.height)) * 100).toFixed(1)
          stat += '，窗口内 (' + rx + '%, ' + ry + '%)'
        }
        const ctx = ctxOf(e.target)
        if (ctx) stat += '，元素 ' + ctx
      }
      document.body.classList.remove('dsh-wt-annotating')
      const ex = Math.max(8, Math.min(e.clientX + 10, window.innerWidth - 288))
      const ey = Math.max(8, Math.min(e.clientY + 14, window.innerHeight - 148))
      setAnnot({ started: true, drawing: false, ex, ey, stat })
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelAnnot() }
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('mouseup', onUp, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mouseup', onUp, true)
      window.removeEventListener('keydown', onKey, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.on, s.started])
  // 首次进入标注：右侧气泡提示「拖动也可框选」，仅显示一次
  const [hintOnce] = useState<boolean>(() => { try { return localStorage.getItem('dsh.worktable.annotHint.v1') !== '1' } catch { return false } })
  const [hintVisible, setHintVisible] = useState(false)
  useEffect(() => {
    if (!s.on || !hintOnce) return
    setHintVisible(true)
    try { localStorage.setItem('dsh.worktable.annotHint.v1', '1') } catch {}
    const t = window.setTimeout(() => setHintVisible(false), 4200)
    return () => window.clearTimeout(t)
  }, [s.on, hintOnce])
  if (!s.on) return null
  {hintVisible && (
    <div className="dsh-wt_annotUi dsh-wt_annotHint">{T('annot.hint')}</div>
  )}
  if (s.drawing) {
    const L = Math.min(s.bx0, s.bx1)
    const T = Math.min(s.by0, s.by1)
    const R = Math.max(s.bx0, s.bx1)
    const B = Math.max(s.by0, s.by1)
    return <div className="dsh-wt_annotUi dsh-wt_annotSel" style={{ left: L, top: T, width: R - L, height: B - T }} />
  }
  if (!s.started) {
    return (
      <div className="dsh-wt_annotUi dsh-wt_annotBubble" style={{ left: s.px, top: s.py }} aria-hidden>
        <svg width="12" height="12" viewBox="0 0 16 16"><path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </div>
    )
  }
  return (
    <div className="dsh-wt_annotUi dsh-wt_annotEditor" style={{ left: s.ex, top: s.ey }}>
      <textarea
        className="dsh-wt_annotInput"
        autoFocus
        value={s.draft}
        placeholder={T('annot.placeholder')}
        onChange={(e) => setAnnot({ draft: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmAnnot() }
          if (e.key === 'Escape') cancelAnnot()
        }}
      />
      <div className="dsh-wt_annotBtns">
        <button type="button" className="dsh-wt_annotOk" title={T('annot.ok')} aria-label={T('annot.ok')} onClick={confirmAnnot}>✓</button>
        <button type="button" className="dsh-wt_annotNo" title={T('annot.cancel')} aria-label={T('annot.cancel')} onClick={cancelAnnot}>✕</button>
      </div>
    </div>
  )
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
    // 存档 sanitize：chatW 等尺寸按本布局规格钳制（防老版本/脏存值越界，如 1067 > max 600）
    if (this.geom) {
      const minContent = main.reduce((a: number, p: SplitPane) => a + p.min, 0) + Math.max(0, main.length - 1) * GAP
      const hi = Math.max(spec.chatWidth.min, (this.geom.right - this.geom.left) - minContent)
      this.chatW = clamp(Math.round(this.chatW), spec.chatWidth.min, hi)
    }
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
        const avail = Math.max(main.length * 120, contentW - Math.max(0, main.length - 1) * GAP)
        const share = Math.round(avail / main.length)
        this.paneWs = main.map((p) => Math.max(p.min, share))
      }
      if (!hasTopWs) {
        // chatFull 时顶行只占内容侧（扣除聊天列宽）
        const chatW0 = spec.chatFullHeight === true ? this.chatW : 0
        const rowW = Math.max(0, colW0 - chatW0 - (left ? this.leftW : 0))
        const avail = Math.max(top.length * 120, rowW - Math.max(0, top.length - 1) * GAP)
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
    const minContent = main.reduce((a, p) => a + p.min, 0) + Math.max(0, main.length - 1) * GAP
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
    const hi = Math.max(lo, contentW - othersMin - Math.max(0, main.length - 1) * GAP)
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
    const hi = Math.max(lo, colW - othersMin - Math.max(0, top.length - 1) * GAP)
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

  /** 更新指定标签页的内容（浏览器/动画窗地址栏回车时回写），并持久化到布局条目 */
  setTabContent(row, index, tabId, content) {
    const spec = this.spec
    if (!spec) return
    const mutate = (pane: SplitPane): SplitPane => {
      const tabs = (pane.tabs ?? []).map((t) => (t.id === tabId ? { ...t, content, title: tabTitleOf(content) } : t))
      return { ...pane, tabs }
    }
    if (row === 'left') {
      if (spec.left && index === 0) this.spec = { ...spec, left: mutate(spec.left) }
    } else if (row === 'top') {
      const top = [...(spec.top ?? [])]
      if (top[index]) { top[index] = mutate(top[index]); this.spec = { ...spec, top } }
    } else {
      const main = [...spec.main]
      if (main[index]) { main[index] = mutate(main[index]); this.spec = { ...spec, main } }
    }
    this.onSpecMutated?.(this.spec)
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

  toggleCollapsed(row, i) {
    const spec = this.spec
    if (!spec) return
    const mutate = (pane: SplitPane): SplitPane => ({ ...pane, collapsed: !pane.collapsed })
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
  const gapTotal = Math.max(0, panes.length - 1) * GAP
  const avail = Math.max(0, total - gapTotal)
  let x = 0
  panes.forEach((p, i) => {
    const w = i === panes.length - 1 ? Math.max(0, avail - x) : ws[i]
    out.push({ pane: p, left: x, width: w })
    x += w + GAP
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
        const prefix = splitStore.paneWs.slice(0, index).reduce((a, b) => a + b, 0) + index * GAP
        splitStore.setPaneW(index, ev.clientX - (g.left + prefix))
      } else if (kind === 'topPane' && index != null) {
        const prefix = splitStore.topWs.slice(0, index).reduce((a, b) => a + b, 0) + index * GAP
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
function BrowserPane(props: { row: PaneRow; index: number; tabId: string; content: SplitContent; reloadKey: number }) {
  const initial = props.content?.url || 'https://example.com'
  const [url, setUrl] = useState(initial)
  const [src, setSrc] = useState(initial)
  const go = () => {
    const u = url.trim()
    const ok = /^(\/|https?:\/\/)/i.test(u) ? u : 'about:blank'
    setSrc(ok)
    if (ok !== 'about:blank') {
      // 地址回写：刷新/重开布局时保持当前网址
      splitStore.setTabContent(props.row, props.index, props.tabId, { kind: 'builtin', type: 'browser', url: ok })
    }
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
function AnimPane(props: { row: PaneRow; index: number; tabId: string; content: SplitContent; reloadKey: number }) {
  const initial = props.content?.url || ''
  const [url, setUrl] = useState(initial)
  const [src, setSrc] = useState(initial || 'about:blank')
  const go = () => {
    const u = url.trim()
    const ok = /^(\/|https?:\/\/)/i.test(u) ? u : 'about:blank'
    setSrc(ok)
    if (ok !== 'about:blank') {
      splitStore.setTabContent(props.row, props.index, props.tabId, { kind: 'builtin', type: 'anim', url: ok })
    }
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

/** 主题图标（描边风格）：dark=月 / light=日 / system=电脑；主按钮与下拉共用 */
function ThemeIcon({ mode, size }: { mode: 'dark' | 'light' | 'system'; size?: number }) {
  const s = size ?? 18
  if (mode === 'dark') return <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden><path d="M14 8.53A6 6 0 1 1 7.47 2 4.67 4.67 0 0 0 14 8.53z" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" /></svg>
  if (mode === 'light') return <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" strokeWidth="0.9" /><path d="M8 1.6v1.7M8 12.7v1.7M1.6 8h1.7M12.7 8h1.7M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" /></svg>
  return <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden><rect x="2" y="3.2" width="12" height="8.8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="0.9" /><path d="M5.4 14.4h5.2M8 12v2.4" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" /></svg>
}

/** 两行滑杆图标（设置入口）：2 条轨道 + 2 个旋钮，描边风格 */
function SliderIcon({ size }: { size?: number }) {
  const s = size ?? 14
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden>
      <path d="M2.5 5.6h11M2.5 10.4h11" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="10.4" cy="5.6" r="1.8" fill="currentColor" />
      <circle cx="5.8" cy="10.4" r="1.8" fill="currentColor" />
    </svg>
  )
}

/** HSL 数值普通输入框：始终为常规边框输入框，输入提交时自动钳制到 0..max */
function HslValInput(props: { value: number; max: number; min?: number; onCommit: (n: number) => void }) {
  const lo = props.min ?? 0
  const [draft, setDraft] = useState(String(props.value))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setDraft(String(props.value)) }, [props.value, focused])
  const commit = () => {
    let n = parseInt(draft, 10)
    if (!Number.isFinite(n)) n = props.value
    n = Math.min(Math.max(n, lo), props.max)
    props.onCommit(n)
  }
  return (
    <input
      className="dsh-wt_hslInput"
      type="number"
      min={lo}
      max={props.max}
      value={focused ? draft : String(props.value)}
      onFocus={() => { setFocused(true); setDraft(String(props.value)) }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setFocused(false); commit() }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(String(props.value)); (e.target as HTMLInputElement).blur() }
      }}
    />
  )
}

/** 纯色背景默认值（与主题关联）：深色 = 原深蓝黑 #0a0d13；浅色 = 白 #eef1f5；网格线由 --wt-grid 主题变量自动切换 */
const PLAIN_HSL_DARK = { h: -140, s: 31, l: 6 }
const PLAIN_HSL_LIGHT = { h: -146, s: 26, l: 95 }

/** 循环视频背景：首尾帧交叉渐变——双轨重叠过渡（尾帧淡出→头帧淡入），消除循环「卡一下」。
 *  两轨共用同一源；备用轨仅在交接窗口播放，其余时间暂停（解码负担仅 ~1.2s/循环）。 */
function ConsoleVideo(props: { src: string; style?: CSSProperties }) {
  const aRef = useRef<HTMLVideoElement | null>(null)
  const bRef = useRef<HTMLVideoElement | null>(null)
  const roleRef = useRef<'a' | 'b'>('a')
  const firedRef = useRef(false)
  useEffect(() => {
    const role = () => (roleRef.current === 'a' ? aRef.current : bRef.current)
    const spare = () => (roleRef.current === 'a' ? bRef.current : aRef.current)
    firedRef.current = false
    let raf = 0
    let stopped = false
    const onEnded = () => {
      const m = role()
      const s = spare()
      if (!m || !s) return
      // 主轨播完：备用轨已成为新主轨（淡入完成）；旧主轨复位为备用轨
      roleRef.current = roleRef.current === 'a' ? 'b' : 'a'
      firedRef.current = false
      try {
        m.currentTime = 0
        m.pause()
        m.style.opacity = '0'
        m.getAnimations().forEach((an) => an.cancel())
      } catch {}
      try {
        const nm = role()
        if (nm) nm.style.opacity = '1'
      } catch {}
    }
    const tick = () => {
      if (stopped) return
      const m = role()
      const s = spare()
      if (m && s && !m.paused && m.readyState >= 2 && !firedRef.current) {
        const d = m.duration
        if (Number.isFinite(d) && d > 0) {
          const fade = Math.min(2.0, Math.max(1.2, d * 0.18))
          if (m.currentTime >= Math.max(0, d - fade)) {
            firedRef.current = true
            try {
              try { s.currentTime = 0 } catch {}
              const startFade = () => {
                try {
                  try { m.getAnimations().forEach((an) => an.cancel()) } catch {}
                  try { s.getAnimations().forEach((an) => an.cancel()) } catch {}
                  s.play().catch(() => {})
                  s.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fade * 1000, easing: 'linear', fill: 'forwards' })
                  m.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fade * 1000, easing: 'linear', fill: 'forwards' })
                } catch {}
              }
              if (s.readyState >= 2) startFade()
              else s.addEventListener('canplay', startFade, { once: true })
            } catch {}
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    aRef.current?.addEventListener('ended', onEnded)
    bRef.current?.addEventListener('ended', onEnded)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      aRef.current?.removeEventListener('ended', onEnded)
      bRef.current?.removeEventListener('ended', onEnded)
    }
  }, [])
  return (
    <>
      <video ref={aRef} className="dsh-wt_consoleMedia" src={props.src} muted autoPlay playsInline style={props.style} />
      <video ref={bRef} className="dsh-wt_consoleMedia" src={props.src} muted playsInline style={{ ...props.style, opacity: 0 }} />
    </>
  )
}

/** 控制室面板：项目卡片网格（每行 3 张、超出换行）；数据由工作台组装推送（纯读镜像）。
 *  主题：dark/light 直接生效；system = 跟随宿主 html 的 color-scheme（DSH 深色/白色/跟随系统都会反映到它） */
function ConsolePane() {
  const [, setTick] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [cols, setColsState] = useState<number>(() => splitEnv?.console?.getCols?.() ?? 3)
  const [shape, setShapeState] = useState<'square' | 'circle'>(() => splitEnv?.console?.getShape?.() ?? 'square')
  const [bg, setBgState] = useState<'plain' | 'glow' | 'photo'>(() => splitEnv?.console?.getBg?.() ?? 'glow')
  const [bgPhoto, setBgPhoto] = useState<string>('')
  const [photoId, setPhotoIdLocal] = useState<string>('')
  const [photoList, setPhotoList] = useState<{ id: string; kind: 'photo' | 'video'; url: string }[]>([])
  const [bgVideo, setBgVideo] = useState<string>('')
  const [photoGrid, setPhotoGridState] = useState<boolean>(() => splitEnv?.console?.getPhotoGrid?.() ?? true)
  const [gridOpacity, setGridOpacityState] = useState<number>(() => splitEnv?.console?.getGridOpacity?.() ?? 8)
  const [cardBlur, setCardBlurState] = useState<number>(() => splitEnv?.console?.getCardBlur?.() ?? 8)
  const [plainBlur, setPlainBlurState] = useState<number>(() => splitEnv?.console?.getPlainBlur?.() ?? 0)
  const [glowBlur, setGlowBlurState] = useState<number>(() => splitEnv?.console?.getGlowBlur?.() ?? 8)
  const [plainGrid, setPlainGridState] = useState<number>(() => splitEnv?.console?.getPlainGrid?.() ?? 5)
  const [glowGrid, setGlowGridState] = useState<number>(() => splitEnv?.console?.getGlowGrid?.() ?? 8)
  const [glowSpeed, setGlowSpeedState] = useState<number>(() => splitEnv?.console?.getGlowSpeed?.() ?? 50)
  const [annOpen, setAnnOpen] = useState(false)
  const [updStatus, setUpdStatus] = useState<UpdateStatus>(() => readCache().status)
  const [updInfo, setUpdInfo] = useState<UpdateInfo | null>(() => readCache().info)
  const [autoCheckOn, setAutoCheckOn] = useState<boolean>(() => getAutoCheck())
  const updBusyRef = useRef(false)
  const photoUrlRef = useRef<string>('')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [bgEdit, setBgEdit] = useState<'plain' | 'glow' | 'photo' | null>(null)
  const [plainHsl, setPlainHslState] = useState<{ h: number; s: number; l: number }>(() => {
    const saved = splitEnv?.console?.getPlainHsl?.()
    if (saved) return saved
    return splitEnv?.console?.getTheme?.() === 'light' ? { ...PLAIN_HSL_LIGHT } : { ...PLAIN_HSL_DARK }
  })
  const [glowHsl, setGlowHslState] = useState<{ h: number; s: number; l: number }>(() => splitEnv?.console?.getGlowHsl?.() ?? { h: 0, s: 100, l: 100 })
  const [photoHsl, setPhotoHslState] = useState<{ h: number; s: number; l: number }>({ h: 0, s: 100, l: 100 })
  const gridRef = useRef<HTMLDivElement | null>(null)
  const firstRectsRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  const onCols = (n: number) => {
    const grid = gridRef.current
    if (grid) {
      const rects = new Map<string, { x: number; y: number }>()
      grid.querySelectorAll('.dsh-wt_consoleCard').forEach((el) => {
        const key = (el as HTMLElement).dataset.flip ?? ''
        const r = el.getBoundingClientRect()
        rects.set(key, { x: r.left, y: r.top })
      })
      firstRectsRef.current = rects
    }
    setColsState(n)
    splitEnv?.console?.setCols?.(n)
  }
  const onShape = (s: 'square' | 'circle') => {
    setShapeState(s)
    splitEnv?.console?.setShape?.(s)
  }
  /** 选择本地图片文件并入库 */
  const pickPhotoFile = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,video/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      onFilePhoto(file)
    }
    input.click()
  }
  /** 新增媒体（照片/视频）：原始 Blob 存 IndexedDB（零压缩），显示用对象 URL；自动设为当前 */
  const onFilePhoto = async (file: Blob) => {
    let id = ''
    let url = ''
    let kind: 'photo' | 'video' = file.type && file.type.indexOf('video/') === 0 ? 'video' : 'photo'
    const rec = await (splitEnv?.console?.addPhoto?.(file) ?? Promise.resolve(null)).catch(() => null)
    if (rec) { id = rec.id; url = rec.url; kind = rec.kind } else {
      url = URL.createObjectURL(file)
    }
    photoUrlRef.current = url
    setPhotoIdLocal(id)
    if (id) setPhotoList((prev) => [{ id, kind, url }, ...prev])
    if (kind === 'video') { setBgPhoto(''); setBgVideo(url) } else { setBgVideo(''); setBgPhoto(url) }
    setBgState('photo')
    splitEnv?.console?.setBg?.('photo')
  }
  /** 删除一条媒体：当前使用的那条被删 → 切到最新一条；删光 → 回到流光背景 */
  const removePhotoById = async (p: { id: string; kind: 'photo' | 'video'; url: string }) => {
    try { await splitEnv?.console?.removePhoto?.(p.id) } catch {}
    try { URL.revokeObjectURL(p.url) } catch {}
    const nextList = photoList.filter((x) => x.id !== p.id)
    setPhotoList(nextList)
    if (photoId === p.id) {
      const next = nextList[0] ?? null
      if (next) {
        setPhotoIdLocal(next.id)
        splitEnv?.console?.setPhotoId?.(next.id)
        photoUrlRef.current = next.url
        setBgVideo(next.kind === 'video' ? next.url : '')
        setBgPhoto(next.kind === 'video' ? '' : next.url)
        setBgState('photo')
        splitEnv?.console?.setBg?.('photo')
      } else {
        setPhotoIdLocal('')
        photoUrlRef.current = ''
        setBgPhoto('')
        setBgVideo('')
        setBgState('glow')
        splitEnv?.console?.setBg?.('glow')
      }
    }
  }
  const togglePhotoGrid = () => {
    const next = !photoGrid
    setPhotoGridState(next)
    splitEnv?.console?.setPhotoGrid?.(next)
  }
  const onGridOpacity = (n: number) => {
    const v = Math.min(Math.max(Math.round(n), 0), 30)
    setGridOpacityState(v)
    splitEnv?.console?.setGridOpacity?.(v)
  }
  const onCardBlur = (n: number) => {
    const v = Math.min(Math.max(Math.round(n), 0), 20)
    setCardBlurState(v)
    splitEnv?.console?.setCardBlur?.(v)
  }
  const onModeBlur = (kind: 'plain' | 'glow' | 'photo', n: number) => {
    const v = Math.min(Math.max(Math.round(n), 0), 20)
    if (kind === 'plain') { setPlainBlurState(v); splitEnv?.console?.setPlainBlur?.(v) }
    else if (kind === 'glow') { setGlowBlurState(v); splitEnv?.console?.setGlowBlur?.(v) }
    else { setCardBlurState(v); splitEnv?.console?.setCardBlur?.(v) }
  }
  const onModeGrid = (kind: 'plain' | 'glow', n: number) => {
    const v = Math.min(Math.max(Math.round(n), 0), 30)
    if (kind === 'plain') { setPlainGridState(v); splitEnv?.console?.setPlainGrid?.(v) }
    else { setGlowGridState(v); splitEnv?.console?.setGlowGrid?.(v) }
  }
  const onGlowSpeed = (n: number) => {
    const v = Math.min(Math.max(Math.round(n), 0), 100)
    setGlowSpeedState(v)
    splitEnv?.console?.setGlowSpeed?.(v)
  }
  const runUpdateCheck = async (force: boolean) => {
    if (updBusyRef.current) return
    updBusyRef.current = true
    setUpdStatus('checking')
    try {
      const r = await checkUpdate(force)
      setUpdStatus(r.status)
      setUpdInfo(r.info)
    } finally {
      updBusyRef.current = false
    }
  }
  const [updCopied, setUpdCopied] = useState(false)
  const onCopyUpgrade = async () => {
    const ok = await copyTextSafe(UPGRADE_AI)
    if (ok) { setUpdCopied(true); window.setTimeout(() => setUpdCopied(false), 2200) }
  }
  const onSkipVersion = () => {
    if (updInfo) { setSkipVersion(updInfo.latest); setUpdInfo(null); setUpdStatus('uptodate') }
  }
  const onAutoCheckToggle = () => {
    const next = !autoCheckOn
    setAutoCheckOn(next)
    storeAutoCheck(next)
    if (next) void runUpdateCheck(false)
  }
  /** 抓手拖拽排序：按住抓手上下移动 → 行实时重排，松手持久化 */
  const dragRowRef = useRef<string | null>(null)
  const dragFlipRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  const lastTargetRef = useRef<number>(-1)
  const [dragRowId, setDragRowId] = useState<string | null>(null)
  // FLIP：落位提交后，其他行从旧位置平滑让位（260ms 缓出）
  useLayoutEffect(() => {
    const first = dragFlipRef.current
    if (!first) return
    dragFlipRef.current = null
    document.querySelectorAll<HTMLElement>('.dsh-wt_photoRow').forEach((el) => {
      const key = el.dataset.rid ?? ''
      const f = first.get(key)
      if (!f) return
      const r = el.getBoundingClientRect()
      const dx = f.x - r.left
      const dy = f.y - r.top
      if (dx || dy) el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.25,.6,.3,1)' })
    })
  }, [photoList])
  const onHandleDown = (id: string, e: { button: number; preventDefault: () => void; stopPropagation: () => void }) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragRowRef.current = id
    lastTargetRef.current = photoList.findIndex((x) => x.id === id)
    setDragRowId(id)
    const onMove = (ev: PointerEvent) => {
      if (dragRowRef.current !== id) return
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.dsh-wt_photoRow'))
      if (rows.length === 0) return
      // 槽位制：按固定行高算最近槽位；边界 ±0.12 行高为死区，未决定性越过前不切换
      const first = rows[0].getBoundingClientRect()
      const h = first.height
      const rel = (ev.clientY - first.top) / h
      let t = Math.max(0, Math.min(rows.length - 1, Math.floor(rel + 0.5)))
      const frac = rel - Math.floor(rel)
      if (Math.abs(frac - 0.5) < 0.12) t = lastTargetRef.current
      if (t === lastTargetRef.current) return
      const from = photoList.findIndex((x) => x.id === id)
      if (from < 0) return
      const rects = new Map<string, { x: number; y: number }>()
      rows.forEach((el) => { const k = el.dataset.rid ?? ''; const r = el.getBoundingClientRect(); rects.set(k, { x: r.left, y: r.top }) })
      const next = [...photoList]
      const moved = next.splice(from, 1)[0]
      const to = Math.max(0, Math.min(t, next.length))
      next.splice(to, 0, moved)
      dragFlipRef.current = rects
      setPhotoList(next)
      lastTargetRef.current = t
    }
    const onUp = () => {
      dragRowRef.current = null
      setDragRowId(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const ids = photoList.map((x) => x.id)
      void splitEnv?.console?.reorderPhotos?.(ids).catch(() => {})
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  /** 在媒体库中选中某条 */
  const selectPhoto = (p: { id: string; kind: 'photo' | 'video'; url: string }) => {
    setPhotoIdLocal(p.id)
    splitEnv?.console?.setPhotoId?.(p.id)
    photoUrlRef.current = p.url
    if (p.kind === 'video') { setBgPhoto(''); setBgVideo(p.url) } else { setBgVideo(''); setBgPhoto(p.url) }
    setBgState('photo')
    splitEnv?.console?.setBg?.('photo')
  }
  const onBg = (m: 'plain' | 'glow' | 'photo') => {
    if (m === 'photo') {
      // 直接切换到当前媒体；没有媒体时才进入二级菜单引导上传
      if (photoList.length === 0) { setBgEdit('photo'); return }
      setBgState('photo')
      splitEnv?.console?.setBg?.('photo')
      return
    }
    setBgState(m)
    splitEnv?.console?.setBg?.(m)
  }
  const editHsl = (kind: 'plain' | 'glow' | 'photo', patch: Partial<{ h: number; s: number; l: number }>) => {
    if (kind === 'plain') {
      const next = { ...plainHsl, ...patch }
      setPlainHslState(next)
      splitEnv?.console?.setPlainHsl?.(next)
    } else if (kind === 'glow') {
      const next = { ...glowHsl, ...patch }
      setGlowHslState(next)
      splitEnv?.console?.setGlowHsl?.(next)
    } else {
      const next = { ...photoHsl, ...patch }
      setPhotoHslState(next)
      if (photoId) splitEnv?.console?.setPhotoHsl?.(photoId, next)
    }
  }
  const resetHsl = (kind: 'plain' | 'glow' | 'photo') => {
    // 恢复初始：连同贴片模糊(B)/网格不透明度(T)一起复位（纯色 B=0，流光/自定义 B=8）
    const blurDef = kind === 'plain' ? 0 : 8
    if (kind === 'plain') {
      setPlainBlurState(blurDef); splitEnv?.console?.setPlainBlur?.(blurDef)
      setPlainGridState(5); splitEnv?.console?.setPlainGrid?.(5)
    } else if (kind === 'glow') {
      setGlowBlurState(blurDef); splitEnv?.console?.setGlowBlur?.(blurDef)
      setGlowGridState(8); splitEnv?.console?.setGlowGrid?.(8)
      setGlowSpeedState(50); splitEnv?.console?.setGlowSpeed?.(50)
    } else {
      setCardBlurState(blurDef); splitEnv?.console?.setCardBlur?.(blurDef)
      setGridOpacityState(8); splitEnv?.console?.setGridOpacity?.(8)
    }
    if (kind === 'plain') {
      const def = resolvedTheme === 'light' ? { ...PLAIN_HSL_LIGHT } : { ...PLAIN_HSL_DARK }
      setPlainHslState(def)
      splitEnv?.console?.setPlainHsl?.(def)
    } else if (kind === 'glow') {
      setGlowHslState({ h: 0, s: 100, l: 100 })
      splitEnv?.console?.setGlowHsl?.({ h: 0, s: 100, l: 100 })
    } else {
      setPhotoHslState({ h: 0, s: 100, l: 100 })
      if (photoId) splitEnv?.console?.setPhotoHsl?.(photoId, { h: 0, s: 100, l: 100 })
      // 照片网格线开关一并复位为默认「开」
      setPhotoGridState(true); splitEnv?.console?.setPhotoGrid?.(true)
    }
  }
  useLayoutEffect(() => {
    const first = firstRectsRef.current
    if (!first) return
    const grid = gridRef.current
    if (!grid) return
    grid.querySelectorAll('.dsh-wt_consoleCard').forEach((el) => {
      const key = (el as HTMLElement).dataset.flip ?? ''
      const f = first.get(key)
      if (!f) return
      const r = el.getBoundingClientRect()
      const dx = f.x - r.left
      const dy = f.y - r.top
      if (dx || dy) {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.22,.61,.36,1)' })
      }
    })
    firstRectsRef.current = null
  }, [cols])
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
  // 自动检查更新（节流一天；手动按钮始终 force）
  useEffect(() => { if (getAutoCheck()) void runUpdateCheck(false) }, [])
  // 背景照片库：IndexedDB 异步加载记录 → 对象 URL；无记录则空
  useEffect(() => {
    let alive = true
    splitEnv?.console?.getPhotoLib?.().then((lib) => {
      if (!alive) return
      setPhotoList(lib.list)
      const active = lib.list.find((p) => p.id === lib.activeId) ?? lib.list[0] ?? null
      if (active) {
        setPhotoIdLocal(active.id)
        photoUrlRef.current = active.url
        setBgVideo(active.kind === 'video' ? active.url : '')
        setBgPhoto(active.kind === 'video' ? '' : active.url)
      }
    }).catch(() => {})
    return () => { alive = false }
  }, [])
  // 当前照片切换 → 载入该照片记住的 HSL 调节值
  useEffect(() => {
    if (!photoId) return
    setPhotoHslState(splitEnv?.console?.getPhotoHsl?.(photoId) ?? { h: 0, s: 100, l: 100 })
  }, [photoId])
  // 面板卸载时释放对象 URL
  useEffect(() => () => { if (photoUrlRef.current) { try { URL.revokeObjectURL(photoUrlRef.current) } catch {} } }, [])
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
  // 主题联动：切换主题时，若纯色还是另一主题的默认值 → 自动跟随新主题默认；自定义过则保持
  const prevPlainThemeRef = useRef<'dark' | 'light' | null>(null)
  useEffect(() => {
    const prev = prevPlainThemeRef.current
    prevPlainThemeRef.current = resolvedTheme
    if (!prev || prev === resolvedTheme) return
    const isDarkDef = plainHsl.h === PLAIN_HSL_DARK.h && plainHsl.s === PLAIN_HSL_DARK.s && plainHsl.l === PLAIN_HSL_DARK.l
    const isLightDef = plainHsl.h === PLAIN_HSL_LIGHT.h && plainHsl.s === PLAIN_HSL_LIGHT.s && plainHsl.l === PLAIN_HSL_LIGHT.l
    const next = resolvedTheme === 'light' && isDarkDef ? { ...PLAIN_HSL_LIGHT }
      : resolvedTheme === 'dark' && isLightDef ? { ...PLAIN_HSL_DARK } : null
    if (next) {
      setPlainHslState(next)
      splitEnv?.console?.setPlainHsl?.(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme])
  const fmtDur = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const ss = s % 60
    return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0') : m + ':' + String(ss).padStart(2, '0')
  }
  const statusLabel: Record<string, string> = { idle: T('console.idle'), busy: T('console.busy'), need: T('console.need'), done: T('console.done') }
  const themeOpts: { mode: 'dark' | 'light' | 'system'; key: string }[] = [
    { mode: 'dark', key: 'console.themeDark' },
    { mode: 'light', key: 'console.themeLight' },
    { mode: 'system', key: 'console.themeSystem' },
  ]
  return (
    <div className="dsh-wt_console" data-wt-theme={resolvedTheme} data-wt-shape={shape} data-wt-bg={bg} data-wt-grid={bg === 'photo' && !photoGrid ? 'off' : 'on'} style={{ ...(bg === 'plain' ? { ['--wt-bg' as any]: 'hsl(' + plainHsl.h + ', ' + plainHsl.s + '%, ' + plainHsl.l + '%)', ['--wt-gridPlain' as any]: 'rgba(255,255,255,' + (plainGrid / 100) + ')', ['--wt-gridPlainLight' as any]: 'rgba(27,31,36,' + (plainGrid / 100) + ')' } : {}), ...(bg === 'glow' ? { ['--wt-gridGlow' as any]: 'rgba(255,255,255,' + (glowGrid / 100) + ')', ['--wt-gridGlowLight' as any]: 'rgba(27,31,36,' + (glowGrid / 100) + ')', ['--wt-glowScale' as any]: glowSpeed === 0 ? '100000000' : String(50 / glowSpeed) } : {}), ...(bg === 'photo' ? { ['--wt-gridPhoto' as any]: 'rgba(255,255,255,' + (gridOpacity / 100) + ')' } : {}), ['--wt-cardBlur' as any]: (bg === 'plain' ? plainBlur : bg === 'glow' ? glowBlur : cardBlur) + 'px' }}>
      <span className="dsh-wt_consoleBg" aria-hidden style={bg === 'glow' && (glowHsl.h !== 0 || glowHsl.s !== 100 || glowHsl.l !== 100) ? { filter: 'hue-rotate(' + glowHsl.h + 'deg) saturate(' + glowHsl.s + '%) brightness(' + glowHsl.l + '%)' } : undefined}>
        {bg === 'photo' && (bgVideo
          ? <ConsoleVideo src={bgVideo} style={photoHsl.h !== 0 || photoHsl.s !== 100 || photoHsl.l !== 100 ? { filter: 'hue-rotate(' + photoHsl.h + 'deg) saturate(' + photoHsl.s + '%) brightness(' + photoHsl.l + '%)' } : undefined} />
          : bgPhoto ? <img className="dsh-wt_consoleMedia" src={bgPhoto} alt="" style={photoHsl.h !== 0 || photoHsl.s !== 100 || photoHsl.l !== 100 ? { filter: 'hue-rotate(' + photoHsl.h + 'deg) saturate(' + photoHsl.s + '%) brightness(' + photoHsl.l + '%)' } : undefined} /> : null)}
        {bg === 'glow' && (<><i className="dsh-wt_blob dsh-wt_blob1" /><i className="dsh-wt_blob dsh-wt_blob2" /><i className="dsh-wt_blob dsh-wt_blob3" /><i className="dsh-wt_blob dsh-wt_blob4" /></>)}</span>
      {openMenu !== null && <div className="dsh-wt_dropMask" onClick={() => setOpenMenu(null)} />}
      <div className="dsh-wt_consoleScroll">
        {annOpen ? (
          <div className="dsh-wt_announceCtr">
          <div className="dsh-wt_announce">
            <div className="dsh-wt_announceHead">
              <span className="dsh-wt_announceVer">{T('annot.curVer')} v{LOCAL_VERSION}</span>
              <button type="button" className="dsh-wt_announceBtn" disabled={updStatus === 'checking'} onClick={() => runUpdateCheck(true)}>{updStatus === 'checking' ? T('annot.checking') : T('annot.checkNow')}</button>
              <span className="dsh-wt_announceAuto">{T('annot.autoCheck')}</span>
              <button type="button" className={'dsh-wt_switch' + (autoCheckOn ? ' dsh-wt_switchOn' : '')} aria-pressed={autoCheckOn} aria-label={T('annot.autoCheck')} onClick={onAutoCheckToggle}><span className="dsh-wt_switchKnob" /></button>
            </div>
            {updInfo && (
              <div className="dsh-wt_announceUpdate">
                <span className="dsh-wt_announceNewVer">{T('annot.newVer')} v{updInfo.latest}</span>
                <button type="button" className={'dsh-wt_announceUpg' + (updCopied ? ' dsh-wt_announceUpgOk' : '')} onClick={onCopyUpgrade}>{updCopied ? T('annot.copied') : T('annot.copyUpgrade')}</button>
                <button type="button" className="dsh-wt_announceSkip dsh-wt_announceSkipGo" onClick={() => { try { window.open(updInfo.url, '_blank') } catch {} }}>{T('annot.gotoRelease')}</button>
                <button type="button" className="dsh-wt_announceSkip" onClick={onSkipVersion}>{T('annot.skipVer')}</button>
                <div className="dsh-wt_announceHow">{T('annot.howUpdate')}</div>
              </div>
            )}
            {updStatus === 'failed' && <div className="dsh-wt_announceStatus">{T('annot.checkFail')}</div>}
            {updStatus === 'uptodate' && !updInfo && <div className="dsh-wt_announceStatus">{T('annot.latest')}</div>}
            <div className="dsh-wt_announceBody">{CHANGELOG_V030}</div>
          </div>
          </div>
        ) : (
        <div ref={gridRef} className="dsh-wt_consoleGrid" style={{ ['--wt-cols' as any]: cols }}>
        {cards.map((c) => (
          <div
            key={c.id}
            data-flip={c.id}
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
            </div>
            <div className="dsh-wt_consoleDivider" aria-hidden />
            <div className="dsh-wt_consoleStatusRow">
              <span className={'dsh-wt_consoleStatus dsh-wt_consoleStatus-' + c.status}>{statusLabel[c.status]}</span>
              {c.runtimeMs != null && <span className="dsh-wt_consoleRuntime">{fmtDur(c.runtimeMs)}</span>}
            </div>
            {c.status === 'busy' && <span className="dsh-wt_consoleSweep" aria-hidden />}
            <div className={'dsh-wt_consolePreview' + (c.preview ? '' : ' dsh-wt_consolePreviewNone')} title={c.preview}>
              {c.preview || (c.bound ? T('console.noPreview') : T('console.unboundShort'))}
            </div>
          </div>
        ))}
        {/* 创建卡片：永远最后一位；点击 = 侧栏工作台「添加项目」同款流程 */}
        <div
          role="button"
          tabIndex={0}
          className="dsh-wt_consoleCard dsh-wt_consoleAdd"
          title={T('console.addProject')}
          onClick={() => env?.onAdd?.()}
        >
          <span className="dsh-wt_consoleAddPlus" aria-hidden>＋</span>
          <span className="dsh-wt_consoleAddLabel">{T('console.addProject')}</span>
        </div>
        {cards.length === 0 && <div className="dsh-wt_consoleEmpty">{T('console.empty')}</div>}
        </div>
        )}
      </div>
      <div className="dsh-wt_consoleDockWrap">
        <div className="dsh-wt_consoleDock">
          <button type="button" className={'dsh-wt_dockBtn' + (openMenu === 'theme' ? ' dsh-wt_dockBtnOn' : '')} title={T('console.themeLabel')} aria-label={T('console.themeLabel')} onClick={() => setOpenMenu(openMenu === 'theme' ? null : 'theme')}><ThemeIcon mode={themeMode} /></button>
          <button type="button" className={'dsh-wt_dockBtn' + (openMenu === 'shape' ? ' dsh-wt_dockBtnOn' : '')} title={T('console.shapeLabel')} aria-label={T('console.shapeLabel')} onClick={() => setOpenMenu(openMenu === 'shape' ? null : 'shape')}><svg width="20" height="20" viewBox="0 0 16 16" aria-hidden><rect x="2.2" y="2.2" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="0.9" /><circle cx="10.6" cy="10.6" r="3.8" fill="none" stroke="currentColor" strokeWidth="0.9" /></svg></button>
          <button type="button" className={'dsh-wt_dockBtn' + (openMenu === 'bg' ? ' dsh-wt_dockBtnOn' : '')} title={T('console.bgLabel')} aria-label={T('console.bgLabel')} onClick={() => { setOpenMenu(openMenu === 'bg' ? null : 'bg'); setBgEdit(null) }}><svg width="18" height="18" viewBox="0 0 16 16" aria-hidden><rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="0.9" /><circle cx="5.9" cy="6.7" r="1.05" fill="none" stroke="currentColor" strokeWidth="0.8" /><path d="M3.4 11.4l3-3 2.3 2.3 1.9-1.9 3 2.6" fill="none" stroke="currentColor" strokeWidth="0.9" /></svg></button>
          <button type="button" className={'dsh-wt_dockBtn' + (openMenu === 'cols' ? ' dsh-wt_dockBtnOn' : '')} title={T('console.colsLabel')} aria-label={T('console.colsLabel')} onClick={() => setOpenMenu(openMenu === 'cols' ? null : 'cols')}><svg width="20" height="20" viewBox="0 0 16 16" aria-hidden><rect x="2.2" y="3.4" width="2.7" height="9.2" rx="0.9" fill="none" stroke="currentColor" strokeWidth="0.9" /><rect x="6.65" y="3.4" width="2.7" height="9.2" rx="0.9" fill="none" stroke="currentColor" strokeWidth="0.9" /><rect x="11.1" y="3.4" width="2.7" height="9.2" rx="0.9" fill="none" stroke="currentColor" strokeWidth="0.9" /></svg></button>
          <button type="button" className={'dsh-wt_dockBtn' + (annOpen ? ' dsh-wt_dockBtnOn' : '')} title={T('annot.updateTitle')} aria-label={T('annot.updateTitle')} onClick={() => { setOpenMenu(null); setAnnOpen((v) => !v) }}><svg width="18" height="18" viewBox="0 0 16 16" aria-hidden><path d="M2.6 7c0-2.9 2.4-4.9 5.4-4.9s5.4 2 5.4 4.9v2.9l1.2 1.7H1.4l1.2-1.7z" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" /><path d="M6.2 12.9c.3.7 1 1.2 1.8 1.2s1.5-.5 1.8-1.2" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" /></svg>{updInfo && <span className="dsh-wt_dockBadge" aria-hidden />}</button>
        </div>
        {openMenu === 'theme' && (
          <div className="dsh-wt_drop">
            {themeOpts.map((o) => (
              <button key={o.mode} type="button" className={'dsh-wt_dropItem' + (themeMode === o.mode ? ' dsh-wt_dropItemOn' : '')} onClick={() => setTheme(o.mode)}><ThemeIcon mode={o.mode} size={13} />{T(o.key)}</button>
            ))}
          </div>
        )}
        {openMenu === 'shape' && (
          <div className="dsh-wt_drop">
            <button type="button" className={'dsh-wt_dropItem' + (shape === 'square' ? ' dsh-wt_dropItemOn' : '')} onClick={() => onShape('square')}><svg width="13" height="13" viewBox="0 0 16 16" aria-hidden><rect x="4" y="4" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>{T('console.shapeSquare')}</button>
            <button type="button" className={'dsh-wt_dropItem' + (shape === 'circle' ? ' dsh-wt_dropItemOn' : '')} onClick={() => onShape('circle')}><svg width="13" height="13" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>{T('console.shapeCircle')}</button>
          </div>
        )}
        {openMenu === 'bg' && (
          bgEdit === null ? (
            <div className="dsh-wt_drop">
              <div className="dsh-wt_dropRow">
                <button type="button" className={'dsh-wt_dropItem' + (bg === 'plain' ? ' dsh-wt_dropItemOn' : '')} onClick={() => onBg('plain')}><svg width="13" height="13" viewBox="0 0 16 16" aria-hidden><rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>{T('console.bgPlain')}</button>
                <button type="button" className="dsh-wt_dropGear" title={T('console.bgEdit')} aria-label={T('console.bgEdit')} onClick={() => setBgEdit('plain')}><SliderIcon /></button>
              </div>
              <div className="dsh-wt_dropRow">
                <button type="button" className={'dsh-wt_dropItem' + (bg === 'glow' ? ' dsh-wt_dropItemOn' : '')} onClick={() => onBg('glow')}><svg width="13" height="13" viewBox="0 0 16 16" aria-hidden><path d="M2.4 5.6c2-1.5 3.9-1.5 5.6 0 1.9 1.6 3.6 1.6 5.6 0M2.4 10.4c2-1.5 3.9-1.5 5.6 0 1.9 1.6 3.6 1.6 5.6 0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>{T('console.bgGlow')}</button>
                <button type="button" className="dsh-wt_dropGear" title={T('console.bgEdit')} aria-label={T('console.bgEdit')} onClick={() => setBgEdit('glow')}><SliderIcon /></button>
              </div>
              <div className="dsh-wt_dropRow">
                <button type="button" className={'dsh-wt_dropItem' + (bg === 'photo' ? ' dsh-wt_dropItemOn' : '')} onClick={() => onBg('photo')}><svg width="13" height="13" viewBox="0 0 16 16" aria-hidden><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="5.8" cy="6.6" r="1.1" fill="currentColor" /><path d="M3.2 11.2l2.8-2.8 2.2 2.2 1.8-1.8 2.8 2.4" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>{T('console.bgCustom')}</button>
                <button type="button" className="dsh-wt_dropGear" title={T('console.bgEdit')} aria-label={T('console.bgEdit')} onClick={() => setBgEdit('photo')}><SliderIcon /></button>
              </div>
            </div>
          ) : (
            <div className={'dsh-wt_drop' + (bgEdit === 'photo' ? ' dsh-wt_dropWide' : '')}>
              <div className="dsh-wt_hslHead">
                <button type="button" className="dsh-wt_hslBack" title={T('console.bgEditBack')} aria-label={T('console.bgEditBack')} onClick={() => setBgEdit(null)}><svg width="12" height="12" viewBox="0 0 16 16" aria-hidden><path d="M10.2 3.2 5.4 8l4.8 4.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                <span className="dsh-wt_hslTitle">{bgEdit === 'plain' ? T('console.bgEditPlain') : bgEdit === 'glow' ? T('console.bgEditGlow') : T('console.bgEditPhoto')}</span>
              </div>
              {bgEdit === 'photo' && (
                <>
                  <div className="dsh-wt_dropRow">
                    <button type="button" className="dsh-wt_dropItem" onClick={pickPhotoFile}><svg width="13" height="13" viewBox="0 0 16 16" aria-hidden><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="5.8" cy="6.6" r="1.1" fill="currentColor" /><path d="M3.2 11.2l2.8-2.8 2.2 2.2 1.8-1.8 2.8 2.4" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>{T('console.bgPhoto')}</button>
                    <div className="dsh-wt_gridHalf">
                      <span className="dsh-wt_gridLabel">{T('console.bgGridLabel')}</span>
                      <button type="button" className={'dsh-wt_switch' + (photoGrid ? ' dsh-wt_switchOn' : '')} aria-pressed={photoGrid} aria-label={T('console.bgGridLabel')} onClick={togglePhotoGrid}><span className="dsh-wt_switchKnob" /></button>
                    </div>
                  </div>
                  {photoList.length > 0 ? (
                    photoList.slice(0, 4).map((p) => (
                      <div key={p.id} data-rid={p.id} className={'dsh-wt_dropRow dsh-wt_photoRow' + (photoId === p.id ? ' dsh-wt_photoRowOn' : '')} onClick={() => selectPhoto(p)}>
                        <span className="dsh-wt_thumbWrap">
                          {p.kind === 'video'
                            ? <video className="dsh-wt_photoThumb" src={p.url} muted playsInline preload="metadata" />
                            : <img className="dsh-wt_photoThumb" src={p.url} alt="" />}
                          <span className="dsh-wt_thumbBadge" aria-hidden>{p.kind === 'video'
                            ? <svg width="8" height="8" viewBox="0 0 16 16"><path d="M4.5 3.8l8 4.2-8 4.2z" fill="currentColor" /></svg>
                            : <svg width="8" height="8" viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3.4 11l2.6-2.6 2.1 2.1 1.7-1.7 2.8 2.4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>}</span>
                        </span>
                        <span className="dsh-wt_photoName">{photoId === p.id ? T('console.bgPhotoCurrent') : T('console.bgPhotoUse')}</span>
                        <button type="button" className={'dsh-wt_dragHandle' + (dragRowId === p.id ? ' dsh-wt_dragHandleOn' : '')} title={T('console.bgMediaDrag')} aria-label={T('console.bgMediaDrag')} onPointerDown={(e) => onHandleDown(p.id, e)}><svg width="10" height="12" viewBox="0 0 10 12" aria-hidden><circle cx="2.5" cy="2" r="1.1" fill="currentColor" /><circle cx="7.5" cy="2" r="1.1" fill="currentColor" /><circle cx="2.5" cy="6" r="1.1" fill="currentColor" /><circle cx="7.5" cy="6" r="1.1" fill="currentColor" /><circle cx="2.5" cy="10" r="1.1" fill="currentColor" /><circle cx="7.5" cy="10" r="1.1" fill="currentColor" /></svg></button>
                        <button type="button" className="dsh-wt_dropTrash" title={T('console.bgPhotoDelete')} aria-label={T('console.bgPhotoDelete')} onClick={(e) => { e.stopPropagation(); removePhotoById(p) }}><svg width="11" height="11" viewBox="0 0 16 16" aria-hidden><path d="M2.5 4.2h11M6.5 4.2V2.9c0-.6.4-1 .9-1h1.2c.5 0 .9.4.9 1v1.3M4.2 4.2l.5 8.1c0 .7.5 1.2 1.2 1.2h4.2c.7 0 1.2-.5 1.2-1.2l.5-8.1" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg></button>
                      </div>
                    ))
                  ) : (
                    <div className="dsh-wt_photoEmpty">{T('console.bgPhotoNone')}</div>
                  )}
                  <div className="dsh-wt_hslDivider" />
                </>
              )}
              {(() => {
                const v = bgEdit === 'plain' ? plainHsl : bgEdit === 'glow' ? glowHsl : photoHsl
                const sMax = bgEdit === 'plain' ? 100 : 200
                const lMax = bgEdit === 'plain' ? 100 : 200
                return (<>
                  {bgEdit === 'glow' && (
                    <div className="dsh-wt_hslRow" data-tip={T('console.bgTipSpeed')}><span className="dsh-wt_hslLabel">S</span><input className="dsh-wt_hslSlider" type="range" min={0} max={100} step={5} value={glowSpeed} onChange={(e) => onGlowSpeed(Number(e.target.value))} /><HslValInput value={glowSpeed} min={0} max={100} onCommit={onGlowSpeed} /></div>
                  )}
                  <div className="dsh-wt_hslRow" data-tip={T('console.bgTipB')}><span className="dsh-wt_hslLabel">B</span><input className="dsh-wt_hslSlider" type="range" min={0} max={20} step={1} value={bgEdit === 'plain' ? plainBlur : bgEdit === 'glow' ? glowBlur : cardBlur} onChange={(e) => onModeBlur(bgEdit, Number(e.target.value))} /><HslValInput value={bgEdit === 'plain' ? plainBlur : bgEdit === 'glow' ? glowBlur : cardBlur} min={0} max={20} onCommit={(n) => onModeBlur(bgEdit, n)} /></div>
                  <div className="dsh-wt_hslRow" data-tip={T('console.bgTipT')}><span className="dsh-wt_hslLabel">T</span><input className="dsh-wt_hslSlider" type="range" min={0} max={30} step={1} value={bgEdit === 'plain' ? plainGrid : bgEdit === 'glow' ? glowGrid : gridOpacity} onChange={(e) => bgEdit === 'photo' ? onGridOpacity(Number(e.target.value)) : onModeGrid(bgEdit, Number(e.target.value))} /><HslValInput value={bgEdit === 'plain' ? plainGrid : bgEdit === 'glow' ? glowGrid : gridOpacity} min={0} max={30} onCommit={(n) => bgEdit === 'photo' ? onGridOpacity(n) : onModeGrid(bgEdit, n)} /></div>
                  <div className="dsh-wt_hslRow" data-tip={T('console.bgTipH')}><span className="dsh-wt_hslLabel">H</span><input className="dsh-wt_hslSlider" type="range" min={-180} max={180} step={1} value={v.h} onChange={(e) => editHsl(bgEdit, { h: Number(e.target.value) })} /><HslValInput value={v.h} min={-180} max={180} onCommit={(n) => editHsl(bgEdit, { h: n })} /></div>
                  <div className="dsh-wt_hslRow" data-tip={T('console.bgTipS')}><span className="dsh-wt_hslLabel">S</span><input className="dsh-wt_hslSlider" type="range" min={0} max={sMax} step={1} value={v.s} onChange={(e) => editHsl(bgEdit, { s: Number(e.target.value) })} /><HslValInput value={v.s} max={sMax} onCommit={(n) => editHsl(bgEdit, { s: n })} /></div>
                  <div className="dsh-wt_hslRow" data-tip={T('console.bgTipL')}><span className="dsh-wt_hslLabel">L</span><input className="dsh-wt_hslSlider" type="range" min={0} max={lMax} step={1} value={v.l} onChange={(e) => editHsl(bgEdit, { l: Number(e.target.value) })} /><HslValInput value={v.l} max={lMax} onCommit={(n) => editHsl(bgEdit, { l: n })} /></div>
                  <button type="button" className="dsh-wt_hslReset" onClick={() => resetHsl(bgEdit)}>{T('console.bgEditReset')}</button>
                </>)
              })()}
            </div>
          )
        )}
        {openMenu === 'cols' && (
          <div className="dsh-wt_drop">
            <div className="dsh-wt_hbar">
              <span className="dsh-wt_hbarFill" style={{ width: (8 + (cols - 1) * 21) + '%' }} />
              {[1, 2, 3, 4, 5].map((v) => (
                <button key={v} type="button" className="dsh-wt_hbarLine" style={{ left: (8 + (v - 1) * 21) + '%' }} aria-label={String(v)} title={String(v)} onClick={() => onCols(v)}></button>
              ))}
              <span className="dsh-wt_hbarKnob" style={{ left: (8 + (cols - 1) * 21) + '%' }} />
            </div>
          </div>
        )}
      </div>
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
  if (content.type === 'browser') return <BrowserPane row={props.row} index={props.index} tabId={props.tab.id} content={content} reloadKey={props.reloadKey} />
  if (content.type === 'anim') return <AnimPane row={props.row} index={props.index} tabId={props.tab.id} content={content} reloadKey={props.reloadKey} />
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
  // 唯一标签是控制室 → 整个标签栏不渲染（不可关、不可换，标签栏无信息价值；去掉顶部多余标题）
  const singleConsole = tabs.length === 1 && tabs[0].content?.kind === 'builtin' && tabs[0].content.type === 'console'
  return (
    <>
      {!singleConsole && !pane.collapsed && (
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
      )}
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

  const renderPane = (it: { pane: SplitPane; left: number; width: number }, row: PaneRow, index: number, x: number, y: number, h: number) => {
    const singleConsole = (it.pane.tabs ?? []).length === 1 && it.pane.tabs![0].content?.kind === 'builtin' && it.pane.tabs![0].content.type === 'console'
    return (
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
      {!it.pane.collapsed && (
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
      )}
      <PaneBody pane={it.pane} row={row} index={index} />
      {!singleConsole && (
        <>
        <button
          type="button"
          className="dsh-wt_annotBtn"
          title={T('annot.label')}
          aria-label={T('annot.label')}
          onClick={() => startAnnot(windowLabelOf(row, index))}
        >
          <svg viewBox="0 0 16 16" aria-hidden><path d="M2 5.6c0-1.2 1-2.2 2.2-2.2h7.6c1.2 0 2.2 1 2.2 2.2v3.6c0 1.2-1 2.2-2.2 2.2H7.5L5 13.6l.3-2.4H4.2c-1.2 0-2.2-1-2.2-2.2z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
        </button>
        <button
          type="button"
          className={'dsh-wt_collapseBtn' + (it.pane.collapsed ? ' dsh-wt_collapseBtnCollapsed' : '')}
          title={it.pane.collapsed ? T('pane.expand') : T('pane.collapse')}
          aria-label={it.pane.collapsed ? T('pane.expand') : T('pane.collapse')}
          onClick={() => splitStore.toggleCollapsed(row, index)}
        >
          {it.pane.collapsed ? (
            <svg viewBox="0 0 16 16" aria-hidden><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
        </button>
        </>
      )}
    </div>
    )
  }

  return (
    <>
      {/* 标题栏 */}
      <div className="dsh-wt_splitBar" style={{ position: 'fixed', left: g.left, top: barTop, width: hasLeft || chatFull ? contentW : (hasTop ? colW : contentW), zIndex: 70 }}>
        {spec.id !== 'wt-console' && <span className="dsh-wt_splitTitle">{spec.title}</span>}
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
          style={{ position: 'fixed', left: topRowX + it.left + it.width - DIVIDER / 2, top: topY, width: DIVIDER, height: topH, zIndex: 72 }}
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
          style={{ position: 'fixed', left: contentX + it.left + it.width - DIVIDER / 2, top: bodyTop, width: DIVIDER, height: mainH, zIndex: 72 }}
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
      <AnnotationOverlay />
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
