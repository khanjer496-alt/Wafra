# Android performance: fresh code audit

The user requested an app-wide performance review with Android as the priority
and explicitly requested **no phone testing**. This work uses code inspection,
actual-source host regressions and synthetic production-web checks. It makes no
claim about Android frame rate, touch latency, thermal behavior or native memory.
The iPhone has not been qualified.

Source: task worktree based on `e560a07e`, retaining the preceding uncommitted
local-AI integration. The canonical dirty checkout was preserved.

## Confirmed costs and changes

1. **Background work competed with ordinary interaction.** Sending diagnostics
   started an extra AI inbox sweep (up to 40,000 messages / 10,000 queued model
   windows). That side effect is removed. An explicit QA API remains available.
   Background inference now respects navigation priority and inactivity;
   reset/opt-out cancels old work and releases queued windows. Inbox preprocessing
   yields after at most five rows or eight milliseconds between checks.
2. **Optional inference delayed notification admission.** Live notification
   collection awaited shadow scoring before producing its import batch. It now
   queues the optional work. A controlled unresolved-model regression proves the
   scanner still returns the correct AED 123.45 candidate, while native ACK
   remains deferred until the explicit durable commit callback.
   Extra parsing performed only for shadow metrics is now skipped when inactive
   or model-unready: SMS and notification regressions both verify zero redundant
   inspections instead of one. Required universal parsing remains unconditional.
3. **Initialization could compete with the first screen.** Optional model warmup
   waits for hydration/fonts and an idle window. Lifecycle/navigation checks
   separate preparation phases; interactive callers promote the same flight.
   All sibling artifact tasks settle before a retry can reuse their file paths.
   In-progress native operations remain non-interruptible.
4. **Import finalization discarded a useful reconciliation memo.** Already sorted
   normalized arrays now retain identity. Unchanged finalization computes one
   transfer graph instead of two; changed transfer links still require the
   second pass. Stable sorting and financial output are preserved. See
   [import evidence](2026-09-23-import-finalization.md).
5. **Category history scanned every row six times.** Ordered month buckets now
   accumulate in one pass. The 30k regression reads 30k dates instead of 180k,
   with equivalent salary-month, split and exclusion results. See
   [category evidence](2026-09-23-spending-analytics.md).
6. **Home relied on transaction-array changes to refresh transfer totals.** The
   identity-preserving import optimization exposed a missing dependency on the
   transfer receipt. Home's projection and insight now observe receipt IDs,
   version and history completion, while ordinary progress counters stay cheap.
   A real-projection regression verifies AED 0 becomes the correct AED 123.45
   when a provisional exclusion ends, with unchanged transaction/account arrays.

## Broader audit and costs left unchanged

Reviewed startup/store updates, Home, Spending categories/activity/trends,
transactions/search/sorting, merchant detail, Bills, Accounts, Ask Wafra,
capture/history finalization, persistence and optional AI diagnostics.

The current app already virtualizes long lists, bounds Home/Spending previews,
freezes hidden Android tabs, defers recurrence work on Android, caches transfer
receipts and account activity, and avoids rewriting unchanged storage chunks.
Those mechanisms were retained.

Seven-sample medians on fresh immutable arrays in host Node/V8:

| Operation | 15k rows | 30k rows |
| --- | ---: | ---: |
| Home first money projection | 0.91 ms | 0.96 ms |
| Spending trend analytic functions | 5.99 ms | 12.44 ms |
| Transaction index construction | 1.43 ms | 2.67 ms |
| First current-month largest sort/projection | 1.27 ms | 1.34 ms |
| First current-month oldest sort/projection | 2.14 ms | 6.01 ms |
| Merchant detail projection | 0.42 ms | 0.93 ms |
| Cold card-payment rows | 9.79 ms | 11.58 ms |
| Ask suggestion generation | 2.19 ms | 4.52 ms |

The fixture contains ordinary manual spending/income, category splits, 44
accounts and archived-account exclusions. It has **no statements, bills or
transfer evidence**; it does not measure populated payment/settlement paths.
Those retain their separate existing financial stress suites. A separate warm
card-payment-row check measured about 0.9 ms at both sizes, so no new cache was
added. These figures exclude React rendering, native I/O, startup module loading
and device execution. Fast host results cannot rule out a phone bottleneck.

Reproduce with:

```sh
node scripts/performance/android-code-audit.cjs /tmp/wafra-code-costs.json
```

The saved `initial-code-costs.json` contains a category-trend sample collected
**after** its one-pass fix. It must not be used as that feature's before baseline.
The other listed calculations were unchanged at measurement time.

## Verification approach

Controlled source tests verify task ordering, cancellation, single-flight
preparation and deterministic operation counts. Financial tests compare actual
outputs and preserve the required second reconciliation when links change.
The large-ledger browser scenario verifies loaded tab content and an independently
summed spending answer; action times include automation overhead and are not
Android timings. A highlighted tab over an empty body is explicitly rejected.

Outstanding device-only measurements are deliberately outside this requested
pass. The remaining full finalization graph and storage serialization still have
synchronous phases; this work removes proven duplicate work, not every possible
long task. Model accuracy qualification also remains separate from performance.

## Final verification

- App/server typecheck passed. ESLint has zero errors and 18 pre-existing warnings.
- All 79 app test suites passed. After the final shadow-only inspection gate,
  the source-loaded repair/workflow/journey run passed **1,300 tests**; the
  updated notification suite passed all 24 cases, including cold/active states.
- Numeric-input regressions passed 24 cases; onboarding actions passed 31.
- Independent review checked financial memo invalidation, unchanged sorting,
  cancellation, interactive preparation promotion and sibling artifact settlement.
  No outstanding review findings remain.
- The final Android Hermes JavaScript export and production-web export succeeded.
  This is bundle validation, not a signed APK or installed-device result.
- The final 15,000-record browser scenario passed all **11 checks**, with no
  page errors and the independently summed **AED 12,699.55 / 870 transactions**
  answer. Main-tab screenshots were inspected for actual loaded content.

Evidence remains local under `artifacts/performance-ui-before/`,
`artifacts/performance-ui-after/` and `artifacts/performance-verification/`.
No phone or iPhone testing was performed. Changes remain uncommitted; no push,
release or installation was performed.
