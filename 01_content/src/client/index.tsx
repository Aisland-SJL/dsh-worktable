import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { css } from './styles'
import { NS, zh, en, type WorktableKey } from './locales'
import { splitStore, SplitWorkspace, setSplitT, setSplitEnv, type LayoutSpec, type SplitPane } from './split'

/**
 * dsh-worktable 客户端（v2）：侧边栏底部「工作台」区块。
 * 结构：分隔线 → [≡ 手柄][工作台][搜索/视图选项/添加+] → 项目卡片区（子座位）。
 * v2 新增（PRD §10 定案）：
 *   - 卡片规范 v2 渐进上报协议：owner props 下发 order/hidden/nameOverrides，
 *     卡片可选上报 reportMeta/reportUsed；v1 卡片零改动兼容（按注册序排在最前）。
 *   - 视图选项只留「排序：手动/最近」（分类已按用户定案取消）。
 *   - 「管理项目…」编辑模式：改名/隐藏/排序（拖拽 + ↑↓），全存 localStorage。
 *   - 「+」：接入指引 + 本地快捷方式（名称/图标/链接，点击新标签打开）。
 *   - 完整 zh/en 词典接入 dsh-client-locale（NS 'worktable'）。
 * 持久化：dsh.worktable.view.v1（视图）+ dsh.worktable.projects.v1（项目元状态）。
 */

type OrderBy = 'manual' | 'recent'
type DockMode = 'footer' | 'float'

type ViewState = {
  query: string
  searchOpen: boolean
  orderBy: OrderBy
  dock: DockMode
  floatTop: number | null
}

/** 卡片上报的项目元信息（协议 v2）。 */
export type ProjectMeta = { id: string; name: string; icon?: string }
/** 本地快捷方式（仅存 localStorage）。 */
export type Shortcut = { id: string; name: string; icon: string; href: string }

type ProjectsState = {
  /** 手动排序的 id 序列（新注册 id 未出现在其中时追加在尾部）。 */
  order: string[]
  /** id → 最近使用时间戳（毫秒），来源：卡片点击时 reportUsed。 */
  lastUsed: Record<string, number>
  /** 被隐藏的项目 id 集。 */
  hidden: string[]
  /** 显示名覆盖（编辑模式改名；空值删除覆盖）。 */
  nameOverrides: Record<string, string>
  /** 图标覆盖（点图标换 emoji；含入驻插件项目 id → emoji）。 */
  iconOverrides: Record<string, string>
  /** 已从工作台删除的入驻项目 id（真删除：恢复默认不复活；在「已删除的项目」里可重新添加）。 */
  removed: string[]
  /** 入驻项目的视图覆盖（id → LayoutSpec）：变更视图后按此打开，替换项目自声明的布局。 */
  views: Record<string, LayoutSpec>
  /** 本地快捷方式条目。 */
  shortcuts: Shortcut[]
  /** 用户自建的布局条目（「+」新建工作区保存的 LayoutSpec）。 */
  layouts: LayoutSpec[]
}

const PERSIST_KEY = 'dsh.worktable.view.v1'
const PROJECTS_KEY = 'dsh.worktable.projects.v1'
const MIN_TOP = 56
const SNAP_PX = 32
/** 插件市场外链（GitHub 仓库，已核实可访问；PRD 提及的 dshfind.com 未验证，不用死链）。 */
const MARKET_URL = 'https://github.com/hikariming/dshfind'
/** 已报到卡片的 CSS order 偏移：未上报（order=0）的 v1 卡片永远排在已上报卡片之前。 */
const ORDER_OFFSET = 1000
/** 非引擎项目埋点冷却（毫秒）：同 id 两次计使用的最小间隔 */
const LEGACY_BUMP_COOLDOWN = 15000
/** 落点判定余量：松手时指针越出有效落点区（超出底部/顶部/侧边）即视为「无有效落点」。 */
const OVER_BOTTOM_PX = 24
const OVER_TOP_PX = 24
const OVER_SIDE_PX = 80

/** 拓扑预设（聊天窗恒贴右，PRD §13.2 硬约束）：左右/三栏/上一下二/井字 */
const PRESET_DEFS = [
  { id: '2h', leftCount: 0, topCount: 0, contentCount: 1, chatFull: false },
  { id: '3h', leftCount: 0, topCount: 0, contentCount: 2, chatFull: false },
  { id: 'l2', leftCount: 0, topCount: 1, contentCount: 1, chatFull: true },
  { id: 't2', leftCount: 0, topCount: 1, contentCount: 1, chatFull: false },
  { id: 'grid', leftCount: 0, topCount: 2, contentCount: 1, chatFull: false },
  { id: 't3', leftCount: 0, topCount: 1, contentCount: 2, chatFull: true },
] as const

/** 侧栏图标备选集（emoji）：布局/快捷方式/入驻项目的图标，点击可换（首项 🧱 为布局默认） */
const EMOJI_SET = ['🧱', '🏠', '🎓', '🚗', '✈️', '🌍', '🏥', '📚', '✏️', '⚙️', '🎨', '🎮', '🌏', '📐', '🧪', '🤖', '📦', '💬']

