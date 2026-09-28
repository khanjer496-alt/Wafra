# Transfer review selection

The review screen offers explicit selection of suggested pairs and individual
pending entries. “Select all shown” covers matching pair cards and the individual
entries currently expanded in the list. Collapsed groups and rows behind “Show
more” are not implicitly selected. Changing the search retains checked items;
the pinned review button includes the total selection count.

Confirmation previews the frozen amounts, dates and accounts for each selected
item. The batch action confirms ownership as “between my own accounts.” Suggested
pairs link both original bank entries. Individually selected entries receive an
ownership decision without inventing a matching receipt or changing accounts.
Existing individual classification and undo remain available outside selection
mode. The Transfers history screen exposes review whenever the reconciliation
queue has items, including a queue with no suggested pairs.

## Atomic store contract

`resolveTransferBatch` accepts independent decisions with shared expected
fingerprints and the ledger generation captured by the UI. It yields before
computation and validates against the authoritative ledger after yielding.
`applyTransferDecisionBatch` validates every decision before cloning any row:
stale or missing records, duplicate selections, conflicting partners, and invalid
types abort the complete batch. Legacy multi-ID group requests still require one
current, sourced counterparty group. Explicit selection uses separate singleton
or pair decisions and does not relax that legacy rule.

The operation dispatches once, normalizes links once, derives the exact final
stored-array reconciliation receipt, and persists once. Standalone ownership
decisions avoid constructing the pre-decision matching graph. Pair decisions
reuse an existing reconciliation for the identical immutable ledger when one
is available. The final reconciliation must remain: link metadata can change
the set of rows eligible for automatic corroboration.

If storage fails, the confirmation remains open with post-decision fingerprints.
Retry calls `ensureDurable` instead of applying the decisions a second time.
Success is announced only after persistence succeeds. Restored or edited rows
invalidate confirmation, including persistence retry.

## Verification

`scripts/test/repair/transfer-batch.test.cjs` covers atomic rejection, reciprocal
links, money preservation, undo and normalization counts on a 10,200-row fixture.
`transfer-review-ui.test.cjs` covers English/Arabic selection, filtering, frozen
previews, bounded pair rendering and failed-save recovery. The browser suite
`scripts/e2e/e2e-transfer-batch.mjs` uses isolated synthetic ledgers to check real
selection, confirmation, durable reload and phone-width layouts. It runs after
the E2E web export through `scripts/e2e/run.sh`; it reads the current UI copy
directly and checks the fixture's pending count in the actual rendered app.
The UI suite also covers storage retry after classifying a suggested leg as an
external payment, and retaining a clearable search when the queue shrinks.
Host and browser timings do not establish physical Android or iOS frame rates.

### Delivery verification, 2026-09-28

Verified over main `16ac15df`, including its latest statement-replay repairs:

- 275 checks passed across 18 transfer, store and statement regression suites.
- Individual classification, undo, export and reload passed in English/light
  320px, Arabic/dark 320px, English/dark 390px and Arabic/light 390px browsers.
- Batch confirmation and durable reload passed in English/light 320px and
  Arabic/dark 390px browsers, with 8 and 11 mounted cards from 256 suggestions.
- App/server typechecking, changed-file lint and whitespace checks passed.

The resumed 10,200-row host benchmark measured 42.4ms for 40 paired decisions in
one batch versus 888.0ms for 40 individual dispatches. Browser confirmation of
two pairs through persistence measured 125ms and 116ms. These are synthetic
host/browser checks; no Android phone was connected for installation or timing.
