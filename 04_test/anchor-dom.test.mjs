/**
 * 分栏引擎 DOM 锚点回归测试（P2：DSH 0.1.1-rc.2 与 0.1.2-rc.1 双版本会话根结构）。
 * 用法：node anchor-dom.test.mjs（纯 node，无外部依赖；评估真实构建产物 lib/client.js）。
 * 覆盖：
 *   A. 0.1.1 active（2 子元素 + 可见头部）→ 顶部 = 头部底边
 *   B. 0.1.1/0.1.2 blank hero（2 子元素 + 隐藏头部）→ 头部忽略、顶部 = 根顶
 *   C. 0.1.2 无会话 hero（1 子元素）→ 无头部、viewArea = 唯一子元素
 *   D. hero→active 过渡（同根插入可见头部）→ 重锚定且关闭还原干净（不泄漏已应用值）
 *   E. 关闭还原：margin 清空、--dsh-chat-user-width 移除
 *   F. 输入包装器（uV2eYG_input / textarea）不被误选为会话根
 *   G. settling 过渡态：不关闭、等待
 */
import { readFileSync } from 'node:fs'
import { createContext, runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

// bundle 路径参数化：发布脚本传入「已安装包内」的 lib/client.js（验收最终产物）；
// 缺省回退到工作目录构建产物（本地开发跑）。
const BUNDLE = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '01_content', 'lib', 'client.js'))
const source = readFileSync(BUNDLE, 'utf8')

// —— 假 DOM ——
// 模拟浏览器 CSSStyleDeclaration：未设置的属性读作 ''（插件保存/还原依赖该语义）
class StyleProxy {
  constructor() {
    return new Proxy(this, {
      get(t, k) {
        if (k === Symbol.toPrimitive) return () => 'style'
        return k in t ? t[k] : ''
      },
    })
  }
  getPropertyValue(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : '' }
  setProperty(k, v) { this[k] = v }
  removeProperty(k) { delete this[k] }
}
// 万能桩：任何未实现的 DOM API（getContext 等）返回自身同型桩
const universalStub = new Proxy(function () { return universalStub }, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 'stub' : universalStub),
  apply: () => universalStub,
  construct: () => universalStub,
})
class FakeEl {
  constructor(tag = 'DIV', cls = '', attrs = {}) {
    this.tagName = tag
    this.className = cls
    this.dataset = {}
    for (const [k, v] of Object.entries(attrs)) this.dataset[k] = v
    this.children = []
    this.parentElement = null
    this.style = new StyleProxy()
    this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    this._connected = true
    return new Proxy(this, {
      get(t, k) {
        if (k in t) return t[k]
        if (k === Symbol.toPrimitive) return () => 'stub'
        return universalStub
      },
    })
  }
  get isConnected() { return this._connected }
  getBoundingClientRect() { return { ...this._rect } }
  setRect(o) {
    Object.assign(this._rect, o)
    this._rect.width = this._rect.right - this._rect.left
    this._rect.height = this._rect.bottom - this._rect.top
    return this
  }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c }
  insertBefore(c) { c.parentElement = this; this.children.unshift(c); return c }
  removeChild(c) { c.parentElement = null; this.children = this.children.filter((x) => x !== c); return c }
  _walk(out) { for (const c of this.children) { out.push(c); c._walk(out) } return out }
  querySelectorAll() { return this._walk([]) }
  querySelector() { return null }
  closest() { return null }
  addEventListener() {}
  removeEventListener() {}
  setAttribute(k, v) { this.dataset[k] = v }
  getAttribute(k) { return this.dataset[k] }
  removeAttribute(k) { delete this.dataset[k] }
}

let pass = 0
const fail = (name, detail) => { console.error('FAIL(' + name + '): ' + detail); process.exit(1) }
const ok = (name) => { console.log('ok   ' + name); pass++ }

function matches(el, sel) {
  if (sel === '[data-phase]') return el.dataset && el.dataset.phase != null
  if (sel.startsWith('.')) {
    const cls = String(el.className || '').split(/\s+/)
    return cls.includes(sel.slice(1))
  }
  return false
}

