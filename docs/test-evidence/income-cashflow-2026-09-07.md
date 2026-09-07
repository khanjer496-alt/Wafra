# Home cashflow and retained-income repair

Base: main `3cb9b7b`. All bank-alert examples used here are synthetic or existing
repository fixtures, not the owner's newly reported missing messages.

## Home

The selected reporting period now shows Money out, Money in and Net. All three
figures come from the same dashboard projection; Net is income minus spending,
not an account balance. Money out retains spending accounting: own transfers and
credit-card settlements are not counted a second time as purchases. The two
drill-downs still open the income ledger and spending breakdown. Zero recorded
income is labelled as such, rather than a claim that the user received nothing.

The existing Ledger & Light palette, W-arrow, fonts and open divider-based layout
are retained. Positive, negative and zero net amounts retain their signs and exact
minor units. Arabic, dark/light appearance and stacked large-text layouts remain.

## Reproduced defects and repairs

1. A legacy SMS entry already filed as income/Business but named Incoming transfer
   was not retitled when its source was reread as a named Talabat settlement. The
   stale transfer flag could be cleared while the generic name remained eligible
   for pairing with an unrelated equal-value outgoing transfer. The repair now
   retains a source-proven, non-generic business payer, without creating a new row
   or changing the amount, account or date. User-edited entries and user-owned
   names remain protected by the repair guards.
2. A completed card-purchase reversal could be interpreted as a reversal of an
   income credit by the semantic layer. A bounded, purchase-clause-specific guard
   preserves the existing parser's proven refund result. Reversed salary credits
   and refunds explicitly taken back remain outgoing; failed/future alerts do not
   become income. No Talabat-name-only income rule was added.

Parser version 34 requests the existing retained-Android-history reread so the
fixes can reach previously imported, parser-owned rows. It is not an erase or a
fresh import of duplicates. Source-identical replay is tested as a no-op. Recovery
still requires the original messages to remain available, appropriate permissions
and completion of the normal capture flow. User-owned corrections are not undone.

## Verification

- Application and Worker typechecks and repository lint passed.
- All 71 application test files passed; Worker and numeric-input suites passed.
- All 273 repair, workflow and iOS-journey tests passed together, including ten
  payout/period/repair cases, nineteen capture-direction regressions and seventeen
  Home cashflow cases.
- The old business-title assertion failed against the unchanged pre-fix healer;
  all ten payout cases passed after recompiling shipping modules.
- Eight actual browser Home cases passed: English/Arabic, light/dark, 320/390 px;
  visible and accessible amounts agree, Net reconciles, controls navigate and
  complete figures are not clipped.
- The existing four-tab/route browser sweep passed 41 checks without JavaScript
  page errors. Actual synthetic-demo screenshots were visually inspected.

Known Talabat settlement examples already parsed as business income before this
change. Numeric, ISO and named settlement-period suffixes did not reproduce an
incorrect posting-month bug. Those successful tests do not prove the owner's
specific missing payment is the same case.

## Limits

The supplied screenshot shows September spending and zero recorded income, but
contains no bank-message text. No Android phone was connected during this audit.
The exact missing SMS, sender and received date are still required to establish
the personal cause; account numbers and references can be masked. Period filters,
archived accounts, unfinished imports and review-only alerts must also be checked.

This evidence covers source and synthetic browser/logic checks, not a new signed
APK, TestFlight submission, physical-device performance or an already-repaired
installed ledger. Build 135 predates these changes.
