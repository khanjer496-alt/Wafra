# Wafra reliability audit 30 September 2026

This audit follows the missed ADCB card statement and payment-reminder report.
It covers capture, interpretation, ledger changes, payment status, reminders,
storage, backup, and user journeys in the current canonical checkout.

The repeated failures have several concrete causes. A message can be interpreted
by different parsers depending on its capture route. Some financial status was
stored separately from the transaction that justified it. Some identity matches
were too weak. Finally, many tests proved that a screen opened or a helper
returned a value, without proving that the user's complete task succeeded.
The existing test count therefore overstated confidence in those boundaries.

All changes here are local and unpublished. The starting revision is
`566a9243d35ae19e51d149e6e2965daf92a3c66b` on `main`, with pre-existing dirty work
preserved. Concurrent iPhone setup-video work owns its dependencies, media and
setup-screen insertions; this audit owns the financial/capture fixes below.

## Confirmed failures and local repairs

| Failure | Evidence | Repair and regression |
|---|---|---|
| The reported card statement was rejected | The exact bank label `Total due to avoid fin. charges` returned no parse. Its receipt already parsed. | The exact total and minimum labels are recognized. The real statement/receipt pair is tested through card creation, due amount, settlement and replay without duplicate transactions. `parser.test.js`, `card-statement-reminder-flow.test.cjs`. |
| Captured statements did not reliably refresh reminders | Scheduling depended on launch/manual refresh; headless capture saved the ledger without scheduling obligations. Leaving during the idle grace could also lose the refresh. | Durable capture, foreground updates and departure refresh known obligations. Background work preserves existing subscription schedules. Paused history and paid-statement cancellation have behavior tests. `capture-payment-reminders.test.cjs`, `card-reminder-notifications.test.cjs`. |
| Review could turn a statement into spending | The same ADCB message reached generic Review as unknown; its total, minimum or late fee could be selected as a transaction. | Statement and settlement families remain distinct and ordinary transaction confirmation rejects them. Known parser facts survive a generic extractor miss. Unreadable totals remain unknown. Android unconfirmed-package and iOS notification Review share this structured adapter. `statement-review-safety.test.cjs`. |
| Native admission missed messages the parser understood | Existing Arabic-digit and invisible-direction-mark fixtures parsed in JavaScript but failed Android's native money gate. | Both native money-admission patterns accept those digits and separators while retaining the currency allowlist and credential exclusion. The regression runs the actual extracted patterns on the JVM. `native-money-admission.test.cjs`. |
| An unrelated bill receipt could silence a due | Equal amount and four account digits let an Etisalat receipt settle a DEWA bill. An old unit assertion also treated an unknown nickname plus matching digits as proof. | Require provider evidence as well as compatible identity. Preserve known aliases and explicit user aliases; ambiguous receipts leave the obligation and reminders open. `bill-provider-reconciliation.test.cjs`. |
| Estimate tolerance could mark an underpaid notice as paid | A payment below a bill notice's exact total was accepted by the generic 15% amount tolerance. | Retain the notice's stated due date so its total is exact for that cycle. Subscription averages and later cycles keep estimate behavior; they are not falsely promoted to bank-stated totals. Import, refresh and backup provenance are covered. `bill-provider-reconciliation.test.cjs`, `bill-payment-lifecycle.test.cjs`. |
| Deleting a manual bill payment left the bill paid | The generated expense could disappear while `paidMonths` survived. A bank receipt arriving during a confirmation sheet could also be followed by a duplicate manual expense. | New manual payments have a validated bill/month association. Removal or financial edits revoke its claim; cosmetic edits preserve it. Recheck reconciliation before adding a payment, including salary-month boundaries. Replacement ledgers retain their own associations. Legacy unlinked claims are not guessed from amounts. `bill-payment-lifecycle.test.cjs`. |
| An incomplete storage read could become the saved ledger | Missing, malformed or empty chunks could be skipped; hydration then reopened writes on the surviving rows. | Incomplete snapshots fail closed, retain stored bytes and keep writes blocked until a complete retry. Batch order cannot change chronology. Existing inline/legacy migration remains supported. `incomplete-ledger-read.test.cjs`. |
| Browser backup restore silently did nothing | Downloading a backup succeeded, but selecting it never opened confirmation. The navigation sweep still passed. | Read the selected local browser File, preserve native cache cleanup, and show browser errors inline. A permanent test verifies download, mutation, restore, reload and invalid-file rejection in both themes. `backup-picker-web-read.test.cjs`, `e2e-backup-restore.mjs`. |

The capture, ledger and storage changes were independently reviewed. Findings
from review were repaired with regressions, including the bank-payment race,
replacement-ledger links, receipt direction and empty storage bodies.

## Coverage and remaining qualification

