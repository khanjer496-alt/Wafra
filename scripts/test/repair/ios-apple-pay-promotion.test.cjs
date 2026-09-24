'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
function current(name) {
  const file = path.join(root, 'src/lib', name + '.ts');
  const emitted = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {};
  for (const match of emitted.matchAll(/require\(["'](@\/lib\/[^"']+)["']\)/g)) {
    dependencies[match[1]] = require(path.join(build, match[1].slice(6) + '.js'));
  }
  return load(file, dependencies);
}
const { parseIosApplePayRecord } = current('ios-apple-pay-record');
const { planReviewPromotion } = current('review-promotion');
const { normalizeAlertReviewTray, resolveReviewAlert } = require(path.join(build, 'alert-review-tray.js'));
const now = Date.parse('2026-09-23T12:34:56.789Z');
function item() {
  return parseIosApplePayRecord(JSON.stringify({ amount: '25.00', currency: 'AED', merchant: 'Synthetic Cafe' }),
    '55555555-5555-4555-8555-555555555555', now).item;
}
const sms = (patch = {}) => ({ id: 'sms-first', source: 'sms', smsKey: 'h' + 'a'.repeat(64),
  ts: now + 5000, date: '2026-09-23', amountFils: 2500, type: 'expense', title: 'Synthetic Cafe',
  category: 'dining', accountId: 'card1', captureInstrument: { kind: 'credit', last4: '1234', bankIdentity: 'adib' }, ...patch });
const state = (review = item(), transactions = [sms()]) => ({ hydrated: true,
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  reviewTray: { schemaVersion: 1, pending: [review], tombstones: [], templateRules: [] },
  accounts: [{ id: 'card1', name: 'Card', kind: 'card', openingFils: 0, color: '#000', last4: '1234' },
    { id: 'card2', name: 'Other Card', kind: 'card', openingFils: 0, color: '#111', last4: '5678' }],
  transactions, budgets: [], bills: [], goals: [], cardDues: [], accountHints: {}, merchantOverrides: {}, lastScanTs: 0 });
const confirmation = (review, patch = {}) => ({ reviewId: review.id, type: 'expense', title: 'Synthetic Cafe', category: 'dining',
  accountId: 'card1', date: '2026-09-23', betweenOwnAccounts: false,
  universal: { confirmed: true, postingStatus: 'posted', amount: review.event.amount.value,
    expectedSourceKey: review.sourceKey, expectedObservedAt: review.observedAt }, ...patch });
const promote = (before, patch = {}) => planReviewPromotion(before, confirmation(before.reviewTray.pending[0], patch), 'wallet-added', now + 10000);

test('matching existing SMS blocks Wallet promotion without money changes or resolving its review', () => {
  const before = state(); const snapshot = JSON.stringify(before);
  const outcome = promote(before);
  assert.equal(outcome.outcome, 'refused');
  assert.equal(outcome.reason, 'possible-duplicate');
  assert.equal(JSON.stringify(before), snapshot);
  const reloaded = normalizeAlertReviewTray(JSON.parse(JSON.stringify(before.reviewTray)), now + 10000);
  assert.equal(reloaded.pending.length, 1);
  assert.equal(reloaded.tombstones.length, 0);
});

test('SMS arriving after a clean preview is checked against current authoritative state', () => {
  const before = state(item(), []);
  assert.equal(promote(before).outcome, 'added');
  const refreshed = { ...before, transactions: [sms()] };
  assert.equal(promote(refreshed).reason, 'possible-duplicate');
  assert.equal(refreshed.reviewTray.pending.length, 1);
  assert.equal(refreshed.reviewTray.tombstones.length, 0);
});

test('merchant normalization and the 120 second boundary do not allow a misleading title edit to bypass warning', () => {
  for (const existing of [sms({ title: '  SYNTHETIC   CAFE  ' }), sms({ ts: now + 120000 }),
    sms({ ts: undefined, smsKey: `s${now + 5000}-2500` })]) {
    assert.equal(promote(state(item(), [existing])).reason, 'possible-duplicate');
  }
  assert.equal(promote(state(), { title: 'Weekend coffee' }).reason, 'possible-duplicate');
});

test('different account, merchant, money, direction or later time is never auto-dismissed as the same purchase', () => {
  for (const existing of [sms({ accountId: 'card2' }), sms({ title: 'Different Merchant' }),
    sms({ amountFils: 2600 }), sms({ type: 'income' }), sms({ ts: now + 120001 })]) {
    assert.equal(promote(state(item(), [existing])).outcome, 'added');
  }
  const foreign = { ...state(), ledgerMoney: { schemaVersion: 2, currency: 'USD', exponent: 2 } };
  assert.equal(promote(foreign).reason, 'currency-mismatch');
});

test('explicit Already recorded resolution changes only review state and retains the original transaction', () => {
  const before = state(); const old = JSON.stringify(before.transactions);
  const resolved = resolveReviewAlert(before.reviewTray, before.reviewTray.pending[0].id, 'duplicate', now + 10000);
  assert.equal(resolved.pending.length, 0);
  assert.equal(resolved.tombstones[0].outcome, 'duplicate');
  assert.equal(JSON.stringify(before.transactions), old);
});

test('other review sources retain existing behavior and exact same-source replays remain duplicate', () => {
  const generic = { ...item(), id: 'generic_review_id_123456', sourceKey: 'generic_review_source_123456' };
  assert.equal(promote(state(generic)).outcome, 'added');
  const own = item();
  assert.equal(promote(state(own, [sms({ smsKey: own.sourceKey })])).outcome, 'duplicate');
});
