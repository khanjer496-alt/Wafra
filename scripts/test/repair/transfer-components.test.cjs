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
