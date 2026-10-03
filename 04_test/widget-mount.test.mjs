import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const require = createRequire(new URL('../01_content/package.json', import.meta.url))
const { buildSync, transformSync } = require('esbuild')
function sourceModule(relative) {
  const code = buildSync({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
  const module = { exports: {} }
  runInNewContext(code, { module, exports: module.exports })
  return module.exports
}
const { WidgetMountRegistry, widgetManifestPath, widgetTargets, newWidgetId, WIDGET_BINDINGS_KEY } = sourceModule('../01_content/src/client/widgetMount.ts')
const paths = sourceModule('../01_content/src/client/pathutil.ts')
const indexSource = readFileSync(new URL('../01_content/src/client/index.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const splitSource = readFileSync(new URL('../01_content/src/client/split.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, 'source section missing: ' + start)
  return source.slice(a, b)
}
function evaluate(code, bindings = {}) {
  const module = { exports: {} }
  runInNewContext(transformSync(code, { loader: 'tsx', format: 'cjs' }).code, { module, exports: module.exports, ...bindings })
  return module.exports
}
function storage(seed = {}) {
  const values = new Map(Object.entries(seed))
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values }
}
const specOf = id => ({ id, title: id, left: null, top: [{ id: 'p1', title: '窗口1', content: null }], main: [{ id: 'p2', title: '窗口2', content: null }] })
const resultOf = (b, extra = {}) => JSON.stringify({ version: 2, projectId: b.projectId, paneId: b.paneId, bindingId: b.bindingId, window: b.window, path: 'daily-station.html', kind: 'html', ...extra })
function registryFixture() {
  const store = storage()
  let next = 0
  return { store, registry: new WidgetMountRegistry(store, () => 'binding-' + (++next)) }
}

test('new project in an old/shared folder has no auto-mount ownership', () => {
  const { registry } = registryFixture()
  const a = specOf('A'), b = specOf('B'), folder = 'C:/shared'
  registry.begin('A', a, folder, 'S', '窗口1')
  assert.equal(registry.entries('B').length, 0)
  const ownedByA = registry.entries('A')[0]
  assert.equal(registry.resolve(ownedByA, resultOf(ownedByA), b, folder), null)
  assert.equal(b.top[0].content, null)
})
test('same folder and same display name still yield distinct project paths', () => {
  const { registry } = registryFixture()
  const a = specOf('A'), b = specOf('B')
  a.title = b.title = '同名项目'
  const aa = registry.begin('A', a, 'C:/shared', 'S', '窗口1')[0]
  const bb = registry.begin('B', b, 'C:/shared', 'S', '窗口1')[0]
  assert.notEqual(widgetManifestPath(aa), widgetManifestPath(bb))
  assert.equal(registry.resolve(bb, resultOf(aa), b, 'C:/shared'), null)
})
test('raw legacy object/array never authorizes a current result', () => {
  const { registry } = registryFixture(), spec = specOf('A')
  const b = registry.begin('A', spec, '/shared', 'S', '窗口1')[0]
  for (const raw of ['{"window":"窗口1","kind":"html","path":"old.html"}', '[{"window":"窗口1","path":"old.html"}]']) {
    assert.equal(registry.resolve(b, raw, spec, '/shared'), null)
  }
})
test('ownership, window, kind and malformed JSON are checked independently', () => {
  const { registry } = registryFixture(), spec = specOf('A')
  const b = registry.begin('A', spec, '/shared', 'S', '窗口1')[0]
  for (const extra of [{ version: 1 }, { projectId: 'B' }, { paneId: 'missing' }, { bindingId: 'old' }, { window: '窗口99' }, { kind: 'unknown' }, { path: '' }]) {
    assert.equal(registry.resolve(b, resultOf(b, extra), spec, '/shared'), null)
  }
  assert.equal(registry.resolve(b, '{bad', spec, '/shared'), null)
  assert.ok(registry.resolve(b, resultOf(b), spec, '/shared'))
})
test('refresh restores valid ownership and independent multi-window bindings', () => {
  const { registry, store } = registryFixture(), spec = specOf('A')
  const entries = registry.begin('A', spec, 'C:/shared', 'S', '窗口1')
  assert.equal(entries.length, 2)
  assert.notEqual(widgetManifestPath(entries[0]), widgetManifestPath(entries[1]))
  const restored = new WidgetMountRegistry(store)
  for (const b of entries) assert.ok(restored.resolve(b, resultOf(b), spec, 'C:/shared'))
  assert.ok(store.values.has(WIDGET_BINDINGS_KEY))
})
test('re-customizing one pane rejects its old writer without canceling another pane', () => {
  const { registry } = registryFixture(), spec = specOf('A')
  const old = registry.begin('A', spec, '/shared', 'S1', '窗口1')
  const next = registry.begin('A', spec, '/shared', 'S2', '窗口1')
  assert.notEqual(widgetManifestPath(old[0]), widgetManifestPath(next[0]))
  assert.equal(registry.resolve(old[0], resultOf(old[0]), spec, '/shared'), null)
  assert.ok(registry.resolve(old[1], resultOf(old[1]), spec, '/shared'))
})
test('manual revocation survives reload and an unrelated custom task', () => {
  const { registry, store } = registryFixture(), spec = specOf('A')
  const old = registry.begin('A', spec, '/shared', 'S', '窗口1')
  registry.revokePane('A', 'p1')
  const restored = new WidgetMountRegistry(store, () => 'binding-new')
  restored.begin('A', spec, '/shared', 'S', '窗口2')
  assert.equal(restored.entries('A').some(b => b.paneId === 'p1'), false)
  assert.equal(restored.resolve(old[0], resultOf(old[0]), spec, '/shared'), null)
})
test('another session receives only its own window bindings in the real task prompt', () => {
  const { registry } = registryFixture(), spec = specOf('A')
  const first = registry.begin('A', spec, '/shared', 'S1', '窗口1')
  const second = registry.begin('A', spec, '/shared', 'S2', '窗口2')
  const build = evaluate(section(indexSource, 'function buildWindowTaskText(', '\n/** 自定义窗口任务') + '\nexport { buildWindowTaskText }', { KNOWLEDGE_PACK: 'generic knowledge', widgetManifestPath }).buildWindowTaskText
  const prompt = build('A', '项目 A', '窗口2', 'widget', '/shared', 'send', second)
  assert.deepEqual(Array.from(second, b => b.sessionId), ['S2'])
  assert.ok(prompt.includes(widgetManifestPath(second[0])))
  assert.ok(!prompt.includes(widgetManifestPath(first[0])))
  assert.ok(registry.resolve(first[0], resultOf(first[0]), spec, '/shared'))
})
test('changing directory or removing target makes a previously valid result invalid', () => {
  const { registry } = registryFixture(), spec = specOf('A')
  const b = registry.begin('A', spec, '/shared', 'S', '窗口1')[0]
  assert.equal(registry.resolve(b, resultOf(b), spec, '/other'), null)
  assert.equal(registry.resolve(b, resultOf(b), { ...spec, top: [] }, '/shared'), null)
  registry.revokeProject('A')
  assert.equal(registry.resolve(b, resultOf(b), spec, '/shared'), null)
})
test('moved panes resolve by stable id rather than their previous row/index', () => {
  const { registry } = registryFixture(), spec = specOf('A')
  const b = registry.begin('A', spec, '/shared', 'S', '窗口1')[0]
  const moved = { ...spec, top: [spec.main[0]], main: [spec.top[0]] }
  const resolved = registry.resolve(b, resultOf(b), moved, '/shared')
  assert.equal(resolved.target.row, 'main')
  assert.equal(resolved.target.pane.id, 'p1')
})
test('storage failure prevents sending with a nonpersistent new binding', () => {
  const registry = new WidgetMountRegistry({ getItem: () => null, setItem() { throw new Error('quota') } }, () => 'binding-test')
  assert.throws(() => registry.begin('A', specOf('A'), '/shared', 'S', '窗口1'), /quota/)
  assert.equal(registry.entries().length, 0)
})
test('project ids are independent even when generated within one clock tick', () => {
  assert.equal(new Set(Array.from({ length: 100 }, () => newWidgetId('layout'))).size, 100)
})

// Execute the real async loader and real lockPane method, not a reimplementation.
function mountingFixture() {
  const { registry, store } = registryFixture()
  const specs = { A: specOf('A'), B: specOf('B') }, folders = { A: 'C:/shared', B: 'C:/shared' }
  const lockMethod = section(splitSource, '  lockPane(row, i, content) {', '\n  /** 更新指定标签页')
  const splitStore = evaluate('const splitStore = { active: true, spec: null, onSpecMutated: null, persist() {}, notify() {}, ' + lockMethod + ' }; export { splitStore }', { tabTitleOf: c => c.title }).splitStore
  splitStore.spec = specs.A
  splitStore.onSpecMutated = s => { specs[s.id] = s }
  const calls = [], reads = [], files = new Map()
  const lock = splitStore.lockPane
  splitStore.lockPane = function (...args) { calls.push(args); lock.apply(this, args) }
  const pendingMountRef = { current: {} }, mountedWidgetRef = { current: {} }, mountedRef = { current: true }
  const mountContent = evaluate(section(indexSource, 'function buildMountContent(', '\n/** 每会话最近观察') + '\nexport { buildMountContent }', paths).buildMountContent
  const bindings = {
    useCallback: fn => fn, widgetRegistry: registry,
    widgetProjectOf: id => ({ folder: folders[id], spec: splitStore.active && splitStore.spec?.id === id ? splitStore.spec : specs[id] }),
    widgetManifestPath, mountedRef, mountedWidgetRef, pendingMountRef, widgetReadSeqRef: { current: {} }, splitStore, buildMountContent: mountContent,
    recordMountedWidget: (id, raw) => { mountedWidgetRef.current[id] = raw }, persistPendingWidgets() {},
    async fetch(url) {
      const path = new URL(url, 'http://fixture').searchParams.get('path')
      reads.push(path)
      const value = files.get(path)
      return value ? { ok: true, text: typeof value === 'function' ? value : async () => value } : { ok: false }
    },
  }
  const apply = evaluate(section(indexSource, '  const applyWidgetManifest = useCallback(', '\n  // 完成边沿') + '\nexport { applyWidgetManifest }', bindings).applyWidgetManifest
  return { registry, store, specs, folders, splitStore, calls, reads, files, pendingMountRef, mountedWidgetRef, mountedRef, apply }
}
test('actual loader never reads the root legacy file and cannot mount project A in B', async () => {
  const f = mountingFixture(), b = f.registry.begin('A', f.specs.A, f.folders.A, 'S', '窗口1')[0]
  f.files.set('C:/shared/widget-result.json', '{"window":"窗口1","path":"old.html"}')
  f.files.set(widgetManifestPath(b), resultOf(b))
  f.splitStore.spec = f.specs.B
  await f.apply(b, null)
  assert.equal(f.calls.length, 0)
  assert.ok(f.pendingMountRef.current[b.bindingId])
  assert.equal(f.specs.B.top[0].content, null)
  assert.deepEqual(f.reads, [widgetManifestPath(b)])
})
test('actual loader blocks wrong identity and nonexistent window rather than falling back to window1', async () => {
  const f = mountingFixture(), b = f.registry.begin('A', f.specs.A, f.folders.A, 'S', '窗口1')[0]
  await f.apply(b, resultOf(b, { projectId: 'B' }))
  await f.apply(b, resultOf(b, { window: '窗口99' }))
  assert.equal(f.calls.length, 0)
})
test('a next completion reloads the same HTML even when the manifest text is unchanged', async () => {
  const f = mountingFixture(), b = f.registry.begin('A', f.specs.A, f.folders.A, 'S', '窗口1')[0]
  const raw = resultOf(b)
  await f.apply(b, raw)
  const firstTab = f.splitStore.spec.top[0].tabs[0].id
  await f.apply(b, raw)
  assert.equal(f.calls.length, 1)
  await f.apply(b, raw, true)
  assert.equal(f.calls.length, 2)
  assert.notEqual(f.splitStore.spec.top[0].tabs[0].id, firstTab)
})
test('old reads finishing after rebind, directory change or manual replacement cannot overwrite a pane', async () => {
  for (const action of ['rebind', 'folder', 'manual', 'unmount']) {
    const f = mountingFixture(), b = f.registry.begin('A', f.specs.A, f.folders.A, 'S', '窗口1')[0]
    let finish
    const waiting = new Promise(resolve => { finish = resolve })
    f.files.set(widgetManifestPath(b), () => waiting)
    const loading = f.apply(b, null)
    await Promise.resolve()
    if (action === 'rebind') f.registry.begin('A', f.specs.A, f.folders.A, 'S2', '窗口1')
    if (action === 'folder') f.folders.A = 'C:/other'
    if (action === 'manual') f.registry.revokePane('A', b.paneId)
    if (action === 'unmount') f.mountedRef.current = false
    finish(resultOf(b))
    await loading
    assert.equal(f.calls.length, 0, action)
  }
})
test('pending result is revalidated after refresh/move and rejected after manual close', async () => {
  const f = mountingFixture(), b = f.registry.begin('A', f.specs.A, f.folders.A, 'S', '窗口1')[0]
  f.splitStore.active = false
  await f.apply(b, resultOf(b))
  const pending = f.pendingMountRef.current[b.bindingId]
  f.files.set(widgetManifestPath(b), resultOf(b))
  f.splitStore.active = true
  f.splitStore.spec = { ...f.specs.A, top: [f.specs.A.main[0]], main: [f.specs.A.top[0]] }
  await f.apply(pending.binding, null, true)
  assert.equal(f.calls[0][0], 'main')
  f.registry.revokePane('A', 'p1')
  await f.apply(pending.binding, null, true)
  assert.equal(f.calls.length, 1)
})
test('loading legacy project state preserves its saved windows without using old pending', () => {
  const saved = specOf('old')
  saved.top[0].tabs = [{ id: 'old-tab', content: { kind: 'iframe', url: 'old.html' } }]
  const store = storage({ 'dsh.worktable.projects.v1': JSON.stringify({ layouts: [saved], folders: { old: 'C:/shared' } }), 'dsh.worktable.pendingMount.v1': JSON.stringify({ fresh: { content: 'old.html' } }) })
  const load = evaluate(section(indexSource, 'function loadProjects()', '\nconst clamp') + '\nexport { loadProjects }', { localStorage: store, PROJECTS_KEY: 'dsh.worktable.projects.v1', DEFAULT_PROJECTS: {} }).loadProjects
  assert.equal(load().layouts[0].top[0].tabs[0].content.url, 'old.html')
  assert.equal(new WidgetMountRegistry(store).entries().length, 0)
  assert.ok(!indexSource.includes("getItem('dsh.worktable.pendingMount.v1')"))
})
test('real project opening retains failed pending reads and retries on the next open', async () => {
  for (const failure of ['http', 'read']) {
    const f = mountingFixture(), b = f.registry.begin('A', f.specs.A, f.folders.A, 'S', '窗口1')[0]
    f.splitStore.active = false
    await f.apply(b, resultOf(b))
    f.splitStore.open = spec => { f.splitStore.active = true; f.splitStore.spec = spec }
    if (failure === 'read') f.files.set(widgetManifestPath(b), async () => { throw new Error('read failed') })
    const open = evaluate(section(indexSource, '  const openSplit = useCallback(', '\n  /** 打开「工作台」控制室') + '\nexport { openSplit }', {
      useCallback: fn => fn, engineIdsRef: { current: new Set() }, projects: { views: {} }, splitStore: f.splitStore,
      currentSessionOf: () => null, sessionBridge: null, projectAttachRef: {}, projectsRef: { current: { projects: { bindings: {} } } },
      ackProjectNotify() {}, pendingMountRef: f.pendingMountRef, applyWidgetManifest: f.apply, persistPendingWidgets() {},
    }).openSplit
    open(f.specs.A)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.calls.length, 0, failure)
    assert.ok(f.pendingMountRef.current[b.bindingId], failure + ' keeps retry record')
    f.splitStore.active = false
    f.files.set(widgetManifestPath(b), resultOf(b))
    open(f.specs.A)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.calls.length, 1, failure)
    assert.equal(f.pendingMountRef.current[b.bindingId], undefined, failure + ' clears only on success')
  }
})

