# Parser and import accuracy investigation — 5 September 2026

The user reported wrong balances/card dues, missing or duplicate transactions,
and wrong amounts, merchants, or categories. This pass investigates the existing
UAE/Saudi pipeline and fixes reproduced defects. It does not establish an
accuracy percentage for the user's inbox or add new bank/country coverage.

## Reproduced defects and changes

1. **Account identity lost in a real format.** The supplied FastPay fixture says
   `Account ending with 2501`. The parser returned no instrument; it now retains
   account tail `2501`. The existing four-digit requirement remains intact.
2. **Merchant name truncated.** The supplied `PRASERT ON-PUTTHA` descriptor was
   cut to `Prasert`, because `on` was treated as a date introducer inside the
   hyphenated name. The full name now survives; a following `on <date>` still
   terminates the descriptor. The category remains unknown rather than guessed.
3. **Different purchases collapsed.** Two equal purchases at the same merchant
   on different cards, 30 seconds apart, could collapse during import and again
   during ledger reconciliation. Source instrument evidence now distinguishes
   these captures independently of the account selected for display. Ordinary
   duplicate matching also respects incoming versus outgoing money.
4. **Unattributed balance assigned to a fallback account.** An alert with an
   incomplete/missing account tail could overwrite the first account's balance.
   A fallback routing choice is now non-confident: it cannot supply a bank
   snapshot or move an existing transaction to that account during a reparse.

`captureInstrument` retains only the parsed four-digit tail, the closed
instrument kind, and optional normalized bank identity. It contains no raw
message or full account number. It is optional for existing ledgers. Missing
source evidence preserves legacy matching behavior; edited display accounts
are not substituted for source evidence. Backup restore validates the field.

Parser version advances from 29 to 30 to permit existing guarded rescan/healing
paths to revisit retained history. This does not recover unavailable messages,
merge old orphan accounts, or automatically reconstruct previously overwritten
balances. User-edited transaction details remain protected.

## Verification

- Parser regression tests were observed failing on the prior implementation:
  947 passed / 3 failed. The two extraction fixes then passed 950 / 0.
- Bank corpus after the extraction fixes: 1,338 passed / 0 failed.
- Parser invariants after the extraction fixes: 32 passed / 0 failed.
- Eight malformed capture-identity backup tests failed before validation was
  added. With validation, the database/restore suite passed 190 / 0.
- Final fresh build and focused suites: import-plan 210 / 0; accounting-pipeline
  42 / 0; database/restore 190 / 0; unit 748 / 0. Integration includes real
  materialization, reducer reconciliation, JSON round-trip, and reconciliation
  after reload: two AED 89.50 purchases on different cards remain AED 179.00.
- All 66 JavaScript suites declared by `scripts/test/run.sh` were executed
  individually against the fresh build, with invariants first. **65 suites
  passed; `ios-setup-ux` had 219 passing and 5 failing assertions.** The five
  failures concern existing English/Arabic setup/help copy: unavailable bank
  senders, Apple's one-time choice and timing, pending handoff progress, and
  instructions to keep the phone unlocked. This pass did not edit those UI,
  translation, or setup-test files. The parser 950 / 0, bank corpus 1,338 / 0,
  interpreter 52 / 0, and semantic matrix 985 / 0 passed in this wider run.
- `npm --prefix server test` passed all four declared server suites: push 16,
  imports 31, schema 48, and deploy 15 assertions.
- `npm run typecheck`, ESLint on all changed source/test paths, and
  `git diff --check` passed.
- Independent read-only review found two defects in the initial duplicate fix
  (reversed capture order and reconciliation after import). Both were fixed
  and independently reprobed. Final review reported no actionable findings
  in this scope.

The stock `bash scripts/test/run.sh` was attempted before the import fixes. It
passed the initial invariants and 348 native history-store behavior assertions,
then exited at Xcode's React-Core-prebuilt **Copy XCFrameworks** build phase.
The script's retained console output does not establish the underlying cause.
The filesystem had less than 1 GB available when inspected afterward. This is
not a passing native/app-build result.

## Remaining accuracy work

- The corpus contains unresolved and truncated merchant names. The invariant
  report's approximately 15% unresolved-category figure is **not** a transaction
  accuracy rate, and adding self-authored examples is not evidence of bank
  coverage.
- Synthetic malformed-money probes show that unsupported numeric punctuation
  or excess precision can be partially read (for example, `AED 1.234,56`).
  A follow-up should reject the entire malformed transaction amount without
  falling through to a fee or foreign-currency amount. Local two-decimal money,
  three-decimal foreign currencies, statement totals, and snapshots need
  separate regression coverage before changing that shared extraction policy.
- Temporary-hold merchant descriptors need authoritative posting evidence;
  a merchant name alone must not suppress a real settled transaction.
- Further card-dues/category accuracy claims need redacted failing messages
  with expected outcomes, including bank sender, capture channel, and event
  time where available. No new unsupported grammar or merchant category is
  asserted here.

The home-screen concept should continue to avoid foregrounding account cards
until balance provenance and freshness are clear. This pass changes parser and
import behavior only; it does not implement a home-screen redesign.
