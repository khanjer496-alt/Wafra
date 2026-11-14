'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHarness, walk } = require('./reference-harness.cjs');

for (const language of ['en', 'ar']) {
  for (const [currency, minor, figure] of [
    ['AED', 828, '8.28'], ['AED', -30000, '-300'],
    ['KWD', 828, '0.828'], ['KWD', -828, '-0.828'], ['JPY', 828, '828'],
  ]) test(`payment row accessibility keeps ${language}/${currency}/${minor} in the correct order`, () => {
    const h = createHarness({ language, state: {
      ledgerMoney: { schemaVersion: 2, currency, exponent: currency === 'KWD' ? 3 : currency === 'JPY' ? 0 : 2 },
    } });
    const spec = h.deps['@/lib/ledger-money'].ledgerMoneySpec(currency);
    h.deps['@/hooks/use-ledger-money'] = { useLedgerMoney: () => spec, useMoneyLocaleKey: () => '' };
    // Reload the real Money child after supplying the denomination context;
    // the general-purpose harness otherwise deliberately models no provider.
    h.local('@/components/ui/money');
    const { PaymentAgenda } = h.local('@/components/bills/payment-agenda');
    const item = { id: 'synthetic-bill', title: 'Synthetic bill', category: 'utilities', kind: 'bill',
      amountFils: minor, dateISO: '2026-09-09', daysLeft: 1, estimated: false, paid: false };
    const before = JSON.stringify(item);
    const tree = PaymentAgenda({ items: [item], includePaid: false, onOpen() {} });
    const row = walk(tree).find(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Synthetic bill.'));
    assert.ok(row, 'Exercise the actual parent Pressable read by a screen reader');
    const expected = language === 'ar' ? `\u2066${figure}\u00a0${currency}\u2069` : `${currency} ${figure}`;
    assert.ok(row.props.accessibilityLabel.endsWith(expected), JSON.stringify({ actual: row.props.accessibilityLabel, expected }));
    if (language === 'ar' && minor > 0) {
      assert.ok(walk(row).some(n => n.props?.accessibilityLabel === expected), 'Positive parent amount matches the actual Money child exactly');
    }
    assert.equal(JSON.stringify(item), before, 'Formatting cannot change ledger minor units');
  });
}
