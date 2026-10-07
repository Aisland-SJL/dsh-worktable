/**
 * 分栏引擎 margin 基线回归（Bug 1：拖动分隔线时布局自动关闭 / 调不了聊天列宽）。
 *
 * 症状：打开项目后拖动「聊天宽度 / 左列宽 / 顶行高」分隔线，工作区立刻关闭（Esc 效果）。
 *
 * 根因：applyMargin() 把未归一化的浮点长度写进 style（如 836.666748046875px），
 * 浏览器 CSSOM 读回时序列化到 3 位小数（836.667px）；而 yieldObserver 用
 * `this.lastMargin* === viewArea.style.margin*` 的严格相等来判断「margin 是否被外部改写」，
 * 于是 applyMargin 自己的写入被误判成别的分栏引擎接管 → 立即 close()。
 * 桌面端以 --force-device-scale-factor=1.5 运行，getBoundingClientRect() 常返回分数量，
 * 故在桌面端几乎必现；整数列宽时侥幸不触发。
 *
 * 修复：基线改为取自 CSSOM 读回值（viewArea.style.margin*），即观察器将看到的值；
 * 并让 syncAnchor() 换锚点时同步重绑 yieldObserver（原先只重绑 ResizeObserver，
 * 观察器一直盯着已被恢复的旧元素）。
 *
 * 用法：node split-margin.test.mjs [lib/client.js 路径]
 *       缺省用工作目录构建产物；release-prep 传入「已安装包内」的最终产物。
 *
 * 关键：本测试的假 StyleProxy 必须模拟 CSSOM 的 3 位小数归一化，且 MutationObserver
 * 按真实语义异步派发——旧测试两者都没做，所以一直没抓到这个 bug。
 */
import { readFileSync } from 'node:fs'
import { createContext, runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const BUNDLE = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '01_content', 'lib', 'client.js'))
const source = readFileSync(BUNDLE, 'utf8')

let pass = 0
const fail = (name, detail) => { console.error('FAIL(' + name + '): ' + detail); process.exit(1) }
const ok = (name) => { console.log('ok   ' + name); pass++ }

/** CSSOM 对 <length> 的序列化：小数四舍五入到 3 位并去尾零（-0 归一为 0） */
function serializeCssLength(v) {
  if (typeof v !== 'string') return v
  const m = /^(-?\d*\.?\d+)px$/.exec(v.trim())
  if (!m) return v.trim()
  const n = Math.round(parseFloat(m[1]) * 1000) / 1000
  if (!Number.isFinite(n)) return v
  return (Object.is(n, -0) ? 0 : n) + 'px'
}

const universalStub = new Proxy(function () { return universalStub }, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 'stub' : universalStub),
  apply: () => universalStub, construct: () => universalStub,
})

// —— 观察者注册表：按元素 id 索引，style 写入后异步派发（复刻真实 MutationObserver）——
const observers = new Map()
let oidSeq = 0
const pending = []
let flushScheduled = false
function notifyStyle(raw) {
  if (!raw || !observers.has(raw._oid)) return
  pending.push(raw._oid)
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(() => {
    flushScheduled = false
    for (const oid of new Set(pending.splice(0))) {
      const list = observers.get(oid)
      if (!list) continue
      for (const cb of [...list]) cb([{ type: 'attributes', attributeName: 'style' }], null)
    }
  })
}

/** 假 CSSStyleDeclaration：写入即按 CSSOM 归一化，并触发观察者 */
class StyleProxy {
  constructor(owner) {
    this._s = Object.create(null)
    this._owner = owner
    return new Proxy(this, {
      get(t, k) {
        if (k === '_s') return t._s
        if (k === '_owner') return t._owner
        if (k === 'getPropertyValue') return (p) => (p in t._s ? t._s[p] : '')
        if (k === 'setProperty') return (p, v) => { t._s[p] = v; notifyStyle(t._owner) }
        if (k === 'removeProperty') return (p) => { delete t._s[p]; notifyStyle(t._owner) }
        if (k === Symbol.toPrimitive) return () => 'style'
        return k in t._s ? t._s[k] : ''
      },
      set(t, k, v) {
        if (k === '_s') { t._s = v; return true }
        if (k === '_owner') { t._owner = v; return true }
        t._s[k] = serializeCssLength(v)
        notifyStyle(t._owner)
        return true
      },
    })
  }
}

class FakeEl {
  constructor(tag = 'DIV', cls = '', attrs = {}) {
    this.tagName = tag
    this.className = cls
    this.dataset = { ...attrs }
    this.children = []
    this.parentElement = null
    this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    this._connected = true
    this._oid = ++oidSeq
    this.style = new StyleProxy(this)
    return new Proxy(this, {
      get(t, k) { if (k in t) return t[k]; if (k === Symbol.toPrimitive) return () => 'stub'; return universalStub },
    })
  }
  get isConnected() { return this._connected }
  getBoundingClientRect() { return { ...this._rect } }
  setRect(o) { Object.assign(this._rect, o); this._rect.width = o.right - o.left; this._rect.height = o.bottom - o.top; return this }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c }
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