/** 官方工作区头部按钮图标（自 DSH Web GUI 工作区面板取样，fill=currentColor 跟随主题） */
const ICON_SEARCH = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.894845 6.647401C11.894845 3.725463 9.534486 1.356779 6.623219 1.35657C3.711786 1.35657 1.351635 3.725338 1.351635 6.647401C1.351843 9.569296 3.711911 11.938273 6.623219 11.938273C9.534361 11.938064 11.894637 9.569171 11.894845 6.647401ZM13.245462 6.647401C13.245254 10.317935 10.280401 13.293613 6.623219 13.293821C2.965871 13.293821 0.000204 10.31806 0 6.647401C0 2.976574 2.965746 0 6.623219 0C10.280526 0.000205 13.245462 2.9767 13.245462 6.647401Z" fill="currentColor" />
    <path d="M16.000417 15.041079L15.044449 16.000433L11.530434 12.473588L12.486298 11.514234L16.000417 15.041079Z" fill="currentColor" />
  </svg>
)
const ICON_VIEW_OPTIONS = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path transform="translate(1.292 1.3)" d="M10.3232 9.18164C11.2868 9.18164 12.0985 9.82833 12.3506 10.7109L13.415 10.7109L13.415 11.8711L12.3496 11.8711C12.0971 12.7532 11.2864 13.3994 10.3232 13.3994C9.36031 13.3992 8.55012 12.7531 8.29785 11.8711L0 11.8711L0 10.7109L8.29688 10.7109C8.54876 9.82845 9.35988 9.18186 10.3232 9.18164ZM10.3232 10.3418C9.7999 10.3421 9.37534 10.7667 9.375 11.29C9.375 11.8137 9.79969 12.239 10.3232 12.2393C10.847 12.2393 11.2725 11.8138 11.2725 11.29C11.2721 10.7666 10.8468 10.3418 10.3232 10.3418ZM12.4326 11.291C12.4326 11.3549 12.4284 11.418 12.4229 11.4805C12.4287 11.4181 12.4326 11.355 12.4326 11.291ZM8.21484 11.2832C8.21484 11.2856 8.21484 11.2886 8.21484 11.291L8.21484 11.29C8.21484 11.2878 8.21484 11.2855 8.21484 11.2832ZM3.08301 4.59082C4.04605 4.59095 4.85696 5.23717 5.10938 6.11914L13.415 6.11914L13.415 7.2793L5.11035 7.2793C4.85833 8.16202 4.04648 8.80846 3.08301 8.80859C2.11972 8.80843 1.30963 8.16179 1.05762 7.2793L0 7.2793L0 6.11914L1.05762 6.11914C1.30994 5.23728 2.12006 4.59098 3.08301 4.59082ZM3.08301 5.75098C2.55962 5.75117 2.13512 6.17587 2.13477 6.69922C2.13477 7.22287 2.5594 7.64824 3.08301 7.64844C3.60665 7.64828 4.03223 7.2229 4.03223 6.69922C4.03187 6.17585 3.60643 5.75113 3.08301 5.75098ZM5.19238 6.69922C5.19238 6.763 5.18816 6.82633 5.18262 6.88867C5.18846 6.82629 5.19238 6.76313 5.19238 6.69922C5.19236 6.63495 5.18853 6.57152 5.18262 6.50879C5.18826 6.57154 5.19236 6.635 5.19238 6.69922ZM0.982422 6.52344C0.977382 6.58136 0.97463 6.63999 0.974609 6.69922C0.974609 6.75775 0.977496 6.81579 0.982422 6.87305C0.977758 6.81579 0.974609 6.75767 0.974609 6.69922C0.974628 6.64 0.977618 6.58142 0.982422 6.52344ZM10.3232 0C11.2869 0 12.0986 0.646596 12.3506 1.5293L13.415 1.5293L13.415 2.68945L12.3496 2.68945C12.363 2.64266 12.3754 2.59488 12.3857 2.54688C12.1838 3.50118 11.3376 4.21777 10.3232 4.21777C9.36037 4.21756 8.55018 3.57139 8.29785 2.68945L0 2.68945L0 1.5293L8.29688 1.5293C8.5487 0.646717 9.35981 0.00021854 10.3232 0ZM10.3232 1.16016C9.79984 1.16042 9.37524 1.58499 9.375 2.1084C9.375 2.63201 9.79969 3.05735 10.3232 3.05762C10.847 3.05762 11.2725 2.63217 11.2725 2.1084C11.2722 1.58483 10.8469 1.16016 10.3232 1.16016ZM12.4229 2.29883C12.4287 2.23641 12.4326 2.17331 12.4326 2.10938C12.4326 2.17327 12.4284 2.23638 12.4229 2.29883ZM8.21484 2.10938L8.21484 2.1084L8.21484 2.10938ZM8.22266 1.93359C8.21785 1.98897 8.21506 2.04499 8.21484 2.10156C8.21503 2.04501 8.2181 1.98902 8.22266 1.93359ZM8.22266 11.1162C8.2179 11.1713 8.21507 11.227 8.21484 11.2832C8.21504 11.227 8.21814 11.1713 8.22266 11.1162Z" fill="currentColor" />
  </svg>
)
const ICON_ADD = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path transform="translate(9.52 2.52)" d="M3.55246 0L3.55246 2.44252L6 2.44252L6 3.55748L3.55246 3.55748L3.55246 6L2.43834 6L2.43834 3.55748L0 3.55748L0 2.44252L2.43834 2.44252L2.43834 0L3.55246 0Z" fill="currentColor" />
    <path transform="translate(0.3496 2.35)" d="M4.76367 0C5.36861 1.80598e-05 5.93113 0.310294 6.25488 0.821289L6.78027 1.64941C6.79685 1.67558 6.81791 1.69775 6.83887 1.71973C6.72186 2.15521 6.65702 2.61192 6.65137 3.08301C6.25601 2.96045 5.90909 2.70478 5.68164 2.3457L5.15723 1.5166C5.07183 1.38189 4.92318 1.3008 4.76367 1.30078L2.32422 1.30078C1.7589 1.30078 1.30078 1.7589 1.30078 2.32422L1.30078 10.1338C1.30078 10.6991 1.7589 11.1572 2.32422 11.1572L11.9766 11.1572C12.5419 11.1572 13 10.6991 13 10.1338L13 8.58398C13.4545 8.5135 13.8903 8.38748 14.3008 8.21289L14.3008 10.1338C14.3008 11.4171 13.2598 12.458 11.9766 12.458L2.32422 12.458C1.04093 12.458 0 11.4171 0 10.1338L0 2.32422C0 1.04093 1.04093 0 2.32422 0L4.76367 0Z" fill="currentColor" />
  </svg>
)

function buildLayout(presetId: string, name: string): LayoutSpec {
  const def = PRESET_DEFS.find((d) => d.id === presetId) ?? PRESET_DEFS[0]
  const mk = (i: number): SplitPane => ({
    id: 'p' + (i + 1),
    title: '内容' + (i + 1),
    min: 200,
    content: null,
  })
  const left = def.leftCount > 0 ? mk(0) : null
  const top = Array.from({ length: def.topCount }, (_, i) => mk(def.leftCount + i))
  const main = Array.from({ length: def.contentCount }, (_, i) => mk(def.leftCount + def.topCount + i))
  return {
    id: 'layout-' + Date.now().toString(36),
    title: name,
    left: left ?? null,
    top: top.length > 0 ? top : null,
    main,
    leftWidth: { default: 260, min: 160, max: 480 },
    chatWidth: { default: 360, min: 240, max: 600 },
    topHeight: { default: 200, min: 120, max: 480 },
    chatSide: 'right',
    chatFullHeight: def.chatFull === true,
  }
}

/** 布局缩略图（迷你窗格示意；聊天窗蓝色 💬） */
function presetThumb(defId: string) {
  const cell = (chat: boolean, key: string) => (
    <span key={key} className={'dsh-wt_thumbCell' + (chat ? ' dsh-wt_thumbChat' : '')}>{chat ? '💬' : ''}</span>
  )
  if (defId === '2h') {
    return <span className="dsh-wt_thumb"><span className="dsh-wt_thumbRow">{cell(false, 'a')}{cell(true, 'b')}</span></span>
  }
  if (defId === '3h') {
    return <span className="dsh-wt_thumb"><span className="dsh-wt_thumbRow">{cell(false, 'a')}{cell(false, 'b')}{cell(true, 'c')}</span></span>
  }
  if (defId === 't2') {
    return (
      <span className="dsh-wt_thumb">
        <span className="dsh-wt_thumbRow">{cell(false, 'a')}</span>
        <span className="dsh-wt_thumbRow">{cell(false, 'b')}{cell(true, 'c')}</span>
      </span>
    )
  }
  if (defId === 'grid') {
    return (
      <span className="dsh-wt_thumb">
        <span className="dsh-wt_thumbRow">{cell(false, 'a')}{cell(false, 'b')}</span>
        <span className="dsh-wt_thumbRow">{cell(false, 'c')}{cell(true, 'd')}</span>
      </span>
    )
  }
  if (defId === 'l2') {
    // 左二右一：左侧上下两个内容窗，右侧整列对话（💬）
    return (
      <span className="dsh-wt_thumb dsh-wt_thumbCols">
        <span className="dsh-wt_thumbCol">
          <span className="dsh-wt_thumbRow">{cell(false, 'a')}</span>
          <span className="dsh-wt_thumbRow">{cell(false, 'b')}</span>
        </span>
        <span className="dsh-wt_thumbCol">{cell(true, 'c')}</span>
      </span>
    )
  }
  return (
    <span className="dsh-wt_thumb dsh-wt_thumbCols">
      <span className="dsh-wt_thumbCol">
        <span className="dsh-wt_thumbRow">{cell(false, 'a')}</span>
        <span className="dsh-wt_thumbRow">{cell(false, 'b')}{cell(false, 'c')}</span>
      </span>
      <span className="dsh-wt_thumbCol">{cell(true, 'd')}</span>
    </span>
  )
}

const DEFAULT_VIEW: ViewState = {
  query: '',
  searchOpen: false,
  orderBy: 'manual',
  dock: 'footer',
  floatTop: null,
}

const DEFAULT_PROJECTS: ProjectsState = {
  order: [],
  lastUsed: {},
  hidden: [],
  nameOverrides: {},
  iconOverrides: {},
  removed: [],
  views: {},
  shortcuts: [],
  layouts: [],
}

