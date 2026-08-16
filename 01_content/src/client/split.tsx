import { useEffect, useState } from 'react'

/**
 * dsh-worktable 乐高式工作区 M1：通用分栏引擎（PRD §13）。
 * 布局模型：标题栏 + 顶部通栏行（可选）+ 主行（内容窗，从左到右）+ 右下聊天窗（官方会话视图区整体）。
 * 聊天窗几何 = marginLeft + marginTop 组合挤法；会话切换重新锚定（§12.4，切会话不关闭）。
 * 宽度持久化：dsh.worktable.split.v1 = { [layoutId]: { chatW, topH, paneWs, topWs } }。
 */

export type SplitContent = { kind: 'iframe'; url: string }

export type SplitPane = { id: string; title: string; min: number; content: SplitContent }

export type LayoutSpec = {
  id: string
  title: string
  /** 顶部通栏行（可选；每项为内容窗，横跨整列宽） */
  top: SplitPane[] | null
  /** 主行内容窗（从左到右；聊天窗恒在最后、由引擎自动追加） */
  main: SplitPane[]
  chatWidth: { default: number; min: number; max: number }
  /** 顶部行高度（存在 top 行时生效） */
  topHeight?: { default: number; min: number; max: number }
}

type Geom = { left: number; top: number; right: number; bottom: number }

type SplitState = {
  active: boolean
  spec: LayoutSpec | null
  geom: Geom | null
  chatW: number
  topH: number
  paneWs: number[]
  topWs: number[]
  root: HTMLElement | null
  header: HTMLElement | null
  viewArea: HTMLElement | null
  savedMarginLeft: string
  savedMarginTop: string
  observer: ResizeObserver | null
  fallback: MutationObserver | null
  listeners: Set<() => void>
  open(spec: LayoutSpec): boolean
  close(): void
  syncAnchor(): void
  refreshGeom(): void
  applyMargin(): void
  setChatW(w: number): void
  setTopH(h: number): void
  setPaneW(i: number, w: number): void
  setTopW(i: number, w: number): void
  persist(): void
  subscribe(fn: () => void): () => void
  notify(): void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const DIVIDER = 6
const BAR_H = 26
const PERSIST_KEY = 'dsh.worktable.split.v1'

/** 找到会话根容器：data-phase 元素中排除输入框、取含子元素者；优先 phase=active；无活动会话返回 null */
function findConversationRoot(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-phase]'))
  const ok = (el: HTMLElement) => el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT' && el.children.length >= 2
  return candidates.find((el) => ok(el) && el.dataset.phase === 'active')
    ?? candidates.find(ok)
    ?? null
}

function loadSaved(layoutId: string): { chatW: number; topH: number; paneWs: number[]; topWs: number[] } | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)?.[layoutId]
    if (!s || typeof s !== 'object') return null
    return {
      chatW: Number.isFinite(s.chatW) ? s.chatW : -1,
      topH: Number.isFinite(s.topH) ? s.topH : -1,
      paneWs: Array.isArray(s.paneWs) ? s.paneWs : [],
      topWs: Array.isArray(s.topWs) ? s.topWs : [],
    }
  } catch {
    return null
  }
}

function persistSaved(layoutId: string, s: { chatW: number; topH: number; paneWs: number[]; topWs: number[] }) {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    const all = raw ? JSON.parse(raw) : {}
    all[layoutId] = s
    localStorage.setItem(PERSIST_KEY, JSON.stringify(all))
  } catch {}
}

