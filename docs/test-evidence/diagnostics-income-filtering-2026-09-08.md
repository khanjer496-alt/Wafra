# Diagnostic export, unresolved business income and filtering

Base: `7574b21284ff14b6b24e780c0740b8de9188102e` on canonical main.

## Account attribution

Parser version 35 requests a retained-history reread. A proved business receipt
without a readable account is stored under a reserved unassigned-income identity,
not dropped and not attributed to the first real account. This identity is not a
bank account, is never a balance/snapshot target and cannot participate in inferred
own-account transfer pairing. It counts as income, appears in activity with an
Account needs review label, and can be isolated using the account filter. The
ordinary edit sheet lets the owner assign its actual account.

An existing parser-owned partial-mask receipt may be repaired only through the
existing guarded source-identity path. User edits and recorded instrument evidence
are preserved. No hidden account is unarchived and no account balance is inferred.
Synthetic accounting cases cover empty/active/hidden account sets, exact
source replay, protected prior assignments, real instrument snapshots and transfer
exclusions. These reproduce the supplied message structure without publishing the
owner's account or reference identifiers.

## User-controlled export

Settings → Privacy & data → Export data for diagnosis opens a consent sheet.
Preparing and sharing are separate actions. The report includes all recorded
financial periods, hidden accounts, ledger rows, splits, bills, goals, dues, category
rules and hints, history progress, current review data, monthly reconciliations,
current logo IDs/reasons, and flags for missing accounts, exclusions, invalid
categories/amounts, duplicate source identities and retained-text parser differences.

Authentication stores, signing keys and tokens are not read. Serialization uses
an explicit field allowlist, not a spread of AppState. The file itself contains
sensitive financial data, so the sheet warns before preparation and sharing.

Raw message text is opt-in and unavailable in Private Mode. The optional Android
read uses the normal credential-filtered inbox API, not the unfiltered corpus API.
It exports only recognized bank senders with money evidence, omits credential
challenges, validates the date/ID cursor, and never imports rows, moves the capture
watermark or acknowledges notifications. Coverage limits, unavailable original
messages and unknown sender evidence are stated in the file. The iOS path can
include retained ledger text only; it does not claim access to the Messages inbox.

Cancellation, unmount, backgrounding, ledger replacement or a privacy change
invalidate preparation/sharing. Generation and serialization yield between chunks;
the serialized report has a bounded UTF-8 size. The existing file-sharing helper
owns temporary-file cleanup. There is no automatic relay, email or AI upload, and
the report is explicitly not a restore backup.

## Filtering and logos

Transaction search strings, category labels and salary-month keys are indexed
once per ledger/language/month-boundary revision. Each sort is reused for that
immutable index. Filtering, grouping, exact totals and exclusions share one pass.
Deferred filter values allow controls to update first, with an explicit updating
state and no final result claim while pending. No worker-thread claim is made.

Parity tests compare the old and new results over 12,000 synthetic rows, English
and Arabic, calendar and salary months, all sort/date choices, split categories,
merchant/SMS filters and exclusion states. Local benchmark output is recorded in
`builds/diagnostic-release-20260908/`; it is not an Android frame-rate measurement.

Logo matching now rejects control/bidi strings, detects conflicting normalized
aliases and trims only separate location/terminal suffixes. Punctuated hosts or
paths cannot become a known logo merely by stripping a location or number. The
112-brand offline catalogue and tested explicit aliases remain intact. No new
merchant identity or category was guessed from the unshared real ledger.

## Verification and limits

Before release, 71 application suites, all repair/workflow/iOS journey tests,
server and numeric suites, types, lint and the design-baseline check passed.
New browser checks verify consent, preparation without download, deliberate file
sharing, full recorded-period coverage, and raw-text-off defaults in English/dark
and Arabic/light layouts. Existing transaction UI, Home and merchant entrypoint
browser cases also passed. Exact final source/build CI is reported separately.

No Android phone was connected. No private inbox or full real ledger was extracted
or audited during this implementation. Physical-device responsiveness, actual
permission dialogs and the owner's specific restored ledger require the installed
build and/or the resulting manually shared diagnostic export. Ledger & Light
assets, typography and native encryption configuration are preserved.
