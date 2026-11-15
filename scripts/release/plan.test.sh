#!/usr/bin/env bash
# Checks scripts/release/plan.sh: bash scripts/release/plan.test.sh
set -euo pipefail
here=$(dirname "$0")
fails=0
expect() { # tag, tags, expected lines
  local got; got=$(printf '%s\n' $2 | "$here/plan.sh" "$1" | tr '\n' ' ')
  if [ "$got" != "$3 " ]; then echo "FAIL $1 with [$2]: $got"; fails=$((fails+1)); else echo "ok   $1"; fi
}
expect v1.0.0 "v1.0.0" "version=1.0.0 stable=true latest=true major=true minor=true previous="
expect v1.4.2 "v1.0.0 v1.4.1 v1.4.2" "version=1.4.2 stable=true latest=true major=true minor=true previous=v1.4.1 v1.0.0"
expect v1.3.5 "v1.3.4 v1.3.5 v1.4.0" "version=1.3.5 stable=true latest=false major=false minor=true previous=v1.3.4"
expect v1.10.0 "v1.9.0 v1.10.0" "version=1.10.0 stable=true latest=true major=true minor=true previous=v1.9.0"
expect v1.9.3 "v1.9.2 v1.10.0 v1.9.3 v2.0.0 v1.8.0" "version=1.9.3 stable=true latest=false major=false minor=true previous=v1.9.2 v1.8.0"
expect v1.11.0 "v1.10.0 v1.11.0 v2.0.0" "version=1.11.0 stable=true latest=false major=true minor=true previous=v1.10.0"
expect v1.5.0-rc.1 "v1.4.0 v1.5.0-rc.1" "version=1.5.0-rc.1 stable=false latest=false major=false minor=false previous=v1.4.0"
expect v1.5.0 "v1.4.0 v1.5.0-rc.1 v1.5.0" "version=1.5.0 stable=true latest=true major=true minor=true previous=v1.4.0"
exit $fails