function loadView(): ViewState {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return { ...DEFAULT_VIEW }
    const p = JSON.parse(raw)
    // 显式挑字段：旧版遗留的 groupBy 等未知字段直接忽略。
    // 一次性迁移：v2 起默认「手动」排序（最近排序点击即置顶、体验差），旧存「最近」回落为「手动」；
    // 之后用户手动选择「最近」会写入 sortMigratedV2 标记并被尊重。
    const orderBy = p.sortMigratedV2 === true
      ? (p.orderBy === 'recent' ? 'recent' : 'manual')
      : 'manual'
    return {
      query: typeof p.query === 'string' ? p.query : '',
      searchOpen: p.searchOpen === true,
      orderBy,
      dock: p.dock === 'float' ? 'float' : 'footer',
      floatTop: typeof p.floatTop === 'number' ? p.floatTop : null,
    }
  } catch {
    return { ...DEFAULT_VIEW }
  }
}

function loadProjects(): ProjectsState {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY)
    if (!raw) return { ...DEFAULT_PROJECTS }
    const p = JSON.parse(raw)
    return {
      order: Array.isArray(p.order) ? p.order.filter((x: unknown): x is string => typeof x === 'string') : [],
      lastUsed: p.lastUsed && typeof p.lastUsed === 'object' ? p.lastUsed : {},
      hidden: Array.isArray(p.hidden) ? p.hidden.filter((x: unknown): x is string => typeof x === 'string') : [],
      nameOverrides: p.nameOverrides && typeof p.nameOverrides === 'object' ? p.nameOverrides : {},
      iconOverrides: p.iconOverrides && typeof p.iconOverrides === 'object' ? p.iconOverrides : {},
      removed: Array.isArray(p.removed) ? p.removed.filter((x: unknown): x is string => typeof x === 'string') : [],
      views: p.views && typeof p.views === 'object' ? p.views : {},
      shortcuts: Array.isArray(p.shortcuts)
        ? p.shortcuts.filter((s: any) => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.href === 'string')
        : [],
      layouts: Array.isArray(p.layouts)
        ? p.layouts.filter((l: any) => l && typeof l.id === 'string' && typeof l.title === 'string' && Array.isArray(l.main))
        : [],
    }
  } catch {
    return { ...DEFAULT_PROJECTS }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

type FloatRect = { top: number }

/** 从组件挂载点向上找 sidebar 容器：className 含 SidebarRoot/sidebar，或标签 aside/nav，到 body 为止。 */
function findSidebar(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start
  while (el && el !== document.body) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'aside' || tag === 'nav') return el
    if (typeof el.className === 'string' && /SidebarRoot|sidebar/i.test(el.className)) return el
    el = el.parentElement
  }
  return null
}

/** 子座位注册 id 序列（模块级 store；apply 里订阅 slots 变化写入）。 */
const registryStore: { ids: string[]; listeners: Set<() => void> } = { ids: [], listeners: new Set() }

/** 会话作用域快照（模块级；apply 里订阅 ctx.sessions.list 写入，组件与引擎只读） */
const sessionScopeStore: {
  snapshot: { sessionId: string; cwd: string; jobs: any[]; subagents: any[] } | null
} = { snapshot: null }

function syncSessionScope(list: any) {
  try {
    const snap = list.getSnapshot()
    const current: string = snap?.current ?? ''
    const entry = snap?.items?.find((it: any) => it.sessionId === current) ?? null
    const cat = snap?.subagentsByParent?.[current]
    let subagents: any[] = []
    if (Array.isArray(cat)) subagents = cat
    else if (cat && Array.isArray(cat.entries)) subagents = cat.entries
    else if (cat && Array.isArray(cat.items)) subagents = cat.items
    else if (cat && Array.isArray(cat.children)) subagents = cat.children
    sessionScopeStore.snapshot = {
      sessionId: current,
      cwd: entry?.cwd ?? '',
      jobs: (snap?.jobsBySession?.[current] ?? []) as any[],
      subagents,
    }
  } catch {
    sessionScopeStore.snapshot = { sessionId: '', cwd: '', jobs: [], subagents: [] }
  }
}