function buildSandbox() {
  const allEls = []
  const moInstances = []
  class MOCtor {
    constructor(cb) { this.cb = cb; moInstances.push(this) }
    observe(target) { this._target = target }
    disconnect() {}
  }
  class ROCtor {
    constructor(cb) { this.cb = cb }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const localStorageStub = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  const documentStub = {
    body: new FakeEl('BODY'),
    documentElement: new FakeEl('HTML'),
    querySelector: (sel) => allEls.find((e) => matches(e, sel)) || null,
    querySelectorAll: (sel) => allEls.filter((e) => matches(e, sel)),
    createElement: (tag) => new FakeEl(String(tag).toUpperCase()),
    addEventListener() {},
    removeEventListener() {},
  }
  const sandbox = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    localStorage: localStorageStub,
    document: documentStub,
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    Blob: function Blob() {},
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    MutationObserver: MOCtor,
    ResizeObserver: ROCtor,
    IntersectionObserver: function () { return { observe() {}, unobserve() {}, disconnect() {} } },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail } },
    requestAnimationFrame: (cb) => 0,
    cancelAnimationFrame: () => {},
    navigator: { userAgent: 'test', platform: 'Win32', language: 'zh-CN' },
    fetch: () => Promise.reject(new Error('fetch unavailable')),
    indexedDB: undefined,
  }
  sandbox.window.__ModuleLoader__ = { load: (reg) => { sandbox.__captured = reg } }
  sandbox.window.addEventListener = () => {}
  sandbox.window.removeEventListener = () => {}
  sandbox.window.dispatchEvent = () => {}
  sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  sandbox.window.localStorage = localStorageStub
  sandbox.window.document = documentStub
  sandbox.self = sandbox.window
  createContext(sandbox)
  runInNewContext(source, sandbox, { filename: 'client.js', timeout: 20000 })
  if (!sandbox.__captured || typeof sandbox.__captured.factory !== 'function') fail('load', 'factory not captured')
  const makeStub = () => {
    const stub = function () { return makeStub() }
    return new Proxy(stub, {
      get: (_t, k) => (k === Symbol.toPrimitive ? () => 'stub' : makeStub()),
      apply: () => makeStub(),
      construct: () => makeStub(),
    })
  }
  const requireStub = (id) => {
    if (id === 'react' || id === 'react/jsx-runtime') return makeStub()
    throw new Error('unexpected external require: ' + id)
  }
  const runSandbox = { __factory: sandbox.__captured.factory, __requireStub: requireStub }
  createContext(runSandbox)
  runInNewContext('__factory(__requireStub)', runSandbox, { timeout: 20000 })
  const splitStore = sandbox.window.__dshWorktable && sandbox.window.__dshWorktable.splitStore
  if (!splitStore) fail('load', 'window.__dshWorktable.splitStore not exported')
  return { sandbox, splitStore, allEls, moInstances }
}

function makeSpec(id) {
  return { id, title: id, top: null, main: [{ id: 'p1', title: 'p1', min: 200, content: null }], chatWidth: { default: 320, min: 240, max: 600 } }
}

// 每个场景独立 sandbox（避免模块级 taObserver 等状态串扰）
function fresh() {
  const b = buildSandbox()
  return b
}

// —— A. 0.1.1 active：2 子元素 + 可见头部 ——
{
  const { sandbox, splitStore, allEls } = fresh()
  const root = new FakeEl('DIV', 'wSkVaW_root', { phase: 'active' }).setRect({ left: 200, top: 100, right: 1200, bottom: 800 })
  const header = new FakeEl('HEADER', 'wSkVaW_header').setRect({ left: 200, top: 100, right: 1200, bottom: 148 })
  const scroll = new FakeEl('DIV', 'wSkVaW_scrollBody').setRect({ left: 200, top: 148, right: 1200, bottom: 800 })
  root.appendChild(header); root.appendChild(scroll)
  allEls.push(root); sandbox.document.body.appendChild(root)
  const r = splitStore.open(makeSpec('t-a'))
  if (r !== true) fail('A.open', 'open() !== true')
  if (splitStore.header !== header) fail('A.header', 'header not anchored')
  if (splitStore.viewArea !== scroll) fail('A.viewArea', 'viewArea not children[1]')
  if (splitStore.geom.top !== 148) fail('A.geom', 'top=' + splitStore.geom.top + ' != 148')
  if (scroll.style.marginTop !== '26px') fail('A.marginTop', JSON.stringify(scroll.style.marginTop))
  if (root.style.getPropertyValue('--dsh-chat-user-width') === '') fail('A.widthVar', 'width var not pinned')
  splitStore.close()
  if (scroll.style.marginLeft !== '' || scroll.style.marginTop !== '') fail('A.close', 'margins not restored: ' + JSON.stringify(scroll.style))
  if (root.style.getPropertyValue('--dsh-chat-user-width') !== '') fail('A.closeVar', 'width var not removed')
  ok('A. 0.1.1 active（可见头部）锚定 + 关闭还原')
}

