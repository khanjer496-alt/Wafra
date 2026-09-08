'use strict';
// Production review screens with explicit native/store boundaries. No real inbox data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');
const field = (value = null, evidence = value === null ? 'missing' : 'explicit') => ({ value, evidence, alternatives: [] });
const money = (minorUnits = '12345', exponent = 2) => ({ currency: 'AED', minorUnits, exponent });
const pending = (family, changes = {}) => ({
  id: 'synthetic-' + family, kind: 'universal', sourceKey: 'synthetic-source-' + family,
  observedAt: Date.now() - 60000, expiresAt: Date.now() + 86400000, channel: 'inbox', parserVersion: 35,
  event: { family, status: 'posted', direction: 'debit', amount: field(), statementTotal: field(),
    balance: field(), creditLimit: field(), minimumDue: field(), merchant: field('Synthetic shop'),
    instrument: field(), transactionDate: field('2026-09-06'), statementDate: field(), dueDate: field(), ...changes },
});
const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);
const action = (tree, label) => walk(tree).find(node => node.props?.onPress && node.props.accessibilityLabel === label);
const confirmation = tree => walk(tree).find(node => node.props?.name === 'ConfirmSheet');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

for (const language of ['en', 'ar']) {
  test(`${language}: one compact count and one empty state, without automatic dismissal`, () => {
    const h = createWorkflowHarness({ language });
    const words = h.deps['@/components/workflows/workflow-copy'].workflowCopy(language);
    const empty = h.renderScreen('review-alerts');
    assert.equal(byId(empty, 'review-alerts-intro'), undefined);
    assert.equal(text(empty).split(words.complete).length - 1, 1);
    assert.deepEqual(h.events, []);
    const active = createWorkflowHarness({ language, state: { reviewTray: { pending: [pending('purchase'), pending('balance')] } } });
    const intro = byId(active.renderScreen('review-alerts'), 'review-alerts-intro');
    assert.ok(text(intro).includes(active.deps['@/lib/i18n'].tf('reviewAlertsSettingsCount', { count: 2 })));
    assert.ok(text(intro).includes(words.reviewBody));
    assert.deepEqual(active.events, []);
  });
  for (const [family, name, label] of [['purchase', 'amount', 'genericAmount'], ['statement', 'statementTotal', 'genericStatementTotal'],
    ['balance', 'balance', 'genericBalance'], ['balance', 'creditLimit', 'genericCreditLimit'], ['statement', 'minimumDue', 'genericMinimumDue']]) {
    test(`${language}/${family}/${name}: a captured amount names the exact financial fact`, () => {
      const item = pending(family, { [name]: field(money('12567', 3)) });
      const h = createWorkflowHarness({ language, state: { reviewTray: { pending: [item] } } });
      const tree = h.renderScreen('review-alerts');
      const row = byId(tree, 'review-alert-row');
      assert.ok(text(row).includes(h.deps['@/lib/i18n'].t(label)));
      assert.ok(text(row).includes('AED 12.567'));
      const informational = family !== 'purchase';
      const review = walk(row).find(node => node.props?.onPress && node.props.accessibilityLabel?.startsWith(
        h.deps['@/lib/i18n'].t(informational ? 'genericReviewDetails' : 'reviewAlertReview') + '.'));
      assert.ok(review);
      assert.ok(review.props.accessibilityLabel.includes(h.deps['@/lib/i18n'].t(label)));
      assert.equal(walk(row).some(node => node.props?.name === 'plus'), false);
      review.props.onPress();
      assert.deepEqual(JSON.parse(JSON.stringify(h.events)), [['route', { pathname: '/add-transaction', params: { reviewId: item.id } }]]);
    });
  }
  test(`${language}: ambiguous amounts do not become an explicit financial fact`, () => {
    const item = pending('purchase', { amount: field(money(), 'ambiguous') });
    const h = createWorkflowHarness({ language, state: { reviewTray: { pending: [item] } } });
    const row = byId(h.renderScreen('review-alerts'), 'review-alert-row');
    assert.ok(text(row).includes(h.deps['@/lib/i18n'].t('genericAmountNeedsReview')));
    assert.ok(!text(row).includes('123.45'));
  });
}

