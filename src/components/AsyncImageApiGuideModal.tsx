import { useState } from 'react'
import { createPortal } from 'react-dom'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { readRuntimeEnv } from '../lib/runtimeEnv'
import { useStore } from '../store'
import { CloseIcon, CodeIcon, CopyIcon } from './icons'

interface AsyncImageApiGuideModalProps {
  onClose: () => void
}

function getGuideText() {
  const configuredBaseUrl = readRuntimeEnv(import.meta.env.VITE_ASYNC_IMAGE_PUBLIC_BASE_URL).trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  const baseUrl = configuredBaseUrl ? `${configuredBaseUrl}/v1` : '请先配置 ASYNC_IMAGE_PUBLIC_BASE_URL'
  return `# 异步生图 API 使用说明

你是一个可以调用图片生成 API 的智能体。请使用下面的标准异步接口完成图片生成和图片编辑。

## 配置

- Base URL：${baseUrl}
- API Key：由用户自行提供，不要猜测、保存或写入公开 Skill。
- 认证方式：请求头 Authorization: Bearer YOUR_API_KEY
- 任务结果默认保留：24 小时

## 图片生成

### 提交任务

POST ${baseUrl}/images/generations
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY

请求体字段：
- model：模型名称，通常使用 gpt-5.5。
- prompt：必填，图片描述和生成要求。
- size：图片尺寸，例如 1024x1024、1536x1024、1024x1536。
- quality：图片质量，例如 low、medium、high。
- n：生成数量，建议为 1。
- response_format：url 或 b64_json。默认使用 url。
- output_format：png、jpeg 或 webp。
- output_compression：jpeg/webp 的压缩质量，可选 0-100。

图片比例规则：size 决定最终图片比例和清晰度档位。服务端在提交给上游前，会把参数追加到 prompt 最后，例如 \`图片参数：比例1:1  1K\`；如果 prompt 末尾已经有旧的图片参数，会先替换，确保最终比例不会被旧参数覆盖。调用方应始终传入有效的 size，不要只在 prompt 中描述比例。
支持的尺寸档位：1K 使用 1024x1024、1536x1024、1024x1536、1280x720、720x1280、1024x768、768x1024、1280x544；2K 和 4K 使用服务端对应的同等比例尺寸，例如 2048x2048 或 2880x2880。

示例：
curl -X POST '${baseUrl}/images/generations' \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "gpt-5.5",
    "prompt": "一张高质量的产品宣传图",
    "size": "1024x1024",
    "quality": "medium",
    "n": 1,
    "response_format": "url"
  }'

接口会立即返回 HTTP 202 和 task_id，不要重复提交同一个任务。请保存 task_id，并根据 Retry-After 进行轮询。

## 图片编辑

### 提交任务

POST ${baseUrl}/images/edits
Content-Type: multipart/form-data
Authorization: Bearer YOUR_API_KEY

字段：
- model：模型名称，通常使用 gpt-5.5。
- prompt：必填，编辑要求。
- image：要编辑的图片文件，可重复上传多个 image。
- 多图编辑推荐使用重复的 image[] 字段；每个字段对应一个文件，服务端按上传顺序传给模型。
- mask：可选的遮罩图片。
- size、quality、output_format、response_format：含义与图片生成接口相同。

多张图片编辑时，重复上传同名的 image[] 字段，图片会按上传顺序传给模型：

curl -X POST '${baseUrl}/images/edits' \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -F 'model=gpt-5.5' \\
  -F 'prompt=参考这些图片，制作一张统一风格的产品海报' \\
  -F 'image[]=@reference-1.png' \\
  -F 'image[]=@reference-2.png' \\
  -F 'image[]=@reference-3.png' \\
  -F 'size=1536x1024' \\
  -F 'quality=medium' \\
  -F 'response_format=url'

也可以使用 JSON 数组传入已经准备好的 Data URL：

POST ${baseUrl}/images/edits
Content-Type: application/json

{
  "model": "gpt-5.5",
  "prompt": "参考这些图片，制作一张统一风格的产品海报",
  "image": [
    "data:image/png;base64,BASE64_IMAGE_1",
    "data:image/png;base64,BASE64_IMAGE_2"
  ],
  "size": "1536x1024",
  "quality": "medium",
  "response_format": "url"
}

JSON 方式的 image 也可以改用 images 或 input_images 数组；上传本地文件时优先使用上面的 multipart 方式。

示例：
curl -X POST '${baseUrl}/images/edits' \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -F 'model=gpt-5.5' \\
  -F 'prompt=把背景改成浅蓝色，保持主体不变' \\
  -F 'image=@input.png' \\
  -F 'response_format=url'

## 查询任务

GET ${baseUrl}/images/tasks/{task_id}
Authorization: Bearer YOUR_API_KEY

状态：queued、processing、completed、failed。
状态为 queued 或 processing 时，继续按照响应头 Retry-After 的秒数等待；不要固定高频轮询。

completed 时，读取 result.data。使用 url 时下载 result.data[].url；使用 b64_json 时读取 result.data[].b64_json。图片链接会在任务过期后失效。

## 智能体调用规则

1. 先提交生成或编辑任务，记录 task_id。
2. 等待 Retry-After 指定的时间，再查询任务。
3. 只有 status 为 completed 时才读取图片结果。
4. 通过 size 指定目标比例和清晰度；服务端会在最终提交时把 \`图片参数：比例...  1K/2K/4K\` 追加到 prompt 最末尾，并替换 prompt 末尾已有的旧图片参数。
5. 网络中断时不要重新提交任务，优先使用原 task_id 继续查询。
6. API Key 由用户在运行时提供，不要输出到日志、Skill 文件、代码仓库或公开消息中。
7. 需要多个图片时，优先分别提交任务，并遵守服务端返回的排队状态。

请根据用户提供的 Base URL 和 API Key，将以上内容封装成一个可复用的图片生成 Skill。不要修改前端页面，不要把 API Key 固化到 Skill 中。`
}

