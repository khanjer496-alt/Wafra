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
const cards = tree => walk(tree).filter(node => String(node.props?.testID ?? '').startsWith('bills-timeline-payment-'));
for (const language of ['en', 'ar']) for (const largeText of [false, true]) {
  test(`the next two payments sit side by side without sideways scrolling (${language}, large=${largeText})`, () => {
    const { tree } = render({ language, largeText, width: 320, theme: 'dark' });
    assert.equal(tree.props.accessible, false, 'payment descriptions remain individually reachable');
    assert.equal(walk(tree).some(node => node.type === 'ScrollView'), false, 'nothing on the band scrolls sideways');
    const shown = cards(tree);
    // Same-day payments sort by title: Apple Music, then Netflix.
    assert.deepEqual(shown.map(node => node.props.testID), ['bills-timeline-payment-Apple Music', 'bills-timeline-payment-Netflix']);
    for (const card of shown) {
      assert.equal(flat(card.props.style).position, undefined);
      assert.equal(flat(card.props.style).flex, largeText ? 0 : 1, 'two cards share the width; large text stacks them');
      assert.equal(card.props.accessibilityRole, 'text');
      const due = walk(card).find(node => String(node.props.testID ?? '').startsWith('bills-payment-due-'));
      assert.ok(due && text(due).includes('·'), 'each card keeps its date');
      assert.match(card.props.accessibilityLabel, /12\.34|١٢٫٣٤/);
      assert.ok(!walk(card).some(node => node.type === 'Text' && node.props.numberOfLines), 'names and money never truncate');
    }
    const more = walk(tree).find(node => node.props.testID === 'bills-timeline-more');
    assert.ok(more, 'the remaining count is said under the cards');
    for (const name of ['Spotify', 'YouTube Premium', 'Due tomorrow', 'Later this week']) {
      assert.match(tree.props.accessibilityLabel, new RegExp(name), 'the whole window is still spoken');
    }
    assert.doesNotMatch(tree.props.accessibilityLabel, /Paid|Overdue|Beyond window/);
  });
}
test('an estimate is marked ≈ on its card and spoken as About', () => {
  const { tree } = render({}, [item('Synthetic', '2026-09-16', { estimated: true })]);
  const [card] = cards(tree);
  assert.match(text(card), /≈ AED 12\.34/);
  assert.match(card.props.accessibilityLabel, /About AED 12\.34/);
  assert.equal(walk(tree).find(node => node.props.testID === 'bills-timeline-more'), undefined);
});
test('the remaining count names how many are not on the cards', () => {
  const { tree } = render({}, Array.from({ length: 6 }, (_, index) => item(`Payee ${index}`, '2026-09-15')));
  assert.equal(cards(tree).length, 2);
  assert.equal(text(walk(tree).find(node => node.props.testID === 'bills-timeline-more')), 'and 4 more');
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
