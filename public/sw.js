const CACHE_NAME = 'gpt-image-playground-v0.1.6'
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './pwa-icon.svg']
const APP_SHELL_PATHS = new Set(['/', '/index.html', '/manifest.webmanifest', '/pwa-icon.svg', '/favicon.ico'])

function isDynamicRequest(request, url) {
  const accept = request.headers.get('Accept') || ''
  return request.headers.has('Authorization') ||
    accept.includes('text/event-stream') ||
    url.pathname === '/healthz' ||
    url.pathname.startsWith('/v1/') ||
    url.pathname.startsWith('/api-proxy/')
}

function isCacheableStaticAsset(url) {
  return APP_SHELL_PATHS.has(url.pathname) || url.pathname.startsWith('/assets/')
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Image tasks, upstream proxy calls, and authenticated requests must always
  // reach the network. A stale task status would otherwise make polling loop.
  if (isDynamicRequest(request, url)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy))
          return response
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  if (!isCacheableStaticAsset(url)) return

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
