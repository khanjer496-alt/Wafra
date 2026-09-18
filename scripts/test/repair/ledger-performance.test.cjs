'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ledger = require('../build/ledger');
const { reconcileTransfers, TRANSFER_NORMALIZATION_VERSION } = require('../build/transfer-reconciliation');
const day = 86400000;
const start = Date.UTC(2026, 0, 1, 12);
const accounts = [
  { id: 'bank', name: 'Current', kind: 'bank', bankName: 'ADCB', last4: '1111', archived: true },
  { id: 'savings', name: 'Savings', kind: 'bank', bankName: 'ADCB', last4: '2222' },
  { id: 'card', name: 'Credit', kind: 'card', cardType: 'credit', bankName: 'ADCB', last4: '3333' },
];
const evidence = reference => ({ version: 1, currency: 'AED', attribution: 'source', reference });
const row = (id, type, at, extra = {}) => ({
  id, type, ts: at, date: '2026-01-01', amountFils: 10000,
  accountId: type === 'expense' ? 'bank' : 'savings',
  title: type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
  category: 'other', source: 'sms',
  captureInstrument: { last4: type === 'expense' ? '1111' : '2222', kind: 'account', bankIdentity: 'ADCB' },
  transferEvidence: evidence('SYNTHETIC984512'), ...extra,
});
const paired = (rows, owned = accounts) => [...ledger.internalTransferIds(rows, owned)].sort();
const check = (rows, expected, owned = accounts) => {
  assert.deepEqual(paired(rows, owned), [...expected].sort());
  assert.deepEqual(paired([...rows].reverse(), owned), [...expected].sort(), 'input order cannot break ownership ties');
};

