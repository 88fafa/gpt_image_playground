import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendImageSizeParamsToPrompt,
  buildResponsesRequest,
  createAsyncImageApiServer,
  createFileTaskStore,
  createTaskManager,
  extractImagesFromResponsesSSE,
  extractImagesFromResponsesSSEStream,
} from './async-image-api.mjs'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function upstreamSse(b64) {
  return [
    'data: {"type":"response.created"}',
    '',
    `data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"${b64}","size":"1024x1024"}]}}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n')
}

function createInMemoryStore() {
  const images = new Map()
  return {
    rootDir: 'memory',
    async initialize() {},
    async saveTask() {},
    async loadTasks() { return [] },
    async saveImages(task, results, startIndex = 0) {
      return results.map((result, index) => {
        const file = `${task.task_id}-${startIndex + index + 1}.png`
        images.set(file, Buffer.from(result.b64_json, 'base64'))
        return { file, output_format: 'png' }
      })
    },
    async readImage(file) {
      const data = images.get(file)
      return data ? { data, contentType: 'image/png' } : null
    },
    async deleteTask() {},
  }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

async function waitForTask(baseUrl, taskId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${baseUrl}/v1/images/tasks/${taskId}`)
    const payload = await response.json()
    if (payload.status === 'completed' || payload.status === 'failed') return payload
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('task did not finish')
}

