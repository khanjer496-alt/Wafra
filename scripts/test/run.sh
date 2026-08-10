#!/usr/bin/env bash
# Transpiles the pure-logic modules from src/lib and runs every suite: unit,
# parser, corpus, invariants, Kotlin, contracts, worker and relay-client, plus
# the Worker's own PDF/email/push suites out of server/test.
set -e
cd "$(dirname "$0")"
# The suite compiles into a single shared build/ directory, so two runs at
# once would delete each other's output half-way through and fail for reasons
# that have nothing to do with the code. Queue them instead.
exec 9>/tmp/wafra-test.lock
flock 9 2>/dev/null || true
# kotlin-regex.test.js needs a working javac, and skips itself (printing
# "0 passed") when it cannot find one — which reads exactly like the suite
# passing. Two traps here, both of which hid those 15 assertions on macOS:
# Homebrew's openjdk is keg-only, so installing it does NOT put it on PATH;
# and macOS ships a stub /usr/bin/javac that exists, satisfies `command -v`,
# and then fails with "Unable to locate a Java Runtime" when actually run.
# So the test is whether javac RUNS, not whether it resolves.
if ! javac -version >/dev/null 2>&1; then
  for jdk in /opt/homebrew/opt/openjdk/bin /usr/local/opt/openjdk/bin; do
    if "$jdk/javac" -version >/dev/null 2>&1; then
      export PATH="$jdk:$PATH"
      break
    fi
  done
fi

# The Worker is typechecked against its REAL target types (@cloudflare/workers-types),
# which the root tsconfig cannot do — that one compiles the app against the DOM
# lib. Running it here is what puts server/ under the gates; it was excluded
# from typecheck and CI entirely before. It needs no wrangler binary, which is
# why it belongs here rather than behind `npm run check:server`.
#
# server/'s own dependency set has to be present BEFORE this line, not after
# it: the Worker's types come from @cloudflare/workers-types, and imports.ts
# pulls postal-mime and unpdf. This install used to sit further down, next to
# the server suites, which meant the very first thing `npm test` did on a clean
# checkout was fail here with a wall of TS2307s that look like a broken merge
# rather than a missing `npm ci`.
[ -d ../../server/node_modules ] || npm --prefix ../../server ci
(cd ../../server && npx tsc --noEmit -p tsconfig.json)

# The shipping modules, compiled into build/. Extracted to build.sh because
# `npm run check:server` needs the same build to run the behavioural Worker
# suite; see the header there.
bash build.sh

# The protected iPhone history bridge is Foundation-only. Exercise the actual
# Swift store whenever this gate runs on macOS; Linux CI has a separate Xcode
# job that prebuilds the plugin before invoking the same suite.
NATIVE_SUITES=0
if [ "$(uname -s)" = "Darwin" ]; then
  bash native-history-store.sh
  NATIVE_SUITES=1
fi

# The Worker's own suites: the PDF/email statement parser and the encrypted push
# tokens. They only ever ran from server/package.json's `test` script, which
# nothing in `npm test` or `npm run check` called — so the code they cover was
# ungated from the root. esbuild and the .cjs entry points live in server/'s own
# dependency set; install it here rather than letting npx reach for the network
# in the middle of a test run.
[ -d ../../server/node_modules ] || npm --prefix ../../server ci
# schema.test.cjs runs the real schema.sql through the sqlite3 CLI. That was a
# private detail of `npm --prefix server test` — which nothing called — and
# becomes a hard requirement of the gate the moment this suite runs from the
# root. Name it here instead of surfacing a bare `spawnSync sqlite3 ENOENT`.
command -v sqlite3 >/dev/null || {
  echo "run.sh: sqlite3 is not on PATH; server/test/schema.test.cjs needs it." >&2
  echo "run.sh: apt-get install sqlite3  /  brew install sqlite" >&2
  exit 1
}
rm -rf ../../server/.test-build
(cd ../../server \
  && npx tsc src/push.ts --module commonjs --target es2022 --lib es2022,dom --outDir .test-build --skipLibCheck \
  && npx esbuild src/imports.ts --bundle --platform=node --format=cjs --outfile=.test-build/imports.cjs)
SERVER_SUITES=(push imports schema)
for t in "${SERVER_SUITES[@]}"; do
  node "../../server/test/$t.test.cjs"
done

# Every suite, named once. This list is the gate.
#
# It replaces two patterns that both shrink the gate in silence: `[ -f "$t.test.js" ]
# && node "$t.test.js"` skips a suite that a bad merge deleted and still exits 0,
# and a suite file that exists but was never wired in here runs nowhere at all.
# Each branch's suite stayed green over the other's defect class, so a green run
# means nothing unless the count is checked too. Three assertions, none of which
# can be satisfied by editing only one place:
#   1. every name below must have a file  — catches a deleted suite
#   2. the count of *.test.js on disk must match  — catches an unwired suite
#   3. the count must equal EXPECTED_SUITES  — catches a suite dropped from both
EXPECTED_SUITES=30
SUITES=(parser bank-corpus unit worker relay invariants import-plan arabic instant-alert \
        charge-alert kotlin-regex routes perf-config contracts onboarding report \
        trusted-devices cloud-import fx db uncategorised bills categories feedback alert-draft)
SUITES+=(historical-import)
SUITES+=(alert-market-packs)
SUITES+=(release-readiness)
SUITES+=(ios-capture-setup)
SUITES+=(dashboard-projection)

missing=""
for t in "${SUITES[@]}"; do
  [ -f "$t.test.js" ] || missing="$missing $t"
done
if [ -n "$missing" ]; then
  echo "run.sh: declared suites with no file:$missing" >&2
  exit 1
fi
on_disk=$(ls -1 *.test.js | wc -l | tr -d ' ')
if [ "$on_disk" -ne "${#SUITES[@]}" ]; then
  echo "run.sh: ${on_disk} *.test.js files on disk but ${#SUITES[@]} declared — one is not being run." >&2
  ls -1 *.test.js >&2
  exit 1
fi
if [ "${#SUITES[@]}" -ne "$EXPECTED_SUITES" ]; then
  echo "run.sh: ${#SUITES[@]} suites declared, expected $EXPECTED_SUITES." >&2
  echo "run.sh: if a suite was intentionally added or removed, change EXPECTED_SUITES too." >&2
  exit 1
fi

for t in "${SUITES[@]}"; do
  node "$t.test.js"
done

echo "run.sh: ${#SUITES[@]} app suites + ${#SERVER_SUITES[@]} server suites + $NATIVE_SUITES native Swift suites ran."
