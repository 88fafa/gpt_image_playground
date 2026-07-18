#!/bin/sh
set -e

# The stock nginx entrypoint only renders templates when nginx is the main
# process. This image uses supervisord so it can also restart the Node worker.
for script in /docker-entrypoint.d/*; do
    case "$script" in
        *.envsh) . "$script" ;;
        *.sh) "$script" ;;
    esac
done

exec "$@"
