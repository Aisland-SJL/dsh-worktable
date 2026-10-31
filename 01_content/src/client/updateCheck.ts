/** 更新检查核心（控制室公告页使用；设置面板保留自身实现，后续版本统一去重）。键与设置面板共用。 */
declare const __WT_VERSION__: string
export const LOCAL_VERSION = typeof __WT_VERSION__ === 'undefined' ? 'dev' : __WT_VERSION__
const UPDATE_REPO = 'Aisland-SJL/dsh-worktable'

export type UpdateStatus = 'idle' | 'checking' | 'uptodate' | 'failed'
export type UpdateInfo = { latest: string; notes: string; url: string }

const K_UPDATE_CHECK = 'dsh.worktable.updateCheck.v1'
const K_LAST_CHECK = 'dsh.worktable.lastUpdateCheck.v1'
const K_SKIP = 'dsh.worktable.skipVersion.v1'
const K_CACHE = 'dsh.worktable.updateCache.v1'

/** Strict version precedence; invalid input is incomparable, never a potential update. */
function versionParts(value: string): { core: string[]; pre: string[] } | null {
  if (typeof value !== 'string') return null
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value.trim())
  if (!match) return null
  const pre = match[4]?.split('.') ?? []
  if (pre.some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return null
  return { core: match.slice(1, 4), pre }
}
function numericOrder(a: string, b: string): number {
  if (a.length !== b.length) return a.length > b.length ? 1 : -1
  return a === b ? 0 : a > b ? 1 : -1
}
export function cmpVer(a: string, b: string): number | null {
  const pa = versionParts(a), pb = versionParts(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    const order = numericOrder(pa.core[i], pb.core[i])
    if (order !== 0) return order
  }
  if (!pa.pre.length || !pb.pre.length) return pa.pre.length ? -1 : pb.pre.length ? 1 : 0
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i], y = pb.pre[i]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
    if (nx && ny) return numericOrder(x, y)
    if (nx !== ny) return nx ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0 // Build metadata has no effect on version precedence.
}

/** Shared by cache reads and both UIs. Preserve identity to avoid render-effect churn. */
export function newerUpdateInfo(value: unknown): UpdateInfo | null {
  const info = value as UpdateInfo | null
  if (!info || typeof info.latest !== 'string' || typeof info.notes !== 'string' || typeof info.url !== 'string') return null
  if (cmpVer(info.latest, LOCAL_VERSION) !== 1 || cmpVer(info.latest, getSkipVersion()) === 0) return null
  return info
}

export function getSkipVersion(): string {
  try { return localStorage.getItem(K_SKIP) ?? '' } catch { return '' }
}
export function setSkipVersion(v: string) {
  try { localStorage.setItem(K_SKIP, v) } catch {}
}
export function getAutoCheck(): boolean {
  try { return localStorage.getItem(K_UPDATE_CHECK) !== '0' } catch { return true }
}
export function setAutoCheck(on: boolean) {
  try { localStorage.setItem(K_UPDATE_CHECK, on ? '1' : '0') } catch {}
}
export function readCache(): { status: UpdateStatus; info: UpdateInfo | null } {
  try {
    const raw = localStorage.getItem(K_CACHE)
    if (raw) {
      const c = JSON.parse(raw)
      if (c?.status === 'uptodate' || c?.status === 'failed' || c?.status === 'idle') {
        return { status: c.status, info: c.status === 'uptodate' ? newerUpdateInfo(c.info) : null }
      }
    }
  } catch {}
  return { status: 'idle', info: null }
}
export function writeCache(status: UpdateStatus, info: UpdateInfo | null) {
  try { localStorage.setItem(K_CACHE, JSON.stringify({ status, info: status === 'uptodate' ? newerUpdateInfo(info) : null })) } catch {}
}

/** 检查更新：节流一天一次（force 绕过）；8s 超时 × 3 重试；防重入由调用方保证 */
export async function checkUpdate(force = false): Promise<{ status: UpdateStatus; info: UpdateInfo | null }> {
  let last = 0
  try { last = Number(localStorage.getItem(K_LAST_CHECK) ?? '0') } catch {}
  const age = Date.now() - last
  if (!force && Number.isFinite(last) && last > 0 && age >= 0 && age < 24 * 3600 * 1000) return readCache()
  try { localStorage.setItem(K_LAST_CHECK, String(Date.now())) } catch {}
  let d: { tag_name?: string; body?: string; html_url?: string } | null = null
  for (let attempt = 0; attempt < 3 && !d; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const r = await fetch('https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: ctrl.signal })
      if (r.ok) d = (await r.json()) as { tag_name?: string; body?: string; html_url?: string }
      else if (r.status === 403 || r.status === 404) break
    } catch { /* 网络抖动/超时：下一轮重试 */ }
    finally { clearTimeout(timer) }
  }
  if (!d) { writeCache('failed', null); return { status: 'failed', info: null } }
  const tag = typeof d.tag_name === 'string' ? d.tag_name.trim() : ''
  const order = cmpVer(tag, LOCAL_VERSION)
  if (order == null) { writeCache('failed', null); return { status: 'failed', info: null } }
  if (order <= 0) { writeCache('uptodate', null); return { status: 'uptodate', info: null } }
  const info = newerUpdateInfo({ latest: tag.replace(/^v/, ''), notes: typeof d.body === 'string' ? d.body.slice(0, 800) : '', url: typeof d.html_url === 'string' ? d.html_url : '' })
  writeCache('uptodate', info)
  return { status: 'uptodate', info }
}
