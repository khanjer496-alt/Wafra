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
  test(`${language}: a full Review explains waiting native alerts and clears when there is room`, () => {
    const backlog = require('../build/alert-review-tray.js').reviewCaptureBacklog;
    backlog.reset();
    backlog.publish({ waiting: 7, currencyConflicts: 2 });
    try {
      const full = Array.from({ length: 50 }, (_, index) => ({ ...pending('purchase'),
        id: 'synthetic-full-' + index, sourceKey: 'synthetic-full-source-' + index }));
      const h = createWorkflowHarness({ language, state: { reviewTray: { pending: full, tombstones: [] } } });
      const tf = h.deps['@/lib/i18n'].tf;
      const tree = h.renderScreen('review-alerts');
      assert.ok(text(byId(tree, 'review-alerts-full')).includes(tf('reviewAlertsFullWaiting', { count: 7 })));
      assert.ok(text(byId(tree, 'review-alerts-currency')).includes(tf('reviewAlertsCurrencySkipped', { count: 2 })));
      assert.ok(byId(tree, 'review-alerts-intro'));
      const roomy = createWorkflowHarness({ language, state: { reviewTray: { pending: full.slice(1), tombstones: [] } } });
      assert.equal(byId(roomy.renderScreen('review-alerts'), 'review-alerts-full'), undefined);
    } finally {
      backlog.reset();
    }
  });
  test(`${language}: expiring rows count down and expired reviews stay visible`, () => {
    const soon = { ...pending('purchase'), expiresAt: Date.now() + 2 * 86400000 - 1000 };
    const later = { ...pending('balance'), expiresAt: Date.now() + 20 * 86400000 };
    const expiredAt = Date.now() - 86400000;
    const h = createWorkflowHarness({ language, state: { reviewTray: { pending: [soon, later], tombstones: [
      { sourceKey: 'synthetic-expired', resolvedAt: expiredAt, expiresAt: expiredAt + 90 * 86400000, outcome: 'expired' },
    ] } } });
    const tf = h.deps['@/lib/i18n'].tf;
    const tree = h.renderScreen('review-alerts');
    const expiries = walk(tree).filter(node => node.props?.testID === 'review-alert-expiry');
    assert.equal(expiries.length, 1);
    assert.ok(text(expiries[0]).includes(tf('reviewAlertExpiresIn', { count: 2 })));
    assert.ok(text(byId(tree, 'review-alerts-expired')).includes(tf('reviewAlertsExpiredCount', { count: 1 })));
    const empty = createWorkflowHarness({ language, state: { reviewTray: { pending: [], tombstones: [
      { sourceKey: 'synthetic-expired', resolvedAt: expiredAt, expiresAt: expiredAt + 90 * 86400000, outcome: 'expired' },
    ] } } }).renderScreen('review-alerts');
    assert.ok(byId(empty, 'review-alerts-expired'));
    assert.equal(byId(empty, 'review-alerts-intro'), undefined);
  });
  test(`${language}: alerts Review could not keep stay visible as counts`, () => {
    const at = Date.now() - 3600000;
    const tombstone = (key, outcome) => ({ sourceKey: key, resolvedAt: at, expiresAt: at + 90 * 86400000, outcome });
    const h = createWorkflowHarness({ language, state: { reviewTray: { pending: [], tombstones: [
      tombstone('synthetic-evicted-1', 'evicted'), tombstone('synthetic-evicted-2', 'evicted'),
      tombstone('synthetic-foreign-1', 'currency-evicted'),
      tombstone('synthetic-dismissed', 'dismissed'),
    ] } } });
    const tf = h.deps['@/lib/i18n'].tf;
    const tree = h.renderScreen('review-alerts');
    assert.ok(text(byId(tree, 'review-alerts-evicted')).includes(tf('reviewAlertsEvictedCount', { count: 2 })));
    assert.ok(text(byId(tree, 'review-alerts-currency-evicted')).includes(tf('reviewAlertsCurrencyEvictedCount', { count: 1 })));
    assert.notEqual(tf('reviewAlertsEvictedCount', { count: 2 }), 'reviewAlertsEvictedCount');
    const quiet = createWorkflowHarness({ language, state: { reviewTray: { pending: [], tombstones: [
      tombstone('synthetic-dismissed', 'dismissed'),
    ] } } }).renderScreen('review-alerts');
    assert.equal(byId(quiet, 'review-alerts-evicted'), undefined);
    assert.equal(byId(quiet, 'review-alerts-currency-evicted'), undefined);
  });
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
test('a balance-like amount alternative is removed so a normal payment needs no fake choice', () => {
  const payment = money('3762');
  const balance = money('1799724');
  const item = pending('purchase', {
    amount: { value: null, evidence: 'ambiguous', alternatives: [payment, balance] },
    balance: field(balance),
    instrument: field({ kind: 'account', last4: '4821' }),
  });
  const h = detailHarness(item);
  const tree = h.render();
  const rendered = text(tree);
  assert.ok(rendered.includes('AED 37.62'));
  assert.ok(!rendered.includes('AED 17997.24'));
  assert.ok(!rendered.includes(h.deps['@/lib/i18n'].t('genericConfirmPosted')));
  assert.equal(walk(tree).filter(node => node.props?.accessibilityRole === 'radio').length, 0,
    'known direction/date/account facts do not become review questions');
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

// Redesign: every card says why it is waiting, a named merchant gets its logo
// tile, and an optional one-at-a-time mode answers with the list's own actions.
// Review state slots: 0 target, 1 busy id, 2 one-at-a-time, 3 step index.
for (const language of ['en', 'ar']) {
  test(`${language}: every Review card carries one reason sentence from structured fields`, () => {
    const named = pending('purchase', { amount: field(money()) });
    const unnamed = pending('purchase', { amount: field(money()), merchant: field('Maybe shop', 'ambiguous') });
    unnamed.id = 'synthetic-unnamed'; unnamed.sourceKey = 'synthetic-source-unnamed';
    const h = createWorkflowHarness({ language, state: { reviewTray: { pending: [named, unnamed] } } });
    const words = h.deps['@/lib/details-copy'].detailsCopy[language].review.why;
    const rows = walk(h.renderScreen('review-alerts')).filter(node => node.props?.testID === 'review-alert-row');
    assert.equal(rows.length, 2);
    assert.ok(text(rows[0]).includes(words.confirm));
    assert.ok(text(rows[1]).includes(words['merchant-unsure']));
    // The alert-stated merchant heads the card; an unsure one is never shown as a name.
    assert.ok(text(rows[0]).includes('Synthetic shop'));
    assert.ok(!text(rows[1]).includes('Maybe shop'));
  });
  test(`${language}: one at a time shows "1 of N" and answers through the existing Add and Dismiss paths`, () => {
    const purchase = pending('purchase', { amount: field(money()) });
    const balance = pending('balance', { balance: field(money('99900')) });
    const list = createWorkflowHarness({ language, state: { reviewTray: { pending: [purchase, balance] } } });
    const words = list.deps['@/lib/details-copy'].detailsCopy[language].review;
    const listTree = list.renderScreen('review-alerts');
    assert.ok(byId(listTree, 'review-mode-toggle'), 'the mode is offered when more than one item waits');
    assert.equal(byId(listTree, 'review-stepper'), undefined, 'the list stays the default');
    const h = createWorkflowHarness({ language, state: { reviewTray: { pending: [purchase, balance] } }, states: { 2: true } });
    const tree = h.renderScreen('review-alerts');
    assert.ok(text(byId(tree, 'review-step-position')).includes(words.position(1, 2)));
    assert.equal(walk(tree).filter(node => node.props?.testID === 'review-step-card').length, 1);
    assert.equal(walk(tree).filter(node => node.props?.testID === 'review-alert-row').length, 0);
    const card = byId(tree, 'review-step-card');
    assert.ok(text(card).includes('AED 123.45'), 'the amount is the alert\'s own, not converted');
    assert.ok(text(card).includes(words.notPurchase));
    byId(card, 'review-step-dismiss').props.onPress();
    byId(card, 'review-alert-open').props.onPress();
    const events = JSON.parse(JSON.stringify(h.events));
    assert.deepEqual(events.filter(event => event[0] !== 'state'), [['route', { pathname: '/add-transaction', params: { reviewId: purchase.id } }]],
      'nothing is added or dismissed from the card itself');
    assert.ok(events.some(event => event[0] === 'state' && event[1] === 0 && event[2]?.id === purchase.id),
      '"Not a purchase" opens the same dismissal confirmation as the list');
    const second = createWorkflowHarness({ language, state: { reviewTray: { pending: [purchase, balance] } }, states: { 2: true, 3: 1 } });
    const secondCard = byId(second.renderScreen('review-alerts'), 'review-step-card');
    assert.ok(!text(secondCard).includes(words.notPurchase), 'a balance update is dismissed, not called "not a purchase"');
    assert.ok(text(secondCard).includes(h.deps['@/lib/details-copy'].detailsCopy[language].review.why['not-a-payment']));
  });
}
