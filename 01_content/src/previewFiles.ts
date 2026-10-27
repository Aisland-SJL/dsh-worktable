import { randomBytes } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const PREVIEW_PREFIX = '/api/worktable/preview-static'
export const PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-downloads'
export const PREVIEW_CSP = `sandbox ${PREVIEW_SANDBOX}; base-uri 'none'; object-src 'none'; frame-src 'none'`
export const PREVIEW_MAX_BYTES = 40 * 1024 * 1024
const IDLE_MS = 30 * 60 * 1000
const MAX_MOUNTS = 128

function inside(root: string, file: string): boolean {
  const rel = relative(root, file)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
}

/** Short-lived read-only capabilities. They grant one directory, never host APIs. */
export function createPreviewFiles(now = () => Date.now()) {
  const mounts = new Map<string, { root: string; touched: number }>()
  const prune = () => { for (const [key, item] of mounts) if (now() - item.touched >= IDLE_MS) mounts.delete(key) }
  return {
    async mount(root: string) {
      if (!isAbsolute(root)) throw new Error('Preview root must be absolute')
      const canonical = await realpath(root)
      if (!(await stat(canonical)).isDirectory()) throw new Error('Preview root is not a directory')
      prune()
      if (mounts.size >= MAX_MOUNTS) throw new Error('Too many open previews; close an unused preview first')
      const token = randomBytes(24).toString('base64url')
      mounts.set(token, { root: canonical, touched: now() })
      return token
    },
    revoke(token: string) { mounts.delete(token) },
    clear() { mounts.clear() },
    async file(token: string, segments: string[], headOnly = false) {
      prune()
      const mount = mounts.get(token)
      if (!mount) return null
      // Decode exactly once before this call; forbid separators embedded in a segment.
      if (segments.some(s => s === '..' || s.includes('/') || s.includes('\\') || s.includes('\0'))) return null
      let target = resolve(mount.root, ...segments)
      if (!inside(mount.root, target)) return null
      let info = await stat(target).catch(() => null)
      if (info?.isDirectory()) target = resolve(target, 'index.html')
      const canonical = await realpath(target).catch(() => null)
      if (!canonical || !inside(mount.root, canonical)) return null
      // Keep the read bound to one handle. Recheck path/identity around the read
      // to reject ordinary replacement races; this is not an OS filesystem jail
      // against an adversarial local process coordinating ABA path swaps.
      const handle = await open(canonical, 'r').catch(() => null)
      if (!handle) return null
      try {
        const before = await handle.stat({ bigint: true })
        if (!before.isFile()) return null
        const sameFile = (other: typeof before) => other.isFile()
          && other.dev === before.dev && other.ino === before.ino
          && other.size === before.size && other.mtimeNs === before.mtimeNs
          && other.ctimeNs === before.ctimeNs
        const stillValid = async () => {
          const current = await realpath(canonical)
          if (current !== canonical || !inside(mount.root, current)) return false
          const named = await stat(current, { bigint: true })
          const opened = await handle.stat({ bigint: true })
          return sameFile(named) && sameFile(opened)
            && mounts.get(token) === mount && now() - mount.touched < IDLE_MS
        }
        const tooLarge = () => Object.assign(new Error('file too large'), { status: 413 })
        if (before.size > BigInt(PREVIEW_MAX_BYTES)) throw tooLarge()
        if (!(await stillValid())) return null
        const chunks: Buffer[] = []
        let total = 0
        if (!headOnly) {
          // A file may grow after stat. Never allocate/read an unbounded body.
          while (total <= PREVIEW_MAX_BYTES) {
            const chunk = Buffer.alloc(Math.min(64 * 1024, PREVIEW_MAX_BYTES + 1 - total))
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, total)
            if (!bytesRead) break
            total += bytesRead
            if (total > PREVIEW_MAX_BYTES) throw tooLarge()
            chunks.push(chunk.subarray(0, bytesRead))
          }
        }
        if (!(await stillValid()) || (!headOnly && BigInt(total) !== before.size)) return null
        mount.touched = now()
        return { path: canonical, size: Number(before.size), data: headOnly ? undefined : Buffer.concat(chunks, total) }
      } catch (error: any) {
        if (error?.status === 413) throw error
        return null
      } finally {
        await handle.close()
      }
    },
  }
}
