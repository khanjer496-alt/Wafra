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

- Exactly one selected .app; read-only cached-app/installed executable and JS hashes, build/short versions and cache provenance,
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
  invalid. Restore UI readiness is independent of weekly-offer or Buy availability. A configured
  zero-offer surface with price retry is valid; the install-from-store hint is
  separately reported as UI_BILLING_NOT_READY_CAUSE_UNKNOWN. Host identity/config
  failure has its own category. No shipping hook is added.
- Separate selectors: diagnostic -> testBoundaryDiagnostic; empty ->
  testRestoreEmpty (P3c); owned -> testRestoreOwned (P3b). Each has its own
  installation/setup. The positive no longer depends on the negative passing.
  The shipping onboarding surface cannot independently prove pre-tap Pro-off or
  the Restore call/result. Rechecks after observation exclude navigation/tap races,
  but owned UI success is recorded only as P3b-UI; P3b stays UNPROVEN/non-PASS.
  App QA device evidence owns the real positive gate; Home+Pro never proves binding.
- Existing process/purchase and noise guards remain with -2..+40-second windows
  and first/last 120-event limits. Public native/INIT/DIAG output is structured
  allowlisted categories only; sensitive header/token/receipt/JWS/customer/account
  lines are excluded entirely. No raw SDK messages or UI hierarchy are published.
  Public TSV preserves only known row IDs/verdicts and fixed descriptions.
  UI snapshots export known boolean fields. Maximum 24 checkpoint windows.
  If public export fails, both artifact upload and table publication are blocked.
- Empty acceptance is unchanged: real Restore -> exact no-purchase title/body,
  paywall/Pro-off, actions enabled and no crash. Owned acceptance unchanged:
  real Restore -> successful callback/Home -> positive Pro-active copy/no Buy.
  Both independently proven cases are required for build 195, with positive
  causal proof supplied by App QA. A diagnostic, UI-only success or one selected
  case can never clear the combined gate.

## One bounded diagnostic-only run plan (not executed)

1. After both exact-SHA code/plan approvals, obtain CEO authorization for a
   **temporary test-only PR** from `test/storekit-boundary-approved` into the cache
   owner `test/purchase-proof-pr251`. No PR/branch/label has been published by this
   change, and no production PR is duplicated or merged. Publishing the branch,
   opening the PR or synchronizing it cannot start this workflow. After verifying
   the PR head still equals the approved SHA, CEO separately authorizes one
   `run-reviewed-boundary-diagnostic` label event. Checkout pins the immutable PR
   head SHA from that event. Only this same-repository, exact named source/base
   route and label are accepted; the case is fixed to diagnostic. The inherited
   broad CI workflow excludes only this non-shipping test base, so opening the
   proposed PR cannot silently start the full application suites. Main/release
   PR and push checks remain unchanged; do not merge this diagnostic PR into a
   shipping branch. Other path/label-gated workflows match no changed shipping
   files and the proposed diagnostic label is not device-shots. This narrow
   test-base exclusion is part of the code/plan review, not an execution grant.

   The old dedicated-branch push proposal is superseded: live read-only cache
   evidence found ID10523176508/key `app-lock-sim-app-v3-ec3a930937cc50f5fd5f0664d1b1f080535ac1e72d69e387c0eac6b846d5d216`
   under `refs/heads/test/purchase-proof-pr251`, inaccessible to a sibling push.
   [GitHub cache restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)
   allow a pull-request run to restore its base branch's cache. This uses that
   documented read path; it never rebuilds, seeds, copies, moves or bypasses cache
   access. Recheck cache availability before approval; any eviction/miss stops.
2. One disposable hosted macOS simulator, serial UI-test runner. Require exact
   existing app cache; cache miss stops without building the shipping app.
   Only the disposable UI-test helper compiles. Job hard bound 15 minutes;
   diagnostic process bound 360 seconds; host commands bound 4 seconds each, all independent probes share 16 seconds,
   output gets 2 seconds (18 total versus the 30-second acknowledgement).
3. Observe installed identity/config before/after fixture installation, after
   runner session creation, after app launch and at the paywall. Wait at most
   30 seconds for UI readiness; capture screenshots/hierarchy and guarded log
   windows on failure. Diagnostic does not clear transactions, inject purchases,
   tap Restore, change accounts, restart StoreKit, or copy simulator state.
4. Record failure/missing file/service state, with no fallback or retry. Upload
   boundary.jsonl, selected-row TSV, UI evidence, guarded log windows and exact
   XCTest exit. Return evidence before proposing any correction or further run.

The empty/owned script selectors remain independent and separately reviewable;
neither is exposed by this diagnostic-only label route or authorized to execute.
No working-push auto-run or automatic schedule exists.

## Validation limits

Swift syntax parse, bash syntax, workflow YAML and focused Python fault tests
only. No simulator, native app build, UI test, real account, hosted job or
publication is part of local verification. Full compile/runtime remains untested.

## iOS specialist correction at 715e5eec

The 715e5eec verdict was NOT OK (full relay07855db0). This revision separates
Restore readiness from purchase catalog readiness; marks unavailable UI cause
unknown independently of host config failures; rechecks foreground/paywall/tap
after observation; refuses to infer pre-tap Pro-off/Restore causality; replaces
raw public text with allowlisted exports and sensitive-line fault tests; and
collects independent identity/config/daemon failures within the total budget.
Cache provenance labels expressly do not claim cached .app source-commit proof.
The specialist accepted the conservative F2 disposition in adf9ae40, not this
new SHA or any run. Renewed exact-SHA approval is still required.

## Latest exact-a1889fea findings

Exact iOS708a9a2e and Reviewer10c451bf were NOT OK. This revision computes the
unchanged full cache key once in a step after checkout, validates the64-hex
digest, and shares the same key between restore and observer provenance. It
never uses hashFiles in job env (GitHub's context table permits it in steps).
Public text publication now strictly validates its own JSON event/stage schema
and is idempotent: two passes preserve daemon/XCTest/INIT/Restore evidence
without allowing extra payload fields. The zero-offer negative check branches
on actual offer availability, not disabled Buy existence; Restore plus usable
retry/free controls are required when no offer is selected.

Both application preflight gates remain distinct: e-paywall.tsx125 may reject
before billing.restorePro; superwall-billing-provider.native.tsx443 may reject
before SDK restorePurchases. SDK Restore entry/result and the later
verifyProEntitlement result are separate UNKNOWNs without an existing observable.
A no-tap diagnostic only observes readiness/config lifecycle; no log absence,
file/PID match or successful UI outcome proves these calls or shared binding.
Apple documents one shared test environment; runner-local reset/control logs
do not establish a two-session architecture. Any observed daemon interruption
invalidates reuse of earlier session observations. Missing lines remain UNKNOWN.

Build versions and cached/installed hashes are observed; cache producer source
commit, active AUT StoreKit mode, and binary Superwall/runtime identity remain
UNKNOWN unless independently evidenced. Harness/source metadata must not be
relabeled as cached-binary provenance. The final build195 candidate still needs
independent evidence that it contains #251, and simulator StoreKitTest must not
be called developer-signed sandbox or TestFlight proof. No release-ready
conclusion or hosted-run permission is implied by this diagnostic revision.

## Exact-b6a2abcd review and cache plan correction

Reviewer368b764a gives diagnostic CODE REVIEW OK at b6a2abcd. iOS e633fcf6 closes
code findings but rejects the old one-run cache route. The proposed label-only
PR/base-cache plan above is a local correction requiring fresh exact-SHA code/plan
review and explicit CEO permission for any publication and one run. Existing
code approval is not reinterpreted as permission to create the test PR or label.
