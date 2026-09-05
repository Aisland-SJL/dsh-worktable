/**
 * dsh-worktable 发布准备脚本（本地构建 + 打包 + 消费方验收 合一）
 *
 * 职责边界（与 Codex 审阅结论一致）：
 *   - 只负责：版本一致性检查 → 构建 → 语法检查 → npm pack →
 *     结构清单断言（package/ 前缀 + 精确 7 文件 + 无源码/无 .map）→
 *     独立临时目录真实安装 + import() 断言 → 双资产从同一已验证包复制 → SHA-256 输出。
 *   - 绝不执行：git 操作 / push / tag / gh release / 任何对外发布动作。
 *   - 任何断言失败 = 进程以非零码退出，绝不输出"验收通过"。
 *
 * 用法（脚本以自身位置解析 01_content，不依赖执行 cwd；任何目录都可调用）：
 *   node release-prep.mjs
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { gateClientFactory } from './client-factory-gate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url)) // 固定 = 01_content，绝不依赖执行 cwd
// Windows 下 spawnSync('npm') 有 ENOENT、spawnSync('npm.cmd') 有 EINVAL 问题。
// 统一通过 node 的 npm-cli.js 调用（node 自带 npm 前缀，跨平台稳定）。
const { execPath } = await import('node:process')
// node 安装目录下的 npm-cli.js（Win: <nodeDir>/node_modules/npm/bin/npm-cli.js）；不行则回退 PATH 上的 npm
const nodeDir = dirname(execPath)
const npmCliCandidates = [
  join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
].filter((p) => existsSync(p))
const npmCli = npmCliCandidates[0] ?? null
function runNpm(args, opts = {}) {
  if (npmCli) return spawnSync(execPath, [npmCli, ...args], { stdio: 'pipe', encoding: 'utf8', ...opts })
  const cmd = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm ' + args.map((a) => '\"' + a + '\"').join(' ')], { stdio: 'pipe', encoding: 'utf8', ...opts })
    : spawnSync('npm', args, { stdio: 'pipe', encoding: 'utf8', ...opts })
  return cmd
}

// ---------- 1. 版本一致性（build.mjs 同款 guard，先于一切） ----------
const pkg = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(HERE, 'dsh.plugin.json'), 'utf8'))
if (manifest.version !== pkg.version) {
  console.error('[release-prep] FAIL: package.json(' + pkg.version + ') != dsh.plugin.json(' + manifest.version + ')')
  process.exit(1)
}
const VERSION = pkg.version
console.log('[release-prep] version = ' + VERSION)

// ---------- 1b. 身份断言（package/manifest/patch 统一为 dsh-worktable） ----------
const IDENTITY = 'dsh-worktable'
if (pkg.name !== IDENTITY) { console.error('[release-prep] FAIL: package.json name = ' + pkg.name); process.exit(1) }
if (manifest.name !== IDENTITY) { console.error('[release-prep] FAIL: dsh.plugin.json name = ' + manifest.name); process.exit(1) }
if (!manifest.entry || manifest.entry.name !== IDENTITY) { console.error('[release-prep] FAIL: dsh.plugin.json entry.name != ' + IDENTITY); process.exit(1) }
// cordis.patch.yml 严格检查：按缩进层级解析，只接受「- insert: 下的子列表项（id/name=IDENTITY）」结构
const patchRaw = readFileSync(join(HERE, 'cordis.patch.yml'), 'utf8')
const patchLines = patchRaw.split(/\r?\n/)
let patchOk = true
const patchEntries = []
let cur = null
for (const rawLine of patchLines) {
  const line = rawLine.trimEnd()
  if (line.trim() === '' || line.trim().startsWith('#')) continue
  const indent = line.length - line.trimStart().length
  const text = line.trim()
  if (indent === 0 && text === '- insert:') { cur = {}; patchEntries.push(cur); continue }
  if (indent === 0) { patchOk = false; console.error('[release-prep] FAIL: cordis.patch.yml unexpected top-level line: ' + JSON.stringify(text)); break }
  if (indent === 4 && text === '- id: ' + IDENTITY) { if (cur && cur.id !== undefined) { patchOk = false; console.error('[release-prep] FAIL: cordis.patch.yml duplicate - id: item (only one plugin entry allowed)'); break }; if (cur) cur.id = IDENTITY; continue }
  if (indent === 4 && /^- id:/.test(text)) { patchOk = false; console.error('[release-prep] FAIL: cordis.patch.yml insert item id != ' + IDENTITY + ': ' + JSON.stringify(text)); break }
  if (indent === 6 && text === 'name: ' + IDENTITY) { if (cur && cur.name !== undefined) { patchOk = false; console.error('[release-prep] FAIL: cordis.patch.yml duplicate name field'); break }; if (cur) cur.name = IDENTITY; continue }
  if (indent === 6 && /^name:/.test(text)) { patchOk = false; console.error('[release-prep] FAIL: cordis.patch.yml insert item name != ' + IDENTITY + ': ' + JSON.stringify(text)); break }
  patchOk = false
  console.error('[release-prep] FAIL: cordis.patch.yml unexpected line (indent ' + indent + '): ' + JSON.stringify(text))
  break
}
if (patchOk && patchEntries.length !== 1) { patchOk = false; console.error('[release-prep] FAIL: cordis.patch.yml must contain exactly one insert entry, got ' + patchEntries.length) }
if (patchOk && (patchEntries[0].id !== IDENTITY || patchEntries[0].name !== IDENTITY)) {
  patchOk = false
  console.error('[release-prep] FAIL: cordis.patch.yml insert entry incomplete: ' + JSON.stringify(patchEntries[0]))
}
if (!patchOk) process.exit(1)
console.log('[release-prep] identity check passed (' + IDENTITY + ', cordis.patch.yml strict)')

// ---------- 2. 构建 + 语法检查 ----------
// 构建必带 cwd: HERE（脚本自身位置=01_content），否则从仓库根调用会输出到根 lib/ 造成旧包
const build = spawnSync(process.execPath, [join(HERE, 'build.mjs')], { stdio: 'inherit', cwd: HERE })
if (build.status !== 0) { console.error('[release-prep] FAIL: build failed'); process.exit(1) }
for (const f of ['lib/index.js', 'lib/client.js']) {
  const chk = spawnSync(process.execPath, ['--check', join(HERE, f)], { stdio: 'pipe' })
  if (chk.status !== 0) { console.error('[release-prep] FAIL: node --check ' + f); process.exit(1) }
}
console.log('[release-prep] build + syntax check passed')

// ---------- 3. npm pack 到临时目录 ----------
const work = join(tmpdir(), 'wt-release-prep-' + Date.now())
mkdirSync(join(work, 'pack'), { recursive: true })
const pack = runNpm(['pack', '--pack-destination', join(work, 'pack')], { cwd: HERE })
if (pack.status !== 0) { console.error('[release-prep] FAIL: npm pack'); console.error('status=' + String(pack.status) + ' error=' + String(pack.error ?? '') + ' stderr=' + String(pack.stderr ?? '').slice(0, 400)); process.exit(1) }
// npm pack 在 win 上把 notice 输出到 stdout、文件名在末尾一行；也可能输出到 stderr——统一从两者提取
const allOut = String(pack.stdout ?? '') + String(pack.stderr ?? '')
const packedName = (allOut.match(/^[^\s]+\.tgz$/m) || [])[0]?.trim()
if (!packedName) { console.error('[release-prep] FAIL: cannot determine packed filename'); process.exit(1) }
const tgz = join(work, 'pack', packedName)
console.log('[release-prep] packed: ' + packedName)

// ---------- 4. 结构清单断言（精确到文件，不含源码/映射） ----------
const listTar = spawnSync('tar', ['-tzf', tgz], { encoding: 'utf8' })
if (listTar.status !== 0) { console.error('[release-prep] FAIL: tar -tzf'); process.exit(1) }
const entries = listTar.stdout.split(/\r?\n/).filter(Boolean)
const EXPECTED = [
  'package/LICENSE',
  'package/README.md',
  'package/cordis.patch.yml',
  'package/dsh.plugin.json',
  'package/lib/client.js',
  'package/lib/index.js',
  'package/package.json',
]
const ok = entries.length === EXPECTED.length &&
  EXPECTED.every((e) => entries.includes(e)) &&
  !entries.some((e) => e.startsWith('package/src/')) &&
  !entries.some((e) => e.endsWith('.map'))
if (!ok) {
  console.error('[release-prep] FAIL: package structure mismatch')
  console.error('  got: ' + entries.join(', '))
  process.exit(1)
}
console.log('[release-prep] structure check passed (7 files, no src/, no .map)')

// ---------- 5. 独立临时目录真实安装 + import() 断言 ----------
const inst = join(work, 'inst')
mkdirSync(inst, { recursive: true })
writeFileSync(join(inst, 'package.json'), JSON.stringify({ name: 'wt-prep-test', version: '0.0.0', private: true }))
const ins = runNpm(['install', tgz, '--no-audit', '--no-fund', '--loglevel=error'], { cwd: inst })
if (ins.status !== 0) { console.error('[release-prep] FAIL: npm install'); console.error(ins.stderr); process.exit(1) }
// import 断言脚本（写临时文件，避免 -e 多行转义）：导出名称 + 类型 + 内容 + 包内版本文件
const assertJs = join(inst, 'assert.mjs')
writeFileSync(assertJs, [
  "import { readFileSync } from 'node:fs'",
  "const TARGET_VERSION = " + JSON.stringify(VERSION),
  "const m = await import('dsh-worktable')",
  "const fails = []",
  "if (typeof m.apply !== 'function') fails.push('apply not function: ' + typeof m.apply)",
  "if (!Array.isArray(m.inject)) fails.push('inject not array')",
  "if (!m.inject.includes('webServer')) fails.push('server inject missing webServer')",
  "if (!m.inject.includes('sessions')) fails.push('server inject missing sessions')",
  "if (m.name !== 'dsh-worktable') fails.push('name mismatch: ' + m.name)",
  "if (m.HEALTH_PATH !== '/api/worktable/health') fails.push('HEALTH_PATH mismatch: ' + m.HEALTH_PATH)",
  "const pkg = JSON.parse(readFileSync('./node_modules/dsh-worktable/package.json', 'utf8'))",
  "if (pkg.version !== TARGET_VERSION) fails.push('installed version mismatch: ' + pkg.version)",
  "const idx = readFileSync('./node_modules/dsh-worktable/lib/index.js', 'utf8')",
  "const cli = readFileSync('./node_modules/dsh-worktable/lib/client.js', 'utf8')",
  "if (!idx.includes(JSON.stringify(TARGET_VERSION))) fails.push('index.js missing target version')",
  "if (!cli.includes(JSON.stringify(TARGET_VERSION))) fails.push('client.js missing target version')",
  "if (fails.length) { console.error(fails.join(String.fromCharCode(10))); process.exit(3) }",
  "console.log('assert ok: apply/inject/name/HEALTH_PATH + versions(' + TARGET_VERSION + ')')",
].join('\n'))
const assertUrl = 'file:///' + assertJs.replace(/\\/g, '/')
const imp = spawnSync(process.execPath, ['--input-type=module', '--eval', 'await import(' + JSON.stringify(assertUrl) + ')'], { cwd: inst, stdio: 'pipe', encoding: 'utf8' })
if (imp.status !== 0) { console.error('[release-prep] FAIL: import() assertion'); console.error(imp.stderr); process.exit(1) }
console.log('[release-prep] install + import assertion passed')

// ---------- 5b. 客户端工厂求值门禁（ModuleLoader 握手真实执行一次；非端到端验收） ----------
// 读「安装目录中的最终产物」lib/client.js（node_modules/dsh-worktable/lib/client.js），而非工作目录——验收最终包
const clientSrc = readFileSync(join(inst, 'node_modules', 'dsh-worktable', 'lib', 'client.js'), 'utf8')
const CLIENT_EXPECTED_INJECT = ['slots', 'locale', 'sessions', 'conversation', 'workspaces']
try {
  gateClientFactory(clientSrc, 'dsh-worktable', CLIENT_EXPECTED_INJECT)
} catch (e) {
  console.error('[release-prep] FAIL: client factory gate: ' + (e && e.message ? e.message : String(e)))
  process.exit(1)
}
console.log('[release-prep] client factory gate passed (ModuleLoader id + factory evaluation + inject)')

// ---------- 6. 双资产从同一已验证包复制 + SHA-256 ----------
const outDir = join(HERE, 'dist', 'v' + VERSION)
mkdirSync(outDir, { recursive: true })
// 输出目录终态约束：只允许固定名 + 版本化两个 tgz；出现未知文件 = 报错，绝不删除
const KNOWN = new Set(['dsh-worktable.tgz', 'dsh-worktable-' + VERSION + '.tgz'])
for (const ent of readdirSync(outDir)) {
  if (!KNOWN.has(ent)) {
    console.error('[release-prep] FAIL: dist/v' + VERSION + '/ contains unknown file: ' + ent + ' (not deleting; fix manually)')
    process.exit(1)
  }
}
const assetFixed = join(outDir, 'dsh-worktable.tgz')
const assetVer = join(outDir, 'dsh-worktable-' + VERSION + '.tgz')
copyFileSync(tgz, assetFixed) // 同版本重跑：覆盖这两个已知文件是允许的
copyFileSync(tgz, assetVer)
// 复制后终态断言：目录恰好两个已知文件（无遗漏/无多余），双 SHA 一致
const finalEntries = readdirSync(outDir).sort()
const finalSet = new Set(finalEntries)
if (finalEntries.length !== 2 || !finalSet.has('dsh-worktable.tgz') || !finalSet.has('dsh-worktable-' + VERSION + '.tgz')) {
  console.error('[release-prep] FAIL: post-copy final listing mismatch: ' + finalEntries.join(', '))
  process.exit(1)
}
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const shaFixed = sha(assetFixed)
const shaVer = sha(assetVer)
if (shaFixed !== shaVer) { console.error('[release-prep] FAIL: two assets differ after copy'); process.exit(1) }
console.log('[release-prep] DONE — 双资产同源（同 SHA-256），终态目录恰好 2 文件:')
console.log('  dist/v' + VERSION + '/dsh-worktable.tgz           sha256:' + shaFixed)
console.log('  dist/v' + VERSION + '/dsh-worktable-' + VERSION + '.tgz sha256:' + shaVer)
console.log('[release-prep] 提示：本脚本未推送、未打 tag、未发布。上传后请运行 verify-remote.mjs --expect-sha ' + shaFixed + ' 核对远端。')
rmSync(work, { recursive: true, force: true })
