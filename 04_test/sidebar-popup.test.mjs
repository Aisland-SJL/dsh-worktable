/**
 * Sidebar popup and control-room presentation regressions against the actual client bundle.
 * Usage: node 04_test/sidebar-popup.test.mjs [lib/client.js]
 * The small React hook/JSX harness runs the exported component and its event handlers;
 * it does not claim browser layout or desktop GUI coverage.
 */
import { readFileSync } from 'node:fs'
import { createContext, runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const BUNDLE = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '01_content', 'lib', 'client.js'))
const source = readFileSync(BUNDLE, 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const Fragment = Symbol('test.fragment')
const jsx = (type, props, key) => ({ type, props: props ?? {}, key: key ?? props?.key ?? null })

function makeHooks() {
  const slots = []
  const effects = []
  let cursor = 0
  let mounted = false

  const useState = (initial) => {
    const i = cursor++
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
    return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }]
  }
  const useRef = (initial) => {
    const i = cursor++
    if (!(i in slots)) slots[i] = { current: initial }
    return slots[i]
  }
  const useMemo = (make) => { cursor++; return make() }
  const useCallback = (callback) => { cursor++; return callback }
  const useEffect = (effect) => { cursor++; if (!mounted) effects.push(effect) }

  return {
    React: { Fragment, useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect: useEffect },
    render(component, props) {
      cursor = 0
      const tree = component(props)
      if (!mounted) {
        mounted = true
        for (const effect of effects.splice(0)) {
          try { effect() } catch (error) { throw new Error('mount effect failed: ' + error.message) }
        }
      }
      return tree
    },
  }
}

function fakeElement(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(),
    className: '',
    style: {},
    children: [],
    setAttribute(name, value) { this[name] = value },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { left: 24, top: 100, right: 64, bottom: 140, width: 40, height: 40 } },
    getContext() {
      return {
        globalCompositeOperation: '',
        createLinearGradient() { return { addColorStop() {} } },
        fillRect() {},
        getImageData() { return { data: [0, 0, 0, 255] } },
      }
    },
  }
}

function loadComponent({ stored = {}, fetch: fetchFixture } = {}) {
  const values = new Map([
    ['dsh.worktable.updateCheck.v1', '0'],
    ['dsh.worktable.projects.v1', JSON.stringify({
      order: [], lastUsed: {}, hidden: [], nameOverrides: {}, iconOverrides: {}, removed: [],
      views: {}, shortcuts: [], bindings: {}, folders: {},
      layouts: [{
        id: 'popup-test-layout', title: 'Popup Test', icon: '🧱', top: null,
        main: [{ id: 'popup-test-pane', title: 'Pane', min: 200, content: null }],
        chatWidth: { default: 320, min: 240, max: 600 },
      }],
    })],
  ])
  for (const [key, value] of Object.entries(stored)) values.set(key, String(value))
  const localStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
  const body = fakeElement('body')
  const head = fakeElement('head')
  const document = {
    body, head,
    documentElement: fakeElement('html'),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => fakeElement(tag),
    addEventListener() {},
    removeEventListener() {},
  }
  const window = {
    innerWidth: 1280,
    innerHeight: 900,
    localStorage,
    document,
    __ModuleLoader__: { load: (definition) => { window.captured = definition } },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    open() {},
  }
  const hooks = makeHooks()
  const jsxRuntime = { Fragment, jsx, jsxs: jsx }
  const sandbox = {
    window, document, localStorage,
    self: window,
    location: { href: 'http://localhost/', protocol: 'http:' },
    navigator: { userAgent: 'node popup regression', platform: 'Win32', language: 'en-US' },
    console,
    atob,
    btoa,
    fetch: fetchFixture ?? (async () => ({ ok: false, status: 404, json: async () => ({}) })),
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    setInterval: window.setInterval,
    clearInterval: window.clearInterval,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail } },
    URL, Blob, AbortController,
    indexedDB: undefined,
  }
  createContext(sandbox)
  // Expose existing bundle locals in memory only; the delivered module stays unchanged.
  const footer = 'return module.exports; } });'
  assert(source.split(footer).length === 2, 'client bundle footer must be unique')
  const instrumented = source.replace(footer,
    'Object.defineProperty(module.exports, "__consoleTest", { value: Object.freeze({ ConsolePane, setSplitEnv, setSplitT, zh, en, css, sessionNotifyState, LOCAL_VERSION, cmpVer, readCache }) });\n' + footer)
  runInNewContext(instrumented, sandbox, { filename: BUNDLE, timeout: 20000 })
  assert(typeof window.captured?.factory === 'function', 'client bundle did not register a factory')
  const requireExternal = (id) => {
    if (id === 'react') return hooks.React
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id === 'react-dom') return { createPortal: (child) => child }
    if (id === 'scheduler') return {}
    throw new Error('unexpected external module: ' + id)
  }
  const exports = window.captured.factory(requireExternal)
  assert(typeof exports.WorktableSection === 'function', 'bundle did not export WorktableSection')
  return { component: exports.WorktableSection, hooks, window, values, consoleTest: exports.__consoleTest }
}

