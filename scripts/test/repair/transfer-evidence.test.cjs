'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const loadTypescript = require('./load-typescript.cjs');

// Load the actual pure source graph without racing the shared build directory.
const cache = new Map();
function local(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.resolve(__dirname, '../../../src/lib', name + '.ts');
  const dependencies = new Proxy({}, {
    getOwnPropertyDescriptor(_target, key) {
      return typeof key === 'string' && (key.startsWith('@/lib/') || key.startsWith('@noble/hashes/'))
        ? { configurable: true, enumerable: true, value: true } : undefined;
    },
    get(_target, key) { return key.startsWith('@/lib/') ? local(key.slice('@/lib/'.length)) : require(key); },
  });
  const loaded = loadTypescript(file, dependencies);
  cache.set(name, loaded);
  return loaded;
}
const parser = local('sms-parser');
const markets = local('markets');
markets.setActiveMarket('AE');
markets.setLedgerCurrency('AED', 2);

const row = overrides => ({
  kind: 'transaction', type: 'expense', amountFils: 10000, currency: 'AED',
  merchant: 'Outgoing transfer', categoryGuess: 'other', transferHint: true,
  card: { last4: '1111', kind: 'account' }, sender: 'FAB',
  reference: null, date: '2026-09-06', snapshotFils: null,
  snapshotKind: null, dueDay: null, minDueFils: null,
  ...overrides,
});
const evidence = (input, confident = true) => local('transfer-evidence').buildTransferEvidence(input, confident);
const json = value => JSON.parse(JSON.stringify(value));

test('outgoing source masks never expose an interior or prefix as last four digits', () => {
  for (const token of ['1234********56', '234-XXX56XXX-78', '123456**', '1111-XX']) {
    const body = `Your funds transfer request to account 9999 from your account ${token} for AED 100.00 has been processed.`;
    assert.equal(parser.extractOutgoingTransferParties(body)?.source, null, token);
    const parsed = parser.parseSms(body, {}, { sender: 'FAB' });
    assert.equal(parsed?.amountFils, 10000);
    assert.equal(parsed?.type, 'expense');
    assert.equal(parsed?.card, null);
  }
});

test('unreadable source digits do not turn failed or pending requests into money', () => {
  for (const ending of ['has failed', 'has been rejected', 'has not been processed',
    'is pending', 'has been submitted', 'will be processed tomorrow']) {
    const body = `Your funds transfer request to account 9999 from your account 1234********56 for AED 100.00 ${ending}.`;
    assert.equal(parser.parseSms(body, {}, { sender: 'FAB' }), null, ending);
  }
  const maskedAmount = 'Your funds transfer request to account 9999 from your account 1234********56 for AED ***100.00 has been processed.';
  assert.equal(parser.parseSms(maskedAmount, {}, { sender: 'FAB' }), null);
});

test('structured evidence keeps original currency and actual source confidence', () => {
  assert.deepEqual(json(evidence(row())), { version: 1, currency: 'AED', attribution: 'source' });
  assert.equal(evidence(row(), false).attribution, 'fallback');
  assert.equal(evidence(row({ card: null })).attribution, 'fallback');
  assert.equal(evidence(row({ card: { last4: '123', kind: 'account' } })).attribution, 'fallback');
  assert.equal(evidence(row({ originalCurrency: 'USD', originalAmountMinor: 2500 })).currency, 'USD');
  assert.equal(evidence(row({ originalCurrency: 'bad currency' })), undefined);
});

test('only structural transfer rows acquire ownership evidence', () => {
  for (const override of [
    { kind: 'cardPayment' }, { cardPaymentSide: 'receipt' }, { paymentFlowSide: 'funding' },
    { merchant: 'Card payment' }, { merchant: 'Cashback' }, { merchant: 'Refund' },
    { merchant: 'SYNTHETIC SHOP' }, { categoryGuess: 'salary' }, { categoryGuess: 'business', merchant: 'Synthetic business payout' },
  ]) assert.equal(evidence(row(override)), undefined, JSON.stringify(override));
  assert.equal(evidence(row({ merchant: 'Own account transfer' })).explicitOwn, true);
  assert.equal(evidence(row({ merchant: 'Incoming transfer', type: 'income', transferHint: false })).explicitOwn, undefined);
  assert.ok(evidence(row({ merchant: 'Incoming transfer', type: 'income', categoryGuess: 'business', transferHint: false })),
    'a company-suffix Business guess must not discard evidence for an unresolved structural transfer');
});

test('references are bounded identifiers, not bodies, dates or account numbers', () => {
  assert.equal(evidence(row({ reference: '  ab-918273  ' })).reference, 'AB-918273');
  for (const reference of ['123', 'PAYMENT', '000000', '20260906', '2026-09-06',
    'AE070331234567890123456', '1234567890123456', 'ACCOUNT 123456789012',
    'private@example.com', 'https://example.test', 'X'.repeat(80), 'AB12****3456']) {
    assert.equal(evidence(row({ reference })).reference, undefined, reference);
  }
});

