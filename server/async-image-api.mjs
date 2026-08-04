import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROMPT_REWRITE_GUARD_PREFIX = 'Use the following text as the complete prompt. Do not rewrite it:'
const DEFAULT_PORT = 8787
const DEFAULT_UPSTREAM_PATH = 'responses'
const DEFAULT_WORKER_CONCURRENCY = 10
const DEFAULT_QUEUE_MAX = 100
const DEFAULT_QUEUE_INPUT_BYTES = 64 * 1024 * 1024
const DEFAULT_REQUEST_BODY_BYTES = 25 * 1024 * 1024
const DEFAULT_TASK_TTL_SECONDS = 24 * 60 * 60
const DEFAULT_CLEANUP_INTERVAL_SECONDS = 5 * 60
const DEFAULT_TASK_TIMEOUT_SECONDS = 30 * 60
const PUBLIC_IMAGE_MODEL = 'gpt-image-2'
const IMAGE_OUTPUT_FORMATS = new Map([
  ['png', { extension: 'png', contentType: 'image/png' }],
  ['jpeg', { extension: 'jpg', contentType: 'image/jpeg' }],
  ['jpg', { extension: 'jpg', contentType: 'image/jpeg' }],
  ['webp', { extension: 'webp', contentType: 'image/webp' }],
])
const IMAGE_PROMPT_PRESETS = new Map([
  ['1024x1024', { ratio: '1:1', tier: '1K' }],
  ['1536x1024', { ratio: '3:2', tier: '1K' }],
  ['1024x1536', { ratio: '2:3', tier: '1K' }],
  ['1280x720', { ratio: '16:9', tier: '1K' }],
  ['720x1280', { ratio: '9:16', tier: '1K' }],
  ['1024x768', { ratio: '4:3', tier: '1K' }],
  ['768x1024', { ratio: '3:4', tier: '1K' }],
  ['1280x544', { ratio: '21:9', tier: '1K' }],
  ['2048x2048', { ratio: '1:1', tier: '2K' }],
  ['2160x1440', { ratio: '3:2', tier: '2K' }],
  ['1440x2160', { ratio: '2:3', tier: '2K' }],
  ['2560x1440', { ratio: '16:9', tier: '2K' }],
  ['1440x2560', { ratio: '9:16', tier: '2K' }],
  ['2048x1536', { ratio: '4:3', tier: '2K' }],
  ['1536x2048', { ratio: '3:4', tier: '2K' }],
  ['2560x1088', { ratio: '21:9', tier: '2K' }],
  ['2880x2880', { ratio: '1:1', tier: '4K' }],
  ['3456x2304', { ratio: '3:2', tier: '4K' }],
  ['2304x3456', { ratio: '2:3', tier: '4K' }],
  ['3840x2160', { ratio: '16:9', tier: '4K' }],
  ['2160x3840', { ratio: '9:16', tier: '4K' }],
  ['3200x2400', { ratio: '4:3', tier: '4K' }],
  ['2400x3200', { ratio: '3:4', tier: '4K' }],
  ['3840x1600', { ratio: '21:9', tier: '4K' }],
])

function log(level, event, fields = {}) {
  const payload = {
    time: new Date().toISOString(),
    level,
    event,
    ...fields,
  }
  const line = JSON.stringify(payload)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

function jsonResponse(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private, max-age=0',
    Pragma: 'no-cache',
    'Access-Control-Allow-Origin': '*',
    ...headers,
  })
  res.end(body)
}

function errorResponse(res, statusCode, type, message, headers = {}) {
  jsonResponse(res, statusCode, {
    error: {
      type,
      message,
    },
  }, headers)
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function buildUpstreamUrl(baseUrl, path = DEFAULT_UPSTREAM_PATH) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) throw new Error('UPSTREAM_RESPONSES_BASE_URL is required')
  return `${normalized}/${String(path).replace(/^\/+/, '')}`
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

class RequestBodyTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Request body exceeds the ${maxBytes} byte limit`)
    this.name = 'RequestBodyTooLargeError'
  }
}

class QueueCapacityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'QueueCapacityError'
    this.code = code
  }
}

function readRequestBody(req, maxBytes = DEFAULT_REQUEST_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(new RequestBodyTooLargeError(maxBytes))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function parseMultipart(contentType, body) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2]
  if (!boundary) throw new Error('multipart boundary is missing')

  const delimiter = Buffer.from(`--${boundary}`)
  const fields = {}
  const files = []
  let cursor = 0

  while (cursor < body.length) {
    const start = body.indexOf(delimiter, cursor)
    if (start < 0) break
    cursor = start + delimiter.length
    if (body[cursor] === 45 && body[cursor + 1] === 45) break
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2

    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor)
    if (headerEnd < 0) break
    const headerText = body.slice(cursor, headerEnd).toString('utf8')
    cursor = headerEnd + 4

    const next = body.indexOf(delimiter, cursor)
    if (next < 0) break
    let partBody = body.slice(cursor, next)
    if (partBody.length >= 2 && partBody[partBody.length - 2] === 13 && partBody[partBody.length - 1] === 10) {
      partBody = partBody.slice(0, -2)
    }
    cursor = next

    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headerText)?.[1] ?? ''
    const name = /name="([^"]+)"/i.exec(disposition)?.[1]
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1]
    const type = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || 'application/octet-stream'
    if (!name) continue

    if (filename !== undefined) {
      files.push({ name, filename, type, body: partBody })
    } else {
      fields[name] = partBody.toString('utf8')
    }
  }

  return { fields, files }
}

function fileToDataUrl(file) {
  return `data:${file.type || 'application/octet-stream'};base64,${file.body.toString('base64')}`
}

function numberValue(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return String(value).trim().toLowerCase() === 'true'
}

function unixTime() {
  return Math.floor(Date.now() / 1000)
}

function safeOutputFormat(value) {
  const normalized = String(value || 'png').trim().toLowerCase()
  return IMAGE_OUTPUT_FORMATS.has(normalized) ? normalized : 'png'
}

function imageFormat(value) {
  return IMAGE_OUTPUT_FORMATS.get(safeOutputFormat(value))
}

function idempotencyHash(value) {
  const normalized = String(value || '').trim()
  return normalized ? createHash('sha256').update(normalized).digest('hex') : ''
}

export function appendImageSizeParamsToPrompt(prompt, size) {
  const normalizedSize = String(size || '').trim().toLowerCase().replace(/\s+/g, '')
  const preset = IMAGE_PROMPT_PRESETS.get(normalizedSize)
  if (!preset) return String(prompt || '').trim()
  const withoutTrailingImageParams = String(prompt || '').trim().replace(/\s*图片参数：比例[^\r\n]*\s*$/, '').trim()
  return `${withoutTrailingImageParams}\n\n图片参数：比例${preset.ratio}  ${preset.tier}`
}

function parseImageRequestFromJson(value) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const images = []
  if (typeof record.image === 'string') images.push(record.image)
  if (Array.isArray(record.image)) images.push(...record.image.filter((item) => typeof item === 'string'))
  if (Array.isArray(record.images)) images.push(...record.images.filter((item) => typeof item === 'string'))
  if (Array.isArray(record.input_images)) images.push(...record.input_images.filter((item) => typeof item === 'string'))

  return {
    model: String(record.model || '').trim(),
    prompt: String(record.prompt || '').trim(),
    size: String(record.size || '').trim(),
    quality: String(record.quality || 'auto').trim(),
    output_format: String(record.output_format || 'png').trim(),
    output_compression: record.output_compression ?? null,
    moderation: String(record.moderation || 'auto').trim(),
    n: numberValue(record.n, 1),
    partial_images: numberValue(record.partial_images, 1),
    response_format: String(record.response_format || 'url').trim().toLowerCase(),
    allow_prompt_rewrite: boolValue(record.allow_prompt_rewrite, false),
    images,
    mask: typeof record.mask === 'string' ? record.mask : undefined,
  }
}

function parseImageRequestFromMultipart(contentType, body) {
  const { fields, files } = parseMultipart(contentType, body)
  const images = files
    .filter((file) => file.name === 'image' || file.name === 'image[]' || file.name === 'images')
    .map(fileToDataUrl)
  const mask = files.find((file) => file.name === 'mask')

  return {
    model: String(fields.model || '').trim(),
    prompt: String(fields.prompt || '').trim(),
    size: String(fields.size || '').trim(),
    quality: String(fields.quality || 'auto').trim(),
    output_format: String(fields.output_format || 'png').trim(),
    output_compression: fields.output_compression ?? null,
    moderation: String(fields.moderation || 'auto').trim(),
    n: numberValue(fields.n, 1),
    partial_images: numberValue(fields.partial_images, 1),
    response_format: String(fields.response_format || 'url').trim().toLowerCase(),
    allow_prompt_rewrite: boolValue(fields.allow_prompt_rewrite, false),
    images,
    mask: mask ? fileToDataUrl(mask) : undefined,
  }
}

async function parseImageRequest(req, maxBytes) {
  const contentType = getHeader(req, 'content-type') || ''
  const body = await readRequestBody(req, maxBytes)
  if (contentType.toLowerCase().includes('multipart/form-data')) {
    return parseImageRequestFromMultipart(contentType, body)
  }
  if (!body.length) throw new Error('Request body is empty')
  return parseImageRequestFromJson(JSON.parse(body.toString('utf8')))
}

function createResponsesInput(prompt, images, allowPromptRewrite) {
  const text = allowPromptRewrite ? prompt : `${PROMPT_REWRITE_GUARD_PREFIX}\n${prompt}`
  if (!images.length) return text
  return [{
    role: 'user',
    content: [
      { type: 'input_text', text },
      ...images.map((imageUrl) => ({ type: 'input_image', image_url: imageUrl })),
    ],
  }]
}

export function buildResponsesRequest(imageRequest, options = {}) {
  const isEdit = imageRequest.images.length > 0
  // The public image API accepts gpt-image-2. This bridge always uses its
  // configured Responses model when calling sub2api's image_generation tool.
  const model = String(options.upstreamModel || 'gpt-5.5').trim()
  if (!model) throw new Error('model is required')
  if (!imageRequest.prompt) throw new Error('prompt is required')
  const prompt = appendImageSizeParamsToPrompt(imageRequest.prompt, imageRequest.size)

  const tool = {
    type: 'image_generation',
    action: isEdit ? 'edit' : 'generate',
    model: PUBLIC_IMAGE_MODEL,
    size: imageRequest.size || undefined,
    output_format: imageRequest.output_format || 'png',
    moderation: imageRequest.moderation || 'auto',
    partial_images: imageRequest.partial_images || 1,
  }

  if (imageRequest.quality) tool.quality = imageRequest.quality
  if (imageRequest.output_format !== 'png' && imageRequest.output_compression !== null && imageRequest.output_compression !== undefined && imageRequest.output_compression !== '') {
    tool.output_compression = Number(imageRequest.output_compression)
  }
  if (imageRequest.mask) {
    tool.input_image_mask = { image_url: imageRequest.mask }
  }

  Object.keys(tool).forEach((key) => tool[key] === undefined && delete tool[key])

  return {
    model,
    input: createResponsesInput(prompt, imageRequest.images, imageRequest.allow_prompt_rewrite),
    tools: [tool],
    tool_choice: { type: 'image_generation' },
    stream: true,
  }
}

function parseSseDataBlocks(text) {
  const blocks = []
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
      .trim()
    if (data && data !== '[DONE]') blocks.push(data)
  }
  return blocks
}

function imageResultBase64(result) {
  if (typeof result === 'string' && result.trim()) return result.trim()
  if (!result || typeof result !== 'object') return ''
  for (const key of ['b64_json', 'base64', 'image_base64', 'result']) {
    const value = result[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function collectImageItemsFromOutput(output) {
  if (!Array.isArray(output)) return []
  return output
    .filter((item) => item && typeof item === 'object' && (
      item.type === 'image_generation_call' ||
      item.type === 'image_generation.completed' ||
      item.type === 'image_edit.completed'
    ))
    .map((item) => ({
      // Responses providers disagree on whether the final payload lives in
      // `result` or directly on the completed event as `b64_json`.
      b64_json: imageResultBase64(item.result) || imageResultBase64(item),
      revised_prompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
      size: typeof item.size === 'string' ? item.size : undefined,
      quality: typeof item.quality === 'string' ? item.quality : undefined,
      output_format: typeof item.output_format === 'string' ? item.output_format : undefined,
    }))
    .filter((item) => item.b64_json)
}

function createSseImageCollector() {
  const images = []
  const imageDigests = new Set()
  let lastError = ''

  function collectImageApiData(data) {
    if (!Array.isArray(data)) return
    addImages(data
      .filter((item) => item && typeof item === 'object' && (
        typeof item.b64_json === 'string' ||
        typeof item.base64 === 'string' ||
        typeof item.image_base64 === 'string'
      ))
      .map((item) => ({
        ...item,
        type: item.type || 'image_generation.completed',
      })))
  }

  function addData(data) {
    let event
    try {
      event = JSON.parse(data)
    } catch {
      return
    }
    if (!event || typeof event !== 'object') return

    if (event.error) {
      lastError = typeof event.error === 'string' ? event.error : event.error.message || 'upstream error'
    }
    if (event.type === 'response.failed' && event.response?.error) {
      lastError = event.response.error.message || event.response.error.code || 'upstream response failed'
    }
    if (event.type === 'response.incomplete') {
      const reason = event.response?.incomplete_details?.reason
      lastError = reason ? `upstream response incomplete: ${reason}` : 'upstream response incomplete'
    }
    if (event.type?.endsWith?.('.failed') && event.message) {
      lastError = String(event.message)
    }
    if (event.type === 'response.output_item.done') {
      addImages(collectImageItemsFromOutput([event.item || event.output_item]))
    }
    if (event.type === 'response.completed' || event.type === 'response.done') {
      addImages(collectImageItemsFromOutput(event.response?.output || event.output))
    }
    if (event.type === 'image_generation.completed' || event.type === 'image_edit.completed') {
      addImages(collectImageItemsFromOutput([event]))
    }

    // A few OpenAI-compatible gateways ignore `stream: true` and return a
    // normal Responses/Images JSON payload. Accept those bodies as well.
    collectImageApiData(event.data)
    if (!event.type) {
      addImages(collectImageItemsFromOutput(event.response?.output || event.output))
    }
  }

  function addImages(candidates) {
    for (const image of candidates) {
      // Some Responses implementations emit the same final image both as an
      // output-item event and inside response.completed. Keep one copy only.
      const digest = createHash('sha256').update(image.b64_json).digest('hex')
      if (imageDigests.has(digest)) continue
      imageDigests.add(digest)
      images.push(image)
    }
  }

  function result() {
    if (!images.length && lastError) throw new Error(lastError)
    if (!images.length) throw new Error('upstream did not return image output')
    return images
  }

  return { addData, result }
}

function sseDataFromBlock(block) {
  const data = String(block || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n')
    .trim()
  return data && data !== '[DONE]' ? data : ''
}

export function extractImagesFromResponsesSSE(text) {
  const collector = createSseImageCollector()
  const blocks = parseSseDataBlocks(text)
  if (blocks.length) {
    for (const data of blocks) collector.addData(data)
  } else if (String(text || '').trim()) {
    // Handle a plain JSON response when the upstream does not honor SSE.
    collector.addData(String(text).trim())
  }
  return collector.result()
}

export async function extractImagesFromResponsesSSEStream(body) {
  if (!body || typeof body.getReader !== 'function') {
    throw new Error('upstream response body is not a readable stream')
  }

  const collector = createSseImageCollector()
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  function consumeCompleteBlocks() {
    while (true) {
      const separator = /\r?\n\r?\n/.exec(buffer)
      if (!separator || separator.index === undefined) return
      const block = buffer.slice(0, separator.index)
      buffer = buffer.slice(separator.index + separator[0].length)
      const data = sseDataFromBlock(block)
      if (data) collector.addData(data)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      consumeCompleteBlocks()
    }
    buffer += decoder.decode()
    consumeCompleteBlocks()
    const finalData = sseDataFromBlock(buffer)
    if (finalData) collector.addData(finalData)
    else if (buffer.trim()) collector.addData(buffer.trim())
    return collector.result()
  } finally {
    reader.releaseLock?.()
  }
}

function persistedTask(task) {
  return {
    id: task.id,
    task_id: task.task_id,
    object: task.object,
    status: task.status,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
    expires_at: task.expires_at,
    idempotency_hash: task.idempotency_hash,
    response_format: task.request?.response_format || task.response_format || 'url',
    result: task.result,
    error: task.error,
  }
}

export function createFileTaskStore(options = {}) {
  const rootDir = options.storageDir || process.env.ASYNC_IMAGE_STORAGE_DIR || join(process.cwd(), 'data', 'async-image')
  const taskDir = join(rootDir, 'tasks')
  const imageDir = join(rootDir, 'images')

  let initialization
  const pendingTaskWrites = new Map()
  async function initialize() {
    if (!initialization) initialization = Promise.all([mkdir(taskDir, { recursive: true }), mkdir(imageDir, { recursive: true })])
    await initialization
  }

  function taskPath(taskId) {
    return join(taskDir, `${taskId}.json`)
  }

  async function writeJsonAtomically(path, value) {
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(value), 'utf8')
    await rename(temporaryPath, path)
  }

  async function saveTask(task) {
    await initialize()
    const id = task.task_id
    const snapshot = persistedTask(task)
    const previousWrite = pendingTaskWrites.get(id) || Promise.resolve()
    const write = previousWrite
      .catch(() => undefined)
      .then(() => writeJsonAtomically(taskPath(id), snapshot))
    pendingTaskWrites.set(id, write)
    try {
      await write
    } finally {
      if (pendingTaskWrites.get(id) === write) pendingTaskWrites.delete(id)
    }
  }

  async function loadTasks() {
    let files = []
    try {
      files = await readdir(taskDir)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const records = await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
      try {
        const content = await readFile(join(taskDir, file), 'utf8')
        const task = JSON.parse(content)
        return task && typeof task === 'object' && typeof task.task_id === 'string' ? task : null
      } catch (error) {
        log('warn', 'task_store_load_failed', { file, message: error instanceof Error ? error.message : String(error) })
        return null
      }
    }))
    return records.filter(Boolean)
  }

  async function saveImages(task, images, startIndex = 0) {
    await initialize()
    const outputFormat = safeOutputFormat(images[0]?.output_format || task.request.output_format)
    const format = imageFormat(outputFormat)
    const saved = []
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index]
      const bytes = Buffer.from(image.b64_json, 'base64')
      if (!bytes.length) throw new Error('upstream returned an empty image')
      const filename = `${task.task_id}-${startIndex + index + 1}.${format.extension}`
      await writeFile(join(imageDir, filename), bytes)
      saved.push({
        file: filename,
        size: image.size,
        quality: image.quality,
        output_format: safeOutputFormat(image.output_format || outputFormat),
      })
    }
    return saved
  }

  async function readImage(file) {
    await initialize()
    const name = basename(String(file || ''))
    if (name !== file || !/^imgtask_[a-f0-9]+-\d+\.(png|jpg|webp)$/.test(name)) return null
    const path = join(imageDir, name)
    try {
      const [data, info] = await Promise.all([readFile(path), stat(path)])
      if (!info.isFile()) return null
      return { data, contentType: imageFormat(extname(name).slice(1)).contentType }
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async function deleteTask(task) {
    await initialize()
    await pendingTaskWrites.get(task.task_id)?.catch(() => undefined)
    const items = task.result?.data || []
    await Promise.all(items.map((item) => item.file ? rm(join(imageDir, basename(item.file)), { force: true }) : Promise.resolve()))
    await rm(taskPath(task.task_id), { force: true })
  }

  return { rootDir, initialize, saveTask, loadTasks, saveImages, readImage, deleteTask }
}

async function readBoundedResponseText(response, maxBytes = 64 * 1024) {
  if (!response.body || typeof response.body.getReader !== 'function') return response.text()
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      const remaining = maxBytes - total
      chunks.push(chunk.subarray(0, remaining))
      total += Math.min(chunk.length, remaining)
    }
  } finally {
    await reader.cancel?.().catch(() => undefined)
    reader.releaseLock?.()
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function callUpstreamResponses(imageRequest, options, authorization, signal, onImages) {
  const n = Math.max(1, Math.floor(numberValue(imageRequest.n, 1)))
  const data = []
  for (let i = 0; i < n; i++) {
    const body = buildResponsesRequest({ ...imageRequest, n: 1 }, options)
    const upstreamUrl = buildUpstreamUrl(options.upstreamBaseUrl)
    const startedAt = Date.now()
    log('info', 'upstream_request_start', {
      request_index: i,
      total_requests: n,
      model: body.model,
      is_edit: imageRequest.images.length > 0,
      size: imageRequest.size || undefined,
      output_format: imageRequest.output_format || undefined,
    })
    const response = await options.fetchImpl(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: options.upstreamApiKey ? `Bearer ${options.upstreamApiKey}` : authorization,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const text = await readBoundedResponseText(response)
      let message = `upstream request failed (${response.status})`
      try {
        const payload = JSON.parse(text)
        message = payload.error?.message || message
      } catch {
        if (text.trim()) message = text.trim().slice(0, 500)
      }
      log('error', 'upstream_request_failed', {
        request_index: i,
        status: response.status,
        duration_ms: Date.now() - startedAt,
        message,
      })
      throw new Error(message)
    }
    const images = response.body && typeof response.body.getReader === 'function'
      ? await extractImagesFromResponsesSSEStream(response.body)
      : extractImagesFromResponsesSSE(await response.text())
    log('info', 'upstream_request_completed', {
      request_index: i,
      status: response.status,
      duration_ms: Date.now() - startedAt,
      image_count: images.length,
    })
    if (onImages) await onImages(images)
    else data.push(...images)
  }
  return data
}

export function createTaskManager(options = {}) {
  const tasks = new Map()
  const tasksByIdempotencyKey = new Map()
  const queue = []
  let activeCount = 0
  let queueInputBytes = 0
  const managerOptions = {
    upstreamBaseUrl: options.upstreamBaseUrl || process.env.UPSTREAM_RESPONSES_BASE_URL || process.env.API_PROXY_URL || '',
    upstreamApiKey: options.upstreamApiKey || process.env.UPSTREAM_API_KEY || '',
    upstreamModel: options.upstreamModel || process.env.UPSTREAM_RESPONSES_MODEL || 'gpt-5.5',
    workerConcurrency: Math.max(1, Math.floor(numberValue(options.workerConcurrency || process.env.ASYNC_IMAGE_WORKER_CONCURRENCY, DEFAULT_WORKER_CONCURRENCY))),
    queueMax: Math.max(1, Math.floor(numberValue(options.queueMax || process.env.ASYNC_IMAGE_QUEUE_MAX, DEFAULT_QUEUE_MAX))),
    queueInputBytesMax: Math.max(1024, Math.floor(numberValue(options.queueInputBytesMax || process.env.ASYNC_IMAGE_QUEUE_MAX_INPUT_BYTES, DEFAULT_QUEUE_INPUT_BYTES))),
    maxRequestBytes: Math.max(1024, Math.floor(numberValue(options.maxRequestBytes || process.env.ASYNC_IMAGE_MAX_REQUEST_BYTES, DEFAULT_REQUEST_BODY_BYTES))),
    taskTtlSeconds: Math.max(60, Math.floor(numberValue(options.taskTtlSeconds || process.env.ASYNC_IMAGE_TASK_TTL_SECONDS, DEFAULT_TASK_TTL_SECONDS))),
    cleanupIntervalSeconds: Math.max(10, Math.floor(numberValue(options.cleanupIntervalSeconds || process.env.ASYNC_IMAGE_TASK_CLEANUP_INTERVAL_SECONDS, DEFAULT_CLEANUP_INTERVAL_SECONDS))),
    taskTimeoutSeconds: Math.max(60, Math.floor(numberValue(options.taskTimeoutSeconds || process.env.ASYNC_IMAGE_TASK_TIMEOUT_SECONDS, DEFAULT_TASK_TIMEOUT_SECONDS))),
    fetchImpl: options.fetchImpl || globalThis.fetch,
  }
  const store = options.store || createFileTaskStore({ storageDir: options.storageDir })
  let initialized = false
  let initPromise = null

  if (typeof managerOptions.fetchImpl !== 'function') {
    throw new Error('fetch is not available')
  }

  async function persist(task) {
    try {
      await store.saveTask(task)
    } catch (error) {
      log('error', 'task_store_save_failed', {
        task_id: task.task_id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function initialize() {
    if (initialized) return
    if (initPromise) return initPromise
    initPromise = (async () => {
      await store.initialize()
      const savedTasks = await store.loadTasks()
      const now = unixTime()
      for (const savedTask of savedTasks) {
        if (!savedTask.expires_at || savedTask.expires_at <= now) {
          await store.deleteTask(savedTask)
          continue
        }
        if (savedTask.status === 'queued' || savedTask.status === 'processing') {
          savedTask.status = 'failed'
          savedTask.error = { message: 'task interrupted by server restart' }
          savedTask.updated_at = now
          savedTask.completed_at = now
          await store.saveTask(savedTask)
        }
        tasks.set(savedTask.task_id, savedTask)
        if (savedTask.idempotency_hash) tasksByIdempotencyKey.set(savedTask.idempotency_hash, savedTask.task_id)
      }
      initialized = true
      log('info', 'task_store_ready', { storage_dir: store.rootDir, recovered_tasks: tasks.size })
    })()
    return initPromise
  }

  function startTask(task) {
    activeCount += 1
    queueInputBytes = Math.max(0, queueInputBytes - (task.queued_input_bytes || 0))
    delete task.queued_input_bytes
    task.status = 'processing'
    task.updated_at = Math.floor(Date.now() / 1000)
    task.started_at = task.updated_at
    const startedAt = Date.now()
    log('info', 'task_started', {
      task_id: task.task_id,
      queued_remaining: queue.length,
      active_workers: activeCount,
      worker_concurrency: managerOptions.workerConcurrency,
    })
    void persist(task)

    void (async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), managerOptions.taskTimeoutSeconds * 1000)
      try {
        const storedImages = []
        await callUpstreamResponses(task.request, managerOptions, task.authorization, controller.signal, async (images) => {
          const saved = await store.saveImages(task, images, storedImages.length)
          storedImages.push(...saved)
        })
        task.status = 'completed'
        task.result = { data: storedImages }
        task.completed_at = unixTime()
        task.response_format = task.request.response_format
        delete task.request
        delete task.authorization
        log('info', 'task_completed', {
          task_id: task.task_id,
          duration_ms: Date.now() - startedAt,
          image_count: storedImages.length,
        })
      } catch (error) {
        task.status = 'failed'
        task.error = { message: controller.signal.aborted ? `task timed out after ${managerOptions.taskTimeoutSeconds} seconds` : error instanceof Error ? error.message : String(error) }
        task.completed_at = unixTime()
        task.response_format = task.request.response_format
        delete task.request
        delete task.authorization
        log('error', 'task_failed', {
          task_id: task.task_id,
          duration_ms: Date.now() - startedAt,
          message: task.error.message,
        })
      } finally {
        clearTimeout(timeout)
        task.updated_at = unixTime()
        await persist(task)
        activeCount = Math.max(0, activeCount - 1)
        drain()
      }
    })()
  }

  function drain() {
    while (activeCount < managerOptions.workerConcurrency && queue.length) {
      const id = queue.shift()
      const task = tasks.get(id)
      if (!task || task.status !== 'queued') continue
      startTask(task)
    }
  }

  function submit(request, authorization = '', idempotencyKey = '') {
    const normalizedIdempotencyKey = idempotencyHash(idempotencyKey)
    if (normalizedIdempotencyKey && tasksByIdempotencyKey.has(normalizedIdempotencyKey)) {
      const existing = tasks.get(tasksByIdempotencyKey.get(normalizedIdempotencyKey))
      if (existing) {
        log('info', 'task_idempotency_hit', {
          task_id: existing.task_id,
          status: existing.status,
        })
        return existing
      }
    }

    if (queue.length >= managerOptions.queueMax) {
      throw new QueueCapacityError('queue_full', `Image queue is full (maximum ${managerOptions.queueMax} waiting tasks)`)
    }

    const queuedInputBytes = Buffer.byteLength(JSON.stringify({ request, authorization }), 'utf8')
    if (queueInputBytes + queuedInputBytes > managerOptions.queueInputBytesMax) {
      throw new QueueCapacityError('queue_input_limit', `Queued image input exceeds the ${managerOptions.queueInputBytesMax} byte limit`)
    }

    const id = `imgtask_${randomUUID().replace(/-/g, '')}`
    const now = unixTime()
    const task = {
      id,
      task_id: id,
      object: 'image.task',
      status: 'queued',
      created_at: now,
      updated_at: now,
      request,
      authorization,
      queued_input_bytes: queuedInputBytes,
      idempotency_hash: normalizedIdempotencyKey || undefined,
      expires_at: now + managerOptions.taskTtlSeconds,
    }
    tasks.set(id, task)
    if (normalizedIdempotencyKey) tasksByIdempotencyKey.set(normalizedIdempotencyKey, id)
    queue.push(id)
    queueInputBytes += queuedInputBytes
    log('info', 'task_submitted', {
      task_id: id,
      queue_position: queue.length,
      is_edit: request.images.length > 0,
      n: request.n,
      size: request.size || undefined,
      output_format: request.output_format || undefined,
    })
    void persist(task)
    drain()
    return task
  }

  function get(id) {
    return tasks.get(id)
  }

  function position(id) {
    const index = queue.indexOf(id)
    return index >= 0 ? index + 1 : 0
  }

  async function cleanup() {
    const now = unixTime()
    const expired = [...tasks.values()].filter((task) => task.expires_at && task.expires_at <= now && task.status !== 'queued' && task.status !== 'processing')
    for (const task of expired) {
      tasks.delete(task.task_id)
      if (task.idempotency_hash) tasksByIdempotencyKey.delete(task.idempotency_hash)
      await store.deleteTask(task)
      log('info', 'task_expired', { task_id: task.task_id })
    }
    return expired.length
  }

  const cleanupTimer = setInterval(() => {
    void cleanup().catch((error) => log('error', 'task_cleanup_failed', { message: error instanceof Error ? error.message : String(error) }))
  }, managerOptions.cleanupIntervalSeconds * 1000)
  cleanupTimer.unref?.()

  return {
    submit,
    get,
    position,
    initialize,
    cleanup,
    store,
    get running() {
      return activeCount > 0
    },
    get activeCount() {
      return activeCount
    },
    get workerConcurrency() {
      return managerOptions.workerConcurrency
    },
    get queueLength() {
      return queue.length
    },
    get taskTtlSeconds() {
      return managerOptions.taskTtlSeconds
    },
    get taskTimeoutSeconds() {
      return managerOptions.taskTimeoutSeconds
    },
    get queueMax() {
      return managerOptions.queueMax
    },
    get queueInputBytes() {
      return queueInputBytes
    },
    get queueInputBytesMax() {
      return managerOptions.queueInputBytesMax
    },
    get maxRequestBytes() {
      return managerOptions.maxRequestBytes
    },
  }
}

function publicImageUrl(req, file) {
  const configuredBaseUrl = String(process.env.ASYNC_IMAGE_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  if (configuredBaseUrl) return `${configuredBaseUrl}/v1/images/files/${encodeURIComponent(file)}`
  const forwardedProtocol = String(getHeader(req, 'x-forwarded-proto') || '').split(',')[0].trim().toLowerCase()
  const protocol = forwardedProtocol === 'https' ? 'https' : 'http'
  const host = String(getHeader(req, 'x-forwarded-host') || getHeader(req, 'host') || 'localhost').split(',')[0].trim()
  return `${protocol}://${host}/v1/images/files/${encodeURIComponent(file)}`
}