describe('async image api worker helpers', () => {
  it('builds a streaming Responses image_generation request for edits', () => {
    const body = buildResponsesRequest({
      model: 'gpt-image-2',
      prompt: 'edit this',
      size: '1024x1024',
      quality: 'medium',
      output_format: 'png',
      output_compression: null,
      moderation: 'auto',
      n: 1,
      partial_images: 2,
      allow_prompt_rewrite: false,
      images: ['data:image/png;base64,aW1n'],
      mask: 'data:image/png;base64,bWFzaw==',
    })

    expect(body.stream).toBe(true)
    expect(body.model).toBe('gpt-5.5')
    expect(body.tool_choice).toBe('required')
    expect(body.tools[0]).toMatchObject({
      type: 'image_generation',
      action: 'edit',
      partial_images: 2,
      input_image_mask: { image_url: 'data:image/png;base64,bWFzaw==' },
    })
    expect(body.input[0].content[0].text).toContain('Do not rewrite it')
    expect(body.input[0].content[0].text).toContain('图片参数：比例1:1  1K')
    expect(body.input[0].content[1]).toEqual({
      type: 'input_image',
      image_url: 'data:image/png;base64,aW1n',
    })
  })

  it('preserves the order of multiple edit images in the Responses input', () => {
    const body = buildResponsesRequest({
      model: 'gpt-5.5',
      prompt: 'combine these references',
      size: '1536x1024',
      quality: 'medium',
      output_format: 'png',
      output_compression: null,
      moderation: 'auto',
      n: 1,
      partial_images: 1,
      allow_prompt_rewrite: false,
      images: [
        'data:image/png;base64,Zmlyc3Q=',
        'data:image/png;base64,c2Vjb25k',
      ],
    })

    expect(body.input[0].content.slice(1)).toEqual([
      { type: 'input_image', image_url: 'data:image/png;base64,Zmlyc3Q=' },
      { type: 'input_image', image_url: 'data:image/png;base64,c2Vjb25k' },
    ])
  })

  it('adds the requested image ratio and tier once at the end of an upstream prompt', () => {
    const prompt = appendImageSizeParamsToPrompt('a square product photo\n\n图片参数：比例16:9  1K', '1024x1024')
    expect(prompt).toBe('a square product photo\n\n图片参数：比例1:1  1K')
  })

  it('extracts final images from Responses SSE events', () => {
    const images = extractImagesFromResponsesSSE([
      'data: {"type":"response.image_generation_call.partial_image","partial_image_b64":"cGFydA=="}',
      '',
      'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":{"b64_json":"ZG9uZQ=="}}}',
      '',
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"ZmluYWw="}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'))

    expect(images).toEqual([
      { b64_json: 'ZG9uZQ==', revised_prompt: undefined, size: undefined, quality: undefined, output_format: undefined },
      { b64_json: 'ZmluYWw=', revised_prompt: undefined, size: undefined, quality: undefined, output_format: undefined },
    ])
  })

  it('extracts final images when SSE chunks split at arbitrary boundaries', async () => {
    const text = [
      'data: {"type":"response.image_generation_call.partial_image","partial_image_b64":"cGFydA=="}',
      '',
      'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"ZmluaXNoZWQ="}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const bytes = new TextEncoder().encode(text)
    const stream = new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7))
        controller.close()
      },
    })

    await expect(extractImagesFromResponsesSSEStream(stream)).resolves.toEqual([
      { b64_json: 'ZmluaXNoZWQ=', revised_prompt: undefined, size: undefined, quality: undefined, output_format: undefined },
    ])
  })

  it('defaults to ten upstream workers', () => {
    const manager = createTaskManager({
      upstreamBaseUrl: 'https://upstream.example.com/v1',
      upstreamModel: 'gpt-5.5',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => upstreamSse('ZGVmYXVsdA=='),
      }),
      store: createInMemoryStore(),
    })

    expect(manager.workerConcurrency).toBe(10)
  })

  it('runs upstream image tasks one at a time when configured with one worker', async () => {
    const first = deferred()
    const second = deferred()
    const calls = []
    const fetchImpl = async (_url, init) => {
      const callIndex = calls.length
      calls.push(JSON.parse(init.body))
      const current = callIndex === 0 ? first : second
      await current.promise
      return {
        ok: true,
        status: 200,
        text: async () => upstreamSse(callIndex === 0 ? 'Zmlyc3Q=' : 'c2Vjb25k'),
      }
    }

    const manager = createTaskManager({
      upstreamBaseUrl: 'https://upstream.example.com/v1',
      upstreamModel: 'gpt-5.5',
      workerConcurrency: 1,
      fetchImpl,
      store: createInMemoryStore(),
    })

    const task1 = manager.submit({
      model: 'ignored',
      prompt: 'one',
      size: '1024x1024',
      quality: 'medium',
      output_format: 'png',
      output_compression: null,
      moderation: 'auto',
      n: 1,
      partial_images: 1,
      allow_prompt_rewrite: false,
      images: [],
    }, 'Bearer user-key')
    const task2 = manager.submit({
      model: 'ignored',
      prompt: 'two',
      size: '1024x1024',
      quality: 'medium',
      output_format: 'png',
      output_compression: null,
      moderation: 'auto',
      n: 1,
      partial_images: 1,
      allow_prompt_rewrite: false,
      images: [],
    }, 'Bearer user-key')

    await flush()
    expect(calls).toHaveLength(1)
    expect(manager.get(task1.task_id).status).toBe('processing')
    expect(manager.get(task2.task_id).status).toBe('queued')

    first.resolve()
    await flush()
    expect(calls).toHaveLength(2)
    expect(manager.get(task1.task_id).status).toBe('completed')
    expect(manager.get(task2.task_id).status).toBe('processing')

    second.resolve()
    await flush()
    expect(manager.get(task2.task_id).status).toBe('completed')
  })

  it('can run two upstream image tasks concurrently when configured', async () => {
    const first = deferred()
    const second = deferred()
    const third = deferred()
    const gates = [first, second, third]
    const calls = []
    let active = 0
    let maxActive = 0
    const fetchImpl = async (_url, init) => {
      const callIndex = calls.length
      calls.push(JSON.parse(init.body))
      active += 1
      maxActive = Math.max(maxActive, active)
      await gates[callIndex].promise
      active -= 1
      return {
        ok: true,
        status: 200,
        text: async () => upstreamSse(`aW1n${callIndex}`),
      }
    }

    const manager = createTaskManager({
      upstreamBaseUrl: 'https://upstream.example.com/v1',
      upstreamModel: 'gpt-5.5',
      workerConcurrency: 2,
      fetchImpl,
      store: createInMemoryStore(),
    })

    const baseRequest = {
      model: 'ignored',
      prompt: 'prompt',
      size: '1024x1024',
      quality: 'medium',
      output_format: 'png',
      output_compression: null,
      moderation: 'auto',
      n: 1,
      partial_images: 1,
      allow_prompt_rewrite: false,
      images: [],
    }

    const task1 = manager.submit({ ...baseRequest, prompt: 'one' }, 'Bearer user-key')
    const task2 = manager.submit({ ...baseRequest, prompt: 'two' }, 'Bearer user-key')
    const task3 = manager.submit({ ...baseRequest, prompt: 'three' }, 'Bearer user-key')

    await flush()
    expect(calls).toHaveLength(2)
    expect(maxActive).toBe(2)
    expect(manager.get(task1.task_id).status).toBe('processing')
    expect(manager.get(task2.task_id).status).toBe('processing')
    expect(manager.get(task3.task_id).status).toBe('queued')

    first.resolve()
    await flush()
    expect(manager.get(task1.task_id).status).toBe('completed')
    expect(calls).toHaveLength(3)
    expect(manager.get(task3.task_id).status).toBe('processing')

    second.resolve()
    third.resolve()
    await flush()
    await flush()
    expect(manager.get(task2.task_id).status).toBe('completed')
    expect(manager.get(task3.task_id).status).toBe('completed')
  })

  it('enforces bounded waiting tasks and queued input bytes', async () => {
    const blocker = deferred()
    const fetchImpl = async () => {
      await blocker.promise
      return { ok: true, status: 200, text: async () => upstreamSse('aW1n') }
    }
    const manager = createTaskManager({
      upstreamBaseUrl: 'https://upstream.example.com/v1',
      upstreamModel: 'gpt-5.5',
      workerConcurrency: 1,
      queueMax: 1,
      queueInputBytesMax: 256,
      fetchImpl,
      store: createInMemoryStore(),
    })
    const request = {
      model: 'ignored', prompt: 'small', size: '1024x1024', quality: 'medium', output_format: 'png',
      output_compression: null, moderation: 'auto', n: 1, partial_images: 1, allow_prompt_rewrite: false, images: [],
    }

    manager.submit(request)
    await flush()
    expect(() => manager.submit({ ...request, prompt: 'x'.repeat(2048) })).toThrow(/Queued image input exceeds/)
    const waiting = manager.submit({ ...request, prompt: 'second' })
    expect(manager.queueLength).toBe(1)
    expect(manager.queueInputBytes).toBeGreaterThan(0)
    expect(() => manager.submit({ ...request, prompt: 'third' })).toThrow(/queue is full/)

    blocker.resolve()
    await flush()
    await flush()
    expect(manager.get(waiting.task_id).status).toBe('completed')
    expect(manager.queueInputBytes).toBe(0)
  })

  it('returns adaptive Retry-After values for processing and queued tasks', async () => {
    const blocker = deferred()
    const manager = createTaskManager({
      upstreamBaseUrl: 'https://upstream.example.com/v1',
      upstreamModel: 'gpt-5.5',
      workerConcurrency: 1,
      fetchImpl: async () => {
        await blocker.promise
        return { ok: true, status: 200, text: async () => upstreamSse('aW1n') }
      },
      store: createInMemoryStore(),
    })
    const server = createAsyncImageApiServer({ manager })
    const port = await listen(server)
    const baseUrl = `http://127.0.0.1:${port}`
    const body = JSON.stringify({ model: 'gpt-5.5', prompt: 'test' })

    try {
      const first = await fetch(`${baseUrl}/v1/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      expect(first.headers.get('Retry-After')).toBe('25')
      const firstTask = await first.json()
      const second = await fetch(`${baseUrl}/v1/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      expect(second.headers.get('Retry-After')).toBe('30')
      const queued = await second.json()
      const poll = await fetch(`${baseUrl}/v1/images/tasks/${queued.task_id}`)
      expect(poll.headers.get('Retry-After')).toBe('30')
      expect((await poll.json()).retry_after_seconds).toBe(30)

      const active = manager.get(firstTask.task_id)
      active.started_at = Math.floor(Date.now() / 1000) - 50
      const completionWindow = await fetch(`${baseUrl}/v1/images/tasks/${firstTask.task_id}`)
      expect(completionWindow.headers.get('Retry-After')).toBe('15')
      active.started_at = Math.floor(Date.now() / 1000) - 65
      const fastPoll = await fetch(`${baseUrl}/v1/images/tasks/${firstTask.task_id}`)
      expect(fastPoll.headers.get('Retry-After')).toBe('5')
      active.started_at = Math.floor(Date.now() / 1000) - 120
      const slowPoll = await fetch(`${baseUrl}/v1/images/tasks/${firstTask.task_id}`)
      expect(slowPoll.headers.get('Retry-After')).toBe('10')
    } finally {
      blocker.resolve()
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('persists completed images and serves standard URL or b64_json task results', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'async-image-api-'))
    const store = createFileTaskStore({ storageDir })
    const manager = createTaskManager({
      upstreamBaseUrl: 'https://upstream.example.com/v1',
      upstreamModel: 'gpt-5.5',
      store,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => upstreamSse('aW1hZ2U='),
      }),
    })
    const server = createAsyncImageApiServer({ manager })
    const port = await listen(server)
    const baseUrl = `http://127.0.0.1:${port}`

    try {
      const health = await fetch(`${baseUrl}/healthz`).then((response) => response.json())
      expect(health).toMatchObject({ status: 'ok', worker_concurrency: 10, queue_max: 100, task_ttl_seconds: 86400 })

      const submit = await fetch(`${baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'same-request' },
        body: JSON.stringify({ model: 'gpt-5.5', prompt: 'test', response_format: 'url' }),
      })
      expect(submit.status).toBe(202)
      expect(submit.headers.get('Access-Control-Allow-Origin')).toBe('*')
      const task = await submit.json()
      const result = await waitForTask(baseUrl, task.task_id)
      expect(result.result.data[0].url).toMatch(/\/v1\/images\/files\/imgtask_.*\.png$/)
      const imageResponse = await fetch(result.result.data[0].url)
      expect(imageResponse.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(await imageResponse.text()).toBe('image')

      const forwardedResultResponse = await fetch(`${baseUrl}/v1/images/tasks/${task.task_id}`, {
        headers: {
          'X-Forwarded-Proto': 'https, http',
          'X-Forwarded-Host': 'image.example.com, internal.example.com',
        },
      })
      expect(forwardedResultResponse.headers.get('Access-Control-Allow-Origin')).toBe('*')
      const forwardedResult = await forwardedResultResponse.json()
      expect(forwardedResult.result.data[0].url).toMatch(/^https:\/\/image\.example\.com\/v1\/images\/files\//)
      const persisted = await readFile(join(storageDir, 'tasks', `${task.task_id}.json`), 'utf8')
      expect(persisted).not.toContain('"prompt"')
      expect(persisted).not.toContain('aW1hZ2U=')

      const duplicate = await fetch(`${baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'same-request' },
        body: JSON.stringify({ model: 'gpt-5.5', prompt: 'different prompt' }),
      }).then((response) => response.json())
      expect(duplicate.task_id).toBe(task.task_id)

      const b64Submit = await fetch(`${baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.5', prompt: 'test b64', response_format: 'b64_json' }),
      }).then((response) => response.json())
      const b64Result = await waitForTask(baseUrl, b64Submit.task_id)
      expect(b64Result.result.data[0].b64_json).toBe('aW1hZ2U=')

      const multipleSubmit = await fetch(`${baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.5', prompt: 'two outputs', n: 2, response_format: 'url' }),
      }).then((response) => response.json())
      const multipleResult = await waitForTask(baseUrl, multipleSubmit.task_id)
      expect(multipleResult.result.data.map((item) => item.url)).toEqual([
        expect.stringMatching(/-1\.png$/),
        expect.stringMatching(/-2\.png$/),
      ])

      const completedTask = manager.get(task.task_id)
      completedTask.expires_at = Math.floor(Date.now() / 1000) - 1
      expect(await manager.cleanup()).toBe(1)
      expect(await fetch(`${baseUrl}/v1/images/tasks/${task.task_id}`).then((response) => response.status)).toBe(404)
    } finally {
      await new Promise((resolve) => server.close(resolve))
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})
