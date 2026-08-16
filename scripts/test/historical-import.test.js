const {
  MAX_HISTORICAL_TEXT_BYTES,
  parseHistoricalMessageRecords,
} = require('./build/historical-import.js');
const { buildImportPlan } = require('./build/import-plan.js');
const { duplicateGuard, reconcileCaptureDuplicates } = require('./build/dedupe.js');
const { toISODate } = require('./build/format.js');

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
}

const NOW = new Date('2026-08-09T12:00:00.000Z');
const RECEIVED = '2019-02-03T10:30:00.000Z';
const BODY = 'Purchase of AED 120.00 with Debit Card ending 1234 at CARREFOUR, DUBAI.';
const id = (letter) => `${letter.repeat(43)}A`;
const record = (patch = {}) => JSON.stringify({
  v: 1,
  id: id('a'),
  text: BODY,
  sender: 'ENBD',
  receivedAt: RECEIVED,
  ...patch,
});

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

function apply(state, plan) {
  const accounts = [...state.accounts];
  const ids = [];
  plan.batch.newAccounts.forEach((account, index) => {
    const accountId = `acc${accounts.length}`;
    ids[index] = accountId;
    accounts.push({ ...account, id: accountId });
  });
  return {
    ...state,
    accounts,
    transactions: [
      ...state.transactions,
      ...plan.batch.transactions.map((transaction, index) => ({
        ...transaction,
        id: `tx${state.transactions.length + index}`,
        accountId: /^\d+$/.test(transaction.accountId)
          ? ids[Number(transaction.accountId)]
          : transaction.accountId,
      })),
    ],
  };
}

function applyLikeStore(state, plan) {
  const patches = new Map(plan.batch.updates.map((update) => [update.id, update]));
  const existing = state.transactions
    .filter((row) => !patches.get(row.id)?.remove)
    .map((row) => {
      const patch = patches.get(row.id);
      return patch ? { ...row, ...patch, id: row.id } : row;
    });
  const incoming = plan.batch.transactions.map((row, index) => ({
    ...row,
    id: `incoming-${index}`,
  }));
  return reconcileCaptureDuplicates([...incoming, ...existing]);
}

{
  const result = parseHistoricalMessageRecords([record()], {}, NOW);
  const row = result.parsed[0];
  ok('a retained 2019 message remains a 2019 ledger event',
    row?.date === toISODate(new Date(RECEIVED)), row);
  ok('the exact Message timestamp and sender survive structured parsing',
    row?.smsTs === Date.parse(RECEIVED) && row?.sender === 'ENBD', row);
  ok('raw historical message text is stripped at the parser boundary',
    row && !Object.prototype.hasOwnProperty.call(row, 'raw'), row);
  ok('the opaque Message identity survives for exact re-import dedupe',
    row?.sourceEventId === id('a'), row);
}

{
  const result = parseHistoricalMessageRecords([
    record({
      id: id('s'),
      sender: 'FAB',
      text: 'Payroll credit: AED 7,500.00 was posted to your account 1234.',
    }),
    record({
      id: id('o'),
      sender: 'ADCB',
      receivedAt: '2019-02-03T10:31:00.000Z',
      text: 'AED 5,000.00 moved from your account 002 to your own account 004 successfully.',
    }),
  ], {}, NOW);
  ok('history uses the same semantic salary and own-account meanings as live capture',
    result.parsed.length === 2 &&
      result.parsed[0].type === 'income' &&
      result.parsed[0].amountFils === 750000 &&
      result.parsed[0].categoryGuess === 'salary' &&
      result.parsed[0].merchant === 'Salary' &&
      result.parsed[1].type === 'expense' &&
      result.parsed[1].amountFils === 500000 &&
      result.parsed[1].transferHint === true &&
      result.parsed[1].merchant === 'Own account transfer' &&
      result.parsed.every((row) => !Object.prototype.hasOwnProperty.call(row, 'raw')),
    result.parsed);
}

