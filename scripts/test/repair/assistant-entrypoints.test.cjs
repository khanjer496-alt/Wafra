'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk } = require('./reference-harness.cjs');
const { harness: homeHarness, walk: walkHome } = require('./journal-harness.cjs');
const root = path.resolve(__dirname, '../../..');

const actionIn = (tree, id) => {
  const wrapper = walk(tree).find(node => node.props?.testID === id);
  return walk(wrapper).find(node => node.type === 'Pressable');
};

for (const theme of ['light', 'dark']) {
  test(`${theme}: compact Home Ask entry opens the conversation with an accessible touch target`, () => {
    const h = homeHarness({ theme });
    const entry = walkHome(h.tree).find(node => node.props?.testID === 'home-widget-assistant');
    assert.equal(entry.props.accessibilityRole, 'button');
    assert.ok(entry.props.accessibilityLabel);
    assert.ok(entry.props.accessibilityHint);
    const style = Object.assign({}, ...entry.props.style({ pressed: false }));
    assert.ok(style.minHeight >= 48, 'the compact entry keeps a full touch target');
    entry.props.onPress();
    assert.deepEqual(h.events, [['route', '/assistant']]);
  });

  for (const view of ['categories', 'trends']) {
    test(`${theme}/${view}: Explain this opens a question without replacing the active spending period`, () => {
      const period = { mode: 'range', start: '2026-08-15', end: '2026-09-05' };
      const h = createHarness({ theme, period, params: { view } });
      const action = actionIn(h.render('flow'), 'spending-ask-wafra');
      assert.equal(action.props.accessibilityLabel, 'Explain this');
      action.props.onPress();
      assert.deepEqual(JSON.parse(JSON.stringify(h.events)), [['route', {
        pathname: '/assistant', params: { question: 'Why did my spending change?' },
      }]], 'contextual navigation must leave the shared period untouched');
    });
  }
}

test('spending search does not offer an explanation that would silently discard its query', () => {
  const h = createHarness({ params: { view: 'activity' }, states: { 2: 'Cedar' } });
  assert.equal(actionIn(h.render('flow'), 'spending-ask-wafra'), undefined);
});

test('category explanation carries the selected category and dismisses the detail sheet', () => {
  const h = createHarness({ states: { 5: 'groceries' } });
  actionIn(h.render('flow'), 'category-ask-wafra').props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(h.events)), [
    ['state', 5, null],
    ['route', { pathname: '/assistant', params: { question: 'Why did my Groceries spending change?' } }],
  ]);
});

function merchantHarness({ name, type, all = false, hydrated = true }) {
  const h = createHarness({ params: { name, type }, state: { hydrated }, states: all ? { 0: 'all' } : {} });
  h.deps['react-native'].FlatList = props => h.jsx('FlatList', props);
  h.deps['@/lib/period'].periodRange = () => '1–30 September 2026';
  h.deps['@/components/ui/states'] = { SkeletonRows: props => h.jsx('SkeletonRows', props) };
  const screen = load(path.join(root, 'src/app/merchant.tsx'), h.deps).default();
  const list = walk(screen).find(node => node.type === 'FlatList');
  return { ...h, tree: list?.props.ListHeaderComponent ?? screen };
}

for (const name of ['Starbucks', 'R&D / Cafe? #2 + 20%', 'Cedar "Express" \\ West', 'Salary & bills']) {
  test(`merchant question quotes the full recorded name: ${name}`, () => {
    const h = merchantHarness({ name });
    const action = actionIn(h.tree, 'merchant-ask-wafra');
    assert.equal(action.props.accessibilityLabel, 'Ask about this merchant');
    action.props.onPress();
    const route = h.events[0][1];
    assert.equal(route.pathname, '/assistant');
    assert.equal(route.params.question, `Why did spending at ${JSON.stringify(name)} change?`);
    assert.deepEqual(Object.keys(route.params), ['question']);
  });
}

test('an income source asks about income, even when its name looks like a spending keyword', () => {
  const h = merchantHarness({ name: 'Shopping rewards', type: 'income' });
  const action = actionIn(h.tree, 'merchant-ask-wafra');
  assert.equal(action.props.accessibilityLabel, 'Ask about this income');
  action.props.onPress();
  assert.equal(h.events[0][1].params.question, 'How much income did I receive from "Shopping rewards"?');
});

test('blank, loading and all-activity merchant views do not offer an incorrectly scoped question', () => {
  for (const args of [{ name: '' }, { name: 'Cedar', hydrated: false }, { name: 'Cedar', all: true }]) {
    const h = merchantHarness(args);
    assert.equal(actionIn(h.tree, 'merchant-ask-wafra'), undefined);
  }
});
