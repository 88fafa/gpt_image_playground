import { useMemo, useState } from 'react'
import { getActiveApiProfile } from '../lib/apiProfiles'
import { getImageGenerationModel } from '../lib/imageModels'
import { useStore } from '../store'
import { CloseIcon, CopyIcon } from './icons'

const codeClass = 'overflow-x-auto rounded-xl bg-gray-950 p-4 text-xs leading-6 text-gray-100 dark:bg-black/40'

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

  const allContent = useMemo(() => `# 同步流式图片生成 API

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
  }],
  "tool_choice": "required"
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

## 给智能体生成 Skill 的要求
你是图片生成 API 客户端。请使用上面的 Base URL 和用户提供的 API Key，调用同步流式接口生成或编辑图片。默认使用图片模型 ${imageModel}。生成时必须传递 size，并在 prompt 最后追加明确的比例要求；编辑时使用 multipart/form-data，多个参考图重复提交 image[]。设置 stream=true 和 partial_images=2，读取流式事件直到最终图片完成。透明背景通过 background=transparent 请求，并优先使用 PNG。`, [baseUrl, imageModel, profile.model])

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
  }],
  "tool_choice": "required"
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
            <h3 className="pt-3 text-sm font-semibold text-gray-800 dark:text-gray-100">给智能体的 Skill 指令</h3>
            <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">以下内容可以直接复制给 Codex、Claude Code、WorkBuddy、OpenCode、Trae 等智能体。</p>
            <pre className={`${codeClass} whitespace-pre-wrap`}>{allContent.slice(allContent.indexOf('## 给智能体生成 Skill 的要求'))}</pre>
          </section>
        </div>
      </div>
    </div>
  )
}
