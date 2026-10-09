# Launch and resume: what runs in the first frames (2026-10-05)

Report (Android release APK): "every time I reopen the app it lags, then the
animation comes but not smoothly." The fixes below keep the reopened window's
first frames for the UI and move Home's coin motion onto the UI thread.

## What changed

| Cause | Fix | Where |
|---|---|---|
| `InteractionManager.runAfterInteractions` is a `setImmediate` in RN 0.83, so Home's "deferred" projections (insight, recap, recurrence lookup, widget snapshot, transfer queue) ran the tick after commit, on top of the entrance | `runAfterFirstFrames`: two real frames, a 120ms settle, then the foreground lease. Home holds the lease (`prioritizeForegroundNavigation(1_500)`) while its ledger first appears and whenever it becomes visible, so deferred work waits for the entrance. Bills, Transactions and Data & help use the same helper | `src/lib/after-first-frames.ts`, `journal-home-screen.tsx` |
| Coin staggers were `Animated.delay`/`sequence` (JS timers): each coin's native spring started only when a JS timer fired, about 50 timers in 0–900ms, delivered late and in clumps on a busy JS thread | One native-driven clock per group (`Animated.timing`, linear ms). Each coin is `coinTrack(clock, …)`: its target plus a clamped window of the clock shaped like the spring it replaces (`springCurve` samples Animated.spring's closed form and rest thresholds). Coins that do not move are plain values | `coin-motion.ts`, `coin-stack.tsx`, `reference-home-summary.tsx` (day columns), `ArrivingRow` |
| Every resume reset Home's clock, and `now` keyed the widget sync, so each reopen rebuilt the snapshot and called the synchronous native `setSnapshot` (prefs write + every widget redrawn) | The sync is keyed on the projection day (and the ledger inputs, custom category labels included). `createWidgetSnapshotSync` skips a write whose content (ignoring `generatedAt`) equals the last one this process stored, unless the native copy was cleared since or 3 hours passed (`WIDGET_REWRITE_AFTER_MS`, which only bounds `generatedAt` within one long-lived process). A same-day reopen therefore never re-stamps the widgets; a new day is new content (`todayISO`), and the widgets drop a snapshot whose `todayISO` is not today. A write the native side refused (Android answers false, e.g. without a React context) is not remembered, so the next request writes again; iOS answers nothing and counts as stored | `widget-sync.ts`, `modules/wafra-widgets/index.ts` (JS only: a clear counter and the native answer) |
| Headless bank captures landed in the live store while paused and started arrival/coin motion that Android froze and finished in clumps | `useAppActive()`; coin and arrival motion run only in the foreground. A change committed while away lands at its final value and counts as shown; a run in flight when the app leaves lands at its end. A provider hint received while away is read 1.2s after resume, not in the first frames | `src/hooks/use-app-active.ts`, `use-auto-import.ts` |
| The Superwall provider switched the element type above the app when `available` flipped at hydration, remounting the router, lock, onboarding and toasts as Home appeared; configure (with paywall preload) ran then too | One tree shape; the SDK provider sits beside the app and publishes its billing value (cleared when that runtime unmounts, e.g. Erase everything). Onboarded launches configure after Home's first frames + 2s; the Pro screen configures at once if opened earlier | `superwall-billing-provider.native.tsx`, `docs/billing.md` |
| The splash hid at fonts-ready, then "Loading ledger", then Home popped in | The splash stays until one frame after the hydrated tree commits (Home, onboarding, recovery or the lock), with a 4s fallback; Home's coins start a frame after the hide | `src/lib/launch-splash.ts`, `app-root-layout.tsx` |
| Home's saved layout loaded after mount, re-laying out and remounting coin sections | The root reads it beside hydration; Home's first render uses `peekHomeWidgetPreferences()`; post-mount setters go through `startTransition` | `home-widgets.ts` |
| App Lock: the coin reveal played invisibly behind the lock and unlock rebuilt the transfer queue in the same tick | `useHomeRevealReady()` (lock cleared, foreground, splash gone) holds the first reveal; the transfer queue is cached by its inputs | `journal-home-screen.tsx` |

