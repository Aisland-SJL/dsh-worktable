/**
 * 访问密码（服务端 /api/worktable/* 门禁）的客户端支持。
 *
 * 服务端对全部敏感路由加了访问密码门禁：浏览器侧靠同源会话 Cookie 通过，首次访问（尚未设密码）
 * 时返回 401 + 内置设置页。客户端这里补两件事，避免面板静默变成空列表：
 *   - authFetch()：同源请求包装——收到 401 就弹访问密码浮层，验证成功后自动重试一次；
 *   - ensureAuth()：开终端 WebSocket 前先探一次（握手失败在浏览器侧读不到状态码，只能先探再连）。
 * 浮层挂在 document.body（同侧栏 bindTip 的做法），不依赖任何布局容器，也不进 React 树。
 */

/** 文案提供者（由工作台注入 locale t，同 split 的 setSplitT；未注入时回退键名） */
let uiT: ((key: string) => string) | null = null
export function setAuthT(fn: ((key: string) => string) | null) {
  uiT = fn
}
const T = (key: string): string => (uiT ? uiT(key) : key)

let authEl: HTMLDivElement | null = null
let authWait: Promise<boolean> | null = null
let authDone: ((ok: boolean) => void) | null = null

/** 结算浮层：摘掉 DOM 并兑现等待中的 Promise（并发调用共用一次等待） */
function settleAuth(ok: boolean) {
  const done = authDone
  authDone = null
  authWait = null
  if (authEl) {
    try { authEl.remove() } catch {}
    authEl = null
  }
  if (done) done(ok)
}

/** 提交密码：成功返回空串，失败返回给用户看的错误文案 */
async function submitPin(pin: string): Promise<string> {
  try {
    const res = await fetch('/api/worktable/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin }),
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.ok === true) return ''
    return String(data?.error ?? T('auth.failed'))
  } catch {
    return T('auth.netFail')
  }
}

/** 弹出访问密码浮层；首次（还没设密码）时文案切换成「设置密码」。并发调用共用同一次等待。 */
export function promptAuth(firstTime = false): Promise<boolean> {
  if (authWait) return authWait
  authWait = new Promise<boolean>((resolve) => { authDone = resolve })

  const mask = document.createElement('div')
  mask.className = 'dsh-wt_authMask'
  const box = document.createElement('div')
  box.className = 'dsh-wt_authBox'
  const title = document.createElement('div')
  title.className = 'dsh-wt_authTitle'
  title.textContent = T(firstTime ? 'auth.titleFirst' : 'auth.title')
  const hint = document.createElement('div')
  hint.className = 'dsh-wt_authHint'
  hint.textContent = T(firstTime ? 'auth.hintFirst' : 'auth.hint')
  const input = document.createElement('input')
  input.className = 'dsh-wt_authInput'
  input.type = 'password'
  input.placeholder = T('auth.placeholder')
  const err = document.createElement('div')
  err.className = 'dsh-wt_authErr'
  const row = document.createElement('div')
  row.className = 'dsh-wt_authRow'
  const okBtn = document.createElement('button')
  okBtn.className = 'dsh-wt_authBtn'
  okBtn.type = 'button'
  okBtn.textContent = T(firstTime ? 'auth.submitFirst' : 'auth.submit')
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'dsh-wt_authCancel'
  cancelBtn.type = 'button'
  cancelBtn.textContent = T('auth.cancel')
  row.appendChild(okBtn)
  row.appendChild(cancelBtn)
  box.appendChild(title)
  box.appendChild(hint)
  box.appendChild(input)
  box.appendChild(err)
  box.appendChild(row)
  mask.appendChild(box)

  let busy = false
  const submit = async () => {
    const pin = input.value
    if (busy || !pin) { if (!pin) err.textContent = T('auth.failed'); return }
    busy = true
    okBtn.disabled = true
    err.textContent = ''
    const fail = await submitPin(pin)
    busy = false
    okBtn.disabled = false
    if (fail) {
      err.textContent = fail
      input.select()
      return
    }
    settleAuth(true)
  }
  okBtn.addEventListener('click', () => { void submit() })
  cancelBtn.addEventListener('click', () => settleAuth(false))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void submit() }
    else if (e.key === 'Escape') { e.preventDefault(); settleAuth(false) }
  })
  // 点蒙层空白 = 取消（点面板内部不关）
  mask.addEventListener('pointerdown', (e) => { if (e.target === mask) settleAuth(false) })

  authEl = mask
  document.body.appendChild(mask)
  try { input.focus() } catch {}
  return authWait
}

/** 同源请求包装：401 时弹浮层 → 验证成功后重试一次（其余状态原样返回，行为与 fetch 一致） */
export async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status !== 401) return res
  const ok = await promptAuth(res.headers.get('x-wt-first') === '1')
  if (!ok) return res
  return fetch(input, init)
}

/** 开终端 WebSocket 前探一次门禁（旧版服务端没有该路由时按放行处理） */
export async function ensureAuth(): Promise<boolean> {
  try {
    const res = await fetch('/api/worktable/auth', { cache: 'no-store' })
    if (res.ok || res.status !== 401) return true
    return await promptAuth(res.headers.get('x-wt-first') === '1')
  } catch {
    return true
  }
}
