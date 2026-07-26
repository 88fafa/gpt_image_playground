# 异步生图 API 使用说明

本服务提供兼容 OpenAI Images API 的异步图片生成和编辑接口：提交任务后立即返回 `task_id`，调用方再查询任务取得最终图片。上游调用链如下：

```text
调用方或 Playground -> 异步生图 API -> /v1/responses（stream: true）-> sub2api -> 图片模型
```

异步 worker 会持续消费上游 SSE 流，直到收到最终 `image_generation_call` 图片结果。完成后的图片写入磁盘，任务元数据以原子方式保存；API Key、提示词、输入图片和上游 Base64 输出不会在任务结束后持久化。

## 公开模型名与内部模型

对外异步 API 的 `model` **统一使用 `gpt-image-2`**。无论是生成、编辑、curl 示例、第三方客户端还是智能体 Skill，都应传递此模型名。

容器内部会将任务转为 sub2api 兼容的 `/v1/responses` 流式 `image_generation` 工具调用，默认内部上游模型为 `gpt-5.5`，可通过 `UPSTREAM_RESPONSES_MODEL` 覆盖。`gpt-5.5` 是内部实现配置，**不是**对外异步 API 的 `model` 值。

对于项目识别的每个图片尺寸预设，worker 会保证最终上游提示词以目标比例和清晰度结尾，例如 `图片参数：比例1:1  1K`。如果提示词末尾已有旧的图片参数，会替换而不是重复追加。

## 接口列表

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/v1/images/generations` | 提交异步图片生成任务 |
| `POST` | `/v1/images/edits` | 提交异步图片编辑任务 |
| `GET` | `/v1/images/tasks/{task_id}` | 查询任务状态与结果 |
| `GET` | `/v1/images/files/{file}` | 下载已完成任务的图片文件 |
| `GET` | `/healthz` | 服务健康检查 |

## 健康检查

```bash
curl http://localhost:8010/healthz
```

示例响应：

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
  "upstream_configured": true
}
```

`status: ok` 表示本地任务存储已就绪，不会实际请求上游。验证 API Key 或 sub2api 可用性时，请再提交一次真实生图任务。

## 图片生成

```bash
curl -X POST http://localhost:8010/v1/images/generations \
  -H "Authorization: Bearer YOUR_SUB2API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 9f7728b3-7b51-4c73-8b71-a-single-submit" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "湖边日出时的一座紧凑木屋，细节丰富的编辑摄影风格",
    "size": "1024x1024",
    "quality": "medium",
    "output_format": "png",
    "response_format": "url"
  }'
```

`Idempotency-Key` 为可选参数，但客户端可能重试提交时强烈建议设置。服务端只保存其 SHA-256 摘要；重复使用同一个 Key 会返回原任务，而不会重复创建、重复计费。

服务会立即返回 HTTP `202` 和 `task_id`：

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

提交成功后必须保存 `task_id`，不要重新 POST 同一个任务。应读取响应头 `Retry-After` 后再查询；任务处于 `queued` 或 `processing` 时继续按该值等待。网络中断、页面刷新或手机从后台恢复后，也只应使用原 `task_id` 查询，不要重新提交。

```bash
curl http://localhost:8010/v1/images/tasks/imgtask_... \
  -H "Authorization: Bearer YOUR_SUB2API_KEY"
```

默认 `response_format` 为 `url`。完成后返回的服务图片链接在任务过期前有效：

```json
{
  "task_id": "imgtask_...",
  "status": "completed",
  "expires_at": 1784376400,
  "result": {
    "data": [
      {
        "url": "https://image.example.com/v1/images/files/imgtask_...-1.png",
        "size": "1536x1024",
        "output_format": "png"
      }
    ]
  }
}
```

旧客户端需要 Base64 时可传递 `"response_format": "b64_json"`。文件仍会在服务端保存，查询响应会读取文件并返回 `b64_json`。Playground 内部使用 `url`，完成时再下载图片，以减小轮询响应体。

## 图片编辑

编辑接口使用 `multipart/form-data`。支持 `image`、重复的 `image[]` 或 `images` 字段；`mask` 可选。

```bash
curl -X POST http://localhost:8010/v1/images/edits \
  -H "Authorization: Bearer YOUR_SUB2API_KEY" \
  -F "model=gpt-image-2" \
  -F "prompt=把天空替换为明亮晴朗的夏日蓝天" \
  -F "image[]=@input.png" \
  -F "mask=@mask.png" \
  -F "size=1024x1024" \
  -F "output_format=png" \
  -F "response_format=url"
```

