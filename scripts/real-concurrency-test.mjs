import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createAsyncImageApiServer } from '../server/async-image-api.mjs'

const DEFAULT_KEY_FILE = 'D:\\TT\\codex\\NMW2\\key.txt'
const DEFAULT_OUTPUT_DIR = 'D:\\TT\\codex\\NMW2\\gpt_image_playground\\logs\\real-concurrency-images'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function listen(server, port = 0) {
  server.listen(port, '127.0.0.1')
  return once(server, 'listening').then(() => server.address().port)
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve())
  })
}

async function readApiKey() {
  if (process.env.UPSTREAM_API_KEY && process.env.UPSTREAM_API_KEY.trim()) {
    return process.env.UPSTREAM_API_KEY.trim()
  }
  const keyFile = process.env.UPSTREAM_API_KEY_FILE || DEFAULT_KEY_FILE
  return (await readFile(keyFile, 'utf8')).trim()
}

function publicSummary(task) {
  const images = task?.result?.data
  return {
    task_id: task?.task_id,
    status: task?.status,
    queue_position: task?.queue_position,
    image_count: Array.isArray(images) ? images.length : 0,
    error: task?.error?.message,
  }
}

const complexPrompts = [
  'A detailed cozy cyberpunk street market at night, rain reflections on pavement, warm food stalls, tiny service robots, neon signs, people with umbrellas, rich depth, cinematic lighting, clean composition.',
  'A complex fantasy forest library built inside giant ancient trees, glowing bookshelves, spiral staircases, small lantern fairies, mossy bridges, magical dust in the air, high detail, soft natural light.',
  'A futuristic space greenhouse on Mars, transparent dome, rows of plants, astronauts tending vegetables, red desert outside, solar panels, small rover, realistic lighting, many fine environmental details.',
  'A cheerful miniature steampunk harbor city on a tabletop, brass airships, tiny boats, clockwork cranes, winding streets, warm morning sunlight, intricate gears and pipes, whimsical but detailed.',
  'A peaceful underwater research station with glass tunnels, colorful coral reef, sea turtles, divers, glowing equipment, schools of fish, layered depth, cinematic blue lighting, highly detailed scene.',
]

function imageExtension(image) {
  const format = String(image?.output_format || '').toLowerCase()
  if (format === 'jpg' || format === 'jpeg') return 'jpg'
  if (format === 'webp') return 'webp'
  return 'png'
}

async function saveImages(tasks) {
  const outputDir = process.env.REAL_TEST_OUTPUT_DIR || DEFAULT_OUTPUT_DIR
  await mkdir(outputDir, { recursive: true })
  const saved = []
  for (const task of tasks) {
    const images = Array.isArray(task?.result?.data) ? task.result.data : []
    for (let i = 0; i < images.length; i++) {
      const image = images[i]
      if (!image?.b64_json && !image?.url) continue
      const ext = imageExtension(image)
      const filename = `${task.task_id}-${i + 1}.${ext}`
      const filePath = join(outputDir, filename)
      const bytes = image.b64_json
        ? Buffer.from(image.b64_json, 'base64')
        : Buffer.from(await (await fetch(image.url)).arrayBuffer())
      await writeFile(filePath, bytes)
      saved.push({
        task_id: task.task_id,
        path: filePath,
        size: image.size,
        output_format: image.output_format || ext,
      })
    }
  }
  return saved
}

async function submit(baseUrl, index) {
  const prompt = process.env.REAL_TEST_PROMPT ||
    complexPrompts[index % complexPrompts.length]
  const startedAt = Date.now()
  const res = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `real-concurrency-${Date.now()}-${index}`,
    },
    body: JSON.stringify({
      model: process.env.UPSTREAM_RESPONSES_MODEL || 'gpt-5.5',
      prompt,
      size: process.env.REAL_TEST_IMAGE_SIZE || '1024x1024',
      quality: process.env.REAL_TEST_IMAGE_QUALITY || 'medium',
      output_format: 'png',
      n: 1,
      partial_images: 1,
    }),
  })
  const task = await res.json()
  return { ...task, submitted_elapsed_ms: Date.now() - startedAt }
}

async function poll(baseUrl, task) {
  let current = task
  const startedAt = Date.now()
  const pollUrl = current.poll_url || `/v1/images/tasks/${current.task_id}`
  const timeoutMs = Number(process.env.REAL_TEST_TIMEOUT_MS || 15 * 60 * 1000)
  while (Date.now() - startedAt < timeoutMs) {
    if (current.status === 'completed' || current.status === 'failed') {
      return { ...current, total_elapsed_ms: Date.now() - startedAt }
    }
    const fallbackPollMs = Number(process.env.REAL_TEST_POLL_INTERVAL_MS || 3000)
    await sleep(current.retry_after_seconds ? Number(current.retry_after_seconds) * 1000 : fallbackPollMs)
    const res = await fetch(`${baseUrl}${pollUrl}`)
    current = await res.json()
  }
  return {
    ...current,
    status: 'timeout',
    error: { message: `not finished after ${timeoutMs}ms` },
    total_elapsed_ms: Date.now() - startedAt,
  }
}

async function main() {
  const apiKey = await readApiKey()
  if (!apiKey) throw new Error('API key is empty')

  const workerConcurrency = Number(process.env.ASYNC_IMAGE_WORKER_CONCURRENCY || 10)
  const taskCount = Math.max(1, Math.floor(Number(process.env.REAL_TEST_COUNT || workerConcurrency)))
  const server = createAsyncImageApiServer({
    upstreamBaseUrl: process.env.UPSTREAM_RESPONSES_BASE_URL || 'https://bridgelink.cc/v1',
    upstreamApiKey: apiKey,
    upstreamModel: process.env.UPSTREAM_RESPONSES_MODEL || 'gpt-5.5',
    workerConcurrency,
  })
  const port = await listen(server)
  const baseUrl = `http://127.0.0.1:${port}`
  const startedAt = Date.now()
  const initialRssBytes = process.memoryUsage().rss
  let peakRssBytes = initialRssBytes
  const memorySampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
  }, 250)
  memorySampler.unref?.()

  try {
    const submitted = await Promise.all(Array.from({ length: taskCount }, (_, index) => submit(baseUrl, index)))
    console.log(JSON.stringify({
      event: 'submitted',
      workerConcurrency,
      taskCount,
      tasks: submitted.map(publicSummary),
    }, null, 2))

    const finalTasks = await Promise.all(submitted.map((task) => poll(baseUrl, task)))
    const savedImages = await saveImages(finalTasks)
    const completed = finalTasks.filter((task) => task.status === 'completed').length
    const failed = finalTasks.filter((task) => task.status === 'failed').length
    const timedOut = finalTasks.filter((task) => task.status === 'timeout').length
    console.log(JSON.stringify({
      event: 'finished',
      workerConcurrency,
      taskCount,
      elapsed_ms: Date.now() - startedAt,
      rss_bytes_initial: initialRssBytes,
      rss_bytes_peak: peakRssBytes,
      rss_bytes_final: process.memoryUsage().rss,
      completed,
      failed,
      timedOut,
      tasks: finalTasks.map(publicSummary),
      saved_images: savedImages,
      ok: completed === taskCount && failed === 0 && timedOut === 0,
    }, null, 2))
    if (completed !== taskCount || failed !== 0 || timedOut !== 0) process.exitCode = 1
  } finally {
    clearInterval(memorySampler)
    await close(server)
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    event: 'real_concurrency_test_failed',
    message: err instanceof Error ? err.message : String(err),
  }))
  process.exitCode = 1
})
