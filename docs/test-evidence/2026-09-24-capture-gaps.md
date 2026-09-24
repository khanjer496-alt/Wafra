# Capture, review-capacity and statement gaps · 24 September 2026

Branch `claude/capture-gaps-20260924`. It closes the known limits recorded in [2026-09-24-ios-capture-finish.md](2026-09-24-ios-capture-finish.md) and the statement-import review findings.

## Apple Pay ↔ bank alerts

- **A near match goes to Review instead of posting a second row.** This applies to a bank SMS or bank-app notification near an unbound or bound Wallet row: same account or compatible card, same amount, expense, within ±10 minutes, with any merchant text. Each collector durably stages the Review item before acknowledging the source. If Review refuses the item, the alert posts as before, or waits in the iOS queue.
- **"Already recorded" on a flagged SMS binds its identity to the Wallet row** (`walletBound`). A rescan after the Review record expires never posts it again.
  - Notifications are not bound.
  - Bound rows stay in the near-match net but out of the loose title and time matching.
  - They still pair one-to-one with a statement row for the same purchase.
- **"Add" asks first.** Adding a flagged alert asks for an explicit "Add as a separate purchase" against bound or strictly bound rows. A Wallet review also asks against a manual row with the same account, amount and day.
- **Held-back alerts leave no trace.** They create no account, hint or balance snapshot until they are posted.

## Review capacity

- **Foreign-currency reviews have their own lane of 50.** They never hold up capture. Overflow is counted as "other-currency alerts not kept".
- **Evicted money reviews are counted.** Every money-movement review evicted from the Message lane (relay, History, Android) leaves a durable `evicted` tombstone and appears in the Review count. A later re-read of the same alert restores it.
- **History import no longer silently trims** money-movement review candidates to 50.
- **iOS capture pages past held records** using a native exclusion list, so newer purchases behind held reviews are captured.

## Statement import

- **Card-statement signs:** a card statement's bare minus sign is never read the account way unless a legend says so. Rows that stay ambiguous are refused and counted.
- **Statement vs alert, and statement vs statement:** both match one-to-one by day, amount and direction.
  - Statements with no identified account also need a compatible bank and a shared merchant word.
  - Each file has an opaque import id, so overlapping statement uploads don't duplicate.
- **Card settlements:** statement card payments are read as transfers onto the card, not as spending or income.
- **Multi-file imports:** they finish every file, report the result of each, pace uploads within the server limits, and always record coverage.
- **"No gaps":** it is never claimed for statements that name no account; those show "Coverage unknown".
- **Upload disclosure** appears above the Choose button. Picker copies are cleared.
- **Smaller fixes:**
  - A re-upload within 72 hours says "already processed".
  - Plurals are correct in both languages.
  - Files where every date could be read either way are refused outside day-first ledgers.
  - Today-dated rows get deterministic timestamps.

## Verification

- `tsc` is clean and the full JS suite (the Darwin native block run separately) exits 0.
- The native history, live-capture and queue-signal host suites pass.
- Each stream was reviewed independently. A final integration review found two blocking issues, both fixed with regression tests that fail without the fix:
  - a statement row next to a bound Wallet row was being added a second time;
  - a test disagreed with how the tray records expiry.

## Still open

- **Undercounted evictions:** more than about 1,000 evictions within 90 days would undercount the eviction figure, because tombstones are capped.
- **Plain Amex-style CSV card exports without a preamble** are still read the account way.
- **Card settlements:** the card-statement and account-statement payment rows both show as transfers, but are not paired as one settlement.
- **A near-match notification and its SMS** that are both held back become two Review items.
- **Physical iPhone execution** is still unproven, as recorded in the earlier evidence.
