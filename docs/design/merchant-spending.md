# Merchant spending

The merchant experience extends Claude's Ledger & Light baseline. It does not
change theme tokens, launcher assets, fonts, parser rules, import storage, or
the four primary tabs.

## Entry points

- Tap a transaction's merchant name or logo to open its merchant summary.
  The sibling amount / Details target retains the original receipt and edit
  flow. There are no nested pressables and no merchant links on transfer rows.
- Transaction details also offer View merchant spending when not editing.
- Spending offers a searchable Spending by merchant directory. Merchants are
  sorted by total spending. Existing Trends merchant rows open the same summary.

## Summary and filtering

The summary shows exact spending for the selected reporting period, the number
of spending transactions, and the average transaction amount. An average that
needs rounding to a minor currency unit is marked approximate; totals are never
rounded. Incoming money is shown separately when present.

The shared reporting-period picker supports months, ranges, years and all time.
Changes apply consistently to the merchant directory, summary and subsequent
transaction ledger. The preview shows up to six recent matching records;
Spending / All activity selects what is previewed. View all transactions opens
the full merchant-filtered ledger with an explicit `type=all` request, preserving
credits that the legacy expense-only merchant drill-down would otherwise hide.

## Financial boundaries

Merchant identity is the trimmed, case-insensitive recorded title, consistent
with existing merchant totals. Logos, partial search terms and inferred brand
affiliation never merge financial identities. Search filters the directory;
opening a result selects its exact identity.

Totals use the shared `isSpending`, `isIncome`, `countsInTotals`, live-account and
internal-transfer rules. Transfers, card settlements, hidden accounts and
unknown accounts do not inflate spending. All activity may display those rows
with an exclusion note. A split purchase is counted once at its full merchant
amount. Foreign purchases use the converted minor units already in the ledger.
No refund relationship is inferred from a title or an incoming payment.

## Responsiveness and accessibility

Financial projections are memoized by their actual ledger and period inputs,
not import-progress messages or search keystrokes. Search is deferred and runs
against the already grouped merchant list. Both new routes use a virtualized
list, existing safe-area/header controls, bundled offline merchant marks,
wrapping amounts and localized English/Arabic copy. Loading is shown rather than
a fabricated zero before ledger hydration. The merchant preview cannot navigate
back to itself through its own rows.

## Verification

Focused synthetic tests live in `scripts/test/repair/merchant-*.test.cjs`.
`scripts/e2e/e2e-merchant-spending.mjs` exercises real browser navigation,
name/receipt targets, search, period changes, exact cents, incoming-money
separation, explicit all-type handoff, and light/dark English/Arabic layouts.
The normal browser test runner includes this suite. Existing merchant-logo and
Trends navigation checks target the new entry points without losing their
amount, route, image-decoding or offline assertions.

Evidence for this implementation is machine-local under
`builds/merchant-spending-evidence/` and `artifacts/e2e-merchant-spending/`.
Browser and synthetic storage tests do not establish physical-phone frame rate.
No new APK, TestFlight submission, public deployment or persistent user-data
operation is performed by implementing this feature.