export default function AsyncImageApiGuideModal({ onClose }: AsyncImageApiGuideModalProps) {
  const [copied, setCopied] = useState(false)
  const showToast = useStore((state) => state.showToast)
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true)

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(getGuideText())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (error) {
      const message = getClipboardFailureMessage('复制说明失败，请手动选择文本复制', error)
      showToast(message, 'error')
    }
  }

  const configuredBaseUrl = readRuntimeEnv(import.meta.env.VITE_ASYNC_IMAGE_PUBLIC_BASE_URL).trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  const baseUrl = configuredBaseUrl ? `${configuredBaseUrl}/v1` : '未配置公网 Base URL'

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/35 backdrop-blur-sm animate-overlay-in" />
      <div
        className="relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-4 py-3.5 sm:px-6 dark:border-white/[0.08]">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 dark:text-gray-100 sm:text-lg">
              <CodeIcon className="h-5 w-5 shrink-0 text-blue-500" />
              异步生图 API 使用说明
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">可复制给 Codex、Claude Code 等智能体，一键生成图片 Skill</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300 dark:hover:bg-blue-400/20"
              title="复制全部说明"
            >
              <CopyIcon className="h-4 w-4" />
              <span className="hidden sm:inline">{copied ? '已复制' : '复制全部内容'}</span>
              <span className="sm:hidden">{copied ? '已复制' : '复制'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭异步生图 API 说明"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5 custom-scrollbar">
          <section className="mb-5 rounded-xl border border-blue-100 bg-blue-50/70 p-3.5 dark:border-blue-400/15 dark:bg-blue-400/[0.08]">
            <div className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:items-center sm:gap-x-4">
              <span className="font-medium text-gray-600 dark:text-gray-300">Base URL</span>
              <code className={`break-all rounded bg-white/80 px-2 py-1 dark:bg-black/15 ${configuredBaseUrl ? 'text-blue-700 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'}`}>{baseUrl}</code>
              <span className="font-medium text-gray-600 dark:text-gray-300">API Key</span>
              <code className="rounded bg-white/80 px-2 py-1 text-gray-600 dark:bg-black/15 dark:text-gray-300">由调用者自行提供：YOUR_API_KEY</code>
            </div>
            <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">API Key 仅用于运行时请求，不会写入这份说明，也不要写入公开 Skill、日志或代码仓库。</p>
          </section>

          <div className="space-y-5 text-sm text-gray-600 dark:text-gray-300">
            <section>
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">1. 图片生成：POST /images/generations</h3>
              <p className="mb-2 leading-6">提交后立即返回 <code>202</code> 和 <code>task_id</code>。请保存任务 ID，并按照响应中的 <code>Retry-After</code> 轮询。</p>
              <div className="overflow-x-auto rounded-xl bg-gray-950 p-3 text-xs leading-5 text-gray-100">
                <pre>{`curl -X POST '${baseUrl}/images/generations' \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "gpt-5.5",
    "prompt": "一张高质量的产品宣传图",
    "size": "1024x1024",
    "quality": "medium",
    "n": 1,
    "response_format": "url"
  }'`}</pre>
              </div>
              <dl className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-[130px_1fr]">
                <dt><code>model</code></dt><dd>模型名称，通常为 <code>gpt-5.5</code>。</dd>
                <dt><code>prompt</code></dt><dd>必填，图片描述和生成要求。</dd>
                <dt><code>size</code></dt><dd>例如 <code>1024x1024</code>、<code>1536x1024</code>、<code>1024x1536</code>。</dd>
                <dt><code>quality</code></dt><dd><code>low</code>、<code>medium</code> 或 <code>high</code>。</dd>
                <dt><code>n</code></dt><dd>生成数量，建议使用 <code>1</code>。</dd>
                <dt><code>response_format</code></dt><dd><code>url</code> 或 <code>b64_json</code>，默认使用 <code>url</code>。</dd>
                <dt><code>output_format</code></dt><dd><code>png</code>、<code>jpeg</code> 或 <code>webp</code>。</dd>
                <dt><code>output_compression</code></dt><dd>JPEG/WebP 压缩质量，可选 0-100。</dd>
              </dl>
              <p className="mt-3 leading-6">请通过 <code>size</code> 指定最终比例和清晰度。服务端真正提交上游前，会先移除 prompt 末尾旧的图片参数，再追加最终的 <code>图片参数：比例...  1K/2K/4K</code>。</p>
            </section>

            <section>
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">2. 图片编辑：POST /images/edits</h3>
              <p className="mb-2 leading-6">使用 <code>multipart/form-data</code>，必须提供 <code>image</code> 文件，可选提供 <code>mask</code> 遮罩。</p>
              <div className="overflow-x-auto rounded-xl bg-gray-950 p-3 text-xs leading-5 text-gray-100">
                <pre>{`curl -X POST '${baseUrl}/images/edits' \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -F 'model=gpt-5.5' \\
  -F 'prompt=把背景改成浅蓝色，保持主体不变' \\
  -F 'image=@input.png' \\
  -F 'response_format=url'`}</pre>
              </div>
              <div className="mt-3 overflow-x-auto rounded-xl bg-gray-950 p-3 text-xs leading-5 text-gray-100">
                <pre>{`# 多张图片：重复使用 image[] 字段
curl -X POST '${baseUrl}/images/edits' \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -F 'model=gpt-5.5' \\
  -F 'prompt=参考这些图片，制作一张统一风格的产品海报' \\
  -F 'image[]=@reference-1.png' \\
  -F 'image[]=@reference-2.png' \\
  -F 'image[]=@reference-3.png' \\
  -F 'size=1536x1024' \\
  -F 'quality=medium' \\
  -F 'response_format=url'`}</pre>
              </div>
              <div className="mt-3 overflow-x-auto rounded-xl bg-gray-950 p-3 text-xs leading-5 text-gray-100">
                <pre>{`// 已准备好 Data URL 时，也可以使用 JSON 数组
POST ${baseUrl}/images/edits
Content-Type: application/json

{
  "model": "gpt-5.5",
  "prompt": "参考这些图片，制作一张统一风格的产品海报",
  "image": [
    "data:image/png;base64,BASE64_IMAGE_1",
    "data:image/png;base64,BASE64_IMAGE_2"
  ],
  "size": "1536x1024",
  "quality": "medium",
  "response_format": "url"
}`}</pre>
              </div>
              <p className="mt-3 leading-6"><code>image</code>、<code>image[]</code> 或 <code>images</code> 都可以作为图片字段；JSON 方式也支持 <code>input_images</code> 数组。多张文件上传请重复同名的 <code>image[]</code> 字段，服务端按上传顺序传给模型。<code>mask</code> 用于限定编辑区域；<code>size</code>、<code>quality</code>、<code>output_format</code> 和 <code>response_format</code> 与生成接口相同。</p>
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/[0.08] dark:text-amber-200">
                提交前的 prompt 最后一行会由服务端统一补齐图片参数，例如 <code>图片参数：比例3:2  1K</code>。智能体应通过 <code>size</code> 传递目标尺寸，不要依赖 prompt 中较早出现的比例描述。
              </div>
            </section>

            <section>
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">3. 查询任务：GET /images/tasks/{'{task_id}'}</h3>
              <div className="overflow-x-auto rounded-xl bg-gray-950 p-3 text-xs leading-5 text-gray-100">
                <pre>{`curl '${baseUrl}/images/tasks/{task_id}' \\
  -H 'Authorization: Bearer YOUR_API_KEY'`}</pre>
              </div>
              <p className="mt-3 leading-6">状态包括 <code>queued</code>、<code>processing</code>、<code>completed</code> 和 <code>failed</code>。处理中按照 <code>Retry-After</code> 等待，完成后读取 <code>result.data</code>。图片链接默认保留 24 小时。</p>
            </section>

            <section className="border-t border-gray-200 pt-5 dark:border-white/[0.08]">
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">4. 交给智能体生成图片 Skill</h3>
              <p className="leading-6">复制全部内容后发送给 Codex、Claude Code 等智能体，并补充真实的 Base URL 和 API Key。智能体应在运行时读取 Key，不要把 Key 固化到 Skill。</p>
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
