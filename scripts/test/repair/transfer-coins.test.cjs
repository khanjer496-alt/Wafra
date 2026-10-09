'use strict';
// Coins that explain money moving: a coin travelling a transfer's route on the
// Transfers page, and a coin dropped into Save when an expense is saved. Both
// are decoration beside written figures: present, hidden from assistive tech,
// and never a change to what is spoken. Synthetic rows only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createWorkflowHarness, walk } = require('../workflows/workflow-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);
const flat = style => Object.assign({}, ...[].concat(style).flat(Infinity).filter(s => s && typeof s === 'object'));
const cues = load(path.join(root, 'src/components/transfer-coins/coin-cues.ts'), {});
const hidden = node => node.props.importantForAccessibility === 'no-hide-descendants' && node.props.accessibilityElementsHidden === true;

// ---- When a route's coin travels ----

const item = (key, tag, extra = {}) => ({ key, transactionId: key.split('|')[0], tag, linked: key.includes('|'), ...extra });

test('only the first rows travel when the list appears, staggered', () => {
  const intro = cues.introCues(['a', 'b', 'c', 'd', 'e'], 1000);
  assert.deepEqual([...intro.keys()], ['a', 'b', 'c'], 'a long history does not set every row moving');
  assert.deepEqual([...intro.values()].map(cue => cue.delay), [cues.INTRO_START, cues.INTRO_START + cues.INTRO_ROW_GAP, cues.INTRO_START + 2 * cues.INTRO_ROW_GAP]);
  assert.ok([...intro.values()].every(cue => cue.at === 1000));
});

test('a route travels again the moment its question is answered, own account or someone else', () => {
  const before = cues.legTags([item('q', 'needs-answer'), item('c', 'unconfirmed'), item('x', 'external')]);
  // Answering own links the two legs into one route under a new key.
  assert.deepEqual(cues.newlyAnsweredRoutes(before, [item('q|c', 'own'), item('x', 'external')]), ['q|c']);
  // A single leg answered own keeps its key.
  assert.deepEqual(cues.newlyAnsweredRoutes(before, [item('q', 'own')]), ['q']);
  // Paid someone else is an answer too: the coin travels to the "Someone else" the "?" became.
  assert.deepEqual(cues.newlyAnsweredRoutes(before, [item('q', 'external')]), ['q']);
  // Undo back to a question, a route first seen already answered, or swapping one answer for
  // the other: no coin.
  assert.deepEqual(cues.newlyAnsweredRoutes(cues.legTags([item('q|c', 'own')]), [item('q', 'needs-answer')]), []);
  assert.deepEqual(cues.newlyAnsweredRoutes(before, [item('new|other', 'own')]), [], 'a period change brings it in already own');
  assert.deepEqual(cues.newlyAnsweredRoutes(cues.legTags([item('q|c', 'own')]), [item('q|c', 'own')]), []);
  assert.deepEqual(cues.newlyAnsweredRoutes(before, [item('x', 'own')]), [], 'someone else changed to own is not a new answer');
});

test('a cue is played only while fresh, so a row scrolled back into view stays still', () => {
  const cue = { at: 10_000, delay: 240 };
  assert.equal(cues.cueIsFresh(cue, 10_000), true);
  assert.equal(cues.cueIsFresh(cue, 10_000 + cues.CUE_FRESH_MS + 240), true);
  assert.equal(cues.cueIsFresh(cue, 10_000 + cues.CUE_FRESH_MS + 241), false);
});

// ---- The route row draws the coin ----

function transfersHarness(options = {}) {
  const h = createWorkflowHarness({ language: options.language ?? 'en', largeText: options.largeText });
  h.local('@/lib/transfer-activity-copy', 'src/lib/transfer-activity-copy.ts');
  h.local('@/components/transfer-coins/coin-cues', 'src/components/transfer-coins/coin-cues.ts');
  h.local('@/components/transfer-coins/route-coin');
  h.local('@/components/transfers/transfer-route-row');
  return h;
}
const routeItem = { key: 'out|in', transactionId: 'out', date: '2026-10-03', ts: 1, amountFils: 250000, direction: 'between',
  from: { kind: 'account', accountId: 'current' }, to: { kind: 'account', accountId: 'savings' }, tag: 'own', linked: true };
