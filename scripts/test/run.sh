#!/usr/bin/env bash
# Transpiles the pure-logic modules from src/lib and runs the unit + parser suites.
set -e
cd "$(dirname "$0")"
# The suite compiles into a single shared build/ directory, so two runs at
# once would delete each other's output half-way through and fail for reasons
# that have nothing to do with the code. Queue them instead.
exec 9>/tmp/wafra-test.lock
flock 9 2>/dev/null || true
rm -rf build && mkdir -p build
# Modules added by later work are listed here too; a name that does not exist
# yet is skipped rather than failing the run, so the suite stays green while a
# feature is still landing.
for f in types format categories sms-parser bills insights seed subscriptions cards analytics period purchases markets i18n balances brand-marks leaving-soon \
         relay-crypto fx splits db-schema; do
  [ -f "../../src/lib/$f.ts" ] || continue
  sed -e "s|from '@/lib/|from './|g" \
      -e "s|import type { IconName } from '@/components/ui/icon';|type IconName = string;|" \
      -e "s|import('@/components/ui/icon').IconName|string|g" \
      ../../src/lib/$f.ts > build/$f.ts
done
cp ../../server/src/crypto.ts build/crypto.ts
npx tsc build/*.ts --module commonjs --target es2022 --lib es2022,dom --outDir build --skipLibCheck
for t in parser unit worker relay fx splits db; do
  if [ -f "$t.test.js" ]; then node "$t.test.js"; fi
done