| Area | Evidence in this audit | Boundary |
|---|---|---|
| Home, Spending, Bills, Accounts | Fresh browser suites; totals, periods, activity, controls and details; light/dark screenshots | Web rendering does not prove native frames, keyboard behavior or accessibility services. |
| Capture and Review | Parser/corpus, actual import/reducer tests, source-level lifecycle tests, JVM admission checks | Actual background delivery, permissions and process death still need a new native candidate and real devices. |
| Money and obligations | Cards, allocation, transfers, bills, reminder scheduling, manual edit/delete and restore checks | Ambiguous ownership stays unresolved; no balances or bank totals are invented. |
| Persistence and privacy | Encrypted-storage boundary review, failure/retry tests, backup validation, file ownership/cleanup | Not a cryptographic penetration test or a real mobile file-provider round trip. |
| Onboarding and setup | EN/AR browser flows, resumption/navigation, constrained viewports | Real Shortcuts, Apple Pay and notification automation require device proof. Concurrent video work has separate acceptance. |
| Assistant, subscriptions and analytics | Existing analysis/recurrence suites and browser journeys | The follow-up audit below resolves multi-account recurring-provider identity; real device qualification remains separate. |
| Billing and exports | Source review, plan/trial guards, restore validation, download and browser round-trip checks | No real App Store/Play purchase, refund, entitlement restore or live PDF-service qualification. |

The initial browser export passed all 22 existing suites, including navigation's
111 checks, 277 controls and 109 sheet openings. The new backup regression failed
that same export in both themes. That distinction is important: a tap sweep is
useful for crashes and routes, but cannot replace task-completion assertions.

## Verification results

| Check | Result |
|---|---|
| App suites | All 86 exercised. Two source contracts initially failed; the audit-owned spending rule and the separately owned video modal were corrected and their contracts passed on rerun. |
| Repair, workflow and iOS journey pass | 2,626 checks exercised, 2,617 initially passed. Nine failures were resolved: seven harness dependency/extraction updates, one reviewed restore-handler fingerprint, and one isolated host timing rerun. The full 2,626-check command was not repeated after these narrow repairs. |
| Final affected regression run | 89/89 passed across statement/receipt Review, capture/reminders, bill provider/lifecycle/provenance, storage, backup, native money admission and updated workflow gates. |
| Final accounting checks | Unit 833/833; import planning 351/351; bills 45/45; persistence/database 267/267; accounting pipeline 62/62. |
| Parser and bank corpus | 1,418 parser and 1,338 corpus assertions passed. Corpus percentages include synthetic/adversarial fixtures and are not a production miss-rate estimate. |
| Timing | Parser invariants 34/34 and ledger hot-path checks 9/9 passed separately after concurrent work finished. No thresholds were relaxed. |
| Universal and input safety | Both seven-suite universal groups passed, as did nonposting/money/evaluator checks, 24 numeric-input regressions and 33 onboarding action checks. |
| Typecheck and lint | App/server typechecks passed. Changed code has no lint errors; existing warnings remain in capture-hook dependencies and an existing import-plan array type. |
| Server | 255 assertions passed across push, import, schema and configuration tests. |
| Rebuilt browser acceptance | Backup round-trip 2/2 themes, smoke 65/65 and navigation 111/111. Restored 334 transactions per backup case, preserving monetary fields and expected legacy-title normalization. Invalid files leave the ledger unchanged. |

The native admission regression compiles and executes the actual regexes on the
JVM. The separate pure Kotlin policy checks reported an unavailable `kotlinc`;
this is not a complete Android build or phone delivery test. No new signed
native artifact was installed, and no physical phone was connected for this
audit. The iOS simulator was not booted.

Browser evidence and screenshots are in `artifacts/audit-journeys-20260930/`.
Verification summaries and selected logs are preserved in
`artifacts/full-app-audit-20260930/`; the complete command logs remain in
`/tmp/wafra-full-audit-20260930/`.

## Finding resolved by the follow-up audit

**Multiple service accounts at one recurring provider were grouped by
provider title.** A synthetic case with two E& accounts, each charged AED100
monthly on a different day, becomes one “as needed” projection of AED152.19 per
month. It loses the two distinct recurring schedules. This is a confirmed
projection limitation, not evidence of a wrong bank transaction or balance.

The follow-up implements a stable provider-plus-bill-identity key across
detection, reminders, details, widgets, and cancel/dismiss preferences. Its
behavioral and browser evidence is recorded in
[the continuation report](full-app-audit-2026-09-30-followup.md).

## Preventing repeats

- Keep exact reported messages as regression fixtures, with synthetic mutations
  explicitly identified. Test their capture and import paths, not just extraction.
- Assert financial invariants: a statement cannot become spending; one payment
  cannot settle another provider; removing payment evidence reopens its claim;
  partial reads cannot overwrite complete data.
- Preserve structured facts between parsers and Review instead of extracting
  them independently and accepting a weaker interpretation.
- Pair route/tap coverage with completed workflows: import to ledger to reminder,
  mark paid to delete to reopen, and backup to restore to reload.
- Keep host tests, browser proof, native build, installed version and physical
  delivery evidence separate. Passing source tests does not update the phone.