{
  const result = parseHistoricalMessageRecords([
    record(),
    record(),
    record({ id: id('b'), text: 'Your card transaction was declined for AED 22.00.' }),
    record({ id: id('c'), text: 'Your OTP is 123456.' }),
    '{not json',
    record({ id: 'short' }),
    record({ id: id('d'), receivedAt: '2026-02-31T12:00:00.000Z' }),
    record({ id: id('e'), sender: '\u202EENBD' }),
    record({ id: id('f'), text: '😀'.repeat(MAX_HISTORICAL_TEXT_BYTES / 2) }),
  ], {}, NOW);
  ok('duplicate IDs are counted and parsed once',
    result.duplicateCount === 1 && result.parsed.length === 2, result);
  ok('non-posting alerts retain only safe routing metadata',
    result.declined.length === 2 &&
      result.declined[0].smsTs === Date.parse(RECEIVED) &&
      result.declined[0].sourceEventId === id('b') &&
      result.declined[0].reason === 'declined' &&
      result.declined[1].sourceEventId === id('c') &&
      result.declined[1].reason === 'security-challenge' &&
      result.declined.every((row) => !Object.prototype.hasOwnProperty.call(row, 'raw')),
    result.declined);
  ok('recognized non-posting alerts are not reported as unread formats',
    result.ignoredCount === 0, result);
  ok('malformed, impossible-date and oversized rows are rejected',
    result.invalidCount === 4, result);
  ok('unsafe optional sender metadata is dropped without losing the bank alert',
    result.parsed.some((row) => row.sourceEventId === id('e') && row.sender === undefined),
    result.parsed);
}

{
  const declined = parseHistoricalMessageRecords([
    record({ id: id('b'), text: 'Your card transaction was declined for AED 22.00.' }),
  ], {}, NOW);
  const unrelated = {
    id: 'real', type: 'expense', amountFils: 2200, category: 'other',
    accountId: '', title: 'Real purchase', date: toISODate(new Date(RECEIVED)),
    ts: Date.parse(RECEIVED), source: 'sms', smsKey: `h${id('z')}`,
  };
  const plan = buildImportPlan([], { ...BASE, transactions: [unrelated] }, 0, NOW, declined.declined);
  ok('a whole-second historical decline cannot delete another Message at that time',
    plan.batch.updates.length === 0, plan.batch.updates);
}

{
  const records = [
    record({ id: id('a') }),
    record({ id: id('b') }),
  ];
  const parsed = parseHistoricalMessageRecords(records, {}, NOW);
  const first = buildImportPlan(parsed.parsed, BASE, 0, NOW, parsed.declined);
  ok('different Message GUIDs at the same second remain two real charges',
    first.txCount === 2 &&
      new Set(first.batch.transactions.map((row) => row.smsKey)).size === 2,
    first.batch.transactions);

  const after = apply(BASE, first);
  const again = buildImportPlan(parsed.parsed, after, 0, NOW, parsed.declined);
  ok('re-running the same historical session imports no duplicates',
    again.txCount === 0 && again.healedCount === 0,
    { transactions: again.batch.transactions, updates: again.batch.updates });
  ok('historical import never advances Android inbox scan state',
    first.batch.lastScanTs === 0, first.batch.lastScanTs);
}

