/** dsh-worktable 控制室背景原图存取：IndexedDB 存原始 Blob，全分辨率显示（零压缩）。 */
const DB_NAME = 'dsh-worktable'
const STORE = 'consoleBgPhoto'
const KEY = 'original'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const photoStore = {
  /** 保存原始图片（原样存，不重新编码） */
  async save(blob: Blob): Promise<void> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(blob, KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    })
  },
  /** 读取原始图片；无记录返回 null */
  async load(): Promise<Blob | null> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => { const v = req.result; db.close(); resolve(v instanceof Blob ? v : null) }
      req.onerror = () => { db.close(); reject(req.error) }
    })
  },
}