function walk(node, predicate, out = []) {
  if (Array.isArray(node)) { for (const child of node) walk(child, predicate, out); return out }
  if (!node || typeof node !== 'object') return out
  if (typeof node.type !== 'undefined' && predicate(node)) out.push(node)
  walk(node.props?.children, predicate, out)
  return out
}

const classHas = (node, name) => String(node.props?.className ?? '').split(/\s+/).includes(name)
const byClass = (tree, name) => walk(tree, (node) => classHas(node, name))
const click = (node, rect = fakeElement()) => {
  assert(typeof node?.props?.onClick === 'function', 'target has no onClick handler')
  node.props.onClick({ currentTarget: rect, target: rect, stopPropagation() {}, preventDefault() {} })
}

async function main() {
  const { component, hooks, window, values } = loadComponent()
  const render = (wide) => hooks.render(component, { wide, t: (key) => key })
  let tree = render(false)
  assert(byClass(tree, 'dsh-wt_rail').length === 1, 'collapsed rail was not rendered')
  assert(byClass(tree, 'dsh-wt_add').length === 0, 'add popup unexpectedly started open')

  const addFromConsole = window.__dshCustomEnv?.console?.onAdd
  assert(typeof addFromConsole === 'function', 'control-room onAdd action was not exposed')
  addFromConsole()
  tree = render(false)
  assert(byClass(tree, 'dsh-wt_add').length === 1, 'control-room add action did not render once in collapsed rail')
  tree = render(true)
  assert(byClass(tree, 'dsh-wt_add').length === 1, 'switching wide retained duplicate or lost add popup')
  click(byClass(tree, 'dsh-wt_popBackdrop')[0])
  tree = render(true)
  assert(byClass(tree, 'dsh-wt_add').length === 0, 'add popup backdrop did not close')

  const viewOptionsButton = walk(tree, (node) => node.type === 'button' && node.props?.['aria-label'] === 'menu.viewOptions')[0]
  assert(viewOptionsButton, 'view-options control missing in wide mode')
  click(viewOptionsButton)
  tree = render(true)
  assert(byClass(tree, 'dsh-wt_manage').length === 1, 'manage popup did not open')
  tree = render(false)
  assert(byClass(tree, 'dsh-wt_manage').length === 1, 'switching collapsed while popup open lost or duplicated the popup')
  tree = render(true)

  const layoutIcon = byClass(tree, 'dsh-wt_manageIcon').at(-1)
  assert(layoutIcon, 'layout icon control missing')
  click(layoutIcon)
  tree = render(true)
  assert(byClass(tree, 'dsh-wt_iconPop').length === 1, 'icon popup did not open once')
  const iconCell = byClass(tree, 'dsh-wt_iconCell')[1]
  assert(iconCell, 'icon choices missing')
  const chosenIcon = iconCell.props.children
  click(iconCell)
  tree = render(true)
  assert(byClass(tree, 'dsh-wt_iconPop').length === 0, 'choosing an icon did not close its popup')
  const savedProjects = JSON.parse(values.get('dsh.worktable.projects.v1'))
  assert(savedProjects.layouts[0].icon === chosenIcon, 'chosen layout icon was not persisted')

  const layoutCard = byClass(tree, 'dsh-wt_layout').at(-1)
  const bindButton = layoutCard && walk(layoutCard, (node) => classHas(node, 'dsh-wt_bindBtn'))[0]
  assert(bindButton, 'layout binding control missing')
  click(bindButton)
  tree = render(true)
  assert(byClass(tree, 'dsh-wt_bindPop').length === 1, 'binding popup did not open once')
  click(byClass(tree, 'dsh-wt_popBackdrop').at(-1))
  tree = render(true)
  assert(byClass(tree, 'dsh-wt_bindPop').length === 0, 'binding popup backdrop did not close')

  const deleteButton = walk(tree, (node) => node.type === 'button' && node.props?.title === 'manage.deleteLayout')[0]
  assert(deleteButton, 'layout delete control missing')
  click(deleteButton)
  tree = render(true)
  assert(walk(tree, (node) => node.props?.role === 'alertdialog').length === 1, 'delete confirmation did not open')
  const cancelButton = walk(tree, (node) => node.type === 'button' && node.props?.children === 'confirm.cancel')[0]
  assert(cancelButton, 'delete confirmation cancel control missing')
  click(cancelButton)
  tree = render(true)
  assert(walk(tree, (node) => node.props?.role === 'alertdialog').length === 0, 'delete confirmation did not close')

  console.log('all sidebar-popup tests passed: add, icon, binding, delete confirmation, wide/collapsed switching')
}

