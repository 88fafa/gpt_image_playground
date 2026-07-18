## v0.7.1 (2026-07-18)

### Fixes

- Fixed asynchronous result URLs behind HTTPS reverse proxies by preserving forwarded protocol and host headers.
- Added CORS headers to async image task, error, and result-file responses.
- Documented `ASYNC_IMAGE_PUBLIC_BASE_URL` as the required public HTTPS deployment setting.

## v0.7.0 (2026-07-18)

### Async Image API

- Added standard asynchronous image generation and edit endpoints backed by streaming `/v1/responses` workers.
- Added durable task and result-file storage, task TTL cleanup, idempotency keys, queue limits, and health reporting.
- Added adaptive completion-window polling. The browser respects the initial `202 Retry-After` response.
- Defaulted to ten active workers with a separate 100-task waiting queue, validated against real BridgeLink/sub2api requests.

### Docker

- Preserved normal `/api-proxy` upstream routing while handling async image paths separately.
- Added supervised async-worker restart, container health checks, a 25 MiB async upload limit, and safer build-context exclusions.

## v0.6.12（2026-07-03）

### 变更与优化
- **为数据导出增加加载状态**：导出备份数据时，按钮会显示加载动画并临时禁用，避免大数据量导出时缺少操作反馈或重复触发导出。

### 修复
- **修复 HTTP IP 直连环境下右键复制图片失败的问题** (Issue #114)：当应用通过非 HTTPS 的局域网 IP 访问时，浏览器不会开放图片写入剪贴板 API。现在会根据图片类型做区分处理：在详情页和灯箱等原图区域放行浏览器原生右键菜单；在任务卡片等缩略图区域保留自定义菜单的下载和编辑功能，仅隐藏不可用的“复制”选项。