test('independent evidence wins over nearer equal-amount rows; equal evidence never uses a tie-break', () => {
  const rows = [row('far', 'expense', start - 2 * day),
    row('right', 'expense', start + day, { transferEvidence: evidence('OTHER981231') }),
    row('left', 'expense', start - day, { transferEvidence: evidence('OTHER984922') }), row('in', 'income', start)];
  check(rows, ['far', 'in']);
  const ambiguous = [row('right', 'expense', start + day), row('left', 'expense', start - day), row('in', 'income', start)];
  check(ambiguous, []);
  assert.equal(reconcileTransfers(ambiguous, accounts).pendingIds.size, 3);
});
test('three-day boundary is inclusive and one millisecond beyond is excluded', () => {
  for (const offset of [-3 * day - 1, -3 * day, 3 * day, 3 * day + 1]) {
    check([row('out', 'expense', start + offset), row('in', 'income', start)], Math.abs(offset) <= 3 * day ? ['out', 'in'] : []);
  }
});
test('competing or repeated same-account reference observations leave ownership unresolved', () => {
  check([row('out', 'expense', start), row('first', 'income', start), row('second', 'income', start)], []);
  const sameAccount = row('same', 'income', start, { accountId: 'bank',
    captureInstrument: { last4: '1111', kind: 'account', bankIdentity: 'ADCB' } });
  check([row('out', 'expense', start), sameAccount], []);
  check([row('out', 'expense', start), sameAccount, row('real', 'income', start)], []);
});
test('ordinary spending, salaries, refunds and card settlements do not become transfer partners', () => {
  for (const patch of [{ category: 'salary' }, { title: 'Refund' }, { cardPaymentSide: 'receipt' },
    { category: 'business', title: 'Talabat Business' }]) {
    check([row('out', 'expense', start), row('in', 'income', start, patch)], []);
  }
  check([row('shop', 'expense', start, { title: 'Grocery', transferEvidence: undefined }), row('in', 'income', start)], []);
  check([row('out', 'expense', start), row('in', 'income', start, { isTransfer: true })], ['out', 'in']);
});
test('archived account identity proves a pair but visibility-only sets cannot invent identity', () => {
  const rows = [row('out', 'expense', start), row('in', 'income', start)];
  check(rows, ['out', 'in']);
  check(rows, [], new Set(['savings']));
  check(rows, [], [accounts[1]]);
  const explicit = [row('own', 'expense', start, { title: 'Own account transfer', isTransfer: true, transferEvidence: undefined })];
  check(explicit, ['own'], new Set(['savings']));
});
test('valid source clocks support boundaries; missing or invalid clocks never use invented date proximity', () => {
  for (const at of [undefined, null, NaN, Infinity, -Infinity]) {
    check([row('out', 'expense', at), row('in', 'income', at)], []);
  }
  check([row('out', 'expense', 0), row('in', 'income', 0)], ['out', 'in']);
  check([row('out', 'expense', undefined, { date: 'invalid' }), row('in', 'income', start)], []);
  check([row('out', 'expense', undefined, { smsKey: `s${start}-10000` }),
    row('in', 'income', undefined, { smsKey: `s${start}-10000` })], ['out', 'in']);
});
test('generic transfers without evidence remain pending instead of pairing equal amounts', () => {
  const rows = [row('out', 'expense', start, { transferEvidence: undefined, isTransfer: true }),
    row('in', 'income', start, { transferEvidence: undefined })];
  check(rows, []);
  assert.deepEqual([...reconcileTransfers(rows, accounts).pendingIds].sort(), []);
});
test('does not mutate the transaction array or its rows', () => {
  const rows = Object.freeze([Object.freeze(row('out', 'expense', start)), Object.freeze(row('in', 'income', start))]);
  check(rows, ['out', 'in']);
});
test('400 seeded mixed ledgers match only their explicitly evidenced pairs regardless of input order', () => {
  let seed = 0xabc123;
  const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 0x100000000) * n); };
  const titles = ['Outgoing transfer', 'Incoming transfer', 'Inward remittance', 'Bank transfer', 'Grocery', 'Salary', 'Refund'];
  let matched = 0;
  for (let sample = 0; sample < 400; sample += 1) {
    const rows = Array.from({ length: 132 }, (_, i) => row(`noise-${sample}-${i}`, random(2) ? 'expense' : 'income',
      start + (random(30) - 15) * day + random(3), {
        amountFils: [0, 100, 1000, 10000, 9900][random(5)], accountId: ['bank', 'savings', 'card', 'unknown'][random(4)],
        title: titles[random(titles.length)], category: random(7) === 0 ? 'salary' : 'other',
        isTransfer: random(5) === 0, transferEvidence: undefined,
      }));
    const expected = [];
    for (let n = 0; n < 4; n += 1) {
      const at = start + (random(30) - 15) * day;
      const shared = { amountFils: [100, 1000, 10000, 9900][random(4)], transferEvidence: evidence(`SEED${sample}PAIR${n}984512`) };
      const out = `out-${sample}-${n}`; const incoming = `in-${sample}-${n}`;
      rows.push(row(out, 'expense', at, shared), row(incoming, 'income', at + random(3) * day, shared));
      expected.push(out, incoming);
    }
    check(rows, expected);
    matched += ledger.internalTransferIds(rows, accounts).size;
  }
  assert.equal(matched, 3200, 'all 1,600 independently evidenced pairs must be exercised');
});
test('12,000 repeated evidence collisions stay bounded and fail closed', () => {
  const rows = Array.from({ length: 12000 }, (_, i) => row(`collision-${i}`, i % 2 ? 'income' : 'expense', start));
  const began = performance.now();
  assert.equal(ledger.internalTransferIds(rows, accounts).size, 0);
  assert.equal(reconcileTransfers(rows, accounts).pendingIds.size, rows.length);
  assert.ok(performance.now() - began < 5000, 'bounded evidence-index scans must avoid quadratic repeated-amount work');
});

