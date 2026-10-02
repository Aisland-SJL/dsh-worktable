/** DSH 0.1 stores current on the list; DSH 0.2 uses mainView retention. */
export function currentSessionOf(snapshot: any): string {
  if (typeof snapshot?.current === 'string') return snapshot.current
  const rows = Object.values(snapshot?.byId ?? {}) as any[]
  return rows.find((row) => (row?.retainedBy?.mainView ?? 0) > 0)?.id ?? ''
}

/** Navigate through the host's UI owner, without modifying the host service. */
export function openHostSession(ctx: any, sessions: any, id: string): any {
  // Cordis property access throws for an uninjected service; get() safely returns undefined.
  const ui = typeof ctx?.get === 'function' ? ctx.get('uiWorkspace') : ctx?.uiWorkspace
  if (typeof ui?.openSession === 'function') return ui.openSession(id)
  if (typeof sessions?.open === 'function') return sessions.open(id)
  throw new Error('Host session navigation unavailable')
}

/** Own a temporary reference on 0.2; borrowing a cold binding is no longer sufficient. */
export async function sendHostSession(bridge: any, id: string, text: string): Promise<void> {
  const sessions = bridge?.sessions
  const check = (result: any) => {
    if (result?.kind === 'error' || result?.ok === false) {
      throw new Error(result.text || result.error?.message || result.error?.code || 'Session submission rejected')
    }
  }
  const send = async (session: any) => {
    // Select one available transport BEFORE sending. A rejection/timeout must never retry
    // through a second transport: the first request may already have reached the host.
    if (session && typeof bridge?.conversation?.sendSession === 'function') {
      check(await bridge.conversation.sendSession(session, text, [], 'queue'))
      return
    }
    if (session && typeof session.prompt === 'function') {
      check(await session.prompt([{ type: 'text', text }], 'queue'))
      return
    }
    const conv = sessions?.scope?.(id)?.get?.('conversation')
    if (typeof conv?.send === 'function') { check(await conv.send(text)); return }
    throw new Error('no send path: session face unavailable')
  }
  if (typeof sessions?.using === 'function') {
    await sessions.using(id, { source: 'dshWorktable' }, async (ref: any) => {
      const binding = await ref.ready
      await send(binding.session)
    })
    return
  }
  let face: any = null
  for (let i = 0; i < 10; i++) {
    face = sessions?.binding?.(id)?.session
    if (face) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  await send(face)
}

/** Read-only adapter. A stopped run is not proof that a task succeeded. */
export function createSessionSnapshotAdapter() {
  const previousRunning = new Map<string, boolean>()
  const stopped = new Set<string>()
  return (snapshot: any, statusSource?: any): any => {
    // Preserve the legacy contract verbatim; idle old sessions must not become completed.
    if (!snapshot || typeof snapshot.current === 'string') return snapshot
    const statuses = statusSource?.getSnapshot?.()
    const byId: Record<string, any> = {}
    const subagentsByParent = { ...snapshot.subagentsByParent }
    for (const [id, row] of Object.entries(snapshot.byId ?? {}) as [string, any][]) {
      const status = statuses?.get?.(id)
      const running = status?.running ?? row.running
      if (running === true) stopped.delete(id)
      else if (running === false && previousRunning.get(id) === true) stopped.add(id)
      if (typeof running === 'boolean') previousRunning.set(id, running)
      byId[id] = {
        ...row, running,
        pendingInteraction: status ? status.pendingInteraction : row.pendingInteraction,
        // completionUnread clears when opening the main view. Keep a witnessed run-stop
        // until the next run so an active project's widget-result handshake still runs.
        completed: running !== true && (stopped.has(id) || status?.completionUnread === true || row.completed === true),
      }
      const children = snapshot.projectionsBySession?.[id]?.values?.subagentCatalog ?? row.projectionValues?.subagentCatalog
      if (Array.isArray(children)) subagentsByParent[id] = children
    }
    if (snapshot.phase === 'ready') {
      for (const id of previousRunning.keys()) if (!byId[id]) { previousRunning.delete(id); stopped.delete(id) }
    }
    return { ...snapshot, byId, subagentsByParent }
  }
}

/** Parent links and the host's child catalog can each contain otherwise missing children. */
export function childSessionIdsOf(snapshot: any, sid: string): Set<string> {
  const children = new Set<string>()
  for (const [id, row] of Object.entries(snapshot?.byId ?? {}) as [string, any][]) {
    if (id !== sid && row?.parentId === sid) children.add(id)
  }
  const catalog = snapshot?.subagentsByParent?.[sid]
  const rows = Array.isArray(catalog) ? catalog : (catalog?.entries ?? catalog?.items ?? [])
  if (Array.isArray(rows)) for (const row of rows) {
    const id = row?.sessionId ?? row?.id
    if (typeof id === 'string' && id !== sid) children.add(id)
  }
  return children
}

/** Persist only opaque interaction identities, never their questions or answers.
 * Legacy hosts with no interaction key keep the old boolean-state acknowledgement.
 * New hosts must not let acknowledgement of question A suppress replacement B.
 */
export function pendingAckOf(snapshot: any, sid: string, legacyFace?: any): string | null {
  const identities: string[] = []
  let identified = false
  const add = (id: string, pending: any) => {
    if (pending == null) return
    const key = typeof pending?.key === 'string' ? pending.key : ''
    if (key) identified = true
    identities.push(JSON.stringify([id, String(pending?.kind ?? ''), key]))
  }
  const ids = [sid, ...childSessionIdsOf(snapshot, sid)]
  for (const id of ids) add(id, snapshot?.byId?.[id]?.pendingInteraction)
  // Read the old face only when the parent list has not already supplied its pending state.
  if (snapshot?.byId?.[sid]?.pendingInteraction == null && Array.isArray(legacyFace?.pending)) {
    for (const pending of legacyFace.pending) add(sid, pending)
  }
  if (!identities.length) return null
  return identified ? 'need:' + JSON.stringify([...new Set(identities)].sort()) : 'need'
}

/** Read host memory only. Do not activate a chat target or retain a cold session to get a timer. */
export function sessionRuntimeMs(snapshot: any, sid: string, sessions: any, uiConversation?: any, now = Date.now()): number | null {
  if (snapshot?.byId?.[sid]?.running !== true) return null
  const validStart = (value: any): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  let start: number | null = null
  for (const job of snapshot?.jobsBySession?.[sid] ?? []) {
    if (job?.status === 'running' && validStart(job.startedAt) && (start == null || job.startedAt < start)) start = job.startedAt
  }
  if (start != null) return Math.max(0, now - start)

  let timings: any
  try { timings = uiConversation?.binding?.(sid)?.target?.('chat')?.getSnapshot?.()?.legacy?.turnTimings } catch {}
  if (timings == null) {
    try { timings = sessions?.binding?.(sid)?.session?.getSnapshot?.()?.turnTimings } catch {}
  }
  // ReadonlyMap/another realm's Map must work as well as the old object representation.
  const turns: any[] = typeof timings?.values === 'function'
    ? Array.from(timings.values()) : Object.values(timings ?? {})
  for (const turn of turns) {
    if (turn?.endTime == null && validStart(turn?.startTime) && (start == null || turn.startTime > start)) start = turn.startTime
  }
  return start == null ? null : Math.max(0, now - start)
}
