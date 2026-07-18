# ---- Build stage ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app

ENV VITE_DEFAULT_API_URL=__VITE_DEFAULT_API_URL_PLACEHOLDER__
ENV VITE_API_PROXY_AVAILABLE=__VITE_API_PROXY_AVAILABLE_PLACEHOLDER__
ENV VITE_API_PROXY_LOCKED=__VITE_API_PROXY_LOCKED_PLACEHOLDER__
ENV VITE_ASYNC_IMAGE_API_ENABLED=__VITE_ASYNC_IMAGE_API_ENABLED_PLACEHOLDER__
ENV VITE_DOCKER_DEPLOYMENT=__VITE_DOCKER_DEPLOYMENT_PLACEHOLDER__
ENV VITE_DOCKER_LEGACY_API_URL_USED=__VITE_DOCKER_LEGACY_API_URL_USED_PLACEHOLDER__
ENV VITE_SHOW_DEFAULT_CONFIG_ONLY=__VITE_SHOW_DEFAULT_CONFIG_ONLY_PLACEHOLDER__

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production stage ----
FROM nginx:alpine

RUN apk add --no-cache nodejs supervisor

ENV HOST=0.0.0.0
ENV PORT=80
ENV DEFAULT_API_URL=
ENV API_PROXY_URL=
ENV ENABLE_API_PROXY=false
ENV LOCK_API_PROXY=false
ENV ENABLE_ASYNC_IMAGE_API=false
ENV ASYNC_IMAGE_API_PORT=8787
ENV ASYNC_IMAGE_WORKER_CONCURRENCY=10
ENV ASYNC_IMAGE_QUEUE_MAX=100
ENV ASYNC_IMAGE_QUEUE_MAX_INPUT_BYTES=67108864
ENV ASYNC_IMAGE_MAX_REQUEST_BYTES=26214400
ENV ASYNC_IMAGE_NGINX_MAX_BODY_SIZE=25m
ENV ASYNC_IMAGE_STORAGE_DIR=/app/data/async-image
ENV ASYNC_IMAGE_TASK_TTL_SECONDS=86400
ENV ASYNC_IMAGE_TASK_CLEANUP_INTERVAL_SECONDS=300
ENV ASYNC_IMAGE_TASK_TIMEOUT_SECONDS=1800
ENV ASYNC_IMAGE_PUBLIC_BASE_URL=
ENV UPSTREAM_RESPONSES_BASE_URL=
ENV UPSTREAM_RESPONSES_MODEL=
ENV SHOW_DEFAULT_CONFIG_ONLY=false

COPY --from=build /app/dist /usr/share/nginx/html
COPY server /app/server
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 deploy/migrate-api-env.envsh /docker-entrypoint.d/05-migrate-api-env.envsh
COPY --chmod=755 deploy/inject-api-url.sh /docker-entrypoint.d/40-inject-api-url.sh
COPY --chmod=755 deploy/start-async-image-api.sh /app/start-async-image-api.sh
COPY --chmod=755 deploy/healthcheck.sh /app/healthcheck.sh
COPY --chmod=755 deploy/entrypoint.sh /app/entrypoint.sh
COPY deploy/supervisord.conf /etc/supervisord.conf
RUN sed -i 's/\r$//' /docker-entrypoint.d/05-migrate-api-env.envsh /docker-entrypoint.d/40-inject-api-url.sh /app/start-async-image-api.sh /app/healthcheck.sh /app/entrypoint.sh

VOLUME ["/app/data"]

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["/app/healthcheck.sh"]

ENTRYPOINT ["/app/entrypoint.sh"]

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
