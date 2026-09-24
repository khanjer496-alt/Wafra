'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, walk, text } = require('./reference-harness.cjs');

test('Money exposes exactly the displayed currency, sign and precision as one accessible group', () => {
  const h = createHarness();
  const money = h.deps['@/components/ui/money'].Money;
  for (const [props, expected] of [
    [{ fils: 12345 }, 'AED 123.45'],
    [{ fils: -12345 }, 'AED −123.45'],
    [{ fils: 12345, sign: 'plus' }, 'AED +123.45'],
    [{ fils: 12345, sign: 'minus' }, 'AED −123.45'],
    [{ fils: 12356, decimals: false }, 'AED 124'],
    [{ fils: 0 }, 'AED 0.00'],
    [{ fils: 12345, prefix: false }, '123.45'],
  ]) {
    const node = money(props);
    assert.equal(node.props.accessibilityLabel, expected);
    assert.equal(node.props.accessible, true);
    assert.equal(node.props.accessibilityRole, 'text');
    assert.equal(String(text(node)).replace(/\s+/g, ' ').trim(), expected);
  }
});

test('Money follows the locale currency pattern visually and speaks the ISO code', () => {
  const h = createHarness();
  const ledgerMoney = h.deps['@/lib/ledger-money'];
  const Money = h.deps['@/components/ui/money'].Money;
  const eur = ledgerMoney.ledgerMoneySpec('EUR');
  const usd = ledgerMoney.ledgerMoneySpec('USD');
  const order = (node) => [...node.props.children].filter(Boolean)
    .map((child) => (child.props?.accessibilityLabel ? `currency:${child.props.accessibilityLabel}:${text(child)}` : "amount"));
  try {
    ledgerMoney.setDisplayMoneyLocale({ locale: 'de-DE', decimalSeparator: ',', groupSeparator: '.', region: 'DE' });
    const german = Money({ fils: 123456, moneySpec: eur });
    assert.deepEqual(order(german), ['amount', 'currency:EUR:€'], 'de-DE: 1.234,56 €');
    assert.equal(german.props.accessibilityLabel, 'EUR 1.234,56');
    ledgerMoney.setDisplayMoneyLocale({ locale: 'en-US', decimalSeparator: '.', groupSeparator: ',', region: 'US' });
    const american = Money({ fils: 123456, moneySpec: usd });
    assert.deepEqual(order(american), ['currency:USD:$', 'amount'], 'en-US: $1,234.56');
    assert.equal(american.props.accessibilityLabel, 'USD 1,234.56');
    const aed = Money({ fils: 123456, moneySpec: ledgerMoney.ledgerMoneySpec('AED') });
    assert.deepEqual(order(aed), ['currency:AED:AED', 'amount'], 'AED keeps its code first');
  } finally {
    ledgerMoney.setDisplayMoneyLocale(null);
  }
});

test('Arabic Money uses the same localized digits in its visible and accessible value', () => {
  const h = createHarness({ language: 'ar' });
  const node = h.deps['@/components/ui/money'].Money({ fils: 12345 });
  assert.equal(node.props.accessibilityLabel, h.format.formatAED(12345));
  assert.equal(String(text(node)).replace(/\s+/g, ' ').trim(), node.props.accessibilityLabel);
});

test('Spending trend month selection is exposed to web as well as native accessibility', () => {
  const h = createHarness({ params: { view: 'trends' } });
  const months = walk(h.render('flow')).filter((node) =>
    node.props?.accessibilityRole === 'button' &&
    /Income:.*Spending:|No recorded activity/.test(node.props?.accessibilityLabel ?? ''));
  assert.equal(months.length, 6);
  assert.equal(months.filter((node) => node.props['aria-selected'] === true).length, 1);
  for (const node of months) {
    assert.equal(node.props['aria-selected'], node.props.accessibilityState.selected);
  }
});
