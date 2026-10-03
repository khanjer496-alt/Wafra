'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
for (const language of ['en', 'ar']) for (const largeText of [false, true]) {
  test(`merchant, bill and assistant month rows keep exact visible amounts (${language}, large=${largeText})`, () => {
    const h = createHarness({ language, largeText, width: 320, theme: 'dark' });
    const palette = h.deps['@/constants/theme'].bandPalette('spending', 'dark');
    const months = [{ key: '2026-07', fils: 0, count: 0 }, { key: '2026-08', fils: 7, count: 1 }, { key: '2026-09', fils: 123456789, count: 1 }];
    h.deps['@/lib/merchant-insights'] = { merchantMonthlySeries: () => months };
    h.deps['@/components/ui/grow-bar'] = { GrowBar: props => h.jsx('GrowBar', props) };
    const { MerchantMonthBars } = load(path.join(root, 'src/components/merchant-month-bars.tsx'), h.deps);
    const merchant = MerchantMonthBars({ transactions: [], merchant: 'Synthetic', period: { mode: 'year', year: 2026 }, live: new Set(), internal: new Set(), kind: 'expense', palette });
    const { BillHistoryTiles } = load(path.join(root, 'src/components/bills/bill-history-tiles.tsx'), h.deps);
    const bills = BillHistoryTiles({ months: months.map(month => ({...month, label: h.deps['@/lib/format'].monthLabel(month.key)})), palette, label: 'History' });
    for (const tree of [merchant, bills]) {
      for (const month of months) {
        assert.ok(text(tree).includes(h.deps['@/lib/format'].formatAED(month.fils)));
        assert.ok(text(tree).includes(h.deps['@/lib/format'].monthLabel(month.key)));
      }
      for (const node of walk(tree).filter(node => node.type === 'Text')) assert.equal(node.props.numberOfLines, undefined);
      const bars = walk(tree).filter(node => node.type === 'GrowBar');
      assert.ok(bars.every(node => node.props.axis === 'width'));
      assert.equal(bars.at(-1).props.size, 100);
    }
    const { AssistantMonthChart } = load(path.join(root, 'src/components/assistant-answer-extras.tsx'), h.deps);
    const money = { currency: 'KWD', exponent: 3 };
    const assistant = AssistantMonthChart({ series: months.map(month => ({ month: month.key, totalFils: month.fils })), money, language, largeText, palette });
    for (const month of months) assert.ok(text(assistant).includes(h.deps['@/lib/ledger-money'].formatMoneyText(month.fils, money)));
    assert.equal(walk(assistant).filter(node => node.type === 'GrowBar')[0].props.size, 0);
  });
}
test('limit history keeps exact monthly amounts and one shared limit position on every track', () => {
  const h = createHarness({ states: { 1: '1500.25' } });
  const state = h.deps['@/lib/store'].useStore().state;
  state.transactions = state.transactions.map(tx => ({...tx, amountFils: tx.amountFils + 7}));
  Object.assign(h.deps['@/lib/period'], { daysInPeriod: () => 30, elapsedDays: () => 6 });
  const { LimitSheet } = h.local('@/components/limit-sheet');
  const tree = LimitSheet({ category: 'dining', open: true, monthKey: '2026-09', onClose() {} });
  const history = walk(tree).find(node => node.props.testID === 'limit-history');
  assert.ok(history);
  assert.ok(text(history).includes('AED 620.07'));
  assert.ok(text(history).includes('AED 4,960.07'));
  assert.ok(text(history).includes('AED 1,500.25'));
  const markers = walk(history).filter(node => node.props.testID === 'limit-line');
  assert.equal(markers.length, 4);
  assert.equal(new Set(markers.map(node => flat(node.props.style).start)).size, 1);
  assert.equal(flat(markers[0].props.style).start, `${150025 / 496007 * 100}%`);
});

