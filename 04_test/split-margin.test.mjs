/**
 * Split margin/CSSOM regression tests.
 * Usage: node split-margin.test.mjs [path/to/lib/client.js]
 *
 * Runs the actual client bundle in isolated headless Chromium with a temporary
 * profile. The fractional case uses real CSSStyleDeclaration and MutationObserver.
 */
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '..')
const bundlePath = resolve(process.argv[2] ?? join(repoRoot, '01_content', 'lib', 'client.js'))
assert.ok(existsSync(bundlePath), 'client bundle not found: ' + bundlePath)

const browserPath = process.env.DSH_TEST_CHROMIUM || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find(existsSync)
assert.ok(browserPath && existsSync(browserPath),
  'Chromium not found; set DSH_TEST_CHROMIUM to an installed Chromium executable')

const browserCode = [
  "const result = document.getElementById('result');",
  "const lines = [];",
  "const record = (name, ok, detail) => lines.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : ''));",
  "const sleep = () => new Promise(resolve => setTimeout(resolve, 80));",
  "const makeStub = () => {",
  "  const stub = function () { return makeStub(); };",
  "  return new Proxy(stub, {",
  "    get: (_target, key) => (key === Symbol.toPrimitive ? () => 'stub' : makeStub()),",
  "    apply: () => makeStub(),",
  "    construct: () => makeStub(),",
  "  });",
  "};",
  "const requireStub = id => {",
  "  if (id === 'react' || id === 'react/jsx-runtime') return makeStub();",
  "  throw new Error('unexpected external require: ' + id);",
  "};",
  "const makeSpec = (id, extra = {}) => Object.assign({",
  "  id, title: id, top: null,",
  "  main: [{ id: 'p1', title: 'p1', min: 200, content: null }],",
  "  chatWidth: { default: 320, min: 240, max: 600 },",
  "}, extra);",
  "function addRoot(phase, width, headerHeight = 48) {",
  "  const root = document.createElement('div');",
  "  root.dataset.phase = phase;",
  "  root.className = 'wSkVaW_root';",
  "  root.style.cssText = 'position:absolute;left:0;top:0;width:' + width + 'px;height:800px;padding:0;border:0;box-sizing:content-box;';",
  "  let header = null;",
  "  let area;",
  "  if (headerHeight === null) {",
  "    area = document.createElement('div');",
  "    root.appendChild(area);",
  "  } else {",
  "    header = document.createElement('div');",
  "    header.className = 'wSkVaW_header';",
  "    header.style.cssText = 'height:' + headerHeight + 'px;width:100%;';",
  "    area = document.createElement('div');",
  "    area.style.cssText = 'height:700px;width:100%;';",
  "    root.appendChild(header);",
  "    root.appendChild(area);",
  "  }",
  "  document.body.appendChild(root);",
  "  return { root, header, area };",
  "}",
  "async function runCase(name, fn) {",
  "  try { await fn(); record(name, true); }",
  "  catch (error) { record(name, false, String(error && error.message || error)); }",
  "  try { if (window.__splitStore && window.__splitStore.active) window.__splitStore.close(); } catch {}",
  "  document.querySelectorAll('[data-phase]').forEach(el => el.remove());",
  "  await sleep();",
  "}",
  "(async () => {",
  "  try {",
  "    if (!window.__captured || typeof window.__captured.factory !== 'function') throw new Error('client factory not captured');",
  "    window.__captured.factory(requireStub);",
  "    const splitStore = window.__dshWorktable && window.__dshWorktable.splitStore;",
  "    if (!splitStore) throw new Error('splitStore not exported');",
  "    window.__splitStore = splitStore;",
  "    document.body.style.margin = '0';",
  "    await runCase('A fractional CSSOM write stays open', async () => {",
  "      const { root, area } = addRoot('active', 1000.333);",
  "      if (!splitStore.open(makeSpec('split-margin-a'))) throw new Error('open failed');",
  "      splitStore.setChatW(splitStore.chatW + 1);",
  "      const colW = splitStore.geom.right - splitStore.geom.left;",
  "      const rawMargin = Math.max(0, colW - splitStore.chatW) + 'px';",
  "      const probe = document.createElement('div');",
  "      probe.style.marginLeft = rawMargin;",
  "      if (probe.style.marginLeft === rawMargin) throw new Error('fixture did not exercise CSSOM rounding: ' + rawMargin);",
  "      await sleep();",
  "      if (!splitStore.active) throw new Error('self-write closed split; raw=' + rawMargin + ', CSSOM=' + probe.style.marginLeft);",
  "      if (area.style.marginLeft !== probe.style.marginLeft) throw new Error('unexpected applied CSSOM value: ' + area.style.marginLeft);",
  "      root.remove();",
  "    });",
  "    await runCase('B top/left resizing stays open', async () => {",
  "      const { root } = addRoot('active', 1000.333);",
  "      const spec = makeSpec('split-margin-b', {",
  "        top: [{ id: 't1', title: 't1', min: 120, content: null }],",
  "        left: { id: 'l1', title: 'l1', min: 160, content: null },",
  "        topHeight: { default: 200, min: 80 },",
  "        leftWidth: { default: 260, min: 160 },",
  "      });",
  "      if (!splitStore.open(spec)) throw new Error('open failed');",
  "      splitStore.setTopH(201.4);",
  "      splitStore.setLeftW(301.4);",
  "      splitStore.setChatW(400);",
  "      await sleep();",
  "      if (!splitStore.active) throw new Error('resizing closed split');",
  "      root.remove();",
  "    });",
  "    await runCase('C external style rewrite still yields', async () => {",
  "      const { area } = addRoot('active', 1000);",
  "      if (!splitStore.open(makeSpec('split-margin-c'))) throw new Error('open failed');",
  "      await sleep();",
  "      if (!splitStore.active) throw new Error('split closed before external rewrite');",
  "      area.style.marginRight = '19px';",
  "      await sleep();",
  "      if (splitStore.active) throw new Error('external rewrite was not detected');",
  "    });",
  "    await runCase('D yield observer follows a new view area', async () => {",
  "      const old = addRoot('hero', 1000, null);",
  "      if (!splitStore.open(makeSpec('split-margin-d'))) throw new Error('open failed');",
  "      await sleep();",
  "      const next = addRoot('active', 1000);",
  "      splitStore.syncAnchor();",
  "      await sleep();",
  "      if (splitStore.root !== next.root || splitStore.viewArea !== next.area) throw new Error('syncAnchor did not move to new root');",
  "      if (!splitStore.active) throw new Error('split closed during re-anchor');",
  "      next.area.style.marginLeft = '23px';",
  "      await sleep();",
  "      if (splitStore.active) throw new Error('new view area rewrite was not observed');",
  "      old.root.remove();",
  "    });",
  "    await runCase('E integer geometry stays open', async () => {",
  "      const { root } = addRoot('active', 1000);",
  "      if (!splitStore.open(makeSpec('split-margin-e'))) throw new Error('open failed');",
  "      await sleep();",
  "      if (!splitStore.active) throw new Error('integer geometry closed split');",
  "      root.remove();",
  "    });",
  "  } catch (error) {",
  "    lines.push('FAIL setup (' + String(error && error.message || error) + ')');",
  "  }",
  "  result.textContent = (lines.some(line => line.startsWith('FAIL ')) ? 'FAIL|' : 'PASS|') + lines.join('|');",
  "})();",
].join('\n')

