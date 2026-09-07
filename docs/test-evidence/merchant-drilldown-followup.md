# Merchant identity taps and Activity handoff

Baseline: `01c9ddda17d79558930457fecdd3f6357739aa55` on `main`.
This report covers a local working-tree implementation, not a published build.
The merchant screens/projection and supporting tests were being implemented
concurrently; their work was preserved and tested together with these additions.

## Interaction

The shared transaction row gives the merchant identity and the individual
transaction separate sibling touch targets. Name/logo opens the merchant page;
amount/Details still opens the original inspect/edit sheet. There are no nested
buttons. Transfers retain the original single transaction action. Rows inside
the merchant page disable the self-link.

The merchant page inherits the shared reporting period and shows its exact
spending total, purchase count, approximate average when rounding is necessary,
and up to six recent transactions. The total and count cover all matching
transactions, not just the preview. View all transactions opens the existing
Activity route with the exact encoded merchant and `type=all`, preserving the
period and including incoming payments. Similar names such as Careem Business
are not combined with Careem on the strength of their logo or substring.

## Verification

- Complete repair/workflow source suite: 284 passed, zero failed or skipped.
- Application and server TypeScript checks: passed.
- Full ESLint and Ledger & Light design-baseline check: passed.
- Direct merchant journeys: English/light/390px and Arabic/dark/320px passed
  on a fresh web export. They exercise direct Home taps, six-row previews,
  period changes, the explicit all-type Activity handoff, exact credits,
  individual transaction details, and returning through a merchant identity.
- Merchant directory journeys: four English/Arabic light/dark scenarios passed
  on the same export, including exact totals, search, exclusions and periods.

`scripts/test/repair/merchant-entrypoints.test.cjs` and
`scripts/test/repair/merchant-preview.test.cjs` execute the actual components
with explicit OS/navigation/presentation boundaries. They are included by the
existing source-test glob. The browser checks are in
`scripts/e2e/e2e-merchant-entrypoints.mjs` and
`scripts/e2e/e2e-merchant-spending.mjs`.

Local execution logs are in `builds/merchant-drilldown-followup/`. Screenshots
and browser results are in `artifacts/e2e-merchant-entrypoints/` and
`artifacts/e2e-merchant-spending/`. Fixtures are disposable synthetic browser
ledgers; no personal inbox or device ledger was used.

Initial direct-browser attempts first reached a stopped local server and then
selected hidden, still-mounted navigation screens. The final selectors use
the active visible row and the final run passed without forced clicks.

## Explicit limits

The current total is gross spending. Incoming payments are presented separately,
not silently treated as refunds. The persisted transaction model has no reliable
refund classification or purchase relationship. Automatic refund deduction is
therefore not implemented; subtracting business payouts would be incorrect.

The bounded preview and memoized projections avoid loading every transaction
into the merchant screen and avoid ledger scans inside row rendering. These
checks do not measure physical-device tab latency or frame rate.

No APK/TestFlight release, store submission, production deployment or device
installation was performed in this follow-up. The local changes are not a
claim that the version installed on the phone already has this feature.
