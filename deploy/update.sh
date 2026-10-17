#!/bin/sh
# Pull-based deploy: brings the server in line with the main branch.
# Run by sisyphus-update.timer every 5 minutes; safe to run by hand any time.
# Nothing restarts unless the code or the image actually changed.
#
# When the image changed, the database is backed up BEFORE the app restarts
# (a new version may migrate it). If that backup fails, nothing is restarted
# and the script exits non-zero; the next run tries again.
set -eu
cd "$(dirname "$0")"

if [ -z "${SISYPHUS_UPDATE_REEXEC:-}" ]; then
  # One deploy or restore at a time.
  exec 9>/run/lock/sisyphus-deploy.lock
  flock -n 9 || { echo "Another update or restore is running; skipping."; exit 0; }

  # Deployment config (this folder, this script included) follows main too.
  git -C .. pull --ff-only --quiet
  # The shell has already read this file, so a pulled change to it would
  # otherwise only apply next run. Start over with the fresh copy; the lock
  # on fd 9 is inherited.
  SISYPHUS_UPDATE_REEXEC=1 exec "$0"
fi

# The backup folder must exist and belong to the container's user (node,
# uid 1000) before Docker bind-mounts it, or Docker creates it owned by root.
[ -d backups ] || install -d -o 1000 -g 1000 -m 750 backups

running=$(docker compose ps -q app 2>/dev/null || true)
old_image=""
[ -n "$running" ] && old_image=$(docker inspect --format '{{.Image}}' "$running")

docker compose pull --quiet
new_image=$(docker image inspect --format '{{.Id}}' "$(docker compose config --images app)")

if [ "$old_image" != "$new_image" ]; then
  echo "New image $new_image; backing up before restarting."
  # Runs the backup script from the NEW image (the old one may predate it)
  # against the live database. It never runs migrations, and SQLite's online
  # backup is safe while the old app keeps serving.
  if ! docker compose run --rm --no-deps -T app node scripts/backup.js --tag pre-update --keep 14; then
    echo "Backup FAILED: not restarting. The old version keeps running." >&2
    exit 1
  fi
fi

docker compose up -d --remove-orphans
docker image prune -f >/dev/null
