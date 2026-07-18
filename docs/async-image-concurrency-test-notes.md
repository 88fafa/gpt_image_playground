# Async Image Concurrency Test Notes

## Current Result

- `ASYNC_IMAGE_WORKER_CONCURRENCY=10` is the default active upstream-stream limit.
- `ASYNC_IMAGE_QUEUE_MAX=100` limits waiting tasks only. It does not allow 100 simultaneous upstream streams.
- Ten real BridgeLink/sub2api `gpt-5.5` image requests at 1024x1024 completed successfully in 121 seconds.
- The test process RSS was 48 MiB initially, 438 MiB at peak, and 89 MiB after completion.
- Use ten active workers only when the host has at least 2 GiB of free memory. Lower the worker count for smaller hosts or heavy edit workloads.

## Real Test Command

```powershell
$env:ASYNC_IMAGE_WORKER_CONCURRENCY='10'
$env:REAL_TEST_COUNT='10'
$env:UPSTREAM_RESPONSES_BASE_URL='https://bridgelink.cc/v1'
$env:UPSTREAM_RESPONSES_MODEL='gpt-5.5'
C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe scripts\real-concurrency-test.mjs
```

The script reads `UPSTREAM_API_KEY` when supplied. For this local workspace only, it otherwise reads `D:\TT\codex\NMW2\key.txt`. It never prints the key, prompt contents, or image Base64 payloads.
