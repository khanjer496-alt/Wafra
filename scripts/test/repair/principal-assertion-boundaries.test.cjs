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
  ['selected-pending-before-second-debit', 'AED 42.10 was debited from your card ending 1234 at SHOP. Transaction pending approval. AED 250.00 was debited from your card ending 5678 at NOON.', 'none'],
  ['unrelated-pending-before', `Your transaction pending approval is separate. ${debit}`, 'expense'],
  ['unrelated-pending-before-semicolon', `Your payment pending processing is separate; ${debit}`, 'expense'],
  ['selected-pending-after-limit', 'Your Cr.Card XXX1234 was used for AED42.10 on 12/10/2026 12:00:00 at SAMPLE MARKET, SAMPLE CITY. Avl. Cr.Limit is AED5000.00 Transaction pending approval.', 'none'],
  ['false-fee-comma', `It is false that a fee applied, ${debit}`, 'expense'],
  ['false-service-charge-comma', `It is false that a service charge was applied, ${debit}`, 'expense'],
  ['false-service-charge-assessed', `It is false that a service charge was assessed, ${debit}`, 'expense'],
  ['denied-card-after-subordinate-fee', 'It is false that after a service charge was applied your card ending 1234 was charged, AED 250.00 was debited at NOON.', 'none'],
  ['denied-card-before-subordinate-fee', 'It is false that your card ending 1234 was charged after a service charge was applied, AED 250.00 was debited at NOON.', 'none'],
  ['false-service-charge-note40', `It is false that a service charge was applied, ${debit} Your refund request for AED 40.00 is pending.`, 'expense', '4000'],
  ['false-service-charge-note100', `It is false that a service charge was assessed, ${debit} Your refund, AED 100.00, has been credited to your card.`, 'expense', '10000'],
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
  if (id.startsWith('false-service-charge') || id === 'plain-completed') {
    for (const result of [source, dated, parsed, imported.parsed[0]]) {
      assert.equal(result.merchant, 'Noon', 'selected purchase owns merchant');
      assert.equal(result.categoryGuess, 'shopping', 'denied fee cannot retitle category');
      assert.deepEqual(result.card, { last4: '1234', kind: 'unknown' });
    }
    assert.equal(source.raw, body, 'original evidence survives classification');
    assert.equal(dated.date, sms.parseSms(debit, {}, { sender: 'ENBD', observedAt: at }).date);
    if (!noteAmount) {
      assert.equal(decision.candidate.family, 'purchase');
      assert.equal(decision.candidate.direction, 'debit');
    }
  }
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
    if (id.startsWith('false-service-charge') || id === 'plain-completed') {
      assert.equal(result.notification.merchant, 'Noon');
      assert.equal(result.notification.family, 'purchase');
      assert.deepEqual(result.notification.instrument, { kind: 'card', last4: '1234' });
    }
  }
});

test('a genuine service fee keeps its own classification and instrument', () => {
  const body = 'A service charge of AED 25.00 was debited from your account ending 1234.';
  const session = launch.createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED', bestEffort: { enabled: true, country: 'AE' } });
  const source = sms.parseSms(body, {}, { sender: 'ENBD', observedAt: at });
  const parsed = session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at);
  const record = JSON.stringify({ v: 1, id: crypto.createHash('sha256').update(body).digest('hex'), text: body, sender: 'ENBD', receivedAt: new Date(at).toISOString() });
  const imported = history.parseHistoricalMessageRecords([record], {}, new Date(at), new Set(), session);
  for (const result of [source, parsed, imported.parsed[0]]) {
    assert.equal(result.type, 'expense'); assert.equal(result.amountFils, 2500);
    assert.equal(result.currency, 'AED'); assert.equal(result.merchant, 'Service charge');
    assert.equal(result.categoryGuess, 'other'); assert.deepEqual(result.card, { last4: '1234', kind: 'account' });
  }
  const decision = capture.inspectSourceFreeRefusedAlert({ source: body, sender: 'ENBD', observedAt: at, channel: 'inbox', session, acceptedExpense: parsed });
  assert.equal(decision.candidate.family, 'fee');
  const result = JSON.parse(native.wafraNativeAlertParse(JSON.stringify({ v: 1, context: { v: 1, country: 'AE', parserMarket: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 }, sourceHash: meta.sourceHash }, sender: 'ENBD', body, observedAt: at })));
  assert.equal(result.route, 'parsed'); assert.equal(result.notification.family, 'fee');
  assert.equal(result.notification.merchant, 'Service charge'); assert.equal(result.notification.amount.minorUnits, '2500');
  assert.deepEqual(result.notification.instrument, { kind: 'account', last4: '1234' });
});

// Pending status may stand aside only for affirmative independent money.
test('pending scope keeps offsets and every non-completion / competing-money veto', () => {
  const scope = guards.withoutUnrelatedPendingTransactionStatus;
  const prefix = 'Your transaction pending approval is separate. ';
  for (const tail of [
    'AED 250.00 will be debited from your card ending 1234 at NOON.',
    'AED 250.00 was not debited from your card ending 1234 at NOON.',
    'AED 250.00 is being debited from your card ending 1234 at NOON.',
    'AED 250.00 at NOON.',
    'Your credit limit is AED 5000.00.',
  ]) assert.equal(scope(prefix + tail), prefix + tail, tail);
  for (const body of [
    'AED 40.00 transaction pending approval. ' + debit,
    debit + ' Transaction pending approval.',
    'Your transaction pending approval.',
  ]) assert.equal(scope(body), body, 'earlier or selected pending money never stands aside');
  const body = prefix + debit;
  const scoped = scope(body);
  assert.notEqual(scoped, body);
  assert.equal(scoped.length, body.length);
  assert.equal(scoped.indexOf('AED 250.00'), body.indexOf('AED 250.00'));
  assert.equal(scoped.slice(prefix.length), debit);
});

// A tail belongs to the already selected principal, whose money precedes it.
test('pending reference tail cannot be disowned by a second debit', () => {
  const body = "AED 42.10 was debited from your card ending 1234 at SHOP. Transaction pending approval. AED 250.00 was debited from your card ending 5678 at NOON.";
  const start = body.indexOf('AED 42.10');
  const end = start + 'AED 42.10'.length;
  assert.equal(guards.hasSelectedPendingTransaction(body), true);
  assert.equal(guards.hasIncompletePrincipalReference(body.slice(end)), true);
  assert.equal(guards.isCompletedExpensePrincipal(body, { start, end }), false);
});
