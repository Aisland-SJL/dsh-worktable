/** Runtime directory-picker resolution for native pickers and DSH 0.2.x browse backends. */

export interface DirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

export interface DirectoryListing {
  path: string
  home: string
  crumbs: DirectoryEntry[]
  entries: DirectoryEntry[]
  truncated: boolean
}

export interface DirectoryBrowseFace {
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  createDirectory?: (path: string, name: string) => Promise<string>
}

export interface DirectoryFaces {
  nativePick: (() => Promise<string | null>) | null
  browseFace: DirectoryBrowseFace | null
  preferBrowse: boolean
}

export type FolderPickResult =
  | { status: 'picked'; path: string }
  | { status: 'cancelled' }
  | { status: 'unavailable' }

function unwrapRemote<T>(res: any, fallbackMsg: string): T {
  if (res && typeof res === 'object' && 'ok' in res) {
    if (!res.ok) {
      const msg = res?.error?.message ?? fallbackMsg
      const err: any = new Error(typeof msg === 'string' && msg ? msg : fallbackMsg)
      if (res?.error) err.rpcError = res.error
      throw err
    }
    return res.value as T
  }
  return res as T
}

function extractPickedPath(res: any): string | null {
  const val = unwrapRemote<any>(res, 'directory picker failed')
  if (typeof val === 'string') return val || null
  if (val && typeof val === 'object' && typeof val.path === 'string') return val.path || null
  return null
}

/** Format host/RPC directory errors cleanly without losing business messages. */
export function directoryErrorText(err: unknown): string {
  if (err && typeof err === 'object') {
    const rpc = (err as any).rpcError
    if (rpc && typeof rpc === 'object' && typeof rpc.message === 'string' && rpc.message) {
      return rpc.message
    }
    const msg = (err as any).message
    if (typeof msg === 'string' && msg) return msg
  }
  return String(err ?? 'unknown')
}

/** True when a host rejects directoryPicker.pick because only browse capability is mounted. */
export function isBrowseOnlyPickerError(err: unknown): boolean {
  const text = directoryErrorText(err)
  return /serves\s*["']browse["']|needs the native capability/i.test(text)
}

function slotEntriesOf(ctx: any, name: string): any[] {
  try {
    const entries = ctx?.slots?.entries?.(name)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** Detect available native pickers and browse directory APIs on the current DSH host. */
export function resolveDirectoryFaces(ctx: any, workspaces: any): DirectoryFaces {
  let uiWs: any = null
  try { uiWs = ctx?.get?.('uiWorkspace') ?? ctx?.uiWorkspace ?? null } catch { uiWs = null }

  let remoteDp: any = null
  try { remoteDp = ctx?.get?.('remote.directoryPicker') ?? null } catch { remoteDp = null }

  let directDp: any = null
  try { directDp = ctx?.directoryPicker ?? null } catch { directDp = null }

  let nativePick: (() => Promise<string | null>) | null = null
  if (workspaces && typeof workspaces.pickDirectory === 'function') {
    nativePick = () => workspaces.pickDirectory()
  } else if (remoteDp && typeof remoteDp.pick === 'function') {
    nativePick = async () => extractPickedPath(await remoteDp.pick())
  } else if (directDp && typeof directDp.pick === 'function') {
    nativePick = async () => extractPickedPath(await directDp.pick())
  } else if (uiWs && typeof uiWs.pickDirectory === 'function') {
    nativePick = () => uiWs.pickDirectory()
  }

  let browseFace: DirectoryBrowseFace | null = null
  if (uiWs && typeof uiWs.listDirectory === 'function') {
    browseFace = {
      listDirectory: (path?: string, signal?: AbortSignal) => uiWs.listDirectory(path, signal),
      ...(typeof uiWs.createDirectory === 'function'
        ? { createDirectory: (path: string, name: string) => uiWs.createDirectory(path, name) }
        : {}),
    }
  } else if (remoteDp && typeof remoteDp.list === 'function') {
    browseFace = {
      listDirectory: async (path?: string, signal?: AbortSignal) =>
        unwrapRemote<DirectoryListing>(await remoteDp.list(path, signal), 'directory list failed'),
      ...(typeof remoteDp.createDirectory === 'function'
        ? {
            createDirectory: async (path: string, name: string) =>
              unwrapRemote<string>(await remoteDp.createDirectory(path, name), 'directory create failed'),
          }
        : {}),
    }
  } else if (directDp && typeof directDp.list === 'function') {
    browseFace = {
      listDirectory: async (path?: string, signal?: AbortSignal) =>
        unwrapRemote<DirectoryListing>(await directDp.list(path, signal), 'directory list failed'),
      ...(typeof directDp.createDirectory === 'function'
        ? {
            createDirectory: async (path: string, name: string) =>
              unwrapRemote<string>(await directDp.createDirectory(path, name), 'directory create failed'),
          }
        : {}),
    }
  }

  // If the host slot exposes BrowseDirectoryFlow without NativeDirectoryFlow (and no desktop override),
  // go straight to the in-app directory browser without triggering a doomed native pick RPC.
  const desktopPicker = (globalThis as any).__DSH_DIRECTORY_PICKER__
  const flowEntries = slotEntriesOf(ctx, 'sidebar.workspaces.directoryFlow')
  const hasNativeFlow = flowEntries.some((e) => e?.component?.name === 'NativeDirectoryFlow')
  const hasBrowseFlow = flowEntries.some((e) => e?.component?.name === 'BrowseDirectoryFlow')
  const preferBrowse = !!browseFace && (
    !nativePick || (!desktopPicker && !hasNativeFlow && hasBrowseFlow)
  )

  return { nativePick, browseFace, preferBrowse }
}

/** Pick a directory using the native chooser when available, falling back to browse on browse-only hosts. */
export async function pickDirectoryWithFallback(params: {
  ctx: any
  workspaces: any
  openBrowse: (face: DirectoryBrowseFace) => Promise<string | null>
}): Promise<FolderPickResult> {
  const { nativePick, browseFace, preferBrowse } = resolveDirectoryFaces(params.ctx, params.workspaces)
  if (!nativePick && !browseFace) return { status: 'unavailable' }

  const runBrowse = async (): Promise<FolderPickResult> => {
    if (!browseFace) return { status: 'unavailable' }
    const path = await params.openBrowse(browseFace)
    return path ? { status: 'picked', path } : { status: 'cancelled' }
  }

  if (preferBrowse) return runBrowse()

  try {
    const path = await nativePick!()
    return path ? { status: 'picked', path } : { status: 'cancelled' }
  } catch (err) {
    if (browseFace && isBrowseOnlyPickerError(err)) return runBrowse()
    throw err
  }
}
