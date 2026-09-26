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
