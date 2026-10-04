'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');
const byId = (tree, id) => walk(tree).find(n => n.props?.testID === id);

// The harness's jsx renders function components eagerly, so calling a component
// returns a tree that walk/text can read (the same way renderScreen works).
function harness(language) {
  const h = createWorkflowHarness({ language });
  h.local('@/lib/transfer-activity-copy', 'src/lib/transfer-activity-copy.ts');
  h.local('@/components/transfers/transfer-answer-choices');
  h.local('@/components/transfers/transfer-route-row');
  h.local('@/components/transfers/transfer-question-card');
  return h;
}
const palette = h => h.deps['@/hooks/use-band'].useBand('accounts');

for (const language of ['en', 'ar']) {
  test(`${language}: answer choices word the question by direction and report the choice`, () => {
    const h = harness(language);
    const { TransferAnswerChoices } = h.deps['@/components/transfers/transfer-answer-choices'];
    const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy(language).answers;
    let picked = null;
    const tree = TransferAnswerChoices({ incoming: true, value: null, layout: 'radios',
      onChange: v => { picked = v; }, palette: palette(h) });
    assert.ok(text(tree).includes(words.in.own));
    assert.ok(text(tree).includes(words.effect.own(true)));
    byId(tree, 'transfer-answer-external').props.onPress();
    assert.equal(picked, 'external');
    assert.equal(byId(tree, 'transfer-answer-own').props.accessibilityState.checked, false);
  });
}

test('route row reads From → To with the tag', () => {
  const h = harness('en');
  const { TransferRouteRow } = h.deps['@/components/transfers/transfer-route-row'];
  const item = { key: 'p', transactionId: 'p', date: '2026-10-03', ts: 1, amountFils: 85000, direction: 'out',
    from: { kind: 'account', accountId: 'adcb' }, to: { kind: 'party', name: 'Ahmed K.' }, tag: 'external', linked: false };
  const tree = TransferRouteRow({ item, accountLabel: () => 'ADCB', palette: palette(h), onPress() {}, first: true });
  assert.match(byId(tree, 'transfer-row-p').props.accessibilityLabel, /ADCB.*Ahmed K\./);
  assert.ok(text(tree).includes('Someone else · counted'));
});

test('question card asks by direction, shows its step and hides See all for one item', () => {
  const h = harness('en');
  const { TransferQuestionCard } = h.deps['@/components/transfers/transfer-question-card'];
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  const transaction = { id: 'q', type: 'expense', amountFils: 500000, date: '2026-10-02', accountId: 'fab', title: 'Transfer', category: 'other' };
  const answers = [];
  const one = TransferQuestionCard({ transaction, index: 0, total: 1, accountLabel: 'FAB', palette: palette(h), busy: false,
    onAnswer: a => answers.push(a), onSeeAll() {} });
  assert.ok(text(one).includes(words.card.whereOut));
  assert.equal(byId(one, 'transfer-question-see-all'), undefined);
  byId(one, 'transfer-answer-none').props.onPress();
  assert.deepEqual(answers, ['none']);
  const two = TransferQuestionCard({ transaction, index: 0, total: 2, accountLabel: 'FAB', palette: palette(h), busy: false,
    onAnswer() {}, onSeeAll() {} });
  assert.ok(text(two).includes(words.card.step(1, 2)));
  assert.ok(byId(two, 'transfer-question-see-all'));
});

// ---- Fix round 1 ----
const baseItem = { key: 'p', transactionId: 'p', date: '2026-10-03', ts: 1, amountFils: 85000, direction: 'out',
  from: { kind: 'account', accountId: 'adcb' }, to: { kind: 'party', name: 'Ahmed K.' }, tag: 'external', linked: false };
const row = (h, item, extra = {}) => h.deps['@/components/transfers/transfer-route-row'].TransferRouteRow(
  { item: { ...baseItem, ...item }, accountLabel: () => 'ADCB', palette: palette(h), onPress() {}, first: true, ...extra });
const flat = style => Object.assign({}, ...[].concat(style).flat(Infinity).filter(s => s && typeof s === 'object'));

for (const language of ['en', 'ar']) {
  test(`${language}: route row label carries direction and amount, without doubled periods`, () => {
    const h = harness(language);
    const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy(language);
    const label = byId(row(h, {}), 'transfer-row-p').props.accessibilityLabel;
    assert.ok(label.includes(words.outgoing), label);
    assert.ok(label.includes('850'), label);
    assert.ok(!label.includes('..'), label);
    const incoming = byId(row(h, { direction: 'in' }), 'transfer-row-p').props.accessibilityLabel;
    assert.ok(incoming.includes(words.incoming), incoming);
    const between = byId(row(h, { direction: 'between', tag: 'own' }), 'transfer-row-p').props.accessibilityLabel;
    assert.ok(between.includes(words.own), between);
  });
}

