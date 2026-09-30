# App performance audit — 29 September 2026

Source base: `main`, `566a9243d35ae19e51d149e6e2965daf92a3c66b`, verified against
the remote at task start. Existing marketing changes were preserved separately.
Implementation follows Expo SDK 55 / React Native 0.83. No release was published.

## Diagnostic evidence

The supplied Android build 355 report has 14,840 transactions and 44 accounts.
Ledger loading completed at 592 ms; first usable Home was recorded at 2,340 ms.
The JS responsiveness monitor recorded stalls of 4,591, 296, 2,424 and 550 ms.
Capture collection took up to 5,362 ms and daily-summary scheduling 2,391 ms.
Those operation durations include asynchronous/native waits and competing work;
they do not establish that the parser or summary calculation consumed that CPU.
The original report remains in ignored local artifacts, outside shipping source.

## Changes and acceptance checks

- **Transactions:** prepare search presentation only when a nonempty query
  reaches a row after its date/account/category filters. Keep each computed
  string within the mounted index and reuse it across keystrokes. Browsing a
  15,000-row ledger now performs zero search presentations. Full-history search,
  English/Arabic labels, exact amounts, split totals, transfer exclusions,
  salary-day boundaries and sorting retain their behavior.
- **Store currency guard:** short-circuit collection existence checks instead
  of allocating filtered copies on every store action. A synthetic 14,840-row
  transaction collection needs one row read instead of 14,840. Conservative
  legacy handling, zero/negative/nonfinite values and denomination rules remain
  unchanged.
- **Bills on iOS:** use the existing cooperative subscription detector after
  interactions and two frames, without Android's additional four-second grace.
  Share completed analysis, cancel obsolete jobs and keep known obligations
  usable. Pending detection is explicitly labeled in English and Arabic instead
  of presenting an incomplete total or empty agenda. Android retains its prior
  scheduling policy and also receives the honest pending state.
- **Home:** cancel pending insight analysis on blur. Ledger changes while Home
  is hidden are analyzed on return; unchanged tab round trips do not repeat a
  completed analysis.
- **Diagnostics:** separately measure synchronous source-key collection,
  worldwide inspection, parsing and daily-summary projection. Only allowlisted
  tags and numeric timing aggregates enter diagnostics; no new source text or
  financial data is recorded. Parsing and scheduling decisions are unchanged.

## Paired host benchmark

Synthetic mixed ledgers; Node 22.22.3 on this Mac, not Hermes or phone frame
times. Alternated original and modified source in one process, discarded two
warmups, then took the median of nine runs. Times include index creation.

| Rows | Scenario | Before | After |
| ---: | --- | ---: | ---: |
| 15,000 | Create transaction index | 20.61 ms | 2.17 ms |
| 15,000 | Browse current month | 15.48 ms | 1.86 ms |
| 15,000 | Search current month | 14.00 ms | 2.84 ms |
| 15,000 | First full-history search | 19.00 ms | 18.96 ms |
| 30,000 | Create transaction index | 24.31 ms | 2.64 ms |
| 30,000 | Browse current month | 24.66 ms | 2.84 ms |
| 30,000 | Search current month | 22.84 ms | 3.55 ms |
| 30,000 | First full-history search | 33.00 ms | 34.11 ms |

Full-history search is effectively unchanged: it still has to prepare every
eligible row once. The improvement is avoiding that work when it is unnecessary.
An initial getter-based experiment slowed that scenario and was replaced before
acceptance with plain indexed records and explicit lazy lookup.

Reproduction and JSON results are in ignored
`artifacts/performance-20260929/search-benchmark.cjs` and `search-benchmark.json`.
Permanent behavior/count regressions live in `scripts/test/repair/`, not artifacts.

## Verification and limits

New regressions were observed failing against the original source before fixes.
Independent read-only review found no remaining actionable issues after the
Bills pending-state correction and hidden-Home reference-release check.

- App/server typechecking passed; the last Home adjustment also passed a fresh
  app typecheck.
- Full lint: zero errors, 18 existing warnings. Focused final lint retains the
  existing Home FX-effect dependency warning; no new warnings were introduced.
- The 65 affected screen regressions passed, including all eight scheduling,
  pending-state and cancellation cases. Money-presence, search and diagnostic
  regression checks passed.
- Fresh final production-web export passed. All 11 large-ledger UI checkpoints
  passed with 15,000 synthetic transactions, no browser errors and an exact
  checked Ask Wafra monetary answer. Screenshots were inspected locally.
- The broad navigation sweep initially passed 14 checks across Home, Spending,
  Bills and Accounts, then timed out on a Transactions re-entry. Isolated entry
  passed nine times against each of the original and modified exports. The
  original helper ignored a failed coordinate tap; that entry now uses a unique
  semantic button locator with actionability checks. The exact original failure
  could not be reproduced. The final full rerun passed **111 checks, zero
  failures**, including Transactions, settings/data screens, drilldowns,
  search/filter/back navigation, language switching and live theme changes.
  It reported no page errors and no right-edge text clipping.

The initial host timing gate was run alongside a Metro export and exceeded five
timing budgets. Its isolated pre-change rerun passed all nine checks. This is why
the paired benchmark above, not the loaded-machine run or browser automation
latencies, is used for the before/after comparison.

The full `npm test` command passed native compilation, native suites, universal
evidence and server checks, then stopped at an isolated capture test loader that
did not yet recognize the new timing import. Both isolated loaders now load the
real compiled timing module. Two source-spelling performance checks were also
replaced by the executable first-paint/Android-grace assertions in the screen
suite. After rebuilding the test modules, the complete application portion of
`scripts/test/run.sh` was rerun, with the final result below.
Native source and server source did not change during these test-harness fixes.

Final resumed application gate: **86 app suites, 2,542 regression checks, the
numeric-input regressions and 33 onboarding checks passed** (exit 0). This uses
the current runner's full application section, not a curated subset. All nine
large-ledger host-budget checks passed, including 15k/30k screen steps, capture
planning/application and cooperative recurrence. The earlier full run separately
passed all three server suites and the three native Swift suite entry points,
including the iOS debug build/metadata/resource checks. The initial `npm test`
invocation itself exited at the fixture error; these phase results should not
be described as a single uninterrupted green invocation.

Evidence logs: `artifacts/performance-20260929/{full-test,app-suite-final,
navigation-final,typecheck-final,app-typecheck-final,lint,lint-final,
lint-test-adjustments}.log`. Final web screenshots/results are in `ui-final/`.
Only this audit's preview servers on ports 8137–8139 were stopped; the existing
development server on 8081 was left running. Changes remain local and uncommitted.

No Android device was connected and no iOS simulator device was configured.
Browser checks and native store unit tests are not physical-device performance
proof. In particular, this work does not claim the supplied report's 4.6-second
freeze is eliminated. A fresh phone run should check cold launch, background
capture, tab switching, Bills, transaction drilldowns/search and the new phase
timings against that report.
