import { type ApiProfile, type TaskParams } from '../types'
import { dataUrlToBlob, imageDataUrlToPngBlob, maskDataUrlToPngBlob } from './canvasImage'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { appendImageSizeParamsToPrompt } from './size'
import {
  assertImageInputPayloadSize,
  assertMaskEditFileSize,
  type CallApiOptions,
  type CallApiResult,
  fetchImageUrlAsDataUrl,
  getApiErrorMessage,
  mergeActualParams,
  MIME_MAP,
  normalizeBase64Image,
} from './imageApiShared'
import { readRuntimeEnv } from './runtimeEnv'

interface AsyncImageTaskSubmitResponse {
  id?: string
  task_id?: string
  status?: string
  poll_url?: string
}

interface AsyncImageTaskResultItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
}

interface AsyncImageTaskPollResponse {
  id?: string
  task_id?: string
  status?: string
  error?: string | { message?: string }
  result?: {
    data?: AsyncImageTaskResultItem[]
    output_format?: string
    quality?: string
    size?: string
  }
  data?: AsyncImageTaskResultItem[]
}

const DEFAULT_POLL_INTERVAL_MS = 15_000
export function shouldUseAsyncImageApi(profile: ApiProfile): boolean {
  return readRuntimeEnv(import.meta.env.VITE_ASYNC_IMAGE_API_ENABLED) === 'true' &&
    profile.provider === 'openai' &&
    profile.apiMode === 'responses' &&
    profile.streamImages === true
}

function createRequestHeaders(profile: ApiProfile): Record<string, string> {
  return {
    Authorization: `Bearer ${profile.apiKey}`,
  }
}

function asyncImagePath(isEdit: boolean): string {
  return isEdit ? 'images/edits' : 'images/generations'
}

function buildAsyncImageApiUrl(
  profile: ApiProfile,
  path: string,
  proxyConfig: ReturnType<typeof readClientDevProxyConfig>,
  useApiProxy: boolean,
): string {
  // The normal API proxy forwards to sub2api. Async tasks must instead enter this
  // container first, then the worker forwards its streaming Responses request upstream.
  if (useApiProxy) return `/v1/${path.replace(/^\/+/, '')}`
  return buildApiUrl(profile.baseUrl, path, proxyConfig, false)
}

function taskStatus(payload: AsyncImageTaskPollResponse): string {
  return String(payload.status ?? '').trim().toLowerCase()
}

function taskErrorMessage(payload: AsyncImageTaskPollResponse): string {
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  if (payload.error && typeof payload.error === 'object' && typeof payload.error.message === 'string') {
    return payload.error.message
  }
  return '异步生图任务失败'
}

function retryAfterMs(response: Response): number {
  const value = Number(response.headers.get('Retry-After'))
  return Number.isFinite(value) && value > 0 ? value * 1000 : DEFAULT_POLL_INTERVAL_MS
}

function submitRetryAfterMs(response: Response): number {
  const value = Number(response.headers.get('Retry-After'))
  return Number.isFinite(value) && value > 0 ? value * 1000 : 0
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

async function submitAsyncImageTask(opts: CallApiOptions, profile: ApiProfile, signal: AbortSignal): Promise<{
  payload: AsyncImageTaskSubmitResponse
  retryAfterMs: number
}> {
  const { prompt, params, inputImageDataUrls } = opts
  const isEdit = inputImageDataUrls.length > 0
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const requestHeaders = createRequestHeaders(profile)
  const endpoint = buildAsyncImageApiUrl(profile, asyncImagePath(isEdit), proxyConfig, useApiProxy)

  let response: Response
  if (isEdit) {
    const formData = new FormData()
    formData.append('model', profile.model)
    formData.append('prompt', prompt)
    formData.append('size', params.size)
    formData.append('output_format', params.output_format)
    formData.append('moderation', params.moderation)
    formData.append('quality', params.quality)
    formData.append('n', String(params.n))
    formData.append('response_format', 'url')
    formData.append('partial_images', String(profile.streamPartialImages ?? 1))
    formData.append('allow_prompt_rewrite', String(Boolean(opts.settings.allowPromptRewrite)))

    if (params.output_format !== 'png' && params.output_compression != null) {
      formData.append('output_compression', String(params.output_compression))
    }

    const imageBlobs: Blob[] = []
    for (let i = 0; i < inputImageDataUrls.length; i++) {
      const dataUrl = inputImageDataUrls[i]
      const blob = opts.maskDataUrl && i === 0
        ? await imageDataUrlToPngBlob(dataUrl)
        : await dataUrlToBlob(dataUrl)
      imageBlobs.push(blob)
    }

    const maskBlob = opts.maskDataUrl ? await maskDataUrlToPngBlob(opts.maskDataUrl) : null
    if (opts.maskDataUrl) {
      assertMaskEditFileSize('遮罩主图文件', imageBlobs[0]?.size ?? 0)
      assertMaskEditFileSize('遮罩文件', maskBlob?.size ?? 0)
    }
    assertImageInputPayloadSize(
      imageBlobs.reduce((sum, blob) => sum + blob.size, 0) + (maskBlob?.size ?? 0),
    )

    for (let i = 0; i < imageBlobs.length; i++) {
      const blob = imageBlobs[i]
      const ext = blob.type.split('/')[1] || 'png'
      formData.append('image[]', blob, `input-${i + 1}.${ext}`)
    }
    if (maskBlob) formData.append('mask', maskBlob, 'mask.png')

    response = await fetch(endpoint, {
      method: 'POST',
      headers: requestHeaders,
      cache: 'no-store',
      body: formData,
      signal,
    })
  } else {
    const body: Record<string, unknown> = {
      model: profile.model,
      prompt,
      size: params.size,
      output_format: params.output_format,
      moderation: params.moderation,
      quality: params.quality,
      n: params.n,
      response_format: 'url',
      partial_images: profile.streamPartialImages ?? 1,
      allow_prompt_rewrite: Boolean(opts.settings.allowPromptRewrite),
    }
    if (params.output_format !== 'png' && params.output_compression != null) {
      body.output_compression = params.output_compression
    }

    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...requestHeaders,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(body),
      signal,
    })
  }

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response))
  }
  return {
    payload: await response.json() as AsyncImageTaskSubmitResponse,
    retryAfterMs: submitRetryAfterMs(response),
  }
}