function fresh() {
  const allEls = []
  class MOCtor {
    constructor(cb) { this.cb = cb; this._oids = [] }
    observe(target) {
      const oid = target && target._oid
      if (oid == null) return
      this._oids.push(oid)
      const l = observers.get(oid) ?? []
      l.push(this.cb)
      observers.set(oid, l)
    }
    disconnect() {
      for (const oid of this._oids) {
        const l = observers.get(oid)
        if (l) { const i = l.indexOf(this.cb); if (i >= 0) l.splice(i, 1) }
      }
      this._oids = []
    }
  }
  class ROCtor { observe() {} unobserve() {} disconnect() {} }
  const storage = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } })()
  const matches = (el, sel) => {
    if (sel === '[data-phase]') return el.dataset && el.dataset.phase != null
    if (sel.startsWith('.')) return String(el.className || '').split(/\s+/).includes(sel.slice(1))
    return false
  }
  const documentStub = {
    body: new FakeEl('BODY'),
    documentElement: new FakeEl('HTML'),
    head: new FakeEl('HEAD'),
    querySelector: (sel) => allEls.find((e) => matches(e, sel)) || null,
    querySelectorAll: (sel) => allEls.filter((e) => matches(e, sel)),
    createElement: (tag) => new FakeEl(String(tag).toUpperCase()),
    addEventListener() {}, removeEventListener() {},
  }
  const sandbox = {
    window: {}, console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: storage, document: documentStub,
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    MutationObserver: MOCtor, ResizeObserver: ROCtor,
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      platform: 'Win32', vendor: '', language: 'zh-CN', languages: ['zh-CN'], appVersion: '5.0 (Windows)', maxTouchPoints: 0,
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    fetch: () => Promise.reject(new Error('fetch unavailable')),
    indexedDB: undefined, crypto: globalThis.crypto,
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL() {} },
    Blob: function Blob() {},
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  let captured = null
  sandbox.window.__ModuleLoader__ = { load: (reg) => { captured = reg } }
  sandbox.window.addEventListener = () => {}
  sandbox.window.removeEventListener = () => {}
  createContext(sandbox)
  runInNewContext(source, sandbox, { filename: 'client.js', timeout: 10000 })
  if (!captured || typeof captured.factory !== 'function') fail('boot', 'client bundle did not register a factory')
  const req = (id) => {
    if (id === 'react' || id === 'react/jsx-runtime') return universalStub
    throw new Error('unexpected external require: ' + id)
  }
  const runSandbox = { __factory: captured.factory, __require: req }
  createContext(runSandbox)
  runInNewContext('__factory(__require)', runSandbox, { timeout: 10000 })
  const splitStore = sandbox.window.__dshWorktable && sandbox.window.__dshWorktable.splitStore
  if (!splitStore) fail('boot', 'splitStore not exported on window.__dshWorktable')
  return { sandbox, splitStore, allEls }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

function makeSpec(id) {
  return {
    id, title: 'T', top: null, left: null,
    main: [{ id: 'p1', title: '窗口1', min: 200, tabs: [], active: 0 }],
    chatWidth: { default: 360, min: 240, max: 600 },
    topHeight: { default: 200, min: 120, max: 480 },
    chatSide: 'right',
  }
}

/**
 * 打开一个列宽为小数的布局（复刻桌面端 dsf=1.5 的 getBoundingClientRect 分数量），
 * 返回 viewArea 供后续断言。
 */
function openFractional(splitStore, allEls, sandbox, id, rightEdge) {
  const header = new FakeEl('HEADER').setRect({ left: 0, top: 0, right: rightEdge, bottom: 26 })
  const viewArea = new FakeEl('DIV', 'scrollArea').setRect({ left: 0, top: 26, right: rightEdge, bottom: 800 })
  const root = new FakeEl('DIV', 'conversationRoot', { phase: 'active' })
  root.appendChild(header); root.appendChild(viewArea)
  root.setRect({ left: 0, top: 0, right: rightEdge, bottom: 800 })
  allEls.push(root)
  sandbox.document.body.appendChild(root)
  const opened = splitStore.open(makeSpec(id))
  return { opened, viewArea, root }
}

// —— A. 分数列宽：拖动分隔线不得关闭布局（Bug 1 核心） ——
{
  const { sandbox, splitStore, allEls } = fresh()
  // 非整数右边界 → gap = colW - chatW 为循环小数，CSSOM 会归一化
  const { opened, viewArea } = openFractional(splitStore, allEls, sandbox, 't-a', 1194.666748046875)
  await tick()
  if (opened !== true || !splitStore.active) fail('A.open', 'open() failed')
  if (splitStore.lastMarginLeft !== viewArea.style.marginLeft) {
    fail('A.baseline', 'open 后基线不一致: last=' + JSON.stringify(splitStore.lastMarginLeft) +
      ' style=' + JSON.stringify(viewArea.style.marginLeft))
  }
  // 反复拖动聊天宽度分隔线：每次都写 margin，且观察器回调后仍须存活
  for (const w of [340, 355.5, 372.25, 300, 480]) {
    splitStore.setChatW(w)
    await tick()
    if (!splitStore.active) {
      fail('A.drag', 'setChatW(' + w + ') 后布局被误关（Bug 1 复发）')
    }
    if (splitStore.lastMarginLeft !== viewArea.style.marginLeft) {
      fail('A.track', 'setChatW(' + w + ') 后基线漂移: last=' + JSON.stringify(splitStore.lastMarginLeft) +
        ' style=' + JSON.stringify(viewArea.style.marginLeft))
    }
  }
  ok('A. 分数列宽下拖动聊天分隔线不关闭布局（Bug 1）')
}