test('large text stacks the route row and lets names wrap', () => {
  const h = createWorkflowHarness({ language: 'en', largeText: true });
  h.local('@/lib/transfer-activity-copy', 'src/lib/transfer-activity-copy.ts');
  h.local('@/components/transfers/transfer-route-row');
  const tree = row(h, {});
  const route = byId(tree, 'transfer-route-p');
  assert.equal(flat(route.props.style).flexDirection, 'column');
  assert.equal(flat(route.props.style).alignItems, 'flex-start');
  const names = walk(tree).filter(n => n.props?.numberOfLines === 1);
  assert.equal(names.length, 0, 'names wrap instead of truncating');
  assert.equal(flat(byId(tree, 'transfer-route-p').props.style).flexDirection, 'column');
  const normal = row(harness('en'), {});
  assert.equal(flat(byId(normal, 'transfer-route-p').props.style).flexDirection, 'row');
});

test('an unknown end shows a dashed "?" and is still named in the label', () => {
  const h = harness('en');
  const tree = row(h, { direction: 'in', from: { kind: 'unknown' }, to: { kind: 'account', accountId: 'adcb' }, tag: 'needs-answer' });
  assert.ok(text(tree).includes('?'));
  assert.ok(!text(tree).includes('Unknown'));
  assert.ok(byId(tree, 'transfer-row-p').props.accessibilityLabel.includes('Unknown'));
});

test('unanswered rows are signed by direction; own rows stay unsigned', () => {
  const h = harness('en');
  assert.ok(text(row(h, { tag: 'needs-answer' })).includes('−'));
  assert.ok(text(row(h, { tag: 'unconfirmed', direction: 'in', from: { kind: 'unknown' }, to: { kind: 'account', accountId: 'adcb' } })).includes('+'));
  const own = text(row(h, { tag: 'own', direction: 'between', to: { kind: 'account', accountId: 'adcb' } }));
  assert.ok(!own.includes('−') && !own.includes('+'));
});

test('route row skips empty initials and keeps surrogate pairs whole', () => {
  const h = harness('en');
  const tree = row(h, { to: { kind: 'party', name: '😀 Zed' } }, { accountLabel: () => '' });
  assert.ok(text(tree).includes('😀Z'));
});

test('answer choices mark the matching answer checked and disable when busy', () => {
  const h = harness('en');
  const { TransferAnswerChoices } = h.deps['@/components/transfers/transfer-answer-choices'];
  for (const layout of ['buttons', 'radios']) {
    const tree = TransferAnswerChoices({ incoming: false, value: 'external', layout, onChange() {}, palette: palette(h) });
    assert.equal(byId(tree, 'transfer-answer-external').props.accessibilityState.checked, true);
    assert.equal(byId(tree, 'transfer-answer-own').props.accessibilityState.checked, false);
  }
  const { TransferQuestionCard } = h.deps['@/components/transfers/transfer-question-card'];
  const transaction = { id: 'q', type: 'expense', amountFils: 500000, date: '2026-10-02', accountId: 'fab', title: 'Transfer', category: 'other' };
  const busy = TransferQuestionCard({ transaction, index: 0, total: 1, accountLabel: 'FAB', palette: palette(h), busy: true, onAnswer() {}, onSeeAll() {} });
  for (const answer of ['own', 'external', 'none']) assert.equal(byId(busy, `transfer-answer-${answer}`).props.disabled, true);
});

test('secondary answer buttons are visibly bordered', () => {
  const h = harness('en');
  const { TransferAnswerChoices } = h.deps['@/components/transfers/transfer-answer-choices'];
  const tree = TransferAnswerChoices({ incoming: false, value: null, layout: 'buttons', onChange() {}, palette: palette(h) });
  const style = flat(byId(tree, 'transfer-answer-external').props.style({ pressed: false }));
  assert.ok(style.borderWidth >= 1 && style.borderColor);
});

test('question card stacks its question and amount at large text', () => {
  const h = createWorkflowHarness({ language: 'en', largeText: true });
  h.local('@/lib/transfer-activity-copy', 'src/lib/transfer-activity-copy.ts');
  h.local('@/components/transfers/transfer-answer-choices');
  h.local('@/components/transfers/transfer-question-card');
  const transaction = { id: 'q', type: 'expense', amountFils: 500000, date: '2026-10-02', accountId: 'fab', title: 'Transfer', category: 'other' };
  const tree = h.deps['@/components/transfers/transfer-question-card'].TransferQuestionCard(
    { transaction, index: 0, total: 1, accountLabel: 'FAB', palette: palette(h), busy: false, onAnswer() {}, onSeeAll() {} });
  assert.equal(flat(byId(tree, 'transfer-question-what').props.style).flexDirection, 'column');
});
