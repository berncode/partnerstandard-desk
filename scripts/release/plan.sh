#!/usr/bin/env bash
# What a release tag publishes and what it is checked against (plan 17, task 4).
# Usage: scripts/release/plan.sh <this tag> [all tags, one per line, on stdin]
# Prints key=value lines for $GITHUB_OUTPUT:
#   version   1.4.2, the tag without its v
#   stable    true for vX.Y.Z, false for a pre-release (v1.5.0-rc.1)
#   latest    true when no stable release is higher: only then does `latest` move
#   major     true when none is higher in its major line (1.x): only then does `1` move
#   minor     true when none is higher in its minor line (1.4.x): only then does `1.4` move
#   previous  the stable releases below this one, newest first (empty when none): the upgrade check starts from the
#             newest of them whose image exists
# A fix for an older line (v1.3.5 after v1.4.0) gets only its own tags, so no server on `latest` goes back a version.
set -euo pipefail
TAG=$1
VERSION=${TAG#v}
STABLE_RE='^v[0-9]+\.[0-9]+\.[0-9]+$'
stable=false
[[ $TAG =~ $STABLE_RE ]] && stable=true
# Every other stable tag, oldest first.
others=$(grep -E "$STABLE_RE" | grep -vx "$TAG" | sort -V || true)
higher() { # prints the tags in $1 (newline list) above this tag
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    if [ "$(printf '%s\n%s\n' "$t" "$TAG" | sort -V | tail -n 1)" = "$t" ]; then echo "$t"; fi
  done <<< "$1"
}
lower() {
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    if [ "$(printf '%s\n%s\n' "$t" "$TAG" | sort -V | head -n 1)" = "$t" ]; then echo "$t"; fi
  done <<< "$1"
}
IFS=. read -r MAJ MIN _ <<< "${VERSION%%-*}"
above=$(higher "$others")
latest=false; major=false; minor=false
if [ "$stable" = true ]; then
  [ -z "$above" ] && latest=true
  [ -z "$(grep -E "^v$MAJ\." <<< "$above" || true)" ] && major=true
  [ -z "$(grep -E "^v$MAJ\.$MIN\." <<< "$above" || true)" ] && minor=true
fi
previous=$(lower "$others" | sort -rV | tr '\n' ' ' | sed 's/ $//')
echo "version=$VERSION"
echo "stable=$stable"
echo "latest=$latest"
echo "major=$major"
echo "minor=$minor"
echo "previous=$previous"
