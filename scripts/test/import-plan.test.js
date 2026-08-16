// buildImportPlan — the code that decides whether a message is already in
// the ledger.
//
// It had no test. dedupe.ts was carved out of auto-import.ts so the
// FINGERPRINTS could be tested, but the decision that uses them stayed behind
// the react-native import and went unexercised. Its failure mode is the
// ledger silently gaining a second copy of a charge, which is the one thing a
// money app must never do.
//
// The scenario every case here is built on is the one users actually hit:
// close the app, open it again, and the same messages are read a second time.

const { buildImportPlan } = require('./build/import-plan.js');
const {
  PARSER_VERSION,
  parseSms,
  isDeclinedMessage,
  nonPostingReason,
} = require('./build/sms-parser.js');
const { setActiveMarket } = require('./build/markets.js');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
}

const BASE = {
  hydrated: true,
  accounts: [],
  transactions: [],
  budgets: [],
  bills: [],
  goals: [],
  cardDues: [],
  accountHints: {},
  merchantOverrides: {},
  lastScanTs: 0,
  parserVersion: 0,
};

/**
 * A scan result, the way scanInbox would hand it over.
 *
 * `declined` mirrors auto-import.ts exactly, including the part that is easy
 * to get wrong: a message only reaches it when the parse returned null AND the
 * parser's own `isDeclinedMessage` says the text is a refusal. "No longer
 * parses" on its own is not evidence a charge did not happen — an OTP, an
 * offer and a bank-masked figure all parse to null, and one of those is a real
 * purchase. The scan's own newestTs advances over suppressed messages too.
 */
function scan(messages, channel = 'inbox') {
  const parsed = [];
  const declined = [];
  let newestTs = 0;
  for (const { body, ts, sender } of messages) {
    if (ts > newestTs) newestTs = ts;
    const p = parseSms(body);
    if (!p) {
      const reason = nonPostingReason(body);
      if (reason) declined.push({ smsTs: ts, sender: sender ?? 'ENBD', channel, reason });
      continue;
    }
    parsed.push({
      ...p,
      date: p.date ?? new Date(ts).toISOString().slice(0, 10),
      smsTs: ts,
      sender: sender ?? 'ENBD',
      channel,
    });
  }
  return { parsed, declined, newestTs };
}

/** Apply a plan to a state the way the store's importBatch does. */
function apply(state, plan) {
  const accounts = [...state.accounts];
  const hints = { ...state.accountHints, ...plan.batch.newHints };
  plan.batch.newAccounts.forEach((a, i) => {
    const id = `acc${accounts.length}`;
    accounts.push({ ...a, id });
    for (const [k, v] of Object.entries(hints)) if (v === String(i)) hints[k] = id;
  });
  const transactions = [
    ...state.transactions,
    ...plan.batch.transactions.map((t, i) => ({
      ...t,
      id: `tx${state.transactions.length + i}`,
      // Index-refs resolve positionally, exactly as the store does. Going
      // through `hints` first was wrong: a deliberately NON-confident
      // resolution writes no hint, so a card payment kept its placeholder.
      accountId:
        /^\d+$/.test(t.accountId) && Number(t.accountId) < plan.batch.newAccounts.length
          ? `acc${state.accounts.length + Number(t.accountId)}`
          : (hints[t.accountId] ?? t.accountId),
    })),
  ];
  return {
    ...state,
    accounts,
    accountHints: hints,
    transactions,
    // Dues carry the same index-refs transactions do, and the store resolves
    // BOTH (see importBatch in store.tsx). Leaving them unresolved here made
    // this helper quietly unfaithful: a due kept the placeholder "0", so it
    // matched no account and every rescan looked like it added a second copy.
    cardDues: [
      ...state.cardDues,
      ...plan.batch.newDues.map((d, i) => ({
        ...d,
        id: `due${state.cardDues.length + i}`,
        accountId:
          /^\d+$/.test(d.accountId) && Number(d.accountId) < plan.batch.newAccounts.length
            ? `acc${state.accounts.length + Number(d.accountId)}`
            : (hints[d.accountId] ?? d.accountId),
      })),
    ],
    lastScanTs: Math.max(state.lastScanTs, plan.batch.lastScanTs),
  };
}

const T0 = Date.parse('2026-07-20T10:15:00Z');
const INBOX = [
  { body: 'Purchase of AED 120.00 with Debit Card ending 1234 at CARREFOUR, DUBAI. Avl Balance is AED 5,000.00.', ts: T0 },
  { body: 'Purchase of AED 76.50 with Debit Card ending 1234 at SPINNEYS, DUBAI. Avl Balance is AED 4,923.50.', ts: T0 + 60_000 },
  { body: 'Your Card ending 4321 was used for AED 250.00 at NOON.COM.', ts: T0 + 120_000 },
];

/* ── the first scan ──────────────────────────────────────────────────── */

const first = buildImportPlan(scan(INBOX).parsed, BASE, scan(INBOX).newestTs);
ok('a first scan imports every message', first.txCount === 3, first.txCount);
ok('an explicitly stated AED amount confirms the deferred ledger currency',
  first.batch.confirmedLedgerCurrency === 'AED', first.batch.confirmedLedgerCurrency);
{
  const foreignOnly = scan([{
    body: 'Purchase of USD 20.00 with Debit Card ending 1234 at SAMPLE SHOP, NEW YORK.',
    ts: T0 + 180_000,
  }]);
  const foreignPlan = buildImportPlan(foreignOnly.parsed, BASE, foreignOnly.newestTs);
  ok('a foreign-only charge cannot confirm AED from the active parser fallback',
    foreignPlan.batch.confirmedLedgerCurrency === undefined,
    foreignPlan.batch.confirmedLedgerCurrency);
}
const afterFirst = apply(BASE, first);

/* ── close and reopen: the SAME messages are read again ──────────────── */

{
  // A cold start re-reads from lastScanTs, but a parser-version bump — and
  // any scan where the watermark did not advance — re-reads from zero.
  const again = scan(INBOX);
  const plan = buildImportPlan(again.parsed, afterFirst, again.newestTs);
  ok('re-reading the same inbox imports nothing', plan.txCount === 0,
    { txCount: plan.txCount, titles: plan.batch.transactions.map((t) => t.title) });
  ok('re-reading creates no second card', plan.newAccountCount === 0, plan.newAccountCount);
}

/* ── parser-version reread after an amount/FX correction ────────────── */

{
  const original = scan([INBOX[0]]).parsed[0];
  const existing = apply(BASE, buildImportPlan([original], BASE, original.smsTs));
  // The legacy local-SMS identity includes amountFils. A corrected parser or
  // updated fallback FX table therefore creates a different s-key for the
  // exact same retained provider message unless timestamp identity catches it.
  const corrected = { ...original, amountFils: original.amountFils + 123 };
  const plan = buildImportPlan([corrected], existing, corrected.smsTs);
  ok('an amount correction on the same retained SMS does not append a duplicate',
    plan.txCount === 0, plan.batch.transactions);
  ok('fallback/parser amount drift preserves the already-booked historical value',
    plan.batch.updates.every((u) => u.amountFils === undefined), plan.batch.updates);

  const pinned = {
    ...existing,
    transactions: existing.transactions.map((t) => ({
      ...t, userEdited: true, title: 'My corrected shop', category: 'health',
    })),
  };
  const pinnedPlan = buildImportPlan([corrected], pinned, corrected.smsTs);
  ok('the same stable identity protects a user-edited row without duplicating it',
    pinnedPlan.txCount === 0 && pinnedPlan.batch.updates.length === 0,
    { tx: pinnedPlan.txCount, updates: pinnedPlan.batch.updates });

  const conflictingRow = {
    ...existing.transactions[0], id: 'same-ms-other-message', amountFils: 999,
    smsKey: `s${original.smsTs}-999`, raw: 'A genuinely different retained message',
  };
  const ambiguousState = {
    ...existing,
    transactions: [...existing.transactions, conflictingRow],
  };
  const ambiguous = buildImportPlan([corrected], ambiguousState, corrected.smsTs);
  ok('two stored rows on one millisecond disable timestamp-only identity',
    ambiguous.txCount === 1, ambiguous.txCount);

  const rawMismatchState = {
    ...existing,
    transactions: existing.transactions.map((t) => ({
      ...t, raw: 'A genuinely different retained message',
    })),
  };
  const rawMismatch = buildImportPlan([corrected], rawMismatchState, corrected.smsTs);
  ok('retained source disagreement vetoes timestamp-only identity',
    rawMismatch.txCount === 1, rawMismatch.txCount);

  const sameMillisecondBatch = buildImportPlan(
    [corrected, { ...corrected, amountFils: corrected.amountFils + 1 }],
    existing,
    corrected.smsTs,
  );
  ok('two incoming messages on one millisecond cannot claim one stored row',
    sameMillisecondBatch.txCount === 2, sameMillisecondBatch.txCount);
}

/* ── the same message through a second channel ───────────────────────── */

{
  // The delivery receiver stamps the carrier's timestamp and the inbox stamps
  // the provider's; they differ by seconds. Same charge, two timestamps, so
  // the smsKey differs and only the day/amount/title fingerprint can catch it.
  const delivery = scan(INBOX.map((m) => ({ ...m, ts: m.ts + 4_000 })), 'delivery');
  const plan = buildImportPlan(delivery.parsed, afterFirst, delivery.newestTs);
  ok('the delivery copy of an imported SMS is not a second charge', plan.txCount === 0,
    { txCount: plan.txCount, titles: plan.batch.transactions.map((t) => t.title) });
}

{
  // A push notification words the same event differently, so its title will
  // not match. Day + amount + direction is all it can be held to.
  const push = [{ body: 'AED 120.00 spent at CARREFOUR', ts: T0 + 8_000 }];
  const plan = buildImportPlan(scan(push, 'push').parsed, afterFirst, T0 + 8_000);
  ok('a push about an imported charge is not a second charge', plan.txCount === 0,
    { txCount: plan.txCount, titles: plan.batch.transactions.map((t) => t.title) });
}

/* ── the race: the push notification arrives BEFORE the SMS ──────────── */

{
  // The bank app posts its notification the moment the card is used; the SMS
  // reaches the provider's inbox a moment later. Whichever lands first is
  // imported first — and the guard only ever drops a PUSH for matching an
  // existing SMS, never the other way round.
  const push = [{ body: 'AED 310.00 spent at THE ONE', ts: T0 + 900_000 }];
  const pushed = scan(push, 'push');
  const firstPlan = buildImportPlan(pushed.parsed, afterFirst, pushed.newestTs);
  ok('a push with no SMS yet does import', firstPlan.txCount === 1, firstPlan.txCount);
  const afterPush = apply(afterFirst, firstPlan);

  // Now the SMS about the very same charge turns up, worded differently.
  const sms = [{
    body: 'Purchase of AED 310.00 with Debit Card ending 9876 at THE ONE HOME, DUBAI.',
    ts: T0 + 903_000,
  }];
  const s = scan(sms);
  const plan = buildImportPlan(s.parsed, afterPush, s.newestTs);
  ok('the SMS for a charge already captured by push is not a second row',
    plan.txCount === 0,
    { txCount: plan.txCount, titles: plan.batch.transactions.map((t) => t.title) });
  const replacement = plan.batch.updates.find((u) => u.id === firstPlan.batch.transactions[0].id) ?? plan.batch.updates[0];
  ok('the better SMS moves the retained row onto the card it actually names',
    replacement && replacement.accountId === '0', replacement);
  ok('the retained row stops masquerading as a push capture',
    replacement && replacement.viaPush === false && replacement.smsKey === `s${sms[0].ts}-31000`, replacement);

  // A routine Android scan reads both buffers together. If the notification
  // timestamp is slightly earlier, it still must not append first and leave
  // an id-less pending row that the SMS cannot supersede.
  const together = buildImportPlan([...pushed.parsed, ...s.parsed], afterFirst, s.newestTs);
  ok('push and SMS in one Android scan become one authoritative SMS row',
    together.txCount === 1 &&
      together.batch.transactions[0].accountId === '0' &&
      !together.batch.transactions[0].viaPush,
    together.batch.transactions);
}

/* ── two alerts for the two sides of one card settlement ────────────── */

