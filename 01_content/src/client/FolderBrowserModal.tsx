import { useCallback, useEffect, useRef, useState } from 'react'
import { directoryErrorText, type DirectoryBrowseFace, type DirectoryListing } from './directoryPicker'
import type { WorktableKey } from './locales'

interface FolderBrowserModalProps {
  open: boolean
  initialPath?: string
  face: DirectoryBrowseFace | null
  t: (key: WorktableKey, vars?: Record<string, string>) => string
  onConfirm: (path: string) => void
  onCancel: () => void
}

/** In-app folder browser modal backed by DSH directoryPicker browse primitives. */
export function FolderBrowserModal(props: FolderBrowserModalProps) {
  const { open, initialPath, face, t, onConfirm, onCancel } = props
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [editingPath, setEditingPath] = useState(false)
  const [pathDraft, setPathDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const reqIdRef = useRef(0)

  const loadDir = useCallback(async (targetPath?: string, allowHomeFallback = false) => {
    if (!face) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const reqId = ++reqIdRef.current
    setLoading(true)
    setError('')
    try {
      const next = await face.listDirectory(targetPath, ctrl.signal)
      if (reqId !== reqIdRef.current) return
      setListing(next)
      setSelectedPath(null)
      setPathDraft(next.path)
      setEditingPath(false)
    } catch (err: any) {
      if (ctrl.signal.aborted || reqId !== reqIdRef.current) return
      if (allowHomeFallback && targetPath) {
        try {
          const homeNext = await face.listDirectory(undefined, ctrl.signal)
          if (reqId !== reqIdRef.current) return
          setListing(homeNext)
          setSelectedPath(null)
          setPathDraft(homeNext.path)
          setEditingPath(false)
          return
        } catch (homeErr) {
          if (ctrl.signal.aborted || reqId !== reqIdRef.current) return
          setError(directoryErrorText(homeErr))
          return
        }
      }
      setError(directoryErrorText(err))
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [face])

  useEffect(() => {
    if (!open || !face) return
    setListing(null)
    setSelectedPath(null)
    setError('')
    setCreating(false)
    setNewName('')
    setEditingPath(false)
    void loadDir(initialPath || undefined, !!initialPath)
    return () => {
      abortRef.current?.abort()
      reqIdRef.current++
    }
  }, [open, face, initialPath, loadDir])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onCancel])

  if (!open || !face) return null

  const currentPath = listing?.path ?? ''
  const targetPath = selectedPath ?? currentPath
  const crumbs = listing?.crumbs ?? []
  const parentCrumb = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null
  const entries = (listing?.entries ?? []).filter((e) => showHidden || !e.hidden)

  const submitPath = (e?: any) => {
    e?.preventDefault?.()
    const trimmed = pathDraft.trim()
    if (!trimmed) return
    void loadDir(trimmed, false)
  }

  const submitCreate = async (e?: any) => {
    e?.preventDefault?.()
    if (!face.createDirectory || !currentPath || createBusy) return
    const name = newName.trim()
    if (!name) return
    setCreateBusy(true)
    setError('')
    try {
      const created = await face.createDirectory(currentPath, name)
      setCreating(false)
      setNewName('')
      await loadDir(typeof created === 'string' && created ? created : currentPath, false)
    } catch (err) {
      setError(directoryErrorText(err))
    } finally {
      setCreateBusy(false)
    }
  }

  return (
    <>
      <div className="dsh-wt_popBackdrop dsh-wt_browseBackdrop" onClick={onCancel} />
      <div className="dsh-wt_browseWrap" onClick={(e) => e.stopPropagation()}>
        <div
          className="dsh-wt_menu dsh-wt_pop dsh-wt_browseDialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dsh-wt_browseTitle"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dsh-wt_browseHead">
            <h2 id="dsh-wt_browseTitle" className="dsh-wt_browseTitle">{t('folderBrowse.title')}</h2>
            <button
              type="button"
              className="dsh-wt_setupClose"
              aria-label={t('folderBrowse.cancel')}
              onClick={onCancel}
            >✕</button>
          </div>

          <div className="dsh-wt_browseNav">
            {listing?.home && (
              <button
                type="button"
                className="dsh-wt_browseChip"
                title={listing.home}
                onClick={() => void loadDir(listing.home, false)}
              >🏠 {t('folderBrowse.home')}</button>
            )}
            {parentCrumb && (
              <button
                type="button"
                className="dsh-wt_browseChip"
                title={parentCrumb.path}
                onClick={() => void loadDir(parentCrumb.path, false)}
              >↑ {t('folderBrowse.parent')}</button>
            )}
            {editingPath ? (
              <form className="dsh-wt_browsePathForm" onSubmit={submitPath}>
                <input
                  type="text"
                  autoFocus
                  className="dsh-wt_consoleInput dsh-wt_browsePathInput"
                  value={pathDraft}
                  placeholder={t('folderBrowse.pathPh')}
                  onChange={(e) => setPathDraft(e.target.value)}
                />
                <button type="submit" className="dsh-wt_bindFolderChange">{t('folderBrowse.go')}</button>
                <button type="button" className="dsh-wt_bindFolderChange" onClick={() => setEditingPath(false)}>✕</button>
              </form>
            ) : (
              <div className="dsh-wt_browseCrumbs">
                {crumbs.map((c, idx) => (
                  <span key={c.path} className="dsh-wt_browseCrumbSeg">
                    {idx > 0 && <span className="dsh-wt_browseSep" aria-hidden>›</span>}
                    <button
                      type="button"
                      className="dsh-wt_browseCrumb"
                      title={c.path}
                      onClick={() => void loadDir(c.path, false)}
                    >{c.name || c.path}</button>
                  </span>
                ))}
                <button
                  type="button"
                  className="dsh-wt_browseEditBtn"
                  title={t('folderBrowse.editPath')}
                  aria-label={t('folderBrowse.editPath')}
                  onClick={() => { setPathDraft(currentPath); setEditingPath(true) }}
                >✎</button>
              </div>
            )}
          </div>

          <div className="dsh-wt_browseTools">
            {face.createDirectory && (
              <button
                type="button"
                className="dsh-wt_bindFolderChange"
                disabled={!currentPath || loading}
                onClick={() => { setCreating((v) => !v); setNewName(''); setError('') }}
              >＋ {t('folderBrowse.newFolder')}</button>
            )}
            <button
              type="button"
              className={'dsh-wt_bindFolderChange' + (showHidden ? ' dsh-wt_browseToggleOn' : '')}
              aria-pressed={showHidden}
              onClick={() => setShowHidden((v) => !v)}
            >{t('folderBrowse.showHidden')}</button>
            {loading && <span className="dsh-wt_browseStatus">{t('folderBrowse.loading')}</span>}
          </div>

          {creating && (
            <form className="dsh-wt_browseCreateRow" onSubmit={(e) => void submitCreate(e)}>
              <input
                type="text"
                autoFocus
                className="dsh-wt_consoleInput dsh-wt_browseCreateInput"
                placeholder={t('folderBrowse.newFolderPh')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button type="submit" className="dsh-wt_bindFolderChange" disabled={createBusy || !newName.trim()}>
                {createBusy ? '…' : t('folderBrowse.create')}
              </button>
              <button type="button" className="dsh-wt_bindFolderChange" onClick={() => setCreating(false)}>
                {t('folderBrowse.cancel')}
              </button>
            </form>
          )}

          {error && <p className="dsh-wt_consoleErr dsh-wt_browseErr" role="alert">{error}</p>}

          <div className="dsh-wt_browseList" role="listbox" aria-label={t('folderBrowse.title')}>
            {!loading && entries.length === 0 ? (
              <div className="dsh-wt_browseEmpty">{t('folderBrowse.empty')}</div>
            ) : (
              entries.map((entry) => {
                const isSel = selectedPath === entry.path
                return (
                  <div
                    key={entry.path}
                    role="option"
                    aria-selected={isSel}
                    className={'dsh-wt_browseRow' + (isSel ? ' dsh-wt_browseRowOn' : '')}
                    onClick={() => setSelectedPath(entry.path)}
                    onDoubleClick={() => void loadDir(entry.path, false)}
                  >
                    <span className="dsh-wt_browseRowIcon" aria-hidden>📁</span>
                    <span className="dsh-wt_browseRowName" title={entry.path}>{entry.name}</span>
                    <button
                      type="button"
                      className="dsh-wt_browseEnter"
                      title={t('folderBrowse.enter')}
                      aria-label={t('folderBrowse.enter') + ' ' + entry.name}
                      onClick={(e) => { e.stopPropagation(); void loadDir(entry.path, false) }}
                    >›</button>
                  </div>
                )
              })
            )}
          </div>

          {listing?.truncated && (
            <p className="dsh-wt_setupHint dsh-wt_browseTruncated">{t('folderBrowse.truncated')}</p>
          )}

          <div className="dsh-wt_browseFoot">
            <span className="dsh-wt_browseTarget" title={targetPath}>
              {targetPath || t('folderBrowse.loading')}
            </span>
            <button type="button" className="dsh-wt_setupPick" onClick={onCancel}>
              {t('folderBrowse.cancel')}
            </button>
            <button
              type="button"
              className="dsh-wt_consoleCreateBtn dsh-wt_setupGo"
              disabled={!targetPath || loading}
              onClick={() => onConfirm(targetPath)}
            >{t('folderBrowse.confirm')}</button>
          </div>
        </div>
      </div>
    </>
  )
}
