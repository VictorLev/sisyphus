#!/bin/sh
# Replaces the live database with a backup.
#
#   ./restore.sh backups/sisyphus-nightly-20261018T033000.123Z.db
#
# The current database is backed up first (tag pre-restore), so a restore
# can itself be undone. The app is down for a few seconds.
set -eu
cd "$(dirname "$0")"
SERVICE=sisyphus

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "usage: ./restore.sh backups/<file>.db" >&2
  ls -1t backups/*.db 2>/dev/null | head -20 >&2
  exit 2
fi
name=$(basename "$1")
if [ "$(cd "$(dirname "$1")" && pwd)" != "$(pwd)/backups" ]; then
  echo "The backup must be in $(pwd)/backups (that folder is what the container sees)." >&2
  exit 2
fi

# Hold the deploy lock so the update timer cannot restart the app mid-restore.
# The same lock as update.sh, opened read-only so whoever created the file,
# everyone can take it.
lock=/run/lock/sisyphus-deploy.lock
[ -e "$lock" ] || : > "$lock"
exec 9<"$lock"
flock 9

docker compose stop "$SERVICE"
docker compose run --rm --no-deps -T "$SERVICE" node scripts/backup.js --tag pre-restore --keep 14
# Copy under a temporary name, then swap it in. The old -wal/-shm belong to
# the database being replaced; left behind, SQLite would replay them onto
# the restored file.
docker compose run --rm --no-deps -T --entrypoint sh "$SERVICE" -c "
  set -e
  cp '/backups/$name' /data/sisyphus.db.restoring
  rm -f /data/sisyphus.db-wal /data/sisyphus.db-shm
  mv /data/sisyphus.db.restoring /data/sisyphus.db
"
# up rather than start, so this also works if the container was removed.
docker compose up -d --no-deps "$SERVICE"
echo "Restored $name. The previous database is saved as the newest pre-restore backup."
