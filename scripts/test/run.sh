#!/usr/bin/env bash
# Transpiles the pure-logic modules from src/lib and runs the unit + parser suites.
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

rm -rf build && mkdir -p build
# Modules added by later work are listed here too; a name that does not exist
# yet is skipped rather than failing the run, so the suite stays green while a
# feature is still landing.
for f in types format categories ledger dedupe arabic-sms sms-parser import-plan bills insights seed \
         subscriptions cards analytics period purchases markets i18n balances brand-marks leaving-soon \
         accounts heal accuracy onboarding \
         relay-crypto relay-protocol trusted-device-contract cloud-import-contract reimbursement-report fx splits db-schema \
         storage-diagnostics; do
  [ -f "../../src/lib/$f.ts" ] || continue
  sed -e "s|from '@/lib/|from './|g" \
      -e "s|import type { IconName } from '@/components/ui/icon';|type IconName = string;|" \
      -e "s|import('@/components/ui/icon').IconName|string|g" \
      ../../src/lib/$f.ts > build/$f.ts
done
cp ../../server/src/crypto.ts build/crypto.ts
npx tsc build/*.ts --module commonjs --target es2022 --lib es2022,dom --outDir build --skipLibCheck
node parser.test.js
node bank-corpus.test.js
node unit.test.js
node worker.test.js
# Properties that must hold for every message, not just the pinned ones.
node invariants.test.js
# Whether a message the user already has counts as new.
node import-plan.test.js
# Arabic messages, which reach the same parser through a rewrite layer.
node arabic.test.js
# The delivery-time banner reads bank SMS a second time, in Kotlin. This runs
# the real patterns out of that source against the real corpus.
node instant-alert.test.js
# The same Kotlin patterns, compiled by the engine that actually runs them.
node kotlin-regex.test.js
# Every route the app navigates to must have a file behind it.
node routes.test.js
# The Android tab-switch performance config, and the upstream behaviour it
# depends on. A one-prop fix that only a signed Release build can falsify.
node perf-config.test.js
# Definitions that live in two places and must agree.
node contracts.test.js
node onboarding.test.js
node report.test.js
# Suites that arrive with the iOS relay and storage work. Run only once they
# exist, so the file stays green while those features are still landing.
for t in relay trusted-devices cloud-import fx splits db; do
  if [ -f "$t.test.js" ]; then node "$t.test.js"; fi
done