{
  const cardState = {
    ...BASE,
    accounts: [{
      id: 'fab4833', name: 'FAB Credit Card •4833', kind: 'card', cardType: 'credit',
      last4: '4833', bankName: 'FAB', openingFils: 0, color: '#fff',
    }],
    accountHints: { '4833': 'fab4833' },
  };
  const pair = [
    {
      body: 'Your payment instructions of AED 8,144.40 to 5492********4833 has been processed on 05/07/2026 01:19',
      ts: T0 + 1_200_000,
      sender: 'FAB',
    },
    {
      body: 'Payment of AED 8,144.40 has been received towards your credit card ending 4833 on 05/07/2026',
      ts: T0 + 1_800_000,
      sender: 'FAB',
    },
  ];
  const s = scan(pair);
  ok('both settlement-side messages parse', s.parsed.length === 2, s.parsed.map((p) => p.kind));
  const plan = buildImportPlan(s.parsed, cardState, s.newestTs);
  ok('the debit confirmation and card receipt become one card payment',
    plan.txCount === 1, plan.batch.transactions.map((t) => ({ title: t.title, at: t.ts })));

  const twoRealReceipts = scan([
    { ...pair[1], ts: T0 + 2_400_000 },
    { ...pair[1], ts: T0 + 3_000_000 },
  ]);
  const twoPlan = buildImportPlan(twoRealReceipts.parsed, cardState, twoRealReceipts.newestTs);
  ok('two genuine equal card payments on the same side stay two payments',
    twoPlan.txCount === 2, twoPlan.txCount);

  const rawlessPair = [
    {
      ...s.parsed[0], raw: undefined, smsTs: T0 + 3_300_000,
      cardPaymentSide: 'debit', sender: 'FAB', channel: 'inbox', captureSource: 'shortcut',
    },
    {
      ...s.parsed[1], raw: undefined, smsTs: T0 + 3_900_000,
      cardPaymentSide: 'receipt', sender: 'FAB', channel: 'inbox', captureSource: 'shortcut',
    },
  ];
  const rawlessPlan = buildImportPlan(rawlessPair, cardState, rawlessPair[1].smsTs);
  ok('iOS rawless settlement sides still become one card payment',
    rawlessPlan.txCount === 1 &&
      rawlessPlan.batch.transactions[0]?.cardPaymentSide === 'debit',
    rawlessPlan.batch.transactions);

  const priorWithoutSide = {
    ...cardState,
    transactions: [{
      id: 'legacy-payment', type: 'expense', amountFils: rawlessPair[0].amountFils,
      category: 'other', accountId: 'fab4833', title: 'Card payment',
      date: rawlessPair[0].date, source: 'sms',
      smsKey: `s${rawlessPair[0].smsTs}-${rawlessPair[0].amountFils}`,
    }],
  };
  const sideHeal = buildImportPlan(
    [rawlessPair[0]], priorWithoutSide, rawlessPair[0].smsTs);
  ok('rawless reparse heals direction and structured debit side onto a legacy payment',
    sideHeal.txCount === 0 && sideHeal.batch.updates.some((u) =>
      u.id === 'legacy-payment' && u.type === 'income' && u.isTransfer === true &&
      u.cardPaymentSide === 'debit'),
    sideHeal.batch.updates);

  const legacyPair = {
    ...cardState,
    transactions: s.parsed.map((p, index) => ({
      id: `legacy-side-${index}`,
      type: 'expense', amountFils: p.amountFils, category: 'other',
      accountId: 'fab4833', title: 'Card payment', date: p.date,
      source: 'sms', smsKey: `s${p.smsTs}-${p.amountFils}`,
    })),
  };
  const legacyPairPlan = buildImportPlan(s.parsed, legacyPair, s.newestTs);
  const healedPair = legacyPair.transactions.map((tx) => {
    const update = legacyPairPlan.batch.updates.find((u) => u.id === tx.id);
    return update ? { ...tx, ...update } : tx;
  });
  const reconciledPair = require('./build/dedupe.js').reconcileCaptureDuplicates(healedPair);
  ok('legacy opposite raw settlement rows heal sides then reconcile to one payment',
    legacyPairPlan.txCount === 0 &&
      legacyPairPlan.batch.updates.some((u) => u.cardPaymentSide === 'debit') &&
      legacyPairPlan.batch.updates.some((u) => u.cardPaymentSide === 'receipt') &&
      reconciledPair.length === 1,
    { updates: legacyPairPlan.batch.updates, reconciledPair });

  const midnightDebitTs = Date.parse('2026-08-10T23:59:00Z');
  const crossMidnightPair = [
    { ...rawlessPair[0], date: '2026-08-10', smsTs: midnightDebitTs },
    { ...rawlessPair[1], date: '2026-08-11', smsTs: midnightDebitTs + 3 * 60_000 },
  ];
  const crossMidnightPlan = buildImportPlan(
    crossMidnightPair, cardState, crossMidnightPair[1].smsTs);
  ok('settlement pairing: opposite sides across midnight become one payment',
    crossMidnightPlan.txCount === 1, crossMidnightPlan.batch.transactions);
  const crossMidnightSameSide = buildImportPlan(
    [
      { ...crossMidnightPair[1], date: '2026-08-10', smsTs: midnightDebitTs },
      crossMidnightPair[1],
    ],
    cardState,
    crossMidnightPair[1].smsTs,
  );
  ok('settlement pairing: same-side payments on adjacent dates stay distinct',
    crossMidnightSameSide.txCount === 2, crossMidnightSameSide.batch.transactions);

  const manualDate = '2026-08-10';
  const manualPayment = {
    id: 'manual-payment', type: 'income', amountFils: rawlessPair[1].amountFils,
    category: 'other', accountId: 'fab4833', title: 'FAB Credit Card •4833 payment',
    date: manualDate, source: 'manual', isTransfer: true,
  };
  const manualState = {
    ...cardState,
    transactions: [manualPayment],
    cardDues: [
      { id: 'due-current', accountId: 'fab4833', totalDueFils: manualPayment.amountFils, minDueFils: 40000, dueDate: '2026-08-20', paidFils: 0 },
      { id: 'due-next', accountId: 'fab4833', totalDueFils: manualPayment.amountFils, minDueFils: 40000, dueDate: '2026-09-20', paidFils: 0 },
    ],
  };
  const laterReceipt = {
    ...rawlessPair[1], date: manualDate, smsTs: Date.parse('2026-08-10T18:00:00Z'),
  };
  const manualReceiptPlan = buildImportPlan(
    [laterReceipt], manualState, laterReceipt.smsTs);
  const cardMath = require('./build/cards.js');
  ok('manual payment correlation: a same-day bank receipt is not imported twice',
    manualReceiptPlan.txCount === 0, manualReceiptPlan.batch.transactions);
  ok('manual payment correlation: one payment settles only the current due',
    cardMath.duePaidFils(manualState, manualState.cardDues[0]) === manualPayment.amountFils &&
      cardMath.duePaidFils(manualState, manualState.cardDues[1]) === 0);
  const manualPlusTwoReceipts = buildImportPlan(
    [laterReceipt, { ...laterReceipt, smsTs: laterReceipt.smsTs + 10 * 60_000 }],
    manualState,
    laterReceipt.smsTs + 10 * 60_000,
  );
  ok('manual payment correlation: one manual row consumes only one real receipt',
    manualPlusTwoReceipts.txCount === 1,
    manualPlusTwoReceipts.batch.transactions);
}

/* A raw-discarded relay duplicate must never be dereferenced during healing. */
{
  const smsTs = T0 + 3_950_000;
  const rawlessUnknown = {
    kind: 'transaction', type: 'expense', amountFils: 1999, currency: 'AED',
    merchant: 'Card purchase', date: '2026-07-20', dueDay: null, minDueFils: null,
    card: null, reference: null, transferHint: false, snapshotFils: null,
    snapshotKind: null, categoryGuess: 'other', categoryDeliberate: false,
    raw: undefined, smsTs, sender: 'FAB', channel: 'inbox', captureSource: 'shortcut',
  };
  const rawlessState = {
    ...BASE,
    accounts: [{
      id: 'cash', name: 'Current account', kind: 'bank', openingFils: 0, color: '#fff',
    }],
    transactions: [{
      id: 'rawless-prior', type: 'expense', amountFils: 1999, category: 'other',
      accountId: 'cash', title: 'Card purchase', date: '2026-07-20', source: 'sms',
      smsKey: `s${smsTs}-1999`,
    }],
  };
  const plan = buildImportPlan([rawlessUnknown], rawlessState, smsTs);
  ok('rawless relay duplicate healing is safe and does not invent stored source text',
    plan.txCount === 0 && plan.batch.updates.length === 0,
    plan.batch.updates);
}

/* ── last four digits are not globally unique across banks ──────────── */

{
  const collision = {
    ...BASE,
    accounts: [
      { id: 'fab', name: 'FAB Credit Card •1234', kind: 'card', cardType: 'credit', last4: '1234', bankName: 'FAB', openingFils: 0, color: '#fff' },
      { id: 'enbd', name: 'ENBD Credit Card •1234', kind: 'card', cardType: 'credit', last4: '1234', bankName: 'Emirates NBD', openingFils: 0, color: '#fff' },
    ],
    // Legacy state can only carry one global last-four hint. It points at the
    // other bank, which must not steal this ENBD statement.
    accountHints: { '1234': 'fab' },
  };
  const statement = {
    kind: 'cardStatement', type: 'expense', amountFils: 200000, currency: 'AED',
    merchant: 'Card statement', date: '2026-08-20', dueDay: 20, minDueFils: 10000,
    card: { last4: '1234', kind: 'credit' }, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'other', raw: '',
    smsTs: T0 + 4_000_000, sender: 'ENBD', channel: 'inbox',
  };
  const plan = buildImportPlan([statement], collision, statement.smsTs, new Date(2026, 7, 2));
  ok('same last4 at two banks attaches the statement to the sender bank',
    plan.batch.newDues[0]?.accountId === 'enbd', plan.batch.newDues[0]);
}

/* An unstated minimum is never borrowed from another market's convention. */
{
  const saState = {
    ...BASE,
    accounts: [{
      id: 'albilad-card', name: 'Bank Albilad Credit Card •4567', kind: 'card',
      cardType: 'credit', last4: '4567', bankName: 'Bank Albilad',
      openingFils: 0, color: '#E63329',
    }],
  };
  const saStatement = {
    kind: 'cardStatement', type: 'expense', amountFils: 200000, currency: 'SAR',
    merchant: 'Card statement', date: '2026-08-20', dueDay: 20, minDueFils: null,
    card: { last4: '4567', kind: 'credit' }, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'other', raw: '',
    smsTs: T0 + 4_050_000, sender: 'Albilad', channel: 'inbox',
  };
  const plan = buildImportPlan([saStatement], saState, saStatement.smsTs, new Date(2026, 7, 2));
  ok('Saudi statement without a stated minimum gets no UAE 5% figure',
    plan.batch.newDues[0]?.minDueFils === 0 &&
      plan.batch.newDues[0]?.minDueEstimated === true,
    plan.batch.newDues[0]);

  const oldWrongEstimate = {
    id: 'old-sa-due', accountId: 'albilad-card', totalDueFils: 200000,
    minDueFils: 10000, minDueEstimated: true, dueDate: '2026-08-20',
    paidFils: 4500,
  };
  const repairPlan = buildImportPlan(
    [saStatement],
    { ...saState, cardDues: [oldWrongEstimate] },
    saStatement.smsTs,
    new Date(2026, 7, 2),
  );
  ok('a rescan offers a repair for an old Saudi due carrying the UAE estimate',
    repairPlan.batch.newDues.length === 1 &&
      repairPlan.batch.newDues[0]?.minDueFils === 0 &&
      repairPlan.batch.newDues[0]?.minDueEstimated === true,
    repairPlan.batch.newDues);

  const { mergeImportedCardDues } = require('./build/cards.js');
  const repaired = mergeImportedCardDues(
    [oldWrongEstimate],
    [{ ...repairPlan.batch.newDues[0], id: 'repair' }],
    saState.accounts,
  )[0];
  ok('the repair removes only the invented minimum and preserves payment evidence',
    repaired.minDueFils === 0 && repaired.minDueEstimated === true &&
      repaired.paidFils === 4500,
    repaired);
}

/* A parser upgrade must never delete a statement row the user corrected. */
{
  const smsTs = T0 + 4_200_000;
  const statement = {
    kind: 'cardStatement', type: 'expense', amountFils: 125000, currency: 'AED',
    merchant: 'Card statement', date: '2026-08-20', dueDay: 20, minDueFils: 6250,
    card: { last4: '5678', kind: 'credit' }, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'other', raw: '',
    smsTs, sender: 'FAB', channel: 'inbox',
  };
  const corrected = {
    ...BASE,
    accounts: [{
      id: 'fab5678', name: 'FAB Credit Card •5678', kind: 'card', cardType: 'credit',
      last4: '5678', bankName: 'FAB', openingFils: 0, color: '#fff',
    }],
    transactions: [{
      id: 'edited-statement', type: 'expense', amountFils: 125000, category: 'other',
      accountId: 'fab5678', title: 'My corrected transaction', date: '2026-08-20',
      source: 'sms', smsKey: `s${smsTs}-125000`, userEdited: true,
    }],
  };
  const plan = buildImportPlan([statement], corrected, smsTs, new Date(2026, 7, 2));
  ok('statement reparse never removes a user-edited matching row',
    !plan.batch.updates.some((u) => u.id === 'edited-statement' && u.remove),
    plan.batch.updates);
}

/* A reminder the OLD parser booked as an expense is dropped on rescan.
 *
 * One user carried twelve AED 775.81 "Due Date For Your E&" charges for bills
 * that were only ever due. The parser now reads the message as a billDue, but
 * that alone leaves the twelve rows sitting in the ledger: healPatch rewrites
 * rows, it cannot delete one. */
{
  const smsTs = T0 + 4_400_000;
  const reminder = {
    kind: 'billDue', type: 'expense', amountFils: 77581, currency: 'AED',
    merchant: 'E&', date: '2026-08-15', dueDay: 15, minDueFils: null,
    card: null, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'telecom', raw: '',
    smsTs, sender: 'e&', channel: 'inbox',
  };
  const withPhantom = {
    ...BASE,
    transactions: [{
      id: 'phantom-e&', type: 'expense', amountFils: 77581, category: 'telecom',
      accountId: 'acc-main', title: 'Due Date For Your E&',
      date: '2026-08-15', source: 'sms', smsKey: `s${smsTs}-77581`,
    }],
  };
  const plan = buildImportPlan([reminder], withPhantom, smsTs, new Date(2026, 7, 2));
  ok('a rescan removes the expense an unrecognised reminder had created',
    plan.batch.updates.some((u) => u.id === 'phantom-e&' && u.remove),
    plan.batch.updates);
  ok('and the reminder itself lands as a bill due',
    plan.billDues.length === 1 && plan.billDues[0].merchant === 'E&', plan.billDues);
  ok('...and never as a transaction', plan.txCount === 0, plan.batch.transactions);

  const newerReminder = {
    ...reminder,
    amountFils: 81234,
    date: '2026-09-18',
    dueDay: 18,
    smsTs: smsTs + 31 * 86400000,
  };
  const historyPlan = buildImportPlan(
    [reminder, newerReminder],
    BASE,
    newerReminder.smsTs,
    new Date(2026, 8, 2),
  );
  ok('full history keeps only the newest recurring reminder per merchant',
    historyPlan.billDues.length === 1 &&
      historyPlan.billDues[0].amountFils === 81234 &&
      historyPlan.billDues[0].dueDay === 18,
    historyPlan.billDues);

  const staleHistoryPlan = buildImportPlan(
    [{
      ...reminder,
      date: null,
      smsTs: Date.parse('2019-08-01T10:00:00Z'),
      sourceEventId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }],
    BASE,
    0,
    new Date(2026, 8, 2),
  );
  ok('historical import does not resurrect years-old recurring bills',
    staleHistoryPlan.billDues.length === 0,
    staleHistoryPlan.billDues);
}

/* ...but never one the user corrected by hand. */
{
  const smsTs = T0 + 4_600_000;
  const reminder = {
    kind: 'billDue', type: 'expense', amountFils: 32050, currency: 'AED',
    merchant: 'Du', date: '2026-08-21', dueDay: 21, minDueFils: null,
    card: null, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'telecom', raw: '',
    smsTs, sender: 'du', channel: 'inbox',
  };
  const corrected = {
    ...BASE,
    transactions: [{
      id: 'edited-reminder', type: 'expense', amountFils: 32050, category: 'telecom',
      accountId: 'acc-main', title: 'I paid this one myself',
      date: '2026-08-21', source: 'sms', smsKey: `s${smsTs}-32050`, userEdited: true,
    }],
  };
  const plan = buildImportPlan([reminder], corrected, smsTs, new Date(2026, 7, 2));
  ok('a reminder rescan never removes a user-edited matching row',
    !plan.batch.updates.some((u) => u.id === 'edited-reminder' && u.remove),
    plan.batch.updates);
}

