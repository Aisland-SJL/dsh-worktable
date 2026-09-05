/**
 * client-factory-gate 失败测试：证明 TDZ / 错误 ID / 未知依赖 / 错误 inject 能被拦截。
 * 用法：node client-factory-gate.test.mjs（不依赖 npm，纯 node；失败用例抛错即测试失败）
 */
import { gateClientFactory } from './client-factory-gate.mjs'

const WRAP = (body) => "window.__ModuleLoader__.load({ id: 'dsh-worktable', factory: (require) => { var module = { exports: {} }; var exports = module.exports; " + body + " return module.exports; } });"
const OK_BODY = "exports.apply = function apply() {}; exports.inject = ['slots','locale','sessions','conversation','workspaces'];"

let pass = 0
function expectFail(name, source, expectId, expectInject, pattern) {
  try {
    gateClientFactory(source, expectId, expectInject)
    console.error('FAIL(should have been blocked): ' + name)
    process.exit(1)
  } catch (e) {
    const msg = String(e && e.message ? e.message : e)
    if (pattern && !pattern.test(msg)) {
      console.error('FAIL(wrong reason): ' + name + ' => ' + msg)
      process.exit(1)
    }
    console.log('ok   blocked: ' + name + ' => ' + msg)
    pass++
  }
}

// 1. TDZ 顶层自引用（#491 同款 const Ge=Ge）
expectFail('TDZ self-reference', WRAP("const Ge = Ge;"), 'dsh-worktable', ['slots'], /factory threw|evaluation failed/)

// 2. 错误 ModuleLoader ID
expectFail('wrong ModuleLoader ID', "window.__ModuleLoader__.load({ id: 'wrong-plugin', factory: (require) => { return { apply() {}, inject: [] } } });", 'dsh-worktable', [], /ID mismatch/)

// 3. 未知外部依赖 require
expectFail('unknown external require', WRAP("require('totally-unknown-pkg'); exports.apply = function(){}; exports.inject = [];"), 'dsh-worktable', [], /unexpected external require/)

// 4. 导出结构错误：apply 非函数
expectFail('apply not a function', WRAP("exports.apply = null; exports.inject = [];"), 'dsh-worktable', [], /apply is not a function/)

// 5. inject 内容错误
expectFail('inject mismatch', WRAP("exports.apply = function(){}; exports.inject = ['slots'];"), 'dsh-worktable', ['slots','locale'], /inject mismatch/)

// 6. 白名单外 @deepseek-ai 包（曾是最常见的"引用已删除宿主模块白屏"）
expectFail('disallowed @deepseek-ai require', WRAP("require('@deepseek-ai/dsh-client-runtime/client'); exports.apply = function(){}; exports.inject = [];"), 'dsh-worktable', [], /unexpected external require/)

// 7. 重复注册 ModuleLoader（load 调用超过一次）
expectFail('double ModuleLoader registration', "window.__ModuleLoader__.load({ id: 'dsh-worktable', factory: () => ({ apply() {}, inject: [] }) }); window.__ModuleLoader__.load({ id: 'dsh-worktable', factory: () => ({ apply() {}, inject: [] }) });", 'dsh-worktable', [], /more than once/)

// 8. 正向：合法最小 bundle 通过
try {
  gateClientFactory(WRAP(OK_BODY), 'dsh-worktable', ['slots','locale','sessions','conversation','workspaces'])
  console.log('ok   passed: valid minimal bundle')
  pass++
} catch (e) {
  console.error('FAIL(should pass): valid minimal bundle => ' + (e && e.message ? e.message : e))
  process.exit(1)
}

// 9. 死循环工厂（>10s 超时拦截；用 11s 忙等模拟）
expectFail('factory infinite loop timeout', WRAP("var t0 = Date.now(); while (Date.now() - t0 < 11000) {}; exports.apply = function(){}; exports.inject = [];"), 'dsh-worktable', [], /timed out|>10s/)

// 10. 正向：白名单内 require 被记录（react/jsx-runtime 允许）
try {
  const r = gateClientFactory(WRAP("require('react/jsx-runtime'); exports.apply = function(){}; exports.inject = [];"), 'dsh-worktable', [])
  if (!r.actualRequires.includes('react/jsx-runtime')) throw new Error('actualRequires not recorded')
  console.log('ok   passed: allowed require recorded')
  pass++
} catch (e) {
  console.error('FAIL(should pass): allowed require => ' + (e && e.message ? e.message : e))
  process.exit(1)
}

console.log('all gate tests passed: ' + pass + '/10')