test('counterparty comes only from the opposite labelled transfer endpoint', () => {
  const raw = 'Funds transferred from your FAB account 1111 to Emirates NBD account 2222. Reference AB-918273.';
  assert.deepEqual(json(evidence(row({ raw })).counterparty), {
    last4: '2222', kind: 'account', bankIdentity: markets.bankIdentityForName('Emirates NBD'),
  });
  const incoming = 'Funds credited from FAB account 1111 to your Emirates NBD account 2222.';
  assert.deepEqual(json(evidence(row({ raw: incoming, type: 'income', merchant: 'Incoming transfer',
    card: { last4: '2222', kind: 'account' }, sender: 'ENBD' })).counterparty), {
    last4: '1111', kind: 'account', bankIdentity: markets.bankIdentityForName('FAB'),
  });
  const anonymous = 'Your funds transfer request to account 2222 from your account 1111 for AED 100.00 has been processed.';
  assert.deepEqual(json(evidence(row({ raw: anonymous })).counterparty), { last4: '2222', kind: 'account' });
  assert.equal(evidence(row({ raw: 'Funds transferred from your account 1111. Download the FAB app for account 2222.' })).counterparty, undefined);
});

test('Saudi issuers and Arabic digits use the same endpoint boundaries', () => {
  markets.setActiveMarket('SA');
  try {
    const result = evidence(row({ currency: 'SAR', sender: 'AlRajhiBank',
      raw: 'Funds transferred from your account ١١١١ to SNB account ٢٢٢٢.' }));
    assert.equal(result.currency, 'SAR');
    assert.equal(result.counterparty?.last4, '2222');
    assert.equal(result.counterparty?.bankIdentity, markets.bankIdentityForName('SNB'));
  } finally { markets.setActiveMarket('AE'); }
});

test('source contradictions and partly masked beneficiaries stay unresolved', () => {
  const sourceMismatch = 'Funds transferred from your FAB account 3333 to Emirates NBD account 2222.';
  assert.equal(evidence(row({ raw: sourceMismatch })).counterparty, undefined);
  assert.equal(evidence(row({ raw: sourceMismatch })).attribution, 'fallback');
  const bankMismatch = 'Funds transferred from your Emirates NBD account 1111 to ADCB account 2222.';
  assert.equal(evidence(row({ raw: bankMismatch })).attribution, 'fallback');
  assert.equal(evidence(row({ raw: bankMismatch })).counterparty, undefined);
  for (const endpoint of ['1234********56', '234-XXX56XXX-78', '123456**']) {
    const raw = `Funds transferred from your FAB account 1111 to Emirates NBD account ${endpoint}.`;
    assert.equal(evidence(row({ raw })).counterparty, undefined, endpoint);
  }
  const full = evidence(row({ raw: 'Funds transferred from your FAB account 123456781111 to Emirates NBD account 987654322222.' }));
  assert.equal(full.counterparty.last4, '2222');
  assert.equal(JSON.stringify(full).includes('987654322222'), false);
  assert.equal(JSON.stringify(full).includes('123456781111'), false);
});

test('body-free native evidence survives validation while routing confidence is recomputed', () => {
  const captured = evidence(row({ raw: 'Funds transferred from your FAB account 1111 to Emirates NBD account 2222.' }));
  assert.deepEqual(json(evidence(row({ transferEvidence: captured }))), {
    ...json(captured), attribution: 'source',
  });
  assert.equal(evidence(row({ transferEvidence: { ...captured, currency: 'SAR' } })).counterparty, undefined);
  assert.equal(evidence(row({ transferEvidence: { ...captured, counterparty: { last4: '12345678', kind: 'account' } } })).counterparty, undefined);
  assert.equal(evidence(row({ transferEvidence: { ...captured, counterparty: { last4: '2222', kind: 'account', bankIdentity: 'SECRET NAME' } } })).counterparty?.bankIdentity, undefined);
  assert.equal(evidence(row({ transferEvidence: captured }), false).attribution, 'fallback');
  assert.equal(evidence(row({ transferEvidence: { ...captured, attribution: 'fallback' } })).attribution, 'fallback');
});

test('new import and reread backfill evidence once without editing the ledger identity', () => {
  const { buildImportPlan } = local('import-plan');
  const smsTs = Date.parse('2026-09-06T10:00:00Z');
  const parsed = row({ raw: 'Funds transferred from your FAB account 1111 to Emirates NBD account 2222.', smsTs,
    sourceEventId: 'a991', channel: 'inbox' });
  const account = { id: 'source-account', kind: 'bank', bankName: 'FAB', last4: '1111', name: 'Bank', openingFils: 0, color: '#111111' };
  const base = { hydrated: true, accounts: [account], transactions: [], accountHints: {},
    budgets: [], bills: [], goals: [], cardDues: [], merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 };
  const fresh = buildImportPlan([parsed], base, smsTs, new Date('2026-09-08'));
  assert.equal(fresh.batch.transactions.length, 1);
  assert.equal(fresh.batch.transactions[0].transferEvidence?.counterparty.last4, '2222');
  const { transferEvidence: _missing, ...saved } = fresh.batch.transactions[0];
  const existing = { ...saved, id: 'existing-row', transferDecision: { version: 1, ownership: 'external', decidedAt: smsTs } };
  const reread = buildImportPlan([parsed], { ...base, transactions: [existing] }, smsTs, new Date('2026-09-08'));
  assert.equal(reread.batch.transactions.length, 0);
  assert.equal(reread.batch.updates.length, 1);
  assert.equal(reread.batch.updates[0].id, 'existing-row');
  assert.equal(reread.batch.updates[0].transferEvidence?.counterparty.last4, '2222');
  assert.equal(Object.hasOwn(reread.batch.updates[0], 'transferDecision'), false);
  const healed = { ...existing, ...reread.batch.updates[0] };
  const again = buildImportPlan([parsed], { ...base, transactions: [healed] }, smsTs, new Date('2026-09-08'));
  assert.equal(again.batch.updates.length, 0);
  const edited = buildImportPlan([parsed], { ...base, transactions: [{ ...existing, userEdited: true }] }, smsTs, new Date('2026-09-08'));
  assert.equal(edited.batch.updates.length, 0);
});

