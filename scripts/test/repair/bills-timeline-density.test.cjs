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
const cards = tree => walk(tree).filter(node => String(node.props?.testID ?? '').startsWith('bills-timeline-payment-'));
function render(options = {}, input = items, money = null) {
  const h = createHarness(options);
  h.deps['@/hooks/use-ledger-money'] = { useLedgerMoney: () => money, useMoneyLocaleKey: () => '' };
  h.local('@/components/ui/band/band-figure');
  h.local('@/components/bills/bills-timeline');
  const palette = h.deps['@/constants/theme'].bandPalette('bills', options.theme ?? 'light');
  const tree = h.deps['@/components/bills/bills-timeline'].BillsTimeline({ items: input, todayISO: '2026-09-15', palette });
  return { h, tree };
}
for (const language of ['en', 'ar']) for (const largeText of [false, true]) {
  test(`same-day and nearby payments occupy distinct layout cells (${language}, large=${largeText})`, () => {
    const { tree } = render({ language, largeText, width: 320, theme: 'dark' });
    assert.equal(tree.props.accessible, false, 'payment descriptions remain individually reachable');
    const scroll = walk(tree).find(node => node.props.testID === 'bills-timeline-scroll');
    assert.equal(scroll.props.horizontal, true);
    const groups = walk(tree).filter(node => String(node.props.testID ?? '').startsWith('bills-timeline-date-'));
    assert.deepEqual(groups.map(node => node.props.testID), ['bills-timeline-date-0', 'bills-timeline-date-1', 'bills-timeline-date-2']);
    assert.equal(cards(groups[0]).length, 4, 'all four same-day logos get their own payment cell');
    const shown = cards(tree);
    assert.equal(shown.length, 6);
    for (const card of shown) {
      assert.notEqual(flat(card.props.style).position, 'absolute');
      assert.ok(flat(card.props.style).width <= 280);
      assert.equal(flat(card.props.style).flexShrink, 0);
      assert.equal(card.props.accessibilityRole, 'text');
      const dueLabel = walk(card).find(node => String(node.props.testID ?? '').startsWith('bills-payment-due-'));
      assert.ok(dueLabel, 'each card retains its visible date after horizontal scrolling');
      assert.ok(text(dueLabel).includes('·'));
      assert.match(text(dueLabel), /15|16|17|١٥|١٦|١٧/);
      assert.match(card.props.accessibilityLabel, /12\.34|١٢٫٣٤/);
      assert.ok(!walk(card).some(node => node.type === 'Text' && node.props.numberOfLines), 'names and money never truncate');
    }
    assert.doesNotMatch(tree.props.accessibilityLabel, /Paid|Overdue|Beyond window/);
    const estimated = shown.find(node => node.props.testID.endsWith('YouTube Premium'));
    assert.ok(text(estimated).includes('≈'), 'an estimate is marked on the card');
    assert.ok(estimated.props.accessibilityLabel.includes(language === 'ar' ? 'حوالي' : 'About'), 'and spoken as one');
  });
}
test('the bounded preview shows all first eight payments and names the remaining count', () => {
  const { tree } = render({}, Array.from({ length: 12 }, (_, index) => item(`Payee ${index}`, '2026-09-15')));
  assert.equal(cards(tree).length, 8);
  const more = walk(tree).find(node => node.props.testID === 'bills-timeline-more');
  assert.equal(text(more), 'and 4 more');
  assert.match(tree.props.accessibilityLabel, /Payee 9/);
});
test('payment amount and currency remain exact in a three-decimal ledger', () => {
  const { tree } = render({}, [item('Synthetic', '2026-09-15')], { schemaVersion: 2, currency: 'KWD', exponent: 3 });
  assert.match(cards(tree)[0].props.accessibilityLabel, /KWD 1\.234/);
  assert.match(text(cards(tree)[0]), /1\.234/);
});
test('empty upcoming window retains the existing honest empty state', () => {
  const { tree } = render({}, items.filter(item => item.paid || item.id === 'Overdue' || item.id === 'Beyond window'));
  assert.equal(tree.props.testID, 'bills-timeline-empty');
  assert.match(text(tree), /Nothing due in the next 30 days/);
});
