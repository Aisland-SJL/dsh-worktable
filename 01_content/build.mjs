/**
 * dsh-worktable 构建：
 *   - lib/index.js    服务端 ESM（cordis 插件，健康路由）
 *   - lib/client.js   客户端单文件 CJS（window.__ModuleLoader__.load 握手；
 *                     react / @deepseek-ai/* 由宿主模块系统提供，保持 external）
 * esbuild 优先用本包 node_modules 的平台二进制，其次复用相邻项目 vendor。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
mkdirSync(join(here, 'lib'), { recursive: true })

const esbuildCandidates = [
  join(here, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
  join(here, '..', '..', 'dsh-travelatlas', 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
]
const esbuildBin = esbuildCandidates.find((p) => existsSync(p))
if (!esbuildBin) {
  console.error('[dsh-worktable build] 找不到 esbuild.exe：请先在 01_content 运行 npm install')
  process.exit(1)
}
console.log('[dsh-worktable build] esbuild: ' + esbuildBin)

const clientBanner = {
  js: "window.__ModuleLoader__.load({ id: 'dsh-worktable', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
}
const clientFooter = { js: 'return module.exports; } });' }

const jobs = [
  {
    entryPoints: [join(here, 'src/index.ts')], outfile: 'lib/index.js',
    platform: 'node', format: 'esm', target: ['node22'],
    external: ['@deepseek-ai/*', 'node:*', 'ws', 'node-pty'],
  },
  {
    entryPoints: [join(here, 'src/client/index.tsx')], outfile: 'lib/client.js',
    platform: 'browser', format: 'cjs', target: ['es2022'], jsx: 'automatic',
    external: ['@deepseek-ai/*', 'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
    banner: clientBanner, footer: clientFooter,
  },
]

for (const job of jobs) {
  const args = [
    ...job.entryPoints,
    '--bundle', '--sourcemap', '--log-level=info',
    '--platform=' + job.platform,
    '--format=' + job.format,
    '--target=' + job.target.join(','),
    '--outfile=' + join(here, job.outfile),
    ...job.external.map((e) => '--external:' + e),
  ]
  if (job.jsx) args.push('--jsx=' + job.jsx)
  if (job.banner) args.push('--banner:js=' + job.banner.js)
  if (job.footer) args.push('--footer:js=' + job.footer.js)
  execFileSync(esbuildBin, args, { stdio: 'inherit' })
}
console.log('[dsh-worktable build] done: lib/index.js, lib/client.js')
