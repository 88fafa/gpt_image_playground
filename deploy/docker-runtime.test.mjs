import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

function readDeployFile(name) {
  return readFile(new URL(`./${name}`, import.meta.url), 'utf8')
}

describe('Docker async-image runtime configuration', () => {
  it('keeps the normal API proxy upstream while assigning a separate async upstream', async () => {
    const source = await readDeployFile('migrate-api-env.envsh')

    expect(source).toContain('UPSTREAM_RESPONSES_BASE_URL=${UPSTREAM_RESPONSES_BASE_URL:-$API_PROXY_URL}')
    expect(source).not.toMatch(/API_PROXY_URL="http:\/\/127\.0\.0\.1:\$\{ASYNC_IMAGE_API_PORT\}/)
  })

  it('limits only async image uploads at the nginx boundary', async () => {
    const source = await readDeployFile('nginx.conf')

    expect(source).toContain('location /api-proxy/')
    expect(source).toContain('location /v1/images/')
    expect(source).toContain('client_max_body_size ${ASYNC_IMAGE_NGINX_MAX_BODY_SIZE};')
    expect(source).toContain('map $http_x_forwarded_proto $async_image_forwarded_proto')
    expect(source).toContain('proxy_set_header X-Forwarded-Proto $async_image_forwarded_proto;')
  })

  it('uses a supervised worker and excludes local build artifacts', async () => {
    const [dockerfile, supervisor, ignored] = await Promise.all([
      readDeployFile('Dockerfile'),
      readDeployFile('supervisord.conf'),
      readFile(new URL('../.dockerignore', import.meta.url), 'utf8'),
    ])

    expect(dockerfile).toContain('supervisor')
    expect(dockerfile).toContain('HEALTHCHECK')
    expect(supervisor).toContain('[program:async-image-api]')
    expect(ignored).toContain('data/')
    expect(ignored).toContain('logs/')
    expect(ignored).toContain('dev-proxy.config.json')
  })
})
