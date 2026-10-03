import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const require = createRequire(new URL('../01_content/package.json', import.meta.url))
const { buildSync, transformSync } = require('esbuild')
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../01_content/src/client/sessionDetails.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
const module = { exports: {} }
runInNewContext(code, { module, exports: module.exports })
const { cleanPreviewText, previewFromEvents, readSessionPreview, presetApiOf, modelApiOf, createHostSession, blankSessionNeedsWorkspace } = module.exports
const msg = (text, type = 'assistant/message') => ({ type: 'event', event: { type, data: { content: [{ type: 'text', text }] } } })

test('preview filters code and joins final text blocks, without mutating events', () => {
  const entries = [msg('old text message'), { event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Latest final' }, { type: 'text', text: 'answer here' }] } } } }]
  const before = JSON.stringify(entries)
  assert.equal(previewFromEvents(entries), 'Latest final answer here')
  assert.equal(JSON.stringify(entries), before)
  assert.equal(cleanPreviewText('before ```js\ncode\n``` after `inline`'), 'before after')
})
test('reasoning, tools and transient chunks never become a preview', () => {
  const entries = [msg('A readable earlier message'), { event: { type: 'assistant/message', data: { content: [{ type: 'reasoning', text: 'private reasoning' }] } } }, msg('tool argument', 'tool/call'), msg('stream token', 'assistant/live-chunk')]
  assert.equal(previewFromEvents(entries), 'A readable earlier message')
})
test('short/code-only latest message falls back, malformed input stays empty, length bounded', () => {
  assert.equal(previewFromEvents([msg('Earlier readable message'), msg('```js\ncode\n```')]), 'Earlier readable message')
  assert.equal(previewFromEvents(null), '')
  assert.equal(previewFromEvents([{ event: { type: 'user/message', data: { content: 'not blocks' } } }]), '')
  assert.equal(previewFromEvents([msg('x'.repeat(300))]).length, 220)
})
function held(binding, action) {
  const calls = []
  let active = false
  const sessions = { async using(id, options, fn) {
    calls.push(['retain', id, options.source])
    active = true
    try { return await fn({ ready: action ? action() : Promise.resolve(binding) }) }
    finally { active = false; calls.push(['release', id]) }
  } }
  return { sessions, calls, active: () => active }
}
test('cold preview uses retained final event window and releases it', async () => {
  const f = held({ eventSource: { getSnapshot() { assert.equal(f.active(), true); return { entries: [msg('Cold session final message')] } } } })
  assert.equal(await readSessionPreview(f.sessions, 'cold'), 'Cold session final message')
  assert.deepEqual(f.calls, [['retain', 'cold', 'dshWorktablePreview'], ['release', 'cold']])
})
test('preview acquisition failure releases and rejects instead of returning stale data', async () => {
  const f = held(null, () => Promise.reject(new Error('offline')))
  await assert.rejects(readSessionPreview(f.sessions, 'cold'), /offline/)
  assert.equal(f.active(), false)
  assert.equal(f.calls.at(-1)[0], 'release')
})
test('empty new session stays empty without legacy private history calls', async () => {
  const f = held({ eventSource: { getSnapshot: () => ({ entries: [] }) }, session: { history() { assert.fail('new host must not use private history') } } })
  assert.equal(await readSessionPreview(f.sessions, 'blank'), '')
})
test('legacy preview uses bounded history with the correct receiver', async () => {
  const face = { async history(opts) { assert.equal(this, face); assert.equal(opts.maxMessages, 6); return { result: { value: { events: [msg('Legacy message preview')] } } } } }
  assert.equal(await readSessionPreview({ binding: () => ({ session: face }) }, 'old'), 'Legacy message preview')
})
test('preset bridge converts new method arguments and envelope, does not mask failures', async () => {
  const calls = []
  const remote = { async list(...args) { assert.equal(this, remote); assert.equal(args.length, 0); return { ok: true, value: { presets: [] } } }, async select(id, preset) { calls.push([id, preset]); return { ok: false, error: { message: 'not blank' } } } }
  const api = presetApiOf({ get: name => { assert.equal(name, 'remote.agentPresets'); return remote } }, null)
  assert.equal((await api.list({})).result.ok, true)
  assert.equal((await api.select({ sessionId: 's', agentPreset: 'p' })).result.error.message, 'not blank')
  assert.deepEqual(calls, [['s', 'p']])
})
test('legacy model and preset APIs keep their exact identity', () => {
  const old = {}
  assert.equal(presetApiOf({}, old), old)
  assert.equal(modelApiOf({}, {}, old), old)
})
test('uninjected optional services in a Cordis-style context safely fall back', () => {
  const context = new Proxy({ get: () => undefined }, {
    get(target, key) {
      if (key in target) return target[key]
      throw new Error('cannot get property without inject: ' + String(key))
    },
  })
  const old = {}
  assert.equal(presetApiOf(context, old), old)
  assert.equal(modelApiOf(context, { using() {} }, old), old)
})
test('legacy model selection does not probe new services before the capability guard', () => {
  const context = new Proxy({}, { get() { assert.fail('legacy model API must not probe new services') } })
  const old = {}
  assert.equal(modelApiOf(context, {}, old), old)
})
test('model read/select hold a scope and preserve reasoning selection', async () => {
  const f = held({})
  const state = { current: { provider: 'p', model: 'm', reasoningEffort: 'high' }, routable: true, groups: [] }
  const directory = { async load() { assert.equal(f.active(), true); return state }, async select(selection) { assert.equal(f.active(), true); assert.deepEqual({ ...selection }, { provider: 'p', model: 'm', reasoningEffort: 'high' }); return { ok: true, value: undefined } } }
  const resolver = { directoryFor(id) { assert.equal(this, resolver); assert.equal(id, 's'); assert.equal(f.active(), true); return directory } }
  const api = modelApiOf({ modelDirectories: resolver }, f.sessions, null)
  assert.equal((await api.models({ sessionId: 's' })).result.value, state)
  assert.equal((await api.selectModel({ sessionId: 's', ...state.current })).result.ok, true)
  assert.equal(f.active(), false)
  assert.equal(f.calls.length, 4)
})
test('model lookup failure releases its reference and is not hidden by legacy fallback', async () => {
  const f = held({})
  const api = modelApiOf({ modelDirectories: { directoryFor() { throw new Error('directory disposed') } } }, f.sessions, { models() { assert.fail('no retry via legacy') } })
  await assert.rejects(api.models({ sessionId: 's' }), /directory disposed/)
  assert.equal(f.active(), false)
})

test('new host registers project path before creating a workspace-attached session', async () => {
  const calls = []
  const opts = { cwd: 'C:/test/project', sessionId: 'preallocated' }
  const sessions = { using() {}, async create(value) { calls.push(['session', { ...value }]); return 's' } }
  const ws = { async create(value) { assert.equal(this, ws); calls.push(['workspace', { ...value }]); return { workspaceId: 'ws' } } }
  assert.equal(await createHostSession(sessions, ws, opts), 's')
  assert.deepEqual(calls, [['workspace', { path: 'C:/test/project' }], ['session', { sessionId: 'preallocated', workspaceId: 'ws' }]])
  assert.deepEqual(opts, { cwd: 'C:/test/project', sessionId: 'preallocated' })
})
test('new host without project path uses official default workspace, never guesses cwd', async () => {
  let initialized = false
  const ws = { async initializeDefault() { assert.equal(this, ws); initialized = true; return { workspaceId: 'default' } } }
  const sessions = { using() {}, async create(value) { assert.equal(initialized, true); assert.deepEqual({ ...value }, { workspaceId: 'default' }); return 's' } }
  assert.equal(await createHostSession(sessions, ws), 's')
})
test('explicit workspace and legacy cwd keep existing creation behavior', async () => {
  const opts = { workspaceId: 'selected' }
  const modern = { using() {}, async create(value) { assert.equal(value, opts); return 'modern' } }
  assert.equal(await createHostSession(modern, { create() { assert.fail('no extra registration') } }, opts), 'modern')
  const oldOpts = { cwd: 'C:/old' }
  const legacy = { async create(value) { assert.equal(value, oldOpts); return 'legacy' } }
  assert.equal(await createHostSession(legacy, null, oldOpts), 'legacy')
})
test('failed or unavailable workspace must not create an orphan blank session', async () => {
  const sessions = { using() {}, create() { assert.fail('must not create orphan') } }
  await assert.rejects(createHostSession(sessions, { async create() { throw new Error('invalid directory') } }, { cwd: 'C:/missing' }), /invalid directory/)
  await assert.rejects(createHostSession(sessions, { async create() { return {} } }, { cwd: 'C:/path' }), /workspace unavailable/)
  await assert.rejects(createHostSession(sessions, null), /workspace unavailable/)
  await assert.rejects(createHostSession(sessions, { async initializeDefault() { return undefined } }), /workspace unavailable/)
})
test('session creation failure is propagated without a second create attempt', async () => {
  let calls = 0
  const sessions = { using() {}, async create() { calls++; throw new Error('workspace attach failed') } }
  await assert.rejects(createHostSession(sessions, { async create() { return { workspaceId: 'ws' } } }, { cwd: 'C:/path' }), /workspace attach failed/)
  assert.equal(calls, 1)
})

test('explicit Ungrouped preserves project cwd and does not create or reuse a workspace', async () => {
  const options = { cwd: 'C:/fixture/Projects', sessionId: 'ungrouped' }
  const sessions = { using() {}, async create(value) { assert.equal(value, options); return 's' } }
  const workspaces = new Proxy({}, { get() { assert.fail('Ungrouped must not inspect workspace services') } })
  assert.equal(await createHostSession(sessions, workspaces, options, 'none'), 's')
  assert.deepEqual(options, { cwd: 'C:/fixture/Projects', sessionId: 'ungrouped' })
})

test('Ungrouped without a project directory does not initialize the default workspace', async () => {
  const sessions = { using() {}, async create(options) { assert.deepEqual({ ...options }, {}); return 's' } }
  assert.equal(await createHostSession(sessions, null, {}, 'none'), 's')
})

test('legacy Ungrouped preserves cwd and grouping is never sent as a host API parameter', async () => {
  const sessions = { async create(options) { assert.deepEqual({ ...options }, { cwd: '/fixture/project' }); return 's' } }
  assert.equal(await createHostSession(sessions, null, { cwd: '/fixture/project' }, 'none'), 's')
})

test('contradictory Ungrouped plus workspace and failed Ungrouped creation do not regroup or retry', async () => {
  let calls = 0
  const sessions = { using() {}, async create() { calls++; throw new Error('create refused') } }
  await assert.rejects(createHostSession(sessions, null, { workspaceId: 'ws' }, 'none'), /ungrouped session cannot/)
  assert.equal(calls, 0)
  await assert.rejects(createHostSession(sessions, null, { cwd: '/fixture' }, 'none'), /create refused/)
  assert.equal(calls, 1)
})

const indexSource = readFileSync(new URL('../01_content/src/client/index.tsx', import.meta.url), 'utf8')
function sourceFunction(source, startText, endText, name, bindings) {
  source = source.replace(/\r\n/g, '\n')
  const start = source.indexOf(startText)
  assert.ok(start >= 0)
  const end = source.indexOf(endText, start)
  assert.ok(end > start)
  const code = transformSync(source.slice(start, endText === '\n}\n' ? end + 2 : end).replace(/^export /, '') + '\nexport { ' + name + ' }', { loader: 'tsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' }).code
  const module = { exports: {} }
  runInNewContext(code, { module, exports: module.exports, ...bindings })
  return module.exports[name]
}

test('actual custom-window creation forwards Ungrouped and project cwd through the host helper', async () => {
  const calls = []
  const create = sourceFunction(indexSource, 'export async function createCustomSession(', '\n/** 把自定义需求', 'createCustomSession', {
    sessionBridge: { sessions: { using() {}, async create(opts) { calls.push({ ...opts }); return 'synthetic' } }, workspaces: new Proxy({}, { get() { assert.fail('no workspace for explicit Ungrouped') } }) },
    createHostSession, prepareWidgetTask: () => [], buildWindowTaskText: () => 'synthetic task', ensureSessionPreset: async () => {}, ensureSessionModel: async () => {},
    markPluginSessionOpen: () => {}, clientCtx: {}, openHostSession: async () => {}, promptIntoSession: async () => {},
  })
  await create('p', 'project', 'synthetic', { kind: 'none' }, '', 'C:/fixture/Projects')
  assert.deepEqual(calls, [{ cwd: 'C:/fixture/Projects' }])
})

test('blank-session restriction only applies to explicit Ungrouped on the retained-scope host', () => {
  assert.equal(blankSessionNeedsWorkspace({ using() {} }, 'none'), true)
  assert.equal(blankSessionNeedsWorkspace({ using() {} }, 'auto'), false)
  assert.equal(blankSessionNeedsWorkspace({}, 'none'), false)
  assert.equal(blankSessionNeedsWorkspace(null, 'none'), false)
})

function controlRoomFixture({ modern = true, mode = 'none', workspaceId = '' } = {}) {
  const calls = [], effects = [], errors = []
  const sessions = { async create(options) { calls.push({ ...options }); return 'synthetic' } }
  if (modern) sessions.using = () => {}
  const create = sourceFunction(indexSource, '  const bindConsoleNew = async () => {', '\n  actionsRef.current', 'bindConsoleNew', {
    sessionBridge: { sessions, workspaces: new Proxy({}, { get() { assert.fail('must not silently register a workspace') } }) },
    createHostSession, blankSessionNeedsWorkspace, consoleMode: mode, consoleWsId: workspaceId, consoleParent: '', consoleName: '', CONSOLE_ID: 'wt-console',
    projectsRef: { current: { projects: { folders: {} } } }, setConsoleBusy: (value) => effects.push(['busy', value]), setConsoleErr: (value) => errors.push(value),
    ensureSessionPreset: async () => effects.push('preset'), ensureSessionModel: async () => effects.push('model'), markPluginSessionOpen: () => effects.push('mark'),
    persistProjects: () => effects.push('bind'), setConsoleBind: () => effects.push('close'), openConsole: () => effects.push('open'),
  })
  return { create, calls, effects, errors }
}

test('actual control-room handler rejects a modern blank Ungrouped session before any side effects', async () => {
  const f = controlRoomFixture()
  await f.create()
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.effects, [])
  assert.deepEqual(f.errors, [])
})

test('actual control-room handler preserves legacy Ungrouped creation', async () => {
  const f = controlRoomFixture({ modern: false })
  await f.create()
  assert.deepEqual(f.calls, [{}])
  assert.ok(f.effects.includes('open'))
  assert.deepEqual(f.errors, [false])
})

test('actual control-room handler preserves the explicitly chosen modern workspace', async () => {
  const f = controlRoomFixture({ mode: 'existing', workspaceId: 'chosen-workspace' })
  await f.create()
  assert.deepEqual(f.calls, [{ workspaceId: 'chosen-workspace' }])
  assert.ok(f.effects.includes('bind'))
  assert.ok(f.effects.includes('open'))
  assert.deepEqual(f.errors, [false])
})

test('actual control-room handler rejects an empty existing-group selection rather than defaulting', async () => {
  for (const modern of [true, false]) {
    const f = controlRoomFixture({ modern, mode: 'existing' })
    await f.create()
    assert.deepEqual(f.calls, [])
    assert.deepEqual(f.effects, [])
    assert.deepEqual(f.errors, [true])
  }
})

test('actual control-room JSX exposes the restriction, disables creation and includes an empty group option', () => {
  const source = indexSource.replace(/\r\n/g, '\n')
  const start = source.indexOf('<div className="dsh-wt_consoleBindCol dsh-wt_consoleBindColNew">')
  const end = source.indexOf('\n          </div>\n        </div>\n      )}', start)
  assert.ok(start >= 0 && end > start)
  const code = transformSync('export const render = () => (' + source.slice(start, end) + ')', { loader: 'tsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' }).code
  const h = (type, props, ...children) => ({ type, props: { ...props, children } })
  const find = (node, match) => {
    if (!node || typeof node !== 'object') return null
    if (match(node)) return node
    for (const child of Array.isArray(node) ? node : node.props?.children ?? []) {
      const found = find(child, match)
      if (found) return found
    }
    return null
  }
  for (const [modern, mode, workspaceId, blocked] of [[true, 'none', '', true], [false, 'none', '', false], [true, 'existing', '', true], [true, 'existing', 'chosen', false]]) {
    const sessions = modern ? { using() {} } : {}
    const consoleNeedsWorkspace = sourceFunction(source, '  const consoleNeedsWorkspace =', '\n\n', 'consoleNeedsWorkspace', { sessionBridge: { sessions }, consoleMode: mode, blankSessionNeedsWorkspace })
    const module = { exports: {} }
    runInNewContext(code, { module, exports: module.exports, h, Fragment: Symbol('fragment'), t: key => key,
      consoleMode: mode, consoleWsId: workspaceId, consoleNeedsWorkspace, consoleBusy: false, consoleErr: false,
      consoleParent: '', consoleName: '', listWorkspaces: () => [{ id: 'chosen', title: 'fixture' }], bindConsoleNew: () => {},
      setConsoleMode: () => {}, setConsoleWsId: () => {}, setConsoleParent: () => {}, setConsoleName: () => {},
    })
    const tree = module.exports.render()
    assert.equal(find(tree, node => node.props?.className === 'dsh-wt_consoleCreateBtn').props.disabled, blocked)
    assert.equal(Boolean(find(tree, node => node.props?.className === 'dsh-wt_consoleHint')), modern && mode === 'none')
    if (mode === 'existing') assert.ok(find(tree, node => node.type === 'option' && node.props.value === '' && node.props.children.includes('console.chooseGroup')))
  }
})

test('actual group picker ignores a delayed default after the user explicitly selects Ungrouped', async () => {
  const source = readFileSync(new URL('../01_content/src/client/split.tsx', import.meta.url), 'utf8')
  let resolveGroups
  const groupPromise = new Promise((resolve) => { resolveGroups = resolve })
  const states = [], refs = [], effects = []
  let stateIndex = 0, refIndex = 0, initial = true
  const SelectPop = () => {}
  const h = (type, props, ...children) => ({ type, props: { ...props, children } })
  const custom = { getProjects: () => [{ id: 'p', name: 'project' }], currentProjectId: () => 'p', getWorkspaces: () => [{ id: 'ws', title: 'Projects', sessionIds: ['current'] }], getSessions: () => groupPromise }
  const pane = sourceFunction(source, 'function CustomPane(', '\n}\n', 'CustomPane', {
    window: {}, splitEnv: { custom }, SelectPop, h, Fragment: Symbol('fragment'), T: (key) => key,
    useState(value) {
      const index = stateIndex++
      if (!(index in states)) states[index] = typeof value === 'function' ? value() : value
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useRef(value) { const index = refIndex++; return refs[index] ??= { current: value } },
    useEffect(fn) { if (initial) effects.push(fn) },
  })
  const render = () => { stateIndex = 0; refIndex = 0; return pane({}) }
  const pickerIn = (node) => {
    if (!node || typeof node !== 'object') return null
    if (node.type === SelectPop && node.props.placeholder === 'custom.group') return node
    for (const child of Array.isArray(node) ? node : node.props?.children ?? []) {
      const picker = pickerIn(child)
      if (picker) return picker
    }
    return null
  }
  render(); initial = false
  effects.forEach((fn) => fn())
  states[3] = 'new'
  pickerIn(render()).props.onChange('__none')
  resolveGroups({ groups: [{ title: 'Projects', sessions: [{ id: 'current', title: 'current', isCurrent: true }] }] })
  await groupPromise
  await Promise.resolve()
  assert.equal(pickerIn(render()).props.value, '__none')
})