// —— B. 0.1.1/0.1.2 blank hero：2 子元素 + 隐藏头部 ——
{
  const { sandbox, splitStore, allEls } = fresh()
  const root = new FakeEl('DIV', 'wSkVaW_root', { phase: 'hero' }).setRect({ left: 200, top: 100, right: 1200, bottom: 800 })
  const header = new FakeEl('HEADER', 'wSkVaW_header wSkVaW_headerHidden').setRect({ left: 200, top: 100, right: 1200, bottom: 100 })
  const body = new FakeEl('DIV', 'wSkVaW_body').setRect({ left: 200, top: 100, right: 1200, bottom: 800 })
  root.appendChild(header); root.appendChild(body)
  allEls.push(root); sandbox.document.body.appendChild(root)
  const r = splitStore.open(makeSpec('t-b'))
  if (r !== true) fail('B.open', 'open() !== true')
  if (splitStore.header !== null) fail('B.header', 'hidden header should be null')
  if (splitStore.viewArea !== body) fail('B.viewArea', 'viewArea not body')
  if (splitStore.geom.top !== 100) fail('B.geom', 'top=' + splitStore.geom.top + ' != 100 (root top)')
  splitStore.close()
  ok('B. blank hero（隐藏头部）锚定')
}

// —— C. 0.1.2 无会话 hero：1 子元素 ——
{
  const { sandbox, splitStore, allEls } = fresh()
  const root = new FakeEl('DIV', 'wSkVaW_root', { phase: 'hero' }).setRect({ left: 280, top: 0, right: 1258, bottom: 761 })
  const body = new FakeEl('DIV', 'wSkVaW_body').setRect({ left: 280, top: 0, right: 1258, bottom: 761 })
  root.appendChild(body)
  allEls.push(root); sandbox.document.body.appendChild(root)
  const r = splitStore.open(makeSpec('t-c'))
  if (r !== true) fail('C.open', 'open() !== true')
  if (splitStore.header !== null) fail('C.header', 'header should be null')
  if (splitStore.viewArea !== body) fail('C.viewArea', 'viewArea not only-child')
  if (splitStore.geom.top !== 0) fail('C.geom', 'top=' + splitStore.geom.top + ' != 0')
  splitStore.close()
  ok('C. 0.1.2 无会话 hero（单子元素）锚定')
}

// —— D. hero→active 同根过渡：头部出现 → 重锚定；关闭还原干净 ——
{
  const { sandbox, splitStore, allEls, moInstances } = fresh()
  const root = new FakeEl('DIV', 'wSkVaW_root', { phase: 'hero' }).setRect({ left: 280, top: 0, right: 1258, bottom: 761 })
  const body = new FakeEl('DIV', 'wSkVaW_body').setRect({ left: 280, top: 0, right: 1258, bottom: 761 })
  root.appendChild(body)
  allEls.push(root); sandbox.document.body.appendChild(root)
  splitStore.open(makeSpec('t-d'))
  const mlBefore = body.style.marginLeft
  const bodyFallbackObs = moInstances.filter((m) => m._targeted === undefined)[moInstances.length - 1]
  // 模拟 hero→active：头部插入 + phase 翻转
  const header = new FakeEl('HEADER', 'wSkVaW_header').setRect({ left: 280, top: 0, right: 1258, bottom: 48 })
  root.insertBefore(header)
  root.dataset.phase = 'active'
  // 触发 body 级 fallback MutationObserver（按 observe 目标识别；取最后一个 = open() 里建的 fallback，跳过模块级 taObserver）
  const bodyMOs = moInstances.filter((m) => m._target === sandbox.document.body)
  const fallbackMO = bodyMOs[bodyMOs.length - 1]
  if (!fallbackMO || typeof fallbackMO.cb !== 'function') fail('D.mo', 'fallback MO not captured')
  fallbackMO.cb()
  if (splitStore.header !== header) fail('D.header', 're-anchor did not pick visible header')
  if (splitStore.viewArea !== body) fail('D.viewArea', 're-anchor lost body')
  if (splitStore.geom.top !== 48) fail('D.geom', 'top=' + splitStore.geom.top + ' != 48')
  if (body.style.marginLeft === '') fail('D.margin', 'margin not re-applied after transition')
  // 关闭：margin 与宽度变量必须回到「打开前」原值（空），不得泄漏已应用值
  splitStore.close()
  if (body.style.marginLeft !== '') fail('D.closeMargin', 'leaked margin: ' + JSON.stringify(body.style.marginLeft))
  if (body.style.marginTop !== '') fail('D.closeMarginTop', 'leaked marginTop: ' + JSON.stringify(body.style.marginTop))
  if (root.style.getPropertyValue('--dsh-chat-user-width') !== '') fail('D.closeVar', 'leaked width var: ' + root.style.getPropertyValue('--dsh-chat-user-width'))
  ok('D. hero→active 过渡重锚定 + 关闭零泄漏')
}

