#!/usr/bin/env bash
# Compile the shipping modules into scripts/test/build/, which every behavioural
# suite requires at run time.
#
# This was inline in run.sh, and moved out for one reason: `npm run check:server`
# needs it too. That gate used to end at server/test/*.cjs, 32 of whose
# assertions read server/src/index.ts AS A STRING and regex-matched it — no
# route ran, no D1 stub existed, and "retention is implemented at 30 days"
# passed because the SQL literal appeared in the file. The suite that actually
# drives worker.fetch/worker.scheduled is scripts/test/worker.test.js, and it
# cannot run without this build. Rather than duplicate a second, thinner build
# under server/, both entry points call this one:
#
#   scripts/test/run.sh          — `npm test`, the whole suite
#   scripts/test/worker-gate.sh  — `npm run check:server`, the Worker only
#
# Callers are responsible for serialising themselves against each other; the
# `rm -rf build` below would otherwise delete another run's output half-way
# through. Both callers take /tmp/wafra-test.lock before invoking this.
set -e
cd "$(dirname "$0")"

# The build needs server/'s dependency set on disk before it starts: the Worker's
# types come from @cloudflare/workers-types and imports.ts pulls postal-mime and
# unpdf, which the symlink at the end of this file points build/ at.
[ -d ../../server/node_modules ] || npm --prefix ../../server ci

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
         fx-summary splits db-schema storage-diagnostics daily-summary charge-alert \
         background-relay-storage uncategorised currency-metadata alert-draft feedback-wire \
         historical-import; do
  [ -f "../../src/lib/$f.ts" ] || continue
  rewrite ../../src/lib/$f.ts build/$f.ts
done

# The feedback payload builder, under a name of its own.
#
# `feedback` exists on BOTH sides of this repo — src/lib/feedback.ts builds the
# report on the phone, server/src/feedback.ts receives it — and the loop over
# server/src further down copies by BASENAME into this same directory, so
# whichever runs last wins and the other vanishes. It was the app module that
# lost, in silence: build/feedback.js exported the Worker's validator and the
# app's own suite failed with "FEEDBACK_DETAILS is not iterable", which names
# neither file. Nothing in build/ imports this module — only the screen does —
# so the rename costs nothing here and the guard below stops the next collision
# from being discovered the same way.
[ -f ../../src/lib/feedback.ts ] && rewrite ../../src/lib/feedback.ts build/app-feedback.ts
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

# Nothing the app compiled above may be silently replaced by a Worker module of
# the same name. Two files called `feedback.ts` — one per side — already did
# exactly that, and the failure surfaced two suites away as a missing export.
# A basename clash is legitimate (the two sides of one feature usually share a
# word); resolving it by luck of loop order is not.
for f in ../../server/src/*.ts; do
  base=$(basename "$f")
  [ "$base" = "index.ts" ] && continue
  if [ -f "build/$base" ]; then
    echo "build.sh: server/src/$base would overwrite build/$base, already emitted by the app." >&2
    echo "build.sh: emit one of the two under a different name — see app-feedback above." >&2
    exit 1
  fi
done

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
