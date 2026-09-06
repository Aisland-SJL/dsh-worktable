/**
 * 服务端数据目录解析回归测试（Codex 对抗审查：loadPkg ↔ resolveDshHomeSafe 循环调用 + 降级规则对齐官方）。
 * 用法：node server-home.test.mjs [lib/index.js 路径]（缺省 = 工作目录构建产物）
 *
 * 场景（全部在子进程隔离目录中运行，父进程不改环境变量、不残留临时目录）：
 *   A. 官方分支：隔离目录里「明确准备官方工具包夹具」（与 @deepseek-ai/dsh-home-paths 同布局、同实现语义），
 *      断言 homeSource=official（证明代码确实走了官方分支并调用其 resolveDshHome）+ 探测次数有界 + 内容正确
 *   B. BOM 容忍：状态码 + 解析后内容双断言
 *   C. 兜底分支：官方包不可解析 → homeSource=fallback + 探测次数有界 + 内容正确（旧代码循环重入会产生上万次探测）
 *   D/E/F. ~ / ~/ / ~\ 前缀展开与相对路径：断言错误信息包含「JSON 转义后的完整预期绝对路径」
 * 说明：DSH_HOME 空/纯空白 → 默认 ~/.dsh（真实目录）——测试刻意不触发，避免读取真实用户数据。
 * 失败路径不调用 process.exit（避免跳过 finally），统一收口到 process.exitCode。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// 构建产物路径参数化：发布脚本传入「已安装包内」的 lib/index.js；缺省回退工作目录构建产物
const BUNDLE_SRC = resolve(process.argv[2] ?? join(HERE, '..', '01_content', 'lib', 'index.js'))

// 探测次数上界：正常解析（祖先链 + profiles 枚举）远低于此；旧代码循环重入会达到数千次
const PROBE_BOUND = 100

let pass = 0
const failures = []
function fail(name, detail) {
  failures.push(name + ': ' + detail)
  console.error('FAIL(' + name + '): ' + detail)
}
const ok = (name) => { console.log('ok   ' + name); pass++ }

/** 临时 DSH 数据目录（含 storages/workspace.json 标记内容；无 BOM） */
function makeHome(marker) {
  const home = mkdtempSync(join(tmpdir(), 'wt-home-test-'))
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['fake-' + marker], archivedSessionIds: [] },
    tables: { workspaces: { ['fake-' + marker]: { title: marker, sessionIds: ['s-' + marker] } } },
  }), 'utf8')
  return home
}

/**
 * 子进程跑一个隔离场景：
 * - withOfficial=true 时，在隔离目录 node_modules 下「明确准备官方工具包夹具」
 *   （与 @deepseek-ai/dsh-home-paths 同布局：lib/index.js 导出 resolveDshHome/expandHomePath/defaultDshHome，
 *   实现为其公开文档语义的忠实镜像）——验证我们调用官方分支与返回值处理的集成，
 *   上游包自身语义由官方维护；夹具不引入生产依赖。
 */
