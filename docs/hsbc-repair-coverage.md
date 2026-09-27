# Shared-user statement and ledger repair verification

Initial validation recorded 2026-09-27 against base
65a9fc949501f1ba60e7e27b948b26f65a997214. Repository integration is recorded in
Git history; merging this change is not a server deployment or an app release.
This report records source-level checks, not production or device certification.

## Shared scope

No production rule selects a customer, transaction ID, exact reported amount or
card suffix. The terse HSBC TO-card grammar compares that statement's labelled
full card identity ephemerally. Only the last four persist in body-free capture
metadata. This is a supported HSBC text/PDF format, not proof that every TO-number
credit at every bank is a repayment. Bank-channel classification, legacy repayment
matching, safer statement overlap and readable display are shared code paths.

## Additional defects found and repaired

1. Merchant-prefix matching could merge Amazon with Amazon Cafe or Netflix with
   Netflix Car Rental at the same amount/date. A matching phrase now permits only
   bounded branch/legal/location extensions; unknown extensions stay separate.
2. Zero-decimal money made the final TO-card digits look like a second amount.
   An exact, source-labelled HSBC receipt now bypasses that ambiguity guard;
   actual amount-plus-running-balance rows remain rejected.
3. Active-country bank lookups discarded explicit source hints outside that
   registry, such as HSBC on a SAR ledger. Explicit bank identity now survives
   market changes. Unknown senders still do not invent a bank.

## New coverage

The statement-all-users.test.cjs repair suite adds 62 cases. The normal test runner
already includes it through its repair-test glob. Real parser, planner, reducer,
accounting predicates, presentation and money formatter are executed.

- Three synthetic card identities and varied amounts, including one minor unit.
- AED, SAR, USD, EUR, JPY and KWD with zero-, two- and three-decimal precision.
- HSBC, ADCB, FAB, Emirates NBD, Al Rajhi and Chase identity labels; distinct Arabic
  bank names; different-bank cards sharing the same last four digits.
- Legacy payment before statement, statement before legacy payment, reimports,
  genuine equal-value repeats, and PDF/CSV provenance with privacy on and off.
- A separate actual CSV-reader check for explicit receipts, refunds and fees.
- Protected manual edits, splits and ownership decisions; incompatible merchant,
  account, bank, card, direction and date; unknown-source and balance ambiguity.
- English/Arabic Android/iOS component branches at normal/large text, using the
  actual money formatter. Native primitives are substituted by the test harness.

Bank identities use synthetic source shapes and explicit metadata. This does not
certify all real formats from those banks. Component tests are not physical-device
rendering or notification-delivery tests.

## Observed validation

- Combined affected integration/UI selection: 259 passed, zero failed or skipped,
  including all 62 newly added cases.
- Fourteen selected core suites passed. Twelve report 4,696 assertions; the
  money-display and money-locale suites also passed without numeric summaries.
- Server push/import/schema/deploy-guard suites: 255 assertions passed.
- App and server TypeScript checks and the compiled test build passed.
- Changed app-file lint: zero errors and one existing Array<T> style warning.
  Root lint excludes the server file; its ignored-file warning is not a lint pass.
  Server typechecking and executable tests passed.
- Git diff whitespace checks passed.

Local logs are named all-users-*.log in Git's metadata directory. No full remote CI
run or physical-device smoke test was completed. Independent worker review was
attempted but the configured model was rejected before a reviewer started.

## History and rollout limits

Existing transactions gain display-only labels when rendered by the updated
client. Stored amounts, dates, identities and classifications are not rewritten
by presentation. Historical accounting repair requires retained source evidence or
an unambiguous compatible statement match; user decisions remain protected.
Missing source text is never reconstructed from amounts or generic titles.
PARSER_VERSION is 56; PARSER_BACKFILL_VERSION remains 49. This is not a blanket
migration of all old transactions or an automatic unmerge of lost source data.

Before shipping, confirm the complete source and tests are on active main, run the
normal CI gates and Android/iOS upgrade/import smoke tests, and obtain read-only
review. Release both server parsing and client reconciliation/display changes.
One side alone does not deliver the complete fix. Stage rollout and verify the
supported fixtures before broad delivery; code rollback cannot be assumed to
reverse already imported financial classifications.

At the initial audit and integration check, the two active-project folder
approvals reported missing/changed roots. The accessible repair checkout matched
the latest remote main and can publish the reviewed changes without replacing
files in an unavailable local checkout. No customer-ledger mutations were made.

## Pre-merge preparation

The first full root test attempt stopped at a missing generated iOS intent file.
Running the same iOS prebuild step used by CI generated those fixtures without
changing tracked manifests. The full root test command was then restarted.
App/server TypeScript, full root lint and diff whitespace checks passed on the
integration source. Independent worker review was retried, but the saved worker
model setting was still rejected before a reviewer started; do not treat that
attempt as an independent approval.
