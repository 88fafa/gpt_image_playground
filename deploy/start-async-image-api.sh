#!/bin/sh

if [ "$ENABLE_ASYNC_IMAGE_API" = "true" ]; then
    exec node /app/server/async-image-api.mjs
fi

# Keep the supervised process alive when the optional async API is disabled.
exec tail -f /dev/null