function runChild(envHome, name, withOfficial = false) {
  const isoDir = mkdtempSync(join(tmpdir(), 'wt-home-iso-'))
  let home = null
  try {
    mkdirSync(join(isoDir, 'lib'), { recursive: true })
    copyFileSync(BUNDLE_SRC, join(isoDir, 'lib', 'index.js'))
    if (withOfficial) {
      const pkgDir = join(isoDir, 'node_modules', '@deepseek-ai', 'dsh-home-paths')
      mkdirSync(join(pkgDir, 'lib'), { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-home-paths', version: '0.1.2-rc.1', type: 'module', main: 'lib/index.js' }), 'utf8')
      writeFileSync(join(pkgDir, 'lib', 'index.js'), [
        "import { homedir } from 'node:os'",
        "import { join, resolve } from 'node:path'",
        "export const DSH_HOME_DIR_NAME = '.dsh'",
        "export function defaultDshHome() { return join(homedir(), DSH_HOME_DIR_NAME) }",
        "export function expandHomePath(path) {",
        "  if (path === '~') return homedir()",
        "  if (path.startsWith('~/') || path.startsWith('~' + String.fromCharCode(92))) return join(homedir(), path.slice(2))",
        "  return path",
        "}",
        "export function resolveDshHome(configured, env = process.env) {",
        "  const fromEnv = env['DSH_HOME']",
        "  return resolve(expandHomePath(configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : defaultDshHome())))",
        "}",
        "export function dshHomePath(...segments) { return join(resolveDshHome(), ...segments) }",
        "export function dshHomeDisplay(resolvedHome) {",
        "  return resolvedHome === resolve(defaultDshHome()) ? '~/.dsh' : '$DSH_HOME'",
        "}",
        "export const DSH_HOME_ENV = 'DSH_HOME'",
        "export const DEFAULT_DSH_HOME_DISPLAY = '~/.dsh'",
      ].join('\n'), 'utf8')
    }
    const homeVal = envHome === undefined ? (home = makeHome('MARKER_' + name)) : envHome
    const script = [
      "import { pathToFileURL } from 'node:url'",
      "import { resolve as pResolve, join as pJoin } from 'node:path'",
      "import { homedir } from 'node:os'",
      "const mod = await import(pathToFileURL(process.argv[1]).href)",
      "const routes = []",
      "const fakeCtx = { webServer: { register: (r) => { routes.push(r) } }, effect: () => {}, logger: { warn() {}, info() {} } }",
      "mod.apply(fakeCtx)",
      "const route = routes.find((r) => r.path === '/api/worktable/workspaces')",
      "let status = 0; let body = ''",
      "const res = { writeHead(s) { status = s }, end(b) { body = String(b) } }",
      "await route.handler({}, res)",
      "const stats = mod.__wtLoadProbeStats ? mod.__wtLoadProbeStats() : null",
      "const raw = process.env.DSH_HOME || ''",
      "const BS = String.fromCharCode(92)",
      "const expanded = raw === '~' ? homedir() : (raw.startsWith('~/') || raw.startsWith('~' + BS)) ? pJoin(homedir(), raw.slice(2)) : raw",
      "const expectedFull = pResolve(expanded, 'storages', 'workspace.json')",
      "const expectedEncoded = JSON.stringify(expectedFull).slice(1, -1)",
      "console.log(JSON.stringify({ status, body: body.slice(0, 500), stats, expectedFull, fullMatch: body.includes(expectedEncoded) }))",
    ].join('\n')
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, join(isoDir, 'lib', 'index.js')], {
      env: { ...process.env, DSH_HOME: homeVal ?? '' },
      encoding: 'utf8',
      timeout: 15000,
    })
    if (r.error) { fail(name, 'spawn error: ' + r.error.message); return null }
    if (r.status !== 0) { fail(name, 'exit=' + r.status + ' stderr=' + (r.stderr || '').slice(0, 400)); return null }
    return JSON.parse(r.stdout.trim().split('\n').pop())
  } finally {
    rmSync(isoDir, { recursive: true, force: true })
    if (home) rmSync(home, { recursive: true, force: true })
  }
}