function retryAfterSeconds(task, manager) {
  if (!task || task.status === 'completed' || task.status === 'failed') return 0
  if (task.status === 'queued') {
    const position = Math.max(1, manager?.position?.(task.task_id) || 1)
    const workers = Math.max(1, manager?.workerConcurrency || 1)
    return Math.min(60, Math.max(30, 30 * Math.ceil(position / workers)))
  }
  const startedAt = Number(task.started_at || task.updated_at || task.created_at || unixTime())
  const elapsed = Math.max(0, unixTime() - startedAt)
  // Most GPT image tasks finish around 70-120 seconds. Poll slowly before
  // that window, then use a five-second interval only while it is valuable.
  if (elapsed < 50) return 25
  if (elapsed < 65) return 15
  if (elapsed < 120) return 5
  if (elapsed < 180) return 10
  if (elapsed < 300) return 30
  return 60
}

async function publicTask(task, manager, req) {
  if (!task) return null
  let result
  if (task.status === 'completed') {
    const responseFormat = task.response_format || 'url'
    const data = await Promise.all((task.result?.data || []).map(async (item) => {
      const shared = {
        ...(item.size ? { size: item.size } : {}),
        ...(item.quality ? { quality: item.quality } : {}),
        ...(item.output_format ? { output_format: item.output_format } : {}),
      }
      if (responseFormat === 'b64_json') {
        const image = await manager.store.readImage(item.file)
        if (!image) throw new Error('stored task image is missing')
        return { ...shared, b64_json: image.data.toString('base64') }
      }
      return { ...shared, url: publicImageUrl(req, item.file) }
    }))
    result = { data }
  }
  return {
    id: task.id,
    task_id: task.task_id,
    object: task.object,
    status: task.status,
    queue_position: manager?.position ? manager.position(task.id) : 0,
    ...(task.status === 'queued' || task.status === 'processing'
      ? { retry_after_seconds: retryAfterSeconds(task, manager) }
      : {}),
    created_at: task.created_at,
    updated_at: task.updated_at,
    ...(task.expires_at ? { expires_at: task.expires_at } : {}),
    ...(result ? { result } : {}),
    ...(task.status === 'failed' ? { error: task.error } : {}),
  }
}

