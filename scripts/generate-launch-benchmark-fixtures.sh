#!/usr/bin/env bash
set -e
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/.."

# build.sh owns a shared output directory. Take the same lock as every test
# entry point before rebuilding it so a benchmark run cannot erase live tests.
if [ "${WAFRA_TEST_LOCKED:-}" != "1" ]; then
  if command -v flock >/dev/null 2>&1; then
    exec env WAFRA_TEST_LOCKED=1 flock /tmp/wafra-test.lock "$SELF" "$@"
  elif command -v lockf >/dev/null 2>&1; then
    exec env WAFRA_TEST_LOCKED=1 lockf -k /tmp/wafra-test.lock "$SELF" "$@"
  fi
fi

bash scripts/test/build.sh
node scripts/generate-launch-benchmarks.mjs "$@"
