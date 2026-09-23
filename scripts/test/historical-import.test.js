const {
  MAX_HISTORICAL_TEXT_BYTES,
  parseHistoricalMessageRecords,
} = require('./build/historical-import.js');
const fs = require('node:fs');
const path = require('node:path');
const {
  discardIosHistorySession,
  loadIosHistorySession,
  persistIosHistoryReviewCandidates,
} = require('./build/ios-history-import.js');
const { buildImportPlan } = require('./build/import-plan.js');
const { duplicateGuard, reconcileCaptureDuplicates } = require('./build/dedupe.js');
const { toISODate } = require('./build/format.js');
const markets = require('./build/markets.js');

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
}

const NOW = new Date('2026-08-09T12:00:00.000Z');
const RECEIVED = '2019-02-03T10:30:00.000Z';
const BODY = 'Purchase of AED 120.00 with Debit Card ending 1234 at CARREFOUR, DUBAI.';
const IDS = {
  a: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  b: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  c: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  d: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  e: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  f: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  o: '0101010101010101010101010101010101010101010101010101010101010101',
  p: '0202020202020202020202020202020202020202020202020202020202020202',
  s: '0303030303030303030303030303030303030303030303030303030303030303',
  z: '0404040404040404040404040404040404040404040404040404040404040404',
};
const id = (key) => IDS[key];
const record = (patch = {}) => JSON.stringify({
  v: 1,
  id: id('a'),
  text: BODY,
  sender: 'ENBD',
  receivedAt: RECEIVED,
  ...patch,
});
const literalDuplicateIdRecord = `{"v":1,"id":"${id('b')}","id":"${id('c')}","text":${JSON.stringify(BODY)},"sender":"ENBD","receivedAt":"2019-02-03T10:31:00.000Z"}`;
const escapedDuplicateIdRecord = `{"v":1,"id":"${id('d')}","\\u0069d":"${id('e')}","text":${JSON.stringify(BODY)},"sender":"ENBD","receivedAt":"2019-02-03T10:31:00.000Z"}`;
const nestedDuplicateSenderRecord = `{"v":1,"id":"${id('f')}","text":${JSON.stringify(BODY)},"sender":{"label":"ENBD","label":"FAB"},"receivedAt":"2019-02-03T10:31:00.000Z"}`;

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
  ok('the exact Message timestamp and canonical bank survive structured parsing',
    row?.smsTs === Date.parse(RECEIVED) && row?.bankHint === 'Emirates NBD', row);
  ok('raw historical message text and sender are stripped at the parser boundary',
    row &&
      !Object.prototype.hasOwnProperty.call(row, 'raw') &&
      !Object.prototype.hasOwnProperty.call(row, 'sender'), row);
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
      result.parsed.every((row) =>
        !Object.prototype.hasOwnProperty.call(row, 'raw') &&
        !Object.prototype.hasOwnProperty.call(row, 'sender')),
    result.parsed);
}

{
  const privateBody = 'AED 2,500.00 has been transferred to your FAB account from JOHN DOE';
  const result = parseHistoricalMessageRecords([
    record({ id: id('b'), sender: 'FAB', text: privateBody }),
  ], {}, NOW);
  const review = result.reviewCandidates?.[0];
  ok('history routes the same low-confidence income as Android to source-free review',
    result.parsed.length === 0 &&
      result.acceptedCount === 0 &&
      result.ignoredCount === 0 &&
      result.reviewCandidates?.length === 1 &&
      review?.market === 'AE' &&
      review?.direction === 'credit' &&
      review?.amount?.minorUnits === '250000' &&
      review?.channel === 'shortcut',
    result);
  ok('historical review identity is stable while body and sender never cross the parser boundary',
    review?.id === `apple_message_review_id_${id('b')}` &&
      review?.sourceKey === `apple_message_review_source_${id('b')}` &&
      review?.observedAt === Date.parse(RECEIVED) &&
      review?.expiresAt > NOW.getTime() &&
      !hasPrivateHistoryField(result) &&
      !JSON.stringify(result).includes(privateBody) &&
      !JSON.stringify(result).includes('JOHN DOE'),
    result);
}

{
  const literal = parseHistoricalMessageRecords([literalDuplicateIdRecord], {}, NOW);
  const escaped = parseHistoricalMessageRecords([escapedDuplicateIdRecord], {}, NOW);
  const nested = parseHistoricalMessageRecords([nestedDuplicateSenderRecord], {}, NOW);
  ok('literal duplicate JSON members are rejected before JSON.parse can collapse them',
    literal.invalidCount === 1 && literal.parsed.length === 0,
    literal);
  ok('escaped duplicate JSON member aliases are rejected before collapse',
    escaped.invalidCount === 1 && escaped.parsed.length === 0,
    escaped);
  ok('duplicate members inside a nested value invalidate the whole v1 record',
    nested.invalidCount === 1 && nested.parsed.length === 0,
    nested);
}

