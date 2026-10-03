# Readable transaction labels

`src/lib/transaction-presentation.ts` is a read-only presentation layer used by
transaction rows, entry details, the merchant header and transaction search.
It is not an import classifier or a duplicate identity function.

## Boundaries

- Stored titles, source markers, transaction IDs, amounts, dates, categories and
  transfer decisions are unchanged. Merchant links and category rules keep using
  the original stored merchant key. Search also indexes the displayed wording.
- Bank channel prefixes can be removed from a displayed merchant name. Unknown
  names and branch numbers remain; truncated legal names are not guessed.
- Manual descriptions and user-corrected names are not cleaned automatically.
- A credit-card repayment label requires an already excluded transfer with a
  settlement role or explicit legacy card-payment title. A `TO <number>` credit,
  a generic bank credit or a credit-card refund is not sufficient evidence.
- Repayments use a neutral unsigned figure and say that they are not spending
  or income. This does not change the stored debit/credit direction.
- A banking-channel-only description says that its purpose is not confirmed.
  This does not remove the transaction from totals or resolve its ownership.
- Statement rows show their recorded day without presenting a synthetic import
  clock as the time of a purchase.
- The list keeps exact minor units, like the detail sheet, instead of rounding
  101.75 to 102. Large text can wrap/stack rather than ellipsize the figure.
- Where the displayed title differs, details show the recorded description with
  long identifiers masked. Retained source text is also masked for display.
  Nothing reconstructs bank text or merged-source provenance that was never saved.

## Tests

The normal repair-test glob includes `transaction-presentation.test.cjs`.
It executes the current TypeScript source, real accounting predicates and actual
row/detail components using explicit native/UI substitutes. It covers statement
prefixes, payment roles, unknown credits, protected names, Arabic, exact amounts,
masked identifiers, source text, navigation keys and search. It does not claim
on-device rendering coverage.