function testConsolePresentation() {
  for (const [language, ended] of [['zh', '本轮已结束'], ['en', 'Run ended']]) {
    const { hooks, consoleTest: api } = loadComponent()
    const dictionary = api[language]
    const actions = []
    const cards = ['done', 'need', 'busy'].map((status) => ({
      id: status, name: status, icon: '•', status, runtimeMs: null, kids: 0,
      preview: 'Actual assistant reply', bound: true, self: false, glow: status !== 'busy',
    }))
    api.setSplitT((key) => dictionary[key] ?? key)
    api.setSplitEnv({ console: {
      getCards: () => cards, getTheme: () => 'dark', getBg: () => 'plain',
      subscribe: () => () => {}, getPhotoLib: async () => ({ list: [], activeId: null }),
      onAck: (id) => actions.push('ack:' + id), onOpen: (id) => actions.push('open:' + id),
    } })
    let tree = hooks.render(api.ConsolePane, {})
    for (const status of ['done', 'need', 'busy']) {
      const labels = byClass(tree, 'dsh-wt_consoleStatus-' + status)
      const expected = status === 'done' ? ended : dictionary['console.' + status]
      assert(labels.length === 1 && labels[0].props.children === expected, language + ' incorrect ' + status + ' label')
    }
    const tip = dictionary['bind.tipDone']
    assert(tip.includes(language === 'zh' ? ended : 'run ended'), language + ' sidebar tip does not describe a run ending')
    assert(!/已完成|成功|completed|success/i.test(tip), language + ' sidebar tip still claims success')
    assert(byClass(tree, 'dsh-wt_consoleCard-glowDone').length === 1, 'unread end reminder was lost')
    assert(byClass(tree, 'dsh-wt_consoleCard-glowNeed').length === 1, 'pending reminder was lost')
    assert(byClass(tree, 'dsh-wt_consoleCard-busy').length === 1, 'working indicator was lost')
    assert(byClass(tree, 'dsh-wt_consoleSweep').length === 1, 'working animation was lost')
    const previews = byClass(tree, 'dsh-wt_consolePreview')
    assert(previews.length === 3 && previews.every((node) => node.props.children === 'Actual assistant reply'), 'card preview was missing or replaced')
    click(byClass(tree, 'dsh-wt_consoleCard-glowDone')[0])
    assert(actions.join(',') === 'ack:done,open:done', 'ended card must acknowledge before opening')
    cards[0].glow = false
    tree = hooks.render(api.ConsolePane, {})
    assert(byClass(tree, 'dsh-wt_consoleCard-glowDone').length === 0, 'acknowledged end still glows')
    assert(byClass(tree, 'dsh-wt_consoleStatus-done')[0].props.children === ended, 'acknowledgement erased ended status')

    const rule = (selector) => {
      const start = api.css.indexOf(selector + '{')
      assert(start >= 0, 'missing bundled CSS rule: ' + selector)
      return api.css.slice(start + selector.length + 1, api.css.indexOf('}', start))
    }
    for (const selector of ['.dsh-wt_bindBtn[data-bound=done]', '.dsh-wt_consoleStatus-done', '.dsh-wt_consoleCard-glowDone']) {
      assert(!/state-success|#3fb950|rgba?\(63,\s*185,\s*80/i.test(rule(selector)), 'ended reminder still uses success green: ' + selector)
    }
    assert(rule('.dsh-wt_bindBtn[data-bound=need]').includes('#d29922'), 'sidebar pending color changed')
    assert(rule('.dsh-wt_bindBtn[data-bound=busy]').includes('#4f8ef7'), 'sidebar working color changed')
    assert(rule('.dsh-wt_consoleStatus-need').includes('state-warning'), 'control-room pending color changed')
    assert(rule('.dsh-wt_consoleStatus-busy').includes('state-accent-primary'), 'control-room working color changed')
    assert(api.sessionNotifyState({ running: true, completed: true }) === null, 'stale end must not hide a running sidebar session')
    assert(api.sessionNotifyState({ running: true, completed: true, pendingInteraction: { key: 'fixture' } }) === 'need', 'pending must remain first')
    assert(api.sessionNotifyState({ running: false, completed: true }) === 'done', 'run ending lost its existing ack kind')
  }
  console.log('all control-room presentation tests passed: zh/en, neutral end, need/busy, preview, acknowledgement')
}

async function testUpdatePresentation() {
  const releaseUrl = 'https://api.github.com/repos/Aisland-SJL/dsh-worktable/releases/latest'
  for (const outcome of ['older', 'same', 'forbidden', 'invalid', 'invalid-prefix', 'skip']) {
    let response = { status: 200, tag: 'v9.0.0' }
    let requests = 0
    const { component, hooks, values, consoleTest: api } = loadComponent({ fetch: async (url) => {
      assert(url === releaseUrl, 'unexpected request in update fixture: ' + url)
      requests++
      return { ok: response.status === 200, status: response.status,
        json: async () => ({ tag_name: response.tag, body: 'Fixture release', html_url: 'https://example.invalid/release' }) }
    } })
    assert(api.cmpVer('0.5.0', api.LOCAL_VERSION) < 0, 'bundled comparator does not reject the old release')
    const render = () => hooks.render(component, { wide: true, t: (key) => key })
    let tree = render()
    click(walk(tree, (node) => node.type === 'button' && node.props?.['aria-label'] === 'menu.viewOptions')[0])
    tree = render()
    const check = async () => {
      click(byClass(byClass(tree, 'dsh-wt_versionRow')[0], 'dsh-wt_updateBtn')[0])
      tree = render()
      assert(byClass(byClass(tree, 'dsh-wt_versionRow')[0], 'dsh-wt_updateBtn')[0].props.disabled, 'check button did not enter checking state')
      await new Promise(setImmediate)
      tree = render()
    }
    await check()
    assert(requests === 1, 'manual check did not issue one fixture request')
    assert(byClass(tree, 'dsh-wt_updateCard').length === 1 && byClass(tree, 'dsh-wt_updateBadge').length === 1, 'genuine newer release did not show card and badge')
    assert(JSON.stringify(byClass(tree, 'dsh-wt_updateVers')[0].props.children).includes('9.0.0'), 'newer release label missing')
    if (outcome === 'skip') {
      click(walk(tree, (node) => node.type === 'button' && node.props?.children === 'update.skip')[0])
      tree = render()
      assert(values.get('dsh.worktable.skipVersion.v1') === '9.0.0', 'skip button did not persist the shown release')
      assert(byClass(tree, 'dsh-wt_updateCard').length === 0 && byClass(tree, 'dsh-wt_updateBadge').length === 0, 'skip button left visible update UI')
    } else {
      response = outcome === 'forbidden' ? { status: 403 } : { status: 200,
        tag: outcome === 'older' ? 'v0.5.0' : outcome === 'same' ? 'v' + api.LOCAL_VERSION : outcome === 'invalid-prefix' ? 'vv9.0.0' : 'not-a-version' }
    }
    await check()
    assert(requests === 2, outcome + ': unexpected retries or skipped manual request')
    for (const name of ['dsh-wt_updateCard', 'dsh-wt_updateBadge', 'dsh-wt_updateBtnCopy']) {
      assert(byClass(tree, name).length === 0, outcome + ': stale update UI survived: ' + name)
    }
    if (['forbidden', 'invalid', 'invalid-prefix'].includes(outcome)) {
      assert(JSON.stringify(byClass(tree, 'dsh-wt_versionRow')[0].props.children).includes('update.checkFail'), 'failed check was hidden by old update info')
    }
  }

  const localVersion = loadComponent().consoleTest.LOCAL_VERSION
  for (const [label, latest, skipped, shown] of [
    ['older', '0.5.0', '', false], ['same', localVersion, '', false],
    ['invalid', 'not-a-version', '', false], ['skipped', '9.0.0', '9.0.0', false],
    ['newer', '9.0.0', '', true],
  ]) {
    let requests = 0
    const { hooks, values, consoleTest: api } = loadComponent({
      stored: {
        'dsh.worktable.updateCheck.v1': '0',
        'dsh.worktable.lastUpdateCheck.v1': String(Date.now()),
        'dsh.worktable.skipVersion.v1': skipped,
        'dsh.worktable.updateCache.v1': JSON.stringify({ status: 'uptodate', info: { latest, notes: 'Fixture cache', url: 'https://example.invalid/release' } }),
      },
      fetch: async () => { requests++; return { ok: false, status: 404 } },
    })
    api.setSplitT((key) => key)
    api.setSplitEnv({ console: {
      getCards: () => [], getTheme: () => 'dark', getBg: () => 'plain',
      subscribe: () => () => {}, getPhotoLib: async () => ({ list: [], activeId: null }),
    } })
    const render = () => hooks.render(api.ConsolePane, {})
    let tree = render()
    assert(byClass(tree, 'dsh-wt_dockBadge').length === Number(shown), label + ': wrong cached dock badge')
    click(walk(tree, (node) => node.type === 'button' && node.props?.['aria-label'] === 'annot.updateTitle')[0])
    tree = render()
    for (const name of ['dsh-wt_announceUpdate', 'dsh-wt_announceUpg']) {
      assert(byClass(tree, name).length === Number(shown), label + ': wrong cached announcement: ' + name)
    }
    assert((api.readCache().info != null) === shown, label + ': cache reader still exposes an ineligible release')
    if (shown) {
      values.set('dsh.worktable.skipVersion.v1', latest)
      tree = render()
      assert(byClass(tree, 'dsh-wt_announceUpdate').length === 0 && byClass(tree, 'dsh-wt_dockBadge').length === 0, 'already-mounted control room retained ignored update info')
    }
    await new Promise(setImmediate)
    assert(requests === 0, label + ': disabled automatic update check made a request')
  }
  console.log('all update presentation tests passed: settings transitions and control-room cache, no network')
}

await main()
testConsolePresentation()
await testUpdatePresentation()