export const splitStore: SplitState = {
  active: false,
  spec: null,
  geom: null,
  chatW: 320,
  topH: 200,
  paneWs: [],
  topWs: [],
  root: null,
  header: null,
  viewArea: null,
  savedMarginLeft: '',
  savedMarginTop: '',
  observer: null,
  fallback: null,
  listeners: new Set(),

  open(spec) {
    if (this.active) this.close()
    const root = findConversationRoot()
    if (!root || root.dataset.phase !== 'active') return false
    const header = root.children[0] as HTMLElement | undefined
    const viewArea = root.children[1] as HTMLElement | undefined
    if (!header || !viewArea) return false
    this.spec = spec
    const main = spec.main ?? []
    const top = spec.top ?? []
    const saved = loadSaved(spec.id)
    this.chatW = saved && saved.chatW >= 0 ? saved.chatW : spec.chatWidth.default
    this.topH = saved && saved.topH >= 0 ? saved.topH : (spec.topHeight?.default ?? 200)
    this.paneWs = saved && saved.paneWs.length === main.length ? [...saved.paneWs] : main.map((p) => p.min)
    this.topWs = saved && saved.topWs.length === top.length ? [...saved.topWs] : top.map((p) => p.min)
    this.root = root
    this.header = header
    this.viewArea = viewArea
    this.savedMarginLeft = viewArea.style.marginLeft
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
      this.viewArea.style.marginTop = this.savedMarginTop
    }
    this.root = next
    this.header = header
    this.viewArea = viewArea
    this.savedMarginLeft = viewArea.style.marginLeft
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
    const hasTop = !!(spec.top && spec.top.length > 0)
    const chatW = clamp(this.chatW, spec.chatWidth.min, Math.max(spec.chatWidth.min, colW - 60))
    const topH = hasTop
      ? clamp(this.topH, spec.topHeight?.min ?? 80, Math.max(spec.topHeight?.min ?? 80, rowH - BAR_H - 80))
      : 0
    viewArea.style.marginLeft = Math.max(0, colW - chatW) + 'px'
    viewArea.style.marginTop = (BAR_H + topH) + 'px'
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

  persist() {
    if (!this.spec) return
    persistSaved(this.spec.id, { chatW: this.chatW, topH: this.topH, paneWs: this.paneWs, topWs: this.topWs })
  },

  close() {
    if (this.viewArea) {
      this.viewArea.style.marginLeft = this.savedMarginLeft
      this.viewArea.style.marginTop = this.savedMarginTop
    }
    this.observer?.disconnect()
    this.observer = null
    this.fallback?.disconnect()
    this.fallback = null
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
function makeDividerHandler(kind: 'chat' | 'top' | 'pane' | 'topPane', index?: number) {
  return (e: any) => {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    try { target.setPointerCapture(e.pointerId) } catch {}
    const onMove = (ev: PointerEvent) => {
      const g = splitStore.geom
      if (!g) return
      if (kind === 'chat') {
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
  const hasTop = top.length > 0
  const colW = g.right - g.left
  const rowH = g.bottom - g.top
  const chatW = clamp(snap.chatW, spec.chatWidth.min, Math.max(spec.chatWidth.min, colW - 60))
  const topH = hasTop
    ? clamp(snap.topH, spec.topHeight?.min ?? 80, Math.max(spec.topHeight?.min ?? 80, rowH - BAR_H - 80))
    : 0
  const contentW = Math.max(0, colW - chatW)

  const topItems = allocate(top, snap.topWs, colW)
  const mainItems = allocate(main, snap.paneWs, contentW)

  const barTop = g.top
  const bodyTop = barTop + BAR_H + topH
  const paneBottom = g.bottom
  const mainH = paneBottom - bodyTop
  const topY = barTop + BAR_H

  return (
    <>
      {/* 标题栏 */}
      <div className="dsh-wt_splitBar" style={{ position: 'fixed', left: g.left, top: barTop, width: hasTop ? colW : contentW, zIndex: 70 }}>
        <span className="dsh-wt_splitTitle">{spec.title}</span>
        <button type="button" className="dsh-wt_splitClose" aria-label="退出分栏（Esc）" onClick={() => splitStore.close()}>✕</button>
      </div>
      {/* 顶部通栏行 */}
      {hasTop && topItems.map((it) => (
        <div key={it.pane.id} className="dsh-wt_pane" style={{ position: 'fixed', left: g.left + it.left, top: topY, width: it.width, height: topH, zIndex: 68 }}>
          <div className="dsh-wt_paneBar"><span className="dsh-wt_paneTitle">{it.pane.title}</span></div>
          <iframe className="dsh-wt_paneFrame" src={it.pane.content.url} title={it.pane.title} />
        </div>
      ))}
      {/* 主行内容窗 */}
      {mainItems.map((it) => (
        <div key={it.pane.id} className="dsh-wt_pane" style={{ position: 'fixed', left: g.left + it.left, top: bodyTop, width: it.width, height: mainH, zIndex: 68 }}>
          <div className="dsh-wt_paneBar"><span className="dsh-wt_paneTitle">{it.pane.title}</span></div>
          <iframe className="dsh-wt_paneFrame" src={it.pane.content.url} title={it.pane.title} />
        </div>
      ))}
      {/* 顶部/主行水平分隔线 */}
      {hasTop && (
        <div
          className="dsh-wt_splitDivider dsh-wt_splitDividerH"
          role="separator"
          title="拖动调整上下分区"
          style={{ position: 'fixed', left: g.left, top: bodyTop - DIVIDER / 2, width: colW, height: DIVIDER, zIndex: 72 }}
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
          style={{ position: 'fixed', left: g.left + it.left + it.width + DIVIDER / 2, top: topY, width: DIVIDER, height: topH, zIndex: 72 }}
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
          style={{ position: 'fixed', left: g.left + it.left + it.width + DIVIDER / 2, top: bodyTop, width: DIVIDER, height: mainH, zIndex: 72 }}
          onPointerDown={makeDividerHandler('pane', i)}
        />
      ))}
      {/* 聊天分隔线（主行内容与聊天窗之间） */}
      <div
        className="dsh-wt_splitDivider"
        role="separator"
        title="拖动调整聊天宽度"
        style={{ position: 'fixed', left: g.right - chatW - DIVIDER / 2, top: bodyTop, width: DIVIDER, height: mainH, zIndex: 72 }}
        onPointerDown={makeDividerHandler('chat')}
      />
    </>
  )
}

export { SplitWorkspace }