function detailHarness(item, language = 'en') {
  const h = createWorkflowHarness({ language, state: { reviewTray: { pending: [item] } }, params: { reviewId: item.id } });
  const states = []; const refs = []; let stateIndex = 0; let refIndex = 0;
  h.deps.react.useState = initial => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  };
  h.deps.react.useRef = initial => {
    const index = refIndex++;
    return refs[index] ??= { current: initial };
  };
  h.deps['@/lib/review-promotion'] = { reviewTemplateRuleFor: () => null };
  h.deps['@/lib/universal-categorization'] = { suggestUniversalCategory: () => null };
  h.local('@/lib/review-alert-copy', 'src/lib/review-alert-copy.ts');
  h.local('@/components/universal-review-fields');
  const store = h.deps['@/lib/store'].useStore();
  let generation = 0;
  store.getStateGeneration = () => generation;
  store.addTransaction = () => h.events.push(['unexpected-add']);
  store.promoteReviewAlert = () => h.events.push(['unexpected-promote']);
  let routeId = item.id;
  h.deps['expo-router'].useLocalSearchParams = () => ({ reviewId: routeId });
  const render = () => { stateIndex = 0; refIndex = 0; return h.renderScreen('add-transaction'); };
  return { ...h, render, store, setGeneration: value => { generation = value; },
    setRouteId: id => { routeId = id; }, words: h.deps['@/lib/review-alert-copy'].reviewAlertCopy[language] };
}