const routeRow = (h, extra = {}) => h.deps['@/components/transfers/transfer-route-row'].TransferRouteRow({ item: routeItem,
  accountLabel: id => (id === 'current' ? 'Current' : 'Savings'), palette: h.deps['@/hooks/use-band'].useBand('accounts'),
  onPress() {}, first: true, ...extra });

for (const language of ['en', 'ar']) {
  test(`${language}: the route line carries a gold coin hidden from assistive tech, and the row says the same`, () => {
    const h = transfersHarness({ language });
    h.deps['react-native'].Animated.multiply = (progress, distance) => ({ progress, distance });
    h.deps['react-native'].Animated.add = (origin, run) => ({ origin, ...run });
    const still = routeRow(h);
    const moving = routeRow(h, { coin: { at: Date.now(), delay: 0 } });
    const lane = byId(moving, 'transfer-lane-out|in');
    assert.ok(lane, 'the route has its line');
    assert.ok(hidden(lane), 'the line and its coin are hidden from VoiceOver and TalkBack');
    assert.equal(typeof lane.props.onLayout, 'function', 'the coin travels the measured line');
    const coin = byId(moving, 'transfer-lane-out|in-coin');
    assert.ok(coin, 'the coin is drawn on the line');
    assert.ok(walk(coin).some(node => node.props?.style && flat(node.props.style).borderRadius === 6), 'a 12pt face-on coin');
    const along = flat(coin.props.style).transform.find(step => 'translateX' in step).translateX;
    lane.props.onLayout({ nativeEvent: { layout: { width: 36, height: 20 } } });
    // The coin sets off over the source chip, 20pt before the line, and crosses the measured
    // line less the coin and on into the destination: right in English, left in mirrored Arabic.
    const dir = language === 'ar' ? -1 : 1;
    assert.equal(along.origin.value, -20 * dir);
    assert.equal(along.distance.value, (24 + 32) * dir);
    assert.equal(byId(moving, 'transfer-row-out|in').props.accessibilityLabel, byId(still, 'transfer-row-out|in').props.accessibilityLabel,
      'the spoken route, amount and tag do not change');
    assert.match(byId(moving, 'transfer-row-out|in').props.accessibilityLabel, /Current.*Savings/);
  });
}

test('at large text the route reads downward and so does the coin', () => {
  const h = transfersHarness({ largeText: true });
  const tree = routeRow(h, { coin: { at: Date.now(), delay: 0 } });
  const coin = byId(tree, 'transfer-lane-out|in-coin');
  assert.ok(flat(coin.props.style).transform.some(step => 'translateY' in step));
  assert.notEqual(flat(byId(tree, 'transfer-lane-out|in').props.style).flexDirection, 'row', 'the line runs down');
});

test('a coin at rest is at its destination, not mid-route (Reduce Motion never moves it)', () => {
  const h = transfersHarness();
  const coin = byId(routeRow(h), 'transfer-lane-out|in-coin');
  // The harness's core Animated holds a value's initial state: 1 is "arrived", where the coin is faded out.
  assert.equal(flat(coin.props.style).opacity.value, 1);
});

