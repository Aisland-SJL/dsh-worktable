/**
 * dsh-worktable 客户端工厂求值门禁（供 release-prep 调用；独立成模块便于失败测试）。
 *
 * 定位：这是「工厂求值门禁」，不是客户端端到端验收——只验证 bundle 在
 *   window.__ModuleLoader__.load 握手下能被真实求值一次，能抓住：
 *   - 顶层 TDZ / 求值异常（如 const Ge=Ge）
 *   - ModuleLoader ID 登记错误
 *   - 工厂引用了未授权的外部模块
 *   - 导出结构错误（apply 非函数 / inject 内容不对）
 * 抓不到：React 真实渲染异常、apply(ctx) 与真实宿主服务的兼容、浏览器环境差异——
 *   这些属于真实 DSH 冷启动验收（独立步骤）。
 */
import { createContext, runInNewContext } from 'node:vm'

/** 客户端 external 精确白名单——当前真实 bundle 只 require react / react/jsx-runtime。
 *  新增任何宿主依赖必须显式审核后加入此清单（防引用已删除宿主模块导致白屏）。 */
export const CLIENT_EXTERNAL_ALLOW = [
  'react',
  'react/jsx-runtime',
]

/** 递归万能桩：任何属性访问/调用/构造都返回自身同型桩（覆盖 react 导出树与 jsx 调用）。 */
function makeStub() {
  const stub = function () { return makeStub() }
  return new Proxy(stub, {
    get: (_t, k) => {
      if (k === Symbol.toPrimitive) return () => 'stub'
      return makeStub()
    },
    apply: () => makeStub(),
    construct: () => makeStub(),
  })
}

/**
 * 求值一个 client bundle 源码：捕获 window.__ModuleLoader__.load 的注册结果并执行工厂。
 * @param source - lib/client.js 全文
 * @param expectedId - 期望的 ModuleLoader ID（'dsh-worktable'）
 * @param expectedInject - 期望的客户端 inject 数组
 * @returns {{ exports: any, id: string }} 工厂执行结果
 * @throws {Error} 任何门禁失败（TDZ/ID 错误/未知依赖/导出结构错误）
 */
export function gateClientFactory(source, expectedId, expectedInject) {
  let captured = null
  let loadCalls = 0
  const actualRequires = new Set()
  const localStorageStub = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  const docStub = new Proxy(function () { return makeStub() }, {
    get: (_t, k) => {
      if (k === 'body' || k === 'documentElement') return makeStub()
      if (k === 'createElement') return () => makeStub()
      if (k === 'querySelector' || k === 'querySelectorAll' || k === 'getElementById') return () => null
      if (k === 'addEventListener' || k === 'removeEventListener') return () => {}
      if (k === Symbol.toPrimitive) return () => 'stub'
      return makeStub()
    },
    apply: () => makeStub(),
  })
  const sandbox = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    localStorage: localStorageStub,
    document: docStub,
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    Blob: function Blob() {},
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    MutationObserver: function MutationObserver() { return { observe: () => {}, disconnect: () => {} } },
    ResizeObserver: function ResizeObserver() { return { observe: () => {}, unobserve: () => {}, disconnect: () => {} } },
    IntersectionObserver: function IntersectionObserver() { return { observe: () => {}, unobserve: () => {}, disconnect: () => {} } },
    requestAnimationFrame: (cb) => 0,
    cancelAnimationFrame: () => {},
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0', platform: 'Win32', language: 'zh-CN' },
    fetch: () => Promise.reject(new Error('fetch unavailable in gate sandbox')),
    indexedDB: undefined,
  }
  sandbox.window.__ModuleLoader__ = {
    load: (reg) => {
      loadCalls++
      if (loadCalls > 1) throw new Error('window.__ModuleLoader__.load called more than once')
      captured = reg
    },
  }
  sandbox.window.addEventListener = () => {}
  sandbox.window.removeEventListener = () => {}
  sandbox.window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  sandbox.window.localStorage = localStorageStub
  sandbox.window.document = docStub
  sandbox.self = sandbox.window // 浏览器全局 self === window
  createContext(sandbox)
  try {
    // VM 超时：错误/恶意 bundle 的顶层无限循环不能卡死发布流程（10s）
    runInNewContext(source, sandbox, { filename: 'client.js', timeout: 10000 })
  } catch (e) {
    throw new Error('client factory evaluation failed: ' + (e && e.message ? e.message : String(e)))
  }
  if (loadCalls === 0) {
    throw new Error('window.__ModuleLoader__.load was never called')
  }
  if (!captured || typeof captured !== 'object') {
    throw new Error('window.__ModuleLoader__.load was never called')
  }
  if (captured.id !== expectedId) {
    throw new Error('ModuleLoader ID mismatch: got ' + JSON.stringify(captured.id) + ', expected ' + expectedId)
  }
  if (typeof captured.factory !== 'function') {
    throw new Error('registered factory is not a function')
  }
  const requireStub = (id) => {
    if (typeof id !== 'string') throw new Error('require called with non-string id')
    actualRequires.add(id)
    if (CLIENT_EXTERNAL_ALLOW.includes(id)) return makeStub()
    throw new Error('unexpected external require: ' + id)
  }
  // 工厂调用放进受 timeout 控制的 vm 执行（防死循环卡死发布流程）
  const runSandbox = { __factory: captured.factory, __requireStub: requireStub }
  createContext(runSandbox)
  let exportsObj
  try {
    exportsObj = runInNewContext('__factory(__requireStub)', runSandbox, { timeout: 10000 })
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    if (/timed out|script execution/i.test(msg)) throw new Error('factory evaluation timed out (>10s)')
    throw new Error('factory threw during evaluation: ' + msg)
  }
  // 实际 require 集合必须严格等于白名单中已声明且被使用的项（按需子集）；空集也放行
  for (const id of actualRequires) {
    if (!CLIENT_EXTERNAL_ALLOW.includes(id)) throw new Error('unexpected external require: ' + id)
  }
  if (!exportsObj || typeof exportsObj !== 'object') {
    throw new Error('factory did not return module.exports object')
  }
  if (typeof exportsObj.apply !== 'function') {
    throw new Error('client exports.apply is not a function (got ' + typeof exportsObj.apply + ')')
  }
  const inj = exportsObj.inject
  if (!Array.isArray(inj)) throw new Error('client exports.inject is not an array')
  const want = JSON.stringify(expectedInject)
  const got = JSON.stringify(inj)
  if (want !== got) throw new Error('client inject mismatch: got ' + got + ', expected ' + want)
  return { id: captured.id, exports: exportsObj, actualRequires: [...actualRequires].sort() }
}
