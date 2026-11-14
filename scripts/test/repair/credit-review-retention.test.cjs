'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { inspectSourceFreeRefusedAlert } = load('@/lib/auto-import');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { planConfirmedUniversalImport } = load('@/lib/universal-import');
const { isMoneyMovementReview } = load('@/lib/alert-review-tray');
const at = Date.parse('2026-11-14T10:00:00Z');
for (const [index, [body, sender, amount]] of [
  ['Your refund request for AED 50.00 is under process.', 'ENBD', '5000'],
  ['Refund of AED 250.00 successfully requested.', 'ENBD', '25000'],
  ['If approved, AED 250.00 has been refunded to your card.', 'ENBD', '25000'],
  ['ADCB: Reversal of AED 40.00 is under process. You will be notified when the amount is refunded.', 'ADCB', '4000'],
  ['نود اعلامك، ان تم استرداد مبلغ AED 250.00 إلى بطاقتك. فِيرجى تجاهل هذه الرسالة.', 'ENBD', '25000'],
].entries()) test(`uncertain credit is retained through capture and history ${index}`, () => {
  load('@/lib/country').setActiveCountry('AE');load('@/lib/markets').setActiveMarket('AE');load('@/lib/markets').setLedgerCurrency('AED', 2);
  const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED', bestEffort: { enabled: true, country: 'AE' } });
  assert.equal(session.parse(body, sender, session.inspect(body, sender), undefined, at), null);
  const decision = inspectSourceFreeRefusedAlert({ source: body, sender, observedAt: at, channel: 'inbox', session });
  assert.equal(decision.kind, 'review');assert.equal(decision.candidate.kind, 'universal');
  const event = decision.candidate.event;
  assert.equal(event.status, 'informational');assert.equal(event.amount.value.minorUnits, amount);
  assert.equal(isMoneyMovementReview({ kind: 'universal', event }), false);
  assert.deepEqual(planConfirmedUniversalImport({ hydrated: true }, event, { confirmed: true, postingStatus: 'posted' }), { outcome: 'refused', reason: 'not-posted' });
  assert.equal(JSON.stringify(decision).includes(body), false, 'retained facts contain no raw SMS body');
  const input = JSON.stringify({ v: 1, id: String(index + 1).repeat(64), text: body, sender, receivedAt: new Date(at).toISOString() });
  const history = parseHistoricalMessageRecords([input], {}, new Date(at), new Set(), session);
  assert.equal(history.parsed.length, 0);assert.equal(history.reviewCandidates.length, 1);
  assert.equal(history.reviewCandidates[0].kind, 'universal');assert.equal(history.reviewCandidates[0].event.status, 'informational');
});
