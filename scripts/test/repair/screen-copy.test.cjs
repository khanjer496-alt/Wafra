const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const loadTs = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const root = path.resolve(__dirname, '../../..');

test('an unknown credit balance keeps its placeholder instead of disappearing', () => {
  const tree = createHarness({ state: {
    transactions: [], cardDues: [],
    accounts: [{ id: 'unknown-credit', kind: 'card', cardType: 'credit', name: 'Unknown card' }],
  } }).render('wallet');
  const row = walk(tree).find(node => node.props?.testID === 'wallet-card-unknown-credit');
  assert.ok(row);
  assert.match(text(row), /—/);
});

test('free capture shows a fixed end date through day zero, day two and expiry without a store trial claim', () => {
  const { freeCaptureCopy } = load('@/lib/free-capture-copy');
  for (const invalid of [0, -1, NaN, Infinity, Number.MAX_VALUE]) {
    assert.equal(freeCaptureCopy(invalid, 'en').endAtMs, null);
  }
  const start = new Date(2026, 10, 9, 12, 30).getTime();
  for (const language of ['en', 'ar']) {
    const first = freeCaptureCopy(start, language, start);
    const second = freeCaptureCopy(start, language, start + 2 * 86400000);
    const expired = freeCaptureCopy(start, language, start + 3 * 86400000);
    assert.equal(first.endAtMs, start + 3 * 86400000);
    assert.equal(first.status, second.status);
    assert.notEqual(first.status, expired.status);
    assert.match(first.status, /12/);
    assert.doesNotMatch(first.status + first.after, /trial|تجريب/iu);
    assert.match(first.after, /Pro|برو/);
  }
});

test('Arabic inline ledger money is one isolated number-then-code run', () => {
  const i18n = load('@/lib/i18n');
  const format = load('@/lib/format');
  i18n.setLanguage('ar');
  assert.equal(format.formatAED(12345), '\u2066123.45\u00a0AED\u2069');
  const uiMoney = load('@/lib/ui-money-text');
  assert.equal(uiMoney.formatMoneyText(-12345, { currency: 'AED', exponent: 2 }), '\u2066-123.45\u00a0AED\u2069');
  i18n.setLanguage('en');
  assert.equal(format.formatAED(12345), 'AED 123.45');
});

for (const language of ['en', 'ar']) test(`${language}: credit-row label and owed amount share one text run`, () => {
  const tree = createHarness({ language }).render('wallet');
  const figure = walk(tree).find(node => node.props?.testID === 'wallet-figure-label-credit');
  assert.ok(figure, 'one labeled figure replaces the detached owed caption');
  assert.match(text(figure), /2,800/);
  assert.match(text(figure), language === 'ar' ? /عليك|مستحق/ : /owed/i);
  assert.equal(figure.props.numberOfLines, 1);
});

test('Arabic hero figures match inline number-then-code order', () => {
  const h = createHarness({ language: 'ar' });
  const { BandFigure } = h.deps['@/components/ui/band/band-figure'];
  const node = BandFigure({ fils: 12345, moneySpec: { currency: 'AED', exponent: 2 }, palette: { onBand: '#fff', onBandSecondary: '#aaa' } });
  assert.equal(text(node).replace(/\s+/g, ''), '123.45AED');
  assert.equal(node.props.accessibilityLabel, '\u2066123.45\u00a0AED\u2069');
});
