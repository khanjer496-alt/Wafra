/**
 * A statement row and a capture row for the same charge.
 *
 * Every bank states a card charge twice to a user who both receives alerts and
 * imports statements, and the two never agree on the name. The alert carries
 * the merchant ("Noon", "Talabat", "Endurancein"); the statement carries the
 * acquirer descriptor the card network settled against ("noon DUBAI",
 * "TALABAT COM DUBAI", "PAYPAL *ENDURANCEIN 4029357733"). That is not a
 * quirk of one bank or one market -- it is what a card statement IS -- so
 * `dedupeKey`, which is `date|amount|title`, can never match the pair.
 *
 * What the two sides DO agree on is the money: the same account, the same
 * direction, the same amount, on the same day. That is the only fingerprint a
 * statement can be held to, and it is the one this rule uses.
 *
 * The governing constraint is the one import-plan.test.js already states:
 * under-merging (a visible duplicate the user can delete) is always preferable
 * to over-merging (a charge that vanishes). So this rule never guesses across
 * a different amount, a different account, or a different day, and it consumes
 * one-for-one so a user with two identical charges on one day keeps both.
 */
const { duplicateGuard } = require('./build/dedupe.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const DAY = '2026-09-13';
const SMS_TS = Date.parse('2026-09-13T11:08:00Z');
// A statement states a DATE, never a time, so the row lands on midnight.
const STATEMENT_TS = Date.parse('2026-09-13T00:00:00Z');

/** A charge already in the ledger, captured from the bank's own alert. */
const captureRow = (extra = {}) => ({
  id: 'sms-1', type: 'expense', amountFils: 3215, category: 'other',
  accountId: 'adcb-7720', title: 'Endurancein', date: DAY,
  source: 'sms', smsKey: `ha31145t${SMS_TS}`, ts: SMS_TS,
  captureInstrument: { last4: '7720', kind: 'credit', bankIdentity: 'adcb' },
  ...extra,
});

/** The same charge arriving later on a PDF/CSV statement. */
const statementCandidate = (extra = {}) => ({
  date: DAY, amountFils: 3215, title: 'PAYPAL *ENDURANCEIN', type: 'expense',
  smsKey: `s${STATEMENT_TS}-3215`, ts: STATEMENT_TS, channel: 'inbox',
  captureSource: 'pdf', accountId: 'adcb-7720',
  captureInstrument: { last4: '7720', kind: 'credit', bankIdentity: 'adcb' },
  ...extra,
});

// --- the defect ------------------------------------------------------------
{
  const guard = duplicateGuard([captureRow()]);
  ok('a statement row matching a captured charge is a duplicate despite the descriptor',
    guard.has(statementCandidate()));
}

// --- one-for-one: two real charges must both survive -----------------------
{
  const guard = duplicateGuard([
    captureRow({ id: 'sms-1' }),
    captureRow({ id: 'sms-2', smsKey: `ha31146t${SMS_TS + 60_000}`, ts: SMS_TS + 60_000 }),
  ]);
  ok('the first statement row claims one captured charge', guard.has(statementCandidate()));
  ok('a second statement row claims the OTHER charge, not the same one again',
    guard.has(statementCandidate({ smsKey: `s${STATEMENT_TS}-3215-b` })));
  ok('a third statement row has nothing left to claim',
    !guard.has(statementCandidate({ smsKey: `s${STATEMENT_TS}-3215-c` })));
}

// --- a statement row for a charge never captured must still import ---------
{
  const guard = duplicateGuard([captureRow()]);
  ok('a statement charge with no captured twin is not a duplicate',
    !guard.has(statementCandidate({ amountFils: 9999, title: 'CARREFOUR DUBAI' })));
}

// --- never guess across the money facts ------------------------------------
{
  const guard = duplicateGuard([captureRow()]);
  ok('a different amount is never merged',
    !guard.has(statementCandidate({ amountFils: 3214 })),
    'one fil apart is a real difference, not a rounding licence');
}
{
  const guard = duplicateGuard([captureRow()]);
  ok('a different day is never merged',
    !guard.has(statementCandidate({ date: '2026-09-14', ts: Date.parse('2026-09-14T00:00:00Z') })),
    'under-merge: a visible duplicate beats a vanished charge');
}
{
  const guard = duplicateGuard([captureRow()]);
  ok('a different card is never merged',
    !guard.has(statementCandidate({
      accountId: 'adcb-2518',
      captureInstrument: { last4: '2518', kind: 'credit', bankIdentity: 'adcb' },
    })));
}
{
  const guard = duplicateGuard([captureRow()]);
  ok('the opposite direction is never merged',
    !guard.has(statementCandidate({ type: 'income' })));
}

// --- the rule belongs to statements only -----------------------------------
{
  const guard = duplicateGuard([captureRow()]);
  ok('an ordinary SMS with a different merchant name is NOT swallowed',
    !guard.has({
      date: DAY, amountFils: 3215, title: 'Carrefour', type: 'expense',
      smsKey: `ha31147t${SMS_TS + 5_000}`, ts: SMS_TS + 5_000, channel: 'inbox',
      accountId: 'adcb-7720',
      captureInstrument: { last4: '7720', kind: 'credit', bankIdentity: 'adcb' },
    }),
    'title-blind matching is what a statement earns; two named alerts are two charges');
}

// --- transfers are not this rule's business --------------------------------
//
// A transfer between the user's own accounts reconciles against the bank
// reference in transferEvidence. At equal amount, day and account a transfer
// and a merchant purchase are different events that merely collide, so money
// facts alone must never pair them -- in either direction.
{
  const guard = duplicateGuard([
    { id: 'purchase', type: 'expense', amountFils: 3215, category: 'groceries',
      accountId: 'adcb-7720', title: 'Carrefour', date: DAY, source: 'sms',
      smsKey: `ha31148t${SMS_TS}`, ts: SMS_TS, isTransfer: false,
      captureInstrument: { last4: '7720', kind: 'credit', bankIdentity: 'adcb' } },
  ]);
  ok('a statement TRANSFER never claims a named merchant purchase',
    !guard.has(statementCandidate({ title: 'Outgoing transfer', transferHint: true })),
    'that judgement belongs to reference-based transfer reconciliation');
}
{
  const guard = duplicateGuard([
    { id: 'old-transfer', type: 'expense', amountFils: 3215, category: 'other',
      accountId: 'adcb-7720', title: 'Outgoing transfer', date: DAY, source: 'sms',
      smsKey: `ha31149t${SMS_TS}`, ts: SMS_TS, isTransfer: true,
      captureInstrument: { last4: '7720', kind: 'credit', bankIdentity: 'adcb' } },
  ]);
  ok('an ordinary statement charge never claims an existing transfer row',
    !guard.has(statementCandidate()));
}

// Title-blind matching is what a statement earns against an ALERT, whose
// merchant name it cannot be expected to reproduce. It earns nothing against
// another statement line: both sides state an acquirer descriptor, so two
// different descriptors are two different charges the bank settled, and only
// the ordinary date|amount|title rule may pair them.
{
  const guard = duplicateGuard([
    { id: 'stmt-1', type: 'expense', amountFils: 3215, category: 'other',
      accountId: 'adcb-7720', title: 'PAYPAL *ENDURANCEIN', date: DAY, source: 'sms',
      smsKey: `s${STATEMENT_TS}-3215`, ts: STATEMENT_TS, captureSource: 'pdf',
      captureInstrument: { last4: '7720', kind: 'credit', bankIdentity: 'adcb' } },
  ]);
  ok('a statement line never claims a DIFFERENTLY named statement line',
    !guard.has(statementCandidate({
      title: 'NOON DUBAI', smsKey: `s${STATEMENT_TS}-3215-b`,
    })),
    'two descriptors on one statement are two settled charges');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
