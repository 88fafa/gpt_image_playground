#!/bin/sh

wget -q -O /dev/null http://127.0.0.1/ || exit 1

if [ "$ENABLE_ASYNC_IMAGE_API" = "true" ]; then
    wget -q -O /dev/null "http://127.0.0.1:${ASYNC_IMAGE_API_PORT:-8787}/healthz" || exit 1
fi
