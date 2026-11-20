import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(__dirname, '../01_content/package.json'))
const esbuild = require('esbuild')
const srcDir = resolve(__dirname, '../01_content/src/client')

async function loadModules() {
  const dp = await esbuild.build({
    entryPoints: [resolve(srcDir, 'directoryPicker.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  })
  const loc = await esbuild.build({
    entryPoints: [resolve(srcDir, 'locales.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  })
  const dpMod = await import('data:text/javascript;base64,' + Buffer.from(dp.outputFiles[0].text).toString('base64'))
  const locMod = await import('data:text/javascript;base64,' + Buffer.from(loc.outputFiles[0].text).toString('base64'))
  return { ...dpMod, ...locMod }
}

test('falls back to browse modal when pick rejects with composed picker serves "browse"', async () => {
  const { pickDirectoryWithFallback } = await loadModules()
  let browseCalls = 0
  let listedPath
  const ctx = {
    get(name) {
      if (name === 'remote.directoryPicker') {
        return {
          pick: async () => ({
            ok: false,
            error: {
              code: 'capability-unavailable',
              message: 'directoryPicker.pick needs the native capability; the composed picker serves "browse"',
            },
          }),
        }
      }
      if (name === 'uiWorkspace') {
        return {
          listDirectory: async (path) => {
            listedPath = path
            return { path: '/home/coder', home: '/home/coder', crumbs: [], entries: [], truncated: false }
          },
          createDirectory: async (parent, name) => `${parent}/${name}`,
        }
      }
      return undefined
    },
  }

  const res = await pickDirectoryWithFallback({
    ctx,
    workspaces: null,
    openBrowse: async (face) => {
      browseCalls++
      const listing = await face.listDirectory('/home/coder/workspace')
      assert.equal(listing.path, '/home/coder')
      return '/home/coder/workspace/demo'
    },
  })

  assert.equal(browseCalls, 1)
  assert.equal(listedPath, '/home/coder/workspace')
  assert.deepEqual(res, { status: 'picked', path: '/home/coder/workspace/demo' })
})

test('prefers browse directly when BrowseDirectoryFlow occupies sidebar.workspaces.directoryFlow', async () => {
  const { pickDirectoryWithFallback } = await loadModules()
  function BrowseDirectoryFlow() {}
  let pickCalled = false
  const ctx = {
    slots: {
      entries(name) {
        if (name === 'sidebar.workspaces.directoryFlow') return [{ component: BrowseDirectoryFlow }]
        return []
      },
    },
    get(name) {
      if (name === 'uiWorkspace') {
        return {
          pickDirectory: async () => {
            pickCalled = true
            throw new Error('should not invoke native pick')
          },
          listDirectory: async () => ({ path: '/home/coder', home: '/home/coder', crumbs: [], entries: [], truncated: false }),
        }
      }
      return undefined
    },
  }

  const res = await pickDirectoryWithFallback({
    ctx,
    workspaces: null,
    openBrowse: async () => '/home/coder/Worktable',
  })

  assert.equal(pickCalled, false)
  assert.deepEqual(res, { status: 'picked', path: '/home/coder/Worktable' })
})

test('uses native picker when NativeDirectoryFlow or legacy workspaces.pickDirectory is active', async () => {
  const { pickDirectoryWithFallback } = await loadModules()
  function NativeDirectoryFlow() {}
  let browseOpened = false
  const ctx = {
    slots: {
      entries(name) {
        if (name === 'sidebar.workspaces.directoryFlow') return [{ component: NativeDirectoryFlow }]
        return []
      },
    },
    get(name) {
      if (name === 'uiWorkspace') {
        return {
          pickDirectory: async () => '/Users/me/Projects',
          listDirectory: async () => ({ path: '/', home: '/', crumbs: [], entries: [], truncated: false }),
        }
      }
      if (name === 'remote.directoryPicker') {
        return { pick: async () => ({ ok: true, value: '/Users/me/Projects' }) }
      }
      return undefined
    },
  }

  const nativeRes = await pickDirectoryWithFallback({
    ctx,
    workspaces: null,
    openBrowse: async () => {
      browseOpened = true
      return null
    },
  })
  assert.equal(browseOpened, false)
  assert.deepEqual(nativeRes, { status: 'picked', path: '/Users/me/Projects' })

  const legacyRes = await pickDirectoryWithFallback({
    ctx: {},
    workspaces: { pickDirectory: async () => '/legacy/dir' },
    openBrowse: async () => null,
  })
  assert.deepEqual(legacyRes, { status: 'picked', path: '/legacy/dir' })
})

test('returns unavailable when neither native nor browse backend exists', async () => {
  const { pickDirectoryWithFallback } = await loadModules()
  const res = await pickDirectoryWithFallback({
    ctx: { get: () => undefined },
    workspaces: null,
    openBrowse: async () => null,
  })
  assert.deepEqual(res, { status: 'unavailable' })
})

test('locale zh and en dictionaries stay symmetric', async () => {
  const { zh, en } = await loadModules()
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('built client.js passes factory gate and contains FolderBrowserModal strings', () => {
  const clientCode = readFileSync(resolve(__dirname, '../01_content/lib/client.js'), 'utf8')
  assert.ok(clientCode.includes('dsh-wt_browseDialog'))
  assert.ok(clientCode.includes('serves'))
})