{
  const receivedTs = Date.parse(RECEIVED);
  const live = {
    id: 'live', type: 'expense', amountFils: 12000, category: 'groceries',
    accountId: 'card', title: 'CARREFOUR', date: '2019-02-03', ts: receivedTs,
    source: 'sms', smsKey: `s${receivedTs}-12000`,
  };
  const h1 = { ...live, id: 'h1', smsKey: `h${id('a')}` };
  const h2 = { ...live, id: 'h2', smsKey: `h${id('b')}` };
  const guard = duplicateGuard([live]);
  const candidate = (row) => ({
    date: row.date, amountFils: row.amountFils, title: row.title,
    type: row.type, smsKey: row.smsKey, ts: row.ts, channel: 'inbox',
  });
  ok('one live row consumes only one of two distinct historical identities',
    guard.has(candidate(h1)) === true && guard.has(candidate(h2)) === false);
  const reconciled = reconcileCaptureDuplicates([live, h1, h2]);
  ok('hydration promotes one history identity and preserves the second event',
    reconciled.length === 2 && reconciled.every((row) => row.smsKey.startsWith('h')),
    reconciled);

  const parsed = parseHistoricalMessageRecords([
    record({ id: id('a') }),
    record({ id: id('b') }),
  ], {}, NOW);
  const state = {
    ...BASE,
    accounts: [{
      id: 'card', name: 'Debit card', kind: 'card', cardType: 'debit',
      last4: '1234', bankName: 'ENBD',
    }],
    transactions: [live],
  };
  const plan = buildImportPlan(parsed.parsed, state, 0, NOW, parsed.declined);
  const productionOrder = applyLikeStore(state, plan);
  ok('full planner and action-first reducer keep one live overlap plus a second history event',
    plan.txCount === 1 &&
      plan.batch.updates.some(
        (update) => update.id === 'live' && update.smsKey === `h${id('a')}`,
      ) &&
      productionOrder.length === 2 &&
      productionOrder.every((row) => row.smsKey.startsWith('h')),
    { plan: plan.batch, productionOrder });

  const manualState = {
    ...state,
    transactions: [{
      ...live,
      source: 'manual',
      smsKey: undefined,
      ts: undefined,
      category: 'shopping',
    }],
  };
  const manualPlan = buildImportPlan(parsed.parsed, manualState, 0, NOW, parsed.declined);
  ok('history recognizes but never rewrites a matching hand-entered row',
    manualPlan.txCount === 1 &&
      manualPlan.batch.updates.length === 0 &&
      manualState.transactions[0].category === 'shopping',
    manualPlan.batch);

  for (const userEdited of [false, true]) {
    const pushState = {
      ...state,
      transactions: [{ ...live, viaPush: true, userEdited }],
    };
    const pushPlan = buildImportPlan(parsed.parsed, pushState, 0, NOW, parsed.declined);
    const pushProductionOrder = applyLikeStore(pushState, pushPlan);
    ok(`full pipeline consumes a${userEdited ? ' user-edited' : 'n unedited'} push row only once`,
      pushPlan.txCount === 1 &&
        pushPlan.batch.updates.some(
          (update) => update.id === 'live' && update.smsKey === `h${id('a')}`,
        ) &&
        pushProductionOrder.length === 2 &&
        pushProductionOrder.every((row) => row.smsKey.startsWith('h')),
      { plan: pushPlan.batch, productionOrder: pushProductionOrder });
  }

  for (const [title, userEdited] of [['Card purchase', false], ['Weekly shop', true]]) {
    const retitledState = {
      ...state,
      transactions: [{ ...live, title, userEdited }],
    };
    const retitledPlan = buildImportPlan(parsed.parsed, retitledState, 0, NOW, parsed.declined);
    const retitledProductionOrder = applyLikeStore(retitledState, retitledPlan);
    const retitledUpdate = retitledPlan.batch.updates.find((update) => update.id === 'live');
    ok(`exact live SMS identity bridges history despite title “${title}”`,
      retitledPlan.txCount === 1 &&
        retitledUpdate?.smsKey === `h${id('a')}` &&
        (userEdited
          ? retitledUpdate.title === undefined && retitledUpdate.category === undefined
          : retitledUpdate.title !== undefined &&
            retitledProductionOrder.find((row) => row.id === 'live')?.category === 'groceries') &&
        retitledProductionOrder.length === 2,
      { plan: retitledPlan.batch, productionOrder: retitledProductionOrder });
  }

  const paymentParsed = parseHistoricalMessageRecords([
    record({
      id: id('p'),
      text: 'Payment of AED 120.00 received for your Credit Card ending 1234.',
    }),
  ], {}, NOW);
  const legacyGeneric = {
    ...live,
    title: 'Card purchase',
    category: 'other',
    type: 'expense',
    isTransfer: undefined,
  };
  const paymentPlan = buildImportPlan(
    paymentParsed.parsed,
    { ...state, transactions: [legacyGeneric] },
    0,
    NOW,
    paymentParsed.declined,
  );
  const paymentUpdate = paymentPlan.batch.updates.find((update) => update.id === 'live');
  ok('legacy s-key promotion heals a newly recognized card payment in the same import',
    paymentParsed.parsed[0]?.kind === 'cardPayment' &&
      paymentPlan.txCount === 0 &&
      paymentUpdate?.smsKey === `h${id('p')}` &&
      paymentUpdate?.type === 'income' &&
      paymentUpdate?.isTransfer === true &&
      paymentUpdate?.cardPaymentSide === 'receipt',
    { parsed: paymentParsed.parsed, plan: paymentPlan.batch });
}

