import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAsyncImageApiServer } from '../server/async-image-api.mjs'

function listen(server, port = 0) {
  server.listen(port, '127.0.0.1')
  return once(server, 'listening').then(() => server.address().port)
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve())
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function json(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  })
  res.end(JSON.stringify(payload))
}

async function main() {
  const workerConcurrency = Number(process.env.ASYNC_IMAGE_WORKER_CONCURRENCY || 5)
  const storageDir = await mkdtemp(join(tmpdir(), 'async-image-smoke-'))
  let activeUpstream = 0
  let maxActiveUpstream = 0
  const upstreamStarts = []
  const upstreamEnds = []

  const upstream = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/responses') {
      json(res, 404, { error: { message: 'not found' } })
      return
    }

    activeUpstream += 1
    maxActiveUpstream = Math.max(maxActiveUpstream, activeUpstream)
    const requestIndex = upstreamStarts.length
    upstreamStarts.push({ requestIndex, at: Date.now() })

    await sleep(350)

    upstreamEnds.push({ requestIndex, at: Date.now() })
    activeUpstream -= 1

    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end([
      'data: {"type":"response.created"}',
      '',
      `data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"aW1n${requestIndex}="}]}}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n'))
  })

  const upstreamPort = await listen(upstream)
  const asyncApi = createAsyncImageApiServer({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    upstreamModel: 'gpt-5.5',
    workerConcurrency,
    storageDir,
  })
  const asyncPort = await listen(asyncApi)

  try {
    const submit = (index) => fetch(`http://127.0.0.1:${asyncPort}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `smoke-${Date.now()}-${index}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.5',
        prompt: `smoke prompt ${index}`,
        size: '1024x1024',
        quality: 'medium',
        output_format: 'png',
        n: 1,
        partial_images: 1,
      }),
    }).then((res) => res.json())

    const submitted = await Promise.all([submit(0), submit(1), submit(2)])

    const finalTasks = []
    for (const task of submitted) {
      let current = task
      const pollUrl = task.poll_url
      for (let i = 0; i < 20; i++) {
        if (current.status === 'completed' || current.status === 'failed') break
        await sleep(150)
        current = await fetch(`http://127.0.0.1:${asyncPort}${pollUrl}`).then((res) => res.json())
      }
      finalTasks.push(current)
    }

    const completed = finalTasks.filter((task) => task.status === 'completed').length
    const failed = finalTasks.filter((task) => task.status === 'failed').length
    const durations = upstreamStarts.map((start) => {
      const end = upstreamEnds.find((item) => item.requestIndex === start.requestIndex)
      return {
        requestIndex: start.requestIndex,
        durationMs: end ? end.at - start.at : null,
      }
    })

    console.log(JSON.stringify({
      submitted: submitted.map((task) => ({
        task_id: task.task_id,
        status: task.status,
        queue_position: task.queue_position,
      })),
      completed,
      failed,
      upstreamRequestCount: upstreamStarts.length,
      workerConcurrency,
      maxActiveUpstream,
      durations,
      ok: completed === 3 && failed === 0 && upstreamStarts.length === 3 && maxActiveUpstream === Math.min(workerConcurrency, 3),
    }, null, 2))
  } finally {
    await close(asyncApi)
    await close(upstream)
    await rm(storageDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
