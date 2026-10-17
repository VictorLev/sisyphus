#!/usr/bin/env bash
# Smoke-tests a built Docker image the way the homelab will run it: starts it
# on a database in the pre-accounts shape and checks that it upgrades it,
# serves, logs in, refuses anonymous calls, and that the admin commands and
# the backup script work inside the container. CI runs it on every push and
# pull request, before anything is published.
#
#   scripts/smoke-image.sh <image>          e.g. scripts/smoke-image.sh sisyphus:ci
set -euo pipefail

IMAGE=${1:?usage: scripts/smoke-image.sh <image>}
NAME=sisyphus-smoke-$$
VOLUME=sisyphus-smoke-$$
PORT=${SMOKE_PORT:-3999}
BASE=http://127.0.0.1:$PORT
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)

# On GitHub Actions, failures are also raised as annotations, which show on
# the run's summary page without opening the log.
annotate() {
  [ -n "${GITHUB_ACTIONS:-}" ] || return 0
  # Annotation messages are one line; encode newlines and percent signs.
  local msg=${2//'%'/'%25'}
  msg=${msg//$'\n'/'%0A'}
  echo "::error title=$1::$msg"
}

cleanup() {
  local status=$?
  if [ $status -ne 0 ]; then
    echo "--- smoke test FAILED; last container logs:"
    local logs
    logs=$(docker logs "$NAME" 2>&1 | tail -40 || true)
    echo "$logs"
    annotate "Smoke test: container logs" "$logs"
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit $status
}
trap cleanup EXIT

step() { echo "== $*"; }
fail() { echo "FAIL: $*" >&2; annotate "Smoke test failed" "$*"; exit 1; }
# Any command that fails without calling fail() still says where it was.
trap 'annotate "Smoke test failed" "line $LINENO: $BASH_COMMAND"' ERR

wait_healthy() {
  for _ in $(seq 1 40); do
    if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  fail "the app never answered /api/health"
}

# login <cookie jar> <username> <password> -> HTTP status
login() {
  curl -s -o /dev/null -w '%{http_code}' -c "$1" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$2\",\"password\":\"$3\"}" "$BASE/api/auth/login"
}

step "seed a pre-accounts database into a fresh volume"
docker volume create "$VOLUME" >/dev/null
docker run --rm -v "$VOLUME:/data" \
  -v "$ROOT/tests/fixtures:/fixtures:ro" -v "$ROOT/scripts/smoke:/smoke:ro" \
  --entrypoint node "$IMAGE" /smoke/seed-legacy.mjs

step "start the image with first-run admin credentials"
docker run -d --name "$NAME" -v "$VOLUME:/data" -p "127.0.0.1:$PORT:3000" \
  -e ADMIN_USERNAME=smoke-admin -e ADMIN_PASSWORD=smoke-only-password -e TRUST_PROXY=1 \
  -e BACKUP_DIR=/backups \
  "$IMAGE" >/dev/null
wait_healthy

step "anonymous API calls are refused"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/sessions")
[ "$code" = 401 ] || fail "GET /api/sessions without a login returned $code, expected 401"

step "the admin from the environment logs in and owns the old rides"
[ "$(login "$WORK/admin" smoke-admin smoke-only-password)" = 200 ] || fail "admin login failed"
rides=$(curl -fsS -b "$WORK/admin" "$BASE/api/sessions" | node -e \
  'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).length))')
[ "$rides" = 3 ] || fail "admin sees $rides rides, expected the 3 seeded ones"
ftp=$(curl -fsS -b "$WORK/admin" "$BASE/api/profile" | node -e \
  'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).ftp))')
[ "$ftp" = 210 ] || fail "admin profile FTP is $ftp, expected the old 210"
library=$(curl -fsS -b "$WORK/admin" "$BASE/api/workouts" | node -e \
  'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).filter(w=>w.library).length))')
[ "$library" -gt 0 ] || fail "no library workouts"

step "the login cookie is Secure behind an HTTPS proxy"
curl -s -o /dev/null -D "$WORK/headers" -H 'Content-Type: application/json' -H 'X-Forwarded-Proto: https' \
  -d '{"username":"smoke-admin","password":"smoke-only-password"}' "$BASE/api/auth/login"
grep -qi '^set-cookie:.*; *secure' "$WORK/headers" || fail "no Secure flag on the session cookie"

step "add-user works inside the container, and the new rider starts empty"
out=$(docker exec "$NAME" npm run --silent add-user -- smoke-rider --name "Smoke Rider 2")
password=$(printf '%s\n' "$out" | sed -n 's/^Temporary password: //p')
[ -n "$password" ] || fail "add-user printed no password: $out"
[ "$(login "$WORK/rider" smoke-rider "$password")" = 200 ] || fail "new rider cannot log in"
rides=$(curl -fsS -b "$WORK/rider" "$BASE/api/sessions" | node -e \
  'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).length))')
[ "$rides" = 0 ] || fail "new rider sees $rides rides"

step "the backup script works inside the container"
docker exec "$NAME" node scripts/backup.js --tag smoke
docker exec "$NAME" sh -c 'ls /backups/sisyphus-smoke-*.db' >/dev/null || fail "no backup file written"

step "the app stops promptly on SIGTERM and keeps everything across a restart"
start=$(date +%s)
docker stop "$NAME" >/dev/null
elapsed=$(( $(date +%s) - start ))
[ "$elapsed" -lt 8 ] || fail "docker stop took ${elapsed}s: SIGTERM is not handled"
docker start "$NAME" >/dev/null
wait_healthy
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$WORK/admin" "$BASE/api/auth/me")
[ "$code" = 200 ] || fail "the admin session did not survive a restart ($code)"

echo "== smoke test passed"
