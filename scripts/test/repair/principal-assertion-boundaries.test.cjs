'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const sms = load('@/lib/sms-parser');
const launch = load('@/lib/launch-alert-parser');
const guards = load('@/lib/principal-posting-guards');
const capture = load('@/lib/auto-import');
const history = load('@/lib/historical-import');
const tray = load('@/lib/alert-review-tray');
const imports = load('@/lib/universal-import');
const root = path.resolve(__dirname, '../../..');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'), 'utf8'));
const native = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js'), 'utf8'), native);
const at = Date.parse('2026-11-14T10:00:00Z');
const debit = 'AED 250.00 was debited from your card ending 1234 at NOON.';
const cases = [
  ['false-fee-comma', `It is false that a fee applied, ${debit}`, 'expense'],
  ['false-service-charge-comma', `It is false that a service charge was applied, ${debit}`, 'expense'],
  ['false-service-charge-assessed', `It is false that a service charge was assessed, ${debit}`, 'expense'],
  ['open-service-charge-apposition', `It is false that a service charge, ${debit}`, 'none'],
  ['denied-generic-charge-apposition', `It is false that the charge, ${debit}`, 'none'],
  ['denied-generic-charge-applied', `It is false that the charge was applied, ${debit}`, 'none'],
  ['false-store-comma', `It is false that the store was closed, ${debit}`, 'expense'],
  ['issuer-false-fee', `ENBD: It is false that a fee applied, ${debit}`, 'expense'],
  ['greeting-false-store', `Dear Customer, it is false that the store was closed, ${debit}`, 'expense'],
  ['untrue-fee', `It was untrue that a fee applied, ${debit}`, 'expense'],
  ['not-true-store', `It is not true that the store was closed, ${debit}`, 'expense'],
  ['new-card-subject', 'It is false that the store was closed, your card ending 1234 was charged AED 250.00 at NOON.', 'expense'],
  ['fee-new-card-subject', 'It is false that a fee applied, your card ending 1234 was charged AED 250.00 at NOON.', 'expense'],
  ['new-nominal-subject', 'It is false that the store was closed, Purchase of AED 250.00 was made on your card ending 1234 at NOON.', 'expense'],
  ['fee-semicolon', `It is false that a fee applied; ${debit}`, 'expense'],
  ['fee-but', `It is false that a fee applied, but ${debit}`, 'expense'],
  ['store-but', `It is false that the store was closed, but ${debit}`, 'expense'],
  ['fee-period', `It is false that a fee applied. ${debit}`, 'expense'],
  ['store-period', `It is false that the store was closed. ${debit}`, 'expense'],
  ['plain-completed', debit, 'expense'],
  ['new-debit-with-own-note', `It is false that a fee applied, ${debit} Your refund request for AED 40.00 is pending.`, 'expense', '4000'],
  ['new-debit-not-completed', 'It is false that the store was closed, AED 250.00 has not been debited from your card ending 1234 at NOON.', 'none'],
  ['new-nominal-pending', 'It is false that the store was closed, Purchase of AED 250.00 is pending on your card ending 1234 at NOON.', 'none'],
  ['denied-amount-first', 'It is false that AED 250.00 was debited from your card ending 1234 at NOON.', 'none'],
  ['denied-instrument-comma', 'ENBD: It is false that your card ending 1234, was charged AED 250.00 at NOON. Your refund request for AED 40.00 is pending.', 'none'],
  ['denied-instrument-fx', 'It is false that your card ending 1234 (USD 68.00) was charged AED 250.00 at NOON. Your refund request for AED 40.00 is pending.', 'none'],
  ['denied-instrument-fx-comma', 'It is false that your card ending 1234 (USD 68.00), was charged AED 250.00 at NOON. Your refund request for AED 40.00 is pending.', 'none'],
  ['denied-instrument-relative-clause', 'It is false that your card ending 1234, which is active, was charged AED 250.00 at NOON.', 'none'],
  ['denied-instrument-amount-apposition', 'It is false that your card ending 1234, AED 250.00 was debited at NOON.', 'none'],
  ['denied-completed-instrument-apposition', 'It is false that your card ending 1234 was charged, AED 250.00 was debited at NOON.', 'none'],
  ['denied-charged-comma-amount', 'It is false that your card ending 1234 was charged, AED 250.00 at NOON.', 'none'],
  ['denied-charged-for', 'It is false that your card ending 1234 was charged, for AED 250.00 at NOON.', 'none'],
  ['denied-date-comma', 'It is false that your card ending 1234 was charged, on 14/11/2026, AED 250.00 at NOON.', 'none'],
  ['denied-purchase-of', 'It is false that a purchase, of AED 250.00, was made using your card ending 1234 at NOON.', 'none'],
  ['denied-relative-amount-apposition', 'It is false that your card ending 1234, which is active, AED 250.00 was debited at NOON.', 'none'],
  ['denied-issuer-original', 'ENBD: It is false that your card ending 1234 was charged AED 250.00 at NOON. Your refund request for AED 40.00 is pending.', 'none'],
  ['comma-own-note100', 'AED 250.00 was debited from your card ending 1234 at NOON, your refund, AED 100.00, has been credited to your card.', 'expense', '10000'],
  ['comma-own-note40', 'AED 250.00 was debited from your card ending 1234 at NOON.COM, your refund request, AED 40.00, is pending.', 'expense', '4000'],
];

