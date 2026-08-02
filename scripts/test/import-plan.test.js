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
      accountId: hints[t.accountId] ?? t.accountId,
    })),
  ];
  return {
    ...state,
    accounts,
    accountHints: hints,
    transactions,
    cardDues: [...state.cardDues, ...plan.batch.newDues.map((d, i) => ({ ...d, id: `due${i}` }))],
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

/* ── what must STILL import ──────────────────────────────────────────── */

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

/* ── the watermark ───────────────────────────────────────────────────── */

{
  // An unhydrated store has no transactions to compare against, so importing
  // into it would duplicate the entire ledger.
  const plan = buildImportPlan(scan(INBOX).parsed, { ...BASE, hydrated: false }, T0);
  ok('nothing imports before the store has hydrated', plan.txCount === 0, plan.txCount);
  ok('and the watermark is not advanced either', plan.batch.lastScanTs === 0, plan.batch.lastScanTs);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