async function pollAsyncImageTask(profile: ApiProfile, taskId: string, mime: string, signal: AbortSignal, initialDelayMs = 0): Promise<CallApiResult> {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const requestHeaders = createRequestHeaders(profile)
  const endpoint = buildAsyncImageApiUrl(profile, `images/tasks/${encodeURIComponent(taskId)}`, proxyConfig, useApiProxy)

  let delayMs = initialDelayMs
  while (true) {
    if (delayMs > 0) await sleep(delayMs, signal)
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: requestHeaders,
      cache: 'no-store',
      signal,
    })
    if (!response.ok) throw new Error(await getApiErrorMessage(response))

    const payload = await response.json() as AsyncImageTaskPollResponse
    const status = taskStatus(payload)
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      return parseAsyncImageTaskResult(payload, mime, signal)
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'error') {
      throw new Error(taskErrorMessage(payload))
    }
    delayMs = retryAfterMs(response)
  }
}

async function parseAsyncImageTaskResult(payload: AsyncImageTaskPollResponse, mime: string, signal: AbortSignal): Promise<CallApiResult> {
  const items = payload.result?.data ?? payload.data ?? []
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('异步生图任务未返回图片数据')
    ;(err as any).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }

  const images: string[] = []
  const rawImageUrls: string[] = []
  const actualParamsList: Array<Partial<TaskParams>> = []
  const revisedPrompts: Array<string | undefined> = []

  for (const item of items) {
    if (item.b64_json) {
      images.push(normalizeBase64Image(item.b64_json, mime))
    } else if (item.url) {
      rawImageUrls.push(item.url)
      images.push(await fetchImageUrlAsDataUrl(item.url, mime, signal))
    }

    actualParamsList.push(mergeActualParams({
      output_format: (item.output_format ?? payload.result?.output_format) as TaskParams['output_format'] | undefined,
      quality: (item.quality ?? payload.result?.quality) as TaskParams['quality'] | undefined,
      size: item.size ?? payload.result?.size,
    }) ?? {})
    revisedPrompts.push(item.revised_prompt)
  }

  if (images.length === 0) {
    const err = new Error('异步生图任务未返回可用图片')
    ;(err as any).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }

  return {
    images,
    actualParams: mergeActualParams(actualParamsList[0] ?? {}, { n: images.length }),
    actualParamsList,
    revisedPrompts,
    ...(rawImageUrls.length ? { rawImageUrls } : {}),
  }
}

export async function callAsyncImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  const mime = MIME_MAP[opts.params.output_format] || 'image/png'
  const controller = new AbortController()
  const submitTimeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)
  let taskId = ''
  let submissionRetryAfterMs = 0
  const requestOpts = {
    ...opts,
    prompt: appendImageSizeParamsToPrompt(opts.prompt, opts.params.size),
  }

  try {
    const submission = await submitAsyncImageTask(requestOpts, profile, controller.signal)
    const submitPayload = submission.payload
    submissionRetryAfterMs = submission.retryAfterMs
    taskId = String(submitPayload.task_id ?? submitPayload.id ?? '').trim()
    if (!taskId) {
      const err = new Error('异步生图接口未返回 task_id')
      ;(err as any).rawResponsePayload = JSON.stringify(submitPayload, null, 2)
      throw err
    }
  } finally {
    clearTimeout(submitTimeoutId)
  }

  return pollAsyncImageTask(profile, taskId, mime, controller.signal, submissionRetryAfterMs)
}
