'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const field = value => ({ value, evidence: value === null ? 'missing' : 'explicit', alternatives: [], spans: [], issues: [] });
const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);
function harness() {
  const item = { id: 'apple_pay_review_id_' + 'a'.repeat(32), sourceKey: 'apple_pay_review_source_' + 'a'.repeat(32),
    kind: 'universal', observedAt: Date.now() - 1000, expiresAt: Date.now() + 86400000, channel: 'push', parserVersion: 1,
    event: { version: 1, decision: 'review', family: 'purchase', status: 'unknown', direction: 'debit',
      amount: field({ currency: 'AED', minorUnits: '2500', exponent: 2 }), merchant: field('Synthetic Cafe'),
      instrument: field(null), transactionDate: field(null), statementDate: field(null), dueDate: field(null),
      statementTotal: field(null), minimumDue: field(null), balance: field(null), creditLimit: field(null), observations: [], issues: [] } };
  const h = createWorkflowHarness({ state: { reviewTray: { pending: [item], tombstones: [], templateRules: [] },
    accounts: [{ id: 'card1', name: 'Test Card', kind: 'card', last4: '1234', openingFils: 0, color: '#000' }] }, params: { reviewId: item.id } });
  const states = [], refs = []; let stateIndex = 0, refIndex = 0, generation = 0, routeId = item.id;
  h.deps.react.useState = initial => { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; };
  h.deps.react.useRef = initial => refs[refIndex++] ??= { current: initial };
  h.deps['@/lib/haptics'].committed = () => {};
  h.deps['@/lib/review-promotion'] = { reviewTemplateRuleFor: () => null };
  h.deps['@/lib/universal-categorization'] = { suggestUniversalCategory: () => null };
  h.deps['expo-router'].useLocalSearchParams = () => ({ reviewId: routeId });
  h.local('@/lib/review-alert-copy', 'src/lib/review-alert-copy.ts'); h.local('@/components/universal-review-fields');
  const store = h.deps['@/lib/store'].useStore(); store.getStateGeneration = () => generation;
  store.getStateSnapshot = () => h.state;
  store.promoteReviewAlert = async () => { h.events.push(['promotion']); const error = new Error('bounded'); error.name = 'ReviewPromotionError'; error.reason = 'possible-duplicate'; throw error; };
  store.addTransaction = () => h.events.push(['unexpected-manual-add']);
  const render = () => { stateIndex = 0; refIndex = 0; return h.renderScreen('add-transaction'); };
  const open = async () => {
    byId(render(), 'account-picker-trigger').props.onPress();
    const account = walk(render()).find(node => node.props?.onPress && node.props.accessibilityLabel?.includes('Test Card') && node.props.testID !== 'account-picker-trigger');
    assert.ok(account); account.props.onPress();
    const button = walk(render()).find(node => node.props?.onPress && node.props.accessibilityLabel === h.deps['@/lib/i18n'].t('genericConfirmAdd'));
    assert.ok(button); button.props.onPress(); await flush(); return render();
  };
  return { ...h, store, item, render, open, setGeneration: value => { generation = value; }, setRoute: value => { routeId = value; } };
}

test('Wallet duplicate dialog keeps Review unchanged when cancelled and uses Apple Pay labels', async () => {
  const h = harness(); const initial = h.render();
  assert.ok(text(initial).includes('Apple Pay via Shortcuts'));
  const tree = await h.open();
  assert.ok(byId(tree, 'apple-pay-duplicate-review'));
  byId(tree, 'apple-pay-keep-review').props.onPress();
  assert.ok(h.events.some(event => event[0] === 'back'));
  assert.equal(h.events.some(event => event[0] === 'dismissReviewAlert'), false);
  assert.equal(h.state.reviewTray.pending.length, 1);
});

test('Already recorded waits for durable save and retains read-only facts plus retry after optimistic failure', async () => {
  const h = harness(); let rejectWrite, resolveWrite, calls = 0;
  h.store.dismissReviewAlert = async (id, outcome) => {
    calls++; h.events.push(['dismiss', id, outcome]);
    h.state.reviewTray = { ...h.state.reviewTray, pending: [], tombstones: [{ sourceKey: h.item.sourceKey, outcome: 'duplicate', resolvedAt: Date.now(), expiresAt: Date.now() + 86400000 }] };
    return new Promise((resolve, reject) => { rejectWrite = reject; resolveWrite = resolve; });
  };
  byId(await h.open(), 'apple-pay-already-recorded').props.onPress(); await flush();
  assert.equal(calls, 1); assert.equal(h.events.some(event => event[0] === 'back'), false);
  assert.ok(byId(h.render(), 'apple-pay-duplicate-review'));
  assert.equal(byId(h.render(), 'apple-pay-already-recorded').props.disabled, true);
  rejectWrite(new Error('private failure text')); await flush();
  const failed = h.render();
  assert.ok(text(failed).includes('Synthetic Cafe'));
  assert.ok(!text(failed).includes('private failure text'));
  assert.ok(byId(failed, 'apple-pay-duplicate-save-error'));
  assert.equal(byId(failed, 'apple-pay-keep-review').props.disabled, true);
  byId(failed, 'apple-pay-already-recorded').props.onPress(); await flush();
  assert.equal(calls, 2); resolveWrite(); await flush();
  assert.ok(h.events.some(event => event[0] === 'back'));
  assert.equal(h.events.some(event => event[0] === 'unexpected-manual-add'), false);
});

test('source replacement and ledger generation changes prevent stale duplicate dismissal', async () => {
  for (const mutate of [h => h.setGeneration(1), h => { h.state.reviewTray.pending[0] = { ...h.item, sourceKey: 'changed_source_123456' }; }]) {
    const h = harness(); await h.open(); mutate(h);
    const button = byId(h.render(), 'apple-pay-already-recorded'); assert.equal(button.props.disabled, true);
    button.props.onPress(); await flush();
    assert.equal(h.events.some(event => event[0] === 'dismissReviewAlert'), false);
  }
});

test('an in-flight result cannot navigate after ledger replacement and failure before dispatch can still keep Review', async () => {
  const h = harness(); let complete;
  h.store.dismissReviewAlert = async () => new Promise(resolve => { complete = resolve; });
  byId(await h.open(), 'apple-pay-already-recorded').props.onPress(); await flush();
  h.setGeneration(1); complete(); await flush();
  assert.equal(h.events.some(event => event[0] === 'back'), false);
  assert.equal(byId(h.render(), 'apple-pay-already-recorded').props.disabled, true);
  const untouched = harness();
  untouched.store.dismissReviewAlert = async () => { throw new Error('before dispatch'); };
  byId(await untouched.open(), 'apple-pay-already-recorded').props.onPress(); await flush();
  const tree = untouched.render();
  assert.equal(byId(tree, 'apple-pay-keep-review').props.disabled, false);
  byId(tree, 'apple-pay-keep-review').props.onPress();
  assert.equal(untouched.state.reviewTray.pending.length, 1);
  assert.ok(untouched.events.some(event => event[0] === 'back'));
});
