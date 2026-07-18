# Async Image Pattern Comparison

## Scope

GPT Image through `sub2api /v1/responses` is streaming, not a native submit-and-poll image API. This project therefore owns the asynchronous boundary: it holds the upstream SSE connection in a worker and exposes standard submit/poll endpoints to clients.

## Compared Implementations

| Implementation | Submit and status pattern | Result storage pattern | Useful lesson applied here |
| --- | --- | --- | --- |
| [Replicate JavaScript](https://github.com/replicate/replicate-javascript) | `predictions.create()` returns an ID; `predictions.get()` polls it. Webhooks are optional. | Final outputs are file URLs. | Return HTTP 202 plus task ID, poll terminal states, and return image URLs rather than placing large Base64 output in durable task JSON. |
| [fal JS client](https://github.com/fal-ai/fal-js) | `queue.submit()` gets a request ID; `subscribeToStatus()` gives client progress. | Managed file URLs. | Keep a clear queue/worker separation. A future local event stream can expose queue/progress without changing submit/poll compatibility. |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | A prompt ID is queued, then status/history are read separately. | Generated files are read through a dedicated file endpoint. | Separate task metadata from binary files and expose result files through an explicit URL endpoint. |

## Result

The implementation now follows the shared mature baseline:

```text
POST -> 202 + task_id -> GET task until terminal -> URL or b64_json result
```

It also adds safeguards required by the sub2api streaming source:

- A worker owns one upstream SSE stream until its terminal `response.completed` output.
- Worker count defaults to 10 and is bounded by `ASYNC_IMAGE_WORKER_CONCURRENCY`. The waiting queue is independently capped at 100 tasks and 64 MiB of retained input.
- A per-task timeout releases a stuck stream worker.
- `Idempotency-Key` prevents retry submissions from creating duplicate images.
- Final image files and minimal task records have a 24-hour TTL.
- A restart marks in-flight tasks failed instead of replaying an unknown billable request.

## Measured Capacity

On 2026-07-18, ten real `1024x1024` BridgeLink/sub2api `gpt-5.5` requests were submitted simultaneously through this worker implementation. All ten completed in 121 seconds. The Node process RSS rose from 48 MiB to a 438 MiB peak and settled at 89 MiB afterward.

This validates ten active workers for a host with at least 2 GiB of available memory. It does not validate 100 active upstream streams. `ASYNC_IMAGE_QUEUE_MAX=100` means 100 *waiting* tasks; active work remains limited by `ASYNC_IMAGE_WORKER_CONCURRENCY`.

## Deliberate Differences

No webhook or cancel endpoint is added now. sub2api exposes the relevant image generation result only in the open streaming Responses connection, so there is no independent upstream task callback to receive. Polling is reliable for this single-container architecture and preserves the current Playground behavior.

For multiple replicas, adopt the next layer used by hosted queue providers: a shared database for task state, object storage for images, and a shared queue/lease. Local JSON and files are intentionally retained for the current single Docker container because they are simpler to operate and avoid adding Redis or a database before they are necessary.
