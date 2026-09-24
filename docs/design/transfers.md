# Dedicated transfer history

Transfers is a pushed page at `/transfers`, available from Accounts, the transaction-list shortcut and activity links on Home/Spending. It follows the selected reporting period and supports search plus All, Confirmed and Needs review views.

## Browsing and accounting

- Transfer records, including uncertain ownership, appear in Transfers instead of regular transaction rows. Uncertain ownership stays explicitly marked and requires a decision before classification changes.
- Paired transfers retain both bank records. Counts are labelled **transfer records**, and the page does not add both sides into a misleading spending total.
- Card repayments, salary, cashback, refunds and corroborating duplicate observations are not swept into this view merely because they have an internal/legacy transfer flag.
- External transfers can legitimately contribute to income or spending. The regular list retains matching financial totals, labels them **Net including transfers**, and shows the transferred income/spending separately. Date, account, category, amount and search restrictions are applied before calculating this explanation. Filter-sheet previews use the same projection.
- Browsing does not edit the ledger. Ownership decisions and Undo retain the existing fingerprint, confirmation and durability checks. Explicitly opening a low-signal record allows review without adding every uncertain record to the mandatory queue.

## Implementation boundaries

`transfer-activity.ts` uses the current reconciler's assessments for dedicated history membership. It does not introduce pairing rules or infer ownership. Detail sheets receive the current assessment for consistent presentation.

Home and Spending previews use cheap row-local candidate checks before their existing financial predicates and preview limits. They do not force full graph reconciliation on cold hydration or intermediate import pages. The canonical history/detail work remains on the explicitly opened Transfers and Transactions screens. The cash-flow predicate accepts read-only sets; its accounting logic is unchanged.

## Verification

- 139 focused source/component regressions pass, including transfer membership, exact cents, split filters, ownership review, ordinary transaction presentation, existing design contracts, and a primary-tab guard that throws if canonical reconciliation runs with a current/provisional receipt.
- Router contracts pass. App TypeScript and focused ESLint checks cover the changed source; the pre-existing Home effect-dependency warning remains.
- Synthetic browser coverage includes All/Confirmed/Needs review, search and period changes, signed accessible amounts, current ownership in details, Income/Expense filter drafts, separation-only empty states, low-signal review/confirmation/Undo, and cold-URL Back recovery.
- The all-transfer browser matrix passed 48 focused checkpoints and four cold-Back checks across 390px/320px in light/dark. After removing eager reconciliation from the primary tabs, eight additional Home/Spending cases passed on a fresh export with the same exact totals and regular-row membership.
- Verified fixture totals before review: income AED 2,133.75, spending AED 345.95, net AED 1,787.80; five regular rows and six transfer records. Confirming the AED 69.01 unknown transfer as external changes net to AED 1,718.79; Undo restores it without losing records or putting transfer rows back into the regular list.

Browser fixtures are synthetic and external requests are blocked. Native screen-reader, keyboard and device-performance qualification remains separate. These are local uncommitted changes, not a published release.

Latest local preview: <http://localhost:8133/transfers>. Evidence and screenshots are retained under `artifacts/transfers-20260923/`.
