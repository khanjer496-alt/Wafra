'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { harness, walk, text } = require('./journal-harness.cjs');

test('Home puts one spending summary and dated activity before capture controls', () => {
  const h = harness();
  const nodes = walk(h.tree);
  const section = (id) => nodes.findIndex((node) => node.props.testID === id);
  assert.ok(section('journal-summary') < section('journal-activity'));
  assert.ok(section('journal-activity') < section('journal-import-controls'));
  assert.equal(nodes.find((node) => node.type === 'Money').props.fils, 508700);
  assert.match(text(h.tree), /View spending breakdown/);
  assert.match(text(h.tree), /6 Sept/);
});
test('settings and explicit manual entry remain working visible quick actions', () => {
  const h = harness();
  const nodes = walk(h.tree);
  nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Add').props.onPress();
  nodes.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Settings').props.onPress();
  assert.deepEqual(h.events.filter((e) => e[0] === 'route'), [['route', '/add-transaction'], ['route', '/settings']]);
});
test('activity search and full bills remain reachable without duplicate Accounts shortcuts', () => {
  const h = harness();
  for (const node of walk(h.tree)) {
    if (node.type === 'Pressable' && (text(node.props.children).trim() === 'See all' || node.props.accessibilityLabel === 'View all payments')) node.props.onPress();
  }
  assert.ok(h.events.some((e) => e[1] === '/transactions'));
  assert.ok(h.events.some((e) => e[1] === '/bills'));
});
test('failed history exposes resume rather than pretending capture completed', async () => {
  const h = harness({ history: { status: 'failed', scanned: 1000, found: 120, error: 'page-failed' } });
  assert.match(text(h.tree), /Import interrupted/);
  const button = walk(h.tree).find((node) => node.type === 'Pressable' && text(node.props.children).trim() === 'Resume');
  button.props.onPress();
  await Promise.resolve();
  assert.deepEqual(h.events, [['resume']]);
});
test('paused history has an explicit resume action; running history does not restart it', () => {
  const paused = harness({ history: { status: 'paused', scanned: 1000, found: 120 } });
  assert.match(text(paused.tree), /History import paused/);
  const running = harness({ history: { status: 'running', scanned: 1000, found: 120 } });
  assert.match(text(running.tree), /1,000\s+Messages checked/);
  assert.match(text(running.tree), /120\s+Transactions found/);
  assert.equal(walk(running.tree).filter((n) => n.type === 'Pressable' && text(n.props.children).trim() === 'Resume').length, 0);
});
test('capture opt-out changes only after an explicit press and then opens iOS setup', async () => {
  const h = harness({ optOut: true, platform: 'ios' });
  assert.deepEqual(h.events, []);
  const button = walk(h.tree).find((node) => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Bank alerts.'));
  button.props.onPress();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(h.events, [['optOut', false], ['route', '/ios-setup']]);
});
test('empty month retains manual entry and explicit bank-alert check', () => {
  const h = harness({ empty: true });
  const empty = walk(h.tree).find((node) => node.type === 'EmptyMonth');
  assert.ok(empty);
  empty.props.onAddManually();
  assert.ok(h.events.some((e) => e[1] === '/add-transaction'));
  assert.equal(typeof empty.props.onReadInbox, 'function');
});
test('unhydrated ledger renders skeletons, not a misleading zero dashboard', () => {
  const h = harness({ hydrated: false });
  assert.ok(walk(h.tree).some((node) => node.type === 'SkeletonRows'));
  assert.equal(walk(h.tree).some((node) => node.props.testID === 'journal-summary'), false);
});
test('incoming transfer remains positive but not coloured as earned income', () => {
  const h = harness();
  const row = h.TransactionRow({ transaction: { id: 'transfer', title: 'Incoming transfer', amountFils: 26500,
    category: 'other', type: 'income' }, internal: true });
  const amount = walk(row).find((node) => node.type === 'Text' && text(node.props.children).startsWith('+'));
  assert.ok(amount);
  assert.equal(amount.props.style[1].color, h.theme.text);
});
test('Arabic and larger text render the same controls without English journal headings', () => {
  const h = harness({ language: 'ar', largeText: true, theme: 'dark' });
  assert.match(text(h.tree), /حركتك المالية/);
  assert.doesNotMatch(text(h.tree), /Your activity/);
  assert.ok(walk(h.tree).some((node) => node.props.testID === 'journal-import-controls'));
});

test('reference composition places actionable upcoming payments before recent activity', () => {
  const nodes = walk(harness().tree);
  const at = (id) => nodes.findIndex((node) => node.props.testID === id);
  assert.ok(at('journal-summary') < at('journal-payments'));
  assert.equal(at('reference-quick-actions'), -1);
  assert.equal(at('reference-month-cards'), -1);
  assert.ok(at('journal-payments') < at('journal-activity'));
});
test('known balances never replace spending or add another summary on Home', () => {
  const h = harness({ knownBalance: 3870000 });
  assert.equal(walk(h.tree).find((node) => node.type === 'Money').props.fils, 508700);
  assert.doesNotMatch(text(h.tree), /Recorded balances|Net after spending/);
  assert.doesNotMatch(text(h.tree), /6%|on track|safe to spend/i);
});
test('zero and unknown account balances do not change the Home spending figure', () => {
  const zero = harness({ knownBalance: 0 });
  assert.equal(walk(zero.tree).find((node) => node.type === 'Money').props.fils, 508700);
  assert.doesNotMatch(text(zero.tree), /Recorded balances/);
  const unknown = harness();
  assert.equal(walk(unknown.tree).find((node) => node.type === 'Money').props.fils, 508700);
  assert.doesNotMatch(text(unknown.tree), /Recorded balances/);
});
test('Home does not duplicate import shortcuts; explicit capture control remains accessible', () => {
  for (const platform of ['android', 'ios']) {
    const h = harness({ platform });
    assert.ok(walk(h.tree).some((n) => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Bank alerts.')));
    assert.equal(walk(h.tree).filter((n) => n.props.testID === 'reference-quick-actions').length, 0);
    assert.deepEqual(h.events, []);
  }
});
