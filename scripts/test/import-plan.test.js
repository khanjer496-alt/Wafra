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
const { parseSms } = require('./build/sms-parser.js');

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

/** A scan result, the way scanInbox would hand it over. */
function scan(messages, channel = 'inbox') {
  const parsed = [];
  let newestTs = 0;
  for (const { body, ts, sender } of messages) {
    const p = parseSms(body);
    if (!p) continue;
    if (ts > newestTs) newestTs = ts;
    parsed.push({
      ...p,
      date: p.date ?? new Date(ts).toISOString().slice(0, 10),
      smsTs: ts,
      sender: sender ?? 'ENBD',
      channel,
    });
  }
  return { parsed, newestTs };
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
  const parsed = parseSms(arabicMada);
  const plan = buildImportPlan(
    [{ ...parsed, smsTs: T0 + 5_700_000, sender: 'ADCB', channel: 'inbox' }],
    BASE,
    T0 + 5_700_000,
  );
  ok('Arabic Mada import: parser debit kind is preserved through account resolution',
    parsed?.card?.kind === 'debit' &&
      plan.batch.cardTypes?.['0'] === 'debit' &&
      plan.batch.newAccounts[0]?.cardType === 'debit',
    { parsed: parsed?.card, batch: plan.batch });
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