Home's recurrence lookup is the one deferred task that does not wait for the
lease before it starts. A cached answer (Bills, a reminder or widget sync, the
last visit) is read with Home's first commit; otherwise Home starts or joins
the one shared cooperative scan after its first frames. The scan already waits
for the lease between its 6ms slices, so only one slice runs during the
entrance and a large ledger still finishes after it. Waiting out the lease and
then a fixed 1.5s first made Due payments arrive about 3 seconds after Home and
push Coming up down; a small ledger now has its rows with Home's first
frames (`screen-background-work.test.cjs`).

Transactions defers only its first transfer separation (the push animation);
a later ledger change on the open screen recomputes on the next turn
(`runSoon`), as `runAfterInteractions` did.

## Trade-offs

- **60fps coin clock on Android.** A native `Animated.timing` on Android is
  frame-based: JS samples the easing at 60fps and the native
  `FrameBasedAnimationDriver` picks the frame for the current time without
  blending between samples. On a 90/120Hz phone the coin clock therefore
  steps at 60fps, while the old per-coin native springs computed every
  display frame. The trade is deliberate: those springs started from JS
  timers that fired late and in clumps on a busy JS thread, which is the
  stutter reported; a steady 60fps run on the UI thread is smoother in
  practice. Reanimated was not used for the coins because of the existing,
  measured Android motion bypasses that rely on core Animated. Needs a device
  check on a high-refresh phone.
- **Entitlements a little later.** On an onboarded launch, Superwall's
  entitlement refresh and its standard placements arrive about 2 seconds (plus
  the foreground lease) later than before; the stored Pro flag stands until
  then (see `docs/billing.md`).
- **Interrupted coin runs restart, they do not reverse.** A level change while
  a stack is still moving lands every coin at its previous target and starts
  the new run from there, where the old per-coin springs reversed mid-flight.
  Visual only; the figures are never drawn from the coins.

Not changed: the fixed maintenance graces in `use-auto-import.ts` (5s resume
scan, 6s first scan, 8s reminders, 9s digest, 10s notification recovery) are
already a second apart and each waits on the foreground lease; they are
pinned by `perf-config.test.js`. Parsing and import semantics are untouched.

## Tests

`scripts/test/repair/launch-resume-performance.test.cjs` (one clock per coin
group, no JS timers, background/lock/splash gating, interrupted runs landing,
the deferral helper's frames and lease, widget rewrites, the splash, the
transfer-queue cache) and `superwall-attribute-loop.test.cjs` (tree shape
across hydration and configure).

## Still to check on a device

These assertions count work; they do not measure frames. On a mid-range
Android phone with a large ledger, record a Perfetto trace of a cold launch, a
warm reopen and an App Lock unlock and confirm: no long JS task inside the
first ~1.5s after Home appears, the coin drop-in on the UI thread with no
dropped frames, no `setSnapshot`/widget redraw on a same-day reopen, the splash
going straight to Home, and Superwall's configure/paywall preload after the
entrance. Also check the splash fallback on a ledger slow enough to exceed 4s.

## Follow-up (2026-10-08): the transfer graph at 15k rows

A tester diagnostic export (build 376, OnePlus CPH2653, 14,905 rows, 44
accounts, 3,131 transfer candidates of which 2,940 unanswered) showed launch
phases were fine (ledger loaded at 403ms, Home usable at 853ms from JS start)
and the lag came after Home: JS stalls of 5.5s, 944ms, 465ms and 410ms, a
6.4s `capture-save`. Profiling a ledger of that shape (synthetic
`scripts/test/fixtures/transfer-heavy-ledger.cjs`) on the web export at 6x CPU
throttling and in a Hermes CLI put the transfer graph build at the centre of
three paths: Home's transfer queue after its first frames (the one long task
after a cold launch), every transfer answer (reducer `normalizeTransferLinks`)
and every canonical capture (`applyMaterializedImportBatch`).