for (const language of ['en', 'ar']) for (const family of ['statement', 'balance', 'card-payment', 'bill']) {
  test(`${language}/${family}: information can be explicitly dismissed without adding money`, async () => {
    const item = pending(family, { statementTotal: field(money()) });
    const h = detailHarness(item, language);
    const tree = h.render();
    assert.ok(byId(tree, 'informational-review'));
    assert.deepEqual(h.events, []);
    assert.equal(confirmation(tree).props.visible, false);
    action(tree, h.words.dismissAlert).props.onPress();
    assert.deepEqual(h.events, [], 'asking does not dismiss');
    const confirm = confirmation(h.render());
    assert.equal(confirm.props.visible, true);
    assert.equal(confirm.props.destructive, true);
    confirm.props.onClose(); confirm.props.onConfirm(); await flush();
    assert.ok(h.events.some(event => event[0] === 'dismissReviewAlert' && event[1] === item.id && event[2] === 'dismissed'));
    assert.ok(h.events.some(event => event[0] === 'back'));
    assert.ok(!h.events.some(event => event[0].startsWith('unexpected')));
  });
}
test('failed dismissal stays informational and retries the durable write before leaving', async () => {
  const item = pending('statement', { statementTotal: field(money()) });
  const h = detailHarness(item); let rejectWrite; let resolveRetry; let calls = 0;
  h.store.dismissReviewAlert = async (id, outcome) => {
    h.events.push(['dismiss', id, outcome]); calls++;
    h.state.reviewTray = { pending: [] }; // The shipping store dispatches before persistence resolves.
    return new Promise((resolve, reject) => { if (calls === 1) rejectWrite = reject; else resolveRetry = resolve; });
  };
  action(h.render(), h.words.dismissAlert).props.onPress();
  const confirm = confirmation(h.render()); confirm.props.onClose(); confirm.props.onConfirm();
  assert.ok(byId(h.render(), 'informational-review'));
  assert.equal(action(h.render(), h.words.dismissAlert).props.disabled, true);
  assert.ok(!h.events.some(event => event[0] === 'back'));
  rejectWrite(new Error('synthetic persistence failure')); await flush();
  const failed = h.render();
  assert.ok(byId(failed, 'informational-review'));
  assert.ok(walk(failed).some(node => node.props?.accessibilityRole === 'alert'));
  action(failed, h.words.retryDismiss).props.onPress();
  assert.equal(calls, 2);
  assert.ok(!h.events.some(event => event[0] === 'back'));
  resolveRetry(); await flush();
  assert.equal(h.events.filter(event => event[0] === 'back').length, 1);
  assert.ok(!h.events.some(event => event[0].startsWith('unexpected')));
});
test('ordinary posted/uncertain purchases retain the original confirmation flow; declined events cannot be added', () => {
  for (const status of ['posted', 'unknown']) {
    const h = detailHarness(pending('purchase', { status, amount: field(money()) }));
    assert.equal(byId(h.render(), 'informational-review'), undefined);
    assert.deepEqual(h.events, []);
  }
  const h = detailHarness(pending('purchase', { status: 'declined', amount: field(money()) }));
  const tree = h.render();
  assert.ok(byId(tree, 'informational-review'));
  assert.ok(!text(tree).includes(h.deps['@/lib/i18n'].t('genericOpenCards')));
  assert.deepEqual(h.events, []);
});
test('an old informational confirmation cannot dismiss a replacement, expired source or changed route', async () => {
  for (const change of ['replacement', 'expiry', 'missing', 'route', 'generation', 'posting']) {
    const item = pending('statement', { statementTotal: field(money()) });
    const h = detailHarness(item);
    action(h.render(), h.words.dismissAlert).props.onPress();
    const oldConfirmation = confirmation(h.render());
    if (change === 'replacement') h.state.reviewTray.pending = [{ ...item, sourceKey: 'replacement-source', observedAt: item.observedAt + 1 }];
    if (change === 'expiry') item.expiresAt = Date.now() - 1;
    if (change === 'missing') h.state.reviewTray.pending = [];
    if (change === 'route') h.setRouteId('another-source');
    if (change === 'generation') h.setGeneration(1);
    if (change === 'posting') h.state.reviewTray.pending = [{ ...item, event: { ...item.event, family: 'purchase', amount: field(money()) } }];
    const current = h.render();
    assert.ok(byId(current, 'informational-review'), change);
    assert.equal(action(current, h.words.dismissAlert).props.disabled, true, change);
    assert.equal(confirmation(current).props.visible, false, change);
    assert.ok(text(current).includes(h.deps['@/lib/i18n'].t('genericSourceChanged')), change);
    // Invoke even the stale handler to verify the mutation boundary, not just disabled UI.
    oldConfirmation.props.onConfirm(); await flush();
    assert.ok(!h.events.some(event => event[0] === 'dismissReviewAlert' || event[0].startsWith('unexpected')), change);
  }
});
test('failed informational dismissal cannot reuse consent for a replacement or expired source', async () => {
  for (const change of ['replacement', 'expiry', 'generation']) {
    const item = pending('statement', { statementTotal: field(money()) });
    const h = detailHarness(item); let attempts = 0;
    h.store.dismissReviewAlert = async () => {
      attempts++; h.state.reviewTray.pending = [];
      throw new Error('synthetic persistence failure');
    };
    action(h.render(), h.words.dismissAlert).props.onPress();
    const confirm = confirmation(h.render()); confirm.props.onClose(); confirm.props.onConfirm(); await flush();
    const retry = action(h.render(), h.words.retryDismiss);
    if (change === 'replacement') h.state.reviewTray.pending = [{ ...item, sourceKey: 'replacement-source', observedAt: item.observedAt + 1 }];
    if (change === 'expiry') item.expiresAt = Date.now() - 1;
    if (change === 'generation') h.setGeneration(1);
    const current = h.render();
    assert.ok(byId(current, 'informational-review'));
    assert.equal(action(current, h.words.retryDismiss).props.disabled, true, change);
    retry.props.onPress(); await flush();
    assert.equal(attempts, 1, change);
    assert.ok(!h.events.some(event => event[0] === 'back' || event[0].startsWith('unexpected')), change);
  }
});
