<div align="center">

# GPT Image Playground

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