{
  const depth = 50_000;
  const extreme = `{"v":1,"id":"${id('f')}","text":${JSON.stringify(BODY)},"sender":${'['.repeat(depth)}null${']'.repeat(depth)},"receivedAt":"${RECEIVED}"}`;
  const result = parseHistoricalMessageRecords([extreme], {}, NOW);
  ok('extreme JSON nesting is rejected without stack exhaustion',
    result.invalidCount === 1 && result.parsed.length === 0,
    result);
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
      result.declined.every((row) =>
        !Object.prototype.hasOwnProperty.call(row, 'raw') &&
        !Object.prototype.hasOwnProperty.call(row, 'sender')),
    result.declined);
  ok('recognized non-posting alerts are not reported as unread formats',
    result.ignoredCount === 0, result);
  ok('malformed, impossible-date and oversized rows are rejected',
    result.invalidCount === 4, result);
  ok('unsafe optional sender metadata is dropped without losing the bank alert',
    result.parsed.some((row) =>
      row.sourceEventId === id('e') &&
      !Object.prototype.hasOwnProperty.call(row, 'sender')),
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

const SESSION_ID = 'history_session_0001';
const completed = (patch = {}) => ({
  chunkIndices: [0],
  found: 1,
  attempted: 1,
  accepted: 1,
  skipped: 0,
  ...patch,
});

class FakeHistoryNative {
  constructor({
    descriptor = completed(),
    chunks = { 0: [record()] },
    getError = null,
    readErrorAt = null,
    discardError = null,
    beforeRead = null,
  } = {}) {
    this.descriptor = descriptor;
    this.chunks = chunks;
    this.getError = getError;
    this.readErrorAt = readErrorAt;
    this.discardError = discardError;
    this.beforeRead = beforeRead;
    this.reads = [];
    this.discards = 0;
    this.purges = 0;
    this.erases = 0;
    this.activeReads = 0;
    this.maxActiveReads = 0;
  }

  async getCompletedSession() {
    if (this.getError) throw this.getError;
    return this.descriptor;
  }

  async readChunk(_sessionId, chunkIndex) {
    this.reads.push(chunkIndex);
    this.beforeRead?.(chunkIndex);
    this.activeReads += 1;
    this.maxActiveReads = Math.max(this.maxActiveReads, this.activeReads);
    try {
      await Promise.resolve();
      if (this.readErrorAt?.index === chunkIndex) throw this.readErrorAt.error;
      return this.chunks[chunkIndex] ?? [];
    } finally {
      this.activeReads -= 1;
    }
  }

  async discardSession() {
    this.discards += 1;
    if (this.discardError) throw this.discardError;
    this.descriptor = null;
  }

  async purgeExpired() {
    this.purges += 1;
    return 0;
  }

  async eraseAll() {
    this.erases += 1;
  }
}

async function rejection(operation) {
  try {
    await operation();
    return null;
  } catch (error) {
    return error;
  }
}

function safeError(error, code) {
  const serialized = `${error?.name ?? ''} ${error?.message ?? ''} ${error?.code ?? ''}`;
  return error?.code === code &&
    !serialized.includes(BODY) &&
    !serialized.includes('PERSONAL-SENDER');
}

function hasPrivateHistoryField(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasPrivateHistoryField);
  return Object.entries(value).some(([key, child]) =>
    key === 'raw' || key === 'sender' || key === 'text' || hasPrivateHistoryField(child));
}

