$ErrorActionPreference = 'Stop'
opencli --profile 74u3g3us browser wt eval "(() => { window.__mediaList = 'pending'; const o = indexedDB.open('dsh-worktable', 2); o.onerror = () => { window.__mediaList = 'open-err'; }; o.onsuccess = () => { const db = o.result; const r = db.transaction('photoRecords', 'readonly').objectStore('photoRecords').getAll(); r.onsuccess = () => { window.__mediaList = JSON.stringify(r.target.result.map(x => ({ id: x.id, type: x.blob && x.blob.type, size: x.blob && x.blob.size }))); }; r.onerror = () => { window.__mediaList = 'get-err'; }; }; return 'go3'; })()"
Start-Sleep -Milliseconds 2500
opencli --profile 74u3g3us browser wt eval "window.__mediaList || 'none3'"
