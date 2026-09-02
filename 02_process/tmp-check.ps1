$ErrorActionPreference = 'Stop'
opencli --profile 74u3g3us browser wt eval "JSON.stringify({ hasWT: !!window.__dshWorktable, active: window.__dshWorktable ? window.__dshWorktable.splitStore.active : null, consoleEls: document.querySelectorAll('.dsh-wt_console').length, dividerEls: document.querySelectorAll('.dsh-wt_splitDivider').length, url: location.href.slice(0, 60) })"