async function coordinatorTests() {
  {
    const review = parseHistoricalMessageRecords([
      record({
        id: id('b'),
        sender: 'FAB',
        text: 'AED 2,500.00 has been transferred to your FAB account from JOHN DOE',
      }),
    ], {}, NOW).reviewCandidates?.[0];
    let release;
    const durable = new Promise((resolve) => { release = resolve; });
    const events = [];
    if (typeof persistIosHistoryReviewCandidates !== 'function' || !review) {
      ok('history review staging waits for encrypted durability', false,
        { persistIosHistoryReviewCandidates, review });
    } else {
      const pending = persistIosHistoryReviewCandidates([review], (items) => {
        events.push(`stage:${items.length}`);
        return { admitted: items.length, durable };
      }).then((admitted) => {
        events.push(`done:${admitted}`);
      });
      await Promise.resolve();
      ok('history review staging does not report success before encrypted durability',
        events.join(',') === 'stage:1', events);
      release();
      await pending;
      ok('history review staging waits for encrypted durability',
        events.join(',') === 'stage:1,done:1', events);
    }
  }

  {
    const native = new FakeHistoryNative({
      descriptor: completed({ found: 2, attempted: 2, accepted: 1, skipped: 1 }),
    });
    const observed = [];
    const result = await loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      onProgress: (progress) => observed.push(progress),
      now: NOW,
    });
    ok('coordinator reports distinct readable Messages instead of overlapping references',
      result.summary.found === 1 &&
        result.summary.attempted === 2 &&
        result.summary.accepted === 1 &&
        result.summary.skipped === 1,
      result.summary);
    ok('coordinator reports parsed, declined, ignored, and duplicate counts separately',
      result.summary.parsed === 1 &&
        result.summary.declined === 0 &&
        result.summary.ignored === 0 &&
        result.summary.duplicates === 0,
      result.summary);
    ok('completed session rows expose canonical bank identity but no body or sender',
      result.parsed[0]?.bankHint === 'Emirates NBD' &&
        !hasPrivateHistoryField(result) &&
        !JSON.stringify(result).includes(BODY) &&
        !JSON.stringify(result).includes('"sender"'),
      result);
    ok('successful loading leaves explicit cleanup to the review owner',
      native.discards === 0 && native.purges === 1 && native.erases === 0,
      native);
    ok('progress contains only aggregate counts',
      observed.length === 1 &&
        JSON.stringify(observed) === '[{"scanned":1,"matched":1}]' &&
        Object.keys(observed[0]).sort().join(',') === 'matched,scanned',
      observed);
  }

  {
    let yielded = false;
    let yieldedBeforeSecondRead = false;
    setTimeout(() => { yielded = true; }, 0);
    const native = new FakeHistoryNative({
      descriptor: completed({ chunkIndices: [0, 1], found: 2, attempted: 2, accepted: 2 }),
      chunks: {
        0: [record({ id: id('a') })],
        1: [record({ id: id('b'), receivedAt: '2019-02-03T10:31:00.000Z' })],
      },
      beforeRead: (index) => {
        if (index === 1) yieldedBeforeSecondRead = yielded;
      },
    });
    const observed = [];
    const result = await loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      onProgress: (progress) => observed.push(progress),
      now: NOW,
    });
    ok('chunks stream in descriptor order with one native read in flight',
      native.reads.join(',') === '0,1' && native.maxActiveReads === 1,
      native);
    ok('coordinator yields to the event loop before requesting the next chunk',
      yieldedBeforeSecondRead === true, { yieldedBeforeSecondRead });
    ok('progress is cumulative across yielded chunks',
      JSON.stringify(observed) ===
        '[{"scanned":1,"matched":1},{"scanned":2,"matched":2}]' &&
        result.parsed.length === 2,
      observed);
  }

  {
    markets.setLedgerCurrency(null);
    markets.setActiveMarket('AE');
    const firstChunk = Array.from({ length: 50 }, (_, index) => record({
      id: (index + 1).toString(16).padStart(64, '0'),
      sender: 'ENBD',
    }));
    const native = new FakeHistoryNative({
      descriptor: completed({ chunkIndices: [0, 1], found: 51, attempted: 51, accepted: 51 }),
      chunks: {
        0: firstChunk,
        1: [record({
          id: 'ff'.repeat(32),
          sender: 'ALRAJHI',
          receivedAt: '2019-02-03T10:29:00.000Z',
          text: 'POS purchase of SAR 125.50 at JARIR BOOKSTORE using Mada Card ending 1234. Available balance SAR 2,500.00.',
        })],
      },
    });
    const result = await loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    });
    ok('one globally latest-first launch-market lock spans an actual 51-message native history import',
      result.parsed.length === 50 &&
        result.parsed.every((row) => row.currency === 'AED') &&
        result.reviewCandidates?.length === 1 &&
        result.reviewCandidates[0]?.market === 'SA' &&
        result.summary.reviewed === 1,
      result);
  }

  for (const invalidSessionId of [
    '../escape',
    'short',
    'history/session',
    'x'.repeat(129),
    'history_session_0001?body=secret',
  ]) {
    const native = new FakeHistoryNative();
    const error = await rejection(() => loadIosHistorySession({
      sessionId: invalidSessionId,
      native,
      overrides: {},
      now: NOW,
    }));
    ok(`invalid deep-link session ID is refused: ${invalidSessionId.slice(0, 20)}`,
      safeError(error, 'invalid-session') &&
        native.purges === 0 && native.reads.length === 0 && native.discards === 0,
      error);
  }

  for (const unavailableState of ['missing', 'open', 'tombstoned']) {
    const native = new FakeHistoryNative({ descriptor: null });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    }));
    ok(`${unavailableState} session cannot create review state`,
      safeError(error, 'session-unavailable') &&
        native.reads.length === 0 && native.discards === 1 && native.descriptor === null,
      error);
  }

  const badDescriptors = [
    ['negative found count', completed({ found: -1 })],
    ['fractional attempted count', completed({ attempted: 1.5 })],
    ['unsafe accepted count', completed({
      found: Number.MAX_SAFE_INTEGER + 1,
      attempted: Number.MAX_SAFE_INTEGER + 1,
      accepted: Number.MAX_SAFE_INTEGER + 1,
    })],
    ['non-number skipped count', completed({ skipped: '0' })],
    ['found differs from attempted', completed({ found: 2 })],
    ['accepted plus skipped differs from attempted', completed({ found: 2, attempted: 2 })],
    ['missing chunk indices', completed({ chunkIndices: undefined })],
    ['non-array chunk indices', completed({ chunkIndices: 0 })],
    ['chunk indices do not start at zero', completed({ chunkIndices: [1] })],
    ['chunk indices contain a gap', completed({ chunkIndices: [0, 2] })],
    ['chunk indices contain a duplicate', completed({ chunkIndices: [0, 0] })],
    ['chunk indices are not integers', completed({ chunkIndices: [0.5] })],
  ];
  for (const [name, descriptor] of badDescriptors) {
    const native = new FakeHistoryNative({ descriptor });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    }));
    ok(`descriptor validation rejects ${name} before a chunk read`,
      safeError(error, 'invalid-descriptor') &&
        native.reads.length === 0 && native.discards === 1,
      error);
  }

  {
    const observed = [];
    const native = new FakeHistoryNative({
      descriptor: completed({
        chunkIndices: [],
        found: 10_001,
        attempted: 10_001,
        accepted: 10_000,
        skipped: 1,
      }),
      chunks: {},
    });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      onProgress: (progress) => observed.push(progress),
      now: NOW,
    }));
    ok('found and attempted above 10,000 fail before reads or progress',
      safeError(error, 'invalid-descriptor') &&
        native.reads.length === 0 && observed.length === 0 && native.discards === 1,
      { error, reads: native.reads, observed });
  }

  {
    const observed = [];
    const native = new FakeHistoryNative({
      descriptor: completed({
        chunkIndices: Array.from({ length: 201 }, (_, index) => index),
        found: 10_000,
        attempted: 10_000,
        accepted: 0,
        skipped: 10_000,
      }),
      chunks: {},
    });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      onProgress: (progress) => observed.push(progress),
      now: NOW,
    }));
    ok('an all-skipped descriptor with 201 chunks fails before reads or progress',
      safeError(error, 'invalid-descriptor') &&
        native.reads.length === 0 && observed.length === 0 && native.discards === 1,
      { error, readCount: native.reads.length, observed });
  }

  {
    const observed = [];
    const native = new FakeHistoryNative({
      descriptor: completed({
        chunkIndices: [0],
        found: 0,
        attempted: 0,
        accepted: 0,
        skipped: 0,
      }),
      chunks: {},
    });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      onProgress: (progress) => observed.push(progress),
      now: NOW,
    }));
    ok('a zero-found descriptor must not list any chunk',
      safeError(error, 'invalid-descriptor') &&
        native.reads.length === 0 && observed.length === 0 && native.discards === 1,
      { error, reads: native.reads, observed });
  }

  {
    const records = Array.from({ length: 51 }, (_, index) => record({
      id: index.toString(16).padStart(64, '0'),
    }));
    const native = new FakeHistoryNative({
      descriptor: completed({ found: 51, attempted: 51, accepted: 51 }),
      chunks: { 0: records },
    });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    }));
    ok('a native chunk over 50 records fails the whole session',
      safeError(error, 'invalid-chunk') && native.discards === 1,
      error);
  }

  const refusedRecordIds = [
    ['uppercase hex', 'A'.repeat(64)],
    ['short hex', 'a'.repeat(63)],
    ['base64url digest', `${'a'.repeat(43)}A`],
    ['UUID-shaped value', '550e8400-e29b-41d4-a716-446655440000'],
    ['raw Message GUID', 'p:0/12345678-1234-1234-1234-123456789abc'],
  ];
  for (const [name, recordId] of refusedRecordIds) {
    const native = new FakeHistoryNative({ chunks: { 0: [record({ id: recordId })] } });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    }));
    ok(`JavaScript revalidation rejects ${name} as a record ID`,
      safeError(error, 'record-mismatch') &&
        native.discards === 1 && native.descriptor === null,
      error);
  }

  for (const [name, invalidRecord] of [
    ['a different record version', record({ v: 2 })],
    ['an unknown record member', record({ unexpected: true })],
    ['an empty body', record({ text: '   ' })],
    ['an impossible timestamp', record({ receivedAt: '2019-02-31T10:30:00.000Z' })],
  ]) {
    const native = new FakeHistoryNative({ chunks: { 0: [invalidRecord] } });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    }));
    ok(`JavaScript revalidation rejects ${name}`,
      safeError(error, 'record-mismatch') && native.discards === 1,
      error);
  }

  {
    const native = new FakeHistoryNative({
      descriptor: completed({ chunkIndices: [0, 1], found: 2, attempted: 2, accepted: 2 }),
      chunks: { 0: [record()], 1: [record()] },
    });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    }));
    ok('duplicate opaque IDs across chunks fail and tombstone the whole session',
      safeError(error, 'duplicate-record') &&
        native.discards === 1 && native.descriptor === null,
      error);
  }

  for (const [name, duplicateRecord] of [
    ['literal duplicate members', literalDuplicateIdRecord],
    ['escaped duplicate member aliases', escapedDuplicateIdRecord],
  ]) {
    const native = new FakeHistoryNative({
      descriptor: completed({ chunkIndices: [0, 1], found: 2, attempted: 2, accepted: 2 }),
      chunks: { 0: [record()], 1: [duplicateRecord] },
    });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    }));
    ok(`${name} in a later accepted chunk discard without exposing a prefix`,
      safeError(error, 'record-mismatch') &&
        native.reads.join(',') === '0,1' &&
        native.discards === 1 && native.descriptor === null,
      error);
  }

  for (const [name, descriptor, chunks] of [
    ['fewer records than accepted',
      completed({ found: 2, attempted: 2, accepted: 2 }),
      { 0: [record()] }],
    ['more records than accepted',
      completed(),
      { 0: [record(), record({ id: id('b') })] }],
  ]) {
    const native = new FakeHistoryNative({ descriptor, chunks });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    }));
    ok(`read total reconciliation rejects ${name}`,
      safeError(error, 'record-count-mismatch') && native.discards === 1,
      error);
  }

  {
    const native = new FakeHistoryNative({
      descriptor: completed({ chunkIndices: [0, 1], found: 2, attempted: 2, accepted: 2 }),
      chunks: {
        0: [record()],
        1: [record({ id: 'not-a-native-id' })],
      },
    });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    }));
    ok('a later native/JavaScript mismatch exposes no partial review result',
      safeError(error, 'record-mismatch') &&
        native.reads.join(',') === '0,1' &&
        native.discards === 1 && native.descriptor === null,
      error);
  }

  {
    const abort = new Error(`cancelled ${BODY} PERSONAL-SENDER`);
    abort.name = 'AbortError';
    const native = new FakeHistoryNative();
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      onProgress: () => { throw abort; },
      now: NOW,
    }));
    ok('cancellation retains the protected session for an explicit retry or cancel',
      safeError(error, 'cancelled') && native.discards === 0 && native.descriptor !== null,
      error);
  }

  {
    const native = new FakeHistoryNative({
      readErrorAt: {
        index: 0,
        error: new Error(`temporary bridge failure ${BODY} PERSONAL-SENDER`),
      },
    });
    const first = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    }));
    const retainedAfterFailure = native.descriptor !== null;
    native.readErrorAt = null;
    const retry = await loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    });
    ok('a transient native read failure retains the protected session and retries cleanly',
      safeError(first, 'native-failure') && retainedAfterFailure &&
        native.discards === 0 && retry.parsed.length === 1,
      { first, retainedAfterFailure, discards: native.discards, retry });
  }

  {
    const native = new FakeHistoryNative({
      chunks: { 0: [record({ id: 'bad' })] },
      discardError: new Error(`cleanup failed ${BODY} PERSONAL-SENDER`),
    });
    const error = await rejection(() => loadIosHistorySession({
      sessionId: SESSION_ID,
      native,
      overrides: {},
      now: NOW,
    }));
    ok('cleanup failure supersedes the load error without leaking its source',
      safeError(error, 'cleanup-failed') && native.discards === 1,
      error);
  }

  {
    const native = new FakeHistoryNative({ descriptor: null });
    await discardIosHistorySession(native, SESSION_ID);
    await discardIosHistorySession(native, SESSION_ID);
    ok('discardIosHistorySession is idempotent for an already-absent session',
      native.discards === 2 && native.descriptor === null,
      native);
  }

  {
    const native = new FakeHistoryNative();
    const error = await rejection(() => discardIosHistorySession(native, '../escape'));
    ok('discard refuses an invalid deep-link ID before calling native code',
      safeError(error, 'invalid-session') && native.discards === 0,
      error);
  }

  {
    const importScreen = fs.readFileSync(
      path.join(__dirname, '../../src/app/import-sms.tsx'),
      'utf8',
    );
    const applyPlan = importScreen.slice(
      importScreen.indexOf('const applyPlan = async'),
      importScreen.indexOf('const retrySecureSave = async'),
    );
    const leaveScreen = importScreen.slice(
      importScreen.indexOf('const leaveScreen = async'),
      importScreen.indexOf('const leaveProtectedSessionForExpiry'),
    );
    const noOpStart = importScreen.indexOf(
      'const finalizeResult = await historyOperationController.finalize',
    );
    const noOpEnd = importScreen.indexOf('setPlan(nextPlan)', noOpStart);
    const noOp = importScreen.slice(noOpStart, noOpEnd);
    const finishHistory = importScreen.slice(
      importScreen.indexOf('const finishHistoryReview = useCallback'),
      importScreen.indexOf('const leaveScreen = async'),
    );
    ok('history completion marks setup only after native source cleanup succeeds',
      applyPlan.indexOf('historyOperationController.finalize') <
        applyPlan.indexOf("finishHistoryReview('complete')") &&
        leaveScreen.indexOf('historyOperationController.discard') <
          leaveScreen.indexOf("finishHistoryReview('skipped')") &&
        noOp.indexOf('historyOperationController.finalize') <
          noOp.indexOf("finishHistoryReview('complete')"),
      { applyPlan, leaveScreen, noOp });
    ok('history completion clears the source-free handoff before marking setup complete',
      finishHistory.indexOf('clearIosHistoryHandoff') >= 0 &&
        finishHistory.indexOf('clearIosHistoryHandoff') <
          finishHistory.indexOf('dispatchIosMessageSetup'),
      finishHistory);
  }
}

