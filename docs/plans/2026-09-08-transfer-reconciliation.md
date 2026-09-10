# Transfer ownership and reconciliation

The old ledger pairs opposite entries using only amount and proximity. It also
excludes generic outgoing transfers while counting generic incoming transfers as
income. Neither rule establishes whether money belongs to the user.

## Approved behavior

- Preserve every recorded amount, direction and account. Never delete a row to
  resolve uncertainty.
- Match only mutually unique, independently attributed bank observations with
  original currency/amount and strong reference or reciprocal instrument evidence.
  Masked instrument tails must be four contiguous final digits.
- Keep missing or conflicting evidence pending. Pending transfers remain in
  account balances, but are outside confirmed income, spending and net. Home and
  the dedicated review screen show that distinction and the pending amounts.
- User choices (own accounts or external payment/receipt) win over parser guesses,
  survive rereads and backups, and can be undone. Unknown recipients cannot be
  classified together; bulk choices require a stable counterparty identity.
- Card repayments, bill funding, salary, business income, cashback and refunds
  retain their separate semantics.
- A generic transfer labelled Business by a company-name heuristic remains
  pending. A category guess cannot prove an external income source.
- Store bounded structured evidence and reciprocal links in the existing
  encrypted transaction record. No new raw-message or full-account retention.

## Implementation and verification

1. Pure reconciliation engine, metadata validation and synthetic adversarial tests.
2. Import evidence capture/backfill; source-mask regression; preserve user choices.
3. Atomic store action with stale-row guards and durable write acknowledgement;
   normalize links after imports, hydration, edits, deletions and account changes.
4. Shared totals adapters, explicit Home pending summary and virtualized bilingual
   review route with safe grouped confirmation and undo.
5. Persistence/backup, money, card-settlement, import, UI and large-ledger checks;
   independent review and aggregate private-corpus replay. Native UI validation
   is reported separately from parser and browser evidence.

Coverage is evidence-based. Passing a user's corpus or synthetic tests does not
prove all banks or every user's account relationships. Unsupported evidence
must remain clear and recoverable rather than becoming a confident guess.

Automatic capture keeps the existing UAE and Saudi parser gates. Explicit
transfer review uses the ledger's stored currency, including zero- and
three-decimal currencies. Old body-free records cannot recover omitted bank
facts; they need new source evidence or a user decision.
