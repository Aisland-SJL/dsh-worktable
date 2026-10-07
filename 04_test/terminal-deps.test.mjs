/**
 * 终端依赖解析回归（link: 安装下 node-pty/ws 必须在位）。
 *
 * 症状：link: 模式安装后终端窗显示「终端不可用（宿主缺少 node-pty/ws 或连接失败）」。
 *
 * 根因：loadPkg 从「插件自身模块位置」向祖先方向找依赖。file: 模式时插件实体位于
 * profile 的 pnpm 结构内，祖先链上能撞到 profile 级 node_modules；link: 模式时
 * 模块 realpath 指向源码目录（如 F:/Project/...），祖先链上没有任何 profile 或宿主依赖，
 * 而原兜底只枚举 profiles/<名字>/node_modules，**既漏了 profiles/node_modules 共享层，
 * 也从不探测宿主运行时（Electron 桌面端把 ws / node-pty 随宿主分发在 resources/app/node_modules）**。
 * 于是 node-pty 解析失败、终端路由不注册、客户端显示降级提示。
 *
 * 用法：node terminal-deps.test.mjs [lib/index.js 路径]
 *
 * 判据：在「模拟 Electron 宿主（设置 process.resourcesPath）」与「模拟 link: 源码位」
 * 两种起点下，apply() 自报的 term deps 都必须 ws=ok node-pty=ok。
 * 用「日志行」而不是内部函数做断言，避免把实现细节写进测试。
 *
 * 突变体验证法：删掉 loadPkg 里 hostRuntimeModuleDirs() 那段 → 本测试必须红。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE = resolve(process.argv[2] ?? join(HERE, '..', '01_content', 'lib', 'index.js'))

let pass = 0
const failures = []
const fail = (name, detail) => { failures.push(name + ': ' + detail); console.error('FAIL(' + name + '): ' + detail) }
const ok = (name) => { console.log('ok   ' + name); pass++ }

if (!existsSync(BUNDLE)) { console.error('FAIL: bundle missing: ' + BUNDLE); process.exit(1) }

/**
 * 在子进程里加载插件并采集它自报的 term deps 行。
 * 用「真机可用的宿主目录」作为 resourcesPath：桌面端 resources/app/node_modules 里确有 ws+node-pty。
 * 若本机没有该目录（非桌面端环境），退回一个人造夹具目录，保证断言仍然有效。
 */
function probeTermDeps(resourcesPath, dshHome) {
  const script = [
    "process.resourcesPath = process.argv[2]",
    "const { pathToFileURL } = await import('node:url')",
    "const mod = await import(pathToFileURL(process.argv[1]).href)",
    "const lines = []",
    "const ctx = {",
    "  webServer: { register: () => {}, registerUpgrade: () => {} },",
    "  effect: () => {},",
    "  logger: { warn: (m) => lines.push('WARN:' + m), info: (m) => lines.push('INFO:' + m) },",
    "  sessions: {}, get: () => undefined,",
    "}",
    "mod.apply(ctx)",
    "console.log('TERMDEP::' + lines.filter((l) => l.includes('term deps')).join('|'))",
    "console.log('ALLWARN::' + lines.filter((l) => l.startsWith('WARN:')).join('|'))",
  ].join('\n')
  const env = { ...process.env }
  // 隔离 DSH_HOME 时，loadPkg 的 profiles 兜底也不会命中真实用户 profile
  if (dshHome) env.DSH_HOME = dshHome
  else delete env.DSH_HOME
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, BUNDLE, resourcesPath], {
    encoding: 'utf8', timeout: 20000, env,
  })
  if (r.error) return { error: String(r.error.message) }
  if (r.status !== 0) return { error: 'exit=' + r.status + ' stderr=' + String(r.stderr || '').slice(0, 300) }
  const lines = (r.stdout || '').split(/\r?\n/)
  const termLine = lines.find((l) => l.startsWith('TERMDEP::')) || ''
  const warnLine = lines.find((l) => l.startsWith('ALLWARN::')) || ''
  return {
    raw: termLine.replace('TERMDEP::', ''),
    warnings: warnLine.replace('ALLWARN::', ''),
    stdout: r.stdout || '',
  }
}

// —— 夹具：人造 Electron 宿主目录，内含 ws 与 node-pty 两个可解析的包 ——
const fixtureRoot = mkdtempSync(join(tmpdir(), 'wt-termdeps-'))
const appNm = join(fixtureRoot, 'app', 'node_modules')
mkdirSync(join(appNm, 'ws'), { recursive: true })
mkdirSync(join(appNm, 'node-pty'), { recursive: true })
for (const name of ['ws', 'node-pty']) {
  writeFileSync(join(appNm, name, 'package.json'),
    JSON.stringify({ name, version: '1.0.0-test', main: 'index.js' }), 'utf8')
  writeFileSync(join(appNm, name, 'index.js'), 'module.exports = { fixture: true }\n', 'utf8')
}

try {
  // —— A. 模拟 Windows 桌面端宿主（resourcesPath 指向含 ws/node-pty 的宿主目录）——
  {
    const out = probeTermDeps(fixtureRoot)
    if (out.error) { fail('A.宿主依赖', out.error) }
    else if (!/ws=ok/.test(out.raw)) { fail('A.宿主依赖', 'ws 未解析到：' + JSON.stringify(out.raw)) }
    else if (!/node-pty=ok/.test(out.raw)) {
      fail('A.宿主依赖', 'node-pty 未解析到（link: 安装下终端不可用）：' + JSON.stringify(out.raw))
    } else ok('A. 宿主运行时目录含 ws+node-pty 时两者均可解析')
  }

  // —— B. 全隔离（空宿主目录 + 空 DSH_HOME）时必须优雅降级 ——
  // 说明：只有把 DSH_HOME 也指向空夹具，才能排除真实 profile 层的 ws；
  // 否则 ws 会合法地从 profile 解析到，本场景就失去判别力。
  {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'wt-termdeps-empty-'))
    const emptyHome = mkdtempSync(join(tmpdir(), 'wt-termdeps-home-'))
    mkdirSync(join(emptyRoot, 'app', 'node_modules'), { recursive: true })
    mkdirSync(join(emptyHome, 'profiles'), { recursive: true })
    const out = probeTermDeps(emptyRoot, emptyHome)
    if (out.error) { fail('B.降级', out.error) }
    else if (/ws=ok|node-pty=ok/.test(out.raw)) {
      fail('B.降级', '全隔离夹具下不应解析到依赖，实得：' + JSON.stringify(out.raw))
    } else if (!out.warnings) {
      fail('B.降级', '依赖缺失时未给出降级警告；term=' + JSON.stringify(out.raw))
    } else ok('B. 宿主与 profile 均无依赖时优雅降级（MISSING + 警告，不崩溃）')
    rmSync(emptyRoot, { recursive: true, force: true })
    rmSync(emptyHome, { recursive: true, force: true })
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}

if (failures.length) {
  console.error('\nterminal-deps tests FAILED: ' + failures.length + ' failure(s)')
  process.exitCode = 1
} else {
  console.log('all terminal-deps tests passed: ' + pass + '/' + pass)
}
