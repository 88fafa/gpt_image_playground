# Docker Desktop Installation and Project Runbook

## Current Machine Status

Docker Desktop 4.82.0 and Windows Subsystem for Linux 2.7.10 are installed on this Windows 11 machine. The WSL and Virtual Machine Platform Windows features are enabled, and firmware virtualization is enabled. The WSL installer requires one final Windows restart before Docker Desktop can start its Linux engine.

## Finish Docker Desktop Setup

1. Restart Windows. This is required after the WSL 2.7.10 package installation.
2. Open Docker Desktop from the Start menu and accept its first-run prompts.
3. If Docker Desktop asks for WSL setup, open an Administrator PowerShell window and run:

```powershell
wsl --install --no-distribution
wsl --update
```

4. Restart Windows again only if Windows or Docker Desktop requests it.
5. Open a new PowerShell window and verify the engine:

```powershell
docker version
docker run --rm hello-world
```

The verification is complete only when both Client and Server sections appear in `docker version` and `hello-world` exits successfully.

## Build This Project

From `D:\TT\codex\NMW2\gpt_image_playground`:

```powershell
docker build -f deploy/Dockerfile -t gpt-image-playground:local .
```

## Docker Hub Connection Timeout

The build downloads the official `node:20-alpine` and `nginx:alpine` base images from Docker Hub. If the build reports a timeout for `registry-1.docker.io:443`, Docker Desktop is running but the network cannot reach Docker Hub.

Do not replace the official base images with an untrusted mirror. Instead, configure an approved proxy in Docker Desktop:

1. Open Docker Desktop, then **Settings > Resources > Proxies**.
2. Choose manual proxy configuration.
3. Enter the approved HTTP proxy URL in both HTTP and HTTPS proxy fields, for example `http://proxy.example.com:7890`.
4. Apply and restart Docker Desktop.
5. Verify the connection before rebuilding:

```powershell
docker pull node:22-alpine
docker pull nginx:alpine
```

When no approved proxy is available, ask the network administrator to allow HTTPS access to `registry-1.docker.io`, `auth.docker.io`, and Docker image CDN endpoints.

## Run the Async Image Version

Replace the upstream URL and key values. A named volume keeps task JSON and final image files across container replacement.

```powershell
docker run -d `
  -p 8010:80 `
  --name gpt-image-playground `
  --restart unless-stopped `
  -v gpt-image-async-data:/app/data `
  -e ENABLE_API_PROXY=true `
  -e API_PROXY_URL=https://bridgelink.cc/v1 `
  -e LOCK_API_PROXY=true `
  -e ENABLE_ASYNC_IMAGE_API=true `
  -e ASYNC_IMAGE_WORKER_CONCURRENCY=10 `
  -e ASYNC_IMAGE_QUEUE_MAX=100 `
  -e ASYNC_IMAGE_QUEUE_MAX_INPUT_BYTES=67108864 `
  -e ASYNC_IMAGE_MAX_REQUEST_BYTES=26214400 `
  -e ASYNC_IMAGE_TASK_TTL_SECONDS=86400 `
  -e ASYNC_IMAGE_TASK_TIMEOUT_SECONDS=1800 `
  -e SHOW_DEFAULT_CONFIG_ONLY=true `
  -e DEFAULT_API_URL="https://bridgelink.cc/v1?apiMode=responses&streamImages=true&streamPartialImages=2&model=gpt-5.5" `
  gpt-image-playground:local
```

The browser UI is available at `http://127.0.0.1:8010`. The async health endpoint is:

```powershell
Invoke-RestMethod http://127.0.0.1:8010/healthz
```

It should report `worker_concurrency: 10`, `queue_max: 100`, `task_ttl_seconds: 86400`, and the `/v1/images/...` endpoints.

## Update a Running Container

```powershell
docker rm -f gpt-image-playground
docker build -f deploy/Dockerfile -t gpt-image-playground:local .
```

Then run the command from the previous section. Do not remove the named volume unless task history and stored images may be discarded.

## Prompt and Size Behavior

The default request is `1024x1024`, which is the project's `1K / 1:1` preset. Before an image request reaches sub2api, the final prompt ends with:

```text
图片参数：比例1:1  1K
```

The Playground adds it before submission. The async API adds the same suffix as a server-side fallback for external callers, replacing any older trailing image-parameter suffix so it is never duplicated or contradictory.
