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
        const amount = fils => h.deps['@/lib/ledger-money'].formatMinorUnits(fils, h.state.ledgerMoney);
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
        assert.ok(incoming.props.accessibilityLabel.includes(amount(incomeFils)));
        assert.ok(outgoing.props.accessibilityLabel.includes(amount(expenseFils)));
        const difference = incomeFils - expenseFils;
        const sign = difference < 0 ? '−' : difference > 0 ? '+' : '';
        assert.ok(net.props.accessibilityLabel.includes(sign + amount(Math.abs(difference))));
        assert.equal(net.props.onPress, undefined, 'net is a figure, not a dead button');
        assert.equal(!!find(tree, 'home-no-income-note'), incomeFils === 0);
        assert.ok(!text(tree).includes(words.balance), 'account snapshots do not replace cashflow');
        incoming.props.onPress(); outgoing.props.onPress();
        assert.deepEqual(h.events, [['route', '/transactions?type=income'], ['route', '/transactions?type=expense']]);
        const style = Object.assign({}, ...net.props.style.flat().filter(Boolean));
        const metrics = walk(tree).find(node => Array.isArray(node.props?.children)
          && node.props.children.includes(incoming) && node.props.children.includes(net));
        assert.ok(metrics, 'income and net share the responsive metrics group');
        const groupStyle = Object.assign({}, ...metrics.props.style.flat().filter(Boolean));
        assert.equal(groupStyle.flexDirection, 'column', 'large text stacks the complete metrics group');
        assert.equal(style.flexBasis, 'auto', 'stacked money does not inherit a percentage height');
      });
    }
  }
}

test('changing the shared reporting period changes all three Home figures together', () => {
  const current = createHarness({ period: { mode: 'month', key: '2026-09' } });
  const previous = createHarness({ period: { mode: 'month', key: '2026-08' } });
  for (const h of [current, previous]) {
    const amount = fils => h.deps['@/lib/ledger-money'].formatMinorUnits(fils, h.state.ledgerMoney);
    const expected = h.deps['@/lib/dashboard-projection'].projectDashboard().hero;
    const tree = h.render('home');
    assert.ok(find(tree, 'home-income-summary').props.accessibilityLabel.includes(amount(expected.incomeFils)));
    assert.ok(find(tree, 'home-spending-total').props.accessibilityLabel.includes(amount(expected.expenseFils)));
    assert.ok(find(tree, 'home-net-summary').props.accessibilityLabel.includes(amount(Math.abs(expected.netFils))));
  }
  assert.notEqual(find(current.render('home'), 'home-net-summary').props.accessibilityLabel,
    find(previous.render('home'), 'home-net-summary').props.accessibilityLabel);
});

test('Home keeps transfer uncertainty out of the primary dashboard and shows cash In / Out / Net', () => {
  const h = createHarness({ language: 'en', period: { mode: 'all' } });
  const previous = h.deps['@/lib/dashboard-projection'].projectDashboard();
  h.deps['@/lib/dashboard-projection'].projectDashboard = () => ({ ...previous,
    hero: {
      incomeFils: 270000000,
      expenseFils: 345000000,
      cashInFils: 552029437,
      cashOutFils: 342305358,
      netFils: 209724079,
    },
  });
  const tree = h.render('home');
  const net = find(tree, 'home-net-summary');
  const out = find(tree, 'home-out-summary');
  const words = h.deps['@/lib/reference-copy'].homeSummaryCopy.en;
  assert.ok(net && out);
  assert.ok(net.props.accessibilityLabel.startsWith(words.netLabel + ','));
  assert.ok(out.props.accessibilityLabel.startsWith(words.cashOut + ','));
  assert.doesNotMatch(text(tree), /Confirmed net|Unclear transfers|Transfers that may be yours|not final|excluded.*transfer/i,
    'Home does not dump transfer diagnostics into the primary money summary');
});

test('Home refreshes its conditional prompt after the final review is dismissed without a ledger change', () => {
  const h = createHarness({ state: { reviewTray: { pending: [{ expiresAt: Date.now() + 864000000 }] } } });
  const project = h.deps['@/lib/dashboard-projection'].projectDashboard;
  let projections = 0;
  const memoSlots = [];
  let memoCursor = 0;
  h.deps.react.useMemo = (factory, deps) => {
    const index = memoCursor++;
    const previous = memoSlots[index];
    if (previous && deps?.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return previous.value;
    const value = factory(); memoSlots[index] = { value, deps }; return value;
  };
  h.deps['@/lib/dashboard-projection'].projectDashboard = request => {
    projections++;
    assert.equal(request.surface, 'home');
    const projected = project();
    return { ...projected, unreadFormats: request.state.reviewTray.pending.length ? null : { count: 3, shouldPrompt: true } };
  };
  const render = () => { memoCursor = 0; return h.render('home'); };
  render();
  const sameTransactions = h.state.transactions;
  h.state.reviewTray = { pending: [] };
  const tree = render();
  assert.equal(h.state.transactions, sameTransactions);
  assert.equal(projections, 2, 'the changed prompt priority invalidates only the existing Home projection memo');
  assert.ok(text(tree).includes(h.deps['@/lib/i18n'].tf('unreadFormatCount', { count: 3, s: 's' })));
});
