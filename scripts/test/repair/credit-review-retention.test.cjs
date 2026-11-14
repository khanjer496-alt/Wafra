'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { inspectSourceFreeRefusedAlert } = load('@/lib/auto-import');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { planConfirmedUniversalImport } = load('@/lib/universal-import');
const { isMoneyMovementReview } = load('@/lib/alert-review-tray');
const { withoutRecordedReviews } = load('@/lib/review-source-bindings');
const { admitPreparedReviewAlert, emptyAlertReviewTray } = load('@/lib/alert-review-tray');
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

for (const [index, note, expectedAmount] of [
  [0, 'Your charge-back request is scheduled.', null],
  [1, 'Your reversal request for AED 40.00 is pending.', '4000'],
  [2, 'Your refund request is queued.', null],
]) test(`a completed debit and its separate informational reversal survive capture/history ${index}`, () => {
  load('@/lib/country').setActiveCountry('AE'); load('@/lib/markets').setActiveMarket('AE'); load('@/lib/markets').setLedgerCurrency('AED', 2);
  const body = `AED 250.00 was debited from your card ending 1234 at NOON.COM. ${note}`;
  const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED' });
  const parsed = session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at);
  assert.equal(parsed?.type, 'expense'); assert.equal(parsed.amountFils, 25000);
  const decision = inspectSourceFreeRefusedAlert({ source: body, sender: 'ENBD', observedAt: at, channel: 'inbox', session, acceptedExpense: parsed });
  assert.equal(decision.kind, 'review'); assert.equal(decision.candidate.event.direction, 'none');
  assert.equal(decision.candidate.event.status, 'informational');
  assert.equal(decision.candidate.event.amount.value?.minorUnits ?? null, expectedAmount);
  assert.deepEqual(planConfirmedUniversalImport({ hydrated: true }, decision.candidate.event, { confirmed: true, postingStatus: 'posted' }), { outcome: 'refused', reason: 'not-posted' });
  const input = JSON.stringify({ v: 1, id: String(index + 6).repeat(64), text: body, sender: 'ENBD', receivedAt: new Date(at).toISOString() });
  const history = parseHistoricalMessageRecords([input], {}, new Date(at), new Set(), session);
  assert.equal(history.parsed.length, 1); assert.equal(history.parsed[0].type, 'expense'); assert.equal(history.parsed[0].amountFils, 25000);
  assert.equal(history.reviewCandidates.length, 1);
  const item = history.reviewCandidates[0];
  assert.equal(item.event.amount.value?.minorUnits ?? null, expectedAmount);
  assert.equal(isMoneyMovementReview(item), false);
  assert.equal(withoutRecordedReviews([item], [{ smsKey: item.sourceKey, ts: at }]).length, 1);
  const staged = admitPreparedReviewAlert(emptyAlertReviewTray(), item, at);
  assert.equal(staged.outcome, 'admitted'); assert.equal(staged.state.pending.length, 1);
});
