# Global categorization policy

The category core is bank-independent and country-independent. Its inputs are
an extracted merchant, transaction direction, explicit financial meaning and
the user's decisions. A country may refine vocabulary; it is never required.
Missing/non-Gulf context uses the shared global vocabulary, not the device's
active UAE/Saudi preference. Existing category IDs and stored amounts are unchanged.

## Interface

```ts
categorizeMerchant(input): CategorySuggestion
suggestUniversalCategory(event, options?): CategorySuggestion
categorySupportsType(categoryId, transactionType): boolean
scopedMerchantOverrideKey(merchant, transactionType): string
readMerchantCategoryOverride(overrides, merchant, transactionType): CategoryId | undefined
```

`CategorizationInput` accepts `merchant`, `type`, optional `meaning`, optional
source `market`, `manualCategory`, flat `overrides`, and directional `rules`.
Meanings include purchase, refund, own-transfer, card-payment, cash-withdrawal,
fee, salary, business-income and unknown. Meaning must come from source facts
or a deliberate user decision, not a company suffix in the merchant's name.

The result contains `merchant`, `category`, `source`, `reason` and `needsReview`.
It does not contain source message text, amounts or a numerical confidence score.
The event helper needs only the safe retained event fields; it does not need
the discarded message body. It must not be imported back into `sms-parser.ts`:
it reuses that module's existing merchant-vocabulary classifier.

## Decision policy

- A valid per-transaction manual category remains authoritative.
- Refunds, own-account transfers, card payments and fees remain neutral Other
  unless the user deliberately categorized that transaction. A payer-wide
  Salary rule cannot turn a source-proven refund into salary.
- Valid directional merchant rules precede automatic merchant activity and
  aliases. Conflicting same-direction rules remain unresolved. Exact names
  precede canonical aliases within a rule tier.
- Unknown incoming money remains Other; a personal payer or payment-processor
  company suffix is not evidence of Salary or Business income.
- Explicit seller activity can correct a misleading brand match. Protected
  local trading companies are not software services because their names contain
  Fiverr, Adobe or LinkedIn.
- Payment processors do not identify what was purchased. A known seller behind
  an explicit processor prefix keeps its category; an unknown seller remains
  unresolved. Cleanup exhaustion cannot restore a processor-based guess.
- Known exchange houses and wallets cannot become groceries or phone bills
  because of a regional brand stem. Shared merchant evidence works globally.
- Canonicalization must not erase the evidence needed to preserve a category.
  If a short alias loses that information, retain the original merchant
  descriptor for this suggestion; user-defined alias rules still work.

The local activity vocabulary includes examples in English, Arabic, French,
German, Spanish, Italian, Dutch, Portuguese, Hindi, Japanese and Chinese.
Unsupported words and conflicting activities remain unresolved. This is not a
claim of exhaustive language, merchant or item-level coverage.

Opaque platforms need a user category when the item/service is absent.
[Fiverr describes a marketplace for a wide range of freelance services](https://help.fiverr.com/hc/en-us/articles/360010558038-How-Fiverr-works-for-clients),
so its name alone does not establish Software. Likewise,
[Klarna documents payment methods](https://docs.klarna.com/acquirer/klarna/web-payments/additional-resources/payment-method-grouping/),
which do not establish the goods category. A user can save their own appropriate
category for these providers. A category proposal alone never proves that a
payment is a cancellable subscription.

## Directional rules and Other

Other is selectable for both income and expense without adding a new category
ID. The base metadata/display fallback remains compatible; use
`categorySupportsType` for validation rather than comparing only `meta.type`.

New keys use `expense:<trimmed lowercase merchant>` or
`income:<trimmed lowercase merchant>`. Both decisions can coexist. Scoped keys
take precedence; legacy plain keys retain their original direction semantics.
In particular, a legacy Other rule remains expense-only, while scoped income
Other is valid. Unknown IDs never gain validity through the Other display fallback.

Host integration must pass transaction direction when remembering or bulk
applying a rule, preserve scope when rekeying aliases, and keep “Just future”
from silently rewriting history. Apply-all updates existing rows explicitly;
rescans must not broaden a future-only choice. Historical source-proven refunds
must be able to leave Business while hand-edited rows remain protected.

## Evidence

- Existing category suite: **104 passed**, including eight new policy checks
  observed failing before their respective implementations.
- Dedicated global category suite: **80 passed**. Initial implementation had
  33 failing cases; later review controls also failed before their fixes.
- Two owned TypeScript modules: zero strict no-emit diagnostics.
- Scoped lint and whitespace checks passed.
- Independent review caught and corrected laundry context, harmless financial
  provider suffixes, protected marketing names, lossy canonicalization,
  processor cleanup bounds, domain aliases and lowercase notification misuse.

Run the dedicated suite without a shared build:

```sh
node scripts/universal-test/categorization.test.cjs
```

Existing-source integration is coordinated with the main task. It owns current
parser/healing/store/UI changes, full combined checks and final native builds.
This task owns only `categories.ts`, its test, the new category module and its
dedicated test/documentation. No commit or push is performed independently.