/* ── Declines: rows for money that never moved ────────────────────────────
 *
 * A user's ledger held 59 rows titled "Insufficient Funds" totalling
 * AED 89,897, counted as real spending. The parser already refuses those
 * messages, and accounts.ts already deletes such rows — but only on the
 * evidence of the row's STORED body, and 14,169 of that ledger's 14,314 rows
 * have none. All 59 were among them.
 *
 * The evidence exists at SCAN time and was being thrown away: parseSms returns
 * null for a decline, so scanInbox's `if (p)` dropped the message and its
 * timestamp never reached the planner. It reaches it now, and the join is the
 * timestamp alone — a decline has no parsed amount, so the `s{ts}-{amount}`
 * key cannot be rebuilt from it. Everything below is a guard on that join. */
const DECLINE_TS = T0 + 5_000_000;
const DECLINED_ROW = {
  id: 'declined-1108', type: 'expense', amountFils: 110800, category: 'other',
  accountId: 'acc-main', title: 'Insufficient Funds',
  date: new Date(DECLINE_TS).toISOString().slice(0, 10),
  source: 'sms', ts: DECLINE_TS, smsKey: `s${DECLINE_TS}-110800`,
};
const DECLINE_SMS = [{
  body: 'Your transaction of AED 1,108.00 at NOON was declined due to insufficient funds.',
  ts: DECLINE_TS,
}];

{
  const s = scan(DECLINE_SMS);
  ok('the scan carries the decline it refused to parse',
    s.parsed.length === 0 && s.declined.length === 1 && s.declined[0].smsTs === DECLINE_TS,
    s);
  const state = { ...BASE, transactions: [DECLINED_ROW] };
  const plan = buildImportPlan(s.parsed, state, s.newestTs, new Date(2026, 7, 2), s.declined);
  ok('a re-read removes the expense a decline alert had created',
    plan.batch.updates.filter((u) => u.remove).map((u) => u.id).join() === 'declined-1108',
    plan.batch.updates);
  ok('...and imports nothing in its place', plan.txCount === 0, plan.batch.transactions);

  // Once it is gone there is nothing to find, so a later scan is a no-op.
  const healed = { ...state, transactions: [] };
  ok('the sweep is idempotent',
    buildImportPlan(s.parsed, healed, s.newestTs, new Date(2026, 7, 2), s.declined)
      .batch.updates.length === 0);
}

/* Callers that cannot supply declines get the old behaviour, not a guess.
 * The relay is the real one: the Worker discards Message Content before
 * sealing a row, so no body ever reaches this device to be tested. */
{
  const state = { ...BASE, transactions: [DECLINED_ROW] };
  const plan = buildImportPlan([], state, DECLINE_TS);
  ok('with no declines carried, nothing is swept',
    plan.batch.updates.length === 0, plan.batch.updates);
}

/* The guards, one at a time. Each one is a way a timestamp could point at a
 * row that did NOT come from the decline. */
{
  const s = scan(DECLINE_SMS);
  const plan = (transactions) =>
    buildImportPlan(s.parsed, { ...BASE, transactions }, s.newestTs, new Date(2026, 7, 2), s.declined);
  const swept = (transactions) => plan(transactions).batch.updates.some((u) => u.remove);

  ok('never a row the user edited',
    !swept([{ ...DECLINED_ROW, userEdited: true }]));
  ok('never a transfer',
    !swept([{ ...DECLINED_ROW, isTransfer: true }]));
  ok('never a split row, whose parts are rows of their own',
    !swept([{ ...DECLINED_ROW, splits: [{ category: 'dining', amountFils: 110800 }] }]));
  ok('never a row this device did not import from a message',
    !swept([{ ...DECLINED_ROW, source: 'manual' }]));
  ok('never a row dated nowhere near the message',
    !swept([{ ...DECLINED_ROW, date: '2025-01-04' }]));

  // Two rows on one millisecond cannot both have come from one decline, and
  // nothing here can say which did.
  ok('never when two rows share the timestamp',
    !swept([DECLINED_ROW, { ...DECLINED_ROW, id: 'other-1108', amountFils: 4200, smsKey: `s${DECLINE_TS}-4200` }]));

  // A row that predates the `ts` column is still reachable: dedupe.ts reads the
  // timestamp out of `s{ts}-{amount}`, and so does this.
  const legacy = { ...DECLINED_ROW, ts: undefined };
  ok('a legacy row with no ts column is matched through its smsKey',
    swept([legacy]));
}

/* The timestamp of a message the parser can still read is off limits. On the
 * full re-read a version bump forces, `parsed` is the whole inbox, so a real
 * charge sharing a millisecond with a decline takes its own row out of play. */
{
  const s = scan([
    ...DECLINE_SMS,
    { body: 'Purchase of AED 42.00 with Debit Card ending 1234 at SPINNEYS, DUBAI.', ts: DECLINE_TS },
  ]);
  const real = {
    id: 'real-42', type: 'expense', amountFils: 4200, category: 'groceries',
    accountId: 'acc-main', title: 'Spinneys',
    date: new Date(DECLINE_TS).toISOString().slice(0, 10),
    source: 'sms', ts: DECLINE_TS, smsKey: `s${DECLINE_TS}-4200`,
  };
  const plan = buildImportPlan(s.parsed, { ...BASE, transactions: [real] }, s.newestTs,
    new Date(2026, 7, 2), s.declined);
  ok('a timestamp this scan still parses is never swept',
    !plan.batch.updates.some((u) => u.remove), plan.batch.updates);
}

/* The class this whole guardrail exists for.
 *
 * A naive "delete anything that no longer parses" rule would have deleted two
 * GENUINE purchases from the same ledger — AED 3,366.95 and AED 2,787.97 —
 * whose stored bodies carry a figure the bank masked (`THB ····9260.00`) and
 * the parser refuses on purpose. Neither is a refusal, so neither is ever
 * carried as one; and if such a row were somehow reached by a colliding
 * timestamp, its own retained text vetoes the removal. */
{
  const masked = 'Purchase of THB ····9260.00 at PLENARY WELLNESS PHUKET THA with Credit Card ending 8575.';
  ok('a bank-masked figure parses to null but is NOT a decline',
    parseSms(masked) === null && !isDeclinedMessage(masked));
  const s = scan([{ body: masked, ts: DECLINE_TS }]);
  ok('...so the scan carries no decline for it',
    s.declined.length === 0, s.declined);

  // And the veto, driven by the decline at the same millisecond.
  const genuine = {
    id: 'plenary', type: 'expense', amountFils: 336695, category: 'other',
    accountId: 'acc-main', title: 'Plenary Wellness Phuket',
    date: new Date(DECLINE_TS).toISOString().slice(0, 10),
    source: 'sms', ts: DECLINE_TS, smsKey: `s${DECLINE_TS}-336695`, raw: masked,
  };
  const withDecline = scan(DECLINE_SMS);
  const plan = buildImportPlan([], { ...BASE, transactions: [genuine] }, DECLINE_TS,
    new Date(2026, 7, 2), withDecline.declined);
  ok('a row whose own stored text is not a refusal is never swept',
    !plan.batch.updates.some((u) => u.remove), plan.batch.updates);
}

/* Only affirmative non-posting outcomes travel as repair evidence. Offers and
 * spend summaries still do not: returning null alone proves nothing. */
{
  const repairable = [
    'Your OTP for the transaction of AED 250.00 at NOON is 448120. Do not share it.',
    'Purchase of AED 1.00 with Debit Card ending 1234 at GOOGLE *TEMPORARY HOLD, g.co/helppay.',
  ];
  const ignored = [
    'Get 20% off at CARREFOUR when you pay with your Card ending 1234.',
    'You spent AED 3,420.00 this month with Card ending 1234.',
  ];
  const repairScan = scan(repairable.map((body, i) => ({ body, ts: DECLINE_TS + i })));
  ok('security challenges and verification holds carry bounded repair evidence',
    repairScan.parsed.length === 0 && repairScan.declined.length === 2 &&
      repairScan.declined.map((row) => row.reason).join() === 'security-challenge,preauthorisation',
    repairScan.declined);
  const ignoredScan = scan(ignored.map((body, i) => ({ body, ts: DECLINE_TS + 10 + i })));
  ok('offers and summaries remain neither parsed nor deletion evidence',
    ignoredScan.parsed.length === 0 && ignoredScan.declined.length === 0, ignoredScan.declined);

  const OTP_TS = DECLINE_TS + 20;
  const otpRaw = repairable[0];
  const priorOtp = {
    ...DECLINED_ROW,
    id: 'old-otp-purchase',
    ts: OTP_TS,
    smsKey: `s${OTP_TS}-25000`,
    amountFils: 25000,
    title: 'Noon',
    raw: otpRaw,
  };
  const otpScan = scan([{ body: otpRaw, ts: OTP_TS }]);
  const otpPlan = buildImportPlan([], { ...BASE, transactions: [priorOtp] }, OTP_TS,
    new Date(2026, 7, 2), otpScan.declined);
  ok('a full re-read removes a purchase an older parser made from an OTP',
    otpPlan.batch.updates.some((update) => update.id === priorOtp.id && update.remove),
    otpPlan.batch.updates);
}

/* ── what must STILL import ──────────────────────────────────────────── */

/* Ambiguous identity is never auto-merged from issuer + last4 alone. */
{
  const existingLivDebit = {
    ...BASE,
    accounts: [{
      id: 'liv8575', name: 'Liv Debit Card •8575', kind: 'card', cardType: 'debit',
      last4: '8575', bankName: 'Liv', openingFils: 0, color: '#00D3B9',
    }],
    accountHints: { 'Liv|debit|8575': 'liv8575', '8575': 'liv8575' },
  };
  const statement = {
    kind: 'cardStatement', type: 'expense', amountFils: 406169, currency: 'AED',
    merchant: 'Card statement', date: '2026-08-20', dueDay: 20, minDueFils: 20308,
    card: { last4: '8575', kind: 'credit' }, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'other', raw: '',
    smsTs: T0 + 4_500_000, sender: 'ENBD', channel: 'inbox',
  };
  const plan = buildImportPlan([statement], existingLivDebit, statement.smsTs, new Date(2026, 7, 2));
  ok('identity safety: Liv and ENBD same-last4 are not silently merged',
    plan.newAccountCount === 1 && plan.batch.newDues[0]?.accountId === '0', plan.batch);
  ok('identity safety: the new statement account is authoritatively credit',
    plan.batch.cardTypes?.['0'] === 'credit', plan.batch.cardTypes);
}

