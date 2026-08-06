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

rm -rf build && mkdir -p build

# One rewrite table for every file. `@/lib/x` becomes a sibling, the icon type
# collapses to a string, and the native surfaces (react-native, the expo-*
# packages, expo-modules-core, async-storage) point at the stubs in ./stubs.
# Nothing else about the source changes: these are the shipping modules, not
# copies. The stubs are what let auto-import.ts, reminders.ts and the
# modules/*/index.ts wrappers be compiled at all instead of excluded.
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

# Modules added by later work are listed here too; a name that does not exist
# yet is skipped rather than failing the run, so the suite stays green while a
# feature is still landing. A missing module is not a silent hole — every suite
# that needs one fails loudly at require() time.
#
# relay-crypto and relay are deliberately NOT in this list: they import @noble's
# ESM-only subpath exports, which the node10 resolution implied by
# `--module commonjs` cannot follow. They get the nodenext .cts pass below.
for f in types routes format categories ledger dedupe arabic-sms sms-parser import-plan bills \
         insights seed subscriptions cards analytics period purchases markets i18n balances \
         brand-marks leaving-soon accounts heal accuracy onboarding reminders auto-import \
         relay-protocol trusted-device-contract cloud-import-contract reimbursement-report fx \
         splits db-schema storage-diagnostics daily-summary; do
  [ -f "../../src/lib/$f.ts" ] || continue
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
# from wherever they really live rather than hand-copied, so they cannot drift
# out of sync with the store the app actually writes to.
#
# The two branches kept them in different files, and the failure mode of getting
# this wrong is invisible: the awk below matches nothing, emits a build/store.ts
# with no interfaces in it, and every consumer then compiles against an implicit
# `any` while the suite stays green. So resolve it explicitly and exit if
# neither file has them.
if grep -q '^export interface TxHealUpdate' ../../src/lib/store.tsx; then
  {
    echo "import type { Account, CardDue, CategoryId, Transaction } from './types';"
    echo
    awk '/^export interface TxHealUpdate/,/^interface StoreValue/' ../../src/lib/store.tsx | sed '$d'
  } > build/store.ts
elif grep -q '^export interface TxHealUpdate' ../../src/lib/types.ts; then
  echo "export type { ImportBatchInput, TxHealUpdate } from './types';" > build/store.ts
else
  echo "run.sh: TxHealUpdate/ImportBatchInput are in neither store.tsx nor types.ts." >&2
  echo "run.sh: refusing to emit an empty build/store.ts — see the comment above." >&2
  exit 1
fi

# The Worker, so its ROUTES can be exercised and not just its crypto.
#
# ALL of server/src comes across, not just index.ts. The Worker was one file
# when this build was written and is now five; copying only index.ts leaves
# build/worker.ts importing './imports', './ingest-row' and './push', which
# TS2307s and — under `set -e` — aborts the whole run BEFORE a single suite
# executes. A green `npm test` is impossible in that state, but so is a red
# one that points at the real problem. Loop over the directory so a sixth
# module is picked up by existing without anyone remembering this line.
for f in ../../server/src/*.ts; do
  rewrite "$f" "build/$(basename "$f")"
done
mv build/index.ts build/worker.ts

# build/imports.ts imports postal-mime and unpdf, which are server/'s
# dependencies and unreachable from scripts/test by both tsc and node. Point
# node_modules resolution for this directory at the set that actually holds
# them rather than adding them to the app's own dependency list, where they
# would ship in the phone bundle.
ln -sfn ../../../server/node_modules build/node_modules

# Stand-ins for the workerd globals the Worker references. This build compiles
# against the DOM lib — Node's WebCrypto and undici match it closely enough to
# run the real handler — and these declarations are the only gap.
#
# These are a floor, not a model: every member here must be one the Worker
# really uses, and typed as workerd types it. `meta.changes` is the load-bearing
# one — the Worker reads it to tell a row it queued from one the replay receipt
# refused, and from an invite that was already redeemed. Typing run()/batch()
# as `unknown` (as this shim once did) does not merely lose a check, it makes
# those call sites uncompilable, and the tempting fix — casting them away —
# would let a stub that always reports zero changes pass the suite with a
# permanently empty queue.
cat > build/workers-shim.d.ts <<'SHIM'
interface D1Meta {
  changes: number;
  last_row_id: number;
}
interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
interface ScheduledController {
  scheduledTime: number;
  cron: string;
}
/** The Worker uses waitUntil when Workers gives it one; tests do not. */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
/** Cloudflare Email Routing's hook argument, for `<email-token>@EMAIL_DOMAIN`. */
interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}
/** What `satisfies ExportedHandler<Env>` checks the default export against. */
interface ExportedHandler<E = unknown> {
  fetch?(request: Request, env: E, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: E, ctx: ExecutionContext): Promise<void>;
  email?(message: ForwardableEmailMessage, env: E, ctx: ExecutionContext): Promise<void>;
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
EXPECTED_SUITES=19
SUITES=(parser bank-corpus unit worker relay invariants import-plan arabic instant-alert \
        kotlin-regex routes perf-config contracts onboarding report trusted-devices \
        cloud-import fx db)

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

echo "run.sh: ${#SUITES[@]} suites + ${#SERVER_SUITES[@]} server suites ran."
