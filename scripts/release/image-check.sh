#!/usr/bin/env bash
# Checks a built image the way a company runs it (plan 17, live check 1): it starts as uid 1000, migrates a new
# database in /data, answers its health check, keeps WAL on, writes and reads, and keeps its data over a restart.
# Usage: scripts/release/image-check.sh <image> [platform]      e.g. partnerstandard-desk:local linux/arm64
set -euo pipefail
# Every grep below reads to the end (no -q): with pipefail, a grep that stops early can fail the command before it.
IMAGE=$1
PLATFORM=${2:-}
NAME=pd-image-check-$$
VOL=$NAME
PORT=${CHECK_PORT:-3900}
JAR=$(mktemp)
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$VOL" >/dev/null 2>&1 || true; rm -f "$JAR"; }
trap cleanup EXIT
fail() { echo "FAIL: $*"; docker logs "$NAME" 2>&1 | tail -30 || true; exit 1; }

docker volume create "$VOL" >/dev/null
docker run -d --name "$NAME" ${PLATFORM:+--platform "$PLATFORM"} -p "127.0.0.1:$PORT:3000" -v "$VOL:/data" \
  -e BETTER_AUTH_SECRET=image-check-only-secret-0000000000000000 -e APP_URL=http://localhost:3000 -e PD_TEST_AUTH=1 \
  -e ADMIN_EMAIL=admin@check.example -e SCHEDULER=off "$IMAGE" >/dev/null

healthy() {
  # Emulated (another platform) starts slowly: up to 5 minutes.
  for _ in $(seq 1 300); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health")" = 200 ] && return 0
    [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] || return 1
    sleep 1
  done
  return 1
}

healthy || fail "never answered its health check"
echo "ok: health"
[ "$(docker exec "$NAME" id -u)" = 1000 ] || fail "not uid 1000"
echo "ok: uid 1000"
docker exec "$NAME" sh -c 'test -s /app/LICENSE && test -s /app/packages/method/LICENSE && [ "$(grep -c "^License: " /app/THIRD_PARTY_LICENSES)" -ge 50 ]' \
  || fail "a license file is missing: LICENSE, packages/method/LICENSE or THIRD_PARTY_LICENSES"
echo "ok: the licenses are in the image"
docker logs "$NAME" 2>&1 | grep 'database_migrated' >/dev/null || fail "the new database wasn't migrated"
echo "ok: migrated on start"

curl -sf -c "$JAR" -b "$JAR" -o /dev/null "http://127.0.0.1:$PORT/api/test-auth?name=Image+Check&next=/partners" || fail "test sign-in"
curl -sf -c "$JAR" -b "$JAR" -o /dev/null -X POST -H 'content-type: application/json' -d '{"fixture":"sample"}' "http://127.0.0.1:$PORT/api/test-seed" || fail "the write"
curl -sf -b "$JAR" "http://127.0.0.1:$PORT/partners" | grep 'Tailspin Solutions' >/dev/null || fail "the read"
echo "ok: a write and a read"
docker exec "$NAME" sh -c 'test -s /data/partnerstandard-desk.db && test -e /data/partnerstandard-desk.db-wal' || fail "WAL is off"
[ "$(docker exec "$NAME" stat -c %u /data/partnerstandard-desk.db)" = 1000 ] || fail "the database isn't uid 1000's"
echo "ok: WAL, the files are uid 1000's"

docker restart "$NAME" >/dev/null
healthy || fail "no health check after the restart"
curl -sf -b "$JAR" "http://127.0.0.1:$PORT/partners" | grep 'Tailspin Solutions' >/dev/null || fail "the data after the restart"
echo "ok: a restart keeps the data"
[ "$(docker inspect -f '{{.Config.User}}' "$IMAGE")" = 1000:1000 ] || fail "the image's user"
echo "image check passed: $IMAGE ${PLATFORM}"
