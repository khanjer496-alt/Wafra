#!/usr/bin/env bash
# Transpiles the pure-logic modules from src/lib and runs the unit + parser suites.
set -e
cd "$(dirname "$0")"
rm -rf build && mkdir -p build
for f in types format categories sms-parser bills insights seed subscriptions cards analytics period purchases markets i18n balances brand-marks leaving-soon accounts heal accuracy; do
  sed -e "s|from '@/lib/|from './|g" \
      -e "s|import type { IconName } from '@/components/ui/icon';|type IconName = string;|" \
      -e "s|import('@/components/ui/icon').IconName|string|g" \
      ../../src/lib/$f.ts > build/$f.ts
done
cp ../../server/src/crypto.ts build/crypto.ts
npx tsc build/*.ts --module commonjs --target es2022 --lib es2022,dom --outDir build --skipLibCheck
node parser.test.js
node unit.test.js
node worker.test.js
# Properties that must hold for every message, not just the pinned ones.
node invariants.test.js