{
  const unknownPurchase = {
    kind: 'transaction', type: 'expense', amountFils: 3500, currency: 'AED', merchant: 'Costa',
    date: '2026-08-03', dueDay: null, minDueFils: null,
    card: { last4: '1111', kind: 'unknown' }, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'dining', raw: '',
    smsTs: T0 + 4_700_000, sender: 'ADCB', channel: 'inbox',
  };
  const creditStatement = {
    kind: 'cardStatement', type: 'expense', amountFils: 3500, currency: 'AED', merchant: 'Card statement',
    date: '2026-08-20', dueDay: 20, minDueFils: 175,
    card: { last4: '1111', kind: 'credit' }, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'other', raw: '',
    smsTs: T0 + 4_800_000, sender: 'ADCB', channel: 'inbox',
  };
  const knownCredit = {
    ...BASE,
    accounts: [{ id: 'adcb1111', name: 'ADCB Credit Card •1111', kind: 'card', cardType: 'credit', last4: '1111', bankName: 'ADCB', openingFils: 0, color: '#f00' }],
    accountHints: {},
  };
  const againstKnown = buildImportPlan([unknownPurchase], knownCredit, unknownPurchase.smsTs);
  ok('identity resolution: bare card wording reuses one unambiguous known card',
    againstKnown.newAccountCount === 0 && againstKnown.batch.transactions[0]?.accountId === 'adcb1111',
    againstKnown.batch);

  const sameBatch = buildImportPlan([unknownPurchase, creditStatement], BASE, creditStatement.smsTs, new Date(2026, 7, 2));
  ok('identity resolution: bare purchase plus statement creates one account in one scan',
    sameBatch.newAccountCount === 1 &&
      sameBatch.batch.transactions[0]?.accountId === '0' &&
      sameBatch.batch.newDues[0]?.accountId === '0',
    sameBatch.batch);
  ok('identity resolution: statement upgrades the unknown account to credit',
    sameBatch.batch.cardTypes?.['0'] === 'credit', sameBatch.batch.cardTypes);

  const explicitDebit = { ...unknownPurchase, card: { last4: '1111', kind: 'debit' }, raw: 'Debit Card ending 1111' };
  const twoReal = buildImportPlan([explicitDebit, creditStatement], BASE, creditStatement.smsTs, new Date(2026, 7, 2));
  ok('identity safety: explicit debit and credit cards sharing last4 remain separate',
    twoReal.newAccountCount === 2 &&
      twoReal.batch.transactions[0]?.accountId !== twoReal.batch.newDues[0]?.accountId,
    twoReal.batch);

  const ambiguous = {
    ...BASE,
    accounts: [
      { id: 'debit1111', name: 'ADCB Debit Card •1111', kind: 'card', cardType: 'debit', last4: '1111', bankName: 'ADCB', openingFils: 0, color: '#f00' },
      { id: 'credit1111', name: 'ADCB Credit Card •1111', kind: 'card', cardType: 'credit', last4: '1111', bankName: 'ADCB', openingFils: 0, color: '#f00' },
    ],
    accountHints: {},
  };
  const ambiguousPlan = buildImportPlan([unknownPurchase], ambiguous, unknownPurchase.smsTs);
  ok('identity safety: bare wording never guesses between two genuine candidates',
    ambiguousPlan.newAccountCount === 1 &&
      !['debit1111', 'credit1111'].includes(ambiguousPlan.batch.transactions[0]?.accountId),
    ambiguousPlan.batch);

  const secondUnknown = {
    ...unknownPurchase, amountFils: 4700, merchant: 'Bakery',
    smsTs: unknownPurchase.smsTs + 180_000,
  };
  const holdingPlan = buildImportPlan(
    [unknownPurchase, secondUnknown], ambiguous, secondUnknown.smsTs);
  ok('identity safety: repeated ambiguous bare alerts share one holding account',
    holdingPlan.newAccountCount === 1 &&
      holdingPlan.batch.transactions.length === 2 &&
      holdingPlan.batch.transactions.every((t) => t.accountId === '0'),
    holdingPlan.batch);
  const holdingState = {
    ...ambiguous,
    accounts: [
      ...ambiguous.accounts,
      { ...holdingPlan.batch.newAccounts[0], id: 'holding1111' },
    ],
    transactions: holdingPlan.batch.transactions.map((t, index) => ({
      ...t, id: `holding-tx-${index}`, accountId: 'holding1111',
    })),
  };
  const nextUnknown = {
    ...secondUnknown, amountFils: 5900, merchant: 'Bookshop',
    smsTs: secondUnknown.smsTs + 180_000,
  };
  const reusedHolding = buildImportPlan([nextUnknown], holdingState, nextUnknown.smsTs);
  ok('identity safety: a later scan reuses the one generated unknown holding account',
    reusedHolding.newAccountCount === 0 &&
      reusedHolding.batch.transactions[0]?.accountId === 'holding1111',
    reusedHolding.batch);

  const explicitCreditA = {
    ...nextUnknown, amountFils: 6100, merchant: 'Pharmacy',
    card: { last4: '1111', kind: 'credit' }, smsTs: nextUnknown.smsTs + 180_000,
  };
  const explicitCreditB = {
    ...explicitCreditA, amountFils: 7200, merchant: 'Grocer',
    smsTs: explicitCreditA.smsTs + 180_000,
  };
  const typedPastHolding = buildImportPlan(
    [explicitCreditA, explicitCreditB], holdingState, explicitCreditB.smsTs);
  ok('identity safety: an unknown holding never poisons unique explicit credit routing',
    typedPastHolding.newAccountCount === 0 &&
      typedPastHolding.batch.transactions.length === 2 &&
      typedPastHolding.batch.transactions.every((t) => t.accountId === 'credit1111'),
    typedPastHolding.batch);

  const twoExplicitCredits = {
    ...BASE,
    accounts: [
      { id: 'fab3749-a', name: 'FAB Credit Card •3749', kind: 'card', cardType: 'credit', last4: '3749', bankName: 'FAB', openingFils: 0, color: '#09f' },
      { id: 'fab3749-b', name: 'FAB Credit Card •3749', kind: 'card', cardType: 'credit', last4: '3749', bankName: 'FAB', openingFils: 0, color: '#09f' },
    ],
  };
  const creditAlertA = {
    ...explicitCreditA, card: { last4: '3749', kind: 'credit' }, sender: 'FAB',
    smsTs: explicitCreditA.smsTs + 600_000,
  };
  const creditAlertB = {
    ...creditAlertA, amountFils: creditAlertA.amountFils + 100,
    merchant: 'Second purchase', smsTs: creditAlertA.smsTs + 180_000,
  };
  const stagedExplicit = buildImportPlan(
    [creditAlertA, creditAlertB], twoExplicitCredits, creditAlertB.smsTs);
  const stagedRef = stagedExplicit.batch.transactions[0]?.accountId;
  ok('identity safety: ambiguous explicit transactions are retained without account growth',
    stagedExplicit.newAccountCount === 0 && stagedExplicit.txCount === 2 &&
      stagedRef?.startsWith('__unassigned-card__:fab:credit:3749') &&
      stagedExplicit.batch.transactions.every((t) => t.accountId === stagedRef),
    stagedExplicit.batch);
  ok('identity safety: ambiguous staging asserts no hint, bank, type, or snapshot',
    Object.keys(stagedExplicit.batch.newHints).length === 0 &&
      Object.keys(stagedExplicit.batch.bankNames).length === 0 &&
      Object.keys(stagedExplicit.batch.cardTypes).length === 0 &&
      Object.keys(stagedExplicit.batch.snapshots).length === 0,
    stagedExplicit.batch);
  const afterStagedExplicit = apply(twoExplicitCredits, stagedExplicit);
  const stagedExplicitReplay = buildImportPlan(
    [creditAlertA, creditAlertB], afterStagedExplicit, creditAlertB.smsTs);
  ok('identity safety: ambiguous explicit transaction replay is idempotent',
    stagedExplicitReplay.txCount === 0 && stagedExplicitReplay.newAccountCount === 0 &&
      afterStagedExplicit.lastScanTs === creditAlertB.smsTs,
    stagedExplicitReplay.batch);

  const twoLegacyHoldings = {
    ...ambiguous,
    accounts: [
      ...ambiguous.accounts,
      {
        id: 'holding-b', name: 'Card •1111', kind: 'card', last4: '1111',
        openingFils: 0, color: '#999',
      },
      {
        id: 'holding-a', name: 'Card •1111', kind: 'card', last4: '1111',
        openingFils: 0, color: '#999',
      },
    ],
  };
  const cappedHoldingPlan = buildImportPlan(
    [nextUnknown], twoLegacyHoldings, nextUnknown.smsTs);
  ok('identity safety: multiple legacy unknown holdings never mint another account',
    cappedHoldingPlan.newAccountCount === 0 &&
      cappedHoldingPlan.batch.transactions[0]?.accountId === 'holding-a',
    cappedHoldingPlan.batch);
  ok('identity safety: ambiguous holding reuse does not backfill guessed bank identity',
    cappedHoldingPlan.batch.bankNames['holding-a'] === undefined,
    cappedHoldingPlan.batch.bankNames);
}

/* PAN-less statements attach only through one unambiguous sender-bank card. */
{
  const raw = 'Your ADCB credit card statement is ready. Total due AED 714.74, minimum due AED 100.00, due on 18/08/2026.';
  const parsed = parseSms(raw);
  const smsTs = T0 + 5_250_000;
  const oneAdcb = {
    ...BASE,
    accounts: [
      { id: 'adcb-card', name: 'ADCB Credit Card', kind: 'card', cardType: 'credit', bankName: 'ADCB', openingFils: 0, color: '#f00' },
      { id: 'fab-card', name: 'FAB Credit Card', kind: 'card', cardType: 'credit', bankName: 'FAB', openingFils: 0, color: '#09f' },
    ],
  };
  const uniquePlan = buildImportPlan(
    [{ ...parsed, smsTs, sender: 'ADCB', channel: 'inbox' }],
    oneAdcb,
    smsTs,
    new Date(2026, 7, 2),
  );
  ok('PAN-less statement: parser keeps structured due with no invented card',
    parsed?.kind === 'cardStatement' && parsed.card === null && parsed.amountFils === 71474,
    parsed);
  ok('PAN-less statement: unique sender-bank credit card receives the due',
    uniquePlan.dueCount === 1 && uniquePlan.batch.newDues[0]?.accountId === 'adcb-card' &&
      uniquePlan.txCount === 0,
    uniquePlan.batch);
  const ambiguousPlan = buildImportPlan(
    [{ ...parsed, smsTs, sender: 'ADCB', channel: 'inbox' }],
    { ...oneAdcb, accounts: [...oneAdcb.accounts, { ...oneAdcb.accounts[0], id: 'adcb-card-2' }] },
    smsTs,
    new Date(2026, 7, 2),
  );
  ok('PAN-less statement: ambiguous sender-bank cards stay staged',
    ambiguousPlan.dueCount === 0 && ambiguousPlan.txCount === 0 &&
      ambiguousPlan.newAccountCount === 0,
    ambiguousPlan.batch);
}

/* A rescan must move an old card-payment row to the PAN it now recognizes. */
{
  const smsTs = T0 + 5_000_000;
  const payment = {
    kind: 'cardPayment', type: 'expense', amountFils: 744800, currency: 'AED',
    merchant: 'Card •3749 payment', date: '2026-08-05', dueDay: null, minDueFils: null,
    card: { last4: '3749', kind: 'credit' }, reference: null, transferHint: true,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'other', raw: '',
    smsTs, sender: 'FAB', channel: 'inbox',
  };
  const wrong = {
    ...BASE,
    accounts: [
      { id: 'fab3324', name: 'FAB Credit Card •3324', kind: 'card', cardType: 'credit', last4: '3324', bankName: 'FAB', openingFils: 0, color: '#09f' },
      { id: 'fab3749', name: 'FAB Credit Card •3749', kind: 'card', cardType: 'credit', last4: '3749', bankName: 'FAB', openingFils: 0, color: '#09f' },
    ],
    transactions: [{
      id: 'old-pay', type: 'expense', amountFils: 744800, category: 'other', accountId: 'fab3324',
      title: 'Card payment', date: '2026-08-05', source: 'sms', smsKey: `s${smsTs}-744800`, isTransfer: true,
    }],
    accountHints: {},
  };
  const plan = buildImportPlan([payment], wrong, smsTs);
  ok('payment healing: the duplicate is not appended again', plan.txCount === 0, plan.batch.transactions);
  ok('payment healing: Card •3749 payment moves from FAB •3324 to FAB •3749',
    plan.batch.updates.some((u) => u.id === 'old-pay' && u.accountId === 'fab3749' && u.type === 'income'),
    plan.batch.updates);

  const ambiguous = {
    ...wrong,
    accounts: [
      ...wrong.accounts,
      { ...wrong.accounts[1], id: 'fab3749-second' },
    ],
    accountHints: {
      'FAB|credit|3749': 'fab3749',
      '3749': 'fab3749',
    },
  };
  const ambiguousPlan = buildImportPlan([payment], ambiguous, smsTs);
  ok('payment healing: scoped and legacy hints cannot choose between two real cards',
    ambiguousPlan.newAccountCount === 0 &&
      !ambiguousPlan.batch.updates.some((u) => u.id === 'old-pay' && u.accountId),
    ambiguousPlan.batch);

  const unmatchedPayment = {
    ...payment,
    amountFils: 888800,
    smsTs: smsTs + 240_000,
  };
  const stagedPayment = buildImportPlan(
    [unmatchedPayment], ambiguous, unmatchedPayment.smsTs);
  const stagedPaymentRef = stagedPayment.batch.transactions[0]?.accountId;
  ok('payment safety: an ambiguous new card payment is retained without account growth',
    stagedPayment.txCount === 1 && stagedPayment.newAccountCount === 0 &&
      stagedPaymentRef?.startsWith('__unassigned-card__:fab:credit:3749') &&
      stagedPayment.batch.transactions[0]?.type === 'income' &&
      stagedPayment.batch.transactions[0]?.isTransfer === true,
    stagedPayment.batch);
  ok('payment safety: ambiguous staging does not assert an account identity',
    Object.keys(stagedPayment.batch.newHints).length === 0 &&
      Object.keys(stagedPayment.batch.bankNames).length === 0 &&
      Object.keys(stagedPayment.batch.cardTypes).length === 0,
    stagedPayment.batch);
  const afterStagedPayment = apply(ambiguous, stagedPayment);
  const stagedPaymentReplay = buildImportPlan(
    [unmatchedPayment], afterStagedPayment, unmatchedPayment.smsTs);
  ok('payment safety: ambiguous card-payment replay is idempotent',
    stagedPaymentReplay.txCount === 0 && stagedPaymentReplay.newAccountCount === 0 &&
      afterStagedPayment.lastScanTs === unmatchedPayment.smsTs,
    stagedPaymentReplay.batch);

  const ordinary = {
    ...payment,
    kind: 'transaction', type: 'expense', merchant: 'Card purchase',
    transferHint: false, categoryGuess: 'shopping',
  };
  const ordinaryPlan = buildImportPlan([ordinary], ambiguous, smsTs);
  ok('transaction healing: ambiguous duplicate rescan mints no third account',
    ordinaryPlan.newAccountCount === 0 && ordinaryPlan.txCount === 0,
    ordinaryPlan.batch);
  ok('transaction healing: ambiguous duplicate rescan preserves its current account',
    !ordinaryPlan.batch.updates.some((u) => u.id === 'old-pay' && u.accountId),
    ordinaryPlan.batch.updates);

  const uniqueOrdinaryPlan = buildImportPlan([ordinary], wrong, smsTs);
  ok('transaction healing: explicit unique card moves a duplicate off the wrong account',
    uniqueOrdinaryPlan.batch.updates.some(
      (u) => u.id === 'old-pay' && u.accountId === 'fab3749'),
    uniqueOrdinaryPlan.batch.updates);

  const statement = {
    kind: 'cardStatement', type: 'expense', amountFils: 700000, currency: 'AED',
    merchant: 'Card statement', date: '2026-08-20', dueDay: 20, minDueFils: 35000,
    card: { last4: '3749', kind: 'credit' }, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'other', raw: '',
    smsTs: smsTs + 60_000, sender: 'FAB', channel: 'inbox',
  };
  const withKnownDue = {
    ...ambiguous,
    transactions: [],
    cardDues: [{
      id: 'known-due', accountId: 'fab3749', totalDueFils: 700000,
      minDueFils: 35000, dueDate: '2026-08-20', paidFils: 0,
    }],
  };
  const statementRescan = buildImportPlan(
    [statement], withKnownDue, statement.smsTs, new Date(2026, 7, 2));
  ok('statement rescan: unique existing obligation prevents an ambiguous new account',
    statementRescan.newAccountCount === 0, statementRescan.batch);
  ok('statement rescan: identical obligation is not minted again',
    statementRescan.batch.newDues.length === 0, statementRescan.batch.newDues);

  const ungroundedStatement = buildImportPlan(
    [statement], { ...ambiguous, transactions: [], cardDues: [] },
    statement.smsTs, new Date(2026, 7, 2));
  ok('statement import: ambiguous cards without obligation context are refused safely',
    ungroundedStatement.newAccountCount === 0 && ungroundedStatement.dueCount === 0,
    ungroundedStatement.batch);
}