test('the Transfers list hands each row its cue and re-renders rows when cues change', () => {
  const h = createWorkflowHarness({ language: 'en', state: { transactions: [
    { id: 'pay', type: 'expense', accountId: 'current', amountFils: 8500, date: '2026-09-10', ts: Date.now(), title: 'Transfer',
      category: 'transfer', source: 'sms', transferEvidence: { version: 1, currency: 'AED', attribution: 'source' } }],
  accounts: [{ id: 'current', name: 'Current account', type: 'bank' }] } });
  h.deps['react-native'].Keyboard = { dismiss() {} };
  h.local('@/lib/transfer-list', 'src/lib/transfer-list.ts');
  h.local('@/lib/transfer-answer', 'src/lib/transfer-answer.ts');
  h.local('@/lib/transfer-pairs', 'src/lib/transfer-pairs.ts');
  h.local('@/components/transfer-coins/coin-cues', 'src/components/transfer-coins/coin-cues.ts');
  h.local('@/components/transfer-coins/route-coin');
  for (const name of ['transfer-answer-choices', 'transfer-route-row', 'transfer-question-card']) h.local(`@/components/transfers/${name}`);
  h.deps['@/hooks/use-transfer-answer'] = { useTransferAnswer: () => ({ busy: false, answer: async () => 'saved' }) };
  const reconciliation = { groups: [], pendingIds: new Set(), internalIds: new Set(),
    byId: new Map([['pay', { id: 'pay', status: 'confirmed-external', reason: 'user', candidateIds: [] }]]) };
  h.deps['@/lib/transfer-reconciliation'] = { ...h.deps['@/lib/transfer-reconciliation'], reconcileTransfers: () => reconciliation };
  h.deps['@/lib/ledger'] = { ...h.deps['@/lib/ledger'], transferReconciliationForState: () => reconciliation };
  const tree = h.renderScreen('transfers');
  const list = byId(tree, 'transfer-history');
  assert.ok(list.props.extraData.coins instanceof Map, 'the cues are part of the list\'s extra data');
  const lane = byId(tree, 'transfer-lane-pay');
  assert.ok(lane && hidden(lane), 'every route row draws its line, hidden from assistive tech');
});

// ---- A saved expense drops a coin into Save ----

const field = value => ({ value, evidence: value === null ? 'missing' : 'explicit', alternatives: [], spans: [], issues: [] });
/** A captured card purchase waiting in Review (the same synthetic shape as the Apple Pay review suite). */
const reviewItem = () => ({ id: 'coin_review_id_' + 'a'.repeat(32), sourceKey: 'coin_review_source_' + 'a'.repeat(32),
  kind: 'universal', observedAt: Date.now() - 1000, expiresAt: Date.now() + 86400000, channel: 'push', parserVersion: 1,
  event: { version: 1, decision: 'review', family: 'purchase', status: 'unknown', direction: 'debit',
    amount: field({ currency: 'AED', minorUnits: '2500', exponent: 2 }), merchant: field('Synthetic Cafe'),
    instrument: field(null), transactionDate: field(null), statementDate: field(null), dueDate: field(null),
    statementTotal: field(null), minimumDue: field(null), balance: field(null), creditLimit: field(null), observations: [], issues: [] } });

