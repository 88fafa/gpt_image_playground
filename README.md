<div align="center">

# GPT Image Playground

[![GitHub Repo stars](https://img.shields.io/github/stars/88fafa/gpt_image_playground?style=flat-square&color=eab308)](https://github.com/88fafa/gpt_image_playground/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/88fafa/gpt_image_playground?style=flat-square&color=3b82f6)](https://github.com/88fafa/gpt_image_playground/network/members)
[![License](https://img.shields.io/badge/license-MIT-10b981?style=flat-square)](LICENSE)

简洁的 GPT Image 图像生成与编辑工具。用户只需填写 API Key、提示词、参考图和图片参数即可开始创作。

[![在线体验](https://img.shields.io/badge/BridgeLink-%E5%9C%A8%E7%BA%BF%E4%BD%93%E9%AA%8C-18b6a4?style=for-the-badge)](https://image.bridgelink.cc/)

</div>

## ❤️ 赞助商

<table>
<tr>
<td width="220" align="center" valign="middle">
  <a href="https://bridgelink.cc"><img src="docs/images/bridgelink-logo.jpg" alt="BridgeLink API" width="180"></a>
</td>
<td valign="middle"><b><a href="https://bridgelink.cc">BridgeLink API</a></b>&nbsp;是一家稳定高速的 API 中继服务提供商，为 Image-2、Claude Code、Codex 等平台或模型提供 API 中继服务，面向个人、团队和企业用户提供 AI 编码与 AI 生图服务。</td>
</tr>
</table>

## ✨ 核心功能

- 输入提示词即可生成图片，支持上传多张参考图进行编辑。
- 提供 `gpt-image-2`、`gpt-image-2.5-sunburst`、`gpt-image-2.5-flare` 图片模型选择，默认使用 `gpt-image-2.5-sunburst`。
- 可设置图片尺寸、比例、质量、格式、数量和透明背景。
- 每次生图都会将所选图片参数和明确的比例要求追加到提示词末尾，帮助模型按目标比例生成。
- 图片生成和编辑支持同步流式 API；Responses API 可持续返回生成进度和中间图片。
- 设置页只保留 API Key 和图片模型选择；生成记录与图片保存在浏览器本地，可查看和下载。
- 页面提供 API 请求说明，可复制完整示例与 Skill 内容给 Codex、Claude Code、WorkBuddy、OpenCode、Trae 等智能体。

## 🚀 在线体验

访问 [https://image.bridgelink.cc/](https://image.bridgelink.cc/) 即可使用。

## 🐳 Docker 部署

拉取并启动最新镜像：

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
  -e DEFAULT_API_URL="https://your-api.example.com/v1?apiMode=responses&streamImages=true&streamPartialImages=2&model=gpt-5.5&imageGenerationModel=gpt-image-2.5-sunburst" \
  ghcr.io/88fafa/gpt_image_playground:latest
```

将 `your-api.example.com` 替换为你的 API 服务地址。若使用其他图片模型，可修改 `imageGenerationModel` 为 `gpt-image-2`、`gpt-image-2.5-sunburst` 或 `gpt-image-2.5-flare`。`model=gpt-5.5` 是 Responses API 使用的文本模型，`imageGenerationModel` 是对外选择和调用的图片模型。

`API_PROXY_URL` 是容器内 Nginx 代理的目标地址；`DEFAULT_API_URL` 是预置到页面中的 API 地址。两者可以根据你的网络拓扑分别设置。开启 `SHOW_DEFAULT_CONFIG_ONLY=true` 后，用户只使用预置配置，仍可在页面填写自己的 API Key。

更新镜像并重建容器：

```bash
docker pull ghcr.io/88fafa/gpt_image_playground:latest
docker stop gpt-image-playground
docker rm gpt-image-playground
# 使用上方 docker run 命令重新启动
```

## API 请求说明

页面右上角的「API 请求」提供可直接使用的同步流式生图与图片编辑示例，并包含可复制给常用智能体的 Skill 内容。接口地址和图片模型会根据当前预置配置显示；API Key 由调用者自行填写。

### Responses API 同步流式生图

`POST /v1/responses` 示例：

```json
{
  "model": "gpt-5.5",
  "stream": true,
  "tools": [
    {
      "type": "image_generation",
      "model": "gpt-image-2.5-sunburst",
      "size": "1024x1536",
      "quality": "high",
      "output_format": "png",
      "background": "transparent",
      "partial_images": 2
    }
  ],
  "input": "绘制主体和场景描述。图片参数：比例2:3。画面必须严格遵循2:3竖版构图。"
}
```

请求时使用 `Authorization: Bearer YOUR_API_KEY`。将 `model` 设置为上游 Responses 文本模型，将工具中的 `model` 设置为要使用的图片模型。`stream: true` 启用 SSE 流式响应；`partial_images` 控制中间图像数量。透明背景使用 `background: "transparent"`，建议搭配 PNG 或 WebP。图片比例要同时反映在 `size` 和提示词中。

### Images API 生图与编辑

同步流式生图使用 `POST /v1/images/generations`，请求中设置 `stream: true`；图片编辑使用 `POST /v1/images/edits`，采用 `multipart/form-data` 上传图片。多张参考图片以同名 `image[]` 字段重复上传。具体 Base URL、模型和可复制的完整调用内容请以页面「API 请求」弹窗为准。

## 图片参数

- **尺寸与比例**：尺寸参数会随请求发送；提示词末尾也会追加所选比例要求。若原提示词中已经包含比例要求，应用不会重复追加。
- **质量与格式**：按页面所选质量和输出格式发送。透明背景建议使用 PNG 或 WebP。
- **透明背景**：开启后会在请求中传递透明背景参数；是否支持取决于所使用的图片模型及 API 服务。
- **编辑参考图**：支持上传多张参考图片；编辑接口通过重复的 `image[]` multipart 字段传入。

## 本地开发

```bash
npm install
npm run dev
```

运行测试与生产构建：

```bash
npm test -- --run
npm run build
```

## 许可证

本项目使用 [MIT License](LICENSE)。项目基于开源项目 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 修改，感谢原作者。
