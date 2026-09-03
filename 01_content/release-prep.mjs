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
 * 用法（脚本以自身位置解析 01_content，不依赖执行 cwd）：
 *   node release-prep.mjs
 *   node release-prep.mjs --skip-build    # 仅重新验收现有 lib（排障用）
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, copyFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url)) // 固定 = 01_content，绝不依赖执行 cwd
const SKIP_BUILD = process.argv.includes('--skip-build')
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

// ---------- 2. 构建 + 语法检查 ----------
if (!SKIP_BUILD) {
  const build = spawnSync(process.execPath, [join(HERE, 'build.mjs')], { stdio: 'inherit' })
  if (build.status !== 0) { console.error('[release-prep] FAIL: build failed'); process.exit(1) }
}
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
const imp = spawnSync(process.execPath, ['--input-type=module', '-e', "const m = await import('dsh-worktable'); const k = Object.keys(m); if (!['apply','inject','name','HEALTH_PATH'].every(x => k.includes(x))) { console.error('missing exports: ' + k.join(',')); process.exit(3) }"], { cwd: inst, stdio: 'pipe', encoding: 'utf8' })
if (imp.status !== 0) { console.error('[release-prep] FAIL: import() assertion'); console.error(imp.stderr); process.exit(1) }
console.log('[release-prep] install + import assertion passed')

// ---------- 6. 双资产从同一已验证包复制 + SHA-256 ----------
const fixedDir = join(HERE, 'dist')
mkdirSync(fixedDir, { recursive: true })
const assetFixed = join(fixedDir, 'dsh-worktable.tgz')
const assetVer = join(fixedDir, 'dsh-worktable-' + VERSION + '.tgz')
copyFileSync(tgz, assetFixed)
copyFileSync(tgz, assetVer)
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
console.log('[release-prep] DONE — 双资产同源（同 SHA-256）:')
console.log('  dist/dsh-worktable.tgz           sha256:' + sha(assetFixed))
console.log('  dist/dsh-worktable-' + VERSION + '.tgz sha256:' + sha(assetVer))
console.log('[release-prep] 提示：本脚本未推送、未打 tag、未发布。请用 gh 手动上传双资产并下载远端比对。')
rmSync(work, { recursive: true, force: true })
