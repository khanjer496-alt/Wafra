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

test('bank merchant text and late SMS delivery still ask before a second copy of one purchase is added', () => {
  // Wallet says "Synthetic Cafe"; the bank descriptor rarely matches it and
  // SMS delivery can lag by minutes. Neither may post the purchase twice.
  const observedAt = item().observedAt;
  for (const existing of [sms({ title: 'SYNTHETIC CAFE MOE DXB' }), sms({ title: 'Card purchase' }),
    sms({ ts: observedAt + 5 * 60_000 }), sms({ ts: observedAt - 5 * 60_000 }),
    sms({ ts: observedAt + 10 * 60_000, title: 'SYNTH*CAFE 0042' }), sms({ ts: observedAt - 10 * 60_000 }),
    sms({ ts: undefined, smsKey: `s${observedAt + 7 * 60_000}-2500`, title: 'POS PURCHASE' })]) {
    const before = state(item(), [existing]); const snapshot = JSON.stringify(before);
    const outcome = promote(before);
    assert.equal(outcome.reason, 'possible-duplicate', JSON.stringify(existing));
    assert.equal(JSON.stringify(before), snapshot);
  }
});

test('different account, money, direction or a clock beyond ten minutes is never auto-dismissed as the same purchase', () => {
  const observedAt = item().observedAt;
  for (const existing of [sms({ accountId: 'card2' }), sms({ amountFils: 2600 }), sms({ type: 'income' }),
    sms({ ts: observedAt + 10 * 60_000 + 1 }), sms({ ts: observedAt - 10 * 60_000 - 1 }),
    sms({ ts: undefined, smsKey: undefined, source: 'manual' })]) {
    assert.equal(promote(state(item(), [existing])).outcome, 'added', JSON.stringify(existing));
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

const walletRow = (patch = {}) => sms({ id: 'wallet-earlier', smsKey: 'apple_pay_review_source_' + 'b'.repeat(32),
  viaPush: true, userEdited: true, titleEdited: true, captureInstrument: undefined, ...patch });

test('two separate Apple Pay observations are compared by merchant and a two minute clock only', () => {
  const observedAt = item().observedAt;
  for (const existing of [walletRow({ ts: observedAt + 60_000 }), walletRow({ title: ' synthetic  cafe ' })]) {
    assert.equal(promote(state(item(), [existing])).reason, 'possible-duplicate');
  }
  for (const existing of [walletRow({ title: 'Other Shop' }), walletRow({ ts: observedAt + 5 * 60_000 })]) {
    assert.equal(promote(state(item(), [existing])).outcome, 'added');
  }
});

test('any bank review promoted after its Apple Pay row asks instead of posting the purchase twice', () => {
  const observedAt = now - 60_000;
  const generic = { ...item(), id: 'generic_review_id_123456', sourceKey: 'generic_review_source_123456', channel: 'push', observedAt };
  for (const existing of [walletRow({ ts: observedAt + 5 * 60_000, title: 'Synthetic Cafe' }),
    walletRow({ ts: observedAt - 9 * 60_000, title: 'Something the user typed' })]) {
    const before = state(generic, [existing]); const snapshot = JSON.stringify(before);
    const outcome = promote(before, { title: 'SYNTHETIC CAFE MOE DXB' });
    assert.equal(outcome.reason, 'possible-duplicate', JSON.stringify(existing));
    assert.equal(JSON.stringify(before), snapshot);
    assert.equal(before.reviewTray.pending.length, 1);
  }
  for (const existing of [walletRow({ accountId: 'card2' }), walletRow({ amountFils: 2600 }),
    walletRow({ ts: observedAt + 10 * 60_000 + 1 }), walletRow({ type: 'income' })]) {
    assert.equal(promote(state(generic, [existing])).outcome, 'added', JSON.stringify(existing));
  }
  // Registered bank templates (non-universal review) take the same check.
  const registered = { id: 'opaque_review_id_000001', sourceKey: 'opaque_source_key_00001', observedAt,
    expiresAt: now + 86_400_000, channel: 'inbox', parserVersion: 1, market: 'AE', institution: 'adib',
    grammar: { id: 'adib-sms-v1', version: 1, channel: 'bank-alert', status: 'experimental', provenance: 'synthetic-seed' },
    amount: { currency: 'AED', minorUnits: '2500', exponent: 2 }, direction: 'debit', family: 'purchase', rail: null,
    instrument: { kind: 'card', last4: '1234' } };
  const registeredPromote = (transactions, patch = {}) => planReviewPromotion(state(registered, transactions),
    { reviewId: registered.id, type: 'expense', title: 'Card purchase', category: 'dining', accountId: 'card1',
      date: '2026-09-23', betweenOwnAccounts: false, ...patch }, 'bank-added', now + 10000);
  assert.equal(registeredPromote([walletRow({ ts: observedAt + 4 * 60_000 })]).reason, 'possible-duplicate');
  assert.equal(registeredPromote([walletRow({ ts: observedAt + 11 * 60_000 })]).outcome, 'added');
  assert.equal(registeredPromote([walletRow({ ts: observedAt + 4 * 60_000 })], { type: 'income', category: 'salary' }).outcome, 'added');
  assert.equal(registeredPromote([sms({ ts: observedAt + 4 * 60_000 })]).outcome, 'added',
    'non-Wallet rows keep their existing registered-review behavior');
  // A Wallet row with no event clock cannot be placed in time; its source key
  // carries none either, so it is not comparable and the review is added.
  const clockless = { ...generic, id: 'generic_review_id_654321', sourceKey: 'generic_review_source_654321' };
  assert.equal(promote(state(clockless, [walletRow({ ts: undefined })])).outcome, 'added');
});

test('an explicit separate-purchase confirmation bound to the exact pending source adds one row once', () => {
  const separateFor = review => ({ separatePurchase: { confirmed: true, expectedSourceKey: review.sourceKey,
    expectedObservedAt: review.observedAt } });
  const wallet = item();
  const before = state(wallet, [sms({ title: 'SYNTHETIC CAFE MOE DXB' })]);
  assert.equal(promote(before).reason, 'possible-duplicate');
  const added = promote(before, separateFor(wallet));
  assert.equal(added.outcome, 'added');
  assert.equal(added.transaction.amountFils, 2500);
  assert.equal(added.reviewTray.pending.length, 0, 'the review is resolved, so it cannot be added again');
  const after = { ...before, transactions: [...before.transactions, added.transaction], reviewTray: added.reviewTray };
  assert.equal(planReviewPromotion(after, confirmation(wallet, separateFor(wallet)), 'again', now + 20000).reason, 'not-found');
  // Bound to the exact source the user saw; a stale or unconfirmed claim is refused.
  for (const bad of [{ separatePurchase: { confirmed: true, expectedSourceKey: 'apple_pay_review_source_' + 'f'.repeat(32), expectedObservedAt: wallet.observedAt } },
    { separatePurchase: { confirmed: true, expectedSourceKey: wallet.sourceKey, expectedObservedAt: wallet.observedAt + 1 } },
    { separatePurchase: { confirmed: false, expectedSourceKey: wallet.sourceKey, expectedObservedAt: wallet.observedAt } }]) {
    assert.equal(promote(before, bad).reason, 'source-changed');
  }
  // It never overrides exact source identity.
  assert.equal(promote(state(wallet, [sms({ smsKey: wallet.sourceKey })]), separateFor(wallet)).outcome, 'duplicate');
  // Registered bank reviews honour the same explicit confirmation.
  const registered = { id: 'opaque_review_id_000002', sourceKey: 'opaque_source_key_00002', observedAt: now - 60_000,
    expiresAt: now + 86_400_000, channel: 'inbox', parserVersion: 1, market: 'AE', institution: 'adib',
    grammar: { id: 'adib-sms-v1', version: 1, channel: 'bank-alert', status: 'experimental', provenance: 'synthetic-seed' },
    amount: { currency: 'AED', minorUnits: '2500', exponent: 2 }, direction: 'debit', family: 'purchase', rail: null,
    instrument: { kind: 'card', last4: '1234' } };
  const input = { reviewId: registered.id, type: 'expense', title: 'Card purchase', category: 'dining', accountId: 'card1',
    date: '2026-09-23', betweenOwnAccounts: false };
  const registeredState = state(registered, [walletRow({ ts: now - 30_000 })]);
  assert.equal(planReviewPromotion(registeredState, input, 'bank-added', now).reason, 'possible-duplicate');
  assert.equal(planReviewPromotion(registeredState, { ...input, ...separateFor(registered) }, 'bank-added', now).outcome, 'added');
});
