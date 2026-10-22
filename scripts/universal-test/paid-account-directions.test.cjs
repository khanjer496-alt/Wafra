'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const load = require('./load-ts.cjs').createLoader();
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { buildImportPlan } = load('@/lib/import-plan');
const { materializeImportBatch, applyMaterializedImportBatch } = load('@/lib/ledger-import');
const { setActiveCountry } = load('@/lib/country');
const { setActiveMarket, setLedgerCurrency } = load('@/lib/markets');

// Entirely synthetic grammar regression fixtures, including the four existing
// launch-corpus failures. No real bank delivery or settlement is asserted.
const observedAt = Date.parse('2026-10-12T12:00:00Z');
const fixtures = [
  { id: 'barclays', currency: 'GBP', country: 'GB', sender: 'Barclays', minor: 231560, type: 'income',
    body: 'Barclays: £2,315.60 has been paid into your account ending 4821 from NORTHWIND TRADING LTD on 25/09/26. Ref: SALARY SEP' },
  { id: 'halifax', currency: 'GBP', country: 'GB', sender: 'Halifax', minor: 185000, type: 'income',
    body: 'Halifax: £1,850.00 has been paid into your Reward Current Account ending 4321 from ACME PAYROLL SERVICES on 30/09/26.' },
  { id: 'td', currency: 'CAD', country: 'CA', sender: '83373', minor: 8000, type: 'expense',
    body: 'TD Alert: Your INTERAC e-Transfer of $80.00 to PAUL MARTIN was deposited on Sep 28.' },
];
function session(row) {
  setActiveMarket('ZZ'); setActiveCountry(row.country); setLedgerCurrency(row.currency, 2);
  return createLaunchAlertSession({ overrides: {}, pinnedCurrency: row.currency, activeMarket: 'ZZ',
    bestEffort: { enabled: true, country: row.country }, fxLookup: () => null });
}
function android(row, reader = session(row)) {
  return reader.parseUnproven(row.body, row.sender, reader.inspect(row.body, row.sender), observedAt);
}
function history(row, reader = session(row)) {
  return parseHistoricalMessageRecords([JSON.stringify({ v: 1,
    id: createHash('sha256').update(row.id + row.body).digest('hex'), text: row.body,
    receivedAt: new Date(observedAt).toISOString() })], {}, new Date(observedAt), new Set(), reader);
}
function initial(row) {
  return { hydrated: true, privateMode: true, ledgerMoney: { schemaVersion: 2, currency: row.currency, exponent: 2 },
    accounts: [], transactions: [], cardDues: [], budgets: [], bills: [], goals: [], accountHints: {},
    merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 0 };
}
function ledger(row, records) {
  const state = initial(row);
  const plan = buildImportPlan(records, state, observedAt, new Date(observedAt));
  let index = 0;
  return applyMaterializedImportBatch(state,
    materializeImportBatch(plan.batch, state, prefix => `${prefix}-${index++}`));
}

for (const row of fixtures) test(`${row.id}: actual Android seam and History retain the owned money direction through the planner`, () => {
  const parsed = android(row);
  assert.ok(parsed, 'completed owned movement is eligible for marked best effort');
  assert.equal(parsed.kind, 'transaction');
  assert.equal(parsed.type, row.type);
  assert.equal(parsed.amountFils, row.minor);
  assert.equal(parsed.currency, row.currency);
  assert.ok(parsed.bestEffort);
  const imported = history(row);
  assert.equal(imported.invalidCount, 0);
  assert.equal(imported.parsed.length, 1);
  assert.equal(imported.parsed[0].type, row.type);
  for (const records of [[{ ...parsed, smsTs: observedAt, channel: 'inbox' }], imported.parsed]) {
    const next = ledger(row, records);
    assert.equal(next.transactions.length, 1);
    assert.equal(next.transactions[0].type, row.type);
    assert.equal(next.transactions[0].amountFils, row.minor);
    assert.equal(next.cardDues.length, 0);
  }
});