export function createAsyncImageApiServer(options = {}) {
  const manager = options.manager || createTaskManager(options)

  return createServer(async (req, res) => {
    try {
      await manager.initialize()
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      const path = url.pathname.replace(/\/+$/, '') || '/'

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'authorization,content-type,idempotency-key',
        })
        res.end()
        return
      }

      if (req.method === 'POST' && (
        path === '/v1/images/generations' ||
        path === '/v1/images/edits'
      )) {
        const imageRequest = await parseImageRequest(req, manager.maxRequestBytes)
        if (!imageRequest.prompt) {
          errorResponse(res, 400, 'invalid_request_error', 'prompt is required')
          return
        }
        const task = manager.submit(
          imageRequest,
          getHeader(req, 'authorization') || '',
          getHeader(req, 'idempotency-key') || '',
        )
        jsonResponse(res, 202, {
          ...await publicTask(task, manager, req),
          poll_url: `/v1/images/tasks/${task.task_id}`,
        }, {
          Location: `/v1/images/tasks/${task.task_id}`,
          'Retry-After': String(retryAfterSeconds(task, manager)),
        })
        return
      }

      const taskMatch = /^\/v1\/images\/tasks\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && taskMatch) {
        const task = manager.get(decodeURIComponent(taskMatch[1]))
        if (!task) {
          errorResponse(res, 404, 'not_found_error', 'task not found')
          return
        }
        const headers = task.status === 'queued' || task.status === 'processing'
          ? { 'Retry-After': String(retryAfterSeconds(task, manager)) }
          : {}
        jsonResponse(res, 200, await publicTask(task, manager, req), headers)
        return
      }

      const imageMatch = /^\/v1\/images\/files\/([^/]+)$/.exec(path)
      if (req.method === 'GET' && imageMatch) {
        const image = await manager.store.readImage(decodeURIComponent(imageMatch[1]))
        if (!image) {
          errorResponse(res, 404, 'not_found_error', 'image not found')
          return
        }
        res.writeHead(200, {
          'Content-Type': image.contentType,
          'Content-Length': image.data.length,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
        })
        res.end(image.data)
        return
      }

      if (req.method === 'GET' && path === '/healthz') {
        jsonResponse(res, 200, {
          status: 'ok',
          service: 'async-image-api',
          storage: 'ready',
          active_workers: manager.activeCount,
          worker_concurrency: manager.workerConcurrency,
          queue_depth: manager.queueLength,
          queue_max: manager.queueMax,
          queued_input_bytes: manager.queueInputBytes,
          queue_input_bytes_max: manager.queueInputBytesMax,
          max_request_bytes: manager.maxRequestBytes,
          task_ttl_seconds: manager.taskTtlSeconds,
          task_timeout_seconds: manager.taskTimeoutSeconds,
          upstream_configured: Boolean(process.env.UPSTREAM_RESPONSES_BASE_URL || process.env.API_PROXY_URL),
          endpoints: {
            generations: 'POST /v1/images/generations',
            edits: 'POST /v1/images/edits',
            tasks: 'GET /v1/images/tasks/{task_id}',
            files: 'GET /v1/images/files/{file}',
          },
        })
        return
      }

      errorResponse(res, 404, 'not_found_error', 'not found')
    } catch (error) {
      log('error', 'request_failed', {
        method: req.method,
        url: req.url,
        message: error instanceof Error ? error.message : String(error),
      })
      if (error instanceof RequestBodyTooLargeError) {
        errorResponse(res, 413, 'request_too_large', error.message)
      } else if (error instanceof QueueCapacityError) {
        errorResponse(res, 429, error.code, error.message, { 'Retry-After': '30' })
      } else {
        errorResponse(res, 500, 'api_error', error instanceof Error ? error.message : String(error))
      }
    }
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.ASYNC_IMAGE_API_PORT || process.env.PORT || DEFAULT_PORT)
  const server = createAsyncImageApiServer()
  server.listen(port, () => {
    log('info', 'server_started', {
      port,
      upstream_configured: Boolean(process.env.UPSTREAM_RESPONSES_BASE_URL || process.env.API_PROXY_URL),
      upstream_model: process.env.UPSTREAM_RESPONSES_MODEL || undefined,
      worker_concurrency: process.env.ASYNC_IMAGE_WORKER_CONCURRENCY || DEFAULT_WORKER_CONCURRENCY,
      queue_max: process.env.ASYNC_IMAGE_QUEUE_MAX || DEFAULT_QUEUE_MAX,
      queue_input_bytes_max: process.env.ASYNC_IMAGE_QUEUE_MAX_INPUT_BYTES || DEFAULT_QUEUE_INPUT_BYTES,
      max_request_bytes: process.env.ASYNC_IMAGE_MAX_REQUEST_BYTES || DEFAULT_REQUEST_BODY_BYTES,
      task_ttl_seconds: process.env.ASYNC_IMAGE_TASK_TTL_SECONDS || DEFAULT_TASK_TTL_SECONDS,
      storage_dir: process.env.ASYNC_IMAGE_STORAGE_DIR || join(process.cwd(), 'data', 'async-image'),
    })
  })
}
