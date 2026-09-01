$ErrorActionPreference = 'Stop'
opencli --profile 74u3g3us browser wt eval "(() => { window.__t = 1; setTimeout(() => { window.__t = 2; }, 400); return 's'; })()"
Start-Sleep -Milliseconds 900
opencli --profile 74u3g3us browser wt eval "window.__t"