for (const [id, body, expected, noteAmount] of cases) test(`${id}: source and History keep selected assertion ownership`, () => {
  load('@/lib/country').setActiveCountry('AE');
  load('@/lib/markets').setActiveMarket('AE');
  load('@/lib/markets').setLedgerCurrency('AED', 2);
  const session = launch.createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED', bestEffort: { enabled: true, country: 'AE' } });
  const source = sms.parseSms(body, {}, { sender: 'ENBD' });
  const dated = sms.parseSms(body, {}, { sender: 'ENBD', observedAt: at });
  const parsed = session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at);
  const decision = capture.inspectSourceFreeRefusedAlert({ source: body, sender: 'ENBD', observedAt: at, channel: 'inbox', session, acceptedExpense: parsed?.type === 'expense' ? parsed : undefined });
  const record = JSON.stringify({ v: 1, id: crypto.createHash('sha256').update(id).digest('hex'), text: body, sender: 'ENBD', receivedAt: new Date(at).toISOString() });
  const imported = history.parseHistoricalMessageRecords([record], {}, new Date(at), new Set(), session);
  if (expected === 'none') {
    assert.equal(source, null, 'source refuses incomplete or denied movement');
    assert.equal(dated, null, 'dated source refuses incomplete or denied movement');
    assert.equal(parsed, null, 'session refuses incomplete or denied movement');
    assert.equal(imported.parsed.length, 0, 'History cannot post denied money');
    assert.ok(!imported.reviewCandidates.some(tray.isMoneyMovementReview), 'History cannot acquire confirmation authority');
    return;
  }
  for (const result of [source, dated, parsed]) {
    assert.equal(result?.type, 'expense', 'completed debit survives unrelated negation');
    assert.equal(result.amountFils, 25000);
    assert.equal(result.currency, 'AED');
  }
  const start = body.indexOf('AED 250.00');
  assert.equal(guards.isCompletedExpensePrincipal(body, { start, end: start + 'AED 250.00'.length }), true);
  assert.equal(imported.parsed.length, 1, 'History retains the completed debit');
  assert.equal(imported.parsed[0].type, 'expense');
  assert.equal(imported.parsed[0].amountFils, 25000);
  if (noteAmount) {
    assert.equal(decision.kind, 'review');
    assert.equal(imported.reviewCandidates.length, 1);
    for (const event of [decision.candidate.event, imported.reviewCandidates[0].event]) {
      assert.equal(event.status, 'informational');
      assert.equal(event.direction, 'none');
      assert.equal(event.amount.value.minorUnits, noteAmount, 'note keeps only its own money');
      assert.equal(tray.isMoneyMovementReview({ kind: 'universal', event }), false);
      assert.deepEqual(imports.planConfirmedUniversalImport({ hydrated: true }, { ...event, status: 'posted' }, { confirmed: true, postingStatus: 'posted' }), { outcome: 'refused', reason: 'not-posted' });
    }
  }
});

for (const [id, body, expected] of cases) test(`${id}: committed native bundle keeps selected assertion ownership`, () => {
  const result = JSON.parse(native.wafraNativeAlertParse(JSON.stringify({ v: 1, context: { v: 1, country: 'AE', parserMarket: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 }, sourceHash: meta.sourceHash }, sender: 'ENBD', body, observedAt: at })));
  assert.equal(result.route, expected === 'none' ? 'ignore' : 'parsed');
  if (expected === 'expense') {
    assert.equal(result.notification.direction, 'debit');
    assert.equal(result.notification.amount.currency, 'AED');
    assert.equal(result.notification.amount.minorUnits, '25000');
  }
});