test('full SMS and retained-history promotion carry evidence onto the same notification row', () => {
  const { buildImportPlan } = local('import-plan');
  const smsTs = Date.parse('2026-09-06T10:00:00Z');
  const account = { id: 'source-account', kind: 'bank', bankName: 'FAB', last4: '1111', name: 'Bank', openingFils: 0, color: '#111111' };
  for (const sourceEventId of [undefined, 'a993']) {
    const notification = { id: 'push-row', type: 'expense', amountFils: 10000,
      category: 'other', title: 'Outgoing transfer', accountId: account.id,
      date: '2026-09-06', ts: smsTs - 1000, smsKey: `s${smsTs - 1000}-10000`,
      source: 'sms', viaPush: true, isTransfer: true,
      captureInstrument: { last4: '1111', kind: 'account', bankIdentity: 'fab' } };
    const state = { hydrated: true, accounts: [account], transactions: [notification], accountHints: {},
      budgets: [], bills: [], goals: [], cardDues: [], merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 };
    const parsed = row({ raw: 'Funds transferred from your FAB account 1111 to Emirates NBD account 2222.',
      smsTs, sourceEventId, channel: 'inbox' });
    const plan = buildImportPlan([parsed], state, smsTs, new Date('2026-09-08'));
    assert.equal(plan.batch.transactions.length, 0);
    assert.equal(plan.batch.updates.length, 1);
    assert.equal(plan.batch.updates[0].id, notification.id);
    assert.equal(plan.batch.updates[0].transferEvidence?.counterparty.last4, '2222');
  }
});

test('a reread that learns a named purchase removes obsolete transfer evidence', () => {
  const { buildImportPlan } = local('import-plan');
  const { applyHealPatch } = local('heal');
  const smsTs = Date.parse('2026-09-06T10:00:00Z');
  const account = { id: 'source-account', kind: 'bank', bankName: 'FAB', last4: '1111', name: 'Bank', openingFils: 0, color: '#111111' };
  const prior = { id: 'relearned-row', type: 'expense', amountFils: 10000,
    category: 'other', title: 'Outgoing transfer', accountId: account.id,
    date: '2026-09-06', ts: smsTs, smsKey: `s${smsTs}-10000`, source: 'sms', isTransfer: true,
    captureInstrument: { last4: '1111', kind: 'account', bankIdentity: 'fab' }, transferEvidence: evidence(row()) };
  const state = { hydrated: true, accounts: [account], transactions: [prior], accountHints: {},
    budgets: [], bills: [], goals: [], cardDues: [], merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 };
  const parsed = row({ merchant: 'SYNTHETIC SHOP', categoryGuess: 'shopping', categoryDeliberate: true,
    transferHint: false, smsTs, channel: 'inbox' });
  const plan = buildImportPlan([parsed], state, smsTs, new Date('2026-09-08'));
  assert.equal(plan.batch.transactions.length, 0);
  assert.equal(plan.batch.updates[0]?.clearTransferEvidence, true);
  assert.equal(applyHealPatch(prior, plan.batch.updates[0]).transferEvidence, undefined);
});

test('native history drops raw body and sender while keeping bounded transfer evidence', () => {
  cache.set('auto-import', { shouldReviewParsedIncome: () => false });
  const { parseLocalMessageRecord } = local('local-message-record');
  const text = 'Funds transferred from your FAB account 1111 to Emirates NBD account 2222.';
  const outcome = parseLocalMessageRecord(JSON.stringify({ v: 1,
    id: '55555555-5555-4555-8555-555555555555', text, sender: 'FAB', source: 'message',
    observedAt: '2026-09-06T10:00:00.000Z' }), new Date('2026-09-08'), 'AE', {
    inspect: () => null, parse: () => row({ raw: text }),
  });
  assert.equal(outcome.kind, 'parsed');
  assert.equal(outcome.row.transferEvidence?.counterparty.last4, '2222');
  assert.equal(Object.hasOwn(outcome.row, 'raw'), false);
  assert.equal(Object.hasOwn(outcome.row, 'sender'), false);
  assert.equal(JSON.stringify(outcome).includes(text), false);
});
