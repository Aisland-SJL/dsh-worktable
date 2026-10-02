import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../01_content/package.json', import.meta.url))
const { buildSync } = require('esbuild')
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../01_content/src/client/sessionCompat.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
const module = { exports: {} }
runInNewContext(code, { module, exports: module.exports, setTimeout })
const { createSessionSnapshotAdapter, sendHostSession, childSessionIdsOf, pendingAckOf, sessionRuntimeMs } = module.exports
const list = (running = false) => ({ phase: 'ready', ids: ['a'], byId: { a: { id: 'a', running, retainedBy: { mainView: 1 } } }, projectionsBySession: {} })
const source = (patch = {}) => ({ getSnapshot: () => new Map([['a', { running: false, pendingInteraction: undefined, completionUnread: false, ...patch }]]) })

test('legacy snapshots are passed through unchanged', () => {
  const snapshot = { current: 'a', byId: { a: { completed: true, pendingInteraction: { key: 'x' } } } }
  assert.equal(createSessionSnapshotAdapter()(snapshot, source()), snapshot)
})
test('new idle baseline is not a completion; never mutates host data', () => {
  const snapshot = list()
  Object.freeze(snapshot.byId.a)
  Object.freeze(snapshot.byId)
  const result = createSessionSnapshotAdapter()(snapshot, source())
  assert.equal(result.byId.a.completed, false)
  assert.equal(snapshot.byId.a.completed, undefined)
  assert.notEqual(result.byId, snapshot.byId)
})
test('active view run-stop survives unread reset and repeated refreshes, resets on next run', () => {
  const adapt = createSessionSnapshotAdapter()
  assert.equal(adapt(list(true), source({ running: true })).byId.a.completed, false)
  assert.equal(adapt(list(), source()).byId.a.completed, true)
  assert.equal(adapt(list(), source()).byId.a.completed, true)
  assert.equal(adapt(list(true), source({ running: true })).byId.a.completed, false)
})
test('background unread is visible; pending cleared by authoritative status', () => {
  const adapt = createSessionSnapshotAdapter()
  const snapshot = list()
  snapshot.byId.a.pendingInteraction = { key: 'stale' }
  assert.equal(adapt(snapshot, source({ completionUnread: true })).byId.a.completed, true)
  assert.equal(adapt(snapshot, source()).byId.a.pendingInteraction, undefined)
  const pending = { key: 'approval-2', kind: 'approval', sessionId: 'a' }
  assert.equal(adapt(snapshot, source({ pendingInteraction: pending })).byId.a.pendingInteraction, pending)
})
test('new child catalog is exposed for existing parent/child aggregation', () => {
  const snapshot = list()
  const children = [{ id: 'child' }]
  snapshot.projectionsBySession.a = { values: { subagentCatalog: children } }
  const result = createSessionSnapshotAdapter()(snapshot)
  assert.equal(result.subagentsByParent.a, children)
  assert.equal(snapshot.subagentsByParent, undefined)
})
test('ready removal clears run memory; transient pending list does not', () => {
  const adapt = createSessionSnapshotAdapter()
  adapt(list(true))
  adapt({ phase: 'pending', byId: {} })
  assert.equal(adapt(list()).byId.a.completed, true)
  adapt({ phase: 'ready', byId: {} })
  assert.equal(adapt(list()).byId.a.completed, false)
})
function sendFixture(outcome = { kind: 'success' }) {
  const calls = []
  const face = { prompt() { assert.fail('must not resend through prompt') } }
  let retained = false
  const bridge = {
    sessions: {
      async using(id, options, action) {
        assert.equal(id, 'cold')
        assert.equal(options.source, 'dshWorktable')
        retained = true
        calls.push('retain')
        try { return await action({ ready: Promise.resolve({ session: face }) }) }
        finally { retained = false; calls.push('release') }
      },
      binding() { assert.fail('cold binding must not be borrowed') },
      scope() { assert.fail('must not retry via scoped send') },
    },
    conversation: { async sendSession(session, text, attachments, mode) {
      assert.equal(retained, true)
      assert.equal(session, face)
      assert.equal(text, 'task')
      assert.equal(attachments.length, 0)
      assert.equal(mode, 'queue')
      calls.push('send')
      if (outcome instanceof Error) throw outcome
      return outcome
    } },
  }
  return { bridge, calls }
}
test('cold new session retained until successful send settles', async () => {
  const f = sendFixture()
  await sendHostSession(f.bridge, 'cold', 'task')
  assert.deepEqual(f.calls, ['retain', 'send', 'release'])
})
test('resolved business error is surfaced; retained reference released without second send', async () => {
  const f = sendFixture({ kind: 'error', text: 'model unavailable' })
  await assert.rejects(sendHostSession(f.bridge, 'cold', 'task'), /model unavailable/)
  assert.deepEqual(f.calls, ['retain', 'send', 'release'])
})
test('transport rejection does not resend an ambiguously accepted request', async () => {
  const f = sendFixture(new Error('connection lost'))
  await assert.rejects(sendHostSession(f.bridge, 'cold', 'task'), /connection lost/)
  assert.deepEqual(f.calls, ['retain', 'send', 'release'])
})
test('legacy sendSession void return remains supported, method receiver preserved', async () => {
  const face = {}
  const conversation = { async sendSession(session) { assert.equal(this, conversation); assert.equal(session, face) } }
  await sendHostSession({ sessions: { binding: () => ({ session: face }) }, conversation }, 'old', 'task')
})
test('legacy prompt fallback is selected only when wrapper absent and checks rejection', async () => {
  const face = { async prompt() { assert.equal(this, face); return { ok: false, error: { code: 'rejected' } } } }
  await assert.rejects(sendHostSession({ sessions: { binding: () => ({ session: face }) } }, 'old', 'task'), /rejected/)
})

