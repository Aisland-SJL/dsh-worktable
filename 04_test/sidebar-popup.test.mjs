/**
 * WorktableSection popup regression against the actual client bundle.
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

function loadComponent() {
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
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
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
  runInNewContext(source, sandbox, { filename: BUNDLE, timeout: 20000 })
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
  return { component: exports.WorktableSection, hooks, window, values }
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

await main()
