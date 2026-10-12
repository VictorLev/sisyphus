#!/bin/sh
# Pull-based deploy: brings the server in line with the main branch.
# Run by sisyphus-update.timer every 5 minutes; safe to run by hand any time.
# Nothing restarts unless the code or the image actually changed.
set -eu
cd "$(dirname "$0")"

# Deployment config (this folder) follows main as well.
git -C .. pull --ff-only --quiet

docker compose pull --quiet
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
