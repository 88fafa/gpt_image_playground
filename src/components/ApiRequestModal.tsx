import { useMemo, useState } from 'react'
import { getActiveApiProfile } from '../lib/apiProfiles'
import { getImageGenerationModel } from '../lib/imageModels'
import { useStore } from '../store'
import { CloseIcon, CopyIcon } from './icons'

const codeClass = 'overflow-x-auto rounded-xl bg-gray-950 p-4 text-xs leading-6 text-gray-100 dark:bg-black/40'
const skillRepositoryUrl = 'https://github.com/88fafa/gpt-image-streaming-skill'
const skillInstallPrompt = `请安装并使用这个图片生成 Skill：${skillRepositoryUrl} 。安装或读取完成后，帮我配置并使用同步流式图片生成 API。请先显示当前 Base URL（包含 /v1）并询问我是否继续使用；如果已有 API Key，请询问我是否继续使用当前 API Key，但不要显示 Key 的具体内容。只有缺少或拒绝复用时，才向我索取新的 Base URL 或 API Key。`
const codexInstallPrompt = `请从 ${skillRepositoryUrl} 安装 gpt-image-streaming Skill。安装完成后，使用这个 Skill 配置同步流式图片生成 API。`

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '') || 'https://your-api.example.com/v1'
}

export default function ApiRequestModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((state) => state.settings)
  const [copied, setCopied] = useState(false)
  const profile = getActiveApiProfile(settings)
  const baseUrl = normalizeBaseUrl(profile.baseUrl)
  const imageModel = getImageGenerationModel(profile) || 'gpt-image-2.5-sunburst'
  const apiKey = 'YOUR_API_KEY'

  const allContent = useMemo(() => `# 小白用户先看：安装和使用生图 Skill

如果你第一次使用图片生成 API，推荐先安装或读取配套 Skill。它会帮助智能体正确处理同步流式生图、图片编辑、多张参考图、图片比例和最终图片。

## 最简单的方式：把下面这句话交给智能体

${skillInstallPrompt}

智能体会先询问是否继续使用当前 Base URL 和 API Key。确认后即可开始生图。API Key 只用于当前会话，不要发到公开群聊，也不要写入 URL、代码或日志。

## Codex App 安装方式

${codexInstallPrompt}

安装完成后，在下一条消息中输入 \`$gpt-image-streaming\`，或直接说“使用生图 Skill 生成一张图片”。

## 其他智能体安装方式

在 Claude Code、WorkBuddy、OpenCode 或 Trae 的 Skill、插件或工作流设置中导入：

${skillRepositoryUrl}

如果不支持从 GitHub 自动导入，就下载仓库压缩包，把其中的 \`SKILL.md\` 和 \`agents/openai.yaml\` 放入该智能体支持的 Skill 目录，并将目录命名为 \`gpt-image-streaming\`。不同智能体的目录位置不同，请以该智能体的 Skill 文档为准。

# 同步流式图片生成 API

## 基本信息
- Base URL: ${baseUrl}
- API Key: 请替换为你自己的 API Key
- 默认图片模型: ${imageModel}
- 生成模式: 同步流式

## 推荐：Responses API 文生图
POST ${baseUrl}/responses
Authorization: Bearer ${apiKey}
Content-Type: application/json

{
  "model": "${profile.model || 'gpt-5.5'}",
  "stream": true,
  "input": "一幅雨夜中的霓虹城市，电影级光影",
  "tools": [{
    "type": "image_generation",
    "action": "generate",
    "model": "${imageModel}",
    "size": "1024x1024",
    "quality": "auto",
    "background": "transparent",
    "partial_images": 2
  }]
}

## Images API 文生图
POST ${baseUrl}/images/generations
Authorization: Bearer ${apiKey}
Content-Type: application/json

{
  "model": "${imageModel}",
  "prompt": "一幅雨夜中的霓虹城市，电影级光影。请严格按照 3:4 的画面比例生成图片。",
  "size": "768x1024",
  "quality": "auto",
  "background": "transparent",
  "stream": true,
  "partial_images": 2
}

## Images API 图片编辑
POST ${baseUrl}/images/edits
Authorization: Bearer ${apiKey}
Content-Type: multipart/form-data

字段：
- model: ${imageModel}
- prompt: 编辑要求，并在最后明确比例，例如“请严格按照 3:4 的画面比例生成图片。”
- image[]: 一张或多张参考图片，可重复提交 image[] 字段
- mask: 可选遮罩图片
- size: 768x1024
- background: transparent 或 auto
- stream: true
- partial_images: 2

## 参数说明
- prompt / input：文字提示词。建议在末尾明确写出“请严格按照 3:4 的画面比例生成图片”。
- size：像素尺寸，例如 1024x1024、768x1024。系统会同时把对应比例写入提示词。
- quality：auto、low、medium、high。
- background：transparent 生成透明背景；auto 使用默认背景。透明背景通常使用 PNG 或 WebP。
- stream：设为 true 启用同步流式返回。
- partial_images：中间预览图数量，建议设置为 2，便于长时间生成保持连接。
- image[]：编辑接口可重复传入多个图片字段，不要把多张图片拼成一个字符串。

## 一句话交给智能体
请帮我配置并使用同步流式图片生成 API。请先向我索取 Base URL（包含 /v1）和 API Key；收到后仅用于本次会话，不要写入代码、URL、日志或提交到仓库。默认使用 Responses API 的 POST {base_url}/responses，外层模型使用 ${profile.model || 'gpt-5.5'}，stream=true，并在 image_generation 工具中使用图片模型 ${imageModel}、partial_images=2；生成或编辑时持续读取流式事件直到最终图片完成，编辑支持多张参考图片。请先验证配置，再开始生图。

## 给智能体生成 Skill 的要求
你是图片生成 API 客户端。请先向用户索取 Base URL（包含 /v1）和 API Key，并仅在本次会话中使用，不要记录或泄露 API Key。优先调用 Responses API 的 POST {base_url}/responses：外层 model 使用 ${profile.model || 'gpt-5.5'}，stream=true，image_generation 工具使用图片模型 ${imageModel}、partial_images=2。生成时必须传递 size，并在 input 或 prompt 最后追加明确的比例要求；编辑时把多张参考图作为 input_image 传入。持续读取 SSE 事件直到最终图片完成，透明背景使用 background=transparent 并优先使用 PNG。`, [baseUrl, imageModel, profile.model])

  const copyContent = async () => {
    await navigator.clipboard.writeText(allContent)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex h-[min(88vh,760px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.08]">
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">图片生成 API 请求说明</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">同步流式生成、编辑与智能体 Skill 配置</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={copyContent} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.05]">
              <CopyIcon className="h-3.5 w-3.5" />
              {copied ? '已复制' : '复制全部内容'}
            </button>
            <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">小白用户先看：安装和使用生图 Skill</h3>
            <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">第一次使用时，推荐先把下面的一句话发送给 Codex App、Claude Code、WorkBuddy、OpenCode 或 Trae。智能体会先确认是否复用当前 Base URL 和 API Key，确认后即可按照同步流式方式生图。</p>
            <pre className={`${codeClass} whitespace-pre-wrap`}>{skillInstallPrompt}</pre>
            <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">Codex App 也可以直接安装：{codexInstallPrompt} API Key 不要发到公开群聊，也不要写入 URL、代码或日志。</p>
            <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">其他智能体可导入：<code className="break-all">{skillRepositoryUrl}</code>。如果不支持自动导入，请下载仓库，把 <code>SKILL.md</code> 和 <code>agents/openai.yaml</code> 放入其 Skill 目录。</p>
            <h3 className="pt-3 text-sm font-semibold text-gray-800 dark:text-gray-100">同步流式 API 示例</h3>
            <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">推荐使用 Responses API。请求保持连接并通过事件流返回中间图像和最终图像，适合生成时间较长的任务。</p>
            <pre className={codeClass}>{`POST ${baseUrl}/responses
Authorization: Bearer ${apiKey}
Content-Type: application/json

{
  "model": "${profile.model || 'gpt-5.5'}",
  "stream": true,
  "input": "一幅雨夜中的霓虹城市，电影级光影",
  "tools": [{
    "type": "image_generation",
    "action": "generate",
    "model": "${imageModel}",
    "size": "1024x1024",
    "quality": "auto",
    "background": "transparent",
    "partial_images": 2
  }]
}`}</pre>
            <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">客户端应持续读取流式事件，直到收到最终图像或错误事件。不要用固定的短超时中断请求。</p>
            <h3 className="pt-3 text-sm font-semibold text-gray-800 dark:text-gray-100">Images API 文生图</h3>
            <pre className={codeClass}>{`POST ${baseUrl}/images/generations
Authorization: Bearer ${apiKey}
Content-Type: application/json

{
  "model": "${imageModel}",
  "prompt": "一幅雨夜中的霓虹城市。请严格按照 3:4 的画面比例生成图片。",
  "size": "768x1024",
  "quality": "auto",
  "background": "transparent",
  "stream": true,
  "partial_images": 2
}`}</pre>
            <h3 className="pt-3 text-sm font-semibold text-gray-800 dark:text-gray-100">图片编辑</h3>
            <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">图片编辑使用 multipart/form-data。多张图片使用多个同名 `image[]` 字段上传。</p>
            <pre className={codeClass}>{`POST ${baseUrl}/images/edits
Authorization: Bearer ${apiKey}

model=${imageModel}
prompt=保留主体，改成水彩画风。请严格按照 3:4 的画面比例生成图片。
image[]=@reference-1.png
image[]=@reference-2.png
mask=@mask.png                 # 可选
size=768x1024
background=transparent
stream=true
partial_images=2`}</pre>
            <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">透明背景建议使用 PNG 或 WebP。若接口不支持原生透明背景，应由服务端或客户端执行透明背景处理。</p>
            <h3 className="pt-3 text-sm font-semibold text-gray-800 dark:text-gray-100">一句话交给智能体</h3>
            <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">把下面这句话发送给 Codex App、Claude Code、WorkBuddy、OpenCode 或 Trae。智能体会先向你索取 Base URL 和 API Key，配置完成后即可直接生图。</p>
            <pre className={`${codeClass} whitespace-pre-wrap`}>请帮我配置并使用同步流式图片生成 API。请先向我索取 Base URL（包含 /v1）和 API Key；收到后仅用于本次会话，不要写入代码、URL、日志或提交到仓库。默认使用 Responses API 的 POST {'{base_url}'}/responses，外层模型使用 {profile.model || 'gpt-5.5'}，stream=true，并在 image_generation 工具中使用图片模型 {imageModel}、partial_images=2；生成或编辑时持续读取流式事件直到最终图片完成，编辑支持多张参考图片。请先验证配置，再开始生图。</pre>
            <h3 className="pt-3 text-sm font-semibold text-gray-800 dark:text-gray-100">给智能体的 Skill 指令</h3>
            <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">以下内容可以直接复制给 Codex、Claude Code、WorkBuddy、OpenCode、Trae 等智能体。</p>
            <pre className={`${codeClass} whitespace-pre-wrap`}>{allContent.slice(allContent.indexOf('## 给智能体生成 Skill 的要求'))}</pre>
          </section>
        </div>
      </div>
    </div>
  )
}
