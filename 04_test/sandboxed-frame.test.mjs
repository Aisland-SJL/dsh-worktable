/**
 * SandboxedFrame lifecycle tests.
 * Transpiles the real component with esbuild and runs it with a minimal React
 * hooks fixture. Network and JSX are stubbed; this is not React DOM / browser E2E.
 */
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../01_content/package.json', import.meta.url))
const { buildSync } = require('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'wt-sandboxed-frame-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))

const componentPath = fileURLToPath(new URL('../01_content/src/client/SandboxedFrame.tsx', import.meta.url))
const bundlePath = join(temp, 'SandboxedFrame.cjs')
buildSync({
  entryPoints: [componentPath], bundle: true, platform: 'node', format: 'cjs',
  outfile: bundlePath, external: ['react', 'react/jsx-runtime'], jsx: 'automatic',
})
const componentCode = readFileSync(bundlePath, 'utf8')

function createHarness({ location, fetch }) {
  const slots = []
  let cursor = 0
  let pendingEffects = []
  let currentProps
  let currentOutput

  const jsx = (type, props) => ({ type, props: props ?? {} })
  const react = {
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
      const slot = slots[index]
      return [slot.value, value => { slot.value = typeof value === 'function' ? value(slot.value) : value }]
    },
    useEffect(create, deps) {
      const index = cursor++
      const previous = slots[index]
      const same = previous?.kind === 'effect' && Array.isArray(deps) && Array.isArray(previous.deps)
        && deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))
      if (!same) pendingEffects.push({ index, create, deps: Array.isArray(deps) ? [...deps] : undefined })
    },
  }

  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    URL,
    location,
    fetch,
    require(id) {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('test.fragment') }
      throw new Error('unexpected external module: ' + id)
    },
  }
  runInNewContext(componentCode, sandbox, { filename: 'SandboxedFrame.cjs' })
  const { SandboxedFrame, previewTarget } = module.exports

  function render(props) {
    currentProps = props ?? currentProps
    cursor = 0
    pendingEffects = []
    currentOutput = SandboxedFrame(currentProps)
    for (const effect of pendingEffects) {
      const previous = slots[effect.index]
      if (previous?.kind === 'effect') previous.cleanup?.()
      const cleanup = effect.create()
      slots[effect.index] = {
        kind: 'effect', deps: effect.deps,
        cleanup: typeof cleanup === 'function' ? cleanup : undefined,
      }
    }
    return currentOutput
  }

  function unmount() {
    for (const slot of slots) if (slot?.kind === 'effect') slot.cleanup?.()
    slots.length = 0
  }

  return { render, unmount, previewTarget, get output() { return currentOutput } }
}

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const siteUrl = (protocol = 'https:', host = 'dsh.example') =>
  protocol + '//' + host + '/api/worktable/site/C%3A%2FProjects%2Flegacy/index.html'
const grant = token => ({ token, base: '/api/worktable/preview-static/' + token + '/' })
const response = value => ({ ok: true, status: 200, json: async () => value })
function recordingFetch(grants) {
  const calls = []
  const fetch = (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {}
    calls.push({ url, init, body })
    if (body.revoke) return Promise.resolve({ ok: true, status: 200 })
    const value = typeof grants === 'function' ? grants(body, calls.length) : grants.shift()
    return Promise.resolve(typeof value?.then === 'function' ? value : response(value))
  }
  return { fetch, calls, revoked: () => calls.filter(call => call.body.revoke).map(call => call.body.revoke) }
}
const iframeProps = output => {
  assert.equal(output?.type, 'iframe', 'expected iframe output; actual=' + JSON.stringify(output))
  return output.props
}
const errorText = output => output?.props?.children?.props?.children

test('dangerous URL schemes are rejected before a preview grant is requested', async () => {
  const network = recordingFetch([])
  const location = { href: 'https://dsh.example/worktable', protocol: 'https:' }
  const harness = createHarness({ location, fetch: network.fetch })
  for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', 'file:///tmp/page.html', 'blob:https://dsh.example/id', 'ftp://dsh.example/page']) {
    assert.throws(() => harness.previewTarget(url, location.href), /Unsupported preview URL/)
  }
  harness.render({ url: 'javascript:alert(1)', reloadKey: 0 })
  await flush()
  const output = harness.render()
  assert.equal(output.type, 'div')
  assert.match(errorText(output), /Unsupported preview URL/)
  assert.equal(network.calls.length, 0)
  harness.unmount()
})

