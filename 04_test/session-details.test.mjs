import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../01_content/package.json', import.meta.url))
const { buildSync } = require('esbuild')
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../01_content/src/client/sessionDetails.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
const module = { exports: {} }
runInNewContext(code, { module, exports: module.exports })
const { cleanPreviewText, previewFromEvents, readSessionPreview, presetApiOf, modelApiOf, createHostSession } = module.exports
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
