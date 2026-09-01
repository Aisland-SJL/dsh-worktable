$ErrorActionPreference = 'Stop'
opencli --profile 74u3g3us browser wt eval "(() => { const o = indexedDB.open('dsh-worktable', 2); o.onsuccess = () => { const r = o.result.transaction('photoRecords', 'readonly').objectStore('photoRecords').getAll(); r.onsuccess = () => { window.__mediaList = JSON.stringify(r.target.result.map(x => ({ id: x.id, type: x.blob && x.blob.type, size: x.blob && x.blob.size }))); }; }; return 'scheduled'; })()"
Start-Sleep -Milliseconds 1200
opencli --profile 74u3g3us browser wt eval "window.__mediaList || 'none'"