const question = (key, kind = 'approval') => ({ key, kind, text: 'PRIVATE QUESTION', answers: ['PRIVATE ANSWER'] })
test('pending acknowledgement distinguishes direct replacement A → B without a false interval', () => {
  const snapshot = list(true)
  snapshot.byId.a.pendingInteraction = question('A')
  const acknowledged = pendingAckOf(snapshot, 'a')
  assert.ok(acknowledged.startsWith('need:'))
  assert.equal(pendingAckOf(snapshot, 'a'), acknowledged)
  // Persist/reload acknowledgement for the same opaque identity, not just true/false.
  assert.equal(JSON.parse(JSON.stringify({ a: acknowledged })).a, pendingAckOf(snapshot, 'a'))
  snapshot.byId.a.pendingInteraction = question('B')
  assert.notEqual(pendingAckOf(snapshot, 'a'), acknowledged)
  assert.ok(!acknowledged.includes('PRIVATE'))
})
test('pending identity includes kind/session and old generic need cannot suppress a keyed question', () => {
  const snapshot = list()
  snapshot.byId.a.pendingInteraction = question('same', 'approval')
  const first = pendingAckOf(snapshot, 'a')
  assert.notEqual(first, 'need')
  snapshot.byId.a.pendingInteraction = question('same', 'question')
  assert.notEqual(pendingAckOf(snapshot, 'a'), first)
  const child = { ...snapshot, byId: { a: {}, child: { parentId: 'a', pendingInteraction: question('same', 'approval') } } }
  assert.notEqual(pendingAckOf(child, 'a'), first)
})
test('child pending replacements re-light parents; catalog order/duplicates do not change identity', () => {
  const snapshot = { byId: { a: {}, b: { parentId: 'a', pendingInteraction: question('B') }, c: { pendingInteraction: question('C') } }, subagentsByParent: { a: [{ id: 'c' }, { sessionId: 'b' }, { id: 'a' }] } }
  assert.deepEqual([...childSessionIdsOf(snapshot, 'a')].sort(), ['b', 'c'])
  const first = pendingAckOf(snapshot, 'a')
  snapshot.subagentsByParent.a.reverse()
  snapshot.subagentsByParent.a.push({ id: 'b' })
  assert.equal(pendingAckOf(snapshot, 'a'), first)
  snapshot.byId.c.pendingInteraction = question('C2')
  assert.notEqual(pendingAckOf(snapshot, 'a'), first)
  delete snapshot.byId.c.pendingInteraction
  assert.notEqual(pendingAckOf(snapshot, 'a'), first)
})
test('legacy keyless pending, empty baseline and keyed legacy face are supported', () => {
  const snapshot = list()
  assert.equal(pendingAckOf(snapshot, 'a'), null)
  assert.equal(pendingAckOf(snapshot, 'a', { pending: [{}] }), 'need')
  assert.equal(pendingAckOf(snapshot, 'a', { pending: [] }), null)
  assert.equal(pendingAckOf(snapshot, 'a', { pending: [question('A')] }), pendingAckOf({ byId: { a: { pendingInteraction: question('A') } } }, 'a'))
  snapshot.byId.a.pendingInteraction = question('LIST')
  assert.equal(pendingAckOf(snapshot, 'a', { pending: [question('STALE')] }), pendingAckOf(snapshot, 'a'))
})