/* Card type learned in this batch is authoritative for identity and snapshots. */
{
  const unknown = {
    kind: 'transaction', type: 'expense', amountFils: 3500, currency: 'AED', merchant: 'Cafe',
    date: '2026-08-03', dueDay: null, minDueFils: null,
    card: { last4: '2468', kind: 'unknown' }, reference: null, transferHint: false,
    snapshotFils: 965000, snapshotKind: 'balance', categoryGuess: 'dining', raw: '',
    smsTs: T0 + 5_300_000, sender: 'ADCB', channel: 'inbox',
  };
  const debit = {
    ...unknown, amountFils: 4600, merchant: 'Fuel',
    card: { last4: '2468', kind: 'debit' }, snapshotFils: null,
    snapshotKind: null, raw: 'Debit Card ending 2468', smsTs: T0 + 5_400_000,
  };
  const credit = {
    kind: 'cardStatement', type: 'expense', amountFils: 3500, currency: 'AED',
    merchant: 'Card statement', date: '2026-08-20', dueDay: 20, minDueFils: 175,
    card: { last4: '2468', kind: 'credit' }, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'other', raw: '',
    smsTs: T0 + 5_500_000, sender: 'ADCB', channel: 'inbox',
  };
  const unknownThenCredit = buildImportPlan(
    [unknown, credit], BASE, credit.smsTs, new Date(2026, 7, 2));
  ok('snapshot identity: unknown balance upgraded later to credit becomes limit',
    unknownThenCredit.batch.snapshots['0']?.kind === 'limit',
    unknownThenCredit.batch.snapshots);
  const creditThenUnknown = buildImportPlan(
    [credit, unknown], BASE, unknown.smsTs, new Date(2026, 7, 2));
  ok('snapshot identity: credit learned first also normalizes later balance to limit',
    creditThenUnknown.batch.snapshots['0']?.kind === 'limit',
    creditThenUnknown.batch.snapshots);

  const debitThenCredit = buildImportPlan(
    [unknown, debit, credit], BASE, credit.smsTs, new Date(2026, 7, 2));
  ok('same-batch type identity: unknown→debit→credit keeps explicit cards separate',
    debitThenCredit.newAccountCount === 2 &&
      debitThenCredit.batch.transactions[0]?.accountId ===
        debitThenCredit.batch.transactions[1]?.accountId &&
      debitThenCredit.batch.newDues[0]?.accountId !==
        debitThenCredit.batch.transactions[0]?.accountId,
    debitThenCredit.batch);
  const creditThenDebit = buildImportPlan(
    [unknown, credit, debit], BASE, debit.smsTs, new Date(2026, 7, 2));
  ok('same-batch type identity: unknown→credit→debit keeps explicit cards separate',
    creditThenDebit.newAccountCount === 2 &&
      creditThenDebit.batch.transactions[0]?.accountId ===
        creditThenDebit.batch.newDues[0]?.accountId &&
      creditThenDebit.batch.transactions[1]?.accountId !==
        creditThenDebit.batch.transactions[0]?.accountId,
    creditThenDebit.batch);
}

/* Structured Arabic debit evidence must survive the import resolver. */
{
  const arabicMada = `مشتريات نقاط البيع
بطاقة: **4567;مدى
من: xx005
مبلغ: 34.00 SAR
لدى: Some restaurant
في: 2019-05-07 23:44`;
  setActiveMarket('SA');
  const parsed = parseSms(arabicMada);
  const plan = buildImportPlan(
    [{ ...parsed, smsTs: T0 + 5_700_000, sender: 'Albilad', channel: 'inbox' }],
    BASE,
    T0 + 5_700_000,
  );
  ok('Arabic Mada import: parser debit kind is preserved through account resolution',
    parsed?.card?.kind === 'debit' &&
      parsed?.amountFils === 3400 && parsed?.currency === 'SAR' &&
      parsed?.date === '2019-05-07' &&
      plan.batch.transactions[0]?.amountFils === 3400 &&
      plan.batch.cardTypes?.['0'] === 'debit' &&
      plan.batch.newAccounts[0]?.cardType === 'debit',
    { parsed, batch: plan.batch });
  setActiveMarket('AE');
}

/* A better SMS may dedupe an edited push, but may not overwrite it. */
{
  const pushTs = T0 + 5_900_000;
  const smsTs = pushTs + 3_000;
  const corrected = {
    ...BASE,
    accounts: [{
      id: 'corrected-account', name: 'My card', kind: 'card', cardType: 'debit',
      last4: '9999', bankName: 'FAB', openingFils: 0, color: '#fff',
    }],
    transactions: [{
      id: 'edited-push', type: 'expense', amountFils: 12000, category: 'utilities',
      accountId: 'corrected-account', title: 'My corrected title', date: '2026-07-20',
      source: 'sms', viaPush: true, smsKey: `s${pushTs}-12000`, ts: pushTs,
      userEdited: true,
    }],
  };
  const incoming = scan([{
    body: 'Purchase of AED 120.00 with Debit Card ending 1234 at CARREFOUR on 20/07/2026',
    ts: smsTs, sender: 'FAB',
  }]).parsed;
  const plan = buildImportPlan(incoming, corrected, smsTs);
  ok('push supersession: fuller SMS adds no duplicate of a user-edited push',
    plan.txCount === 0 && plan.newAccountCount === 0, plan.batch);
  ok('push supersession: corrected title/category/account receive no overwrite patch',
    !plan.batch.updates.some((u) => u.id === 'edited-push'), plan.batch.updates);

  const eventId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const retainedPlan = buildImportPlan(
    incoming.map((row) => ({ ...row, sourceEventId: eventId })),
    corrected,
    smsTs,
  );
  const { applyHealUpdates } = require('./build/heal.js');
  const [identified] = applyHealUpdates(corrected.transactions, retainedPlan.batch.updates);
  ok('history identity promotes on an edited row without changing user-facing corrections',
    identified.title === 'My corrected title' && identified.category === 'utilities' &&
      identified.accountId === 'corrected-account' && identified.smsKey === `h${eventId}` &&
      identified.ts === smsTs && identified.viaPush !== true,
    { identified, updates: retainedPlan.batch.updates });
}

{
  // Two genuine charges of the same amount on the same day are two charges.
  const twice = [
    { body: 'Purchase of AED 35.00 with Debit Card ending 1234 at COSTA COFFEE, DUBAI.', ts: T0 + 200_000 },
    { body: 'Purchase of AED 35.00 with Debit Card ending 1234 at COSTA COFFEE, DUBAI.', ts: T0 + 400_000 },
  ];
  const s = scan(twice);
  const plan = buildImportPlan(s.parsed, afterFirst, s.newestTs);
  ok('two real same-amount charges on one day are two rows', plan.txCount === 2, plan.txCount);
}

{
  const fresh = [{ body: 'Purchase of AED 42.00 with Debit Card ending 1234 at TALABAT, DUBAI.', ts: T0 + 600_000 }];
  const s = scan(fresh);
  const plan = buildImportPlan(s.parsed, afterFirst, s.newestTs);
  ok('a genuinely new message still imports', plan.txCount === 1, plan.txCount);
}

/* ── the user's category rules reach the rows iOS did not parse ─────────
 *
 * "Just future" in the entry sheet was a permanent no-op on iOS. Android
 * honours merchantOverrides inside parseSms (scanInbox passes them through);
 * iOS parses in the Cloudflare Worker, which calls parseSms with no overrides
 * and must keep doing so — the user's category vocabulary is exactly the kind
 * of thing the relay's retention design promises never to hold. So the rule
 * has to be re-applied on arrival, and it was not: recategorise Talabat to
 * Groceries and every later Talabat charge still landed in Dining, forever. */
{
  const TALABAT_TS = T0 + 5_000_000;
  const overrideState = {
    ...BASE,
    accounts: [{
      id: 'cash', name: 'Current account', kind: 'bank', openingFils: 0, color: '#fff',
    }],
    merchantOverrides: { talabat: 'groceries' },
  };
  /** What the Worker hands back: structured row, Message Content discarded. */
  const relayRow = {
    kind: 'transaction', type: 'expense', amountFils: 4200, currency: 'AED',
    merchant: 'Talabat', date: '2026-07-20', dueDay: null, minDueFils: null,
    card: null, reference: null, transferHint: false, snapshotFils: null,
    snapshotKind: null, categoryGuess: 'dining', categoryDeliberate: true,
    raw: undefined, smsTs: TALABAT_TS, sender: 'FAB', channel: 'inbox',
    captureSource: 'shortcut',
  };

  const plan = buildImportPlan([relayRow], overrideState, TALABAT_TS);
  ok('a merchant override reaches a relay row the Worker parsed without it',
    plan.txCount === 1 && plan.batch.transactions[0]?.category === 'groceries',
    plan.batch.transactions[0]);

  // No rule for this merchant: the Worker's own answer stands untouched.
  const unruled = { ...relayRow, merchant: 'Costa Coffee', smsTs: TALABAT_TS + 1000 };
  const unruledPlan = buildImportPlan([unruled], overrideState, unruled.smsTs);
  ok('a relay row with no matching rule keeps the category the Worker gave it',
    unruledPlan.batch.transactions[0]?.category === 'dining',
    unruledPlan.batch.transactions[0]);

  // The rule is keyed the way the store keys it — trimmed and lowercased —
  // so the merchant name as it arrives does not have to match character for
  // character.
  const cased = { ...relayRow, merchant: '  TALABAT  ', smsTs: TALABAT_TS + 2000 };
  const casedPlan = buildImportPlan([cased], overrideState, cased.smsTs);
  ok('the lookup is trimmed and case-folded like setMerchantOverride',
    casedPlan.batch.transactions[0]?.category === 'groceries',
    casedPlan.batch.transactions[0]);
}

/* Android is untouched: it already had the override applied during parsing,
 * and a second pass here would be either redundant or — for any row whose
 * stored title is not the key the parser matched on — actively wrong. `raw`
 * is the discriminator: parseSms always fills it, the relay never can. */
{
  const androidState = {
    ...BASE,
    accounts: [{
      id: 'cash', name: 'Current account', kind: 'bank', openingFils: 0, color: '#fff',
    }],
    merchantOverrides: { spinneys: 'shopping' },
  };
  const body =
    'Purchase of AED 76.50 with Debit Card ending 1234 at SPINNEYS, DUBAI. Avl Balance is AED 4,923.50.';
  const ts = T0 + 5_500_000;

  // Parsed the way scanInbox parses on Android: overrides handed to the
  // parser, raw text retained.
  const withOverride = parseSms(body, androidState.merchantOverrides);
  ok('the Android parser itself is where the override lands',
    withOverride.categoryGuess === 'shopping', withOverride.categoryGuess);
  const androidRow = { ...withOverride, date: '2026-07-20', smsTs: ts, sender: 'ENBD', channel: 'inbox' };
  const plan = buildImportPlan([androidRow], androidState, ts);
  ok('an Android row arrives with its category already decided and is not re-touched',
    plan.batch.transactions[0]?.category === 'shopping',
    plan.batch.transactions[0]);

  // The proof that import time is NOT doing the work on Android: the same
  // message parsed WITHOUT overrides keeps the parser's own answer, because
  // it carries raw. If the override were being applied here regardless of
  // platform, this would come back 'shopping'.
  const plain = parseSms(body);
  const plainRow = { ...plain, date: '2026-07-20', smsTs: ts + 1000, sender: 'ENBD', channel: 'inbox' };
  const plainPlan = buildImportPlan([plainRow], androidState, ts + 1000);
  ok('a row that carries raw is left exactly as the local parser read it',
    plainPlan.batch.transactions[0]?.category === plain.categoryGuess &&
      plain.categoryGuess !== 'shopping',
    { got: plainPlan.batch.transactions[0]?.category, parser: plain.categoryGuess });
}

/* And the rule stops at the user's own hand. "Just future" means future:
 * a row they already corrected is never rewritten by a later import, however
 * confident the override makes the incoming row. */
{
  const ts = T0 + 6_000_000;
  const editedState = {
    ...BASE,
    accounts: [{
      id: 'cash', name: 'Current account', kind: 'bank', openingFils: 0, color: '#fff',
    }],
    merchantOverrides: { talabat: 'groceries' },
    transactions: [{
      id: 'tx-user-said-dining', type: 'expense', amountFils: 4200,
      category: 'dining', accountId: 'cash', title: 'Talabat', date: '2026-07-20',
      source: 'sms', smsKey: `s${ts}-4200`, userEdited: true,
    }],
  };
  const relayRow = {
    kind: 'transaction', type: 'expense', amountFils: 4200, currency: 'AED',
    merchant: 'Talabat', date: '2026-07-20', dueDay: null, minDueFils: null,
    card: null, reference: null, transferHint: false, snapshotFils: null,
    snapshotKind: null, categoryGuess: 'dining', categoryDeliberate: true,
    raw: undefined, smsTs: ts, sender: 'FAB', channel: 'inbox',
    captureSource: 'shortcut',
  };
  const plan = buildImportPlan([relayRow], editedState, ts);
  ok('a hand-corrected row is not recategorised by an override on a later import',
    plan.txCount === 0 && plan.batch.updates.length === 0,
    { txCount: plan.txCount, updates: plan.batch.updates });

  // Same message, same override, but the stored row was the parser's guess
  // rather than the user's. That one may be corrected — it is the identical
  // heal Android gets from a rescan, and refusing it here would leave the two
  // platforms disagreeing about what the user asked for.
  const parserOwned = {
    ...editedState,
    transactions: [{ ...editedState.transactions[0], userEdited: undefined }],
  };
  const healPlan = buildImportPlan([relayRow], parserOwned, ts);
  ok('...while a parser-owned duplicate of the same row is healed to the rule',
    healPlan.txCount === 0 &&
      healPlan.batch.updates.some((u) => u.category === 'groceries'),
    healPlan.batch.updates);
}

/* ── and the rule stops at the direction it was chosen under ─────────────
 *
 * `applyMerchantOverride` is the fourth consumer of the blast-radius rule that
 * `overrideAppliesTo` states in uncategorised.ts, and the only one that was
 * never wired to it. The store's reducer, the categorise screen's count and
 * the entry sheet's count all refuse to put an expense category on a credit —
 * `EXPENSE_CATEGORIES` and `INCOME_CATEGORIES` are disjoint, so the row goes
 * OFF-LIST and the sheet draws the income chips with none of them selected.
 * This path did it anyway, on every iPhone, for every refund of a pinned
 * merchant. */
{
  const ts = T0 + 6_500_000;
  const state = {
    ...BASE,
    accounts: [{
      id: 'cash', name: 'Current account', kind: 'bank', openingFils: 0, color: '#fff',
    }],
    merchantOverrides: { talabat: 'groceries', 'acme payroll': 'salary' },
  };
  const relay = (over) => ({
    kind: 'transaction', type: 'expense', amountFils: 4200, currency: 'AED',
    merchant: 'Talabat', date: '2026-07-20', dueDay: null, minDueFils: null,
    card: null, reference: null, transferHint: false, snapshotFils: null,
    snapshotKind: null, categoryGuess: 'dining', categoryDeliberate: true,
    raw: undefined, sender: 'FAB', channel: 'inbox', captureSource: 'shortcut',
    ...over,
  });

  const refund = relay({ type: 'income', categoryGuess: 'other', smsTs: ts });
  const refundPlan = buildImportPlan([refund], state, ts);
  ok('a Groceries rule does not file the refund of that merchant',
    refundPlan.batch.transactions[0]?.category === 'other',
    refundPlan.batch.transactions[0]);

  // The mirror: an income rule must not reach a purchase either.
  const purchase = relay({ merchant: 'Acme Payroll', categoryGuess: 'other', smsTs: ts + 1000 });
  const purchasePlan = buildImportPlan([purchase], state, ts + 1000);
  ok('a Salary rule does not file a purchase from the same name',
    purchasePlan.batch.transactions[0]?.category === 'other',
    purchasePlan.batch.transactions[0]);

  // Same direction, still applied — the feature this path exists for.
  const credit = relay({
    merchant: 'Acme Payroll', type: 'income', categoryGuess: 'business', smsTs: ts + 2000,
  });
  const creditPlan = buildImportPlan([credit], state, ts + 2000);
  ok('an income rule still reaches a credit from that merchant',
    creditPlan.batch.transactions[0]?.category === 'salary',
    creditPlan.batch.transactions[0]);
}

