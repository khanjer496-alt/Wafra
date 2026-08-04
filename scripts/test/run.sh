#!/usr/bin/env bash
# Transpiles the pure-logic modules from src/lib and runs the unit, parser,
# worker and relay-client suites.
set -e
cd "$(dirname "$0")"

# The Worker is typechecked against its REAL target types (@cloudflare/workers-types),
# which the root tsconfig cannot do — that one compiles the app against the DOM
# lib. Running it here is what puts server/ under the gates; it was excluded
# from typecheck and CI entirely before.
(cd ../../server && npx tsc --noEmit -p tsconfig.json)

rm -rf build && mkdir -p build

# One rewrite table for every file. `@/lib/x` becomes a sibling, the icon type
# collapses to a string, and the three native surfaces (react-native, the
# expo-* packages, expo-modules-core) point at the stubs in ./stubs. Nothing
# else about the source changes: these are the shipping modules, not copies.
rewrite() {
  sed -e "s|from '@/lib/relay-crypto'|from './relay-crypto.cjs'|g" \
      -e "s|from '@/lib/|from './|g" \
      -e "s|import('@/lib/|import('./|g" \
      -e "s|import type { IconName } from '@/components/ui/icon';|type IconName = string;|" \
      -e "s|import('@/components/ui/icon').IconName|string|g" \
      -e "s|from '../../modules/notification-reader'|from './notification-reader'|" \
      -e "s|from '../../modules/sms-reader'|from './sms-reader'|" \
      -e "s|from 'react-native'|from './stub-react-native'|" \
      -e "s|from 'expo-modules-core'|from './stub-expo-modules-core'|" \
      -e "s|from 'expo-constants'|from './stub-expo-constants'|" \
      -e "s|from 'expo-crypto'|from './stub-expo-crypto'|" \
      -e "s|from 'expo-secure-store'|from './stub-secure-store'|" \
      -e "s|from '@react-native-async-storage/async-storage'|from './stub-async-storage'|" \
      "$1" > "$2"
}

for f in types routes format categories sms-parser bills insights seed subscriptions cards \
         analytics period purchases markets i18n balances brand-marks leaving-soon reminders \
         auto-import; do
  rewrite ../../src/lib/$f.ts build/$f.ts
done
for f in stubs/*.ts; do
  cp "$f" "build/$(basename "$f")"
done
# The app's own native module wrappers, compiled for real against a
# requireOptionalNativeModule that returns null — which is what they do on iOS
# and in Expo Go anyway.
rewrite ../../modules/sms-reader/index.ts build/sms-reader.ts
rewrite ../../modules/notification-reader/index.ts build/notification-reader.ts

# `store.tsx` is a React module and cannot be compiled here, but auto-import and
# relay both take their batch shape from it. The two interfaces are EXTRACTED
# from the real file rather than hand-copied, so they cannot drift out of sync
# with the store the app actually writes to.
{
  echo "import type { Account, CardDue, CategoryId, Transaction } from './types';"
  echo
  awk '/^export interface TxHealUpdate/,/^interface StoreValue/' ../../src/lib/store.tsx | sed '$d'
} > build/store.ts

cp ../../server/src/crypto.ts build/crypto.ts
# The Worker itself, so its ROUTES can be exercised and not just its crypto.
sed -e "s|from '@/lib/|from './|g" ../../server/src/index.ts > build/worker.ts

# Stand-ins for the workerd globals the Worker references. This build compiles
# against the DOM lib — Node's WebCrypto and undici match it closely enough to
# run the real handler — and these declarations are the only gap.
cat > build/workers-shim.d.ts <<'SHIM'
interface D1Result<T = unknown> {
  results: T[];
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}
interface ScheduledController {
  scheduledTime: number;
  cron: string;
}
/** The Worker uses waitUntil when Workers gives it one; tests do not. */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
/** Workers extends Request.json() with a type parameter; the DOM lib does not. */
interface Request {
  json<T = unknown>(): Promise<T>;
}
SHIM

npx tsc build/*.ts --module commonjs --target es2022 --lib es2022,dom --outDir build --skipLibCheck

# The relay client and the device half of the seal.
#
# These two get their own pass because @noble is ESM-only with subpath exports
# ("@noble/curves/ed25519.js"), which the node10 resolution implied by
# `--module commonjs` cannot follow. Compiled as .cts under nodenext they emit
# CommonJS that `require()`s an ES module — supported since Node 22.12 — so the
# suites can drive the REAL src/lib/relay.ts rather than a re-implementation of
# it, which is the only way a client/server crypto mismatch can be caught here
# instead of on a user's phone.
rewrite ../../src/lib/relay-crypto.ts build/relay-crypto.cts
rewrite ../../src/lib/relay.ts build/relay.cts
npx tsc build/relay.cts build/relay-crypto.cts --module nodenext --moduleResolution nodenext \
  --target es2022 --lib es2022,dom --skipLibCheck

node parser.test.js
node unit.test.js
node worker.test.js
node relay.test.js