// —— E. 无会话根：findConversationRoot 返回 null → open 返回 false（安全失败）——
{
  const { sandbox, splitStore } = fresh()
  const r = splitStore.open(makeSpec('t-e'))
  if (r !== false) fail('E.open', 'should fail without conversation root')
  ok('E. 无会话根时安全失败（不崩溃）')
}

// —— F. 输入包装器 / textarea 不被误选 ——
{
  const { sandbox, splitStore, allEls } = fresh()
  const root = new FakeEl('DIV', 'wSkVaW_root', { phase: 'hero' }).setRect({ left: 280, top: 0, right: 1258, bottom: 761 })
  const body = new FakeEl('DIV', 'wSkVaW_body').setRect({ left: 280, top: 0, right: 1258, bottom: 761 })
  const inputWrap = new FakeEl('DIV', 'uV2eYG_input', { phase: 'plain' })
  const p = new FakeEl('P')
  inputWrap.appendChild(p)
  const ta = new FakeEl('TEXTAREA', '', { phase: 'inert' })
  root.appendChild(body); body.appendChild(inputWrap); body.appendChild(ta)
  allEls.push(root, inputWrap, ta); sandbox.document.body.appendChild(root)
  const r = splitStore.open(makeSpec('t-f'))
  if (r !== true) fail('F.open', 'open failed')
  if (splitStore.root !== root) fail('F.root', 'wrong root chosen')
  splitStore.close()
  ok('F. 输入包装器/textarea 不被误选为会话根')
}

// —— H. 0.1.2 active：零高槽位包装 + 内部真实头部（实测结构） ——
{
  const { sandbox, splitStore, allEls } = fresh()
  const root = new FakeEl('DIV', 'wSkVaW_root', { phase: 'active' }).setRect({ left: 280, top: 0, right: 1258, bottom: 761 })
  const wrap = new FakeEl('DIV', '').setRect({ left: 280, top: 0, right: 1258, bottom: 0 }) // display:contents 式零高包装
  const header = new FakeEl('HEADER', 'wSkVaW_header').setRect({ left: 280, top: 0, right: 1258, bottom: 75.67 })
  const body = new FakeEl('DIV', 'wSkVaW_body').setRect({ left: 280, top: 75.67, right: 1258, bottom: 761 })
  wrap.appendChild(header)
  root.appendChild(wrap); root.appendChild(body)
  allEls.push(root); sandbox.document.body.appendChild(root)
  const r = splitStore.open(makeSpec('t-h'))
  if (r !== true) fail('H.open', 'open() !== true')
  if (splitStore.header !== header) fail('H.header', 'should anchor to inner header, got ' + (splitStore.header && splitStore.header.tagName))
  if (splitStore.viewArea !== body) fail('H.viewArea', 'viewArea not body')
  if (splitStore.geom.top !== 75.67) fail('H.geom', 'top=' + splitStore.geom.top + ' != 75.67')
  splitStore.close()
  ok('H. 0.1.2 active（零高包装+内部头部）锚定到真实头部')
}

// —— G. settling 过渡态：syncAnchor 等待（不关闭）——
{
  const { sandbox, splitStore, allEls, moInstances } = fresh()
  const root = new FakeEl('DIV', 'wSkVaW_root', { phase: 'hero' }).setRect({ left: 280, top: 0, right: 1258, bottom: 761 })
  const body = new FakeEl('DIV', 'wSkVaW_body').setRect({ left: 280, top: 0, right: 1258, bottom: 761 })
  root.appendChild(body)
  allEls.push(root); sandbox.document.body.appendChild(root)
  splitStore.open(makeSpec('t-g'))
  root.dataset.phase = 'settling'
  const bodyMOs = moInstances.filter((m) => m._target === sandbox.document.body)
  const fallbackMO = bodyMOs[bodyMOs.length - 1]
  fallbackMO.cb()
  if (!splitStore.active) fail('G.close', 'settling should not close')
  ok('G. settling 过渡态保持等待')
}

console.log('all anchor-dom tests passed: ' + pass + '/' + pass)
