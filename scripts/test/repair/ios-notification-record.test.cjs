'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const file = path.join(root, 'src/lib/local-message-record.ts');
const dependencies = {};
for (const match of fs.readFileSync(file, 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
  dependencies[match[1]] = require(path.join(build, match[1].slice(6) + '.js'));
}
const { parseLocalMessageRecord, preflightLocalMessageRecord } = load(file, dependencies);
const { createLaunchAlertSession } = require(path.join(build, 'launch-alert-parser.js'));
const { buildImportPlan } = require(path.join(build, 'import-plan.js'));
const markets = require(path.join(build, 'markets.js'));
markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
const id = '55555555-5555-4555-8555-555555555555';
const observedAt = '2026-09-18T10:30:00.000Z';
const now = new Date('2026-09-19T12:00:00.000Z');
const purchase = 'Your ADIB Covered Card ending with 4417 has been used for AED 250.00 at CARREFOUR on 18/09/2026. Your available limit is AED 8,240.00.';
const envelope = (text = purchase, patch = {}) => JSON.stringify({
  v: 1, id, text, sender: 'Wafra Notification', source: 'notification', observedAt, ...patch,
});
const parse = (text = purchase, patch = {}) => {
  const serialized = envelope(text, patch);
  return parseLocalMessageRecord(serialized, now, preflightLocalMessageRecord(serialized, now)?.market ?? null,
    createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' }));
};
const state = (transactions = []) => ({ hydrated: true, accounts: [], transactions,
  budgets: [], bills: [], goals: [], cardDues: [], accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 });
const sourceFree = (outcome, text) => {
  assert.equal(JSON.stringify(outcome).includes(text), false);
  assert.equal(JSON.stringify(outcome).includes('Wafra Notification'), false);
  const row = outcome.row ?? outcome.item ?? outcome;
  assert.equal(Object.hasOwn(row, 'raw'), false);
  assert.equal(Object.hasOwn(row, 'sender'), false);
};

test('notification preflight admits only the fixed untrusted sender and UUID identity', () => {
  const preflight = preflightLocalMessageRecord(envelope(), now);
  assert.equal(preflight.valid, true);
  assert.equal(preflight.attribution, null);
  assert.equal(preflight.market, 'AE');
  for (const patch of [{ sender: 'ENBD' }, { sender: 'ADIB' }, { id: 'a'.repeat(64) },
    { source: 'push' }, { pkg: 'com.bank.app' }]) {
    assert.equal(parse(purchase, patch).kind, 'invalid');
  }
  assert.equal(preflightLocalMessageRecord(envelope(purchase, { sender: 'ENBD' }), now).attribution, null);
});

test('financial notification preserves push provenance and replay identity without raw content', () => {
  const result = parse();
  assert.equal(result.kind, 'parsed');
  assert.equal(result.row.channel, 'push');
  assert.equal(result.row.sourceEventId, undefined);
  assert.equal(result.row.notificationObservationId, id);
  assert.equal(result.row.amountFils, 25000);
  assert.equal(result.row.bankHint, 'ADIB', 'body hint is retained, never verified sender attribution');
  sourceFree(result, purchase);
  const plan = buildImportPlan([result.row], state(), 0, now);
  assert.equal(plan.txCount, 1);
  assert.equal(plan.batch.transactions[0].viaPush, true);
  assert.equal(plan.batch.transactions[0].smsKey, `s${Date.parse(observedAt)}-25000`);
  const existing = { ...plan.batch.transactions[0], id: 'saved' };
  assert.equal(buildImportPlan([result.row], state([existing]), 0, now).txCount, 0);
});

test('OTP and promotional notifications never create ledger or review entries', () => {
  for (const text of ['Your OTP is 123456 for an AED 250.00 purchase. Do not share it.',
    'Get AED 50 cashback on your next purchase with your ADIB card.', 'Your login verification code is 123456.']) {
    const result = parse(text);
    assert.equal(result.kind, 'ignored');
    sourceFree(result, text);
  }
});

test('unknown income receipt goes to source-free push review', () => {
  const text = 'Your account has been credited with AED 80.00. Reference 123456.';
  const result = parse(text);
  assert.equal(result.kind, 'review');
  assert.equal(result.item.channel, 'push');
  sourceFree(result, text);
});

test('notification declines cannot delete unrelated SMS at the same arrival time', () => {
  const text = 'Your card transaction was declined for AED 22.00.';
  const result = parse(text);
  assert.equal(result.kind, 'declined');
  assert.equal(result.row.channel, 'push');
  assert.equal(result.row.sourceEventId, id);
  sourceFree(result, text);
  const unrelated = { id: 'saved', type: 'expense', amountFils: 2200, category: 'other', accountId: 'bank',
    title: 'Synthetic purchase', date: '2026-09-18', ts: Date.parse(observedAt), source: 'sms', smsKey: 'h' + 'a'.repeat(64) };
  const plan = buildImportPlan([], state([unrelated]), 0, now, [result.row]);
  assert.equal(plan.batch.updates.length, 0);
});

test('existing exact Apple Message attribution and channel remain unchanged', () => {
  const result = parse(purchase, { source: 'message', sender: 'ADIB', id: 'a'.repeat(64) });
  assert.equal(result.kind, 'parsed');
  assert.equal(result.row.channel, 'inbox');
  assert.equal(result.row.sourceEventId, 'a'.repeat(64));
  assert.equal(result.row.notificationObservationId, undefined);
  assert.equal(preflightLocalMessageRecord(envelope(purchase, { source: 'message', sender: 'ADIB' }), now).valid, true);
});

test('explicit salary remains automatic and informational balance remains review-only', () => {
  const salary = 'Your ADIB account ending 1234 has been credited with salary of AED 5000.00 on 18/09/2026.';
  const result = parse(salary);
  assert.equal(result.kind, 'parsed');
  assert.equal(result.row.type, 'income');
  assert.equal(result.row.categoryGuess, 'salary');
  assert.equal(result.row.amountFils, 500000);
  assert.equal(result.row.channel, 'push');
  assert.equal(buildImportPlan([result.row], state(), 0, now).txCount, 1);
  sourceFree(result, salary);
  const balance = 'ADIB Your available balance is AED 80.00.';
  const review = parse(balance);
  assert.equal(review.kind, 'review');
  assert.equal(review.item.channel, 'push');
  assert.equal(review.item.event.family, 'balance');
  sourceFree(review, balance);
});

test('body-named bank cannot confer verified transfer source attribution', () => {
  const text = 'Your local transfer of AED 813.00 to Example Person from your WIO account number 90XXXX7777 was processed. Available balance is AED 91.00.';
  const result = parse(text);
  assert.equal(result.kind, 'parsed');
  assert.equal(result.row.transferEvidence.attribution, 'fallback');
  sourceFree(result, text);
});

test('existing cross-channel dedupe reconciles notification and SMS in both arrival orders', () => {
  const { materializeImportBatch, applyMaterializedImportBatch } = require(path.join(build, 'ledger-import.js'));
  let sequence = 0;
  const apply = (before, row) => {
    const plan = buildImportPlan([row], before, 0, now);
    const materialized = materializeImportBatch(plan.batch, before, prefix => prefix + (++sequence));
    return applyMaterializedImportBatch(before, materialized);
  };
  const push = parse().row;
  const sms = parse(purchase, { source: 'message', sender: 'ADIB', id: 'a'.repeat(64), observedAt: '2026-09-18T10:30:05.000Z' }).row;
  for (const [first, second] of [[push, sms], [sms, push]]) {
    const after = apply(apply(state(), first), second);
    assert.equal(after.transactions.length, 1);
    assert.equal(after.transactions[0].amountFils, 25000);
    assert.notEqual(after.transactions[0].viaPush, true, 'the existing better-SMS policy wins');
    assert.equal(after.transactions[0].smsKey, 'h' + sms.sourceEventId,
      'a later notification observation cannot replace exact SMS identity');
    assert.equal(apply(after, push).transactions.length, 1, 'replaying the queue cannot add money');
  }
  const unrelated = parse(purchase.replace('CARREFOUR', 'COSTA COFFEE'), {
    source: 'message', sender: 'ADIB', id: 'b'.repeat(64), observedAt: '2026-09-18T10:30:05.000Z',
  }).row;
  assert.equal(apply(apply(state(), push), unrelated).transactions.length, 2,
    'matching money and arrival time cannot erase a different merchant');
});

test('notification transport rejects malformed text, dates and extra authority claims', () => {
  for (const [text, patch] of [['', {}], ['\ud800', {}], ['x'.repeat(16385), {}],
    [purchase, { observedAt: '2026-02-30T10:30:00.000Z' }],
    [purchase, { observedAt: '2026-09-19T12:06:00.000Z' }],
    [purchase, { sourceEventId: 'a'.repeat(64) }], [purchase, { v: 2 }]]) {
    assert.equal(parse(text, patch).kind, 'invalid');
  }
});

test('a notification without an issuer cannot inherit the user\'s single known bank', () => {
  const text = 'Your Credit Card ending with 4417 has been used for AED 250.00 at CARREFOUR on 18/09/2026.';
  const result = parse(text);
  assert.equal(result.kind, 'review');
  assert.equal(result.item.channel, 'push');
  sourceFree(result, text);
  assert.equal(JSON.stringify(result).includes('ADIB'), false);
  const knownBankState = { ...state(), knownBanks: ['ADIB'] };
  const plan = buildImportPlan(result.kind === 'parsed' ? [result.row] : [], knownBankState, 0, now);
  assert.equal(plan.txCount, 0);
  assert.equal(plan.newAccountCount, 0);
  const sms = parse(text, { source: 'message', sender: 'ADIB', id: 'a'.repeat(64) });
  assert.equal(sms.kind, 'parsed', 'existing sender-attributed SMS behavior is unchanged');
  assert.equal(sms.row.bankHint, 'ADIB');
});

test('body issuer outranks an unrelated single known bank without setup bank selection', () => {
  const result = parse();
  assert.equal(result.kind, 'parsed');
  const plan = buildImportPlan([result.row], { ...state(), knownBanks: ['Emirates NBD'] }, 0, now);
  assert.equal(plan.txCount, 1);
  assert.equal(plan.batch.newAccounts[0].bankName, 'ADIB');
});

test('an issuer-free parse with no safe review representation stays unposted', () => {
  const text = 'Payment received AED 80.00.';
  const result = parse(text);
  assert.equal(result.kind, 'ignored');
  sourceFree(result, text);
  const plan = buildImportPlan(result.kind === 'parsed' ? [result.row] : [],
    { ...state(), knownBanks: ['ADIB'] }, 0, now);
  assert.equal(plan.txCount, 0);
  assert.equal(plan.newAccountCount, 0);
});

test('repeated notification observations with fresh UUIDs use existing push dedupe', () => {
  const { materializeImportBatch, applyMaterializedImportBatch } = require(path.join(build, 'ledger-import.js'));
  let sequence = 0;
  const apply = (before, row) => applyMaterializedImportBatch(before,
    materializeImportBatch(buildImportPlan([row], before, 0, now).batch, before, prefix => prefix + (++sequence)));
  const first = parse().row;
  const repeat = parse(purchase, { id: '66666666-6666-4666-8666-666666666666', observedAt: '2026-09-18T10:30:01.000Z' }).row;
  const after = apply(apply(state(), first), repeat);
  assert.equal(after.transactions.length, 1, 'observation UUIDs do not prove two financial events');
  assert.equal(after.transactions[0].viaPush, true, 'push replay cannot claim SMS provenance');
  assert.equal(apply(after, repeat).transactions.length, 1);
  for (const [text, clock] of [[purchase.replace('CARREFOUR', 'COSTA COFFEE'), '2026-09-18T10:30:01.000Z'],
    [purchase.replace('4417', '5528'), '2026-09-18T10:30:01.000Z'], [purchase, '2026-09-18T10:33:01.000Z']]) {
    const distinct = parse(text, { id: '77777777-7777-4777-8777-777777777777', observedAt: clock }).row;
    assert.equal(apply(apply(state(), first), distinct).transactions.length, 2,
      'different merchant/card or later event cannot be erased by dedupe');
  }
});

test('card-payment notifications remain in durable Review before any accounting mutation', () => {
  const text = 'ADIB: Payment of AED 100.00 received towards your Covered Card ending 4417. Thank you.';
  const result = parse(text);
  assert.equal(result.kind, 'review');
  assert.equal(result.item.channel, 'push');
  sourceFree(result, text);
  assert.equal(buildImportPlan(result.kind === 'parsed' ? [result.row] : [], state(), 0, now).txCount, 0);
  assert.equal(parse(text, { source: 'message', sender: 'ADIB', id: 'a'.repeat(64) }).row.kind, 'cardPayment');
});
