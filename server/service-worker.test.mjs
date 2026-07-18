import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const workerPath = fileURLToPath(new URL('../public/sw.js', import.meta.url))

async function loadWorker() {
  const source = await readFile(workerPath, 'utf8')
  const handlers = new Map()
  const context = {
    URL,
    Promise,
    self: {
      location: { origin: 'https://playground.example' },
      clients: { claim: vi.fn() },
      skipWaiting: vi.fn(),
      addEventListener(type, handler) {
        handlers.set(type, handler)
      },
    },
    caches: {
      keys: vi.fn().mockResolvedValue([]),
      match: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue({ addAll: vi.fn(), put: vi.fn() }),
    },
    fetch: vi.fn().mockResolvedValue(new Response('asset', { status: 200 })),
  }
  vm.runInNewContext(source, context, { filename: workerPath })
  return { context, fetchHandler: handlers.get('fetch') }
}

function dispatchFetch(fetchHandler, request) {
  const event = { request, respondWith: vi.fn(), waitUntil: vi.fn() }
  fetchHandler(event)
  return event
}

describe('service worker cache boundaries', () => {
  it.each([
    '/v1/images/tasks/imgtask_1',
    '/api-proxy/responses',
    '/healthz',
  ])('does not intercept dynamic API GET %s', async (path) => {
    const { fetchHandler } = await loadWorker()
    const event = dispatchFetch(fetchHandler, new Request(`https://playground.example${path}`))
    expect(event.respondWith).not.toHaveBeenCalled()
  })

  it('does not intercept authenticated or SSE GET requests', async () => {
    const { fetchHandler } = await loadWorker()
    const authenticated = dispatchFetch(fetchHandler, new Request('https://playground.example/models', {
      headers: { Authorization: 'Bearer test' },
    }))
    const stream = dispatchFetch(fetchHandler, new Request('https://playground.example/events', {
      headers: { Accept: 'text/event-stream' },
    }))
    expect(authenticated.respondWith).not.toHaveBeenCalled()
    expect(stream.respondWith).not.toHaveBeenCalled()
  })

  it('continues caching compiled static assets', async () => {
    const { fetchHandler } = await loadWorker()
    const event = dispatchFetch(fetchHandler, new Request('https://playground.example/assets/index.js'))
    expect(event.respondWith).toHaveBeenCalledOnce()
  })
})
