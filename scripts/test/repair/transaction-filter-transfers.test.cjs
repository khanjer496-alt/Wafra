'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const core = require('../build/transfer-reconciliation.js');
const { getTransferActivity } = load(path.join(root, 'src/lib/transfer-activity.ts'), {
  '@/lib/transfer-reconciliation': core,
});
const { createTransactionFilterIndex, projectTransactionFilter } = load(path.join(root, 'src/lib/transaction-filter.ts'), {
  '@/lib/categories': require('../build/categories.js'),
  '@/lib/format': require('../build/format.js'),
  '@/lib/ledger': require('../build/ledger.js'),
  '@/lib/splits': require('../build/splits.js'),
});
const defaults = { type: null, accountId: null, categories: new Set(), datePreset: 'all',
  dateFrom: null, dateTo: null, minFils: null, sort: 'newest' };
const options = { query: '', merchant: null, smsOnly: false, currentKey: '2026-09', period: { mode: 'all' },
  live: new Set(['bank']), internal: new Set(), corroborating: new Set() };
const NOW = Date.parse('2026-09-08T10:00:00Z');
const row = (id, extra = {}) => ({ id, accountId: 'bank', type: 'expense', amountFils: 10000,
  category: 'other', title: 'Outgoing transfer', source: 'sms', date: '2026-09-08', ts: NOW,
  transferDecision: { version: 1, ownership: 'external', decidedAt: NOW }, ...extra });
function project(rows, filters = defaults, overrides = {}) {
  const reconciliation = core.reconcileTransfers(rows, []);
  return projectTransactionFilter(createTransactionFilterIndex(rows, 'en'), filters, {
    ...options, internal: reconciliation.internalIds, corroborating: reconciliation.corroboratingIds,
    separateTransferIds: new Set(getTransferActivity(rows, [], reconciliation).map(item => item.transaction.id)), ...overrides,
  });
}

test('separated external transfers retain signed totals while visible days contain only visible records', () => {
  const rows = [row('sent'), row('received', { type: 'income', amountFils: 7000 }),
    row('coffee', { title: 'Coffee', category: 'dining', amountFils: 2000, transferDecision: undefined })];
  const result = project(rows);
  assert.deepEqual(Array.from(result.filtered, r => r.id), ['coffee']);
  assert.equal(result.totalShown, -5000);
  assert.equal(result.separatedTransfers.count, 2);
  assert.equal(result.separatedTransfers.incomeFils, 7000);
  assert.equal(result.separatedTransfers.expenseFils, 10000);
  assert.equal(result.days[0].totalFils, -2000);
  assert.equal(result.days[0].data.length, 1);
  assert.equal(result.totalShown, result.days[0].totalFils + result.separatedTransfers.incomeFils - result.separatedTransfers.expenseFils);
});

test('category split totals preserve only matching portions without duplicating them in visible day totals', () => {
  const rows = [row('split', { category: 'shopping', amountFils: 10000,
    splits: [{ category: 'groceries', amountFils: 3000 }, { category: 'shopping', amountFils: 7000 }] })];
  const result = project(rows, { ...defaults, categories: new Set(['groceries']) });
  assert.equal(result.filtered.length, 0);
  assert.equal(result.days.length, 0);
  assert.equal(result.totalShown, -3000);
  assert.equal(result.separatedTransfers.expenseFils, 3000);
  assert.equal(result.separatedTransfers.count, 1);
  assert.equal(project(rows, { ...defaults, categories: new Set(['dining']) }).separatedTransfers.count, 0);
});

