'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const item = (id, dateISO, extra = {}) => ({ id, title: id, dateISO, category: 'entertainment',
  amountFils: 1234, estimated: false, paid: false, kind: 'subscription', daysLeft: 0, ...extra });
const items = [item('Netflix', '2026-09-15'), item('Spotify', '2026-09-15'), item('Apple Music', '2026-09-15'),
  item('YouTube Premium', '2026-09-15', { estimated: true }), item('Due tomorrow', '2026-09-16'),
  item('Later this week', '2026-09-17'), item('Paid', '2026-09-15', { paid: true }),
  item('Overdue', '2026-09-14'), item('Beyond window', '2026-10-16')];
function render(options = {}, input = items, money = null) {
  const h = createHarness(options);
  h.deps['@/hooks/use-ledger-money'] = { useLedgerMoney: () => money, useMoneyLocaleKey: () => '' };
  h.local('@/components/bills/bills-timeline');
  const palette = h.deps['@/constants/theme'].bandPalette('bills', options.theme ?? 'light');
  const tree = h.deps['@/components/bills/bills-timeline'].BillsTimeline({ items: input, todayISO: '2026-09-15', palette });
  return { h, tree };
}
const pins = tree => walk(tree).filter(node => String(node.props?.testID ?? '').startsWith('bills-timeline-payment-'));
for (const language of ['en', 'ar']) for (const largeText of [false, true]) {
  test(`every payment in the window is on the band, wrapping instead of scrolling or "and N more" (${language}, large=${largeText})`, () => {
    const { tree } = render({ language, largeText, width: 320, theme: 'dark' });
    assert.equal(tree.props.accessible, false, 'each payment remains individually reachable');
    assert.equal(walk(tree).some(node => node.type === 'ScrollView'), false, 'nothing scrolls sideways');
    assert.equal(flat(tree.props.style).flexWrap, 'wrap');
    assert.equal(walk(tree).some(node => node.props?.testID === 'bills-timeline-more'), false, 'no "and N more"');
    const shown = pins(tree);
    assert.deepEqual(shown.map(node => node.props.testID.slice('bills-timeline-payment-'.length)),
      ['Apple Music', 'Netflix', 'Spotify', 'YouTube Premium', 'Due tomorrow', 'Later this week'], 'all six, in date order');
    for (const pin of shown) {
      assert.equal(pin.props.accessibilityRole, 'text');
      assert.ok(walk(pin).some(node => String(node.props?.testID ?? '').startsWith('bills-payment-due-')), 'each logo keeps its date');
      assert.match(pin.props.accessibilityLabel, /12\.34|١٢٫٣٤/);
      assert.ok(!walk(pin).some(node => node.type === 'Text' && node.props.numberOfLines), 'dates never truncate');
    }
    assert.doesNotMatch(tree.props.accessibilityLabel, /Paid|Overdue|Beyond window/);
    const estimated = shown.find(node => node.props.testID.endsWith('YouTube Premium'));
    assert.ok(estimated.props.accessibilityLabel.includes(language === 'ar' ? 'حوالي' : 'About'), 'an estimate is spoken as one');
  });
}
test('a long month shows every payment, however many', () => {
  const { tree } = render({}, Array.from({ length: 14 }, (_, index) => item(`Payee ${index}`, '2026-09-20')));
  assert.equal(pins(tree).length, 14);
});
test('payment amount and currency remain exact in a three-decimal ledger', () => {
  const { tree } = render({}, [item('Synthetic', '2026-09-15')], { schemaVersion: 2, currency: 'KWD', exponent: 3 });
  assert.match(pins(tree)[0].props.accessibilityLabel, /KWD 1\.234/);
});
test('empty upcoming window retains the existing honest empty state', () => {
  const { tree } = render({}, items.filter(item => item.paid || item.id === 'Overdue' || item.id === 'Beyond window'));
  assert.equal(tree.props.testID, 'bills-timeline-empty');
  assert.match(text(tree), /Nothing due in the next 30 days/);
});
