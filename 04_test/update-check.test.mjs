import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../01_content/package.json', import.meta.url))
const { buildSync } = require('esbuild')
const LOCAL = '0.5.1-dev.2'
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../01_content/src/client/updateCheck.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs', define: { __WT_VERSION__: JSON.stringify(LOCAL) } }).outputFiles[0].text
const CACHE = 'dsh.worktable.updateCache.v1', LAST = 'dsh.worktable.lastUpdateCheck.v1', SKIP = 'dsh.worktable.skipVersion.v1'
function fixture(reply = { tag_name: 'v0.5.0' }) {
  const values = new Map(), calls = [], module = { exports: {} }
  let response = reply
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }
  runInNewContext(code, { module, exports: module.exports, localStorage, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push([url, options])
      if (response instanceof Error) throw response
      return { ok: !response?.http, status: response?.http ?? 200, json: async () => response }
    },
  })
  return { api: module.exports, values, calls, localStorage, respond: value => { response = value } }
}
const info = latest => ({ latest, notes: 'Release notes', url: 'https://github.com/Aisland-SJL/dsh-worktable/releases/tag/v' + latest })
const { cmpVer } = fixture().api

test('version precedence covers old release, candidate, stable, numeric prerelease and build metadata', () => {
  const pairs = [
    ['0.5.0', LOCAL, -1], [LOCAL, '0.5.1', -1], ['0.5.1-dev.2', '0.5.1-dev.10', -1],
    ['0.5.1-alpha', '0.5.1-alpha.1', -1], ['0.5.1-alpha.1', '0.5.1-alpha.beta', -1],
    ['0.5.1-beta.11', '0.5.1-rc.1', -1], ['0.5.1-1', '0.5.1-alpha', -1],
    ['0.5.1-A', '0.5.1-a', -1], ['v0.5.1', '0.5.1', 0],
    ['0.5.1+build.9', '0.5.1+build.10', 0], ['0.5.1-dev.2+one', LOCAL, 0],
    ['99999999999999999999.0.0', '99999999999999999998.9.9', 1],
    ['0.5.1-dev.99999999999999999999', '0.5.1-dev.99999999999999999998', 1],
  ]
  for (const [a, b, expected] of pairs) {
    assert.equal(cmpVer(a, b), expected, a + ' vs ' + b)
    assert.equal(cmpVer(b, a), expected === 0 ? 0 : -expected)
  }
})
test('invalid versions are explicitly incomparable, never NaN or an upgrade', () => {
  for (const bad of ['', 'dev', '0.5', '01.5.1', '0.5.1-dev.02', '0.5.1-', '0.5.1+','0.5.1-dev..2', 'v0.5.1x', 'vv0.5.1', '0.5.1.2', 42, null]) {
    assert.equal(cmpVer(bad, LOCAL), null, String(bad))
    assert.equal(cmpVer(LOCAL, bad), null, String(bad))
  }
})
test('cache rejects older, equal and malformed update info without touching unrelated state', () => {
  const f = fixture(); f.values.set('fixture.project', 'keep')
  for (const value of [info('0.5.0'), info(LOCAL), info('not-a-version'), { latest: '9.0.0' }, ['9.0.0'], null]) {
    f.values.set(CACHE, JSON.stringify({ status: 'uptodate', info: value }))
    assert.equal(f.api.readCache().info, null)
  }
  f.values.set(CACHE, '{broken json')
  assert.equal(f.api.readCache().info, null)
  f.values.set(CACHE, JSON.stringify({ status: 'made-up', info: info('9.0.0') }))
  assert.equal(f.api.readCache().status, 'idle')
  assert.equal(f.values.get('fixture.project'), 'keep')
})
test('newer cache remains usable but rechecks a later skip on every read', () => {
  const f = fixture(); f.values.set(CACHE, JSON.stringify({ status: 'uptodate', info: info('9.0.0') }))
  assert.equal(f.api.readCache().info.latest, '9.0.0')
  f.api.setSkipVersion('v9.0.0')
  assert.equal(f.api.readCache().info, null)
})
test('24-hour throttle and disabled automatic checks cannot resurrect an old cache', async () => {
  const f = fixture()
  f.values.set(CACHE, JSON.stringify({ status: 'uptodate', info: info('0.5.0') }))
  f.values.set(LAST, String(Date.now())); f.values.set('dsh.worktable.updateCheck.v1', '0')
  assert.equal(f.api.getAutoCheck(), false)
  assert.equal(f.api.readCache().info, null)
  assert.equal((await f.api.checkUpdate()).info, null)
  assert.equal(f.calls.length, 0)
})
test('a real stable release above this candidate is offered, notes are bounded', async () => {
  const f = fixture({ tag_name: 'v0.5.1', body: 'x'.repeat(1000), html_url: info('0.5.1').url })
  const result = await f.api.checkUpdate(true)
  assert.equal(result.status, 'uptodate'); assert.equal(result.info.latest, '0.5.1'); assert.equal(result.info.notes.length, 800)
  assert.equal(f.calls.length, 1)
  assert.equal(f.api.readCache().info.latest, '0.5.1')
})
test('older, equal and skipped network releases clear a previous update', async () => {
  for (const tag of ['0.5.0', LOCAL, '9.0.0']) {
    const f = fixture({ tag_name: 'v' + tag }); f.values.set(CACHE, JSON.stringify({ status: 'uptodate', info: info('9.0.0') }))
    if (tag === '9.0.0') f.api.setSkipVersion(tag)
    const result = await f.api.checkUpdate(true)
    assert.equal(result.status, 'uptodate'); assert.equal(result.info, null)
    assert.equal(f.api.readCache().info, null)
  }
})
test('malformed release versions fail rather than claiming an update or latest', async () => {
  for (const payload of [{}, { tag_name: 123 }, { tag_name: 'banana' }, { tag_name: '0.5' }, { tag_name: 'vv9.0.0' }]) {
    const f = fixture(payload); const result = await f.api.checkUpdate(true)
    assert.equal(result.status, 'failed'); assert.equal(result.info, null)
  }
})
test('network failures clear stale updates, retry at most three times and stop on 403/404', async () => {
  for (const [reply, expectedCalls] of [[new Error('offline'), 3], [{ http: 500 }, 3], [{ http: 403 }, 1], [{ http: 404 }, 1]]) {
    const f = fixture(reply); f.values.set(CACHE, JSON.stringify({ status: 'uptodate', info: info('9.0.0') }))
    const result = await f.api.checkUpdate(true)
    assert.equal(result.status, 'failed'); assert.equal(result.info, null); assert.equal(f.api.readCache().info, null)
    assert.equal(f.calls.length, expectedCalls)
  }
})
test('invalid and future check timestamps do not suppress a fresh request', async () => {
  for (const last of ['NaN', '-1', String(Date.now() + 86400000)]) {
    const f = fixture(); f.values.set(LAST, last)
    await f.api.checkUpdate(false)
    assert.equal(f.calls.length, 1)
  }
})
test('storage access failure cannot turn an older release into an update', async () => {
  const f = fixture(); f.localStorage.getItem = () => { throw new Error('storage unavailable') }
  f.localStorage.setItem = () => { throw new Error('storage unavailable') }
  const result = await f.api.checkUpdate(true)
  assert.equal(result.status, 'uptodate'); assert.equal(result.info, null)
})
