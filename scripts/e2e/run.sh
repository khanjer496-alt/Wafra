#!/usr/bin/env bash
# Exports the app for web, serves it, and runs the browser acceptance suites.
#
# These existed for a while and ran only when somebody remembered to. That is
# the same "nothing checks it" problem the rest of the audit is about, one
# level up: the suites that catch dead routes and broken screens were not
# themselves wired to anything.
set -e
cd "$(dirname "$0")/../.."

PORT="${E2E_PORT:-8126}"
export BASE="${BASE:-http://localhost:$PORT}"
OUT="${E2E_DIST:-dist}"
METRO_TMPDIR="$(mktemp -d /tmp/wafra-e2e-metro.XXXXXX)"

cleanup() {
  [ -n "${SERVER:-}" ] && kill "$SERVER" 2>/dev/null || true
  rm -rf "$METRO_TMPDIR"
}
trap cleanup EXIT

echo "→ exporting web build to $OUT"
# The normal web build is now the public marketing surface. Metro's transform
# cache is not keyed by EXPO_PUBLIC values, so switching from that build to the
# seeded ledger harness without clearing can mix the two modes in one bundle.
TMPDIR="$METRO_TMPDIR" EXPO_PUBLIC_WAFRA_E2E_DEMO=1 npx expo export --clear --platform web --output-dir "$OUT" >/dev/null

echo "→ serving $OUT on :$PORT"
# serve.mjs, not `npx serve`: serve is in nobody's dependencies, so this line
# fetched a package mid-job on every run, and it does not do the extensionless
# rewrite the client router needs — a pushed route would 404.
node scripts/e2e/serve.mjs "$OUT" "$PORT" >/dev/null 2>&1 &
SERVER=$!

# Wait for the server rather than sleeping a fixed amount: on a cold CI runner
# the export is slow and a fixed sleep is either flaky or wasted time.
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT" >/dev/null; then break; fi
  sleep 1
done
curl -sf "http://localhost:$PORT" >/dev/null || { echo "server never came up"; exit 1; }

node scripts/e2e/e2e-diagnostic-export.mjs
node scripts/e2e/e2e-transaction-ui.mjs
node scripts/e2e/e2e-ui-cleanup.mjs
node scripts/e2e/e2e-home-cashflow.mjs
node scripts/e2e/e2e-merchant-spending.mjs
node scripts/e2e/e2e-merchant-entrypoints.mjs
node scripts/e2e/e2e-smoke.mjs
node scripts/e2e/e2e-period.mjs
node scripts/e2e/e2e-assistant.mjs
node scripts/e2e/e2e-assistant-analysis.mjs
node scripts/e2e/e2e-persist.mjs
node scripts/e2e/e2e-navigation.mjs

node scripts/e2e/e2e-universal-review.mjs
node scripts/e2e/e2e-transfer-review.mjs
node scripts/e2e/e2e-redesign.mjs
node scripts/e2e/e2e-merchant-logos.mjs

node scripts/e2e/e2e-onboarding.mjs