const html = [
  '<!doctype html><html><head><meta charset="utf-8"></head><body>',
  '<pre id="result">RUNNING</pre>',
  '<script>window.__ModuleLoader__ = { load: reg => { window.__captured = reg; } };</script>',
  '<script src="./client.js"></script>',
  '<script>',
  browserCode,
  '</script>',
  '</body></html>',
].join('\n')

const systemTemp = realpathSync(tmpdir())
const tempDir = mkdtempSync(join(systemTemp, 'dsh-worktable-split-margin-'))
try {
  const tempReal = realpathSync(tempDir)
  assert.ok(tempReal.toLowerCase().startsWith(systemTemp.toLowerCase() + sep), 'temporary directory escaped system temp')
  copyFileSync(bundlePath, join(tempDir, 'client.js'))
  writeFileSync(join(tempDir, 'index.html'), html, 'utf8')
  const browser = spawnSync(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--allow-file-access-from-files',
    '--force-device-scale-factor=1.5',
    '--no-first-run',
    '--no-default-browser-check',
    '--dump-dom',
    '--virtual-time-budget=5000',
    '--user-data-dir=' + join(tempDir, 'profile'),
    pathToFileURL(join(tempDir, 'index.html')).href,
  ], { encoding: 'utf8', timeout: 30000, maxBuffer: 5 * 1024 * 1024 })
  if (browser.error) throw browser.error
  const resultMatch = /<pre id="result">([\s\S]*?)<\/pre>/.exec(browser.stdout || '')
  assert.ok(resultMatch, 'Chromium did not return the test result. stderr: ' + String(browser.stderr || '').slice(-1200))
  const result = resultMatch[1]
  for (const line of result.split('|').slice(1)) console.log(line)
  assert.ok(result.startsWith('PASS|'), 'split margin regression failed: ' + result)
  assert.equal(browser.status, 0, 'Chromium exited with status ' + browser.status)
  console.log('all split margin tests passed')
} finally {
  const tempReal = realpathSync(tempDir)
  assert.ok(tempReal.toLowerCase().startsWith(systemTemp.toLowerCase() + sep), 'refusing to remove path outside system temp')
  rmSync(tempReal, { recursive: true, force: true })
}