/* ── the watermark ───────────────────────────────────────────────────── */

{
  // An unhydrated store has no transactions to compare against, so importing
  // into it would duplicate the entire ledger.
  const plan = buildImportPlan(scan(INBOX).parsed, { ...BASE, hydrated: false }, T0);
  ok('nothing imports before the store has hydrated', plan.txCount === 0, plan.txCount);
  ok('and the watermark is not advanced either', plan.batch.lastScanTs === 0, plan.batch.lastScanTs);
}

/* THE VERSION BUMP HAS TO REACH ALREADY-IMPORTED ROWS.
 *
 * Every money fix in the merged parser applies to NEW messages only. A message
 * is imported once — its fingerprint is remembered so it can never arrive
 * again — so a ledger that already holds a AED 10,000 salary filed as an
 * EXPENSE is reached by a PARSER_VERSION bump forcing a full re-read, and by
 * nothing else. The re-read then dedupes against the stored fingerprint and
 * hands the row to healPatch, whose `directionChanged` branch is the only code
 * in the app that can rewrite a stored `type`.
 *
 * Without that branch the bump produces a full re-scan that reads every
 * message correctly and writes none of it back: 21/21 on the money probe, and
 * a AED 20,000 error still sitting on the user's Home screen. */
{
  const { PARSER_VERSION } = require('./build/sms-parser.js');
  const { healPatch, applyHealPatch } = require('./build/heal.js');
  ok('PARSER_VERSION is past 9, so an existing ledger is re-read at all',
    PARSER_VERSION > 9, PARSER_VERSION);

  const body = 'Your salary of AED 10,000.00 has been credited to your account ending 5678 on 01/07/2026.';
  const reread = parseSms(body);
  ok('the merged parser reads a salary credit as INCOME',
    reread && reread.type === 'income' && reread.amountFils === 1000000,
    reread && { t: reread.type, a: reread.amountFils });

  // The row an older parser version left behind.
  const stored = {
    id: 'tx-legacy-salary',
    type: 'expense',
    amountFils: 1000000,
    category: 'other',
    accountId: 'acc-1',
    title: 'Card purchase',
    date: '2026-07-01',
    source: 'sms',
    smsKey: 's1751328000000-1000000',
    isTransfer: false,
    raw: body,
  };
  const patch = healPatch(stored, reread);
  ok('healPatch rewrites the stored direction, not just the title',
    patch && patch.type === 'income', patch);
  const healed = patch ? applyHealPatch(stored, patch) : stored;
  ok('...and the healed row is internally coherent: income, salary, no stale raw',
    healed.type === 'income' && healed.category === 'salary' && healed.raw === undefined,
    { t: healed.type, c: healed.category, raw: healed.raw });

  // A row the user corrected by hand is never re-healed, however wrong the
  // parser now thinks it is — a rescan that undoes their edit teaches them
  // that correcting anything is pointless.
  ok('a hand-edited row is left alone by the same rescan',
    healPatch({ ...stored, userEdited: true }, reread) === null);
}


// ── A real FAB statement and its real payment must settle each other ──
//
// Verbatim from a user's phone. The reported symptom was every statement stuck
// at "NOT settled" with a matching payment sitting on a different card, which
// turned out to be stale rows from a duplicated account list rather than a
// parsing fault. This pins the guarantee so it cannot quietly regress: the
// payment names a masked PAN (5492********3749) and the statement names
// "the card ending with 3749" — two different ways of writing one card, and
// they must land on the same account.
{
  const D = (iso) => new Date(iso + 'T12:00:00Z').getTime();
  const { parsed, newestTs } = scan([
    { body: 'Your statement of the card ending with 3749 dated 01Aug26 has been sent to you and can also be viewed in the new FAB mobile banking app, download it from the App Store goo.gl/FB7qEZ or Google Play goo.gl/7dXnNc. The total amount due is AED 5,645.07. Minimum due is AED 282.25. Due date is 26Aug26',
      ts: D('2026-08-01'), sender: 'FAB' },
    { body: 'Dear Customer, Your payment instructions of AED 5,645.07 to 5492********3749 has been processed on 05/08/2026 20:02',
      ts: D('2026-08-05'), sender: 'FAB' },
  ]);
  ok('both the statement and the payment are read', parsed.length === 2,
    parsed.map((p) => p.kind));

  const plan = buildImportPlan(parsed, BASE, newestTs, new Date('2026-08-07T12:00:00Z'));
  const state = apply(BASE, plan);

  ok('the statement produced exactly one due', state.cardDues.length === 1,
    state.cardDues);
  ok('the due carries the stated total, not the available limit',
    state.cardDues[0]?.totalDueFils === 564507, state.cardDues[0]);
  ok('the due carries the stated minimum',
    state.cardDues[0]?.minDueFils === 28225, state.cardDues[0]);

  // The whole point: a masked PAN and an "ending with" suffix are one card.
  const payment = state.transactions.find((t) => t.isTransfer);
  ok('the payment was filed as a transfer, not spending', Boolean(payment), state.transactions);
  ok('the payment and the statement landed on the SAME card',
    Boolean(payment) && payment.accountId === state.cardDues[0].accountId,
    { payment: payment && payment.accountId, due: state.cardDues[0].accountId });

  const card = state.accounts.find((a) => a.id === state.cardDues[0].accountId);
  ok('and that card is the credit card ending 3749',
    card?.last4 === '3749' && card?.cardType === 'credit', card);

  // Re-reading the same two messages must not double the due or the payment.
  const again = buildImportPlan(scan([
    { body: 'Your statement of the card ending with 3749 dated 01Aug26 has been sent to you and can also be viewed in the new FAB mobile banking app, download it from the App Store goo.gl/FB7qEZ or Google Play goo.gl/7dXnNc. The total amount due is AED 5,645.07. Minimum due is AED 282.25. Due date is 26Aug26',
      ts: D('2026-08-01'), sender: 'FAB' },
    { body: 'Dear Customer, Your payment instructions of AED 5,645.07 to 5492********3749 has been processed on 05/08/2026 20:02',
      ts: D('2026-08-05'), sender: 'FAB' },
  ]).parsed, state, newestTs, new Date('2026-08-07T12:00:00Z'));
  ok('a rescan adds no second copy of either', again.txCount === 0 && again.dueCount === 0,
    { tx: again.txCount, dues: again.dueCount });
}

// ── One card payment, two SMS, hours apart ──────────────────────────────
//
// The bank confirms a card payment twice: once against the account the money
// left, once against the card it arrived on. dedupe.ts pairs the two only if
// they land within 30 minutes of each other, and banks do not promise that —
// a receipt posted the next morning is ordinary. Both rows then allocate, and
// because a statement can only absorb what it owes, the surplus pours into the
// NEXT statement and marks a bill paid that nobody paid.
//
// So the assertion is not "one row in the ledger" — the phantom row is
// dedupe.ts's to prevent, and a ledger already holding one cannot re-scan its
// way out. It is that the money is counted ONCE wherever it is counted: the
// September statement must still be owed, at every gap.
{
  const cardMath = require('./build/cards.js');
  const dedupe = require('./build/dedupe.js');
  const AUG = 'Your FAB Credit Card ending 1234 statement for Aug 2026: Total Amount Due AED 1,000.00, Minimum Amount Due AED 50.00. Payment Due Date 26/08/2026.';
  const SEP = 'Your FAB Credit Card ending 1234 statement for Sep 2026: Total Amount Due AED 800.00, Minimum Amount Due AED 40.00. Payment Due Date 26/09/2026.';
  const DEBIT_LEG = 'Dear Customer, AED 1,000.00 has been debited from your account XXX0004 towards the payment of your Credit Card 1234.';
  const RECEIPT_LEG = 'FAB: Payment of AED 1,000.00 received towards your Credit Card ending 1234. Thank you.';
  const DEBIT_AT = Date.parse('2026-08-26T15:00:00Z');
  const NOW = new Date('2026-09-05T12:00:00Z');

  /** Both statements imported, the way a user's inbox delivers them. */
  const withStatements = () => {
    let state = BASE;
    for (const [body, ts] of [
      [AUG, Date.parse('2026-08-01T06:00:00Z')],
      [SEP, Date.parse('2026-09-01T06:00:00Z')],
    ]) {
      const s = scan([{ body, ts, sender: 'FAB' }]);
      state = apply(state, buildImportPlan(s.parsed, state, s.newestTs, NOW));
    }
    return state;
  };

  const settle = (gapMs) => {
    const s = scan([
      { body: DEBIT_LEG, ts: DEBIT_AT, sender: 'FAB' },
      { body: RECEIPT_LEG, ts: DEBIT_AT + gapMs, sender: 'FAB' },
    ]);
    let state = apply(withStatements(), buildImportPlan(s.parsed, withStatements(), s.newestTs, NOW));
    // The store reconciles captures after every import; do the same here so
    // this measures what survives the real pipeline, not the plan alone.
    state = { ...state, transactions: dedupe.reconcileCaptureDuplicates(state.transactions) };
    const card = state.accounts.find((a) => a.cardType === 'credit');
    const sep = state.cardDues.find((d) => d.dueDate === '2026-09-26');
    return {
      sepAllocated: cardMath.duePaidFils(state, sep),
      open: cardMath.openDues(state, NOW).map((d) => `${d.due.dueDate}:${d.remainingFils}`),
      paidTotal: cardMath.cardStatementView(state, card.id).paidTotalFils,
    };
  };

  const base = settle(5 * 60_000);
  ok('settlement legs 5 minutes apart: September is untouched',
    base.sepAllocated === 0 && base.open.join() === '2026-09-26:80000', base);

  for (const [label, gapMs] of [
    ['31 minutes', 31 * 60_000],
    ['four hours', 4 * 3_600_000],
    ['the next morning', 17 * 3_600_000],
  ]) {
    const out = settle(gapMs);
    ok(`settlement legs ${label} apart do not also settle September`,
      out.sepAllocated === 0 && out.open.join() === '2026-09-26:80000', out);
    ok(`settlement legs ${label} apart are one AED 1,000 payment on the sheet`,
      out.paidTotal === 100000, out);
  }

  // "Mark paid" is a claim about a payment the bank is about to confirm. It is
  // stamped with the device's today; the receipt carries the provider's date,
  // so an evening payment routinely skews the two by a day. dedupe.ts matches
  // a manual row on its exact date only, and that one day of skew used to buy
  // the user a second AED 1,000 payment.
  const markedPaid = () => {
    const state = withStatements();
    const card = state.accounts.find((a) => a.cardType === 'credit');
    return {
      ...state,
      // payCardDue (store.tsx) records the transfer and leaves paidFils alone.
      transactions: [
        { id: 'manual-paid', type: 'income', amountFils: 100000, category: 'other',
          accountId: card.id, title: 'FAB Credit Card •1234 payment',
          date: '2026-08-26', source: 'manual', isTransfer: true },
        ...state.transactions,
      ],
      cardDues: state.cardDues.map((d) =>
        d.dueDate === '2026-08-26' ? { ...d, settledAt: '2026-08-26T20:00:00.000Z' } : d),
    };
  };

  for (const [label, at] of [
    ['the same evening', '2026-08-26T18:00:00Z'],
    ['the next morning', '2026-08-27T08:00:00Z'],
  ]) {
    const before = markedPaid();
    const s = scan([{ body: RECEIPT_LEG, ts: Date.parse(at), sender: 'FAB' }]);
    const state = apply(before, buildImportPlan(s.parsed, before, s.newestTs, NOW));
    const card = state.accounts.find((a) => a.cardType === 'credit');
    const sep = state.cardDues.find((d) => d.dueDate === '2026-09-26');
    const view = cardMath.cardStatementView(state, card.id);
    ok(`Mark paid plus the bank's receipt ${label} is one payment, not two`,
      cardMath.duePaidFils(state, sep) === 0 && view.paidTotalFils === 100000,
      { sep: cardMath.duePaidFils(state, sep), paidTotal: view.paidTotalFils,
        payments: view.payments.map((t) => `${t.date}|${t.source}`) });
  }

  // The other direction: two genuine payments of the same size, each split
  // across a debit and a receipt leg, are still two payments.
  const twoGenuine = (() => {
    const state = withStatements();
    const card = state.accounts.find((a) => a.cardType === 'credit');
    const leg = (id, date, side) => ({
      id, type: 'income', amountFils: 100000, category: 'other', accountId: card.id,
      title: 'Card payment', date, source: 'sms', isTransfer: true, cardPaymentSide: side,
      ts: Date.parse(`${date}T12:00:00Z`),
    });
    const full = { ...state, transactions: [
      leg('a-debit', '2026-08-26', 'debit'), leg('a-receipt', '2026-08-26', 'receipt'),
      leg('b-debit', '2026-08-27', 'debit'), leg('b-receipt', '2026-08-27', 'receipt'),
    ] };
    return cardMath.cardStatementView(full, card.id).paidTotalFils;
  })();
  ok('two same-size payments, each in two legs, are still AED 2,000',
    twoGenuine === 200000, twoGenuine);
}