多图编辑请重复使用 `image[]`；服务端会按上传顺序将图片传给模型。使用 JSON Data URL 时，`image`、`images` 和 `input_images` 都可传图片数组。worker 会将编辑请求转为一次带 `action: "edit"`、输入图片和可选 `input_image_mask` 的流式 Responses 工具调用。

## Docker 部署

请使用命名卷或主机目录保存 `/app/data`。不挂载卷时 Docker 也可能保留匿名卷，但更换容器后难以管理，任务历史可能丢失。

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

上例 `DEFAULT_API_URL` 里的 `model=gpt-5.5` 是 Playground 原有流式模式和内部上游调用配置；外部客户端调用 `/v1/images/generations` 与 `/v1/images/edits` 时仍必须使用 `model=gpt-image-2`。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ENABLE_ASYNC_IMAGE_API` | `false` | 启用前端异步入口并启动本地异步 API 进程 |
| `ASYNC_IMAGE_WORKER_CONCURRENCY` | `10` | 同时向 sub2api 发送流式 `/v1/responses` 请求的最大数量 |
| `ASYNC_IMAGE_QUEUE_MAX` | `100` | 等待队列最多任务数；活跃 worker 单独计算 |
| `ASYNC_IMAGE_QUEUE_MAX_INPUT_BYTES` | `67108864` | 等待任务可保留的输入总内存上限，保护大图编辑请求 |
| `ASYNC_IMAGE_MAX_REQUEST_BYTES` | `26214400` | 接受的 JSON 或 multipart 请求体上限（25 MiB） |
| `ASYNC_IMAGE_NGINX_MAX_BODY_SIZE` | `25m` | `/v1/images/` 的 Nginx 请求大小限制，应与应用限制保持一致 |
| `ASYNC_IMAGE_STORAGE_DIR` | `/app/data/async-image` | 任务 JSON 与最终图片文件目录 |
| `ASYNC_IMAGE_TASK_TTL_SECONDS` | `86400` | 已完成或失败任务及图片的保留时间（24 小时） |
| `ASYNC_IMAGE_TASK_CLEANUP_INTERVAL_SECONDS` | `300` | 清理过期任务的间隔（秒） |
| `ASYNC_IMAGE_TASK_TIMEOUT_SECONDS` | `1800` | 单个上游流的超时时间，避免 worker 永久占用 |
| `ASYNC_IMAGE_PUBLIC_BASE_URL` | 空 | 公网 HTTPS 部署必须设置，用于生成外部可访问的图片结果 URL |
| `UPSTREAM_RESPONSES_BASE_URL` | 空 | 直接上游地址；设置 `API_PROXY_URL` 时通常留空 |
| `UPSTREAM_API_KEY` | 空 | 可选固定上游 Key；留空时转发调用方的 `Authorization` |
| `UPSTREAM_RESPONSES_MODEL` | `gpt-5.5` | 内部向 sub2api 调用 `image_generation` 工具时使用的模型，不改变对外 API 模型名 |

反向代理或 TLS 终止部署必须设置 `ASYNC_IMAGE_PUBLIC_BASE_URL=https://image.example.com`，以确保结果 URL 使用正确的 HTTPS 公网域名，避免浏览器 Mixed Content。内置 Nginx 会保留 `X-Forwarded-Proto` 与 `X-Forwarded-Host` 作为后备；`/v1/images/...` 和 `/healthz` 转发给本地 Node 异步服务，既有 `/api-proxy/...` 仍转发给上游 sub2api。

## 存储与保留策略

任务元数据持久化保存，结果图片以二进制文件保存，API 默认返回 URL 而非把完整 Base64 写入任务 JSON。已完成和失败任务会在 24 小时后连同结果文件清理；排队中与处理中任务不按 TTL 清理，但可配置超时会将卡住的上游流标记为失败。

服务进程重启后，已完成和失败任务仍可查询。重启时处于 `queued` 或 `processing` 的任务会标记为 `task interrupted by server restart`，绝不会自动重放，以防重复计费。

图片 URL 包含不可猜测的任务 UUID，但仍属于持有即访问的链接。不同用户需要隔离结果时，应在服务前加正常的访问控制。多实例部署需要共享对象存储、共享任务数据库与队列；当前实现刻意定位为单容器、单数据卷部署。
