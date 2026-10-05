# Transfers redesign: one question, one page

Date: 2026-10-04. Status: approved in brainstorming (Mix 2), awaiting spec review.

## Problem

- On Android phones the Transactions summary squeezes "13 transactions · Oct 2026 · 1 money movement not counted" into a one-character column beside "Net including transfers". `summaryText` is the only shrinkable item in a wrapping row (`transactions.tsx` styles ~900–930).
- Transfer status can be changed in four places with four vocabularies: the "Mark as transfer" chip and the edit-mode toggle in the entry detail sheet, the Review transfers screen (three radios, "Match as transfer", "Not a pair", "Leave as recorded"), and a checkbox in alert review. The screens add "transfer records", "ownership not confirmed/needs review", "matched pairs", "separated".
- There is no way to say "this is not a transfer": `TransferDecision.ownership` is only `'own' | 'external'`; "Leave as recorded" saves nothing.

## Decisions

1. **One question everywhere.** A transfer-like row answers only "whose money was it?":
   - Money out: **Moved to my own account** / **Paid someone else** / **Not a transfer**
   - Money in: **Came from my own account** / **Received from someone** / **Not a transfer**
   Each answer states its effect: "Not counted as spending/income" or "Counted as spending/income".
2. **Pairing is hidden.** The app links the other side itself and shows "Linked to ENBD ••2201" as a detail. Users never see "pair", "match" or "ownership".
3. **Transfers page = Mix 2** (summary tiles + one-tap question card + compact route list).

## Screens

### Transfers page (`src/app/transfers.tsx`, accounts band)

- **Band:** period pill in the nav row; search is a field at the top of the list. At large text the tiles move from the band to the top of the list so the fixed band never crowds out the list. Headline: "October · moved between your accounts", amount, "Not counted as spending or income". Three tiles: **Your accounts** (total, not counted), **Sent to others** (counted), **Received** (counted). Tapping a tile filters the list; tapping it again clears the filter. Tiles stack under `useLargeTextLayout`.
- **Question card** (only when the reconciler queue has items): "N transfers need an answer · 1 of N", the row as a route (`FAB ••4410 → ?`) with amount and a hint line when there is a likely counterpart ("looks like your ENBD account"), then three 44pt+ buttons. Answering saves immediately, shows a toast with **Undo**, and advances to the next item. "See all N" opens the existing review screen for selecting several at once.
- **List:** one card under a "This month" header; the band tiles are its filter (no separate scope menu), and unanswered transfers are reached through the question card. Each row: route chips `From → To` (account chips use merchant/bank logo or initials; a person or unknown side uses initials or a dashed "?"), signed amount, date, and one tag: **Your accounts** (slate) or **Someone else · counted** (gold) or **Needs an answer** (warning). Tapping a row opens the entry detail sheet.
- Copy retires: "transfer records", "Ownership not confirmed/needs review", "Review ownership", "Matched pairs", "Confirmed / Not confirmed". Counts say "transfers".

### Transactions screen (`src/app/transactions.tsx`)

- **Summary header stacks:** line 1 is the count, period and exclusions (wraps freely, never shrinks to a column); line 2 is "Net" and the amount. Exclusion copy names the kind when there is one kind ("1 cash withdrawal not counted"), else keeps "N money movements not counted".
- **"Net including transfers" becomes "Net".** The transfer strip below explains what is inside it.
- **Transfer strip** replaces the four-line separated-transfers block: "N transfers kept apart" + a gold dot when any need an answer; second line "AED 850 sent to others is in the net" (and/or received) plus "· 1 needs an answer" when applicable; "Open ›" to `/transfers`. Shown only when transfers are kept apart in view. testIDs `transactions-separated-transfers` and `transactions-transfers-link` are kept.

### Entry detail sheet (`src/components/entry-detail-sheet.tsx`)

- For any transfer candidate the sheet shows **What is this?** with the three answers as radio rows (selected row gold-outlined), "Linked to …" under the own-account answer when a counterpart exists, and **Done**.
- Removes the "Mark as transfer" chip + its confirm sheet, the edit-mode "Transfer between my accounts" toggle, and the "Check a transfer" button.
- If several own accounts could be the other side, choosing "my own account" reveals a short account picker; with none, the decision saves without a link.