// ── A minimum the bank restates ─────────────────────────────────────────
//
// Math.max between two figures the bank BOTH stated meant a correction
// downward never landed, and `belowMinimum` went on accusing the user of
// underpaying against a figure the bank itself had superseded. Between two
// guesses there is no newer and no better, so the larger still wins.
{
  const cardMath = require('./build/cards.js');
  const card = { id: 'C', name: 'FAB Credit Card •1234', kind: 'card', cardType: 'credit',
    last4: '1234', bankName: 'FAB', openingFils: 0, color: '#fff' };
  const due = (id, minDueFils, extra) => ({ id, accountId: 'C', totalDueFils: 100000,
    minDueFils, dueDate: '2026-08-26', paidFils: 0, ...extra });
  const minOf = (a, b) => cardMath.mergeImportedCardDues([a], [b], [card])[0].minDueFils;

  ok('a minimum the bank revises down replaces the one it revised',
    minOf(due('d1', 20000), due('d2', 5000)) === 5000);
  ok('a minimum the bank revises up replaces it too',
    minOf(due('d1', 5000), due('d2', 20000)) === 20000);
  ok('a stated minimum still beats an estimate, whichever arrived first',
    minOf(due('d1', 20000), due('d2', 5000, { minDueEstimated: true })) === 20000 &&
      minOf(due('d1', 5000, { minDueEstimated: true }), due('d2', 20000)) === 20000);
  ok('two positive estimates still take the larger',
    minOf(due('d1', 5000, { minDueEstimated: true }),
      due('d2', 7000, { minDueEstimated: true })) === 7000);
  ok('an explicit newer unknown estimate removes an older invented fallback',
    minOf(due('d1', 5000, { minDueEstimated: true }),
      due('d2', 0, { minDueEstimated: true })) === 0);

  // The whole point of the estimate flag: a guess must never be quoted back
  // as the bank's figure, and must never make the user look delinquent.
  const stated = cardMath.mergeImportedCardDues(
    [due('d1', 20000)], [due('d2', 5000)], [card])[0];
  ok('the merged row is still marked as a figure, not a guess',
    stated.minDueEstimated === undefined, stated);
}

/* ── one push row can only ever be ONE charge ──────────────────────────
 *
 * Five defects, all of which end the same way: two real charges become one
 * row and the money silently leaves the ledger. The constraint every case
 * below encodes is that under-merging (a visible duplicate the user can
 * delete) is always preferable to over-merging (a charge that vanishes).
 */
{
  const { duplicateGuard, reconcileCaptureDuplicates } = require('./build/dedupe.js');

  const D0 = Date.parse('2026-07-10T09:00:00Z');
  const pushRow = (extra) => ({
    id: 'push-1', type: 'expense', amountFils: 2500, category: 'other',
    accountId: 'fab', title: 'Card purchase', date: '2026-07-10',
    source: 'sms', viaPush: true, smsKey: `s${D0}-2500`, ts: D0, ...extra,
  });

  /* 1 — a push row supersedes ONCE. It described one charge, not every
   *     charge of that value in the next two minutes. */
  {
    const guard = duplicateGuard([pushRow()]);
    const starbucks = {
      date: '2026-07-10', amountFils: 2500, title: 'Starbucks', type: 'expense',
      smsKey: `s${D0 + 10_000}-2500`, ts: D0 + 10_000, channel: 'inbox',
    };
    ok('supersession: the first SMS claims the push row',
      guard.supersedes(starbucks) === 'push-1', guard.supersedes(starbucks));
    guard.consume('push-1');
    guard.add(starbucks);
    const costa = {
      date: '2026-07-10', amountFils: 2500, title: 'Costa', type: 'expense',
      smsKey: `s${D0 + 90_000}-2500`, ts: D0 + 90_000, channel: 'inbox',
    };
    ok('supersession: a consumed push row cannot be superseded a second time',
      guard.supersedes(costa) === null, guard.supersedes(costa));
    ok('supersession: the second genuine charge is not a duplicate either',
      !guard.has(costa));
  }

  /* 1b — the same thing through the real import path. Two AED 25 charges
   *      must not collapse into one patch against a single push row. */
  {
    const state = {
      ...BASE,
      accounts: [{
        id: 'fab', name: 'FAB Debit •1234', kind: 'card', cardType: 'debit',
        last4: '1234', bankName: 'FAB', openingFils: 0, color: '#fff',
      }],
      accountHints: { 1234: 'fab' },
      transactions: [pushRow()],
    };
    const incoming = scan([
      { body: 'Purchase of AED 25.00 with Debit Card ending 1234 at STARBUCKS, DUBAI.', ts: D0 + 10_000 },
      { body: 'Purchase of AED 25.00 with Debit Card ending 1234 at COSTA COFFEE, DUBAI.', ts: D0 + 90_000 },
    ]);
    const plan = buildImportPlan(incoming.parsed, state, incoming.newestTs);
    ok('supersession: two SMS charges over one push row leave one new row plus one patch',
      plan.txCount === 1 && plan.batch.updates.length === 1,
      { txCount: plan.txCount, updates: plan.batch.updates, txs: plan.batch.transactions });
    const after = apply(state, plan);
    const total = after.transactions
      .filter((t) => t.type === 'expense')
      .reduce((n, t) => n + t.amountFils, 0);
    ok('supersession: both AED 25 charges survive the import',
      after.transactions.length === 2 && total === 5000,
      after.transactions.map((t) => [t.title, t.amountFils]));
  }

  /* 2 — a merged push/SMS pair must stop being a push row. A persisted SMS
   *     row has NO viaPush key at all (JSON drops undefined), so the spread
   *     that built the merged row could not clear the push row's `true`, and
   *     the resurrected row went on eating charges on every later hydrate. */
  {
    const push = pushRow({ id: 'p1', title: 'Coffee' });
    // exactly what AsyncStorage hands back: no viaPush key
    const sms = JSON.parse(JSON.stringify({
      ...push, id: 's1', viaPush: undefined, title: 'Coffee',
      smsKey: `s${D0 + 5_000}-2500`, ts: D0 + 5_000,
    }));
    const merged = reconcileCaptureDuplicates([push, sms]);
    ok('hydrate: a push/SMS pair still becomes one row',
      merged.length === 1 && merged[0].id === 's1', merged);
    ok('hydrate: the merged row no longer claims to be a push capture',
      merged[0].viaPush !== true, merged[0]);
    const genuine = {
      ...sms, id: 's2', title: 'Costa', amountFils: 2500,
      ts: D0 + 65_000, smsKey: `s${D0 + 65_000}-2500`,
    };
    ok('hydrate: the merged row does not swallow a later genuine charge',
      reconcileCaptureDuplicates([...merged, genuine]).length === 2,
      reconcileCaptureDuplicates([...merged, genuine]));
  }

  /* 3 — cross-channel pairing may ignore the merchant only when one side
   *     names none. Two SPECIFIC titles are two merchants. */
  {
    const guard = duplicateGuard([pushRow({ id: 'generic', title: 'Card purchase' })]);
    ok('cross-channel: a generic push title still pairs with a specific SMS',
      guard.supersedes({
        date: '2026-07-10', amountFils: 2500, title: 'Costa', type: 'expense',
        smsKey: `s${D0 + 60_000}-2500`, ts: D0 + 60_000, channel: 'inbox',
      }) === 'generic');

    const named = duplicateGuard([pushRow({ id: 'named', title: 'Starbucks' })]);
    ok('cross-channel: two different named merchants never pair',
      named.supersedes({
        date: '2026-07-10', amountFils: 2500, title: 'Costa', type: 'expense',
        smsKey: `s${D0 + 60_000}-2500`, ts: D0 + 60_000, channel: 'inbox',
      }) === null);

    // and the same asymmetry the other way: an SMS row must not silently
    // absorb the push about a DIFFERENT merchant of the same value.
    const smsFirst = duplicateGuard([{
      id: 'sms-first', type: 'expense', amountFils: 2500, category: 'dining',
      accountId: 'fab', title: 'Costa', date: '2026-07-10', source: 'sms',
      smsKey: `s${D0}-2500`, ts: D0,
    }]);
    ok('cross-channel: a push naming another merchant is not dropped',
      !smsFirst.has({
        date: '2026-07-10', amountFils: 2500, title: 'Starbucks', type: 'expense',
        smsKey: `s${D0 + 60_000}-2500`, ts: D0 + 60_000, channel: 'push',
      }));
    ok('cross-channel: a push about the same merchant is still dropped',
      duplicateGuard([{
        id: 'sms-first', type: 'expense', amountFils: 2500, category: 'dining',
        accountId: 'fab', title: 'Costa', date: '2026-07-10', source: 'sms',
        smsKey: `s${D0}-2500`, ts: D0,
      }]).has({
        date: '2026-07-10', amountFils: 2500, title: 'Costa Coffee', type: 'expense',
        smsKey: `s${D0 + 60_000}-2500`, ts: D0 + 60_000, channel: 'push',
      }));
  }

  /* 3b — dedupe.ts restates sms-parser's STRUCTURAL_TITLES rather than
   *      importing it (db.test.js pins that it has no dependencies), so the
   *      copy has to be held to the original. A title the parser assigns from
   *      the shape of a message names no merchant and must never be compared
   *      to one. */
  {
    const { STRUCTURAL_TITLES } = require('./build/sms-parser.js');
    const { sameMerchantCapture } = require('./build/dedupe.js');
    const missed = [...STRUCTURAL_TITLES].filter(
      (t) => !sameMerchantCapture(t, 'Some Specific Merchant'),
    );
    ok('cross-channel: every structural parser title counts as naming no merchant',
      missed.length === 0, missed);
    ok('cross-channel: a real merchant name is still not generic',
      !sameMerchantCapture('Starbucks', 'Costa'));
  }

  /* 4 — a manually logged row carries no event clock. It explains the ONE
   *     message about it, not every identical charge for the rest of the day. */
  {
    const manual = {
      id: 'manual-salik', type: 'expense', amountFils: 40000, category: 'transport',
      accountId: 'fab', title: 'Salik', date: '2026-07-10', source: 'manual',
    };
    const guard = duplicateGuard([manual]);
    const topUp = (ts) => ({
      date: '2026-07-10', amountFils: 40000, title: 'Salik', type: 'expense',
      smsKey: `s${ts}-40000`, ts, channel: 'inbox',
    });
    ok('timeless: the SMS for a manually logged charge is still dropped',
      guard.has(topUp(D0)));
    ok('timeless: a genuine repeat nine hours later is NOT dropped',
      !guard.has(topUp(D0 + 9 * 3_600_000)),
      'a manual row with no timestamp blocked every later identical charge');
  }

  /* 5 — the two captures of one settlement can straddle midnight. Seconds
   *     apart is one event whichever calendar day each landed on; minutes
   *     apart is still two (unit.test.js pins the 3-minute case). */
  {
    const midnight = Date.parse('2026-07-11T00:00:00Z');
    const side = (ts, date) => ({
      date, amountFils: 400000, title: 'Card •3749 payment', type: 'income',
      smsKey: `s${ts}-400000`, ts, channel: 'inbox', accountId: 'fab-3749',
      eventKind: 'cardPayment', cardPaymentSide: 'receipt',
    });
    const guard = duplicateGuard([]);
    guard.add(side(midnight - 2_000, '2026-07-10'));
    ok('midnight: the second capture of one settlement is not a second payment',
      guard.has(side(midnight + 3_000, '2026-07-11')));

    const apart = duplicateGuard([]);
    apart.add(side(midnight - 2_000, '2026-07-10'));
    ok('midnight: two settlements three minutes apart stay two payments',
      !apart.has(side(midnight + 178_000, '2026-07-11')));
  }
}

/* ── FAB: two messages, one statement, two card identities ───────────────
 *
 * The whole path, from the bank's own wording through the real parser and the
 * real planner to the figure a user reads on Home. FAB sends this statement
 * twice: once naming the card, once in a reminder that quotes a number which
 * is not the card's last four. The second one mints a card that has never had
 * a transaction of any kind and books the statement against it a second time,
 * so the payment settles the real copy and the phantom copy is still billed.
 *
 * This is not a parser bug — both messages are read correctly, and each names
 * the digits it names. It is decided after the batch lands, which is why the
 * repair is in accounts.ts and this test drives the store's own sequence. */
{
  const acc = require('./build/accounts.js');
  const cardsLib = require('./build/cards.js');

  const T = (iso) => Date.parse(iso);
  const FAB_INBOX = [
    { body: 'Credit Card Purchase \nCard No XXXX3749 \nAED 12.64 \nALLDEBRID DUBAI ARE \n02/08/26 11:16 \nAvl Bal AED 4142.86',
      ts: T('2026-08-02T11:16:00Z'), sender: 'FAB' },
    { body: 'Your statement of the card ending with 3749 dated 01Aug26 has been sent to you and can also be viewed in the new FAB mobile banking app, download it from the App Store goo.gl/FB7qEZ. The total amount due is AED 5,645.07. Minimum due is AED 282.25. Due date is 26Aug26',
      ts: T('2026-08-01T06:00:00Z'), sender: 'FAB' },
    { body: 'Dear Customer, the payment due date of your FAB Credit Card ending with 5793 is 26-08-2026. The total amount due is AED 5,645.07 and the Minimum due amount is AED 282.25. Please ignore the message, if already paid.',
      ts: T('2026-08-03T06:00:00Z'), sender: 'FAB' },
    { body: 'Your payment instructions of AED 5,645.07 to 5492********3749 has been processed',
      ts: T('2026-08-05T09:00:00Z'), sender: 'FAB' },
  ];

  const s = scan(FAB_INBOX);
  const imported = apply(BASE, buildImportPlan(s.parsed, BASE, s.newestTs));
  const named = (state, id) => state.accounts.find((a) => a.id === id)?.name;

  ok('FAB: the reminder mints a second card row for one statement',
    imported.accounts.length === 2 &&
      imported.accounts.map((a) => a.last4).sort().join(',') === '3749,5793',
    imported.accounts.map((a) => a.name));
  ok('FAB: and a second copy of the statement against it',
    imported.cardDues.length === 2 &&
      imported.cardDues.every((d) => d.totalDueFils === 564507 && d.dueDate === '2026-08-26'),
    imported.cardDues);
  ok('FAB: the payment is read as a card payment and lands on the real card',
    imported.transactions.some(
      (t) => t.isTransfer && t.amountFils === 564507 && named(imported, t.accountId) === 'FAB Credit Card •3749'),
    imported.transactions.map((t) => [t.title, named(imported, t.accountId)]));

  const before = cardsLib.openDues(imported, new Date('2026-08-08T09:00:00Z'));
  ok('FAB repro: the paid statement is billed a second time on a card with no history',
    before.length === 1 &&
      before[0].remainingFils === 564507 &&
      named(imported, before[0].due.accountId) === 'FAB Credit Card •5793',
    before.map((d) => [named(imported, d.due.accountId), d.remainingFils]));

  // What store.tsx does with the batch once it has landed.
  const repaired = acc.repairDuplicateStatements(imported);
  const after = cardsLib.openDues(repaired, new Date('2026-08-08T09:00:00Z'));
  ok('FAB fixed: nothing is owed, because the payment covered the statement',
    after.length === 0, after.map((d) => [named(repaired, d.due.accountId), d.remainingFils]));
  ok('FAB fixed: both card rows are still there for the user to reconcile',
    repaired.accounts.length === 2 && repaired.cardDues.length === 2,
    repaired.accounts.map((a) => a.name));
}

