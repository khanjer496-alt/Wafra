# Performance fixes integrated with the current release

Base: `c7860ddd` (iPhone setup and custom categories already merged). This change
ports the performance work documented in `2026-09-29-app-performance.md` onto
that base. The older note describes its original local validation, not a new
physical-device or release qualification.

The merge preserves custom categories throughout Bills and transaction search.
Search text remains lazy, including labels from split categories. Home's
completed insight cache includes the custom-category catalog, so renames trigger
fresh analysis without repeating unchanged tab round trips.

Changes include lazy transaction search, short-circuit ledger-presence checks,
cooperative native Bills analysis and its truthful pending state, cancellation
of hidden Home insight work, and source-free timing of capture/summary phases.
No new parser decisions, monetary rules, native permissions or backend changes
are introduced. Homepage/research work and old build/media artifacts are outside
this performance merge.

Local integration validation: app typecheck passed; 76 focused money, screen,
presentation and diagnostic checks passed; performance contracts passed 108
checks, relay contracts passed 311, iOS capture contracts passed 446, and
20 lazy-search/custom-category consumer checks passed. Scoped lint has zero errors and the
existing Home effect dependency warning. Independent read-only review found and
then verified the custom-category cache fix. Additional search/catalog, capture
and browser checks are recorded in the PR as they finish; CI is required before
merge. These checks do not establish phone frame times or eliminate the reported
4.6-second freeze without a fresh physical-device diagnostic.
