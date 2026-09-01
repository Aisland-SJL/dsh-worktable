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

export function cmpVer(a: string, b: string): number {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0)
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
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
      if (c && typeof c.status === 'string') {
        return { status: c.status === 'checking' ? 'idle' : c.status, info: c.info ?? null }
      }
    }
  } catch {}
  return { status: 'idle', info: null }
}
export function writeCache(status: UpdateStatus, info: UpdateInfo | null) {
  try { localStorage.setItem(K_CACHE, JSON.stringify({ status, info })) } catch {}
}

/** 检查更新：节流一天一次（force 绕过）；8s 超时 × 3 重试；防重入由调用方保证 */
export async function checkUpdate(force = false): Promise<{ status: UpdateStatus; info: UpdateInfo | null }> {
  const last = Number(localStorage.getItem(K_LAST_CHECK) ?? '0')
  if (!force && Date.now() - last < 24 * 3600 * 1000) return readCache()
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
  const tag = (d.tag_name ?? '').replace(/^v/, '')
  if (!tag || cmpVer(tag, LOCAL_VERSION) <= 0) { writeCache('uptodate', null); return { status: 'uptodate', info: null } }
  if (getSkipVersion() === tag) { writeCache('uptodate', null); return { status: 'uptodate', info: null } }
  const info: UpdateInfo = { latest: tag, notes: (d.body ?? '').slice(0, 800), url: d.html_url ?? '' }
  writeCache('uptodate', info)
  return { status: 'uptodate', info }
}