test('own transfers and hidden accounts contribute zero and do not inflate visible exclusion descriptions', () => {
  const rows = [row('own', { transferDecision: { version: 1, ownership: 'own', decidedAt: NOW } }),
    row('hidden', { accountId: 'hidden' }),
    row('card-receipt', { type: 'income', title: 'Card payment', transferDecision: undefined, cardPaymentSide: 'receipt', isTransfer: true })];
  const result = project(rows);
  assert.equal(result.separatedTransfers.count, 2);
  assert.equal(result.separatedTransfers.expenseFils, 0);
  assert.equal(result.totalShown, 0);
  assert.deepEqual(Array.from(result.filtered, r => r.id), ['card-receipt']);
  assert.equal(result.excluded.transfers, 1);
  assert.equal(result.excluded.hidden, 0);
});

test('pending transfers move to their reviewable history while cashback stays in regular rows', () => {
  const rows = [row('unknown', { transferDecision: undefined }),
    row('cashback', { type: 'income', title: 'Cashback', amountFils: 500, transferDecision: undefined }),
    row('canonical'), row('corroborating')];
  const result = project(rows, defaults, { corroborating: new Set(['corroborating']) });
  assert.deepEqual(Array.from(result.filtered, r => r.id), ['cashback']);
  assert.equal(result.totalShown, -9500);
  assert.equal(result.separatedTransfers.count, 2);
  assert.equal(result.separatedTransfers.expenseFils, 10000);
  assert.equal(result.excluded.transfers, 0, 'moved records are not described as visible exclusions');
  const pending = getTransferActivity(rows, []).find(item => item.transaction.id === 'unknown');
  assert.equal(pending.needsReview, true);
  assert.equal(pending.ownership, 'unknown');
});

test('separating an uncertain transfer does not decide ownership; save and undo preserve browsing membership', () => {
  const unknown = row('unknown', { transferDecision: undefined });
  const before = JSON.stringify(unknown);
  const original = project([unknown]);
  assert.equal(original.filtered.length, 0);
  assert.equal(original.separatedTransfers.count, 1);
  assert.equal(original.totalShown, 0);
  const decided = { ...unknown, transferDecision: { version: 1, ownership: 'external', decidedAt: NOW } };
  const confirmed = project([decided]);
  assert.equal(confirmed.filtered.length, 0);
  assert.equal(confirmed.separatedTransfers.expenseFils, 10000);
  assert.equal(confirmed.totalShown, -10000);
  assert.equal(getTransferActivity([decided], [])[0].needsReview, false);
  const undone = project([{ ...decided, transferDecision: undefined }]);
  assert.equal(undone.filtered.length, 0);
  assert.equal(undone.totalShown, 0);
  assert.equal(undone.separatedTransfers.count, 1);
  assert.equal(JSON.stringify(unknown), before, 'viewing the record cannot set a decision');
});

test('all active filters apply before separation, including merchant, search, account and date', () => {
  const rows = [row('matched'), row('old', { date: '2026-08-01' }),
    row('merchant', { title: 'Incoming transfer' }), row('account', { accountId: 'other' }),
    row('manual', { source: 'manual' }), row('small', { amountFils: 1000 })];
  const result = project(rows, { ...defaults, datePreset: 'custom', dateFrom: '2026-09-01', dateTo: '2026-09-30',
    accountId: 'bank', minFils: 5000 }, { merchant: 'outgoing transfer', query: 'outgoing', smsOnly: true });
  assert.equal(result.separatedTransfers.count, 1);
  assert.equal(result.totalShown, -10000);
  assert.equal(project(rows, defaults, { query: 'not found' }).separatedTransfers.count, 0);
});

test('omitting separation preserves all pre-existing browsing and financial behavior', () => {
  const rows = [row('external'), row('own', { transferDecision: { version: 1, ownership: 'own', decidedAt: NOW } })];
  const result = project(rows, defaults, { separateTransferIds: undefined });
  assert.equal(result.filtered.length, 2);
  assert.equal(result.days[0].data.length, 2);
  assert.equal(result.days[0].totalFils, -10000);
  assert.equal(result.totalShown, -10000);
  assert.equal(result.excluded.transfers, 1);
  assert.equal(result.separatedTransfers.count, 0);
});