// —— B. 顶行高度与左列宽的同类路径 ——
{
  const { sandbox, splitStore, allEls } = fresh()
  const { opened, viewArea } = openFractional(splitStore, allEls, sandbox, 't-b', 1234.666748046875)
  await tick()
  if (opened !== true) fail('B.open', 'open() failed')
  splitStore.setTopH(240)
  await tick()
  if (!splitStore.active) fail('B.topH', 'setTopH 后布局被误关')
  if (splitStore.lastMarginTop !== viewArea.style.marginTop) {
    fail('B.track', 'marginTop 基线漂移: last=' + JSON.stringify(splitStore.lastMarginTop) +
      ' style=' + JSON.stringify(viewArea.style.marginTop))
  }
  splitStore.setLeftW(300)
  await tick()
  if (!splitStore.active) fail('B.leftW', 'setLeftW 后布局被误关')
  ok('B. 顶行高/左列宽调整不关闭布局且基线不漂移')
}

// —— C. 外部真改写仍须让位（修复不得把让位能力一起关掉） ——
{
  const { sandbox, splitStore, allEls } = fresh()
  const { opened, viewArea } = openFractional(splitStore, allEls, sandbox, 't-c', 1194.666748046875)
  await tick()
  if (opened !== true) fail('C.open', 'open() failed')
  // 模拟其他分栏引擎接管：直接改写 margin（非本引擎写入）
  viewArea.style.marginLeft = '42px'
  await tick()
  if (splitStore.active) fail('C.yield', '外部改写 margin 后布局未让位（yieldObserver 失效）')
  ok('C. 外部改写 margin 仍正确让位')
}

// —— D. 换锚点后 yieldObserver 跟随新元素 ——
{
  const { sandbox, splitStore, allEls } = fresh()
  const { opened } = openFractional(splitStore, allEls, sandbox, 't-d', 1194.666748046875)
  await tick()
  if (opened !== true) fail('D.open', 'open() failed')
  const oldRoot = allEls.find((e) => e.className === 'conversationRoot')
  if (!oldRoot) fail('D.setup', 'old root not tracked')
  // 换会话根：把旧根从候选集中摘除（断开连接 + 移出 allEls），只留新根
  oldRoot._connected = false
  const oldIdx = allEls.indexOf(oldRoot)
  if (oldIdx >= 0) allEls.splice(oldIdx, 1)
  // 新建新根：新 root + 新 body，触发 syncAnchor 重锚
  const header2 = new FakeEl('HEADER').setRect({ left: 0, top: 0, right: 1258, bottom: 26 })
  const newBody = new FakeEl('DIV', 'scrollArea2').setRect({ left: 0, top: 26, right: 1258, bottom: 800 })
  const root2 = new FakeEl('DIV', 'conversationRoot2', { phase: 'active' })
  root2.appendChild(header2); root2.appendChild(newBody)
  root2.setRect({ left: 0, top: 0, right: 1258, bottom: 800 })
  allEls.push(root2)
  sandbox.document.body.appendChild(root2)
  splitStore.syncAnchor()
  await tick()
  if (!splitStore.active) fail('D.resync', '重锚后布局被关闭')
  if (splitStore.viewArea !== newBody) {
    fail('D.anchor', '未锚定到新 viewArea（当前=' + (splitStore.viewArea && splitStore.viewArea.className) + '）')
  }
  // 新元素被外部改写 → 必须让位（证明观察器已跟随；旧实现只盯旧元素，此处会漏判）
  newBody.style.marginLeft = '99px'
  await tick()
  if (splitStore.active) fail('D.yieldNew', '新锚点上的外部改写未被识别（yieldObserver 未重绑）')
  ok('D. 换锚点后 yieldObserver 跟随新元素并仍能让位')
}

// —— E. 整数列宽（旧行为不得回归） ——
{
  const { sandbox, splitStore, allEls } = fresh()
  const { opened } = openFractional(splitStore, allEls, sandbox, 't-e', 1200)
  await tick()
  if (opened !== true) fail('E.open', 'open() failed')
  for (const w of [340, 400, 300]) {
    splitStore.setChatW(w)
    await tick()
    if (!splitStore.active) fail('E.drag', '整数列宽下 setChatW(' + w + ') 关闭了布局')
  }
  ok('E. 整数列宽路径不回归')
}

console.log('all split-margin tests passed: ' + pass + '/' + pass)
