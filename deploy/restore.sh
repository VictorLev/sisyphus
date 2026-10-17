#!/bin/sh
# Replaces the live database with a backup.
#
#   sudo ./restore.sh backups/sisyphus-nightly-20261018T033000.123Z.db
#
# The current database is backed up first (tag pre-restore), so a restore
# can itself be undone. The app is down for a few seconds.
set -eu
cd "$(dirname "$0")"

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "usage: sudo ./restore.sh backups/<file>.db" >&2
  ls -1t backups/*.db 2>/dev/null | head -20 >&2
  exit 2
fi
name=$(basename "$1")
if [ "$(cd "$(dirname "$1")" && pwd)" != "$(pwd)/backups" ]; then
  echo "The backup must be in $(pwd)/backups (that folder is what the container sees)." >&2
  exit 2
fi

# Hold the deploy lock so the update timer cannot restart the app mid-restore.
exec 9>/run/lock/sisyphus-deploy.lock
flock 9

docker compose stop app
docker compose run --rm --no-deps -T app node scripts/backup.js --tag pre-restore --keep 14
# Copy under a temporary name, then swap it in. The old -wal/-shm belong to
# the database being replaced; left behind, SQLite would replay them onto
# the restored file.
docker compose run --rm --no-deps -T --entrypoint sh app -c "
  set -e
  cp '/backups/$name' /data/sisyphus.db.restoring
  rm -f /data/sisyphus.db-wal /data/sisyphus.db-shm
  mv /data/sisyphus.db.restoring /data/sisyphus.db
"
docker compose start app
echo "Restored $name. The previous database is saved as the newest pre-restore backup."