{
  const base = {
    date: '2019-02-03', amountFils: 10000, title: 'Card payment', type: 'income',
    accountId: 'card', eventKind: 'cardPayment', channel: 'inbox',
  };
  const guard = duplicateGuard([]);
  guard.add({ ...base, smsKey: `h${id('a')}`, ts: 1_000, cardPaymentSide: 'receipt' });
  ok('two distinct same-side historical payments are both retained',
    guard.has({ ...base, smsKey: `h${id('b')}`, ts: 1_000, cardPaymentSide: 'receipt' }) === false);
  ok('opposite settlement-side alerts still collapse to one payment',
    guard.has({ ...base, smsKey: `h${id('c')}`, ts: 1_000, cardPaymentSide: 'debit' }) === true);
}

{
  const paymentRecords = [
    record({
      id: id('a'), sender: 'FAB',
      text: 'Payment of AED 120.00 received towards your Credit Card ending 1234.',
    }),
    record({
      id: id('b'), sender: 'FAB', receivedAt: '2019-02-03T10:31:00.000Z',
      text: 'AED 120.00 has been deducted from your account 0001 towards payment of your Credit Card ending 1234.',
    }),
  ];
  const parsed = parseHistoricalMessageRecords(paymentRecords, {}, NOW);
  const paymentState = {
    ...BASE,
    accounts: [{
      id: 'card', name: 'FAB Credit •1234', kind: 'card', cardType: 'credit',
      last4: '1234', bankName: 'FAB',
    }],
  };
  const first = buildImportPlan(parsed.parsed, paymentState, 0, NOW, parsed.declined);
  const stored = applyLikeStore(paymentState, first);
  const secondState = { ...paymentState, transactions: stored };
  const second = buildImportPlan(parsed.parsed, secondState, 0, NOW, parsed.declined);
  ok('re-importing both card-payment history legs is fully idempotent',
    first.txCount === 1 &&
      stored.length === 1 &&
      second.txCount === 0 &&
      second.healedCount === 0 &&
      second.batch.updates.length === 0 &&
      stored[0].smsKey === `h${id('a')}` &&
      stored[0].cardPaymentSide === 'receipt',
    { first: first.batch, stored, second: second.batch });
}

{
  const exactBytes = MAX_HISTORICAL_TEXT_BYTES;
  const suffix = 'x'.repeat(exactBytes - Buffer.byteLength(BODY));
  const exact = parseHistoricalMessageRecords([record({ text: BODY + suffix })], {}, NOW);
  const future = parseHistoricalMessageRecords([
    record({ id: id('f'), receivedAt: '2026-08-09T12:06:00.000Z' }),
  ], {}, NOW);
  ok('a record exactly at the 16 KiB boundary remains valid',
    exact.invalidCount === 0 && exact.parsed.length === 1, exact);
  ok('a timestamp beyond the five-minute clock allowance is rejected',
    future.invalidCount === 1, future);
}

if (fail > 0) {
  console.error(`\nhistorical-import: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\nhistorical-import: ${pass} passed, 0 failed`);