// —— A+B. 官方分支（测试环境明确准备官方夹具）+ BOM 容忍 ——
{
  const out = runChild(undefined, 'A', true)
  if (!out) fail('A.官方路径', 'child did not return')
  else {
    if (out.status !== 200) fail('A.官方路径', 'status=' + out.status + ' body=' + out.body.slice(0, 120))
    else {
      try {
        const parsed = JSON.parse(out.body)
        if (parsed.tables?.workspaces?.['fake-MARKER_A']?.title !== 'MARKER_A') fail('A.官方路径', 'content mismatch: ' + out.body.slice(0, 160))
      } catch { fail('A.官方路径', 'body not JSON: ' + out.body.slice(0, 160)) }
    }
    if (!out.stats) fail('A.官方路径', '__wtLoadProbeStats missing')
    else {
      if (out.stats.homeSource !== 'official') fail('A.官方路径', 'homeSource=' + out.stats.homeSource + ' (expect official; 场景 A 必须证明官方分支被实际调用)')
      if (out.stats.attempts > PROBE_BOUND) fail('A.官方路径', 'probe attempts=' + out.stats.attempts + ' > ' + PROBE_BOUND)
    }
    // BOM 容忍：在子进程里没法重写（缓存单次解析），这里再跑一次带 BOM 夹具文件的场景 B
  }
  // B. BOM：单独子进程，写入带 BOM 的 workspace.json
  const outB = (() => {
    const isoDir = mkdtempSync(join(tmpdir(), 'wt-home-iso-'))
    let home = null
    try {
      mkdirSync(join(isoDir, 'lib'), { recursive: true })
      copyFileSync(BUNDLE_SRC, join(isoDir, 'lib', 'index.js'))
      const pkgDir = join(isoDir, 'node_modules', '@deepseek-ai', 'dsh-home-paths')
      mkdirSync(join(pkgDir, 'lib'), { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-home-paths', version: '0.1.2-rc.1', type: 'module', main: 'lib/index.js' }), 'utf8')
      writeFileSync(join(pkgDir, 'lib', 'index.js'), [
        "import { homedir } from 'node:os'",
        "import { join, resolve } from 'node:path'",
        "export function resolveDshHome(configured, env = process.env) {",
        "  const fromEnv = env['DSH_HOME']",
        "  return resolve(configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')))",
        "}",
      ].join('\n'), 'utf8')
      home = makeHome('MARKER_B')
      const file = join(home, 'storages', 'workspace.json')
      writeFileSync(file, '\uFEFF' + readFileSync(file, 'utf8'), 'utf8')
      const script = [
        "import { pathToFileURL } from 'node:url'",
        "const mod = await import(pathToFileURL(process.argv[1]).href)",
        "const routes = []",
        "const fakeCtx = { webServer: { register: (r) => { routes.push(r) } }, effect: () => {}, logger: { warn() {}, info() {} } }",
        "mod.apply(fakeCtx)",
        "const route = routes.find((r) => r.path === '/api/worktable/workspaces')",
        "let status = 0; let body = ''",
        "const res = { writeHead(s) { status = s }, end(b) { body = String(b) } }",
        "await route.handler({}, res)",
        "console.log(JSON.stringify({ status, body: body.slice(0, 500) }))",
      ].join('\n')
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, join(isoDir, 'lib', 'index.js')], {
        env: { ...process.env, DSH_HOME: home },
        encoding: 'utf8',
        timeout: 15000,
      })
      if (r.error) { fail('B.BOM', 'spawn error: ' + r.error.message); return null }
      if (r.status !== 0) { fail('B.BOM', 'exit=' + r.status + ' stderr=' + (r.stderr || '').slice(0, 400)); return null }
      return JSON.parse(r.stdout.trim().split('\n').pop())
    } finally {
      rmSync(isoDir, { recursive: true, force: true })
      if (home) rmSync(home, { recursive: true, force: true })
    }
  })()
  if (outB) {
    let parsed = null
    try { parsed = JSON.parse(outB.body) } catch {}
    if (outB.status !== 200 || !parsed || parsed.tables?.workspaces?.['fake-MARKER_B']?.title !== 'MARKER_B') fail('B.BOM', 'status=' + outB.status + ' body=' + outB.body.slice(0, 160))
  }
  if (!failures.some((f) => f.startsWith('A.')) && !failures.some((f) => f.startsWith('B.'))) ok('A+B. 官方分支（夹具验证 homeSource=official + 有界探测）+ BOM 容忍')
}

// —— C. 兜底分支：官方包不可解析 → baseDshHome，且探测次数有界（循环回归） ——
{
  const out = runChild(undefined, 'C')
  if (!out) fail('C.兜底路径', 'child did not return')
  else {
    if (out.status !== 200) fail('C.兜底路径', 'status=' + out.status + ' body=' + out.body.slice(0, 200))
    if (!out.body.includes('MARKER_C')) fail('C.兜底路径', 'content mismatch: ' + out.body.slice(0, 200))
    if (!out.stats) fail('C.兜底路径', '__wtLoadProbeStats missing')
    else {
      if (out.stats.homeSource !== 'fallback') fail('C.兜底路径', 'homeSource=' + out.stats.homeSource + ' (expect fallback)')
      if (out.stats.attempts > PROBE_BOUND) fail('C.兜底路径', 'probe attempts=' + out.stats.attempts + ' > ' + PROBE_BOUND + '（疑似循环重入）')
    }
  }
  if (!failures.some((f) => f.startsWith('C.'))) ok('C. 官方包不可解析 → baseDshHome 兜底（homeSource=fallback + 探测有界 + 内容正确）')
}

// —— D/E/F. ~ / ~/ / ~\ 前缀展开 + 相对路径：完整绝对路径断言 ——
{
  const cases = [
    ['D.波浪号', '~/__wt_probe_tilde__'],
    ['E.相对路径', '__wt_probe_rel__'],
    ['F.反斜杠波浪号', '~' + String.fromCharCode(92) + '__wt_probe_bs__'],
  ]
  for (const [label, envVal] of cases) {
    const out = runChild(envVal, label.replace(/^\w\./, ''))
    if (!out) { fail(label, 'child did not return'); continue }
    if (out.status !== 404) { fail(label, 'expect 404, got ' + out.status + ' ' + out.body.slice(0, 120)); continue }
    if (out.fullMatch !== true) fail(label, 'error missing FULL path: expected ' + out.expectedFull + ' body=' + out.body.slice(0, 200))
  }
  if (!failures.some((f) => /^[DEF]\./.test(f))) ok('D+E+F. ~ 与 ~/ 与 ~\\ 前缀展开 + 相对路径按 cwd 解析（完整绝对路径断言）')
}

console.log('all server-home tests passed: ' + pass + ' scenarios, ' + failures.length + ' failures')
process.exitCode = failures.length > 0 ? 1 : 0
