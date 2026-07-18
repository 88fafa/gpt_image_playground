# Async Image Next Steps

## Complete

- [x] Standard async endpoints for generations, edits, task polling, and result files.
- [x] `/healthz` with worker, queue, TTL, timeout, upstream configuration, and endpoint discovery data.
- [x] Ten-worker default with configurable active concurrency and a per-task upstream stream timeout.
- [x] Durable single-container task JSON and result image files.
- [x] Atomic task writes serialized per task on Windows.
- [x] 24-hour default cleanup for completed and failed tasks and their image files.
- [x] Idempotency key hashing and duplicate-submit reuse.
- [x] Restart handling: in-flight tasks become failed and are not replayed.
- [x] No API key, request prompt, input image, or result Base64 is retained in persisted task metadata.
- [x] Real BridgeLink/sub2api streaming generation completed and result file was downloaded.
- [x] Full test suite: 253 passing tests; production front-end build passes.
- [x] Completion-window polling via `Retry-After`: 25/25/15 seconds before the likely completion period, 5 seconds from 65-120 seconds, then 10/30/60 seconds for long tasks. The front end honors the initial `202` retry delay instead of issuing an immediate task GET.
- [x] Queue guardrails: 100 waiting tasks, 64 MiB queued input budget, and 25 MiB request limit by default.
- [x] Stream final-image SSE parsing and immediate result persistence; completed images are not retained in the worker's result array.
- [x] Real ten-worker BridgeLink/sub2api validation: 10/10 completed in 121 seconds at 1024x1024. RSS was 48 MiB initially, 438 MiB at peak, and 89 MiB after completion.

## Before Publishing a Docker Image

- [x] Initialize Docker Desktop, build the image, and run a container smoke test.
- [x] Run one browser UI generation through the rebuilt container and confirm adaptive polling plus `/v1/images/...` is used instead of `/api-proxy/images/...`.
- [ ] Push the rebuilt image to `ghcr.io/88fafa/gpt_image_playground:latest` after the container smoke test.
- [x] Run a container with a named Docker volume for `/app/data`.
- [ ] Set `ASYNC_IMAGE_PUBLIC_BASE_URL` when a TLS proxy or public hostname sits in front of the container.

## Future Scale Work

- [ ] Record actual host memory measurements for 10 simultaneous real generations, including a large edit. Default concurrency is now 10, but should be reduced on hosts with less than 2 GiB free RAM.
- [ ] Run the same memory measurement against a large multipart edit, which retains both the input image and final upstream event while active.
- [ ] Do not set 100 active workers. `ASYNC_IMAGE_QUEUE_MAX=100` is intentionally a waiting-task limit; active streams remain capped by `ASYNC_IMAGE_WORKER_CONCURRENCY`.
- [ ] For multiple replicas, move task state to a shared database, images to object storage, and worker leases to a shared queue.
- [ ] Add metrics/alerts for queue depth, active workers, upstream duration, timeout count, failures, and free disk space.
- [ ] Add application-level authentication or signed result URLs when image URLs must be private across different users.
- [ ] Consider local SSE/WebSocket task progress only if the UI needs it; polling is the current standard compatibility path.
