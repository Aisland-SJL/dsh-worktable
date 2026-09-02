$ErrorActionPreference = 'Stop'
opencli --profile 74u3g3us browser wt eval "(() => { const s = window.__dshWorktable && window.__dshWorktable.splitStore; if (!s || !s.spec) return 'no'; return JSON.stringify({ id: s.spec.id, title: s.spec.title, top: s.spec.top ? s.spec.top.length : null, mainLen: s.spec.main ? s.spec.main.length : null, chatW: s.chatW, chatWDef: s.spec.chatWidth }); })()"
