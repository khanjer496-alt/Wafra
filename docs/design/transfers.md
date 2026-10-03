# Dedicated transfer history

Transfers is a pushed page at `/transfers`, available from Accounts, the transaction-list shortcut and activity links on Home/Spending. It follows the selected reporting period and supports search plus All, Confirmed and Not confirmed views (Arabic: الكل، مؤكدة، غير مؤكدة).

## Browsing and accounting

- Transfer records, including uncertain ownership, appear in Transfers instead of regular transaction rows. Two kinds of row are not listed: rows on archived accounts, which stay hidden as they are in every total, and rows whose id is shared by more than one stored record. The reconciler marks such duplicate-id observations ambiguous and still queues them for review, and they stay in the regular transaction list.
- Each row states its ownership. A confirmed row reads **Between your accounts** or **With someone else**. An unconfirmed row reads **Ownership not confirmed** in neutral text with no review button, unless the reconciler actually queued it for an ownership decision (its `pendingIds`: a credible own-account match or an ambiguous pairing). Only a queued row reads **Ownership needs review**, in the warning colour, with a **Review ownership** action. Arabic uses **الملكية غير مؤكدة**, **الملكية تحتاج مراجعة** and **مراجعة الملكية**.
- The Not confirmed view lists every unconfirmed row, queued or not. A generic unknown transfer with no link to another owned account is not a review chore, but classification never changes without a decision.
- Paired transfers retain both bank records. Counts are labelled **transfer records**, and the page does not add both sides into a misleading spending total.
- Card repayments (including likely ones), salary, cashback, refunds and corroborating duplicate observations are not swept into this view merely because they have an internal/legacy transfer flag.
- External transfers can legitimately contribute to income or spending. The regular list retains matching financial totals, labels them **Net including transfers**, and shows the transferred income/spending separately. Date, account, category, amount and search restrictions are applied before calculating this explanation. Filter-sheet previews use the same projection. The regular list notes that some separated transfers need an ownership review only when a separated row in view is actually queued for review.
- Browsing does not edit the ledger. Ownership decisions and Undo retain the existing fingerprint, confirmation and durability checks. Opening any listed record shows its current assessment and a review entry in the detail sheet, so a low-signal record can be reviewed on request without adding every uncertain record to the mandatory queue.

## Implementation boundaries

`transfer-activity.ts` uses the current reconciler's assessments for dedicated history membership. It does not introduce pairing rules or infer ownership. Each record carries `confirmed` (ownership settled) and, separately, `needsReview` (an unconfirmed row in the reconciler's `pendingIds`). Detail sheets receive the current assessment for consistent presentation. Copy lives in `transfer-activity-copy.ts` with matching English and Arabic keys.

The Transactions and Transfers screens reuse one reconciliation per stored transfer receipt (`transferReconciliationForState`). While a history import holds only a provisional receipt, Transactions separates nothing and Transfers builds the graph itself, so separation cannot disagree with the provisional internal set. Transactions separates exactly the rows `getTransferActivity` lists, and a row that neither counts in totals nor belongs to a live account keeps its hidden treatment even if named.

Home and Spending previews do not rebuild the transfer graph. They leave out only rows that the Transfers screen is guaranteed to list, using the row-local `isListedExternalTransfer` test: an explicitly external transfer with a unique id. Unknown-ownership rows, including likely card repayments that Transfers leaves to their own review, stay in recent activity rather than disappear. The existing live-account and internal-id rules apply first, and preview limits count only the rows that remain. The cash-flow predicate accepts read-only sets; its accounting logic is unchanged.

## Verification

Current branch (24 September 2026):

- `node --test repair/transfer-activity.test.cjs repair/transfer-history-ui.test.cjs repair/transaction-filter-transfers.test.cjs repair/dashboard-cost.test.cjs` from `scripts/test`: 30 of 30 pass. They cover archived and duplicate-id exclusion, unique record keys, the neutral label with no review action for a generic unknown and the warning label with a review action for a queued row in English and Arabic, the review note counting only queued rows, the row-local Home/Spending test never hiding a row that Transfers does not list, and receipt-keyed reuse.

Recorded 23 September 2026, before the ownership-label change above and not re-run since:

- 139 focused source/component regressions passed, including transfer membership, exact cents, split filters, ownership review, ordinary transaction presentation, existing design contracts, and a primary-tab guard that throws if canonical reconciliation runs with a current/provisional receipt.
- Router contracts passed. App TypeScript and focused ESLint checks covered the changed source; the pre-existing Home effect-dependency warning remained.
- Synthetic browser coverage included the three scope views (then labelled All/Confirmed/Needs review), search and period changes, signed accessible amounts, current ownership in details, Income/Expense filter drafts, separation-only empty states, low-signal review/confirmation/Undo, and cold-URL Back recovery.
- The all-transfer browser matrix passed 48 focused checkpoints and four cold-Back checks across 390px/320px in light/dark. After removing eager reconciliation from the primary tabs, eight additional Home/Spending cases passed on a fresh export with the same exact totals and regular-row membership.
- Verified fixture totals before review: income AED 2,133.75, spending AED 345.95, net AED 1,787.80; five regular rows and six transfer records. Confirming the AED 69.01 unknown transfer as external changed net to AED 1,718.79; Undo restored it without losing records or putting transfer rows back into the regular list.

Browser fixtures were synthetic and external requests were blocked. The browser matrix has not been repeated with the new labels. Native screen-reader, keyboard and device-performance qualification remains separate. This is not a published release.

That run's local preview was <http://localhost:8133/transfers>. Its evidence and screenshots are retained under `artifacts/transfers-20260923/`.
