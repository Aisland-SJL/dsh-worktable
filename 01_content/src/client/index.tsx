import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { css } from './styles'
import { NS, zh, en, type WorktableKey } from './locales'
import { splitStore, SplitWorkspace, type LayoutSpec } from './split'

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
/** 自带分栏实现的遗留项目（如 travelatlas，未接入 openSplit 引擎）：埋点用冷却去重，避免每次点击置顶 */
const LEGACY_SPLIT_IDS = new Set(['travelatlas'])
/** 遗留项目埋点冷却（毫秒）：同 id 两次计使用的最小间隔 */
const LEGACY_BUMP_COOLDOWN = 15000
/** 落点判定余量：松手时指针越出有效落点区（超出底部/顶部/侧边）即视为「无有效落点」。 */
const OVER_BOTTOM_PX = 24
const OVER_TOP_PX = 24
const OVER_SIDE_PX = 80

/** 拓扑预设（聊天窗恒贴右，PRD §13.2 硬约束）：左右/三栏/上一下二/井字 */
const PRESET_DEFS = [
  { id: '2h', topCount: 0, contentCount: 1 },
  { id: '3h', topCount: 0, contentCount: 2 },
  { id: 't2', topCount: 1, contentCount: 1 },
  { id: 'grid', topCount: 2, contentCount: 1 },
] as const

function presetTotal(def: { topCount: number; contentCount: number }): number {
  return def.topCount + def.contentCount
}