const legacyTimings = (turnTimings) => ({ binding: () => ({ session: { getSnapshot: () => ({ turnTimings }) } }) })
const chatTimings = (turnTimings) => ({ binding(sid) {
  assert.equal(sid, 'a')
  return { target(target) {
    assert.equal(target, 'chat')
    return { getSnapshot: () => ({ legacy: { turnTimings } }), subscribe() { assert.fail('timer must not activate/subscribe') } }
  }, activate() { assert.fail('timer must not activate') } }
} })
test('runtime chooses the oldest running job before conversation timings', () => {
  const snapshot = list(true)
  snapshot.jobsBySession = { a: [{ status: 'running', startedAt: 300 }, { status: 'done', startedAt: 1 }, { status: 'running', startedAt: 100 }] }
  const noBinding = { binding() { assert.fail('job timer must not read a binding') } }
  assert.equal(sessionRuntimeMs(snapshot, 'a', noBinding, noBinding, 1000), 900)
})
test('runtime reads new chat timings without legacy face, cold retention or target activation', () => {
  const turns = new Map([[1, { startTime: 100, endTime: 150 }], [2, { startTime: 250 }]])
  const sessions = { binding() { assert.fail('new timings must win') }, using() { assert.fail('timer must not retain') } }
  assert.equal(sessionRuntimeMs(list(true), 'a', sessions, chatTimings(turns), 1000), 750)
})
test('runtime supports old object/foreign Map and picks newest unfinished timestamp, not insertion order', () => {
  const turns = { newer: { startTime: 400 }, earlier: { startTime: 100 }, closed: { startTime: 900, endTime: 950 } }
  assert.equal(sessionRuntimeMs(list(true), 'a', legacyTimings(turns), undefined, 1000), 600)
  const foreignMap = runInNewContext('new Map([[2, {startTime: 400}], [1, {startTime: 100}]])')
  assert.equal(sessionRuntimeMs(list(true), 'a', legacyTimings(foreignMap), undefined, 1000), 600)
})
test('runtime unknown/finished/idle is null, invalid timestamps ignored and future start clamped', () => {
  const fail = { binding() { assert.fail('idle must not read any binding') } }
  assert.equal(sessionRuntimeMs(list(), 'a', fail, fail, 1000), null)
  assert.equal(sessionRuntimeMs(list(true), 'missing', fail, fail, 1000), null)
  assert.equal(sessionRuntimeMs(list(true), 'a', {}, {}, 1000), null)
  assert.equal(sessionRuntimeMs(list(true), 'a', {}, chatTimings(new Map([[1, { startTime: 100, endTime: 200 }]])), 1000), null)
  const snapshot = list(true)
  snapshot.jobsBySession = { a: [{ status: 'running', startedAt: NaN }, { status: 'running', startedAt: Infinity }, { status: 'running', startedAt: -1 }] }
  const turns = { invalid: { startTime: NaN }, future: { startTime: 1100 } }
  assert.equal(sessionRuntimeMs(snapshot, 'a', legacyTimings(turns), undefined, 1000), 0)
})
test('runtime falls back to legacy on unavailable chat source but not on authoritative closed timings', () => {
  const sessions = legacyTimings({ open: { startTime: 100 } })
  assert.equal(sessionRuntimeMs(list(true), 'a', sessions, { binding() { throw new Error('not retained') } }, 1000), 900)
  assert.equal(sessionRuntimeMs(list(true), 'a', sessions, chatTimings(new Map()), 1000), null)
})
