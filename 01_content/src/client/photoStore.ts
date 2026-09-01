/** dsh-worktable 控制室背景照片库：IndexedDB 存原始图片（Blob 记录，零压缩）。
 *  v2：多张照片记录（id/createdAt/blob），v1 单图自动迁移为一条 'legacy' 记录。 */
const DB_NAME = 'dsh-worktable'
const STORE = 'photoRecords'
const LEGACY_STORE = 'consoleBgPhoto'
const LEGACY_KEY = 'original'

export type PhotoRecord = { id: string; createdAt: number; blob: Blob }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      // v1→v2 迁移：旧单图（consoleBgPhoto/original）转为一条 'legacy' 记录
      if (db.objectStoreNames.contains(LEGACY_STORE)) {
        try {
          const tx = req.transaction as IDBTransaction
          const getReq = tx.objectStore(LEGACY_STORE).get(LEGACY_KEY)
          getReq.onsuccess = () => {
            try {
              const blob = getReq.result
              if (blob instanceof Blob) {
                const rec: PhotoRecord = { id: 'legacy', createdAt: Date.now(), blob }
                tx.objectStore(STORE).put(rec, rec.id)
              }
              tx.objectStore(LEGACY_STORE).delete(LEGACY_KEY)
            } catch {}
          }
        } catch {}
        try { db.deleteObjectStore(LEGACY_STORE) } catch {}
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const photoStore = {
  /** 全部照片记录（最新在前） */
  async list(): Promise<PhotoRecord[]> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => {
        const arr: PhotoRecord[] = []
        for (const v of req.result as unknown[]) {
          const r = v as PhotoRecord | null
          if (r && typeof r === 'object' && typeof (r as any).id === 'string' && (r as any).blob instanceof Blob) {
            arr.push(r)
          }
        }
        arr.sort((a, b) => b.createdAt - a.createdAt)
        db.close()
        resolve(arr)
      }
      req.onerror = () => { db.close(); reject(req.error) }
    })
  },
  /** 新增一张原始照片，返回其 id（自动置为最新） */
  async add(blob: Blob): Promise<string> {
    const db = await openDb()
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    const rec: PhotoRecord = { id, createdAt: Date.now(), blob }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(rec, rec.id)
      tx.oncomplete = () => { db.close(); resolve(id) }
      tx.onerror = () => { db.close(); reject(tx.error) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    })
  },
}
