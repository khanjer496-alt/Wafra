# Boundary diagnostic — test-only, never ship

No run is authorized by this change. Reviewer and iOS Release must approve the
exact committed diff, then the CEO must authorize the single diagnostic run.
Shipping src/modules/targets/app metadata must remain identical to bbb11945.

## Evidence folded into the plan

Existing run 43597958325: applog-P3-around-buy-tap.txt:6–12 targets
`dev.wafra.purchaseuitests.xctrunner` and removes zero transactions; it does not
prove the AUT was reset. XCTest lines 722/1360/1729 report `Connection to daemon
interrupted` after the old restart stages. The old Swift setup created one
session. These are fixture gaps; none establishes why P3c billing was unready.
The old shell also wrote successful acknowledgements without checked config
copy/install results. P3c before/after screenshots map to false checkoutReady;
the guard can reject before the Restore SDK call. Full trace is in
Shared/launch-review/pr251-storekit-boundary-2026-11-14.md.

## Changed behavior

- Exactly one selected .app; read-only source/installed executable and JS hashes,
  bundle ID, code-signature identity, both synthetic config hashes/counts and
  daemon PID/status go to timestamped boundary.jsonl. Matching files expressly
  do NOT establish shared transaction control. No simulator private data is
  copied and no daemon is restarted.
- Host .done means the requested command plus strict file/identity/service
  observation succeeded. Missing/ambiguous/mismatched config, failed install,
  missing service or failed observation gets .failed and is never retried.
  .observed is only a processed marker. It never signifies success.
- Initial missing config is recorded but diagnostic still observes the app/UI.
  Actual Restore cases fail their own fixture row before tapping if config is
  invalid. Test readiness requires a real available plan, enabled Pro/Restore,
  no unavailable surface, and a hittable Restore. UI-ready is not an internal
  SDK trace; no shipping hook is added.
- Separate selectors: diagnostic -> testBoundaryDiagnostic; empty ->
  testRestoreEmpty (P3c); owned -> testRestoreOwned (P3b). Each has its own
  installation/setup. The positive no longer depends on the negative passing.
  Owned injection binding remains unproved unless the actual app Restore
  succeeds. A runner transaction alone never earns PASS.
- Existing log guards remain: same process/purchase filters, noise exclusions,
  -2..+40 second windows, bounded line lengths and first/last limits. Explicit
  INIT/DIAG/P3b/P3c stage markers now yield distinct windows (maximum 24).
  Raw native stream is not uploaded. Local UI trees contain synthetic data only.
- Empty acceptance is unchanged: real Restore -> exact no-purchase title/body,
  paywall/Pro-off, actions enabled and no crash. Owned acceptance unchanged:
  real Restore -> successful callback/Home -> positive Pro-active copy/no Buy.
  Both independently passing artifacts are required for build 195. A diagnostic
  or one selected case can never clear the combined gate.

## One bounded diagnostic-only run plan (not executed)

1. After both exact-SHA approvals and CEO permission, publish only that SHA to
   the dedicated `test/storekit-boundary-approved` branch. Working-branch pushes
   do not trigger this workflow. Push mode always selects diagnostic.
2. One disposable hosted macOS simulator, serial UI-test runner. Require exact
   existing app cache; cache miss stops without building the shipping app.
   Only the disposable UI-test helper compiles. Job hard bound 15 minutes;
   diagnostic process bound 360 seconds; host commands bound 15 seconds each.
3. Observe installed identity/config before/after fixture installation, after
   runner session creation, after app launch and at the paywall. Wait at most
   30 seconds for UI readiness; capture screenshots/hierarchy and guarded log
   windows on failure. Diagnostic does not clear transactions, inject purchases,
   tap Restore, change accounts, restart StoreKit, or copy simulator state.
4. Record failure/missing file/service state, with no fallback or retry. Upload
   boundary.jsonl, selected-row TSV, UI evidence, guarded log windows and exact
   XCTest exit. Return evidence before proposing any correction or further run.

The optional manual empty/owned selectors remain separately reviewable; neither
is included in this one diagnostic authorization. No automatic schedule exists.

## Validation limits

Swift syntax parse, bash syntax, workflow YAML and focused Python fault tests
only. No simulator, native app build, UI test, real account, hosted job or
publication is part of local verification. Full compile/runtime remains untested.