test('legacy site URLs request a grant for the decoded root and load the relative resource', async () => {
  const token = 'a'.repeat(32)
  const network = recordingFetch([grant(token)])
  const location = { href: 'https://dsh.example/worktable', protocol: 'https:' }
  const harness = createHarness({ location, fetch: network.fetch })
  const url = 'https://dsh.example/api/worktable/site/C%3A%2FProjects%2Flegacy%20site/assets/main%20file.css?theme=dark#top'
  const props = { url, title: 'legacy', reloadKey: 0 }
  harness.render(props)
  await flush()
  const frame = iframeProps(harness.render(props))
  assert.deepEqual(network.calls[0].body, { root: 'C:/Projects/legacy site' })
  assert.equal(frame.src, grant(token).base + 'assets/main%20file.css?theme=dark#top')
  assert.equal(frame['data-source-url'], url)
  assert.equal(frame.sandbox, 'allow-scripts allow-forms allow-downloads')
  harness.unmount()
  assert.deepEqual(network.revoked(), [token], 'revoke calls=' + JSON.stringify(network.calls))
})

test('a grant that returns after unmount is revoked immediately', async () => {
  const token = 'b'.repeat(32)
  const pending = {}
  pending.promise = new Promise(resolve => { pending.resolve = resolve })
  const calls = []
  const fetch = (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {}
    calls.push({ url, body })
    return body.revoke ? Promise.resolve({ ok: true }) : pending.promise
  }
  const harness = createHarness({
    location: { href: 'https://dsh.example/worktable', protocol: 'https:' }, fetch,
  })
  harness.render({ url: siteUrl(), reloadKey: 0 })
  harness.unmount()
  pending.resolve(response(grant(token)))
  await flush()
  assert.deepEqual(calls.filter(call => call.body.revoke).map(call => call.body.revoke), [token])
})

test('Desktop URL construction failure revokes the minted token immediately and only once', async () => {
  const token = 'c'.repeat(32)
  const network = recordingFetch([grant(token)])
  const location = { href: 'dsh-app://app/worktable', protocol: 'dsh-app:' }
  const harness = createHarness({ location, fetch: network.fetch })
  const props = { url: siteUrl('dsh-app:', 'app'), reloadKey: 0 }
  harness.render(props)
  await flush()
  assert.deepEqual(network.revoked(), [token])
  const output = harness.render(props)
  assert.equal(output.type, 'div')
  assert.match(errorText(output), /Desktop Host preview URL unavailable/)
  harness.unmount()
  assert.deepEqual(network.revoked(), [token], 'unmount must not revoke the already-cleared token again')
})

test('reload revokes the previous token and uses only the newly issued token', async () => {
  const first = 'd'.repeat(32)
  const second = 'e'.repeat(32)
  const network = recordingFetch([grant(first), grant(second)])
  const harness = createHarness({
    location: { href: 'https://dsh.example/worktable', protocol: 'https:' }, fetch: network.fetch,
  })
  const props = { url: siteUrl(), reloadKey: 0 }
  harness.render(props)
  await flush()
  assert.ok(iframeProps(harness.render(props)).src.includes(first))
  const reloadProps = { ...props, reloadKey: 1 }
  harness.render(reloadProps)
  assert.deepEqual(network.revoked(), [first], 'reload cleanup must revoke the old token before the new grant settles')
  await flush()
  const nextFrame = iframeProps(harness.render(reloadProps))
  assert.ok(nextFrame.src.includes(second))
  assert.equal(nextFrame.src.includes(first), false)
  harness.unmount()
  assert.deepEqual(network.revoked(), [first, second])
})

test('an unavailable preview authorization service renders an error without navigating', async () => {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : {} })
    return { ok: false, status: 503 }
  }
  const harness = createHarness({
    location: { href: 'https://dsh.example/worktable', protocol: 'https:' }, fetch,
  })
  const props = { url: siteUrl(), reloadKey: 0 }
  harness.render(props)
  await flush()
  const output = harness.render(props)
  assert.equal(output.type, 'div')
  assert.match(errorText(output), /Preview HTTP 503/)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].body, { root: 'C:/Projects/legacy' })
  assert.equal(calls.some(call => call.body.revoke), false)
  harness.unmount()
})
