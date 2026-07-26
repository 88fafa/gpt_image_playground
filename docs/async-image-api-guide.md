# Async Image API Guide

This service accepts standard OpenAI-compatible image generation and edit requests, immediately returns a task, and lets the caller poll for the final image. It is designed for this upstream path:

```text
client or Playground -> Async Image API -> /v1/responses (stream:true) -> sub2api -> image model
```

The async service consumes the upstream SSE stream until the final `image_generation_call` output arrives. It writes each completed image to disk, writes task metadata atomically, and returns the final image after polling. It does not persist API keys, prompts, input images, or upstream base64 output after a task is finalized.

For every recognized project image preset, the worker ensures the final upstream prompt ends with the requested ratio and tier, for example `图片参数：比例1:1  1K`. A trailing older image-parameter suffix is replaced, never duplicated.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Readiness, worker state, TTL, and endpoint discovery |
| POST | `/v1/images/generations` | Submit a generation task |
| POST | `/v1/images/edits` | Submit an edit task using multipart form data |
| GET | `/v1/images/tasks/{task_id}` | Poll task state and final result |
| GET | `/v1/images/files/{file}` | Download a temporary stored result image |

The submit endpoints return HTTP `202`, `Location`, a `Retry-After` value chosen from the task state, a `task_id`, and a relative `poll_url`. Task states are `queued`, `processing`, `completed`, and `failed`. Clients should honor `Retry-After`, including the value on the initial `202` response. Processing uses a completion-window schedule: 25 seconds until 50 seconds, 15 seconds until 65 seconds, 5 seconds from 65 to 120 seconds, then 10, 30, and 60 seconds for increasingly long tasks. Queued tasks use 30-60 seconds based on queue position.

## Health Check

```bash
curl http://localhost:8010/healthz
```

Example result:

```json
{
  "status": "ok",
  "service": "async-image-api",
  "storage": "ready",
  "active_workers": 0,
  "worker_concurrency": 10,
  "queue_depth": 0,
  "queue_max": 100,
  "queued_input_bytes": 0,
  "queue_input_bytes_max": 67108864,
  "max_request_bytes": 26214400,
  "task_ttl_seconds": 86400,
  "task_timeout_seconds": 1800,
  "upstream_configured": true,
  "endpoints": {
    "generations": "POST /v1/images/generations",
    "edits": "POST /v1/images/edits",
    "tasks": "GET /v1/images/tasks/{task_id}",
    "files": "GET /v1/images/files/{file}"
  }
}
```

`status: ok` confirms that the local task store is ready. It does not make an upstream image request, so use one real generation request when checking upstream credentials or sub2api availability.

## Generate an Image

```bash
curl -X POST http://localhost:8010/v1/images/generations \
  -H "Authorization: Bearer YOUR_SUB2API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 9f7728b3-7b51-4c73-8b71-a-single-submit" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "A compact wooden cabin beside a clear lake at sunrise, detailed editorial photography",
    "size": "1024x1024",
    "quality": "medium",
    "output_format": "png",
    "response_format": "url"
  }'
```

`Idempotency-Key` is optional but strongly recommended for clients that retry a submit request. Only its SHA-256 hash is retained. Reusing the same key returns the original task instead of creating a duplicate image job.

Example `202` response:

```json
{
  "id": "imgtask_...",
  "task_id": "imgtask_...",
  "object": "image.task",
  "status": "queued",
  "queue_position": 1,
  "created_at": 1784290000,
  "updated_at": 1784290000,
  "expires_at": 1784376400,
  "poll_url": "/v1/images/tasks/imgtask_..."
}
```

Poll the task:

```bash
curl http://localhost:8010/v1/images/tasks/imgtask_...
```

Default `response_format` is `url`; a completed task returns a service URL valid until task expiry:

```json
{
  "task_id": "imgtask_...",
  "status": "completed",
  "expires_at": 1784376400,
  "result": {
    "data": [
      {
        "url": "http://localhost:8010/v1/images/files/imgtask_...-1.png",
        "size": "1536x1024",
        "output_format": "png"
      }
    ]
  }
}
```

Use `"response_format": "b64_json"` when an existing OpenAI-compatible client requires Base64. The file is still persisted internally; the polling response reads it and returns `b64_json` instead of `url`.

The Playground requests `url` internally, then downloads the completed image URL. This keeps completed task polling small. External clients can continue to request `b64_json` when required. With Docker API proxy enabled, async calls go to the same container's `/v1/images/...` endpoint; the worker then forwards to the configured `API_PROXY_URL` as an upstream streaming `/v1/responses` request.

## Edit an Image

Use `multipart/form-data`. `image`, `image[]`, or `images` are accepted. `mask` is optional.

```bash
curl -X POST http://localhost:8010/v1/images/edits \
  -H "Authorization: Bearer YOUR_SUB2API_KEY" \
  -F "model=gpt-image-2" \
  -F "prompt=Replace the sky with a bright, clear summer sky" \
  -F "image[]=@input.png" \
  -F "mask=@mask.png" \
  -F "size=1024x1024" \
  -F "output_format=png" \
  -F "response_format=url"
```

