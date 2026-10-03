import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../01_content/package.json', import.meta.url))
const { buildSync } = require('esbuild')
const source = buildSync({ entryPoints: [fileURLToPath(new URL('../01_content/src/client/hostTransport.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
const module = { exports: {} }
runInNewContext(source, { module, exports: module.exports, URL })
const { hostWebSocketUrl, worktableUpgrade } = module.exports

test('Web HTTP uses its current authority and preserves encoded query', () => {
  assert.equal(hostWebSocketUrl('/api/worktable/term?cwd=C%3A%2Ftest&cols=80', { href: 'http://127.0.0.1:3080/', protocol: 'http:' }), 'ws://127.0.0.1:3080/api/worktable/term?cwd=C%3A%2Ftest&cols=80')
})
test('Web HTTPS keeps the secure WebSocket transport', () => {
  assert.equal(hostWebSocketUrl('/api/worktable/term', { href: 'https://example.test/dsh', protocol: 'https:' }), 'wss://example.test/api/worktable/term')
})
test('Desktop uses the injected Host port, never the app scheme authority', () => {
  assert.equal(hostWebSocketUrl('/api/worktable/term?sessionId=fixture', { href: 'dsh-app://app/', protocol: 'dsh-app:', streamBaseUrl: 'http://127.0.0.1:19499' }), 'ws://127.0.0.1:19499/api/worktable/term?sessionId=fixture')
})
test('Desktop without its bridge fails visibly rather than connecting to ws://app', () => {
  assert.throws(() => hostWebSocketUrl('/api/worktable/term', { href: 'dsh-app://app/', protocol: 'dsh-app:' }), /stream URL unavailable/)
})
test('Unknown stream protocols are rejected', () => {
  assert.throws(() => hostWebSocketUrl('/api/worktable/term', { href: 'dsh-app://app/', protocol: 'dsh-app:', streamBaseUrl: 'file:///fixture' }), /Unsupported Host transport/)
})

test('Web update instructions retain the web profile', () => {
  const { command, prompt, desktop } = worktableUpgrade('https:')
  assert.equal(desktop, false)
  assert.match(command, /--profile web add/)
  assert.match(prompt, /重启 dsh web/)
})

test('Desktop update instructions require its bundled CLI and manual restart', () => {
  const { command, prompt, desktop } = worktableUpgrade('dsh-app:')
  assert.equal(desktop, true)
  assert.match(command, /--profile desktop add/)
  assert.doesNotMatch(command, /--profile web/)
  assert.match(prompt, /桌面端自带的 dsh CLI/)
  assert.match(prompt, /不要修改 web profile/)
  assert.match(prompt, /手动重新打开桌面端/)
})
