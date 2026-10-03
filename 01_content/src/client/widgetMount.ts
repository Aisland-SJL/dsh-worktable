import { joinPath } from './pathutil'

/** Browser-local ownership of auto-mounted results. Folders never identify projects. */
export const WIDGET_BINDINGS_KEY = 'dsh.worktable.widgetBindings.v2'
export type WidgetSpec = { id: string; left?: any; top?: any[] | null; main: any[] }
export type WidgetBinding = {
  projectId: string
  paneId: string
  window: string
  bindingId: string
  sessionId: string
  folder: string
  enabled: boolean
}
export type WidgetTarget = { row: 'left' | 'top' | 'main'; index: number; pane: any; window: string }
type Store = Pick<Storage, 'getItem' | 'setItem'>

export function newWidgetId(prefix = 'binding'): string {
  const id = globalThis.crypto?.randomUUID?.() ?? (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2))
  return prefix + '-' + id
}

export function widgetTargets(spec: WidgetSpec | null | undefined): WidgetTarget[] {
  if (!spec) return []
  const out: WidgetTarget[] = []
  const add = (row: WidgetTarget['row'], panes: any[]) => panes.forEach((pane, index) => {
    if (pane && typeof pane.id === 'string') out.push({ row, index, pane, window: '窗口' + (out.length + 1) })
  })
  add('left', spec.left ? [spec.left] : [])
  add('top', spec.top ?? [])
  add('main', spec.main ?? [])
  return out
}

export function widgetManifestPath(binding: WidgetBinding): string {
  // Binding-specific files also keep late writers from overwriting a newer binding's result.
  return joinPath(binding.folder, joinPath('.dsh-worktable', joinPath(
    'project-' + encodeURIComponent(binding.projectId),
    'pane-' + encodeURIComponent(binding.paneId) + '-' + binding.bindingId + '.json',
  )))
}

export class WidgetMountRegistry {
  private records: Record<string, Record<string, WidgetBinding>> = Object.create(null)
  private listeners = new Set<() => void>()
  constructor(private storage: Store | null, private makeId = () => newWidgetId()) {
    try {
      const data = JSON.parse(storage?.getItem(WIDGET_BINDINGS_KEY) ?? '{}')
      for (const [projectId, panes] of Object.entries(data ?? {})) {
        if (!panes || typeof panes !== 'object' || Array.isArray(panes)) continue
        const valid: Record<string, WidgetBinding> = Object.create(null)
        for (const [paneId, b] of Object.entries(panes)) {
          const v = b as WidgetBinding
          if (v?.projectId !== projectId || v.paneId !== paneId || typeof v.folder !== 'string' || !v.folder ||
              typeof v.sessionId !== 'string' || !v.sessionId || typeof v.window !== 'string' ||
              typeof v.bindingId !== 'string' || !/^[a-z0-9-]+$/i.test(v.bindingId) || typeof v.enabled !== 'boolean') continue
          valid[paneId] = { ...v }
        }
        if (Object.keys(valid).length) this.records[projectId] = valid
      }
    } catch { /* Invalid registry cannot authorize an old manifest. */ }
  }
  private persist() {
    // A send must not proceed with ownership that cannot survive reload.
    this.storage?.setItem(WIDGET_BINDINGS_KEY, JSON.stringify(this.records))
    for (const fn of this.listeners) fn()
  }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  entries(projectId?: string): WidgetBinding[] {
    const projects = projectId ? [this.records[projectId] ?? {}] : Object.values(this.records)
    return projects.flatMap((panes) => Object.values(panes)).filter((b) => b.enabled)
  }
  begin(projectId: string, spec: WidgetSpec, folder: string, sessionId: string, window: string): WidgetBinding[] {
    if (!this.storage) throw new Error('project storage unavailable')
    if (!folder || !sessionId || spec.id !== projectId) throw new Error('project folder or session unavailable')
    const targets = widgetTargets(spec)
    const selected = targets.find((t) => t.window === window)
    if (!selected || new Set(targets.map((t) => t.pane.id)).size !== targets.length) throw new Error('project window changed')
    const before = this.records[projectId]
    const next: Record<string, WidgetBinding> = Object.create(null)
    for (const t of targets) {
      const old = before?.[t.pane.id]
      // Unassigned windows can participate in one multi-window result. A manually revoked
      // window stays revoked until explicitly selected for another custom task.
      next[t.pane.id] = t === selected || !old || old.folder !== folder || (old.enabled && old.window !== t.window)
        ? { projectId, paneId: t.pane.id, window: t.window, folder, sessionId, bindingId: this.makeId(), enabled: true }
        : old
    }
    this.records[projectId] = next
    try { this.persist() } catch (error) { if (before) this.records[projectId] = before; else delete this.records[projectId]; throw error }
    return this.entries(projectId).filter((b) => b.sessionId === sessionId)
  }
  revokePane(projectId: string, paneId: string) {
    const b = this.records[projectId]?.[paneId]
    if (!b || !b.enabled) return
    this.records[projectId] = { ...this.records[projectId], [paneId]: { ...b, enabled: false } }
    try { this.persist() } catch { /* Revocation takes effect in memory even if storage is full. */ }
  }
  revokeProject(projectId: string) {
    if (!this.records[projectId]) return
    for (const b of this.entries(projectId)) this.revokePane(projectId, b.paneId)
  }
  isCurrent(binding: WidgetBinding, spec: WidgetSpec | null | undefined, folder: string | undefined): boolean {
    const current = this.records[binding.projectId]?.[binding.paneId]
    return !!current?.enabled && current.bindingId === binding.bindingId && current.sessionId === binding.sessionId &&
      current.folder === folder && binding.folder === folder && spec?.id === binding.projectId &&
      widgetTargets(spec).filter((t) => t.pane.id === binding.paneId).length === 1
  }
  resolve(binding: WidgetBinding, raw: string, spec: WidgetSpec | null | undefined, folder: string | undefined):
    { target: WidgetTarget; item: { kind: 'html' | 'url' | 'file'; path: string } } | null {
    if (!this.isCurrent(binding, spec, folder)) return null
    try {
      const d = JSON.parse(raw)
      if (!d || Array.isArray(d) || d.version !== 2 || d.projectId !== binding.projectId ||
          d.paneId !== binding.paneId || d.bindingId !== binding.bindingId || d.window !== binding.window ||
          !['html', 'url', 'file'].includes(d.kind) || typeof d.path !== 'string' || !d.path.trim()) return null
      const target = widgetTargets(spec).find((t) => t.pane.id === binding.paneId)!
      return { target, item: { kind: d.kind, path: d.path.trim() } }
    } catch { return null }
  }
}
