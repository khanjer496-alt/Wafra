'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiagnosticExport, serializeDiagnosticExport } = require('../build/diagnostic-export.js');
const { collectDiagnosticBankMessages, isDiagnosticBankSender } = require('../build/diagnostic-messages.js');
const { UNASSIGNED_INCOME_ACCOUNT_ID } = require('../build/ledger.js');
const { setActiveMarket, setLedgerCurrency } = require('../build/markets.js');
const { setMonthStartDay } = require('../build/format.js');
setActiveMarket('AE'); setLedgerCurrency('AED', 2); setMonthStartDay(1);
const epoch = Date.parse('2026-09-08T12:00:00Z');
const build = { version: '1.0.0', build: 'test', platform: 'android', secretKey: 'NEVER_EXPORT' };
const row = (id, extra = {}) => ({ id, title: 'Synthetic merchant', type: 'expense', category: 'dining',
  accountId: 'bank', amountFils: 1234, date: '2026-09-06', source: 'sms', ...extra });
const state = () => ({ hydrated: true, privateMode: false, ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  marketId: 'AE', language: 'en', monthStartDay: 1, parserVersion: 34, lastScanTs: 0, historyImport: null,
  accounts: [{ id: 'bank', name: 'Visible', kind: 'bank', openingFils: 0, token: 'NEVER_EXPORT' },
    { id: 'old', name: 'Archived', kind: 'bank', openingFils: 0, archived: true }],
  transactions: [row('1'), row('2', { accountId: 'old', date: '2024-02-01' }),
    row('3', { accountId: UNASSIGNED_INCOME_ACCOUNT_ID, type: 'income', category: 'business', amountFils: 9900 })],
  budgets: [{ category: 'dining', limitFils: 50000 }], bills: [], cardDues: [], goals: [],
  merchantOverrides: { 'expense:Synthetic merchant': 'dining' }, accountHints: {}, notSubscriptions: [],
  reviewTray: { schemaVersion: 1, pending: [], tombstones: [], templateRules: [], token: 'NEVER_EXPORT' },
  credentials: { password: 'NEVER_EXPORT' }, relayToken: 'NEVER_EXPORT', signingKey: 'NEVER_EXPORT',
});
const options = { includeRetainedMessages: false, logoFor: () => ({ id: null, reason: 'unknown' }) };
test('full recorded financial history includes hidden/unassigned rows but no runtime credentials', async () => {
  const input = state(); const before = JSON.stringify(input);
  const report = await buildDiagnosticExport(input, build, options, epoch);
  const result = JSON.parse(await serializeDiagnosticExport(report));
  assert.equal(result.transactions.length, 3);
  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts[1].archived, true);
  assert.equal(result.transactions[1].diagnostic.countedInTotals, false);
  assert.equal(result.transactions[2].diagnostic.countedInTotals, true);
  assert.ok(result.transactions[2].diagnostic.flags.includes('account-needs-review'));
  assert.deepEqual(result.monthlyTotals.find(item => item.month === '2026-09'),
    { month: '2026-09', incomeMinor: 9900, spendingMinor: 1234, excluded: 0, netMinor: 8666 });
  assert.equal(result.coverage.allRecordedTransactions, true);
  assert.equal(result.delivery.uploadedByWafra, false);
  assert.ok(!JSON.stringify(result).includes('NEVER_EXPORT'));
  assert.equal(JSON.stringify(input), before, 'export never repairs or edits the ledger');
});
test('message text is opt-in and forbidden in Private Mode; security challenges never exported', async () => {
  const input = state(); input.transactions[0].raw = 'AED 12.34 paid at SYNTHETIC PLACE using Debit Card ending 1234.';
  input.transactions[1].raw = 'Your OTP is 984321. Use it to authorize AED 12.34 at SYNTHETIC PLACE.';
  const normal = await buildDiagnosticExport(input, build, options, epoch);
  assert.equal(normal.transactions[0].raw, undefined);
  const opted = await buildDiagnosticExport(input, build, { ...options, includeRetainedMessages: true }, epoch);
  assert.equal(opted.transactions[0].raw, input.transactions[0].raw);
  assert.equal(opted.transactions[1].raw, undefined);
  assert.equal(opted.coverage.securityMessagesOmitted, 1);
  await assert.rejects(buildDiagnosticExport({ ...input, privateMode: true }, build,
    { ...options, includeRetainedMessages: true }, epoch), /private_mode/);
});
test('cancellation stops generation or serialization before a file can be shared', async () => {
  let allowed = true; const input = state();
  input.transactions = Array.from({ length: 400 }, (_, i) => row('test-' + i));
  await assert.rejects(buildDiagnosticExport(input, build, { ...options,
    shouldContinue: () => allowed, onProgress: () => { allowed = false; } }, epoch), /cancelled/);
  await assert.rejects(serializeDiagnosticExport({ transactions: input.transactions }, () => false), /cancelled/);
});
test('optional bank diagnostic read is cursor-complete and excludes personal/security messages', async () => {
  let calls = 0;
  const rows = [
    { id: 3, date: 300, address: 'Liv', body: 'AED 100.00 credited to your account from TALABAT BUSINESS.' },
    { id: 2, date: 200, address: '+971500000000', body: 'AED 400 for dinner, please send to my bank account.' },
    { id: 1, date: 100, address: 'FAB', body: 'Your OTP is 984321 to authorize AED 20.' },
  ];
  const report = await collectDiagnosticBankMessages(async () => { calls++; return rows; }, {
    currency: 'AED', market: 'AE', overrides: {}, shouldContinue: () => true,
  });
  assert.equal(calls, 1);
  assert.equal(report.messages.length, 1);
  assert.equal(report.messages[0].sourceEventId, 'a3');
  assert.equal(report.coverage.nativeFilteredInboxReadComplete, true);
  assert.ok(!JSON.stringify(report).includes('984321'));
  assert.ok(!JSON.stringify(report).includes('+971500000000'));
});
test('malformed/non-advancing pages fail instead of emitting a partial complete export', async () => {
  const opts = { currency: 'AED', market: 'AE', overrides: {}, shouldContinue: () => true };
  await assert.rejects(collectDiagnosticBankMessages(async () => [
    { id: 4, date: 100, address: 'Liv', body: 'AED 20' },
    { id: 4, date: 100, address: 'Liv', body: 'AED 20' },
  ], opts), /invalid_cursor/);
  await assert.rejects(collectDiagnosticBankMessages(async () => { throw Error('permission denied'); }, opts), /permission/);
});
test('bank-export admission never uses a bank-name substring as sender identity', () => {
  for (const sender of ['My Liv adviser', 'ENBD dinner group', 'Fabulous friend', '+971500000000', 'ADCB-other', 'HSBC personal chat', 'Liv\u202e']) {
    assert.equal(isDiagnosticBankSender(sender), false, sender);
  }
  for (const sender of ['Liv', 'FAB', 'ENBD', 'ADCB', 'RAKBANK', 'Emirates NBD', 'AlRajhi']) assert.equal(isDiagnosticBankSender(sender), true, sender);
});
