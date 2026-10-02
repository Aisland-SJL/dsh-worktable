import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../01_content/package.json', import.meta.url))
const { buildSync } = require('esbuild')
const compiled = buildSync({ entryPoints: [fileURLToPath(new URL('../01_content/src/client/hostInput.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
class Textarea {
  value = '原草稿'
  events = []
  closest() { return null }
  dispatchEvent(e) { this.events.push(e.type) }
  focus() {}
  setSelectionRange() {}
}
const module = { exports: {} }
runInNewContext(compiled, { module, exports: module.exports, HTMLTextAreaElement: Textarea, Event })
const { appendHostInput } = module.exports
const compatModule = { exports: {} }
const compatCode = buildSync({ entryPoints: [fileURLToPath(new URL('../01_content/src/client/sessionCompat.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
runInNewContext(compatCode, { module: compatModule, exports: compatModule.exports })
const { currentSessionOf, openHostSession } = compatModule.exports
const noDom = { querySelector() { throw new Error('modern input must not touch DOM') } }
function fixture(patch = {}) {
  const calls = []
  const state = { draft: '', draftRev: 4, phase: 'plain', occurrences: [], ...patch }
  const input = { state: { getSnapshot: () => state }, actions: { insertText: (text, span) => { calls.push({ text, span: { ...span } }); return true } }, focus() {}, submit() { assert.fail('must not send') }, setDraft() { assert.fail('must not replace draft/chips') } }
  const scope = { bail: (event, request) => { calls.push({ event, ...request }); return true } }
  const bridge = { sessions: { list: { getSnapshot: () => ({ byId: { selected: { id: 'session-1', retainedBy: { mainView: 1 } } } }) }, scope: id => { assert.equal(id, 'session-1'); return scope } }, conversation: { input: { for: ctx => { assert.equal(ctx, scope); return input } } } }
  return { bridge, input, calls, state }
}
test('new host: empty input receives annotation, never submit', () => {
  const f = fixture()
  assert.equal(appendHostInput(f.bridge, '标注', noDom), true)
  assert.deepEqual(f.calls, [{ text: '标注', span: { start: 0, end: 0, draftRev: 4 } }])
})
test('new host: resolve current by mainView, not sidebar or catalog order', () => {
  const f = fixture()
  f.bridge.sessions.list.getSnapshot = () => ({ byId: { other: { id: 'other', retainedBy: { sidebarView: 1 } }, selected: { id: 'session-1', retainedBy: { mainView: 1 } } } })
  assert.equal(appendHostInput(f.bridge, '标注', noDom), true)
  assert.equal(currentSessionOf({ byId: { x: { id: 'x', retainedBy: { sidebarView: 1 } } } }), '')
})
test('legacy empty current stays empty; never guess another session', () => {
  assert.equal(currentSessionOf({ current: '', byId: { x: { id: 'x', retainedBy: { mainView: 1 } } } }), '')
  assert.equal(currentSessionOf({ current: 'old-session' }), 'old-session')
})
test('navigation uses new UI service with legacy fallback, preserving method receiver', () => {
  const calls = []
  const ui = { openSession(id) { assert.equal(this, ui); calls.push(id) } }
  const old = { open(id) { assert.equal(this, old); calls.push(id) } }
  openHostSession({ get: () => ui }, old, 'new')
  openHostSession({}, old, 'old')
  assert.deepEqual(calls, ['new', 'old'])
  assert.throws(() => openHostSession({}, {}, 'missing'), /navigation unavailable/)
})
test('missing new service in a Cordis-style context reaches legacy navigation', () => {
  const context = new Proxy({ get: () => undefined }, {
    get(target, key) {
      if (key in target) return target[key]
      throw new Error('cannot get property without inject: ' + String(key))
    },
  })
  const old = { open(id) { assert.equal(this, old); return id } }
  assert.equal(openHostSession(context, old, 'legacy-session'), 'legacy-session')
})
test('new host: append instead of replacing an existing draft', () => {
  const f = fixture({ draft: '原草稿' })
  assert.equal(appendHostInput(f.bridge, '标注', noDom), true)
  assert.deepEqual(f.calls, [{ text: '\n\n标注', span: { start: 3, end: 3, draftRev: 4 } }])
})
test('reference chip projection: append without flattening or truncating chips', () => {
  const f = fixture({ draft: '@abc 后文', occurrences: [{ offset: 0, length: 4 }] })
  assert.equal(appendHostInput(f.bridge, '标注', noDom), true)
  assert.equal(f.calls[0].span.start, 4)
})
test('legacy input resolver appends after display-text references without cutting them', () => {
  const f = fixture({ draft: 'ABCDEFG tail', occurrences: [{ offset: 0, length: 7 }] })
  f.bridge.sessions.list.getSnapshot = () => ({ current: 'session-1' })
  delete f.input.actions
  assert.equal(appendHostInput(f.bridge, 'ANNOTATION', noDom), true)
  assert.equal(f.calls[0].span.start, f.state.draft.length)
  const { text, span } = f.calls[0]
  const next = f.state.draft.slice(0, span.start) + text + f.state.draft.slice(span.end)
  assert.equal(next, 'ABCDEFG tail\n\nANNOTATION')
  assert.deepEqual(f.state.occurrences, [{ offset: 0, length: 7 }])
})
test('new host scoped-event fallback still uses compact reference coordinates', () => {
  const f = fixture({ draft: 'ABCDEFG tail', occurrences: [{ offset: 0, length: 7 }] })
  delete f.input.actions
  assert.equal(appendHostInput(f.bridge, 'ANNOTATION', noDom), true)
  assert.equal(f.calls[0].span.start, 6)
  assert.equal(f.calls[0].span.end, 6)
  assert.equal(f.calls[0].span.draftRev, 4)
})
test('frozen input refuses edits', () => {
  for (const phase of ['submitting', 'adjudicating']) {
    const f = fixture({ phase })
    assert.equal(appendHostInput(f.bridge, '标注', noDom), false)
    assert.equal(f.calls.length, 0)
  }
})
test('missing scope / rejected revision do not fall through to arbitrary textarea', () => {
  const f = fixture()
  f.bridge.sessions.scope = () => undefined
  assert.equal(appendHostInput(f.bridge, '标注', noDom), false)
  const g = fixture()
  g.input.actions.insertText = () => false
  assert.equal(appendHostInput(g.bridge, '标注', noDom), false)
})
test('scoped event compatibility path retains revision guard', () => {
  const f = fixture()
  delete f.input.actions
  assert.equal(appendHostInput(f.bridge, '标注', noDom), true)
  assert.equal(f.calls[0].event, 'slash/input-insert-text')
  assert.equal(f.calls[0].span.draftRev, 4)
})
test('focus failure after insertion must not cause duplicate fallback', () => {
  const f = fixture()
  f.input.focus = () => { throw new Error('unmounted') }
  assert.equal(appendHostInput(f.bridge, '标注', noDom), true)
  assert.equal(f.calls.length, 1)
})
test('malformed chip projection fails closed', () => {
  const f = fixture({ draft: 'abc', occurrences: [{ offset: 0, length: 8 }] })
  assert.equal(appendHostInput(f.bridge, '标注', noDom), false)
  assert.equal(f.calls.length, 0)
})
test('legacy textarea appends and dispatches input, never selects annotation editor', () => {
  const ta = new Textarea()
  const doc = { querySelector: selector => { assert.equal(selector, 'textarea[data-phase]'); return ta } }
  assert.equal(appendHostInput(null, '标注', doc), true)
  assert.equal(ta.value, '原草稿\n\n标注')
  assert.deepEqual(ta.events, ['input', 'change'])
  ta.closest = () => ({})
  assert.equal(appendHostInput(null, '不可写', doc), false)
  assert.equal(appendHostInput(null, '不可写', { querySelector: () => null }), false)
})
