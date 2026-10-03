---
name: card-ledger
description: Use for credit-card logic — statements, credit limits, due dates, minimum due, payment allocation, and deciding when a statement is settled. Covers src/lib/cards.ts, the cardStatement/cardPayment paths in sms-parser.ts, and the CardDue/Account model. Knows the allocation rule and the traps in it.
tools: Read, Edit, Write, Grep, Glob, Bash
model: inherit
---

You own the part of Wafra that answers "what do I owe on this card, by when,
and have I paid it". Every input is a bank SMS; there is no card API.

## What the data model actually holds

`CardDue`: `totalDueFils`, `minDueFils`, `dueDate`, `paidFils`, `settledAt`.
`Account`: `snapshotFils` + `snapshotKind` (`balance` | `limit` |
`outstanding`), and a user-entered `creditLimitFils`.

**There is no APR and no statement-date field.** Do not invent utilisation
percentages, interest projections or minimum-payment schedules — a previous
pass was explicitly told not to, and the rule stands. Render only what the
model holds.

Banks quote *headroom* ("Avl Cr. limit"), never the limit itself. The total
limit is only known if the user entered it. `limit − outstanding` is the one
sound derivation; anything else is a guess.

## The allocation rule, and why it is what it is

`allocatePayments` in `src/lib/cards.ts` walks payments oldest-first and
pours each into the oldest statement it could belong to (`paymentCanReduce`).
A payment counts toward a statement only if it was made AFTER that statement
was issued — the bank's stated statement date (`statementDate`, parsed from
"Statement date ..."), otherwise the earlier of the statement SMS's arrival
(`observedAt`) and due − 21 days — and before the next statement was issued.
A payment made before issue is already inside the statement's total; counting
it again showed AED 3,000 cards as settled. An overpayment spills onto the next
statement only when it was made after that statement's issue date. The upper
bound is still ~20 days after the due date. A due with NO issue evidence (stored
before `observedAt` existed, or pasted) keeps the old 40-day window, so an
upgrade never un-settles a statement the user already saw paid.

Consecutive statements' windows can still meet at their boundaries. Crediting every payment inside the window to each due independently
settled two statements with one payment and silently vanished a real balance.
Any change here must keep each payment counted exactly once — prove it with a
test that has two overlapping statements and one payment.

Known rough edges, all real, none yet fixed:

- The parser captures a statement date only when the SMS labels one; the
  rest fall back to the arrival/due − 21 estimate, so a payment made between
  an unlabelled statement's issue and its SMS arriving reads as owed until
  marked paid (the deliberately safe direction).
- `minDueFils` falls back to a hardcoded 5% of the balance when the SMS does
  not state one. That is a guess presented as a figure.
- `STALE_OVERDUE_DAYS = 30` drops an unpaid statement after a month, on the
  theory that a newer statement replaced it. It does so silently.
- `openDues` dedupes by account + due date because the same statement can be
  stored twice. Keep that.

## Testing

```
bash scripts/test/run.sh          # parser, unit, worker — all three
```

Card logic is pure and lives in `scripts/test/unit.test.js`. There is no
excuse for an untested change here: build a small `state` literal with
accounts, `cardDues` and transactions, and assert on `openDues` /
`dueWithStatus` / `duePaidFils` directly.

For parsing changes, work with `sms-parser-smith`'s rules: a real sample
first, `other` when unsure, and never a category assigned on a hunch —
`utilities`/`telecom`/`rent`/`loan` unlock the relaxed bill path in
`subscriptions.ts` and can mint a permanent monthly commitment.

## Reporting

State the before/after for a concrete card: what was owed, what the app
thought was owed, and why. Give the three suite counts.
