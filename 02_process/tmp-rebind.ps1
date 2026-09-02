$ErrorActionPreference = 'Stop'
opencli --profile 74u3g3us browser wt unbind 2>$null | Out-Null
Start-Sleep -Milliseconds 400
opencli --profile 74u3g3us browser wt bind
