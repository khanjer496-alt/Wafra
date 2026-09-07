'use strict';
// Actual Home components with explicit native/store boundaries. No personal data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const find = (tree, id) => walk(tree).find(node => node.props?.testID === id);

for (const language of ['en', 'ar']) {
  for (const theme of ['light', 'dark']) {
    for (const [name, incomeFils, expenseFils] of [
      ['surplus', 200050, 125025], ['deficit', 5010, 1459316],
      ['zero', 0, 0], ['no income recorded', 0, 1459316],
    ]) {
      test(`${language}/${theme}: ${name} exposes exact in, out and net without a bank balance`, () => {
        const h = createHarness({ language, theme, largeText: true, width: 320 });
        const previous = h.deps['@/lib/dashboard-projection'].projectDashboard();
        h.deps['@/lib/dashboard-projection'].projectDashboard = () => ({ ...previous,
          hero: { incomeFils, expenseFils, netFils: incomeFils - expenseFils },
        });
        const tree = h.render('home');
        const words = h.deps['@/lib/reference-copy'].homeSummaryCopy[language];
        const incoming = find(tree, 'home-income-summary');
        const outgoing = find(tree, 'home-spending-total');
        const net = find(tree, 'home-net-summary');
        assert.ok(incoming && outgoing && net);
        assert.ok(incoming.props.accessibilityLabel.startsWith(words.moneyIn + ','));
        assert.ok(outgoing.props.accessibilityLabel.startsWith(words.moneyOut + ','));
        assert.ok(incoming.props.accessibilityLabel.includes(h.format.formatAmount(incomeFils)));
        assert.ok(outgoing.props.accessibilityLabel.includes(h.format.formatAmount(expenseFils)));
        const difference = incomeFils - expenseFils;
        const sign = difference < 0 ? '−' : difference > 0 ? '+' : '';
        assert.ok(net.props.accessibilityLabel.includes(sign + h.format.formatAmount(Math.abs(difference))));
        assert.ok(net.props.accessibilityLabel.includes(words.cashflowNote));
        assert.equal(net.props.onPress, undefined, 'net is a figure, not a dead button');
        assert.equal(!!find(tree, 'home-no-income-note'), incomeFils === 0);
        assert.ok(!text(tree).includes(words.balance), 'account snapshots do not replace cashflow');
        incoming.props.onPress(); outgoing.props.onPress();
        assert.deepEqual(h.events, [['route', '/transactions?type=income'], ['route', '/flow']]);
        const style = Object.assign({}, ...net.props.style.flat().filter(Boolean));
        assert.equal(style.flexDirection, 'column', 'large text stacks rather than shrinking money');
      });
    }
  }
}

test('changing the shared reporting period changes all three Home figures together', () => {
  const current = createHarness({ period: { mode: 'month', key: '2026-09' } });
  const previous = createHarness({ period: { mode: 'month', key: '2026-08' } });
  for (const h of [current, previous]) {
    const expected = h.deps['@/lib/dashboard-projection'].projectDashboard().hero;
    const tree = h.render('home');
    assert.ok(find(tree, 'home-income-summary').props.accessibilityLabel.includes(h.format.formatAmount(expected.incomeFils)));
    assert.ok(find(tree, 'home-spending-total').props.accessibilityLabel.includes(h.format.formatAmount(expected.expenseFils)));
    assert.ok(find(tree, 'home-net-summary').props.accessibilityLabel.includes(h.format.formatAmount(Math.abs(expected.netFils))));
  }
  assert.notEqual(find(current.render('home'), 'home-net-summary').props.accessibilityLabel,
    find(previous.render('home'), 'home-net-summary').props.accessibilityLabel);
});
