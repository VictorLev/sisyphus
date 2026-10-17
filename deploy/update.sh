#!/bin/sh
# Pull-based deploy for one Sisyphus instance (prod or staging): brings the
# running app in line with the image tag its .env selects (prod: stable,
# staging: latest). Lives beside docker-compose.yml in the instance's folder
# and runs from sisyphus-update@<folder>.service: nightly for prod, every 5
# minutes for staging. Safe to run by hand any time.
#
# When the image changed:
#   1. the database is backed up first (a new version may migrate it); if
#      that fails, nothing is restarted and the script exits non-zero;
#   2. after the restart the app must answer /api/health within ~90s; if it
#      doesn't, the previous image is put back, the bad one is remembered so
#      the next run doesn't deploy it again, and the script exits non-zero.
#      The database is left as is: migrations only add, so the previous
#      version still runs on it.
set -eu
cd "$(dirname "$0")"
SERVICE=sisyphus
INSTANCE=$(basename "$(pwd)")
BAD_IMAGE_FILE=.bad-image

# One deploy or restore per instance at a time. Opened read-only: flock
# works on any open file, so whoever created the lock file, everyone can
# take it.
lock=/run/lock/sisyphus-deploy-$INSTANCE.lock
[ -e "$lock" ] || : > "$lock"
exec 9<"$lock"
flock -n 9 || { echo "Another update or restore of $INSTANCE is running; skipping."; exit 0; }

# Docker would create a missing bind-mount folder owned by root, and the
# container (uid 1000) could not write to it. Say so instead.
if [ ! -d backups ]; then
  echo "Missing $(pwd)/backups. Create it as victor: mkdir backups" >&2
  exit 1
fi

# The same probe as the image's HEALTHCHECK, run inside the container.
wait_healthy() {
  for _ in $(seq 1 30); do
    if docker compose exec -T "$SERVICE" node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

running=$(docker compose ps -q "$SERVICE" 2>/dev/null || true)
old_image=""
[ -n "$running" ] && old_image=$(docker inspect --format '{{.Image}}' "$running")

docker compose pull --quiet
ref=$(docker compose config --images "$SERVICE")
new_image=$(docker image inspect --format '{{.Id}}' "$ref")

if [ -f "$BAD_IMAGE_FILE" ] && [ "$(cat "$BAD_IMAGE_FILE")" = "$new_image" ]; then
  # Already tried and rolled back. Point the tag back at what is running so
  # `up` below cannot pick the bad image up, and wait for a newer build.
  echo "$ref is $new_image, which failed its health check before; staying on $old_image." >&2
  echo "Delete $(pwd)/$BAD_IMAGE_FILE to try it again." >&2
  [ -n "$old_image" ] && docker tag "$old_image" "$ref"
  docker compose up -d --remove-orphans
  exit 0
fi

if [ "$old_image" != "$new_image" ]; then
  echo "New image $new_image; backing up before restarting."
  # Runs the backup script from the NEW image (the old one may predate it)
  # against the live database. It never runs migrations, and SQLite's online
  # backup is safe while the old app keeps serving.
  if ! docker compose run --rm --no-deps -T "$SERVICE" node scripts/backup.js --tag pre-update --keep 14; then
    echo "Backup FAILED: not restarting. The old version keeps running." >&2
    exit 1
  fi
fi

docker compose up -d --remove-orphans

if [ "$old_image" != "$new_image" ]; then
  if wait_healthy; then
    echo "Deployed $new_image; healthy."
    rm -f "$BAD_IMAGE_FILE"
  else
    echo "New image $new_image is NOT healthy. Last logs:" >&2
    docker compose logs --tail 40 "$SERVICE" >&2 || true
    echo "$new_image" > "$BAD_IMAGE_FILE"
    if [ -n "$old_image" ]; then
      echo "Rolling back to $old_image." >&2
      docker tag "$old_image" "$ref"
      docker compose up -d --no-deps "$SERVICE"
      if wait_healthy; then
        echo "Rolled back; the previous version is serving again." >&2
      else
        echo "The previous version is not healthy either. Look at: docker compose logs $SERVICE" >&2
      fi
    fi
    exit 1
  fi
fi

docker image prune -f >/dev/null