const fnb = { id: 'fnb', currency: 'ZAR', country: 'ZA', sender: 'FNB',
  body: 'FNB :-) R28,450.00 paid to Cheq a/c..123456 @ Eft. Ref.ACME PTY LTD SALARY. 25Sep 05:47' };
test('an unowned paid-to bank-account destination is Review on both paths, without inventing incoming ownership', () => {
  const event = inspectUniversalBankEvent(fnb.body, { currencyAliases: { R: ['ZAR'] }, sender: fnb.sender });
  assert.equal(event.direction, 'unknown');
  assert.equal(event.decision, 'review');
  assert.equal(android(fnb), null);
  const imported = history(fnb);
  assert.deepEqual(imported.parsed, []);
  assert.equal(imported.reviewCandidates.length, 1);
  assert.deepEqual(ledger(fnb, imported.parsed).transactions, []);
});

for (const [label, body, country = 'ZA'] of [
  ['reference instead of principal', 'FNB: Ref R28450.00 paid to Cheq a/c..123456.'],
  ['personal chat', 'I paid R25.00 to Cheq a/c..123456 from me. Did you get it?'],
  ['nonfinancial price', 'Account maths lesson R25.00. Example a/c..123456 paid balance.'],
  ['OTP challenge', 'FNB: OTP 654321 to approve R25.00 paid to Cheq a/c..123456.'],
  ['other country rand', fnb.body, 'GB'],
]) test(`native account Review admission rejects ${label}`, () => {
  const row = { ...fnb, id: label, body, country };
  assert.equal(android(row), null);
  const imported = history(row);
  assert.deepEqual(imported.parsed, []);
  assert.equal(imported.reviewCandidates.length, 0);
});

for (const [label, body, type] of [
  ['explicit debit', 'Barclays: GBP 25.00 was debited from your account ending 4821 at CEDAR STORE on 2026-10-10.', 'expense'],
  ['card purchase paid at', 'Barclays: You paid GBP 25.00 at CEDAR STORE using your debit card ending 4821 on 2026-10-10.', 'expense'],
  ['incoming Interac', 'TD Alert: An INTERAC e-Transfer of CAD 80.00 from PAUL MARTIN was deposited into your account on 2026-10-10.', 'income'],
  ['trailing security advice', 'Barclays: GBP 25.00 has been paid into your account ending 4821 from ACME on 2026-10-10. If you do not recognize it, contact your bank.', 'income'],
  ['separate leading security advice', 'Barclays: If you notice fraud, contact your bank. GBP 25.00 has been paid into your account ending 4821 from ACME on 2026-10-10.', 'income'],
]) test(`${label} remains the correct direction beside the new ownership grammar`, () => {
  const row = { ...fixtures[label === 'incoming Interac' ? 2 : 0], id: label, body };
  const parsed = android(row);
  assert.ok(parsed);
  assert.equal(parsed.type, type);
  const imported = history(row);
  if (imported.parsed.length) assert.equal(imported.parsed[0].type, type);
  else {
    assert.equal(imported.reviewCandidates.length, 1, 'senderless income without an own account tail stays Review');
    const review = imported.reviewCandidates[0];
    assert.equal(review.kind === 'universal' ? review.event.direction : review.direction, 'credit');
  }
});

test('an earlier paid-in sentence cannot give a separate principal an incoming direction', () => {
  const row = { ...fixtures[0], id: 'unrelated earlier paid in',
    body: 'Barclays: Your salary has been paid into your account. Your transfer of GBP 25.00 to PAUL MARTIN was paid on 2026-10-10.' };
  const event = inspectUniversalBankEvent(row.body);
  assert.notEqual(event.direction, 'credit');
  const parsed = android(row);
  if (parsed) assert.equal(parsed.type, 'expense');
  const imported = history(row);
  for (const record of imported.parsed) assert.equal(record.type, 'expense');
  for (const transaction of ledger(row, imported.parsed).transactions) assert.equal(transaction.type, 'expense');
});

