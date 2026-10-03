'use strict';
// Design language E for Bills and Accounts: the pure layout figures behind
// the Bills band (total, count, estimates, timeline pins), the Accounts band
// chips, the card block's usage status and the goal ring — and the copy they
// speak. Synthetic data only.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const format = require('../build/format');
const limitStatus = load(path.join(root, 'src/lib/limit-status.ts'));
const band = load(path.join(root, 'src/lib/money-places-band.ts'), { '@/lib/format': format, '@/lib/limit-status': limitStatus });
const { moneyPlacesCopy } = load(path.join(root, 'src/lib/money-places-copy.ts'));

const item = (id, dateISO, amountFils, extra = {}) => ({
  id, title: id, category: 'utilities', kind: 'bill', dateISO, daysLeft: 0, amountFils, estimated: false, paid: false, ...extra,
});

test('the Bills band totals only what is still open, and counts estimates among it', () => {
  const summary = band.openAgendaSummary([
    item('dewa', '2026-09-16', 42_000, { estimated: true }),
    item('rent', '2026-09-20', 650_000),
    item('netflix', '2026-09-01', 3_900, { paid: true, estimated: true }),
  ]);
  assert.deepEqual({ ...summary }, { totalFils: 692_000, count: 2, estimated: 1 });
  assert.deepEqual({ ...band.openAgendaSummary([]) }, { totalFils: 0, count: 0, estimated: 0 });
});

test('timeline pins cover today to the end of the window, by their own dates, and never a paid or late one', () => {
  const pins = band.billsTimelinePins([
    item('late', '2026-09-14', 100),
    item('today', '2026-09-15', 200),
    item('b-same-day', '2026-09-20', 300),
    item('a-same-day', '2026-09-20', 400, { estimated: true }),
    item('paid', '2026-09-18', 500, { paid: true }),
    item('edge', '2026-10-15', 600),
    item('beyond', '2026-10-16', 700),
  ], '2026-09-15', 30);
  assert.deepEqual(JSON.parse(JSON.stringify(pins.map((pin) => [pin.key, pin.dayOffset]))),
    [['today', 0], ['a-same-day', 5], ['b-same-day', 5], ['edge', 30]]);
  assert.equal(pins[1].estimated, true, 'an estimate stays marked so it is spoken as one');
  assert.equal(pins[1].amountFils, 400, 'the pin carries the row amount unchanged');
});

test('the Accounts band counts balance accounts and the credit cards shown apart, never archived ones', () => {
  assert.deepEqual({ ...band.accountsBandCounts([
    { cardType: undefined }, { cardType: 'debit' }, { cardType: 'credit' }, { cardType: 'credit', archived: true }, { archived: true },
  ]) }, { accounts: 2, creditCards: 1 });
});

test('the card usage bar is coloured by status only: within, near from 85%, over past the limit', () => {
  assert.equal(band.cardUsageStatus({ usedFils: 50_000, limitFils: 100_000 }), 'ok');
  assert.equal(band.cardUsageStatus({ usedFils: 85_000, limitFils: 100_000 }), 'near');
  assert.equal(band.cardUsageStatus({ usedFils: 100_001, limitFils: 100_000 }), 'over');
});

test('the goal ring never runs past a full turn or below empty', () => {
  const half = band.goalRingGeometry(190, 20, 0.5);
  assert.equal(half.radius, 85);
  assert.ok(Math.abs(half.dashOffset - half.circumference / 2) < 1e-9);
  assert.equal(band.goalRingGeometry(190, 20, 1.7).dashOffset, 0);
  const none = band.goalRingGeometry(190, 20, -0.2);
  assert.equal(none.drawn, false);
  assert.equal(none.dashOffset, none.circumference);
  assert.equal(band.goalRingGeometry(190, 20, Number.NaN).drawn, false);
});

test('the band copy is in both languages with correct Arabic counts', () => {
  const en = moneyPlacesCopy.en;
  const ar = moneyPlacesCopy.ar;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort());
  assert.equal(en.paymentsCount(1), '1 payment');
  assert.equal(en.paymentsCount(7), '7 payments');
  assert.equal(en.estimatesCount(1), '1 is an estimate');
  assert.equal(en.cardsApart(2), '2 cards, shown on their own');
  assert.equal(ar.paymentsCount(1), 'دفعة واحدة');
  assert.equal(ar.paymentsCount(2), 'دفعتان');
  assert.equal(ar.paymentsCount(3), '3 دفعات');
  assert.equal(ar.paymentsCount(11), '11 دفعة');
  assert.equal(ar.cardsApart(2), 'بطاقتان تظهران منفصلتين');
  assert.equal(ar.cardsCount(12), '12 بطاقة');
  // Recording copy never says Wafra moves money.
  assert.doesNotMatch(en.recordAmount('AED 10'), /pay|send|transfer/i);
});