function buildLayout(presetId: string, name: string, urls: string[]): LayoutSpec {
  const def = PRESET_DEFS.find((d) => d.id === presetId) ?? PRESET_DEFS[0]
  const mk = (i: number, url: string) => ({
    id: 'p' + (i + 1),
    title: '内容' + (i + 1),
    min: 200,
    content: { kind: 'iframe' as const, url },
  })
  const top = Array.from({ length: def.topCount }, (_, i) => mk(i, urls[i] ?? 'about:blank'))
  const main = Array.from({ length: def.contentCount }, (_, i) => mk(def.topCount + i, urls[def.topCount + i] ?? 'about:blank'))
  return {
    id: 'layout-' + Date.now().toString(36),
    title: name,
    top: top.length > 0 ? top : null,
    main,
    chatWidth: { default: 360, min: 240, max: 600 },
    topHeight: { default: 200, min: 120, max: 480 },
  }
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
  const [managing, setManaging] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false)
  const [scName, setScName] = useState('')
  const [scIcon, setScIcon] = useState('')
  const [scHref, setScHref] = useState('')
  const [scError, setScError] = useState(false)
  const [wsPreset, setWsPreset] = useState<string>('2h')
  const [wsName, setWsName] = useState('')
  const [wsUrls, setWsUrls] = useState<string[]>(['', '', ''])
  const [wsError, setWsError] = useState(false)
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
  const [activeSplitId, setActiveSplitId] = useState<string | null>(() =>
    splitStore.active && splitStore.spec ? splitStore.spec.id : null,
  )
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
    } else if (LEGACY_SPLIT_IDS.has(id)) {
      // 遗留自带分栏的项目：冷却去重（打开计一次；快速开关/关闭点击不重复计）
      if (now - (lastLegacyBumpRef.current[id] ?? 0) > LEGACY_BUMP_COOLDOWN) {
        lastLegacyBumpRef.current[id] = now
        bump()
      }
    } else {
      bump() // 无判定依据的普通项目：保持原行为
    }
  }, [])

  /** 分栏工作区入口（M1 引擎）：项目卡片调用 openSplit(spec) 打开声明式布局 */
  const openSplit = useCallback((spec: LayoutSpec) => {
    engineIdsRef.current.add(spec.id)
    splitStore.open(spec)
  }, [])

  // ── 有效排序 ──
  // 手动：持久化 order（过滤已卸载 id）→ 新注册 id 与布局 id 追加尾部；
  // 最近：有 lastUsed 的按时间降序在前，其余按手动序在后。
  const layoutIds = useMemo(() => projects.layouts.map((l) => l.id), [projects.layouts])
  const allIds = useMemo(() => [...registeredIds, ...layoutIds], [registeredIds, layoutIds])
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
    managing,
    order: effectiveOrder,
    hidden: projects.hidden,
    nameOverrides: projects.nameOverrides,
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

  // ── 编辑模式动作 ──
  const moveBy = (id: string, delta: number) => {
    const list = [...effectiveOrder]
    const i = list.indexOf(id)
    const j = clamp(i + delta, 0, list.length - 1)
    if (i < 0 || i === j) return
    list.splice(i, 1)
    list.splice(j, 0, id)
    persistProjects({ order: list })
  }

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

  const resetProjects = () => {
    persistProjects((prev) => ({ ...prev, order: [], hidden: [], nameOverrides: {} }))
  }

  // ── 快捷方式 ──
  const addShortcut = () => {
    const name = scName.trim()
    const href = scHref.trim()
    if (!name || !/^https?:\/\//i.test(href)) { setScError(true); return }
    const shortcut: Shortcut = { id: 'sc-' + Date.now().toString(36), name, icon: scIcon.trim() || '🔗', href }
    persistProjects((prev) => ({ ...prev, shortcuts: [...prev.shortcuts, shortcut] }))
    setScName(''); setScIcon(''); setScHref(''); setScError(false)
  }

  const removeShortcut = (id: string) => {
    persistProjects((prev) => ({ ...prev, shortcuts: prev.shortcuts.filter((s) => s.id !== id) }))
  }

  // ── 布局（新建工作区） ──
  const saveLayout = () => {
    const name = wsName.trim()
    const def = PRESET_DEFS.find((d) => d.id === wsPreset) ?? PRESET_DEFS[0]
    const total = presetTotal(def)
    const urls = wsUrls.slice(0, total).map((u) => u.trim())
    if (!name || urls.some((u) => !/^(\/|https?:\/\/)/i.test(u))) { setWsError(true); return }
    const layout = buildLayout(wsPreset, name, urls)
    persistProjects((prev) => ({ ...prev, layouts: [...prev.layouts, layout] }))
    setWsName(''); setWsUrls(['', '', '']); setWsError(false)
    setAddOpen(false)
    openSplit(layout)
    reportUsed(layout.id)
  }

  const removeLayout = (id: string) => {
    persistProjects((prev) => ({ ...prev, layouts: prev.layouts.filter((l) => l.id !== id) }))
  }

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

  if (!wide) {
    const projectIcons = registeredIds.map((id) => metas[id]?.icon ?? '📦')
    const shortcutIcons = projects.shortcuts.map((s) => s.icon)
    const layoutIcons = projects.layouts.map(() => '🧱')
    const icons = [...projectIcons, ...shortcutIcons, ...layoutIcons]
    const railNames = [
      ...registeredIds.map((id) => projects.nameOverrides[id] ?? metas[id]?.name ?? id),
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
          >🔍</button>
          <button
            type="button"
            className="dsh-wt_iconBtn"
            aria-label={t('menu.viewOptions')}
            title={t('menu.viewOptions')}
            onClick={() => { setViewOptionsOpen((v) => !v); setAddOpen(false) }}
          >☰</button>
          <button
            type="button"
            className="dsh-wt_iconBtn"
            aria-label={t('menu.add')}
            title={t('menu.add')}
            onClick={() => { setAddOpen((v) => !v); setViewOptionsOpen(false) }}
          >+</button>
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

      {addOpen && (
        <div className="dsh-wt_menu dsh-wt_add">
          <span className="dsh-wt_menuLabel">{t('add.guideTitle')}</span>
          <p className="dsh-wt_addText">{t('add.guideBody')}</p>
          <a className="dsh-wt_menuItem dsh-wt_addLink" href={MARKET_URL} target="_blank" rel="noreferrer noopener">
            {t('add.market')} ↗
          </a>
          <span className="dsh-wt_menuLabel">{t('add.shortcutTitle')}</span>
          <p className="dsh-wt_addText">{t('add.shortcutDesc')}</p>
          <div className="dsh-wt_addForm">
            <input type="text" placeholder={t('add.shortcutNamePh')} value={scName}
              onChange={(e) => { setScName(e.target.value); setScError(false) }} />
            <input type="text" className="dsh-wt_addIcon" placeholder={t('add.shortcutIcon')} value={scIcon} maxLength={4}
              onChange={(e) => setScIcon(e.target.value)} />
            <input type="text" placeholder={t('add.shortcutHref')} value={scHref}
              onChange={(e) => { setScHref(e.target.value); setScError(false) }} />
            <button type="button" className="dsh-wt_addBtn" onClick={addShortcut}>{t('add.shortcutAdd')}</button>
          </div>
          {scError && <p className="dsh-wt_addError">{t('add.shortcutInvalid')}</p>}
          <div className="dsh-wt_menuSep" />
          <span className="dsh-wt_menuLabel">{t('add.workspaceTitle')}</span>
          <p className="dsh-wt_addText">{t('add.workspaceDesc')}</p>
          <div className="dsh-wt_presets">
            {PRESET_DEFS.map((def) => (
              <button
                key={def.id}
                type="button"
                className="dsh-wt_preset"
                data-on={wsPreset === def.id ? 'true' : 'false'}
                onClick={() => { setWsPreset(def.id); setWsError(false) }}
              >
                {t('preset.' + def.id)}
              </button>
            ))}
          </div>
          <div className="dsh-wt_addForm">
            <input type="text" placeholder={t('add.layoutNamePh')} value={wsName}
              onChange={(e) => { setWsName(e.target.value); setWsError(false) }} />
            {Array.from({ length: presetTotal(PRESET_DEFS.find((d) => d.id === wsPreset) ?? PRESET_DEFS[0]) }, (_, i) => (
              <input
                key={i}
                type="text"
                placeholder={t('add.paneUrlPh')}
                value={wsUrls[i] ?? ''}
                onChange={(e) => {
                  setWsUrls((prev) => { const next = [...prev]; next[i] = e.target.value; return next })
                  setWsError(false)
                }}
              />
            ))}
            <button type="button" className="dsh-wt_addBtn" onClick={saveLayout}>{t('add.layoutSave')}</button>
          </div>
          {wsError && <p className="dsh-wt_addError">{t('add.layoutInvalid')}</p>}
        </div>
      )}

      {viewOptionsOpen && (
        <div className="dsh-wt_menu">
          <span className="dsh-wt_menuLabel">{t('sort.label')}</span>
          <button type="button" className="dsh-wt_menuItem" data-on={view.orderBy === 'manual'}
            onClick={() => { persistView({ orderBy: 'manual' }); setViewOptionsOpen(false) }}>{t('sort.manual')}</button>
          <button type="button" className="dsh-wt_menuItem" data-on={view.orderBy === 'recent'}
            onClick={() => { persistView({ orderBy: 'recent' }); setViewOptionsOpen(false) }}>{t('sort.recent')}</button>
          <div className="dsh-wt_menuSep" />
          <button type="button" className="dsh-wt_menuItem"
            onClick={() => { setManaging(true); setViewOptionsOpen(false) }}>{t('menu.manage')}</button>
        </div>
      )}

      {managing && (
        <div className="dsh-wt_manage">
          <div className="dsh-wt_manageHead">
            <span className="dsh-wt_manageTitle">{t('manage.title')}</span>
            <button type="button" className="dsh-wt_manageDone" onClick={() => setManaging(false)}>{t('manage.done')}</button>
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
                <span className="dsh-wt_manageIcon" aria-hidden>{layout ? '🧱' : (meta?.icon ?? '📦')}</span>
                <input
                  className="dsh-wt_manageInput"
                  value={display}
                  placeholder={t('manage.renamePh')}
                  onChange={(e) => renameProject(id, e.target.value)}
                />
                <button type="button" className="dsh-wt_manageBtn" title={t('manage.up')} onClick={() => moveBy(id, -1)}>↑</button>
                <button type="button" className="dsh-wt_manageBtn" title={t('manage.down')} onClick={() => moveBy(id, 1)}>↓</button>
                <button type="button" className="dsh-wt_manageBtn" title={isHidden ? t('manage.show') : t('manage.hide')} onClick={() => toggleHidden(id)}>
                  {isHidden ? '🙈' : '👁'}
                </button>
                {layout && (
                  <button type="button" className="dsh-wt_manageBtn" title={t('manage.deleteLayout')} onClick={() => removeLayout(id)}>✕</button>
                )}
              </div>
            )
          })}
          {projects.shortcuts.map((s) => (
            <div key={s.id} className="dsh-wt_manageRow dsh-wt_manageRowSc">
              <span className="dsh-wt_manageGrip" aria-hidden>🔗</span>
              <span className="dsh-wt_manageIcon" aria-hidden>{s.icon}</span>
              <span className="dsh-wt_manageScName">{s.name}</span>
              <button type="button" className="dsh-wt_manageBtn" title={t('manage.deleteShortcut')} onClick={() => removeShortcut(s.id)}>✕</button>
            </div>
          ))}
          <button type="button" className="dsh-wt_manageReset" onClick={resetProjects}>{t('manage.reset')}</button>
        </div>
      )}

      <div className="dsh-wt_projects" data-managing={managing ? 'true' : undefined}>
        {renderProjectSlot
          ? renderProjectSlot('sidebar.worktable.project', ownerProps)
          : <div className="dsh-wt_empty">{t('empty')}</div>}
        {visibleLayouts.map((l) => {
          const paneCount = [...(l.top ?? []), ...l.main].length
          return (
            <button
              key={l.id}
              type="button"
              className="dsh-wt_layout"
              data-on={activeSplitId === l.id ? 'true' : 'false'}
              style={{ order: effectiveOrder.indexOf(l.id) + 1000 }}
              onClick={() => { openSplit(l); reportUsed(l.id) }}
            >
              <span className="dsh-wt_layoutIcon" aria-hidden>🧱</span>
              <span className="dsh-wt_layoutText">
                <span className="dsh-wt_layoutName">{projects.nameOverrides[l.id] ?? l.title}</span>
                <span className="dsh-wt_layoutDesc">{t('layout.desc', { n: String(paneCount) })}</span>
              </span>
              <span className="dsh-wt_layoutBadge">{t('layout.badge')}</span>
              <span className="dsh-wt_layoutArrow" aria-hidden>›</span>
            </button>
          )
        })}
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
              <span className="dsh-wt_shortcutIcon" aria-hidden>{s.icon}</span>
              <span className="dsh-wt_shortcutName">{s.name}</span>
              <span className="dsh-wt_shortcutBadge">{t('shortcut.badge')}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export const inject = ['slots', 'locale']

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
