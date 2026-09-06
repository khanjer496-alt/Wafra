#!/usr/bin/env bash
# The behavioural half of `npm run check:server`.
#
# WHY THIS EXISTS. check:server used to be `npm --prefix server ci &&
# typecheck && npm --prefix server test && wrangler deploy --dry-run`, and
# `npm --prefix server test` is four .cjs suites of which server/test/schema.test.cjs
# — 32 of the 59 assertions — reads server/src/index.ts AS A STRING and regex-
# matches it. No route was executed. There was no D1 stub, no fetch(), no
# scheduled(). "device-sealed queue retention is implemented at 30 days" passed
# because the SQL literal appeared somewhere in the file, so a scheduled()
# that threw on its first line would have passed it too. Anyone who reviewed a
# change to the Worker by running check:server was reading grep results.
#
# The suite that actually drives worker.fetch and worker.scheduled against a D1
# stub over the real schema.sql already existed — scripts/test/worker.test.js —
# but only `npm test` ran it. This script is the wiring, not a second suite:
# one build, one behavioural suite, called from both gates.
#
# WHAT IT NEEDS. worker.test.js requires scripts/test/build/, which holds the
# real Worker and the real src/lib client modules compiled to CommonJS. That
# build is shared with `npm test`, so this takes the same /tmp/wafra-test.lock
# run.sh takes: `rm -rf build` from two concurrent runs otherwise deletes one
# run's output half-way through the other's, and the failure reads as a broken
# checkout rather than as a collision.
set -e
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")"
if [ "${WAFRA_TEST_LOCKED:-}" != "1" ]; then
  if command -v flock >/dev/null 2>&1; then
    exec env WAFRA_TEST_LOCKED=1 flock /tmp/wafra-test.lock "$SELF" "$@"
  elif command -v lockf >/dev/null 2>&1; then
    exec env WAFRA_TEST_LOCKED=1 lockf -k /tmp/wafra-test.lock "$SELF" "$@"
  fi
fi

bash build.sh
node worker.test.js
