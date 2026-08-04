#!/usr/bin/env bash
# Transpiles the pure-logic modules from src/lib and runs the unit + parser suites.
set -e
cd "$(dirname "$0")"

# The Worker is typechecked against its REAL target types (@cloudflare/workers-types),
# which the root tsconfig cannot do — that one compiles the app against the DOM
# lib. Running it here is what puts server/ under the gates; it was excluded
# from typecheck and CI entirely before.
(cd ../../server && npx tsc --noEmit -p tsconfig.json)

rm -rf build && mkdir -p build
for f in types routes format categories sms-parser bills insights seed subscriptions cards analytics period purchases markets i18n balances brand-marks leaving-soon reminders; do
  sed -e "s|from '@/lib/|from './|g" \
      -e "s|import type { IconName } from '@/components/ui/icon';|type IconName = string;|" \
      -e "s|import('@/components/ui/icon').IconName|string|g" \
      ../../src/lib/$f.ts > build/$f.ts
done
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
/** Workers extends Request.json() with a type parameter; the DOM lib does not. */
interface Request {
  json<T = unknown>(): Promise<T>;
}
SHIM

npx tsc build/*.ts --module commonjs --target es2022 --lib es2022,dom --outDir build --skipLibCheck

# The device half of the seal. It stays ESM because @noble is ESM-only, and
# Node 22 lets a CommonJS test require() an ES module — so worker.test.js can
# assert the REAL client code against the REAL seal rather than a stand-in.
cp ../../src/lib/relay-crypto.ts build/relay-crypto.mts
npx tsc build/relay-crypto.mts --module node16 --moduleResolution node16 \
  --target es2022 --lib es2022 --outDir build --skipLibCheck --strict

node parser.test.js
node unit.test.js
node worker.test.js
