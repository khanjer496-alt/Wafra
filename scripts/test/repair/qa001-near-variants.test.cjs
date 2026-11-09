'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const fixture = require('../fixtures/qa001-near-variants.json');
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { parseSms } = load('@/lib/sms-parser');
const { createLaunchAlertSession, inspectGenericBankEventForReview } = load('@/lib/launch-alert-parser');
const { inspectSourceFreeRefusedAlert } = load('@/lib/auto-import');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const at = Date.parse('2026-11-05T10:00:00Z');

function reader(market = 'AE') {
  country.setActiveCountry(market);
  markets.setActiveMarket(market);
  markets.setLedgerCurrency(market === 'SA' ? 'SAR' : 'AED', 2);
  return createLaunchAlertSession({ overrides: {}, activeMarket: market,
    pinnedCurrency: market === 'SA' ? 'SAR' : 'AED', bestEffort: { enabled: true, country: market } });
}
function transfer(parsed, row) {
  assert.equal(parsed.kind, 'cardPayment', 'repayments cannot be ordinary spending or income');
  assert.equal(parsed.transferHint, true);
  assert.equal(parsed.amountFils, row.minorUnits);
  assert.equal(parsed.currency, row.currency);
}
function reviewMoney(candidate, row) {
  const money = candidate?.event?.amount.value ?? candidate?.amount;
  assert.deepEqual(JSON.parse(JSON.stringify(money)),
    { currency: row.currency, minorUnits: String(row.minorUnits), exponent: 2 });
}

for (const row of fixture.cases) {
  // Android's notification adapter joins the title and text with one space.
  const source = row.notification ? `${row.notification.title} ${row.notification.text}`.trim() : row.body;
  for (const sender of row.expected === 'hold' ? [...new Set([row.sender, ''])] : [row.sender]) {
    for (const body of [source, source.replace(/ /g, '  ')]) {
      test(`QA001 near-variant ${row.id}/${sender || 'blank'}/${body === source}`, () => {
        const session = reader(row.market), inspection = session.inspect(body, sender);
        const core = parseSms(body, {}, { sender, observedAt: at });
        const captured = session.parse(body, sender, inspection, undefined, at);
        if (row.expected === 'post') {
          for (const parsed of [core, captured]) {
            assert.equal(parsed?.kind, 'transaction');
            assert.equal(parsed.type, row.type);
            assert.equal(parsed.amountFils, row.minorUnits);
            assert.equal(parsed.currency, row.currency);
          }
          return;
        }
        if (core) transfer(core, row);
        if (captured) transfer(captured, row);
        else {
          const refusal = inspectSourceFreeRefusedAlert({ source: body, sender, observedAt: at,
            channel: 'inbox', session, existingInspection: inspection });
          assert.equal(refusal.kind, 'review');
          reviewMoney(refusal.candidate, row);
          assert.equal(refusal.candidate.kind, 'universal');
          assert.equal(refusal.candidate.event.family, 'card-payment');
        }
        const history = parseHistoricalMessageRecords([JSON.stringify({ v: 1, id: '5'.repeat(64), text: body,
          sender, receivedAt: new Date(at).toISOString() })], {}, new Date(at), new Set(), session);
        assert.equal(history.parsed.length + history.reviewCandidates.length, 1);
        assert.equal(history.ignoredCount, 0);
        for (const parsed of history.parsed) transfer(parsed, row);
        for (const review of history.reviewCandidates) reviewMoney(review, row);
      });
    }
  }
}

const positive = 'تم إيداع مبلغ 500.00 درهم في بطاقتك الائتمانية المنتهية بـ 2665';
for (const source of [positive.replace('تم إيداع', 'لم يتم إيداع'),
  positive.replace('تم إيداع', 'تم رفض إيداع'),
  positive.replace('تم إيداع', 'سيتم إيداع') + ' خلال 3 أيام عمل',
  positive.replace('تم إيداع', 'إذا تم إيداع'),
  positive.replace('تم إيداع', 'تم استلام طلب إيداع'),
  positive.replace('تم إيداع', 'تم إيداع طلب'),
  positive.replace('تم إيداع', 'لَم يَتم إِيداع'),
  positive.replace('تم إيداع', '\u200Bلم يتم إيداع'),
  positive.replace('تم إيداع', '\u200Fسيتم إيداع'),
  positive + ' اضغط على الرابط http://bit.ly/abc123']) {
  for (const sender of ['', 'ENBD', 'INFO']) for (const prefix of ['', 'ENBD Alert\n']) {
    test(`QA001 non-event never becomes actionable Review: ${sender || 'blank'}/${prefix}/${source}`, () => {
      const session = reader(), body = prefix + source;
      assert.equal(parseSms(body, {}, { sender, observedAt: at }), null);
      assert.equal(session.parse(body, sender, session.inspect(body, sender), undefined, at), null);
      assert.equal(inspectGenericBankEventForReview(body, sender), null);
      const refusal = inspectSourceFreeRefusedAlert({ source: body, sender, observedAt: at, channel: 'inbox', session });
      assert.notEqual(refusal.kind, 'review');
      const history = parseHistoricalMessageRecords([JSON.stringify({ v: 1, id: '4'.repeat(64), text: body,
        sender, receivedAt: new Date(at).toISOString() })], {}, new Date(at), new Set(), session);
      assert.equal(history.parsed.length, 0);
      assert.equal(history.reviewCandidates.length, 0);
    });
  }
}
for (const source of [positive, positive.replace('500.00', '1,250.50')]) {
  test(`QA001 completed card credit keeps exact typed Review: ${source}`, () => {
    const session = reader();
    const event = inspectGenericBankEventForReview(source, '');
    assert.equal(event?.status, 'posted');
    assert.equal(event.family, 'card-payment');
    const refusal = inspectSourceFreeRefusedAlert({ source, sender: '', observedAt: at, channel: 'inbox', session });
    assert.equal(refusal.kind, 'review');
    reviewMoney(refusal.candidate, { currency: 'AED', minorUnits: source.includes('1,250.50') ? 125050 : 50000 });
  });
}