The worker translates this into one streaming Responses request using the `image_generation` tool with `action: "edit"`, input images, and an optional `input_image_mask`.

## Docker Configuration

Use a named volume or host directory. Without a mounted volume, Docker can retain an anonymous volume, but its lifecycle is harder to manage and task history may disappear when the container is replaced.

```bash
docker run -d \
  -p 8010:80 \
  --name gpt-image-playground \
  --restart unless-stopped \
  -v gpt-image-async-data:/app/data \
  -e ENABLE_API_PROXY=true \
  -e API_PROXY_URL=https://your-api.example.com/v1 \
  -e LOCK_API_PROXY=true \
  -e ENABLE_ASYNC_IMAGE_API=true \
  -e ASYNC_IMAGE_PUBLIC_BASE_URL=https://image.example.com \
  -e ASYNC_IMAGE_WORKER_CONCURRENCY=10 \
  -e ASYNC_IMAGE_QUEUE_MAX=100 \
  -e ASYNC_IMAGE_QUEUE_MAX_INPUT_BYTES=67108864 \
  -e ASYNC_IMAGE_MAX_REQUEST_BYTES=26214400 \
  -e ASYNC_IMAGE_NGINX_MAX_BODY_SIZE=25m \
  -e ASYNC_IMAGE_TASK_TTL_SECONDS=86400 \
  -e ASYNC_IMAGE_TASK_TIMEOUT_SECONDS=1800 \
  -e SHOW_DEFAULT_CONFIG_ONLY=true \
  -e DEFAULT_API_URL="https://your-api.example.com/v1?apiMode=responses&streamImages=true&streamPartialImages=2&model=gpt-5.5" \
  ghcr.io/88fafa/gpt_image_playground:latest
```

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `ENABLE_ASYNC_IMAGE_API` | `false` | Enables the front-end async route and starts the local API process |
| `ASYNC_IMAGE_WORKER_CONCURRENCY` | `10` | Maximum simultaneous streaming `/v1/responses` requests sent to sub2api |
| `ASYNC_IMAGE_QUEUE_MAX` | `100` | Maximum number of waiting tasks. Active workers are counted separately. |
| `ASYNC_IMAGE_QUEUE_MAX_INPUT_BYTES` | `67108864` | Maximum total request memory retained by waiting tasks; protects edits with large Base64 inputs. |
| `ASYNC_IMAGE_MAX_REQUEST_BYTES` | `26214400` | Maximum accepted JSON or multipart request body size (25 MiB). |
| `ASYNC_IMAGE_NGINX_MAX_BODY_SIZE` | `25m` | Nginx request-size limit for `/v1/images/`; keep this aligned with the application request limit. |
| `ASYNC_IMAGE_STORAGE_DIR` | `/app/data/async-image` | Task JSON and final image file directory |
| `ASYNC_IMAGE_TASK_TTL_SECONDS` | `86400` | Completed/failed task and image retention; 24 hours |
| `ASYNC_IMAGE_TASK_CLEANUP_INTERVAL_SECONDS` | `300` | Expired task cleanup interval |
| `ASYNC_IMAGE_TASK_TIMEOUT_SECONDS` | `1800` | Per-task upstream stream deadline; prevents a worker from hanging forever |
| `ASYNC_IMAGE_PUBLIC_BASE_URL` | empty | Required for public HTTPS deployments; the external Playground base URL used in image result URLs |
| `UPSTREAM_RESPONSES_BASE_URL` | empty | Direct upstream base URL; normally leave empty when `API_PROXY_URL` is set |
| `UPSTREAM_API_KEY` | empty | Optional fixed upstream key. When empty, the caller's `Authorization` header is forwarded |
| `UPSTREAM_RESPONSES_MODEL` | `gpt-5.5` | Internal Responses model used for the sub2api `image_generation` tool call. It does not change the public API model name. |

For a reverse proxy or TLS terminator in front of the container, set `ASYNC_IMAGE_PUBLIC_BASE_URL=https://image.example.com` so returned URLs always use the public HTTPS hostname. This is the recommended production configuration and prevents mixed-content image downloads. The bundled Nginx also preserves incoming `X-Forwarded-Proto` and `X-Forwarded-Host` values as a fallback. Nginx forwards `/v1/images/...` and `/healthz` to the local Node service; existing `/api-proxy/...` behavior remains the upstream sub2api proxy.

## Storage and Retention

This implementation follows the common asynchronous image pattern: task metadata is durable, result images are binary files, and the API returns URLs rather than retaining full Base64 payloads in task JSON. Completed and failed tasks are removed with their result files after 24 hours. Queued and processing tasks are not removed by TTL; the configurable timeout turns a stuck stream into a failed task instead.

After a process restart, completed and failed tasks remain pollable. A task that was queued or processing during the restart is marked failed as `task interrupted by server restart`; it is never silently replayed, preventing accidental duplicate billable generations.

Image file URLs contain an unguessable task UUID and expire with the task, but they are bearer-style links. Put the service behind your normal access control when different users must not share results. For multi-instance deployment, replace this local file store with shared object storage plus a shared task database/queue; the current implementation is deliberately single-container and single-volume.