test('current persisted transfer receipt bypasses graph reconciliation for UI totals', () => {
  const rows = Array.from({ length: 12000 }, (_, i) => row(`receipt-${i}`, i % 2 ? 'income' : 'expense', start));
  const state = {
    transactions: rows,
    accounts,
    transferNormalizationVersion: TRANSFER_NORMALIZATION_VERSION,
    transferInternalIds: ['receipt-1', 'receipt-7'],
    historyImport: { status: 'complete' },
  };
  const first = ledger.internalTransferIdsForState(state);
  const second = ledger.internalTransferIdsForState(state);
  assert.equal(first, second, 'same immutable snapshot should reuse the receipt-backed Set');
  assert.deepEqual([...first].sort(), ['receipt-1', 'receipt-7']);

  const stale = ledger.internalTransferIdsForState({
    ...state,
    transferNormalizationVersion: TRANSFER_NORMALIZATION_VERSION - 1,
    transferInternalIds: ['invented-id'],
  });
  assert.equal(stale.has('invented-id'), false, 'an old receipt must never override live reconciliation');
  const staleAgain = ledger.internalTransferIdsForState({
    ...state,
    transferNormalizationVersion: TRANSFER_NORMALIZATION_VERSION - 1,
    transferInternalIds: ['invented-id'],
  });
  assert.equal(staleAgain, stale,
    'same immutable stale-receipt snapshot reuses the canonical live reconciliation');
});

test('unfinished history import may use the store provisional transfer receipt after process death', () => {
  const base = {
    transactions: [row('pending-out', 'expense', start)],
    accounts,
    transferNormalizationVersion: undefined,
    transferInternalIds: ['provisional-only-id'],
  };
  for (const status of ['running', 'paused', 'failed']) {
    assert.deepEqual(
      [...ledger.internalTransferIdsForState({ ...base, historyImport: { status } })],
      ['provisional-only-id'],
      `${status} import must not rebuild the complete transfer graph`,
    );
  }
  const complete = ledger.internalTransferIdsForState({ ...base, historyImport: { status: 'complete' } });
  assert.equal(complete.has('provisional-only-id'), false, 'completion requires the final canonical receipt');
});

test('FAB complementary transfer alerts collapse to one displayed event without full reconciliation', () => {
  const fabAccounts = [{ id: 'fab', name: 'FAB ·0002', kind: 'bank', bankName: 'FAB', last4: '0002' }];
  const transfer = (id, form, at, reference = 'FABREF984512') => ({
    id,
    type: 'expense',
    ts: at,
    date: '2026-09-15',
    amountFils: 56_500,
    accountId: 'fab',
    title: form === 'transfer-detail' ? 'Outgoing transfer' : 'Outward remittance',
    category: 'other',
    source: 'sms',
    smsKey: `s${at}-${id}`,
    captureInstrument: { last4: '0002', kind: 'account', bankIdentity: 'FAB' },
    transferEvidence: {
      version: 1, currency: 'AED', attribution: 'source', sourceBank: 'FAB',
      reference, postingForm: form,
    },
  });
  const detail = transfer('detail', 'transfer-detail', start);
  const confirmation = transfer('confirmation', 'remittance-debit', start + 30_000);
  const noise = Array.from({ length: 14_761 }, (_, i) => ({
    id: `ordinary-${i}`, type: 'expense', date: '2026-09-01', amountFils: 100 + i,
    accountId: 'fab', title: 'Shop', category: 'other', source: 'sms',
  }));
  const state = { transactions: [detail, confirmation, ...noise], accounts: fabAccounts };
  const first = ledger.corroboratingTransferIdsForState(state);
  const second = ledger.corroboratingTransferIdsForState(state);
  assert.equal(first, second, 'same immutable ledger reuses the cheap display projection');
  assert.deepEqual([...first], ['confirmation']);

  const ambiguous = {
    transactions: [detail, transfer('detail-2', 'transfer-detail', start + 10_000), confirmation],
    accounts: fabAccounts,
  };
  assert.deepEqual([...ledger.corroboratingTransferIdsForState(ambiguous)], [],
    'two possible primaries fail closed instead of hiding a real transfer');

  const contradicted = {
    transactions: [detail, transfer('other-ref', 'remittance-debit', start + 30_000, 'DIFFERENT984512')],
    accounts: fabAccounts,
  };
  assert.deepEqual([...ledger.corroboratingTransferIdsForState(contradicted)], [],
    'different bank references are two events, not a display duplicate');
});