for (const [label, body] of [
  ['explicit debit conflict', 'Barclays: GBP 25.00 has been paid into your account ending 4821 and debited from your account on 2026-10-10.'],
  ['other incoming conflict', 'TD Alert: Your INTERAC e-Transfer of CAD 80.00 to PAUL MARTIN was deposited and credited into your account on 2026-10-10.'],
  ['future paid in', 'Barclays: GBP 25.00 will be paid into your account ending 4821 from ACME on 2026-10-15.'],
  ['negated paid in', 'Barclays: GBP 25.00 has not been paid into your account ending 4821 from ACME on 2026-10-10.'],
  ['conditional paid in', 'If GBP 25.00 has been paid into your account ending 4821 from ACME, confirm the transfer.'],
  ['questioned paid in', 'Has GBP 25.00 been paid into your account ending 4821 from ACME?'],
  ['lure paid in', 'Barclays: GBP 25.00 has been paid into your account ending 4821. Click this payment link to claim the money https://example.test/claim.'],
  ['future Interac', 'TD Alert: Your INTERAC e-Transfer of CAD 80.00 to PAUL MARTIN will be deposited on 2026-10-15.'],
  ['negated Interac', 'TD Alert: Your INTERAC e-Transfer of CAD 80.00 to PAUL MARTIN has not been deposited on 2026-10-10.'],
  ['conditional Interac', 'If your INTERAC e-Transfer of CAD 80.00 to PAUL MARTIN was deposited, confirm the transfer.'],
  ['embedded conditional paid in', 'Barclays: Please notify us if GBP 25.00 has been paid into your account ending 4821 from ACME on 2026-10-10.'],
  ['embedded conditional Interac', 'TD Alert: Please check whether your INTERAC e-Transfer of CAD 80.00 to PAUL MARTIN was deposited on 2026-10-10.'],
  ['example paid in', 'Barclays: For example, GBP 25.00 has been paid into your account ending 4821 from ACME on 2026-10-10.'],
  ['example Interac', 'TD Alert: For example, your INTERAC e-Transfer of CAD 80.00 to PAUL MARTIN was deposited on 2026-10-10.'],
  ['borrowed paid in', 'Barclays: GBP 25.00 has been paid into their account ending 4821 on 2026-10-10.'],
  ['card account paid in', 'Barclays: GBP 25.00 has been paid into your credit card account ending 4821 on 2026-10-10.'],
  ['Interac merchant name', 'TD Alert: Your INTERAC e-Transfer of CAD 80.00 to WAS DEPOSITED STORE on 2026-10-10.'],
]) test(`${label} cannot become an accepted movement on either path`, () => {
  const row = { ...fixtures[/Interac|incoming/.test(label) ? 2 : 0], id: label, body };
  assert.equal(android(row), null);
  const imported = history(row);
  assert.deepEqual(imported.parsed, []);
  assert.deepEqual(ledger(row, imported.parsed).transactions, []);
});

for (const sender of ['AD-WLTBNK', '56161', 'com.walletbank.android', '']) test(`a masked payee cannot hide the own funding account for ${sender || 'senderless History'}`, () => {
  const row = { id: 'own-funding-' + sender, currency: 'INR', country: 'IN', sender,
    body: 'Rs.640.00 paid to KIRAN STORES from your a/c XX4410 on 05/10/2026. History: https://m.walletbank.example/h' };
  const parsed = android(row);
  assert.ok(parsed);
  assert.equal(parsed.type, 'expense');
  assert.equal(parsed.amountFils, 64000);
  const imported = history(row);
  assert.equal(imported.parsed.length, 1);
  assert.equal(imported.parsed[0].type, 'expense');
  assert.equal(ledger(row, imported.parsed).transactions[0].amountFils, 64000);
});
