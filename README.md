<div align="center">

# GPT Image Playground

异步生图 Docker 部署与 API 参考见 [docs/async-image-api-guide.md](docs/async-image-api-guide.md)。

[![GitHub Repo stars](https://img.shields.io/github/stars/88fafa/gpt_image_playground?style=flat-square&color=eab308)](https://github.com/88fafa/gpt_image_playground/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/88fafa/gpt_image_playground?style=flat-square&color=3b82f6)](https://github.com/88fafa/gpt_image_playground/network/members)
[![License](https://img.shields.io/badge/license-MIT-10b981?style=flat-square)](LICENSE)

简洁的 GPT Image 图像生成工具。用户只需填写 API Key、提示词、参考图和图片参数即可生成图片。

[![在线体验](https://img.shields.io/badge/BridgeLink-%E5%9C%A8%E7%BA%BF%E4%BD%93%E9%AA%8C-18b6a4?style=for-the-badge)](https://image.bridgelink.cc/)

</div>

## ❤️ 赞助商

<table>
<tr>
<td width="220" align="center" valign="middle">
  <a href="https://bridgelink.cc"><img src="docs/images/bridgelink-logo.jpg" alt="BridgeLink API" width="180"></a>
</td>
<td valign="middle"><b><a href="https://bridgelink.cc">BridgeLink API</a></b>&nbsp;是一家稳定高速的 API 中继服务提供商，为 Image-2、Claude Code、Codex 等平台或模型提供 API 中继服务。面向个人、团队和企业用户提供 AI 编码服务和 AI 生图服务。</td>
</tr>
</table>

## ✨ 核心功能

- 输入提示词即可生成图片，支持添加参考图。
- 图片参数仅保留 `1K`、`2K`、`4K` 和常用画面比例。
- 设置页只需要填写 API Key，其余请求参数使用部署端默认配置。
- 生成记录和图片保存在浏览器本地，支持查看与下载。
- 每次生图会在实际请求的提示词末尾自动追加图片参数，例如：`图片参数：比例16:9  2K`。

## 🚀 在线体验

访问 [https://image.bridgelink.cc/](https://image.bridgelink.cc/) 即可使用。

## 🐳 Docker 部署

```bash
docker pull ghcr.io/88fafa/gpt_image_playground:latest

docker run -d \
  -p 8010:80 \
  --name gpt-image-playground \
  --restart unless-stopped \
  -e ENABLE_API_PROXY=true \
  -e API_PROXY_URL=https://your-api.example.com/v1 \
  -e LOCK_API_PROXY=true \
  -e SHOW_DEFAULT_CONFIG_ONLY=true \
  -e DEFAULT_API_URL="https://your-api.example.com/v1?apiMode=responses&streamImages=true&streamPartialImages=2&model=gpt-5.5" \
  ghcr.io/88fafa/gpt_image_playground:latest
```

将 `your-api.example.com` 替换为实际的 API 地址。更新时重新拉取镜像并重建容器即可。

## 异步生图 Docker 部署

在不改变 Playground 页面和用户填写 API Key 方式的前提下，增加以下参数即可启用本地异步队列。浏览器仍发送用户自己的 API Key，worker 会将该 Key 转发到已配置的、兼容 sub2api 的上游 `/v1/responses` 接口。此“用户自带 Key”模式不要设置 `UPSTREAM_API_KEY`。

### 对外 API 模型名说明

异步生图服务对外提供标准的 OpenAI 兼容接口：

- `POST /v1/images/generations`
- `POST /v1/images/edits`
- `GET /v1/images/tasks/{task_id}`

调用这些**对外异步接口**时，`model` 请始终传 `gpt-image-2`。这是公开 API 的统一模型名，也是说明弹窗、调用示例和智能体 Skill 应使用的名称。

Docker 参数 `DEFAULT_API_URL` 中的 `model=gpt-5.5` 只用于 Playground 原有的同步流式模式，以及异步 worker 在容器内部向 sub2api 发起 `/v1/responses` 工具调用时的上游模型；它不是对外异步 API 的模型名，外部调用者不应传 `gpt-5.5`。

```bash
docker pull ghcr.io/88fafa/gpt_image_playground:latest

docker run -d \
  -p 8010:80 \
  -v gpt-image-async-data:/app/data \
  --name gpt-image-playground \
  --restart unless-stopped \
  -e ENABLE_API_PROXY=true \
  -e API_PROXY_URL=https://your-api.example.com/v1 \
  -e LOCK_API_PROXY=true \
  -e SHOW_DEFAULT_CONFIG_ONLY=true \
  -e DEFAULT_API_URL="https://your-api.example.com/v1?apiMode=responses&streamImages=true&streamPartialImages=2&model=gpt-5.5" \
  -e ENABLE_ASYNC_IMAGE_API=true \
  -e ASYNC_IMAGE_PUBLIC_BASE_URL=https://your-playground.example.com \
  -e ASYNC_IMAGE_WORKER_CONCURRENCY=10 \
  -e ASYNC_IMAGE_QUEUE_MAX=100 \
  ghcr.io/88fafa/gpt_image_playground:latest
```

`ASYNC_IMAGE_PUBLIC_BASE_URL` 必须填写用户访问 Playground 的 HTTPS 公网域名，例如 `https://image.example.com`。它确保异步结果链接始终返回正确的 HTTPS 地址，尤其适用于 TLS 由外层 Nginx、Caddy 或 CDN 终止的部署。`ASYNC_IMAGE_WORKER_CONCURRENCY` 控制该容器同时请求上游的流式任务总数；`ASYNC_IMAGE_QUEUE_MAX` 只限制等待中的任务。持久化卷会在容器重启后保留任务元数据和结果图片，结果在默认 24 小时保留期结束后清理。

异步 API 包括 `POST /v1/images/generations`、`POST /v1/images/edits`、`GET /v1/images/tasks/{task_id}` 和 `GET /v1/images/files/{file}`。完整中文请求和响应示例、全部环境变量、轮询策略、保留策略及反向代理说明见 [异步生图 API 使用说明](docs/async-image-api-guide.md)。

## 💻 本地开发

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 📄 许可证

本项目使用 [MIT License](LICENSE)。项目基于开源项目 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 修改，感谢原作者。