async function importHistoryHandoffTests() {
  // Execute the shipping handler, not a duplicated controller. Native/link
  // ports are controlled so the test can observe URLs and durable ordering.
  const ts = require('typescript');
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../../src/app/import-sms.tsx'), 'utf8');
  const tree = ts.createSourceFile('import-sms.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'openHistoryRun') {
      initializer = node.initializer.getText(tree);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!initializer) throw new Error('Import history handoff handler is missing');
  const compiled = ts.transpileModule(`(${initializer})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const runShortcutUrl = 'shortcuts://x-callback-url/run-shortcut?name=Wafra%20History%20Import';
  const executeHandoff = async (newHandoff, linkFails = false) => {
    const events = [];
    let progress = { installed: true, handoffStartedAt: 111 };
    const handler = vm.runInNewContext(compiled, {
      Date: { now: () => 222 },
      performSetupAction: (action) => action(),
      iosHistorySetupStorageCoordinator: { run: (action) => action() },
      beginIosHistoryHandoffForOrigin: async (origin, startedAt) => {
        events.push(['persist-handoff', origin, startedAt]);
      },
      setHistorySetup: (update) => { progress = update(progress); },
      setHistoryHandoffExpired: () => {},
      historyShortcutRunUrl: () => runShortcutUrl,
      // The legacy two-ended graph would start a second import if re-run, so
      // Continue only reopens Shortcuts for it; a paged record resolves to the
      // run URL instead (pinned in ios-setup-ux.test.js).
      historyShortcutContinueUrl: () => 'shortcuts://',
      clearIosHistoryHandoff: async () => { events.push(['clear-handoff']); },
      clearIosHistoryReturnOrigin: async () => { events.push(['clear-origin']); },
      Linking: { openURL: async (url) => {
        events.push(['open', url]);
        if (linkFails) throw new Error('Shortcuts unavailable');
      } },
    });
    let rejected = false;
    try { await handler(newHandoff); } catch { rejected = true; }
    return { events, progress, rejected };
  };
  const continued = await executeHandoff(false);
  ok('Continue opens Shortcuts without restarting the retained-message import',
    JSON.stringify(continued.events) === JSON.stringify([['open', 'shortcuts://']]) &&
      continued.progress.handoffStartedAt === 111);
  const started = await executeHandoff(true);
  ok('a new history run durably records its handoff before running the Shortcut',
    JSON.stringify(started.events) === JSON.stringify([
      ['persist-handoff', 'import', 222], ['open', runShortcutUrl],
    ]) && started.progress.handoffStartedAt === 222);
  const failedContinue = await executeHandoff(false, true);
  ok('failed Continue preserves the pending handoff and return origin for retry',
    failedContinue.rejected && failedContinue.events.length === 1 &&
      failedContinue.progress.handoffStartedAt === 111);
  const failedStart = await executeHandoff(true, true);
  ok('a failed new run clears only the newly created handoff and origin',
    failedStart.rejected && failedStart.progress.handoffStartedAt === null &&
      JSON.stringify(failedStart.events.slice(2)) === JSON.stringify([
        ['clear-handoff'], ['clear-origin'],
      ]));
}

function universalHistoryReviewTests() {
  const text = 'Card purchase CAD 24.90 at MAPLE CAFE on 2026-09-05. Available balance CAD 500.00.';
  const eventId = 'd'.repeat(64);
  const result = parseHistoricalMessageRecords([JSON.stringify({
    v: 1, id: eventId, text, receivedAt: '2020-01-01T10:00:00.000Z',
  })], {}, NOW);
  const item = result.reviewCandidates[0];
  ok('sender-free retained bank alerts reach source-free generic review',
    result.parsed.length === 0 && result.reviewCandidates.length === 1 && item?.kind === 'universal');
  ok('historical universal review preserves Apple identity and discovery retention',
    item?.sourceKey === `apple_message_review_source_${eventId}` &&
      item.observedAt === Date.parse('2020-01-01T10:00:00.000Z') &&
      item.expiresAt === NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
  ok('historical universal review keeps only source-stated dates and money',
    item?.event?.transactionDate.value === '2026-09-05' &&
      item.event.amount.value.currency === 'CAD' && item.event.amount.value.minorUnits === '2490' &&
      !JSON.stringify(item).includes(text));
}

function importPreviewTests() {
  // Render the actual plan-review fragment and its derived declarations. The
  // store, import actions and native history lifecycle are outside this test.
  const ts = require('typescript');
  const vm = require('node:vm');
  const load = require('./repair/load-typescript.cjs');
  const i18n = load(path.join(__dirname, '../../src/lib/i18n.ts'));
  const { isDeliberateOtherTitle } = require('./build/sms-parser.js');
  const source = fs.readFileSync(path.join(__dirname, '../../src/app/import-sms.tsx'), 'utf8');
  const ast = ts.createSourceFile('import-sms.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ImportSmsScreen');
  const declarations = new Map();
  for (const statement of component.body.statements) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
    }
  }
  let fragment;
  function find(n) {
    if (ts.isBinaryExpression(n) && n.left.getText(ast) === 'plan !== null && !scanning' &&
      ts.isParenthesizedExpression(n.right) && ts.isJsxFragment(n.right.expression)) fragment = n.right;
    ts.forEachChild(n, find);
  }
  find(component);
  if (!fragment) throw new Error('Shipping import preview is missing');
  const jsx = (type, props) => ({ type, props });
  const walk = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk)
    : [n, ...walk(n.props?.children)];
  const strings = value => Array.isArray(value) ? value.flatMap(strings) : typeof value === 'string' ? [value] : [];
  const texts = tree => walk(tree).flatMap(n => [...strings(n.props?.title), ...strings(n.props?.children)]);
  const tx = extra => ({ type: 'expense', amountFils: 99, category: 'other', title: 'Test Merchant',
    date: '2026-09-19', accountId: '0', raw: 'synthetic source', ...extra });
  function render({ rows = [], dues = [], language = 'en', history = null, unread = 0,
    moneySpec = { schemaVersion: 2, currency: 'AED', exponent: 2 } } = {}) {
    i18n.setLanguage(language);
    const plan = { txCount: rows.length, newAccountCount: 1, dueCount: dues.length, healedCount: 0,
      batch: { transactions: rows, newDues: dues, newAccounts: [{ name: 'Synthetic card' }],
        importMoney: moneySpec } };
    const input = { plan, history, historyResult: history ? {} : null, historySourceSummary: { unread },
      state: { accounts: [{ id: 'existing-card', name: 'Existing synthetic card' }] },
      newBills: [], skippedCount: 0, trackedBills: new Set(), reducedMotion: true, applying: false,
      trackReminder() { throw new Error('Preview must not save reminders'); },
      PREVIEW_LIMIT: 60, theme: {}, styles: {}, isDeliberateOtherTitle,
      useMemo: fn => fn(), ...i18n, categoryLabel: category => category,
      shortDate: date => date.slice(5), router: { push() { throw new Error('Preview must not navigate'); } },
      Animated: { View: 'Animated.View' },
      Section: 'Section', View: 'View', ThemedText: 'ThemedText', SectionHeader: 'SectionHeader',
      Row: 'Row', CategoryTile: 'CategoryTile', Money: 'Money', Button: 'Button', Block: 'Block', Icon: 'Icon' };
    const selected = new Set();
    function collect(n) {
      if (ts.isIdentifier(n) && !Object.hasOwn(input, n.text)) {
        const declaration = declarations.get(n.text);
        if (declaration && !selected.has(declaration)) { selected.add(declaration); collect(declaration.initializer); }
      }
      ts.forEachChild(n, collect);
    }
    collect(fragment);
    const body = [...declarations.values()].filter(n => selected.has(n)).map(n => `const ${n.getText(ast)};`).join('\n');
    const program = ts.transpileModule(`(() => { ${body} return ${fragment.getText(ast)}; })()`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    return vm.runInNewContext(program, { ...input, exports: {}, require: name => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      throw new Error('Unexpected preview dependency');
    } });
  }
  for (const language of ['en', 'ar']) {
    let tree = render({ rows: [tx({})], language });
    let text = texts(tree).join('\n');
    ok(`${language}: named uncategorized preview says read without claiming an unknown format`,
      text.includes(i18n.t('noCategoryYet')) && !text.includes(i18n.t('unreadLabel')) &&
      !text.includes(i18n.tf('unknownMessageFormats', { count: 1, s: '' })));
    ok(`${language}: unsaved preview says ready to file`, text.includes(i18n.t('readyToFile')) && !text.includes(i18n.t('justFiled')));
    tree = render({ rows: [tx({ title: 'Card purchase' })], language });
    ok(`${language}: missing merchant retains the unknown-format warning`,
      texts(tree).includes(i18n.tf('unknownMessageFormats', { count: 1, s: '' })));
    tree = render({ rows: [tx({}), tx({ title: 'Card purchase' })], language });
    text = texts(tree).join('\n');
    ok(`${language}: mixed attention keeps category-only and unknown-format counts separate`,
      text.includes(i18n.t('noCategoryYet')) &&
      text.includes(i18n.tf('unknownMessageFormats', { count: 1, s: '' })) &&
      !text.includes(i18n.tf('unknownMessageFormats', { count: 2, s: 's' })));
    tree = render({ rows: [tx({})], language, history: 'synthetic-history', unread: 3 });
    text = texts(tree).join('\n');
    ok(`${language}: history keeps its source-level skipped count`,
      text.includes(i18n.t('skippedLabel')) &&
      text.includes(i18n.tf('unknownMessageFormats', { count: 3, s: 's' })));
    tree = render({ rows: [tx({ category: 'groceries' }), tx({ title: 'ATM withdrawal' })], language });
    ok(`${language}: retained raw on categorized and deliberate structural rows is not a new category warning`,
      !texts(tree).join('\n').includes(i18n.t('noCategoryYet')));
    tree = render({ rows: Array.from({ length: 61 }, () => tx({ category: 'groceries' })), language });
    const heading = walk(tree).find(n => n.type === 'SectionHeader')?.props.title;
    ok(`${language}: bounded preview names readiness and its shown/total counts`,
      heading?.includes(i18n.t('readyToFile')) && heading.includes('60') && heading.includes('61') &&
      !heading.includes(i18n.t('justFiled')));
    const due = { accountId: '0', totalDueFils: 123456, minDueFils: 4210, dueDate: '2026-09-25', paidFils: 0 };
    tree = render({ dues: [due, { ...due, accountId: 'existing-card', minDueFils: 6173, minDueEstimated: true }], language });
    text = texts(tree).join('\n');
    const amounts = walk(tree).filter(n => n.type === 'Money').map(n => n.props);
    ok(`${language}: card-only plan displays staged and existing card names, statement totals and year`,
      text.includes('Synthetic card') && text.includes('Existing synthetic card') && text.includes('2026') &&
      text.includes(i18n.t('genericStatementTotal')) && amounts.filter(p => p.fils === 123456).length === 2);
    ok(`${language}: only a stated minimum is numeric; unknown is disclosed and amounts carry exact currency`,
      amounts.some(p => p.fils === 4210) && !amounts.some(p => p.fils === 6173) &&
      text.includes(i18n.t('statementMinimumUnconfirmed')) &&
      amounts.every(p => p.moneySpec?.currency === 'AED' && p.decimals === true && p.prefix !== false && p.sign !== 'minus'));
    tree = render({ dues: Array.from({ length: 61 }, () => due), language });
    const dueHeading = walk(tree).find(n => n.type === 'SectionHeader')?.props.title;
    ok(`${language}: statement preview caps rendered rows and discloses the full count`,
      walk(tree).filter(n => n.type === 'Money' && n.props.fils === 123456).length === 60 &&
      dueHeading.includes(i18n.t('statements')) && dueHeading.includes('60/61'));
    tree = render({ dues: [{ ...due, minDueFils: 0 }, { ...due, minDueFils: 0, minDueEstimated: true }],
      language, moneySpec: { schemaVersion: 2, currency: 'SAR', exponent: 2 } });
    const zeroMinimumAmounts = walk(tree).filter(n => n.type === 'Money').map(n => n.props);
    ok(`${language}: confirmed zero is visible, unconfirmed zero is withheld, and SAR is preserved`,
      zeroMinimumAmounts.filter(p => p.fils === 0).length === 1 &&
      zeroMinimumAmounts.every(p => p.moneySpec.currency === 'SAR') &&
      texts(tree).includes(i18n.t('statementMinimumUnconfirmed')));
  }
}

async function main() {
  importPreviewTests();
  universalHistoryReviewTests();
  await coordinatorTests();
  await importHistoryHandoffTests();
  {
    // iOS 26's Find Messages entity exposes Body, GUID and Date but no sender
    // (device probes, 2026-09-20), so a history record can arrive without one.
    // The bank must then come from the body: only a bank the body claims as
    // the reader's own ("your ADIB … card/account", or a leading "ADCB:"),
    // only when exactly one bank is claimed, and never from another bank's
    // ATM, a remitter, or a merchant name. A sender that resolves still wins.
    const adib = 'Dear Customer, your ADIB Covered Card ending with 4417 has been used for AED 250.00 at CARREFOUR MALL OF THE EMIRATES, DUBAI on 12/07/2026. Your available limit is AED 8,240.00.';
    const named = (text) => markets.soleBankNamedInText(text)?.name ?? null;
    ok('markets: the bank a body claims as yours resolves',
      named(adib) === 'ADIB' && named('Your ADIB Account XXXX1234 has been credited with AED 18,500.00') === 'ADIB' &&
      named('AED 500.00 spent on your Emirates NBD Credit Card ending 1234') === 'Emirates NBD');
    ok('markets: a leading bank header resolves',
      named('ADCB: Your account XXX1234 has been debited with AED 50.00') === 'ADCB');
    ok("markets: another bank's ATM, a remitter or a merchant name does not resolve",
      named('Your Card ending 1234 was used for AED 500.00 cash withdrawal at FAB ATM DUBAI MALL') === null &&
      named('AED 3,000.00 credited to your account XXXX4417 via funds transfer from EMIRATES NBD') === null &&
      named('AED 120.00 spent on your Card ending 1234 at AL MASHREQ AL ARABI RESTAURANT') === null &&
      named('AED 80.00 spent on your Card ending 1234 at ADIBA FLOWERS TR LLC') === null &&
      named('AED 40.00 spent on your Card ending 1234 at LIV GOLF STORE') === null);
    ok("markets: a transfer's destination account is not a claim",
      named('AED 2,500.00 has been transferred from your Account XXX1234 to your FAB Account ending 9876. Ref 88123') === null &&
      named('Your card ending 1234 at HSBC ATM; transfer to your FAB account 9876 completed') === null &&
      named('AED 2,500.00 transferred from your account XXX1234 into your FAB Account 9876') === null &&
      named('AED 2,500.00 has been transferred from your ADIB Account XXX1234 to your FAB Account ending 9876') === 'ADIB');
    ok('markets: a card payment addressed "to your" card is a safe miss, not a wrong bank',
      named('Payment of AED 1,000.00 to your ADCB Credit Card has been received from your account 1234') === null);
    ok('markets: a trailing brand period, "Acc", "wallet" and a header line still resolve',
      named('AED 50.00 spent from your Liv. account ending 1234 at NOON') === 'Liv' &&
      named('AED 500.00 withdrawn from your ADIB Acc XXX1234 at ATM') === 'ADIB' &&
      markets.withMarketPackForParsing('SA', () => named('SAR 30.00 paid from your stc pay wallet at JARIR')) === 'stc pay' &&
      named('RAKBANK\nYour Card ending 1234 was used for AED 90.00 at LULU') === 'RAKBANK' &&
      named('ADCB Alert Your account XXX1234 has been debited with AED 50.00') === 'ADCB');
    ok('markets: a "From HSBC:" header resolves',
      named('From HSBC: 24JUN25 DUBAI INTEGRATED ECO Purchase from 041-340***-001 AED 10.00- by Card Ending 1234') === 'HSBC');
    ok('markets: an inward credit "to your <bank> account" with no transfer wording resolves',
      named('Your salary of AED 18,500.00 has been credited to your RAKBANK Account XXXX1234. Available Balance AED 21,400.00') === 'RAKBANK' &&
      named('Profit of AED 34.22 has been credited to your ADIB Savings Account XXXX1234. Available Balance AED 5,000.00') === 'ADIB' &&
      named('AED 2,500.00 has been credited to your Wio Personal account from ACME TRADING LLC. Balance AED 5,000.00') === 'Wio');
    ok('markets: "to your <bank>" next to transfer, payment or debit wording is still not a claim',
      named('AED 500.00 debited from your account XXX1234 and credited to your FAB account 9876') === null &&
      named('AED 900.00 sent to your FAB account 9876 from your account XXX1234') === null &&
      named('Trf of AED 500.00 to your FAB account 9876 from a/c XXX1234. Bal AED 2,100.00') === null &&
      named('AED 300.00 to your FAB Account 9876 has been processed. Ref TT12345.') === null &&
      named('AED 1,200.00 moved to your ADCB account 4455 via wire') === null);
    ok('markets: two banks claimed as yours resolve none',
      named('Your ADIB Account XXX1234 and your FAB Account ending 9876 were both debited AED 100.00') === null);
    ok('markets: a body naming no bank resolves none',
      named('Purchase of AED 120.00 with Debit Card ending 1234') === null && named('') === null);
    ok('markets: the Saudi pack resolves its own banks',
      markets.withMarketPackForParsing('SA', () => named('SAR 250.00 spent on your Al Rajhi card ending 1234 at PANDA')) === 'Al Rajhi' &&
      named('SAR 250.00 spent on your Al Rajhi card ending 1234 at PANDA') === null);
    const senderless = parseHistoricalMessageRecords([record({ id: id('o'), text: adib, sender: undefined })], {}, NOW);
    ok('a senderless history record takes its bank from the one the body claims',
      senderless.parsed.length === 1 && senderless.parsed[0].bankHint === 'ADIB', senderless.parsed[0]);
    const plan = buildImportPlan(senderless.parsed, BASE, 0, NOW, senderless.declined);
    ok('the account minted for a senderless record carries that bank name',
      plan.batch.newAccounts.length === 1 && plan.batch.newAccounts[0].bankName === 'ADIB' &&
      plan.batch.newAccounts[0].last4 === '4417', plan.batch.newAccounts);
    const atm = 'AED 250.00 was spent on your ADIB Card ending 4417 at FAB ATM AL WAHDA MALL on 12/07/26. Available Balance: AED 8,240.00';
    const atmParsed = parseHistoricalMessageRecords([record({ id: id('p'), text: atm, sender: undefined })], {}, NOW);
    ok("another bank's ATM in the body does not displace the claimed bank",
      atmParsed.parsed.length === 1 && atmParsed.parsed[0].bankHint === 'ADIB', atmParsed.parsed);
    const noIssuer = 'AED 500.00 has been withdrawn from your Account XXX1234 at FAB ATM AL WAHDA MALL on 12/07/2026. Available Balance AED 2,900.00';
    const noIssuerParsed = parseHistoricalMessageRecords([record({ id: id('z'), text: noIssuer, sender: undefined })], {}, NOW);
    ok('a senderless record that names only another bank keeps no bank hint',
      noIssuerParsed.parsed.length === 1 && noIssuerParsed.parsed[0].bankHint === undefined, noIssuerParsed.parsed);
    const transfer = 'AED 2,500.00 has been transferred from your Account XXX1234 to your FAB Account ending 9876 on 12/07/2026. Available Balance AED 2,900.00';
    const transferParsed = parseHistoricalMessageRecords([record({ id: id('b'), text: transfer, sender: undefined })], {}, NOW);
    ok("a senderless transfer alert does not adopt the destination bank",
      transferParsed.parsed.length === 1 && transferParsed.parsed[0].bankHint === undefined, transferParsed.parsed);
    const withSender = parseHistoricalMessageRecords([record({ id: id('s'), text: adib, sender: 'ENBD' })], {}, NOW);
    ok('a recognised sender still outranks the bank claimed in the body',
      withSender.parsed.length === 1 && withSender.parsed[0].bankHint === 'Emirates NBD', withSender.parsed[0]);
  }
  if (fail > 0) {
    console.error(`\nhistorical-import: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  console.log(`\nhistorical-import: ${pass} passed, 0 failed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