### Alert review (`src/app/add-transaction.tsx`)

Kept as a checkbox this round, relabelled **Moved to my own account** to match. Correction found while planning: today an unticked transfer-family alert is saved as an `'external'` decision (not "not a transfer"), and `betweenOwnAccounts` is part of remembered review rules (`review-promotion.ts:181`), so a three-way control would change persisted rules. Its answer can be changed afterwards from the detail sheet.

### Rows that are not transfer candidates

`resolveTransfers` accepts transfer candidates only. A row that is not a candidate (an ordinary purchase, a manual entry) keeps one action in its detail sheet, **Moved to my own account**, which writes `isTransfer: true` exactly as today's chip does. That makes a manual row a candidate, so from then on it shows the three answers.

## Data

- `TransferDecision.ownership` gains `'none'` (Not a transfer). `TransferDecisionRequest.ownership` becomes `'own' | 'external' | 'none' | null` (`null` stays Undo).
- Reconciler: a `'none'` decision keeps the row a candidate (so Undo stays reachable, as today), never links it, excludes it from Transfers and from the review queue, and lets it count in spending/income exactly like an ordinary row with its category. Money effect equals `'external'`; only membership and labelling differ.
- Persisted decisions are additive; existing `'own' | 'external'` rows are unchanged. Restore/import validation (`isTransferDecision`) accepts `'none'`.
- Answers go through the existing `resolveTransfers` / `resolveTransferBatch` paths with their fingerprint, generation, durability and Undo guarantees. No new store action.
- The edit-mode `isTransfer` toggle is removed; the renamed action above is the only UI writer. `ledger.isTransfer` must return false for a row whose decision is `'none'`, even when legacy `isTransfer` is true, otherwise "Not a transfer" would still be left out of totals.

## Copy and design

- All copy in `src/lib/transfer-activity-copy.ts` / `transfer-review-copy.ts` with matching English and Arabic; nothing hard-coded in `src/app` or `src/components`.
- Design language E: Transfers keeps the `accounts` band; buttons `EButton`, tiles/chips per `BandLayout`; every layout stacks under large text; RTL mirrors the route arrow.

## Out of scope

Pairing rules and the reconciler's matching, the review screen's internals beyond reaching it from "See all", card-payment detection, Home/Spending previews.

### Follow-up (2026-10-05)

- Home's "N transfers to confirm" notice opens `/transfers` (the question card), not the bulk review; "See all N" on the card is the only way into `/review-transfers`, and back from there returns to Transfers.
- The bulk review screen keeps all its logic (listing, selection, `resolveTransfers` / `resolveTransferBatch`, fingerprints, generation, durability, Undo) but is drawn in the Transfers vocabulary: the band figure as on Transfers with "Not counted as spending or income", every pair, group, matched pair and batch-preview item as a `TransferRoute` (From chip → coin lane → To chip, amount) with a `RouteTag`, each group one card with its "N entries" count and its entries set in below, the Transfers page's answer buttons for Match / Not a pair and the selection controls, and `EButton` for Select, Review selected and the sheet's actions.

## Testing

- Unit: `'none'` decision in `transfer-reconciliation` and `transfer-activity` (membership, totals equal to an ordinary row, Undo restores, restore validation), batch accepts `'none'`.
- UI regressions to update: `transaction-ui-regression`, `transfer-history-ui`, `transfers-band`, `transfer-review-ui`, `everyday-band-screens` (chip removal), Arabic copy builds.
- Summary layout: a component test that the header renders text and Net on separate lines at 360pt width, plus large-text stacking.
- E2E: `e2e-transfer-review`, `e2e-transfer-batch`, `e2e-card-activity` copy updates; new browser checks for tile filtering and answering from the question card with Undo at 320/390px, light/dark, EN/AR.
- Device: Android phone at default font size for the summary fix; iOS simulator pass of the Transfers page.
