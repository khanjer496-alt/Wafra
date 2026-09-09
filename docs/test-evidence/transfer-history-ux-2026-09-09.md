# Transfer history: optional browsing instead of a backlog

The owner reported a Home notice showing 3,106 transfers and multi-million-dirham
pending totals, followed by an impractical list of old entries with little
identifying context. This change is based on main `130b3bb` in the recovered
current-main checkout. It does not change the transfer reconciliation engine,
parser, transaction amounts, account identities, stored decisions or totals.

## Interaction changes

- Home keeps a compact, neutral disclosure that unclassified transfers are
  outside totals. It no longer presents their large monetary sums as a task list.
- Transfers opens with the explicitly labelled Last 90 days browsing scope.
  All history remains available. This is not an import, retention or accounting
  cutoff; the entire history remains recorded and searchable.
- Groups and their entries are ordered newest first. Groups start collapsed,
  and expansion reveals at most 20 entries before an explicit Show more action.
- Search uses a reusable index of account, title, amount, date and bounded bank
  reference fields, not raw messages. The full-history suggestion respects the
  same query. Deferred search keeps input updates separate from result rendering.
- Account endings are not appended again when the saved display name already
  ends with those digits. The underlying account name is never rewritten.
- Source type and stored reference are available when an entry is opened.
  Leave unclassified closes the panel without writing or dismissing a record.
- Bulk classification still requires the original confirmed counterparty group
  and the atomic resolver's validation. Filtering only selects visible members;
  it does not create permission to classify unknown recipients together.
- Ordinary classification keeps the user in the current list. Explicit entry
  links remain entry-specific, including old records outside the recent scope.

## Verification

Typecheck, lint and the Ledger & Light design guard passed. All 71 application
suites passed, alongside the existing repair/workflow/onboarding tests and new
presentation tests. No monetary or security assertion was removed.

The real Expo web export passed transfer browsing/decision/backup/undo checks
in English/light/320, Arabic/dark/320, English/dark/390 and Arabic/light/390.
Each uses 3,106 synthetic historical records plus recent fixtures. The tests
verify that old records remain saved, the recent view excludes them only from
display, all history can find them, expansion is bounded, and leaving a record
unclassified does not mutate its decision. Eight Home cashflow browser cases
and four transaction-detail layout cases also passed.

Logs and actual browser screenshots are in the local ignored directory
`builds/resume-20260908/transfer-ux-20260909/`. These are synthetic browser
checks, not proof of native-phone speed, rendering, real-inbox recognition or
the correctness of the owner's historical totals. The independent review worker
could not start because the connector did not identify this conversation.

This source change by itself does not publish or install an APK, submit a new
TestFlight build, update the landing page or alter either iOS Shortcut.
