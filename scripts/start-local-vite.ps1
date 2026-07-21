$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$node = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeBin = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'

$env:PATH = "$nodeBin;$env:PATH"
$env:VITE_ASYNC_IMAGE_API_ENABLED = 'true'
$env:VITE_ASYNC_IMAGE_PUBLIC_BASE_URL = if ($env:ASYNC_IMAGE_PUBLIC_BASE_URL) { $env:ASYNC_IMAGE_PUBLIC_BASE_URL } else { '' }
$env:VITE_API_PROXY_AVAILABLE = 'true'
$env:VITE_API_PROXY_LOCKED = 'true'
$env:VITE_SHOW_DEFAULT_CONFIG_ONLY = 'true'
$env:VITE_DEFAULT_API_URL = 'https://bridgelink.cc/v1?apiMode=responses&streamImages=true&streamPartialImages=2&model=gpt-5.5'

Set-Location $repo
& $node 'node_modules/vite/bin/vite.js' --host 127.0.0.1 --port 5173
