# Local Ask Wafra analysis

Build useful financial exploration without an LLM or new network service. Work
from current main (`cd02355` at start); the running release candidate is frozen
at that commit and this phase remains separate. English first; additional
localization is deferred. Preserve unrelated work; commit or publish only with
explicit authorization.

## Design

Keep the shared ledger predicates, exact minor-unit amounts, evidence, session
invalidation and period boundaries from the first Ask upgrade. Add pure analysis
modules receiving already-scoped records. Typed local findings carry exact source
IDs and appear as reviewable cards. A finding never changes ledger records.

The query contract adds category/merchant sets and exclusions. Within one
dimension included values form a union; dimensions intersect; exclusions remove
only the selected allocation of a split. Follow-ups retain all active filters.
Unknown entities, unsupported predicates, or ambiguous grouping still clarify.

## Owned work

- Query/executor worker: `src/lib/wafra-assistant.ts`, optional focused query or
  filter module, and `scripts/test/wafra-assistant.test.js`.
- Spending analysis worker: new `src/lib/assistant-spending-analysis.ts` and its
  focused source tests. Exact category/merchant drivers, counts and source sets.
- Pattern worker: new `src/lib/assistant-patterns.ts` and its focused source
  tests. Comparable recurring changes, unusual purchases, possible duplicates.
- Root: assistant finding/coverage presentation, copy, typed boundary validation,
  build/test registration, browser acceptance, documentation and integration.

## Acceptance

- [x] Query examples work end to end: spending excluding rent; dining and
  groceries together; two named merchants/accounts; keep those filters when
  comparing or asking about another period. Every displayed total reconciles
  to contributing allocations and records, including USD/JPY/KWD.
- [x] Spending explanations identify category and merchant contributions to
  the change and purchase-count differences, with current/prior proof. The two
  breakdowns are alternate views, never summed together.
- [x] Recurring changes compare comparable prior charges with the latest
  recorded charge in the requested period. Show both increases and decreases;
  don't infer a merchant price change from currency conversion or usage alone.
- [x] Unusual purchases need sufficient earlier history for the same merchant
  and account. Do not use future records in a baseline or imply fraud.
- [x] Possible duplicate candidates need same merchant, account, amount and
  compatible currency/time evidence. Missing timestamps, transfer/settlement
  counterparts and different accounts must not become duplicate accusations.
  No automatic deletions or reconciliation changes.
- [x] Coverage reports observed dates/record and account counts, import status
  and unavailable baseline data. No-activity dates do not prove missing imports,
  and completed import does not prove complete financial coverage.
- [x] Guided suggestions lead to supported queries and preserve context.
  Finding-level transaction evidence remains local and becomes stale after edits,
  day changes or ledger replacement, matching existing safety behavior.
- [x] Focused regression tests, typecheck/lint and independent read-only review
  pass (62 focused checks).
- [x] Seven English browser scenarios passed at 390px light theme: five unchanged
  initial cases and two targeted reruns after the merchant-followup fix and
  recurring-baseline fixture correction. Native keyboard, dark theme and 320px
  remain outside this phase browser qualification.

Thresholds are conservative, currency-independent product heuristics, covered by
fixtures. They are not confidence probabilities or guarantees of missing/duplicate
charges. No new dependency, account, paid service, notification or LLM is needed.
