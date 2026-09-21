#!/usr/bin/env bash
# Exports the app for web, serves it, and runs the Midscene AI acceptance suite.
#
# The deterministic browser suites in scripts/e2e assert what the DOM contains.
# This one asserts what a person reading the screen would conclude — that the
# total equals the rows under it, that a heading's window matches what it
# counts, that nothing is clipped or unreadable. Those are the defects that
# have actually reached users here, and a selector cannot see any of them.
#
# It needs a vision-language model. preflight.mjs refuses early and names the
# variable when one is not configured; see README.md.
set -e
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"

PORT="${MIDSCENE_PORT:-8127}"
export BASE="${BASE:-http://localhost:$PORT}"
OUT="${MIDSCENE_DIST:-$ROOT/dist-midscene}"
METRO_TMPDIR="$(mktemp -d /tmp/wafra-midscene-metro.XXXXXX)"

cleanup() {
  [ -n "${SERVER:-}" ] && kill "$SERVER" 2>/dev/null || true
  rm -rf "$METRO_TMPDIR"
}
trap cleanup EXIT

# Fail before Chromium starts rather than inside the first model call.
node preflight.mjs

[ -d node_modules ] || npm install --no-audit --no-fund

if [ "${MIDSCENE_REUSE_EXPORT:-}" = "1" ] && [ -d "$OUT" ]; then
  echo "→ reusing existing export at $OUT"
else
  echo "→ exporting web build to $OUT"
  # Same flag and same --clear as scripts/e2e/run.sh, for the same reason:
  # Metro's transform cache is not keyed by EXPO_PUBLIC values, so switching
  # between the public marketing build and the seeded ledger harness without
  # clearing mixes the two modes into one bundle.
  (cd "$ROOT" && TMPDIR="$METRO_TMPDIR" EXPO_PUBLIC_WAFRA_E2E_DEMO=1 \
    npx expo export --clear --platform web --output-dir "$OUT" >/dev/null)
fi

echo "→ serving $OUT on :$PORT"
# scripts/e2e/serve.mjs, not `npx serve`: it does the extensionless rewrite the
# client router needs, and it is already in this repo rather than fetched from
# the network mid-run.
node "$ROOT/scripts/e2e/serve.mjs" "$OUT" "$PORT" >/dev/null 2>&1 &
SERVER=$!

for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT" >/dev/null; then break; fi
  sleep 1
done
curl -sf "http://localhost:$PORT" >/dev/null || { echo "server never came up"; exit 1; }

echo "→ running Midscene suite against $BASE"
npx playwright test "$@"
