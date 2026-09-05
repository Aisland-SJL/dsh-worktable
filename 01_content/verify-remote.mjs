/**
 * dsh-worktable 发布后验证（独立于 release-prep 的发布前验证）。
 *
 * 远端只读：本脚本只做 GET 下载与本地核对，绝不上传/删除/覆盖/发布任何 GitHub 内容。
 * 本地副作用：在临时目录下载/解包/安装(--ignore-scripts)/执行服务端 import 断言，结束后删除临时目录。
 * 核对项：latest 固定名资产 + 版本化资产（用包内版本拼出），对每个资产：
 *   文件名、SHA-256（必须等于 --expect-sha 提供的发布前验收 SHA，防止"双资产同错"）、
 *   包结构（package/ 前缀 + 精确 7 文件）、包内版本、npm 安装 + import 断言。
 *
 * 用法：
 *   node verify-remote.mjs [--expect-sha <sha256>] [tag]
 *   # 不传 tag = releases/latest；--expect-sha 来自 release-prep 输出的 dist SHA
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execPath } from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
function npmCliPath() {
  const nodeDir = dirname(execPath)
  const c = [join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].filter((p) => existsSync(p))
  return c[0] ?? 'npm'
}

const REPO = 'Aisland-SJL/dsh-worktable'
// 参数严格解析：--expect-sha <64位hex> [tag]；缺值/非 hex/重复参数/多余 tag 一律拒绝
const args = process.argv.slice(2)
let EXPECT_SHA = null
let TAG = ''
let sawSha = false
let sawTag = false
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--expect-sha') {
    if (sawSha) { console.error('[verify-remote] FAIL: --expect-sha given twice'); process.exit(1) }
    const v = args[++i]
    if (!v || !/^[0-9a-fA-F]{64}$/.test(v)) { console.error('[verify-remote] FAIL: --expect-sha needs a 64-hex sha256 value, got ' + JSON.stringify(v ?? '')); process.exit(1) }
    EXPECT_SHA = v.toLowerCase()
    sawSha = true
    continue
  }
  if (a.startsWith('-')) { console.error('[verify-remote] FAIL: unknown option ' + JSON.stringify(a)); process.exit(1) }
  if (sawTag) { console.error('[verify-remote] FAIL: more than one tag given (' + JSON.stringify(TAG) + ' and ' + JSON.stringify(a) + ')'); process.exit(1) }
  TAG = a
  sawTag = true
}
// latest 用特殊路径 /releases/latest/download/<asset>；具体 tag 用 /releases/download/<tag>/<asset>（tag 保留 v 前缀）
const assetBase = TAG === '' ? 'https://github.com/' + REPO + '/releases/latest/download/' : 'https://github.com/' + REPO + '/releases/download/' + TAG + '/'

function httpGet(url, outFile) {
  // PowerShell Invoke-WebRequest：走 WinINET 系统代理（本机网络环境需要）；-L 行为由 IWR 自动跟随重定向
  const ps = "try { Invoke-WebRequest -Uri '" + url.replace(/'/g, "''") + "' -OutFile '" + outFile.replace(/'/g, "''") + "' -UseBasicParsing -TimeoutSec 90 -ErrorAction Stop | Out-Null; exit 0 } catch { Write-Error ($_.Exception.Message); exit 1 }"
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'pipe', encoding: 'utf8' })
  if (r.status !== 0) { console.error((r.stderr || r.stdout || '').slice(0, 500)); return false }
  return true
}

const work = join(tmpdir(), 'wt-verify-remote-' + Date.now())
mkdirSync(work, { recursive: true })

// 1. 下载 latest 固定名资产
const fixedUrl = assetBase + 'dsh-worktable.tgz'
const fixedFile = join(work, 'dsh-worktable.tgz')
console.log('[verify-remote] GET ' + fixedUrl)
if (!httpGet(fixedUrl, fixedFile)) { console.error('[verify-remote] FAIL: download fixed-name asset'); process.exit(1) }

// 2. 解包读版本，拼版本化 URL 并下载
const listTar = spawnSync('tar', ['-tzf', fixedFile], { encoding: 'utf8' })
if (listTar.status !== 0) { console.error('[verify-remote] FAIL: tar -tzf'); process.exit(1) }
const entries = listTar.stdout.split(/\r?\n/).filter(Boolean)
const EXPECTED = ['package/LICENSE','package/README.md','package/cordis.patch.yml','package/dsh.plugin.json','package/lib/client.js','package/lib/index.js','package/package.json']
const okStruct = entries.length === EXPECTED.length && EXPECTED.every((e) => entries.includes(e))
if (!okStruct) { console.error('[verify-remote] FAIL: structure mismatch: ' + entries.join(',')); process.exit(1) }
console.log('[verify-remote] structure ok (7 files)')
const ext = join(work, 'ext'); mkdirSync(ext, { recursive: true })
const x = spawnSync('tar', ['-xzf', fixedFile, '-C', ext])
if (x.status !== 0) { console.error('[verify-remote] FAIL: tar extract'); process.exit(1) }
const pkg = JSON.parse(readFileSync(join(ext, 'package', 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(ext, 'package', 'dsh.plugin.json'), 'utf8'))
if (pkg.version !== manifest.version) { console.error('[verify-remote] FAIL: version mismatch pkg=' + pkg.version + ' manifest=' + manifest.version); process.exit(1) }
if (TAG !== '' && TAG !== 'v' + pkg.version) { console.error('[verify-remote] FAIL: tag ' + TAG + ' != v' + pkg.version + ' (包内版本与请求 tag 不一致)'); process.exit(1) }
console.log('[verify-remote] version = ' + pkg.version)

const verUrl = assetBase + 'dsh-worktable-' + pkg.version + '.tgz'
const verFile = join(work, 'dsh-worktable-' + pkg.version + '.tgz')
console.log('[verify-remote] GET ' + verUrl)
if (!httpGet(verUrl, verFile)) { console.error('[verify-remote] FAIL: download versioned asset'); process.exit(1) }

// 3. SHA 比对（必须先于安装/执行代码）：双资产彼此同源 且 都等于发布前验收 SHA
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const shaFixed = sha(fixedFile)
const shaVer = sha(verFile)
console.log('[verify-remote] fixed-name sha256: ' + shaFixed)
console.log('[verify-remote] versioned  sha256: ' + shaVer)
if (shaFixed !== shaVer) { console.error('[verify-remote] FAIL: two assets differ'); process.exit(1) }
if (EXPECT_SHA) {
  if (shaFixed !== EXPECT_SHA) { console.error('[verify-remote] FAIL: sha mismatch — got ' + shaFixed + ', expected (release-prep) ' + EXPECT_SHA + ' — 上传的不是本地验收过的包'); process.exit(1) }
  console.log('[verify-remote] sha matches release-prep expectation: ' + EXPECT_SHA)
} else {
  console.log('[verify-remote] 提示: 未提供 --expect-sha，未做「远端=本地验收包」比对（建议从 release-prep 输出传入）')
}

// 4. 版本化资产安装 + import 断言（独立临时目录；--ignore-scripts 防包脚本副作用；import 会执行服务端模块顶层代码，属功能验证所需）
const inst = join(work, 'inst'); mkdirSync(inst, { recursive: true })
writeFileSync(join(inst, 'package.json'), JSON.stringify({ name: 'wt-verify-test', version: '0.0.0', private: true }))
const ins = spawnSync(process.execPath, [npmCliPath(), 'install', verFile, '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error'], { cwd: inst, stdio: 'pipe', encoding: 'utf8' })
if (ins.status !== 0) { console.error('[verify-remote] FAIL: npm install'); console.error(ins.stderr); process.exit(1) }
const imp = spawnSync(process.execPath, ['--input-type=module', '-e', "const m = await import('dsh-worktable'); if (typeof m.apply !== 'function' || !Array.isArray(m.inject) || m.name !== 'dsh-worktable' || m.HEALTH_PATH !== '/api/worktable/health') process.exit(3); console.log('import ok')"], { cwd: inst, stdio: 'pipe', encoding: 'utf8' })
if (imp.status !== 0) { console.error('[verify-remote] FAIL: import assertion'); console.error(imp.stderr); process.exit(1) }

if (EXPECT_SHA) {
  console.log('[verify-remote] PASS: ' + (TAG === '' ? 'latest' : TAG) + ' — 文件名/结构/版本(' + pkg.version + ')/SHA 同源+远端=验收SHA/安装/导入 全部通过（远端只读，本地仅临时目录）——构成发布验收')
} else {
  console.log('[verify-remote] INSPECT-ONLY PASS: ' + (TAG === '' ? 'latest' : TAG) + ' — 文件名/结构/版本(' + pkg.version + ')/SHA 同源/安装/导入 通过，但未提供 --expect-sha，未做远端=本地验收包比对，**不构成发布验收**（远端只读，本地仅临时目录）')
}
rmSync(work, { recursive: true, force: true })