function WorktableSection(props: any) {
  const wide = props.wide !== false
  const renderProjectSlot = typeof props.renderSlot === 'function' ? props.renderSlot : null
  /** locale 座席 t；宿主未安装 locale 服务时回退 zh 词典（保持独立可用）。 */
  const t = (key: WorktableKey, params?: Record<string, string>): string => {
    if (typeof props.t === 'function') {
      try {
        return props.t(key, params)
      } catch {
        /* 回退 zh */
      }
    }
    let s: string = zh[key] ?? key
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace('{' + k + '}', v)
    return s
  }

  const [view, setView] = useState<ViewState>(loadView)
  const [projects, setProjects] = useState<ProjectsState>(loadProjects)
  const [metas, setMetas] = useState<Record<string, ProjectMeta>>({})
  const [registeredIds, setRegisteredIds] = useState<string[]>(() => [...registryStore.ids])
  const [addOpen, setAddOpen] = useState(false)
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false)
  const [wsPreset, setWsPreset] = useState<string>('2h')
  const [wsName, setWsName] = useState('')
  const [wsError, setWsError] = useState(false)
  /** 图标选择器：kind + 目标 id + 弹窗锚点坐标（fixed 定位） */
  const [iconPick, setIconPick] = useState<{ kind: 'layout' | 'shortcut' | 'project'; id: string; x: number; y: number } | null>(null)
  /** 删除二次确认：kind + 目标 id + 显示名 */
  const [requestDelete, setRequestDelete] = useState<{ kind: 'layout' | 'shortcut' | 'project'; id: string; name: string } | null>(null)
  /** 变更视图：正在挑选新拓扑的布局 id */
  const [viewPickFor, setViewPickFor] = useState<string | null>(null)
  const [float, setFloat] = useState<FloatRect | null>(() =>
    view.dock === 'float' && view.floatTop != null ? { top: view.floatTop } : null,
  )
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startY: number; startX: number; startRect: DOMRect; dragging: boolean; prevFloat: FloatRect | null } | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const [railRect, setRailRect] = useState<{ left: number; width: number } | null>(null)
  const [bottomInset, setBottomInset] = useState(0)
  const bottomInsetRef = useRef(0)
  const [floatGeo, setFloatGeo] = useState<{ left: number; width: number | null } | null>(null)
  const [sidebarRight, setSidebarRight] = useState<number | null>(null)
  const [activeSplitId, setActiveSplitId] = useState<string | null>(() =>
    splitStore.active && splitStore.spec ? splitStore.spec.id : null,
  )

  // 会话作用域（当前会话 + 工作目录）与后台任务：注入分栏引擎环境
  // 注意：不走 props.useSessions hook（其宿主包装在部分版本会触发 useSyncExternalStore
  // 崩溃），改为 apply 里订阅 ctx.sessions.list 后写入模块级 store，此处直接读取。
  useEffect(() => {
    setSplitEnv({
      getScope: () => {
        const s = sessionScopeStore.snapshot
        return s ? { sessionId: s.sessionId, cwd: s.cwd } : null
      },
      getJobs: () => sessionScopeStore.snapshot?.jobs ?? [],
      getSubagents: () => sessionScopeStore.snapshot?.subagents ?? [],
    })
    return () => setSplitEnv(null)
  }, [])
  const floatRef = useRef<FloatRect | null>(null)

  const persistView = (patch: Partial<ViewState>) => {
    setView((prev) => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem(PERSIST_KEY, JSON.stringify({ ...next, sortMigratedV2: true })) } catch {}
      return next
    })
  }

  const persistProjects = (patch: Partial<ProjectsState> | ((prev: ProjectsState) => ProjectsState)) => {
    setProjects((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
      try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  // 子座位注册变化 → 刷新 id 序列
  useEffect(() => {
    const sync = () => setRegisteredIds([...registryStore.ids])
    registryStore.listeners.add(sync)
    return () => { registryStore.listeners.delete(sync) }
  }, [])

  // 分栏引擎激活态 → activeSplitId（卡片据此显示选中效果）
  useEffect(() => splitStore.subscribe(() => {
    setActiveSplitId(splitStore.active && splitStore.spec ? splitStore.spec.id : null)
  }), [])

  // 引擎内 spec 变更（窗内容/聊天位置/窗位互换）→ 回写布局条目持久化
  useEffect(() => {
    splitStore.onSpecMutated = (spec) => {
      persistProjects((prev) => ({ ...prev, layouts: prev.layouts.map((l) => (l.id === spec.id ? spec : l)) }))
    }
    return () => { splitStore.onSpecMutated = null }
  }, [])

  // 分栏引擎 UI 文案（窗选择器等）
  useEffect(() => {
    setSplitT((k) => t(k as WorktableKey))
    return () => setSplitT(null)
  }, [t])

  // 侧边栏折叠/展开：保持原停靠位置（不再回弹 footer）；折叠态由项目图标框承载。
  // 折叠且浮动时：等折叠动画结束（320/750ms 双次重测，取收敛后的几何）再以 fixed 定位
  // 图标框到拖前高度——避免在过渡帧上测得展开态宽度导致图标框偏离窄栏中心。
  const measureRailRect = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width > 0) {
      setRailRect((prev) => (prev && Math.abs(prev.left - r.left) < 1 && Math.abs(prev.width - r.width) < 1 ? prev : { left: r.left, width: r.width }))
    }
  }, [])

  useLayoutEffect(() => {
    if (!wide) {
      const t1 = window.setTimeout(measureRailRect, 320)
      const t2 = window.setTimeout(measureRailRect, 750)
      return () => { window.clearTimeout(t1); window.clearTimeout(t2) }
    }
  }, [wide, measureRailRect])

  // ── 悬浮窗宽度/水平定位：与 sidebar 几何联动（ResizeObserver 实时跟随，无轮询） ──
  // dockWidth = sidebar 宽 − paddingLeft − paddingRight − 40（每边内缩 20）
  // left = sidebar 左边缘视口坐标 + paddingLeft + 20
  // 降级：找不到 sidebar 或宽度 ≤0 → left 固定 14px，宽度不设内联（交 CSS min/max 处理）
  const measureFloatGeo = useCallback(() => {
    const sidebar = findSidebar(rootRef.current)
    if (!sidebar) {
      setFloatGeo({ left: 14, width: null })
      return
    }
    const rect = sidebar.getBoundingClientRect()
    const cs = getComputedStyle(sidebar)
    const padLeft = parseFloat(cs.paddingLeft) || 0
    const padRight = parseFloat(cs.paddingRight) || 0
    const margin = 20
    const width = rect.width - padLeft - padRight - margin * 2
    setSidebarRight(Math.round(rect.right))
    if (width > 0) {
      setFloatGeo({ left: Math.round(rect.left + padLeft + margin), width: Math.round(width) })
    } else {
      setFloatGeo({ left: 14, width: null })
    }
  }, [])

  useLayoutEffect(() => {
    measureFloatGeo()
    const sidebar = findSidebar(rootRef.current)
    if (!sidebar) return
    const ro = new ResizeObserver(() => measureFloatGeo())
    ro.observe(sidebar)
    return () => ro.disconnect()
  }, [measureFloatGeo])

  // 窗口尺寸变化 → 回弹默认停靠（浮动的列宽已失效）
  useEffect(() => {
    const onResize = () => {
      setFloat(null); persistView({ dock: 'footer' })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── 协议 v2 回调（引用稳定，避免卡片 reportMeta effect 循环）──
  const reportMeta = useCallback((meta: ProjectMeta) => {
    if (!meta || typeof meta.id !== 'string' || !meta.id) return
    setMetas((prev) => {
      const cur = prev[meta.id]
      if (cur && cur.name === meta.name && cur.icon === meta.icon) return prev
      return { ...prev, [meta.id]: { id: meta.id, name: typeof meta.name === 'string' ? meta.name : meta.id, icon: meta.icon } }
    })
  }, [])

  const engineIdsRef = useRef<Set<string>>(new Set())
  const lastLegacyBumpRef = useRef<Record<string, number>>({})

  /** 使用埋点：仅「工作区真正打开」计一次使用；点击关闭/重复点击不计（避免每次点击置顶） */
  const reportUsed = useCallback((id: string) => {
    if (typeof id !== 'string' || !id) return
    const now = Date.now()
    const bump = () => {
      persistProjects((prev) => {
        if (prev.lastUsed[id] === now) return prev
        return { ...prev, lastUsed: { ...prev.lastUsed, [id]: now } }
      })
    }
    const engineOpen = splitStore.active && splitStore.spec?.id === id
    const knownEngine = engineIdsRef.current.has(id)
    if (engineOpen) {
      bump() // 引擎项目：本次点击打开了工作区 → 计一次使用
    } else if (knownEngine) {
      // 引擎项目：本次是关闭/重复点击 → 不计
      return
    } else {
      // 非引擎项目（自带分栏实现等）：冷却去重（打开计一次；快速开关/关闭点击不重复计）
      if (now - (lastLegacyBumpRef.current[id] ?? 0) > LEGACY_BUMP_COOLDOWN) {
        lastLegacyBumpRef.current[id] = now
        bump()
      }
    }
  }, [])

  /** 分栏工作区入口（M1 引擎）：项目卡片调用 openSplit(spec) 打开声明式布局；
   * 若该 id 存在视图覆盖（用户在设置里变更过视图），用覆盖布局替换打开。 */
  const openSplit = useCallback((spec: LayoutSpec) => {
    engineIdsRef.current.add(spec.id)
    splitStore.open(projects.views[spec.id] ?? spec)
  }, [projects.views])

  // ── 有效排序 ──
  // 手动：持久化 order（过滤已卸载 id）→ 新注册 id 与布局 id 追加尾部；
  // 最近：有 lastUsed 的按时间降序在前，其余按手动序在后。
  const layoutIds = useMemo(() => projects.layouts.map((l) => l.id), [projects.layouts])
  const aliveRegisteredIds = useMemo(
    () => registeredIds.filter((id) => !projects.removed.includes(id)),
    [registeredIds, projects.removed],
  )
  const allIds = useMemo(() => [...aliveRegisteredIds, ...layoutIds], [aliveRegisteredIds, layoutIds])
  const effectiveOrder = useMemo(() => {
    const known = new Set(allIds)
    const stored = projects.order.filter((id) => known.has(id))
    const rest = allIds.filter((id) => !stored.includes(id))
    let list = [...stored, ...rest]
    if (view.orderBy === 'recent') {
      const hot = list.filter((id) => projects.lastUsed[id] != null)
      const cold = list.filter((id) => projects.lastUsed[id] == null)
      hot.sort((a, b) => (projects.lastUsed[b] ?? 0) - (projects.lastUsed[a] ?? 0))
      list = [...hot, ...cold]
    }
    return list
  }, [allIds, projects.order, projects.lastUsed, view.orderBy])

  const ownerProps = {
    query: view.query.trim(),
    wide,
    managing: viewOptionsOpen,
    order: effectiveOrder,
    hidden: [...projects.hidden, ...projects.removed],
    nameOverrides: projects.nameOverrides,
    iconOverrides: projects.iconOverrides,
    reportMeta,
    reportUsed,
    openSplit,
    activeSplitId,
  }

  // ── 拖动（≡ 手柄，与 v1 相同）──
  const onHandlePointerDown = (e: any) => {
    const root = rootRef.current
    if (!root) return
    const startRect = root.getBoundingClientRect()
    dragRef.current = { startY: e.clientY, startX: e.clientX, startRect, dragging: false, prevFloat: float }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
    setViewOptionsOpen(false); setAddOpen(false)
  }

  const onHandlePointerMove = (e: any) => {
    const d = dragRef.current
    if (!d) return
    const dy = e.clientY - d.startY
    if (!d.dragging && Math.abs(dy) < 6) return
    d.dragging = true
    // 浮动上限按区块实际高度计算：停靠位紧邻其下方，向上拖即可自然落位
    const maxTop = Math.max(MIN_TOP, window.innerHeight - d.startRect.height - 12)
    setFloat({ top: clamp(d.startRect.top + dy, MIN_TOP, maxTop) })
  }

  const onHandlePointerUp = (e: any) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || !d.dragging) return
    // 落点判定：以「松手瞬间指针位置」判断是否有有效落点（快速甩出范围 = 无落点）
    const maxTop = Math.max(MIN_TOP, window.innerHeight - d.startRect.height - 12)
    const rawTop = d.startRect.top + (e.clientY - d.startY)
    const outOfRange =
      rawTop > maxTop + OVER_BOTTOM_PX ||
      rawTop < MIN_TOP - OVER_TOP_PX ||
      e.clientX < d.startRect.left - OVER_SIDE_PX ||
      e.clientX > d.startRect.right + OVER_SIDE_PX
    if (outOfRange) {
      // 无有效落点：回归拖前位置（不持久化任何变化）
      setFloat(d.prevFloat)
      return
    }
    setFloat((cur) => {
      if (!cur) return null
      if (Math.abs(cur.top - d.startRect.top) < SNAP_PX) {
        persistView({ dock: 'footer', floatTop: null })
        return null
      }
      persistView({ dock: 'float', floatTop: cur.top })
      return cur
    })
  }

  const resetDock = () => {
    setFloat(null); persistView({ dock: 'footer', floatTop: null })
  }

  // Esc 关闭搜索
  const onSearchKeyDown = (e: any) => {
    if (e.key === 'Escape') {
      persistView({ searchOpen: false, query: '' })
    }
  }

  // ── 编辑模式动作（排序只用左缘 ≡ 抓手拖拽，无 ↑↓ 按钮） ──
  const moveTo = (id: string, targetId: string) => {
    if (id === targetId) return
    const list = [...effectiveOrder]
    const from = list.indexOf(id)
    const to = list.indexOf(targetId)
    if (from < 0 || to < 0) return
    list.splice(from, 1)
    list.splice(to, 0, id)
    persistProjects({ order: list })
  }

  const toggleHidden = (id: string) => {
    persistProjects((prev) => {
      const hidden = prev.hidden.includes(id)
        ? prev.hidden.filter((x) => x !== id)
        : [...prev.hidden, id]
      return { ...prev, hidden }
    })
  }

  const renameProject = (id: string, name: string) => {
    persistProjects((prev) => {
      const next = { ...prev.nameOverrides }
      if (name.trim()) next[id] = name
      else delete next[id]
      return { ...prev, nameOverrides: next }
    })
  }

  // 恢复默认：还原排序/隐藏/改名/图标/视图覆盖；已删除的项目不复活（真删除，可在「已删除的项目」重新添加）
  const resetProjects = () => {
    persistProjects((prev) => ({
      ...prev,
      order: [],
      hidden: [],
      nameOverrides: {},
      iconOverrides: {},
      views: {},
    }))
  }

  /** 重新添加已删除的入驻项目（删除 ↔ 重新添加 完全可逆） */
  const readdProject = (id: string) => {
    persistProjects((prev) => ({
      ...prev,
      removed: prev.removed.filter((x) => x !== id),
    }))
  }

  // ── 快捷方式（表单已移除，仅保留存量条目的删除能力） ──
  const removeShortcut = (id: string) => {
    persistProjects((prev) => ({ ...prev, shortcuts: prev.shortcuts.filter((s) => s.id !== id) }))
  }

  // ── 布局（新建工作区） ──
  const saveLayout = () => {
    const name = wsName.trim()
    if (!name) { setWsError(true); return }
    const layout = buildLayout(wsPreset, name)
    persistProjects((prev) => ({ ...prev, layouts: [...prev.layouts, layout] }))
    setWsName(''); setWsError(false)
    setAddOpen(false)
    openSplit(layout)
    reportUsed(layout.id)
  }

  const removeLayout = (id: string) => {
    persistProjects((prev) => ({ ...prev, layouts: prev.layouts.filter((l) => l.id !== id) }))
  }

  // ── 变更视图：所有项目通用。布局项目 = 重建其布局条目；入驻项目 = 建立/更新视图覆盖。
  // 现有窗内容（标签）按序迁入新拓扑，不丢失。 ──
  const applyLayoutChange = (id: string, presetId: string) => {
    const layout = projects.layouts.find((l) => l.id === id)
    const meta = metas[id]
    const current = layout ?? projects.views[id]
    const sources = current
      ? [...(current.top ?? []), ...current.main]
          .map((pp) => pp.tabs ?? [])
          .filter((tabs) => tabs.length > 0)
      : []
    const next = buildLayout(presetId, layout ? layout.title : (meta?.name ?? id))
    next.id = id
    next.icon = layout ? layout.icon : (projects.iconOverrides[id] ?? meta?.icon)
    const targets = [...(next.left ? [next.left] : []), ...(next.top ?? []), ...next.main]
    let si = 0
    for (const pane of targets) {
      if (si < sources.length) {
        pane.tabs = sources[si]
        pane.active = 0
        pane.content = null
        si++
      }
    }
    const overflow = sources.slice(si).flat()
    if (overflow.length > 0 && targets.length > 0) {
      const last = targets[targets.length - 1]
      last.tabs = [...(last.tabs ?? []), ...overflow]
      last.active = 0
    }
    persistProjects((prev) => layout
      ? { ...prev, layouts: prev.layouts.map((l) => (l.id === id ? next : l)) }
      : { ...prev, views: { ...prev.views, [id]: next } })
    // 该视图当前打开时：关旧开新，工作区即时变为新视图
    const wasOpen = splitStore.active && splitStore.spec?.id === id
    if (wasOpen) {
      splitStore.close()
      openSplit(next)
    }
    setViewPickFor(null)
  }

  /** 布局当前拓扑对应的预设 id（用于视图选择器高亮） */
  const presetOf = (l: LayoutSpec): string => {
    const leftCount = l.left ? 1 : 0
    const topCount = (l.top ?? []).length
    const contentCount = l.main.length
    const chatFull = l.chatFullHeight === true
    const def = PRESET_DEFS.find((d) =>
      d.leftCount === leftCount && d.topCount === topCount && d.contentCount === contentCount && d.chatFull === chatFull,
    )
    return def ? def.id : '2h'
  }

  // ── 删除（全部走二次确认；常驻项目 = 移出工作台，插件不卸载） ──
  const removeProject = (id: string) => {
    persistProjects((prev) => ({
      ...prev,
      removed: prev.removed.includes(id) ? prev.removed : [...prev.removed, id],
      hidden: prev.hidden.filter((x) => x !== id),
    }))
  }
  const askDelete = (kind: 'layout' | 'shortcut' | 'project', id: string, name: string) => {
    setRequestDelete({ kind, id, name })
  }
  const doDelete = () => {
    const r = requestDelete
    if (!r) return
    if (r.kind === 'layout') removeLayout(r.id)
    else if (r.kind === 'shortcut') removeShortcut(r.id)
    else removeProject(r.id)
    setRequestDelete(null)
  }

  // ── 图标选择器（布局 / 快捷方式 / 入驻项目的侧栏 emoji 点击可换） ──
  // anchor：DOM 锚点元素（自己卡片里的 icon 元素或事件 currentTarget）
  const openIconPick = (kind: 'layout' | 'shortcut' | 'project', id: string, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect()
    const x = Math.min(r.right + 8, Math.max(16, window.innerWidth - 284))
    const y = Math.max(MIN_TOP, Math.min(r.top - 4, window.innerHeight - 316))
    setIconPick({ kind, id, x, y })
  }
  const setLayoutIcon = (id: string, icon: string) => {
    persistProjects((prev) => ({
      ...prev,
      layouts: prev.layouts.map((l) => (l.id === id ? { ...l, icon } : l)),
    }))
  }
  const setShortcutIcon = (id: string, icon: string) => {
    persistProjects((prev) => ({
      ...prev,
      shortcuts: prev.shortcuts.map((s) => (s.id === id ? { ...s, icon } : s)),
    }))
  }
  const setProjectIcon = (id: string, icon: string) => {
    persistProjects((prev) => ({ ...prev, iconOverrides: { ...prev.iconOverrides, [id]: icon } }))
  }

  // ── 入驻项目卡片通用 DOM 桥（不写死任何项目名/类名） ──
  // 卡片按子座位注册顺序渲染，与 aliveRegisteredIds 一一对应：
  // 1) 位置映射：给每张卡片标 data-wt-id，图标覆盖写到卡片第一个子元素（通用结构约定）；
  // 2) 委托点击（捕获阶段）：卡片图标 → 图标选择器；有视图覆盖的项目 → 用引擎打开该视图。
  useEffect(() => {
    const sync = () => {
      const box = document.querySelector<HTMLElement>('.dsh-wt_projects')
      if (!box) return
      // 子座位把所有卡片包在一个无类容器里：直接取卡片按钮（DOM 序 = 注册序），排除自渲染的布局卡
      const cards = Array.from(box.querySelectorAll<HTMLElement>('button:not(.dsh-wt_layout)'))
      cards.forEach((el, i) => {
        const id = aliveRegisteredIds[i]
        if (id) {
          el.setAttribute('data-wt-id', id)
          const icon = el.children[0] as HTMLElement | null
          if (icon) {
            const ovr = projects.iconOverrides[id]
            if (ovr) icon.setAttribute('data-wt-icon', ovr)
            else icon.removeAttribute('data-wt-icon')
          }
          // 选中态统一由工作台判定（引擎打开的项目高亮；未打开时若引擎空闲则保留卡片自带状态，
          // 兼容自带分栏实现的插件）
          if (activeSplitId === id) el.setAttribute('data-on', 'true')
          else if (activeSplitId != null) el.setAttribute('data-on', 'false')
        } else {
          el.removeAttribute('data-wt-id')
        }
      })
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [aliveRegisteredIds, projects.iconOverrides, activeSplitId])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const card = target && target.closest
        ? (target.closest('.dsh-wt_projects [data-wt-id]') as HTMLElement | null)
        : null
      if (!card) return
      const pid = card.getAttribute('data-wt-id')
      if (!pid) return
      // 图标点击（卡片第一个子元素内） → 打开图标选择器（阻止卡片自身打开项目）
      const first = card.children[0] as HTMLElement | null
      if (first && target && first.contains(target)) {
        e.stopPropagation()
        e.preventDefault()
        openIconPick('project', pid, first)
        return
      }
      // 有视图覆盖 → 用引擎打开该视图（替换卡片自带行为）
      const view = projects.views[pid]
      if (view) {
        e.stopPropagation()
        e.preventDefault()
        openSplit(view)
        reportUsed(pid)
      }
    }
    document.addEventListener('click', onDocClick, true)
    return () => document.removeEventListener('click', onDocClick, true)
  }, [projects.views, openSplit, reportUsed])

  const query = view.query.trim()
  const queryLower = query.toLowerCase()
  const visibleShortcuts = projects.shortcuts.filter((s) =>
    !queryLower || (s.name + ' ' + s.href).toLowerCase().includes(queryLower),
  )
  const visibleLayouts = projects.layouts.filter((l) => {
    if (projects.hidden.includes(l.id)) return false
    if (!queryLower) return true
    const paneTitles = [...(l.top ?? []), ...l.main].map((p) => p.title).join(' ')
    return (l.title + ' ' + paneTitles).toLowerCase().includes(queryLower)
  })

  const isFloat = float != null
  const floatStyle = isFloat
    ? {
        position: 'fixed' as const,
        top: float.top,
        left: floatGeo?.left ?? 14,
        ...(floatGeo?.width != null ? { width: floatGeo.width } : {}),
        zIndex: 70,
      }
    : undefined

  useEffect(() => { bottomInsetRef.current = bottomInset }, [bottomInset])
  useEffect(() => { floatRef.current = float }, [float])

  // ── 底部悬浮面板避让 ──
  // 停靠态下检测「侧边栏列内、贴近底部、且与区块自然位置重叠」的 fixed 面板
  // （如 dsh-usage 的余额 dock），把区块整体抬到面板上方，双方互不遮挡、都可调整位置。
  const measureBottomOverlay = useCallback(() => {
    if (isFloat) return
    const root = rootRef.current
    if (!root) return
    const self = root.getBoundingClientRect()
    if (self.width < 10) return
    const naturalBottom = self.bottom + bottomInsetRef.current
    const loX = self.left - 8
    const hiX = self.right + 8
    const regionTop = window.innerHeight - 300
    let needed = 0
    const nodes = document.querySelectorAll<HTMLElement>('body *')
    for (const el of nodes) {
      const r = el.getBoundingClientRect()
      if (r.width < 40 || r.height < 16) continue
      if (r.top < regionTop) continue
      if (r.left > 80) continue
      if (r.right < loX || r.left > hiX) continue
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed') continue
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
      if (r.top >= naturalBottom + 4) continue
      const overlap = Math.min(r.bottom, naturalBottom + 400) - r.top
      if (overlap > 8) {
        needed = Math.max(needed, Math.min(naturalBottom - r.top + 8, 340))
      }
    }
    setBottomInset((prev) => (Math.abs(prev - needed) < 2 ? prev : needed))
  }, [isFloat])

  // 停靠/折叠变化时立即重测；停靠期间每 2s 轮询（悬浮面板自身可移动）
  useEffect(() => {
    if (!isFloat) measureBottomOverlay()
  }, [isFloat, wide, measureBottomOverlay])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!floatRef.current) measureBottomOverlay()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [measureBottomOverlay])

  const dockedStyle = !isFloat && bottomInset > 0 ? { marginBottom: bottomInset } : undefined

  // + 弹窗：向右弹出、锚定 sidebar 右边缘与工作台区块顶部（视口内钳制）
  const sectionTop = rootRef.current?.getBoundingClientRect().top ?? 100
  const popLeft = sidebarRight != null
    ? Math.min(sidebarRight + 8, Math.max(16, window.innerWidth - 344))
    : 16
  const popTop = clamp(sectionTop, MIN_TOP, Math.max(MIN_TOP, window.innerHeight - 540))

  if (!wide) {
    const projectIcons = aliveRegisteredIds.map((id) => projects.iconOverrides[id] ?? metas[id]?.icon ?? '📦')
    const shortcutIcons = projects.shortcuts.map((s) => s.icon)
    const layoutIcons = projects.layouts.map((l) => l.icon ?? '🧱')
    const icons = [...projectIcons, ...shortcutIcons, ...layoutIcons]
    const railNames = [
      ...aliveRegisteredIds.map((id) => projects.nameOverrides[id] ?? metas[id]?.name ?? id),
      ...projects.shortcuts.map((s) => s.name),
      ...projects.layouts.map((l) => projects.nameOverrides[l.id] ?? l.title),
    ]
    // 浮动态：fixed 定位到拖前高度（左/宽取折叠列实测几何）；停靠态：文档流原位
    const railStyle = isFloat && railRect
      ? { position: 'fixed' as const, top: float.top, left: railRect.left, width: railRect.width, zIndex: 70 }
      : bottomInset > 0 ? { marginBottom: bottomInset } : undefined
    return (
      <div ref={rootRef} className="dsh-wt_section dsh-wt_rail" style={railStyle}>
        <div className="dsh-wt_divider" />
        <div className="dsh-wt_railBox" title={railNames.join(' · ') || t('rail.title')}>
          {icons.length > 0
            ? icons.map((icon, i) => <span key={i} className="dsh-wt_railIcon">{icon}</span>)
            : <span className="dsh-wt_railIcon">≡</span>}
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className={'dsh-wt_section' + (isFloat ? ' dsh-wt_float' : '')} style={isFloat ? floatStyle : dockedStyle}>
      <div className="dsh-wt_divider" />
      <div className="dsh-wt_header">
        <button
          type="button"
          className="dsh-wt_handle"
          data-float={isFloat ? 'true' : 'false'}
          title={t('handle.title')}
          aria-label={t('handle.aria')}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onDoubleClick={resetDock}
        >≡</button>
        <span
          className="dsh-wt_title"
          title={t('handle.title')}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onDoubleClick={resetDock}
        >{t('title')}</span>
        <div className="dsh-wt_actions">
          <button
            type="button"
            className="dsh-wt_iconBtn"
            aria-label={t('menu.search')}
            title={t('menu.search')}
            onClick={() => persistView({ searchOpen: !view.searchOpen, query: view.searchOpen ? '' : view.query })}
          >{ICON_SEARCH}</button>
          <button
            type="button"
            className="dsh-wt_iconBtn"
            aria-label={t('menu.viewOptions')}
            title={t('menu.viewOptions')}
            onClick={() => { setViewOptionsOpen((v) => !v); setAddOpen(false) }}
          >{ICON_VIEW_OPTIONS}</button>
          <button
            type="button"
            className="dsh-wt_iconBtn"
            aria-label={t('menu.add')}
            title={t('menu.add')}
            onClick={() => { setAddOpen((v) => !v); setViewOptionsOpen(false) }}
          >{ICON_ADD}</button>
        </div>
      </div>

      {view.searchOpen && (
        <div className="dsh-wt_search">
          <input
            autoFocus
            type="text"
            placeholder={t('search.placeholder')}
            value={view.query}
            onChange={(e) => persistView({ query: e.target.value })}
            onKeyDown={onSearchKeyDown}
          />
          <button type="button" className="dsh-wt_searchClear" aria-label={t('search.close')}
            onClick={() => persistView({ searchOpen: false, query: '' })}>✕</button>
        </div>
      )}

      {addOpen && <div className="dsh-wt_popBackdrop" onClick={() => setAddOpen(false)} />}
      {addOpen && (
        <div className="dsh-wt_menu dsh-wt_add dsh-wt_pop" style={{ position: 'fixed', left: popLeft, top: popTop, width: 320, zIndex: 80 }}>
          <span className="dsh-wt_menuLabel">{t('add.chooseLayout')}</span>
          <div className="dsh-wt_presets">
            {PRESET_DEFS.map((def) => (
              <button
                key={def.id}
                type="button"
                className="dsh-wt_preset"
                data-on={wsPreset === def.id ? 'true' : 'false'}
                onClick={() => { setWsPreset(def.id); setWsError(false) }}
              >
                {presetThumb(def.id)}
              </button>
            ))}
          </div>
          <div className="dsh-wt_addForm">
            <input type="text" placeholder={t('add.layoutNamePh')} value={wsName}
              onChange={(e) => { setWsName(e.target.value); setWsError(false) }} />
            <button type="button" className="dsh-wt_addBtn" onClick={saveLayout}>{t('add.layoutSave')}</button>
          </div>
          {wsError && <p className="dsh-wt_addError">{t('add.layoutInvalid')}</p>}
        </div>
      )}

      {iconPick && (
        <>
          <div className="dsh-wt_popBackdrop" onClick={() => setIconPick(null)} />
          <div className="dsh-wt_iconPop" style={{ left: iconPick.x, top: iconPick.y }}>
            <div className="dsh-wt_iconPopTitle">{t('icons.title')}</div>
            <div className="dsh-wt_iconGrid">
              {EMOJI_SET.map((em) => {
                const cur = iconPick.kind === 'layout'
                  ? (projects.layouts.find((l) => l.id === iconPick.id)?.icon ?? '🧱')
                  : iconPick.kind === 'shortcut'
                    ? (projects.shortcuts.find((s) => s.id === iconPick.id)?.icon ?? '🔗')
                    : (projects.iconOverrides[iconPick.id] ?? metas[iconPick.id]?.icon ?? '📦')
                return (
                  <button
                    key={em}
                    type="button"
                    className="dsh-wt_iconCell"
                    data-on={cur === em ? 'true' : 'false'}
                    onClick={() => {
                      if (iconPick.kind === 'layout') setLayoutIcon(iconPick.id, em)
                      else if (iconPick.kind === 'shortcut') setShortcutIcon(iconPick.id, em)
                      else setProjectIcon(iconPick.id, em)
                      setIconPick(null)
                    }}
                  >{em}</button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {viewOptionsOpen && <div className="dsh-wt_popBackdrop" onClick={() => setViewOptionsOpen(false)} />}
      {viewOptionsOpen && (
        <div className="dsh-wt_manage dsh-wt_pop dsh-wt_settings" style={{ position: 'fixed', left: popLeft, top: popTop, width: 316, zIndex: 80 }}>
          <span className="dsh-wt_menuLabel">{t('sort.label')}</span>
          <button type="button" className="dsh-wt_menuItem" data-on={view.orderBy === 'manual'}
            onClick={() => persistView({ orderBy: 'manual' })}>{t('sort.manual')}</button>
          <button type="button" className="dsh-wt_menuItem" data-on={view.orderBy === 'recent'}
            onClick={() => persistView({ orderBy: 'recent' })}>{t('sort.recent')}</button>
          <div className="dsh-wt_menuSep" />
          <div className="dsh-wt_manageHead">
            <span className="dsh-wt_manageTitle">{t('manage.title')}</span>
            <button type="button" className="dsh-wt_manageDone" onClick={() => setViewOptionsOpen(false)}>{t('manage.done')}</button>
          </div>
          {effectiveOrder.map((id) => {
            const meta = metas[id]
            const layout = projects.layouts.find((l) => l.id === id)
            const display = projects.nameOverrides[id] ?? layout?.title ?? meta?.name ?? id
            const isHidden = projects.hidden.includes(id)
            return (
              <div
                key={id}
                className={'dsh-wt_manageRow' + (isHidden ? ' dsh-wt_manageRowOff' : '')}
                draggable
                onDragStart={(e: any) => { dragIdRef.current = id; try { e.dataTransfer.effectAllowed = 'move' } catch {} }}
                onDragOver={(e: any) => {
                  e.preventDefault()
                  const dragId = dragIdRef.current
                  if (dragId && dragId !== id) moveTo(dragId, id)
                }}
                onDrop={(e: any) => e.preventDefault()}
                onDragEnd={() => { dragIdRef.current = null }}
              >
                <span className="dsh-wt_manageGrip" aria-hidden>≡</span>
                {layout
                  ? <span
                      className="dsh-wt_manageIcon dsh-wt_iconPick"
                      role="button"
                      tabIndex={0}
                      title={t('icons.change')}
                      onClick={(e) => { e.stopPropagation(); openIconPick('layout', id, e.currentTarget as HTMLElement) }}
                    >{layout.icon ?? '🧱'}</span>
                  : <span
                      className="dsh-wt_manageIcon dsh-wt_iconPick"
                      role="button"
                      tabIndex={0}
                      title={t('icons.change')}
                      onClick={(e) => { e.stopPropagation(); openIconPick('project', id, e.currentTarget as HTMLElement) }}
                    >{projects.iconOverrides[id] ?? meta?.icon ?? '📦'}</span>}
                <input
                  className="dsh-wt_manageInput"
                  value={display}
                  placeholder={t('manage.renamePh')}
                  onChange={(e) => renameProject(id, e.target.value)}
                />
                <button type="button" className="dsh-wt_manageBtn" title={isHidden ? t('manage.show') : t('manage.hide')} onClick={() => toggleHidden(id)}>
                  {isHidden ? '🙈' : '👁'}
                </button>
                <button type="button" className="dsh-wt_manageBtn" title={t('manage.changeView')} onClick={() => setViewPickFor(id)}>🧩</button>
                <button
                  type="button"
                  className="dsh-wt_manageBtn"
                  title={layout ? t('manage.deleteLayout') : t('manage.deleteProject')}
                  onClick={() => askDelete(layout ? 'layout' : 'project', id, display)}
                >✕</button>
              </div>
            )
          })}
          {projects.shortcuts.map((s) => (
            <div key={s.id} className="dsh-wt_manageRow dsh-wt_manageRowSc">
              <span className="dsh-wt_manageGrip" aria-hidden>🔗</span>
              <span
                className="dsh-wt_manageIcon dsh-wt_iconPick"
                role="button"
                tabIndex={0}
                title={t('icons.change')}
                onClick={(e) => { e.stopPropagation(); openIconPick('shortcut', s.id, e.currentTarget as HTMLElement) }}
              >{s.icon}</span>
              <span className="dsh-wt_manageScName">{s.name}</span>
              <button type="button" className="dsh-wt_manageBtn" title={t('manage.deleteShortcut')} onClick={() => askDelete('shortcut', s.id, s.name)}>✕</button>
            </div>
          ))}
          <button type="button" className="dsh-wt_manageReset" onClick={resetProjects}>{t('manage.reset')}</button>
          {projects.removed.length > 0 && (
            <>
              <div className="dsh-wt_menuSep" />
              <span className="dsh-wt_menuLabel">{t('manage.removed')}</span>
              {projects.removed.map((rid) => (
                <div key={rid} className="dsh-wt_manageRow dsh-wt_manageRowOff dsh-wt_manageRowRemoved">
                  <span className="dsh-wt_manageScName">{projects.nameOverrides[rid] ?? metas[rid]?.name ?? rid}</span>
                  <button type="button" className="dsh-wt_manageBtn" title={t('manage.readd')} onClick={() => readdProject(rid)}>↺</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {viewPickFor && <div className="dsh-wt_popBackdrop" style={{ zIndex: 81 }} onClick={() => setViewPickFor(null)} />}
      {viewPickFor && (
        <div className="dsh-wt_menu dsh-wt_pop" style={{ position: 'fixed', left: popLeft, top: popTop, width: 320, zIndex: 82 }}>
          <span className="dsh-wt_menuLabel">{t('viewPick.title')}</span>
          <div className="dsh-wt_presets">
            {PRESET_DEFS.map((def) => {
              const cur = projects.layouts.find((l) => l.id === viewPickFor) ?? projects.views[viewPickFor]
              return (
                <button
                  key={def.id}
                  type="button"
                  className="dsh-wt_preset"
                  data-on={cur && presetOf(cur) === def.id ? 'true' : 'false'}
                  onClick={() => applyLayoutChange(viewPickFor, def.id)}
                >
                  {presetThumb(def.id)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {requestDelete && <div className="dsh-wt_confirmBackdrop" onClick={() => setRequestDelete(null)} />}
      {requestDelete && (
        <div className="dsh-wt_confirm" role="alertdialog">
          <div className="dsh-wt_confirmTitle">⚠️ {t('confirm.title')}</div>
          <div className="dsh-wt_confirmBody">
            {requestDelete.kind === 'layout'
              ? t('confirm.layoutBody', { name: requestDelete.name })
              : requestDelete.kind === 'shortcut'
                ? t('confirm.shortcutBody', { name: requestDelete.name })
                : t('confirm.projectBody', { name: requestDelete.name })}
          </div>
          <div className="dsh-wt_confirmActions">
            <button type="button" className="dsh-wt_confirmCancel" onClick={() => setRequestDelete(null)}>{t('confirm.cancel')}</button>
            <button type="button" className="dsh-wt_confirmDelete" onClick={doDelete}>{t('confirm.delete')}</button>
          </div>
        </div>
      )}

      <div className="dsh-wt_projects" data-managing={viewOptionsOpen ? 'true' : undefined}>
        {renderProjectSlot
          ? renderProjectSlot('sidebar.worktable.project', ownerProps)
          : <div className="dsh-wt_empty">{t('empty')}</div>}
        {visibleLayouts.map((l) => (
          <button
            key={l.id}
            type="button"
            className="dsh-wt_layout"
            data-on={activeSplitId === l.id ? 'true' : 'false'}
            style={{ order: effectiveOrder.indexOf(l.id) + 1000 }}
            onClick={() => { openSplit(l); reportUsed(l.id) }}
          >
            <span
              className="dsh-wt_layoutIcon dsh-wt_iconPick"
              role="button"
              tabIndex={0}
              title={t('icons.change')}
              onClick={(e) => { e.stopPropagation(); openIconPick('layout', l.id, e.currentTarget as HTMLElement) }}
            >{l.icon ?? '🧱'}</span>
            <span className="dsh-wt_layoutText">
              <span className="dsh-wt_layoutName">{projects.nameOverrides[l.id] ?? l.title}</span>
            </span>
            <span className="dsh-wt_layoutArrow" aria-hidden>›</span>
          </button>
        ))}
      </div>

      {visibleShortcuts.length > 0 && (
        <div className="dsh-wt_shortcuts">
          {visibleShortcuts.map((s) => (
            <a
              key={s.id}
              className="dsh-wt_shortcut"
              href={s.href}
              target="_blank"
              rel="noreferrer noopener"
              title={s.href}
            >
              <span
                className="dsh-wt_shortcutIcon dsh-wt_iconPick"
                role="button"
                tabIndex={0}
                title={t('icons.change')}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); openIconPick('shortcut', s.id, e.currentTarget as HTMLElement) }}
              >{s.icon}</span>
              <span className="dsh-wt_shortcutName">{s.name}</span>
              <span className="dsh-wt_shortcutBadge">{t('shortcut.badge')}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export const inject = ['slots', 'locale', 'sessions']

export function apply(ctx: any) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-dsh-plugin', 'dsh-worktable')
    style.textContent = css
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dsh-worktable: styles')

  // locale 词典（宿主 locale 服务缺席时由 t 的回退分支兜底）
  ctx.effect(() => {
    if (ctx.locale?.register) return ctx.locale.register(NS, { zh, en })
  }, 'dsh-worktable: dictionaries')

  // 子座位注册 id 序列跟踪（供排序/编辑模式使用）
  const syncIds = () => {
    const entries = ctx.slots.entries('sidebar.worktable.project')
    const ids: string[] = []
    for (const entry of entries) {
      const id = entry?.options?.id
      if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id)
    }
    registryStore.ids = ids
    for (const fn of registryStore.listeners) fn()
  }
  const disposeSubscribe = ctx.slots.subscribe('sidebar.worktable.project', syncIds)
  syncIds()
  ctx.effect(() => disposeSubscribe, 'dsh-worktable: project registry watch')

  // 会话作用域（当前会话 cwd 与后台任务）→ 功能窗数据源
  const sessionsList = ctx.sessions?.list
  if (sessionsList && typeof sessionsList.getSnapshot === 'function') {
    syncSessionScope(sessionsList)
    const disposeScope = sessionsList.subscribe(() => syncSessionScope(sessionsList))
    ctx.effect(() => disposeScope, 'dsh-worktable: session scope watch')
  }

  // 分栏工作区浮层（M1 通用引擎，shell.overlay 座位）
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-worktable-split',
    order: 100,
  }, SplitWorkspace), 'dsh-worktable: split workspace overlay')

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-worktable',
    order: 20,
    children: {
      'sidebar.worktable.project': {
        kind: 'list',
        scope: 'root',
      },
    },
  }, WorktableSection), 'dsh-worktable: worktable section')
}

export { WorktableSection }