/* ── utility reminders survive routine capture ───────────────────────── */
{
  const utilityFlow = scan([
    {
      body: 'Dear Customer, AED 12,168.00 has been debited from your account 095XXX11XXX01 towards instant transfer. The available balance is AED 15,000.00.',
      ts: Date.parse('2026-08-01T14:25:32Z'),
      sender: 'Liv',
    },
    {
      body: 'Dear Customer, Your payment instructions of AED 12168.00 to Fishbasket for consumer number 1318124036 has been processed on 01/08/2026 18:27',
      ts: Date.parse('2026-08-01T14:27:27Z'),
      sender: 'FAB',
    },
  ]);
  const utilityFlowPlan = buildImportPlan(
    utilityFlow.parsed,
    {
      ...BASE,
      accounts: [{
        id: 'bank-account', name: 'Bank account', kind: 'bank', openingFils: 0, color: '#fff',
      }],
    },
    utilityFlow.newestTs,
    new Date('2026-08-12T12:00:00Z'),
  );
  ok('the durable import carries both sides of the linked bill-payment flow',
    utilityFlowPlan.batch.transactions.length === 2 &&
      utilityFlowPlan.batch.transactions.some((row) =>
        row.paymentFlowSide === 'funding' && row.isTransfer === true) &&
      utilityFlowPlan.batch.transactions.some((row) =>
        row.paymentFlowSide === 'receipt' && row.title === 'Fishbasket' &&
        row.billIdentity === 'consumer:4036'),
    utilityFlowPlan.batch.transactions);
  const cardlessReceipt = utilityFlowPlan.batch.transactions.find(
    (row) => row.paymentFlowSide === 'receipt',
  );
  ok('a cardless bill receipt does not promote its fallback account to payment evidence',
    cardlessReceipt?.paymentInstrumentSource === undefined,
    cardlessReceipt);

  const statedCardReceipt = {
    ...utilityFlow.parsed[1],
    smsTs: Date.parse('2026-08-02T14:27:27Z'),
    date: '2026-08-02',
    card: { last4: '5444', kind: 'credit' },
  };
  const statedCardPlan = buildImportPlan(
    [statedCardReceipt],
    {
      ...BASE,
      accounts: [{
        id: 'fab-card', name: 'FAB Credit Card •5444', kind: 'card', bankName: 'FAB',
        last4: '5444', cardKind: 'credit', openingFils: 0, color: '#fff',
      }],
    },
    statedCardReceipt.smsTs,
    new Date('2026-08-12T12:00:00Z'),
  );
  ok('a bill receipt that explicitly states a card preserves that proof for history',
    statedCardPlan.batch.transactions.length === 1 &&
      statedCardPlan.batch.transactions[0].accountId === 'fab-card' &&
      statedCardPlan.batch.transactions[0].paymentInstrumentSource === 'alert',
    statedCardPlan.batch.transactions);

  const statedSmsKey = `s${statedCardReceipt.smsTs}-${statedCardReceipt.amountFils}`;
  const legacyStatedReceipt = {
    ...statedCardPlan.batch.transactions[0],
    id: 'legacy-stated-receipt', smsKey: statedSmsKey,
    paymentInstrumentSource: undefined,
  };
  const statedCardReread = buildImportPlan(
    [statedCardReceipt],
    {
      ...BASE,
      accounts: [{
        id: 'fab-card', name: 'FAB Credit Card •5444', kind: 'card', bankName: 'FAB',
        last4: '5444', cardType: 'credit', openingFils: 0, color: '#fff',
      }],
      transactions: [legacyStatedReceipt],
    },
    statedCardReceipt.smsTs,
    new Date('2026-08-12T12:00:00Z'),
  );
  ok('a unique-card reread heals payment-instrument provenance onto a legacy receipt',
    statedCardReread.txCount === 0 &&
      statedCardReread.batch.updates.some((row) =>
        row.id === legacyStatedReceipt.id && row.paymentInstrumentSource === 'alert'),
    statedCardReread.batch.updates);

  const ambiguousStatedReread = buildImportPlan(
    [statedCardReceipt],
    {
      ...BASE,
      accounts: [
        {
          id: 'fab-card-a', name: 'FAB Credit Card A •5444', kind: 'card', bankName: 'FAB',
          last4: '5444', cardType: 'credit', openingFils: 0, color: '#fff',
        },
        {
          id: 'fab-card-b', name: 'FAB Credit Card B •5444', kind: 'card', bankName: 'FAB',
          last4: '5444', cardType: 'credit', openingFils: 0, color: '#fff',
        },
      ],
      transactions: [{ ...legacyStatedReceipt, accountId: 'fab-card-a' }],
    },
    statedCardReceipt.smsTs,
    new Date('2026-08-12T12:00:00Z'),
  );
  ok('an ambiguous same-bank same-suffix reread never blesses the retained account as proven',
    ambiguousStatedReread.txCount === 0 &&
      !ambiguousStatedReread.batch.updates.some((row) =>
        row.id === legacyStatedReceipt.id && row.paymentInstrumentSource === 'alert'),
    ambiguousStatedReread.batch.updates);

  const legacyPushState = {
    ...BASE,
    accounts: [{
      id: 'bank-account', name: 'Bank account', kind: 'bank', openingFils: 0, color: '#fff',
    }],
    transactions: [
      {
        id: 'old-funding', type: 'expense', amountFils: 1216800, category: 'other',
        accountId: 'bank-account', title: 'Outgoing transfer', date: '2026-08-01',
        source: 'sms', viaPush: true, isTransfer: true,
        ts: Date.parse('2026-08-01T14:25:30Z'), smsKey: 's1785594330000-1216800',
      },
      {
        id: 'old-receipt', type: 'expense', amountFils: 1216800, category: 'other',
        accountId: 'bank-account', title: 'Fishbasket', date: '2026-08-01',
        source: 'sms', viaPush: true,
        ts: Date.parse('2026-08-01T14:27:25Z'), smsKey: 's1785594445000-1216800',
      },
    ],
  };
  const legacyPushPlan = buildImportPlan(
    utilityFlow.parsed,
    legacyPushState,
    utilityFlow.newestTs,
    new Date('2026-08-12T12:00:00Z'),
  );
  const { applyHealUpdates } = require('./build/heal.js');
  const { reconcilePaymentFlows } = require('./build/payment-flow.js');
  const healedLegacyPush = reconcilePaymentFlows(
    applyHealUpdates(legacyPushState.transactions, legacyPushPlan.batch.updates),
  );
  ok('a parser-version reread repairs and collapses both legacy notification rows',
    legacyPushPlan.txCount === 0 &&
      legacyPushPlan.batch.updates.some((row) => row.paymentFlowSide === 'funding') &&
      legacyPushPlan.batch.updates.some((row) =>
        row.paymentFlowSide === 'receipt' && row.billIdentity === 'consumer:4036') &&
      healedLegacyPush.length === 1 && healedLegacyPush[0].title === 'Fishbasket' &&
      healedLegacyPush[0].billIdentity === 'consumer:4036',
    { updates: legacyPushPlan.batch.updates, rows: healedLegacyPush });

  const manualFlowState = {
    ...legacyPushState,
    transactions: [{
      id: 'manual-fishbasket', type: 'expense', amountFils: 1216800, category: 'utilities',
      accountId: 'chosen-account', title: 'Fishbasket', date: '2026-08-01',
      source: 'manual', ts: Date.parse('2026-08-01T14:27:25Z'),
    }],
  };
  const manualFlowPlan = buildImportPlan(
    [utilityFlow.parsed[1]],
    manualFlowState,
    utilityFlow.newestTs,
    new Date('2026-08-12T12:00:00Z'),
  );
  ok('a matching manual bill stays deduped without parser metadata or account reassignment',
    manualFlowPlan.txCount === 0 &&
      !manualFlowPlan.batch.updates.some((row) => row.id === 'manual-fishbasket'),
    manualFlowPlan.batch);

  const talabatTs = Date.parse('2026-08-11T08:00:00Z');
  const talabatBody = 'AED 1,165.33 has been credited to your account. B/O DELIVERY HERO TALABAT DB LLC Talabat Biweekly Payment till 10-Aug-2026.';
  const talabatParsed = parseSms(talabatBody, undefined, { sender: 'Liv' });
  const talabat = {
    parsed: talabatParsed ? [{ ...talabatParsed, smsTs: talabatTs, sender: 'Liv', channel: 'inbox' }] : [],
    newestTs: talabatTs,
  };
  const talabatPlan = buildImportPlan(
    talabat.parsed,
    {
      ...BASE,
      accounts: [{
        id: 'liv-account', name: 'Liv Account', kind: 'bank', bankName: 'Liv',
        openingFils: 0, color: '#fff',
      }],
    },
    talabat.newestTs,
    new Date('2026-08-12T12:00:00Z'),
  );
  ok('a Talabat merchant settlement reaches the durable ledger as income',
    talabatPlan.batch.transactions.length === 1 &&
      talabatPlan.batch.transactions[0].title === 'Talabat sales' &&
      talabatPlan.batch.transactions[0].type === 'income' &&
      talabatPlan.batch.transactions[0].category === 'business' &&
      talabatPlan.batch.transactions[0].isTransfer !== true,
    talabatPlan.batch.transactions);

  const current = scan([{
    body: 'Dear Customer, The due date for your e& bill is nearing. A total amount of AED 775.81 including VAT is due on 15-08-2026. To pay your bill, please visit businessonline.etisalat.ae/quickpay.',
    ts: Date.parse('2026-08-10T08:00:00Z'),
    sender: 'Etisalat',
  }]);
  const currentPlan = buildImportPlan(
    current.parsed,
    BASE,
    current.newestTs,
    new Date('2026-08-12T12:00:00Z'),
  );
  ok('a current utility reminder is part of the same durable import batch',
    currentPlan.batch.newBills?.length === 1 &&
      currentPlan.batch.newBills[0].title === 'E&' &&
      currentPlan.batch.newBills[0].category === 'telecom' &&
      currentPlan.batch.newBills[0].dueDay === 15,
    currentPlan.batch.newBills);

  const twoAccounts = scan([
    {
      body: 'Dear Customer, Bill amount for your account 5557118 is AED 100.00, billed on 07-Aug-26. Please pay by 22-Aug-26. https://sewa.gov.ae',
      ts: Date.parse('2026-08-07T08:00:00Z'), sender: 'SEWA',
    },
    {
      body: 'Dear Customer, Bill amount for your account 9992442 is AED 200.00, billed on 08-Aug-26. Please pay by 23-Aug-26. https://sewa.gov.ae',
      ts: Date.parse('2026-08-08T08:00:00Z'), sender: 'SEWA',
    },
  ]);
  const twoAccountPlan = buildImportPlan(
    twoAccounts.parsed, BASE, twoAccounts.newestTs, new Date('2026-08-12T12:00:00Z'),
  );
  ok('two current accounts at one utility remain two durable reminders',
    twoAccountPlan.batch.newBills?.length === 2 &&
      new Set(twoAccountPlan.batch.newBills.map((bill) => bill.importIdentity)).size === 2,
    twoAccountPlan.batch.newBills);

  const changingInvoices = scan([
    {
      body: 'Your DEWA bill of AED 450.00 is due on 25/07/2026. Reference No: INV20260711.',
      ts: Date.parse('2026-07-20T08:00:00Z'), sender: 'DEWA',
    },
    {
      body: 'Your DEWA bill of AED 450.00 is due on 25/08/2026. Reference No: INV20260822.',
      ts: Date.parse('2026-08-10T08:00:00Z'), sender: 'DEWA',
    },
  ]);
  const invoicePlan = buildImportPlan(
    changingInvoices.parsed, BASE, changingInvoices.newestTs, new Date('2026-08-12T12:00:00Z'),
  );
  ok('changing invoice references never create a second monthly reminder',
    invoicePlan.batch.newBills?.length === 1 &&
      invoicePlan.batch.newBills[0].importIdentity === undefined &&
      invoicePlan.batch.newBills[0].dueDay === 25,
    invoicePlan.batch.newBills);

  const old = scan([{
    body: 'Dear Customer, Bill amount for your account 5557118 is AED 785.40, billed on 07-Jan-22. Please pay by 22-Jan-22. Click here to view SEWA magazine https://sewa.gov.ae',
    ts: Date.parse('2022-01-07T08:00:00Z'),
    sender: 'SEWA',
  }]);
  const oldPlan = buildImportPlan(
    old.parsed,
    BASE,
    old.newestTs,
    new Date('2026-08-12T12:00:00Z'),
  );
  ok('a full reread does not resurrect a years-old utility reminder',
    oldPlan.batch.newBills?.length === 0,
    oldPlan.batch.newBills);
}

{
  ok('the provider-duplicate repair forces an upgrade reread',
    PARSER_VERSION >= 29,
    PARSER_VERSION);

  const duplicateState = {
    ...BASE,
    accounts: [{
      id: 'fab-0004', name: 'FAB Account •0004', kind: 'bank', openingFils: 0, color: '#fff',
    }],
    transactions: [
      {
        id: 'canonical-1405', type: 'income', amountFils: 140500, category: 'other',
        accountId: 'fab-0004', title: 'Incoming transfer', date: '2026-08-12',
        source: 'sms', smsKey: 'ha30850', ts: 1786544431861,
      },
      {
        id: 'duplicate-1405', type: 'income', amountFils: 140500, category: 'other',
        accountId: 'fab-0004', title: 'Incoming transfer', date: '2026-08-12',
        source: 'sms', smsKey: 'ha30849', ts: 1786544431105,
      },
    ],
  };
  const duplicateRepair = buildImportPlan(
    [],
    duplicateState,
    1786544431861,
    new Date('2026-08-14T12:00:00Z'),
    [{
      smsTs: 1786544431105,
      sender: 'FAB',
      channel: 'inbox',
      sourceEventId: 'a30849',
      reason: 'exact-provider-duplicate',
    }],
  );
  ok('a full reread retires only the proven duplicate Android provider identity',
    duplicateRepair.txCount === 0 &&
      duplicateRepair.batch.updates.length === 1 &&
      duplicateRepair.batch.updates[0].id === 'duplicate-1405' &&
      duplicateRepair.batch.updates[0].remove === true,
    duplicateRepair.batch.updates);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
