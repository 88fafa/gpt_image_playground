$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$node = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'

$env:ASYNC_IMAGE_API_PORT = if ($env:ASYNC_IMAGE_API_PORT) { $env:ASYNC_IMAGE_API_PORT } else { '8787' }
$env:ASYNC_IMAGE_WORKER_CONCURRENCY = if ($env:ASYNC_IMAGE_WORKER_CONCURRENCY) { $env:ASYNC_IMAGE_WORKER_CONCURRENCY } else { '10' }
$env:ASYNC_IMAGE_QUEUE_MAX = if ($env:ASYNC_IMAGE_QUEUE_MAX) { $env:ASYNC_IMAGE_QUEUE_MAX } else { '100' }
$env:ASYNC_IMAGE_QUEUE_MAX_INPUT_BYTES = if ($env:ASYNC_IMAGE_QUEUE_MAX_INPUT_BYTES) { $env:ASYNC_IMAGE_QUEUE_MAX_INPUT_BYTES } else { '67108864' }
$env:ASYNC_IMAGE_MAX_REQUEST_BYTES = if ($env:ASYNC_IMAGE_MAX_REQUEST_BYTES) { $env:ASYNC_IMAGE_MAX_REQUEST_BYTES } else { '26214400' }
$env:UPSTREAM_RESPONSES_BASE_URL = if ($env:UPSTREAM_RESPONSES_BASE_URL) { $env:UPSTREAM_RESPONSES_BASE_URL } else { 'https://bridgelink.cc/v1' }
$env:UPSTREAM_RESPONSES_MODEL = if ($env:UPSTREAM_RESPONSES_MODEL) { $env:UPSTREAM_RESPONSES_MODEL } else { 'gpt-5.5' }

Set-Location $repo
& $node 'server/async-image-api.mjs'
