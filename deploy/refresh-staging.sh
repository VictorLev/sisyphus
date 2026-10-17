#!/bin/sh
# Replaces the STAGING database with a fresh copy of prod's, so the next
# build is tried against real data (and real migrations) before it is
# released. Run from the staging folder; sisyphus-staging-refresh.timer runs
# it nightly, after prod's backup and before prod's deploy window.
#
#   sh refresh-staging.sh
#
# Anything done on staging since the last refresh is thrown away. Staging is
# reachable on the LAN only (never set COMPOSE_PROFILES=tunnel here), and
# its accounts and passwords are prod's.
set -eu
cd "$(dirname "$0")"
SERVICE=sisyphus
# Prod's database volume: <prod folder name>_sisyphus-data.
PROD_VOLUME=${PROD_VOLUME:-sisyphus_sisyphus-data}

# Never point this at prod itself.
if ! grep -q '^SISYPHUS_ROLE=staging' .env 2>/dev/null; then
  echo "Refusing: $(pwd)/.env does not say SISYPHUS_ROLE=staging." >&2
  exit 2
fi

# Docker would silently create a missing volume, empty, and there would be
# nothing to copy.
if ! docker volume inspect "$PROD_VOLUME" >/dev/null 2>&1; then
  echo "No volume $PROD_VOLUME. Set PROD_VOLUME to prod's data volume (docker volume ls)." >&2
  exit 2
fi

# An online backup of prod's live database, taken with staging's image and
# written into staging's backups folder. Prod keeps running throughout, and
# the backup opens it read-only. Old copies are cleared first so a failed
# copy can never be mistaken for today's.
rm -f backups/sisyphus-from-prod-*.db
docker compose run --rm --no-deps -T -v "$PROD_VOLUME:/prod" -e DB_PATH=/prod/sisyphus.db \
  "$SERVICE" node scripts/backup.js --tag from-prod --keep 1
newest=$(ls -1 backups/sisyphus-from-prod-*.db 2>/dev/null | tail -1)
if [ -z "$newest" ]; then
  echo "No copy of prod was made (is prod's database empty?). Staging left as it was." >&2
  exit 1
fi

sh restore.sh "$newest"