function addHarness({ reduced = false, review = null } = {}) {
  const item = review ? reviewItem() : null;
  const h = createWorkflowHarness({ language: 'en', params: item ? { reviewId: item.id } : undefined, state: item
    ? { reviewTray: { pending: [item], tombstones: [], templateRules: [] },
      accounts: [{ id: 'card1', name: 'Test Card', kind: 'card', last4: '1234', openingFils: 0, color: '#000' }] }
    : { ledgerMoney: { schemaVersion: 2, currency: 'USD', exponent: 2 }, reviewTray: { pending: [], tombstones: [], templateRules: [] },
      accounts: [{ id: 'cash', name: 'Cash', kind: 'cash', openingFils: 0, color: '#997349' }] } });
  if (item) h.deps['expo-router'].useLocalSearchParams = () => ({ reviewId: item.id });
  const states = [], refs = []; let stateIndex = 0, refIndex = 0;
  h.deps.react.useState = initial => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  };
  h.deps.react.useRef = initial => refs[refIndex++] ??= { current: initial };
  h.deps['@/lib/haptics'].committed = () => {};
  h.deps['@/lib/review-promotion'] = { reviewTemplateRuleFor: () => null };
  h.deps['@/lib/universal-categorization'] = { suggestUniversalCategory: () => null };
  h.deps['@/hooks/use-reduced-motion'] = { useReducedMotion: () => reduced,
    useMotionPreference: () => ({ ready: true, reducedMotion: reduced }) };
  h.local('@/lib/review-alert-copy', 'src/lib/review-alert-copy.ts');
  h.local('@/components/universal-review-fields');
  // A new entry has no preselected category; save() picks one through the picker boundary.
  h.deps['@/components/ui/category-chips'] = { CategoryChips: 'CategoryChips' };
  h.deps['react-native'].Animated.timing = (value, config) => {
    h.events.push(['coin', value.value, config.toValue, config.useNativeDriver, config.duration]);
    return { start() { h.events.push(['coin-start']); }, stop() {} };
  };
  const store = h.deps['@/lib/store'].useStore();
  store.getStateGeneration = () => 0;
  store.getStateSnapshot = () => h.state;
  store.addTransaction = input => h.events.push(['add', input]);
  // Review saves through promotion: 'saved' resolves, 'refused' rejects as the ledger would.
  store.promoteReviewAlert = async input => {
    if (review === 'refused') throw new Error('not saved');
    h.events.push(['add', input]);
  };
  const render = () => { stateIndex = 0; refIndex = 0; return h.renderScreen('add-transaction'); };
  const type = label => walk(render()).find(node => node.props?.accessibilityRole === 'tab'
    && node.props.accessibilityLabel === label && node.props.onPress).props.onPress();
  const save = () => {
    const tree = render();
    for (const key of ['4', '2']) walk(tree).find(node => node.type === 'AmountKeypad').props.onKey(key);
    const chips = () => walk(render()).find(node => node.type === 'CategoryChips');
    if (!chips()) byId(render(), 'category-picker-trigger').props.onPress();
    if (chips().props.selected == null) chips().props.onToggle('groceries');
    walk(render()).find(node => node.props?.onPress && node.props.accessibilityLabel === h.deps['@/lib/i18n'].t('saveTransaction')).props.onPress();
  };
  const confirmReview = async () => {
    byId(render(), 'account-picker-trigger').props.onPress();
    walk(render()).find(node => node.props?.onPress && node.props.accessibilityLabel?.includes('Test Card')
      && node.props.testID !== 'account-picker-trigger').props.onPress();
    walk(render()).find(node => node.props?.onPress
      && node.props.accessibilityLabel === h.deps['@/lib/i18n'].t('genericConfirmAdd')).props.onPress();
    await new Promise(resolve => setImmediate(resolve));
  };
  return { ...h, render, save, type, confirmReview };
}
const kinds = h => h.events.map(event => event[0]).filter(kind => ['add', 'coin', 'coin-start', 'back'].includes(kind));

test('saving an expense drops the coin after the ledger takes it, without holding the sheet open', () => {
  const h = addHarness();
  const coin = byId(h.render(), 'add-save-coin');
  assert.ok(coin, 'the coin sits with the Save button');
  assert.ok(hidden(coin), 'hidden from assistive tech');
  assert.equal(flat(coin.props.style).pointerEvents, 'none', 'it never takes the Save press');
  assert.ok(walk(coin).some(node => node.props?.style && flat(node.props.style).borderRadius === 8), 'a 16pt face-on coin');
  const button = byId(h.render(), 'add-save');
  assert.equal(button.props.accessibilityLabel, h.deps['@/lib/i18n'].t('saveTransaction'), 'Save is still spoken as Save');
  h.save();
  assert.deepEqual(kinds(h), ['add', 'coin', 'coin-start', 'back'], 'saved, then the drop starts, then the sheet closes at once');
  const drop = h.events.find(event => event[0] === 'coin');
  assert.deepEqual(drop.slice(1), [0, 1, true, 360], 'from the top, on the native driver, under 400ms');
});

test('a reviewed purchase drops the coin only once promotion has saved it', async () => {
  const saved = addHarness({ review: 'saved' });
  await saved.confirmReview();
  assert.deepEqual(kinds(saved), ['add', 'coin', 'coin-start', 'back']);
  const refused = addHarness({ review: 'refused' });
  await refused.confirmReview();
  assert.deepEqual(kinds(refused), [], 'a refused save never drops a coin and keeps the sheet open');
});

test('no coin for income or under Reduce Motion', () => {
  const income = addHarness();
  income.type('Income');
  income.save();
  assert.deepEqual(kinds(income), ['add', 'back']);
  const reduced = addHarness({ reduced: true });
  reduced.save();
  assert.deepEqual(kinds(reduced), ['add', 'back']);
});
