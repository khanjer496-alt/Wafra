'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const local = load('@/lib/local-message-record');
const { createLaunchAlertSession, hasGenericBankAlertContext } = load('@/lib/launch-alert-parser');
const { originalMoneyOf } = load('@/lib/fx');
const transfers = require('../fixtures/enbd-transfer-capture.js');
const { corpusMessages } = require('../instant-alert-reader.cjs');
const now = new Date('2026-10-14T12:00:00Z');
const id = '12345678-1234-4123-8123-123456789abc';
markets.setActiveMarket('AE');
markets.setLedgerCurrency('AED', 2);
function parse(text, sender = 'Wafra Automation', source = 'message') {
  const record = JSON.stringify({ v: 1, id, text, sender, source, observedAt: now.toISOString() });
  const market = local.preflightLocalMessageRecord(record, now).market;
  return local.parseLocalMessageRecord(record, now, market,
    createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' }));
}
// Invented conversations are negative controls only; they are not bank samples.
const chats = [
  'I spent AED 50.00 at Carrefour today.',
  'I have just spent AED 50.00 at Carrefour today.',
  "I've paid AED 50.00 at Carrefour today.",
  'I’ve just deposited AED 50.00 at Carrefour today.',
  'Hi I spent AED 50.00 at Carrefour today.',
  "Hey Ann, I've just spent AED 50.00 at Carrefour today.",
  'Hello! I already transferred AED 50.00 to your account today.',
  'أنا دفعت AED 50.00 at Carrefour today.',
  'انا حولت AED 50.00 to your account today.',
];
for (const sender of ['+971501234567', 'Wafra Automation', 'EmiratesNBD']) {
  for (const [i, body] of chats.entries()) test(`personal control ${i} is silent for ${sender}`, () => {
    const result = parse(body, sender);
    assert.equal(result.kind, 'ignored');
    assert.equal(result.milestone, 'none');
    assert.ok(!JSON.stringify(result).includes(body), 'discard source instead of retaining a personal Review card');
  });
}
for (const [i, body] of chats.entries()) test(`unattributed notification personal control ${i} is silent`, () => {
  assert.equal(parse(body, local.LOCAL_NOTIFICATION_SENDER, 'notification').kind, 'ignored');
});
for (const currency of ['USD', 'EUR', 'GBP', 'JOD']) {
  for (const source of ['message', 'notification']) {
    for (const enrichment of ['ai', 'private']) test(`${currency} personal ${source} cannot invoke ${enrichment} fallback`, async () => {
      const text = `I spent ${currency} 50.00 at Carrefour today.`;
      const sender = source === 'notification' ? local.LOCAL_NOTIFICATION_SENDER : 'Wafra Automation';
      const record = JSON.stringify({ v: 1, id, text, sender, source, observedAt: now.toISOString() });
      assert.equal(local.preflightLocalMessageRecord(record, now).market, null);
      let reads = 0;
      const reader = { async read() { reads += 1; return null; } };
      const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' });
      const result = enrichment === 'ai'
        ? await local.parseLocalMessageRecordWithAi(record, now, null, session, reader)
        : await local.parseLocalMessageRecordWithPrivateFormat(record, now, null, session, reader);
      assert.equal(result.kind, 'ignored');
      assert.equal(reads, 0, 'the source must never reach an enrichment reader');
    });
  }
}
for (const sender of ['EmiratesNBD', 'Wafra Automation']) {
  for (const [i, fixture] of transfers.entries()) test(`screenshot-derived transfer ${i} retains facts for ${sender}`, () => {
    const result = parse(fixture.body, sender);
    assert.equal(result.kind, 'parsed');
    assert.equal(result.row.type, fixture.type);
    assert.equal(result.row.amountFils, fixture.minor);
    assert.equal(result.row.snapshotFils, fixture.balance);
    assert.equal(result.row.currency, 'AED');
    assert.equal(result.row.raw, undefined);
    assert.equal(result.row.sender, undefined);
    if (i !== 1) assert.equal(result.row.card, null, 'partial account mask cannot invent a last-four');
  });
}
// A phone number is a real sender that names no bank. Android never runs the
// launch grammar for it (sender-only routing), so neither does iPhone capture:
// the same transfer is never auto-posted from it, and no source is retained.
for (const [i, fixture] of transfers.entries()) test(`screenshot-derived transfer ${i} is not auto-posted from a phone number`, () => {
  const result = parse(fixture.body, '+971501234567');
  assert.notEqual(result.kind, 'parsed');
  assert.notEqual(result.kind, 'invalid');
  assert.equal(JSON.stringify(result).includes(fixture.body), false);
});
// Existing real-derived corpus bodies intentionally lack generic context.
// Preserve these successful legacy reads instead of blanket-gating unknown senders.
const compactBankBodies = corpusMessages().filter(text =>
  text.startsWith('Your Cr.Card XXX2518 was used for AED799.18') ||
  text.startsWith('AED300.00 debited from Acc/Cr.Card XXX7720 for Salik') ||
  text.startsWith('Payment of INR 270 (AED 10.96) was done at Craft docs'));
test('compact real-derived regressions remain present in the corpus', () => assert.equal(compactBankBodies.length, 3));
for (const body of compactBankBodies) {
  test(`known body without generic context remains readable: ${body.slice(0, 45)}`, () => {
    assert.equal(hasGenericBankAlertContext(body, 'Wafra Automation'), false);
    assert.equal(parse(body).kind, 'parsed');
  });
}
// Currency substitutions exercise the admission boundary, not new bank grammars.
for (const [currency, amount] of [['USD', '15.25'], ['EUR', '15.25'], ['GBP', '15.25'], ['JOD', '15.250']]) {
  test(`unattributed ${currency} account alert keeps its currency in Review`, () => {
    const result = parse(`${currency} ${amount} has been debited from your account ending 1234 at AMMAN MARKET.`);
    assert.equal(result.kind, 'review');
    assert.equal(result.item.kind, 'universal');
    const field = result.item.event.amount;
    const amounts = field.value ? [field.value] : field.alternatives;
    assert.ok(amounts.length > 0);
    assert.ok(amounts.every(money => money.currency === currency));
    assert.ok(amounts.every(money => money.exponent === (currency === 'JOD' ? 3 : 2)));
  });
}
test('UAE-bank foreign JOD amount retains all three decimals', () => {
  const result = parse('JOD 15.250 has been debited from your account ending 1234 at AMMAN MARKET.', 'EmiratesNBD');
  assert.equal(result.kind, 'parsed');
  assert.equal(result.row.originalMinorUnits, 15250);
  assert.equal(result.row.originalExponent, 3);
  assert.deepEqual(originalMoneyOf(result.row), { currency: 'JOD', minorUnits: 15250, exponent: 3 });
  assert.equal(result.row.originalAmountMinor, 1525, 'intentional compatibility value remains cent-like');
});
test('three-decimal precision probe retains a nonzero third JOD decimal', () => {
  const result = parse('JOD 15.251 has been debited from your account ending 1234 at AMMAN MARKET.', 'EmiratesNBD');
  assert.equal(result.kind, 'parsed');
  assert.deepEqual(originalMoneyOf(result.row), { currency: 'JOD', minorUnits: 15251, exponent: 3 });
  assert.equal(result.row.originalAmountMinor, undefined, 'a rounded legacy original must not replace the true amount');
});