| Cause | Fix | Where |
|---|---|---|
| One graph build validated each row's transfer evidence and decision about six to ten times (regex and currency checks), and checked candidacy twice per row | Validation verdicts are memoised for one synchronous pass only (`withPassCache`), keyed by the validated object and dropped in `finally`; exported validators stay uncached outside a pass | `transfer-reconciliation.ts` |
| `bankIdentityForName` tested every bank pattern and ran a Unicode-property regex on each call, about 5,700 calls per graph build for five distinct names | Bounded memo (512 names) over the fixed `MARKETS` packs | `markets.ts` |
| Home's transfer queue ran the graph and the activity walk over the whole ledger in one task after a cold launch | The graph is built in ~6ms slices (`transferReconciliationForStateInSlices`, yielding to the foreground lease between slices), then the activity walk runs in its own slice two frames later. Transactions' deferred recompute uses the same sliced build; its first mount still reads the graph synchronously, which is a cache hit once Home's build has filled the receipt cache and a full build otherwise. Same cached reconciliation, so the queue is unchanged | `journal-home-screen.tsx`, `transactions.tsx`, `ledger.ts` |
| The graph build could only run to completion | Its phases are written once as resumable steps (`contextSteps`, `reconcileSteps`, ...), drained in one call by every synchronous caller (reducer, import, Transfers' render) and stepped by `beginTransferReconciliation`; callers asking the same question share one build (for a final receipt the question is the receipt, so an edit that keeps it joins the running build); a build nobody waits for pauses and keeps its progress until a different question replaces it; only the build for the current question fills the caches; a build that throws is dropped, reported, answers its callers' `failed`, and the next request starts over | `transfer-reconciliation.ts`, `ledger.ts` |
| Every mounted entry sheet (11 hosts) and Transfers built its own id index of the whole ledger on mount and on every ledger change, open or not | One index per ledger snapshot (`rowsByIdFor`, WeakMap keyed by the array) | `rows-by-id.ts`, `entry-detail-sheet.tsx`, `transfers.tsx` |

Measured on the transfer-heavy 15k ledger (Hermes 0.12 CLI on a desktop core,
best of three; a phone is slower):

| Step | Before | After |
|---|---|---|
| Graph build (launch queue, cold rows) | 416ms | 242ms |
| Transfer answer (decision, normalize, reconcile) | 504ms | 272ms |
| Capture apply, card purchase (canonical) | 645ms | 382ms |
| Capture apply, incoming transfer (canonical) | 617ms | 418ms |
| Transfers activity incl. graph | 596ms | 386ms |

Sliced build on the same fixture with stored decisions (Hermes CLI): longest
slice 7–9ms over 44–47 slices, 262–284ms of work in total against 274–294ms
for the one-shot build. The one-shot path the reducer and imports use costs
about 5–7% more than the plain functions did (generator stepping), still well
under the pre-speed-up times. `transfer-graph-hot-path.test.cjs` pins every
part of the result (assessments, groups, internal, pending and corroborating
ids, card repayments) to the pre-speed-up build's digests, for the plain
fixture and one with stored decisions, card repayments and doubled postings.

The graph output is byte-identical to the pre-change build on that fixture
(`transfer-graph-hot-path.test.cjs` pins its digests). Not changed: what is
reconciled, when Home's queue runs, the canonical capture path and the
persistence layer (writes were already per changed chunk; a capture rewrites
one chunk).

Still to check on a device: the 5.5s stall and the 6.4s `capture-save` are
larger than anything reproduced here at this scale; they include native
awaits and may come from the first launch after an update (the recent
re-read), so compare a second launch's diagnostic export
(Settings → Data and help → Send test diagnostics, whose
`performance.runtimeJs` carries `lagOver100Ms`, `recentStallsMs` and the
per-operation timings, and whose `parser.recentRereadVersion` says whether
the 14-day re-read after a parser release has completed) and record a Perfetto trace of
a capture on the 15k ledger.
