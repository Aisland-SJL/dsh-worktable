$ErrorActionPreference = 'Stop'
opencli --profile 74u3g3us browser wt eval "(() => { try { const o = indexedDB.open('dsh-worktable', 2); o.onerror = () => { window.__mediaList = 'open-err'; }; o.onsuccess = () => { const db = o.result; try { const tx = db.transaction('photoRecords', 'readonly'); const r = tx.objectStore('photoRecords').getAll(); r.onsuccess = () => { window.__mediaList = JSON.stringify(r.target.result.map(x => ({ id: x.id, type: x.blob && x.blob.type, size: x.blob && x.blob.size }))); }; r.onerror = () => { window.__mediaList = 'get-err'; }; } catch (e) { window.__mediaList = 'tx-err:' + e.message; } }; return 'go2'; })()"
Start-Sleep -Milliseconds 3000
opencli --profile 74u3g3us browser wt eval "window.__mediaList || 'none2'"
