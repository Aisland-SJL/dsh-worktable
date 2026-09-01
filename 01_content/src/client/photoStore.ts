/** dsh-worktable 控制室背景照片库：IndexedDB 存原始图片（Blob 记录，零压缩）。
 *  v2：多张照片记录（id/createdAt/blob）；v1 单图在首次 list() 时惰性迁移为 'legacy' 记录。
 *  （不在 onupgradeneeded 里动旧 store —— 升级事务内异步读写易出竞态，迁移放到读路径最稳。） */
const DB_NAME = 'dsh-worktable'
const STORE = 'photoRecords'
const LEGACY_STORE = 'consoleBgPhoto'
const LEGACY_KEY = 'original'

export type MediaKind = 'photo' | 'video'
export type PhotoRecord = { id: string; createdAt: number; kind: MediaKind; blob: Blob; order?: number }

export const kindOf = (blob: Blob): MediaKind => (blob.type && blob.type.indexOf('video/') === 0 ? 'video' : 'photo')

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getAll(db: IDBDatabase): Promise<PhotoRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      const arr: PhotoRecord[] = []
      for (const v of req.result as unknown[]) {
        const r = v as PhotoRecord | null
        if (r && typeof r === 'object' && typeof (r as any).id === 'string' && (r as any).blob instanceof Blob) {
          arr.push({ id: r.id, createdAt: r.createdAt, kind: kindOf(r.blob), blob: r.blob })
        }
      }
      const allOrdered = arr.every((r) => typeof r.order === 'number')
      if (allOrdered) arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      else arr.sort((a, b) => b.createdAt - a.createdAt)
      db.close()
      resolve(arr)
    }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export const photoStore = {
  /** 全部照片记录（最新在前）；无记录时惰性迁移 v1 单图 */
  async list(): Promise<PhotoRecord[]> {
    const db = await openDb()
    const main = await getAll(db)
    if (main.length > 0) return main
    // 迁移旧单图（若有）：读取 → 转为 'legacy' 记录
    try {
      if (db.objectStoreNames.contains(LEGACY_STORE)) {
        const blob = await new Promise<Blob | null>((resolve, reject) => {
          const tx = db.transaction(LEGACY_STORE, 'readonly')
          const req = tx.objectStore(LEGACY_STORE).get(LEGACY_KEY)
          req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null)
          req.onerror = () => reject(req.error)
        })
        if (blob) {
          const rec: PhotoRecord = { id: 'legacy', createdAt: Date.now(), kind: kindOf(blob), blob }
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite')
            tx.objectStore(STORE).put(rec, rec.id)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          })
          db.close()
          return [rec]
        }
      }
    } catch {}
    db.close()
    return []
  },
  /** 新增一条媒体（照片/视频），返回其 id（自动成为最新） */
  async add(blob: Blob): Promise<string> {
    const db = await openDb()
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    const rec: PhotoRecord = { id, createdAt: Date.now(), kind: kindOf(blob), blob }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(rec, rec.id)
      tx.oncomplete = () => { db.close(); resolve(id) }
      tx.onerror = () => { db.close(); reject(tx.error) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    })
  },
  /** 排序：ids 按给定顺序写入 order（0..n），其余保持原顺序追加在后 */
  async reorder(ids: string[]): Promise<void> {
    const db = await openDb()
    const cur = await getAll(db)
    const idx = new Map<string, number>()
    ids.forEach((id, i) => idx.set(id, i))
    const ordered: PhotoRecord[] = []
    const restSorted = [...cur].sort((a, b) => b.createdAt - a.createdAt)
    for (const r of cur) {
      const n = idx.get(r.id)
      if (typeof n === 'number') ordered.push({ ...r, order: n })
    }
    let tail = ordered.length
    for (const r of restSorted) {
      if (!idx.has(r.id)) ordered.push({ ...r, order: tail++ })
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const r of ordered) store.put(r, r.id)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    })
  },
  /** 删除一张记录 */
  async remove(id: string): Promise<void> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    })
  },
}
