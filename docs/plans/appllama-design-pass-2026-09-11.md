# Wafra app-design pass — 11 Sep 2026

This pass applies the product-design principles we selected from the Appllama workflow while preserving Wafra's Ledger & Light identity and leaving parser, reconciliation and capture semantics untouched.

## Product rules

- First-run value before personalization: onboarding goes from a concise promise to the platform-specific start choice. The interactive sample remains available, but is no longer a gate.
- Android and iPhone keep distinct setup paths. Android owns SMS permission/history import; iPhone owns Apple Shortcuts/local capture and optional history.
- Progress must be factual. Android shows counts supplied by the real scan. iPhone keeps its explicit limitation where Apple does not expose live Shortcut progress.
- Goals and budget style are optional and never block the first useful ledger.
- One visual hierarchy: Ledger & Light, restrained surfaces, hairline separation, no decorative dashboard-card expansion.
- One transaction row, one primary tap. Merchant analytics is reached from transaction detail instead of competing with the detail target.
- Home leads with the reconciled period facts In, Out and Net. Account balances remain in Accounts.
- Spending keeps category share percentages and a scannable proportional bar; category detail and limits remain progressive disclosure.
- Bills has two user concepts: Upcoming and Recurring. Recurring groups subscriptions/utilities/other repeat commitments; Upcoming is for unpaid dues.
- Motion explains state changes only and remains suppressed for reduced-motion users.
- 44pt/48dp targets, scalable text, RTL and accessible labels stay release requirements.

## Deliberate non-changes

This pass does not alter SMS parsing, transfer ownership/reconciliation, ledger arithmetic, deduplication, iOS local-capture protocol, history paging, storage or subscription entitlement logic. Those areas currently have parallel launch work and should not be coupled to a UI refactor.

## Acceptance

Fresh install should reach the platform setup choice without interacting with sample data. A user can still open the sample voluntarily. Home exposes In/Out/Net without a dominant balance-style hero. Transaction lists have a single predictable row target. Bills switches cleanly between Upcoming and Recurring. Existing Spending percentage composition remains visible. Focused onboarding, cashflow, bills, transaction and design-baseline checks must pass before a release build is considered.