test('actual startup sweep ignores every unregistered project, even with a legacy result in its folder', async () => {
  const f = mountingFixture()
  f.files.set('C:/shared/widget-result.json', '{"window":"窗口1","path":"old.html","kind":"html"}')
  const effects = []
  evaluate(section(indexSource, '  // 只扫描已明确登记', '\n  /** 收集某会话') + '\nexport {}', {
    useEffect: fn => effects.push(fn), projects: { folders: f.folders }, widgetTick: 0, widgetRegistry: f.registry, applyWidgetManifest: f.apply,
  })
  effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.reads, [])
  assert.equal(f.calls.length, 0)
})
test('actual completion effect processes both projects sharing one session and supports the next round', async () => {
  const f = mountingFixture()
  const aa = f.registry.begin('A', f.specs.A, f.folders.A, 'S', '窗口1')[0]
  const bb = f.registry.begin('B', f.specs.B, f.folders.B, 'S', '窗口1')[0]
  f.files.set(widgetManifestPath(aa), resultOf(aa))
  f.files.set(widgetManifestPath(bb), resultOf(bb))
  const effects = [], snapshot = { snapshot: { byId: { S: { completed: true } } } }
  evaluate(section(indexSource, '  // 完成边沿只触发读取', '\n  // 只扫描已明确登记') + '\nexport {}', {
    useEffect: fn => effects.push(fn), sessionsSnapshotStore: snapshot, widgetRegistry: f.registry, projects: { bindings: { A: 'S', B: 'S' } },
    doneSeenRef: { current: {} }, clearNotifyAck() {}, mountConsumedRef: { current: new Set() }, applyWidgetManifest: f.apply, notifyTick: 0, widgetTick: 0,
  })
  effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.length, 1)
  assert.ok(f.pendingMountRef.current[bb.bindingId])
  const firstTab = f.splitStore.spec.top[0].tabs[0].id
  effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.length, 1)
  snapshot.snapshot.byId.S.completed = false
  effects[0]()
  snapshot.snapshot.byId.S.completed = true
  effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.length, 2)
  assert.notEqual(f.splitStore.spec.top[0].tabs[0].id, firstTab)
})
test('a slower earlier read cannot overwrite a newer result from the same binding', async () => {
  const f = mountingFixture(), b = f.registry.begin('A', f.specs.A, f.folders.A, 'S', '窗口1')[0]
  let finishOld
  f.files.set(widgetManifestPath(b), () => new Promise(resolve => { finishOld = resolve }))
  const oldRead = f.apply(b, null, true)
  await Promise.resolve()
  f.files.set(widgetManifestPath(b), resultOf(b, { path: 'new.html' }))
  await f.apply(b, null, true)
  finishOld(resultOf(b, { path: 'old.html' }))
  await oldRead
  assert.equal(f.calls.length, 1)
  assert.equal(f.splitStore.spec.top[0].tabs[0].content.title, 'new.html')
})
test('completion of one session never reads or reloads another session window in the same project', async () => {
  const f = mountingFixture()
  const first = f.registry.begin('A', f.specs.A, f.folders.A, 'S1', '窗口1')[0]
  f.registry.begin('A', f.specs.A, f.folders.A, 'S2', '窗口2')
  const second = f.registry.entries('A').find(b => b.sessionId === 'S2')
  f.files.set(widgetManifestPath(first), resultOf(first))
  f.files.set(widgetManifestPath(second), resultOf(second))
  await f.apply(first, resultOf(first))
  const firstTab = f.splitStore.spec.top[0].tabs[0].id
  const effects = [], snapshot = { snapshot: { byId: { S1: { completed: false }, S2: { completed: true } } } }
  evaluate(section(indexSource, '  // 完成边沿只触发读取', '\n  // 只扫描已明确登记') + '\nexport {}', {
    useEffect: fn => effects.push(fn), sessionsSnapshotStore: snapshot, widgetRegistry: f.registry, projects: { bindings: { A: 'S2' } },
    doneSeenRef: { current: {} }, clearNotifyAck() {}, mountConsumedRef: { current: new Set() }, applyWidgetManifest: f.apply, notifyTick: 0, widgetTick: 0,
  })
  effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.reads, [widgetManifestPath(second)])
  assert.equal(f.splitStore.spec.top[0].tabs[0].id, firstTab)
  assert.equal(f.calls.length, 2)
  snapshot.snapshot.byId.S1.completed = true
  effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.length, 3)
  assert.notEqual(f.splitStore.spec.top[0].tabs[0].id, firstTab)
})
test('real closeTab revokes ownership before saving the empty window', async () => {
  const f = mountingFixture(), b = f.registry.begin('A', f.specs.A, f.folders.A, 'S', '窗口1')[0]
  await f.apply(b, resultOf(b))
  const method = evaluate('const close = { ' + section(splitSource, '  closeTab(row, i, tabId) {', '\n  moveTab(') + ' }; export { close }').close.closeTab
  f.splitStore.onPaneContentEdited = (id, paneId) => f.registry.revokePane(id, paneId)
  method.call(f.splitStore, 'top', 0, f.splitStore.spec.top[0].tabs[0].id)
  assert.equal(f.splitStore.spec.top[0].tabs.length, 0)
  await f.apply(b, resultOf(b), true)
  assert.equal(f.calls.length, 1)
})
test('actual new-layout builder keeps both projects empty and independently identified', () => {
  const build = evaluate(section(indexSource, 'function buildLayout(', '\n/** 布局缩略图') + '\nexport { buildLayout }', {
    PRESET_DEFS: [{ id: 'grid', leftCount: 0, topCount: 2, contentCount: 1 }], newWidgetId,
  }).buildLayout
  const a = build('grid', 'A'), b = build('grid', 'B')
  assert.notEqual(a.id, b.id)
  a.top[0].content = { kind: 'iframe', url: 'old.html' }
  assert.equal(b.top[0].content, null)
  assert.equal(b.main[0].content, null)
})
test('actual task prompt uses only this project binding paths and preserves follow-up instructions', () => {
  const { registry } = registryFixture(), spec = specOf('A')
  const owned = registry.begin('A', spec, 'C:/shared', 'S', '窗口1')
  registry.begin('B', specOf('B'), 'C:/shared', 'S', '窗口1')
  const build = evaluate(section(indexSource, 'function buildWindowTaskText(', '\n/** 自定义窗口任务') + '\nexport { buildWindowTaskText }', { KNOWLEDGE_PACK: 'generic knowledge', widgetManifestPath }).buildWindowTaskText
  const prompt = build('A', '项目 A', '窗口1', 'new widget', 'C:/shared', 'send', owned)
  for (const b of owned) assert.ok(prompt.includes(widgetManifestPath(b)))
  assert.ok(prompt.includes('继续修改同名作品'))
  assert.ok(!prompt.includes('project-B'))
  assert.ok(prompt.includes('不读写项目根目录旧的 widget-result.json'))
})
