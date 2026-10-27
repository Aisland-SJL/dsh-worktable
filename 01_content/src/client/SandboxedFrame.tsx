import { useEffect, useState } from 'react'
import { hostPreviewUrl } from './hostTransport'

const SANDBOX = 'allow-scripts allow-forms allow-downloads'
const SITE = '/api/worktable/site/'

/** Accept navigations, not executable URL schemes. Keep saved URLs free of capabilities. */
export function previewTarget(input: string, base: string) {
  const url = new URL(input, base)
  const own = new URL(base)
  const sameHost = url.protocol === own.protocol && url.host === own.host
  if (!['http:', 'https:'].includes(url.protocol) && !(sameHost && url.protocol === 'dsh-app:')) throw new Error('Unsupported preview URL')
  if (!sameHost || !url.pathname.startsWith(SITE)) return { url: url.href }
  const segments = url.pathname.slice(SITE.length).split('/')
  const root = decodeURIComponent(segments.shift() ?? '')
  if (!root) throw new Error('Missing preview directory')
  const relative = segments.map(decodeURIComponent)
  if (relative.some(s => s === '..' || /[\\/\0]/.test(s))) throw new Error('Invalid preview path')
  return { root, relative: relative.map(encodeURIComponent).join('/'), suffix: url.search + url.hash }
}

/** Untrusted project pages never share the host's document origin or storage. */
export function SandboxedFrame(props: { url: string; title?: string; reloadKey: number }) {
  const [src, setSrc] = useState('about:blank')
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    let token: string | undefined
    const revoke = (value: string) => { void fetch('/api/worktable/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revoke: value }), keepalive: true,
    }).catch(() => {}) }
    setSrc('about:blank')
    setError('')
    void (async () => {
      if (!props.url || props.url === 'about:blank') return
      const target = previewTarget(props.url, location.href)
      if ('url' in target) { if (alive) setSrc(target.url!); return }
      const response = await fetch('/api/worktable/preview', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: target.root }),
      })
      if (!response.ok) throw new Error('Preview HTTP ' + response.status)
      const grant = await response.json()
      if (typeof grant.token !== 'string' || !/^[\w-]{32}$/.test(grant.token) || grant.base !== '/api/worktable/preview-static/' + grant.token + '/') throw new Error('Invalid preview grant')
      token = grant.token
      if (!alive) { revoke(token!); token = undefined; return }
      setSrc(hostPreviewUrl(grant.base + target.relative + target.suffix))
    })().catch(err => {
      if (token) { revoke(token); token = undefined }
      if (alive) setError(String(err))
    })
    return () => { alive = false; if (token) revoke(token) }
  }, [props.url, props.reloadKey])
  if (error) return <div className="dsh-wt_paneWip"><span className="dsh-wt_paneWipText">{error}</span></div>
  return <iframe key={props.reloadKey} className="dsh-wt_paneFrame" src={src}
    data-source-url={props.url} title={props.title ?? ''} sandbox={SANDBOX} referrerPolicy="no-referrer" />
}
