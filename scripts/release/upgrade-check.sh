#!/usr/bin/env bash
# Every migration runs on a copy of the previous release's database (plan 17, task 4; spec §10.5): the previous image
# makes and fills a database, the new image starts on it, copies it when a migration waits, migrates, and serves the
# same data to the same sign-in.
# Usage: scripts/release/upgrade-check.sh <previous image> <new image>
set -euo pipefail
# Every grep below reads to the end (no -q): with pipefail, a grep that stops early can fail the command before it.
OLD=$1
NEW=$2
NAME=pd-upgrade-check-$$
VOL=$NAME
PORT=${CHECK_PORT:-3901}
JAR=$(mktemp)
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$VOL" >/dev/null 2>&1 || true; rm -f "$JAR"; }
trap cleanup EXIT
fail() { echo "FAIL: $*"; docker logs "$NAME" 2>&1 | tail -30 || true; exit 1; }
start() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p "127.0.0.1:$PORT:3000" -v "$VOL:/data" \
    -e BETTER_AUTH_SECRET=upgrade-check-only-secret-00000000000000 -e APP_URL=http://localhost:3000 -e PD_TEST_AUTH=1 \
    -e ADMIN_EMAIL=admin@check.example -e SCHEDULER=off "$1" >/dev/null
  for _ in $(seq 1 120); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health")" = 200 ] && return 0
    [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] || fail "$1 stopped"
    sleep 1
  done
  fail "$1 never answered its health check"
}

docker volume create "$VOL" >/dev/null
start "$OLD"
curl -sf -c "$JAR" -b "$JAR" -o /dev/null "http://127.0.0.1:$PORT/api/test-auth?name=Upgrade+Check&next=/partners" || fail "test sign-in on $OLD"
curl -sf -c "$JAR" -b "$JAR" -o /dev/null -X POST -H 'content-type: application/json' -d '{"fixture":"sample"}' "http://127.0.0.1:$PORT/api/test-seed" || fail "the write on $OLD"
curl -sf -b "$JAR" "http://127.0.0.1:$PORT/partners" | grep 'Tailspin Solutions' >/dev/null || fail "the read on $OLD"
echo "ok: $OLD made and filled a database"
docker stop "$NAME" >/dev/null

start "$NEW"
if docker logs "$NAME" 2>&1 | grep 'database_migrated' >/dev/null; then
  docker exec "$NAME" sh -c 'ls /data/backups/*.db' >/dev/null 2>&1 || fail "migrated without a copy"
  echo "ok: copied, then migrated: $(docker logs "$NAME" 2>&1 | grep database_migrated)"
else
  echo "ok: no migration waited"
fi
curl -sf -b "$JAR" "http://127.0.0.1:$PORT/partners" | grep 'Tailspin Solutions' >/dev/null || fail "the data on $NEW"
echo "upgrade check passed: $OLD -> $NEW"