for (const language of ['en', 'ar']) test(`bill history draws six short amounts as side-by-side columns (${language})`, () => {
  const h = createHarness({ language, largeText: false, width: 320 });
  const palette = h.deps['@/constants/theme'].bandPalette('bills', 'light');
  h.deps['@/components/ui/grow-bar'] = { GrowBar: props => h.jsx('GrowBar', props) };
  const { BillHistoryTiles } = load(path.join(root, 'src/components/bills/bill-history-tiles.tsx'), h.deps);
  const fils = [37200, 39800, 44600, 47100, 45200, 0];
  const months = fils.map((value, index) => ({ label: `M${index}`, fils: value, current: index === 5 }));
  const tree = BillHistoryTiles({ months, palette, label: 'History' });
  const format = h.deps['@/lib/format'];
  for (const value of fils.slice(0, 5)) assert.ok(text(tree).includes(format.formatAmount(value)), 'every exact amount stays visible');
  assert.ok(text(tree).includes('—'), 'this month before its charge is a dash, not a 0');
  for (const value of fils) assert.match(tree.props.accessibilityLabel, new RegExp(format.formatAED(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const bars = walk(tree).filter(node => node.type === 'GrowBar');
  assert.equal(bars.length, 5, 'a month with no charge draws no bar');
  assert.ok(bars.every(node => node.props.axis === 'height'));
  assert.equal(Math.max(...bars.map(node => node.props.size)), 64);
  for (const node of walk(tree).filter(node => node.type === 'Text')) assert.equal(node.props.numberOfLines, undefined);
  // At an accessibility size the same months fall back to full-width rows.
  const large = createHarness({ language, largeText: true, width: 320 });
  large.deps['@/components/ui/grow-bar'] = { GrowBar: props => large.jsx('GrowBar', props) };
  const rows = load(path.join(root, 'src/components/bills/bill-history-tiles.tsx'), large.deps).BillHistoryTiles({ months, palette, label: 'History' });
  assert.ok(walk(rows).filter(node => node.type === 'GrowBar').every(node => node.props.axis === 'width'));
});

for (const language of ['en', 'ar']) test(`merchant month by month draws short amounts as side-by-side columns (${language})`, () => {
  const render = (options, months) => {
    const h = createHarness({ language, width: 390, ...options });
    h.deps['@/lib/merchant-insights'] = { merchantMonthlySeries: () => months };
    h.deps['@/components/ui/grow-bar'] = { GrowBar: props => h.jsx('GrowBar', props) };
    const palette = h.deps['@/constants/theme'].bandPalette('spending', 'light');
    const { MerchantMonthBars } = load(path.join(root, 'src/components/merchant-month-bars.tsx'), h.deps);
    return { h, tree: MerchantMonthBars({ transactions: [], merchant: 'Synthetic', period: { mode: 'year', year: 2026 },
      live: new Set(), internal: new Set(), kind: 'expense', palette }) };
  };
  const fils = [2400, 3150, 0, 3500, 14950, 480];
  const months = fils.map((value, index) => ({ key: `2026-0${index + 4}`, fils: value, count: value ? 2 : 0, selected: true }));
  const { h, tree } = render({ largeText: false }, months);
  const format = h.deps['@/lib/format'];
  const words = h.deps['@/lib/details-copy'] ?? load(path.join(root, 'src/lib/details-copy.ts'), h.deps);
  for (const value of fils) assert.ok(text(tree).includes(format.formatAmount(value)), 'every exact amount stays visible');
  const cells = walk(tree).filter(node => node.props?.accessibilityRole === 'image');
  assert.equal(cells.length, 6);
  // Each column speaks its whole month, exact amount with currency, and count.
  cells.forEach((cell, index) => assert.equal(cell.props.accessibilityLabel,
    words.detailsWords(language).merchant.month(format.monthLabel(months[index].key), format.formatAED(fils[index]), months[index].count)));
  const bars = walk(tree).filter(node => node.type === 'GrowBar');
  assert.equal(bars.length, 5, 'a month with nothing spent draws a baseline, not a bar');
  assert.ok(bars.every(node => node.props.axis === 'height'));
  assert.equal(Math.max(...bars.map(node => node.props.size)), 64);
  for (const node of walk(tree).filter(node => node.type === 'Text')) assert.equal(node.props.numberOfLines, undefined);
  // Ten months balance onto two lines of five columns.
  const ten = Array.from({ length: 10 }, (_, index) => ({ key: `2026-${String(index + 1).padStart(2, '0')}`, fils: 1000 * (index + 1), count: 1, selected: true }));
  const lines = walk(render({ largeText: false }, ten).tree).filter(node => node.type === 'View' && [node.props.children].flat(Infinity)
    .filter(child => child?.props?.accessibilityRole === 'image').length > 0);
  assert.deepEqual(lines.map(line => [line.props.children].flat(Infinity).filter(child => child?.props?.accessibilityRole === 'image').length), [5, 5]);
  // At an accessibility size the same months fall back to full-width rows with the currency.
  const large = render({ largeText: true }, months).tree;
  assert.ok(walk(large).filter(node => node.type === 'GrowBar').every(node => node.props.axis === 'width'));
  for (const value of fils) assert.ok(text(large).includes(format.formatAED(value)));
});
