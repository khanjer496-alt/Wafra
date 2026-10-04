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

// Entry detail sheet: "What is this?" for a transfer candidate.
// entry-detail-sheet.tsx useState order: 10 ruleAsk, 12 categoryPicking, 14 picking (the account picker).
const PICKER = 14;
function detail(options = {}) {
  const h = createWorkflowHarness({ language: options.language ?? 'en', largeText: options.largeText,
    states: options.states, answerResult: options.answerResult, answerBusy: options.answerBusy });
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy(options.language ?? 'en');
  const candidate = (id, accountId, date) => ({ id, title: 'Outgoing transfer', type: 'expense', category: 'other', accountId,
    amountFils: 85000, date, source: 'sms', transferEvidence: { version: 1, currency: 'AED', attribution: 'fallback' } });
  const subject = candidate('subject', 'enbd', '2026-09-05');
  const left = { ...candidate('left', 'adcb', '2026-09-05'), type: 'income' };
  const right = { ...candidate('right', 'credit', '2026-09-06'), type: 'income' };
  h.state.transactions.push(subject, left, right);
  const assessment = { status: 'ownership-unknown', candidateIds: ['left', 'right'] };
  return { h, words, subject, left, right, assessment };
}
const answers = h => h.events.filter(e => e[0] === 'answer').map(e => e[1]);
const settle = () => new Promise(resolve => setImmediate(resolve));
const closes = h => h.events.filter(e => e[0] === 'close').length;

test('detail sheet: choosing own with several candidates opens the account picker, not a save', () => {
  const { h, subject, assessment } = detail();
  const tree = h.renderDetail(subject, { transferAssessment: assessment });
  byId(tree, 'transfer-answer-own').props.onPress();
  assert.deepEqual(h.events.filter(e => e[0] === 'state'), [['state', PICKER, true]]);
  assert.deepEqual(answers(h), []);
});

test('detail sheet: the account picker lists each candidate with account and date, and a way to skip', async () => {
  const { h, words, subject, left, assessment } = detail({ states: { [PICKER]: true } });
  const tree = h.renderDetail(subject, { transferAssessment: assessment });
  assert.ok(text(tree).includes(words.answers.whichAccount));
  assert.equal(byId(tree, 'transfer-answer-own'), undefined, 'the three answers give way to the picker');
  const pick = byId(tree, 'entry-transfer-candidate-left');
  assert.equal(pick.props.accessibilityRole, 'button');
  assert.match(pick.props.accessibilityLabel, /ADCB/);
  assert.match(pick.props.accessibilityLabel, /Sep/);
  assert.ok(flat(pick.props.style).minHeight >= 48);
  const none = byId(tree, 'entry-transfer-candidate-none');
  assert.equal(none.props.accessibilityRole, 'button');
  assert.ok(flat(none.props.style).minHeight >= 48);
  assert.ok(text(none).includes(words.answers.noLink));
  pick.props.onPress(); await settle();
  assert.equal(answers(h).length, 1);
  assert.equal(answers(h)[0].answer, 'own');
  assert.equal(answers(h)[0].counterpart.id, left.id);
  assert.equal(answers(h)[0].label, words.answers.out.own);
  const skipped = detail({ states: { [PICKER]: true } });
  byId(skipped.h.renderDetail(skipped.subject, { transferAssessment: skipped.assessment }), 'entry-transfer-candidate-none').props.onPress(); await settle();
  assert.equal(answers(skipped.h)[0].answer, 'own');
  assert.equal(answers(skipped.h)[0].counterpart, undefined);
});

test('detail sheet: closes and resets the picker only when the answer was saved or kept', async () => {
  for (const [result, closed] of [['saved', true], ['unsaved', true], ['changed', false], ['failed', false], ['busy', false]]) {
    const { h, subject, assessment } = detail({ states: { [PICKER]: true }, answerResult: result });
    byId(h.renderDetail(subject, { transferAssessment: assessment }), 'entry-transfer-candidate-left').props.onPress(); await settle();
    assert.equal(closes(h), closed ? 1 : 0, `${result} ${closed ? 'closes' : 'leaves the sheet open'}`);
    assert.equal(h.events.some(e => e[0] === 'state' && e[1] === PICKER && e[2] === false), closed, `${result} picker reset`);
  }
});

test('detail sheet: one candidate links without asking; none saves an unlinked own answer; the others save directly', async () => {
  const one = detail();
  byId(one.h.renderDetail(one.subject, { transferAssessment: { status: 'likely-own', counterpartId: 'left' } }), 'transfer-answer-own').props.onPress(); await settle();
  assert.equal(answers(one.h)[0].counterpart.id, 'left');
  assert.equal(one.h.events.some(e => e[0] === 'state' && e[2] === true), false, 'never opens the picker for a single candidate');
  const bare = detail();
  byId(bare.h.renderDetail(bare.subject), 'transfer-answer-own').props.onPress(); await settle();
  assert.equal(answers(bare.h)[0].answer, 'own');
  assert.equal(answers(bare.h)[0].counterpart, undefined, 'without an assessment there is nothing to link');
  for (const choice of ['external', 'none']) {
    const direct = detail();
    byId(direct.h.renderDetail(direct.subject, { transferAssessment: direct.assessment }), `transfer-answer-${choice}`).props.onPress(); await settle();
    assert.equal(answers(direct.h)[0].answer, choice);
    assert.equal(answers(direct.h)[0].counterpart, undefined);
    assert.equal(answers(direct.h)[0].label, direct.words.answers.out[choice]);
  }
  const incoming = detail();
  byId(incoming.h.renderDetail(incoming.left), 'transfer-answer-none').props.onPress(); await settle();
  assert.equal(answers(incoming.h)[0].label, incoming.words.answers.in.none, 'an incoming row words its answers by direction');
});

test('detail sheet: shows the saved answer, a linked account and the declined state', () => {
  const { h, words, subject, assessment } = detail();
  const own = h.renderDetail(subject, { transferAssessment: { status: 'confirmed-own', counterpartId: 'left', candidateIds: [] } });
  assert.equal(byId(own, 'transfer-answer-own').props.accessibilityState.checked, true);
  assert.ok(text(own).includes(words.route.linked('ADCB')));
  const declined = h.renderDetail({ ...subject, transferDecision: { version: 1, ownership: 'none', decidedAt: 1 } }, { transferAssessment: assessment });
  assert.equal(byId(declined, 'transfer-answer-none').props.accessibilityState.checked, true);
  assert.equal(byId(declined, 'transfer-answer-own').props.accessibilityState.checked, false);
});

test('detail sheet: answers are disabled while one is saving, and word the question in Arabic', () => {
  const busy = detail({ answerBusy: true });
  for (const choice of ['own', 'external', 'none']) {
    assert.equal(byId(busy.h.renderDetail(busy.subject), `transfer-answer-${choice}`).props.disabled, true);
  }
  const ar = detail({ language: 'ar' });
  const tree = ar.h.renderDetail(ar.subject, { transferAssessment: ar.assessment });
  assert.ok(text(byId(tree, 'entry-transfer-question')).includes(ar.words.answers.question));
  assert.ok(text(tree).includes(ar.words.answers.out.own));
  const picking = detail({ language: 'ar', states: { [PICKER]: true } });
  const picker = picking.h.renderDetail(picking.subject, { transferAssessment: picking.assessment });
  assert.ok(text(picker).includes(picking.words.answers.whichAccount));
  assert.ok(text(picker).includes(picking.words.answers.noLink));
});

test('detail sheet: the picker and answers stack at large text', () => {
  const { h, subject, assessment } = detail({ largeText: true, states: { [PICKER]: true } });
  const picker = byId(h.renderDetail(subject, { transferAssessment: assessment }), 'entry-transfer-candidate-left');
  const rows = flat(picker.props.style);
  assert.notEqual(rows.flexDirection, 'row', 'account above date, never side by side');
  assert.ok(rows.minHeight >= 48);
});

test('detail sheet: a sheet opened for the several-candidates case starts on the picker, and Back returns to the answers', () => {
  const { h, words, subject, assessment } = detail();
  const tree = h.renderDetail(subject, { transferAssessment: assessment, startWithAccountPicker: true });
  assert.ok(byId(tree, 'entry-transfer-candidate-left') && byId(tree, 'entry-transfer-candidate-right'));
  assert.equal(byId(tree, 'transfer-answer-own'), undefined);
  const withOne = detail();
  const single = withOne.h.renderDetail(withOne.subject, { transferAssessment: { status: 'likely-own', counterpartId: 'left' }, startWithAccountPicker: true });
  assert.ok(byId(single, 'transfer-answer-own'), 'one candidate never needs the picker');
  const plain = detail();
  assert.ok(byId(plain.h.renderDetail(plain.subject, { transferAssessment: plain.assessment }), 'transfer-answer-own'), 'the prop is opt-in');
  const back = byId(tree, 'entry-transfer-picker-back');
  assert.equal(back.props.accessibilityRole, 'button');
  assert.equal(back.props.accessibilityLabel, h.deps['@/lib/i18n'].t('back'));
  assert.ok(flat(back.props.style).minHeight >= 48);
  back.props.onPress();
  assert.ok(h.events.some(e => e[0] === 'state' && e[1] === PICKER && e[2] === false), 'Back shows the three answers again');
  assert.ok(words.answers.whichAccount);
});

test('detail sheet: a captured row marked as a transfer offers one action to undo it, and the mark action is hidden', () => {
  const { h, words } = detail({ answerResult: 'saved' });
  const marked = { ...h.state.transactions[1], id: 'carrefour', title: 'Carrefour', source: 'sms', isTransfer: true };
  const tree = h.renderDetail(marked);
  const unmark = byId(tree, 'entry-unmark-transfer');
  assert.ok(unmark, 'a non-candidate with the transfer flag can be unmarked');
  assert.equal(unmark.props.accessibilityRole, 'button');
  assert.equal(unmark.props.accessibilityLabel, words.answers.out.none);
  assert.equal(byId(tree, 'entry-mark-transfer'), undefined);
  assert.equal(byId(tree, 'entry-transfer-question'), undefined);
  unmark.props.onPress();
  const edit = h.events.find(e => e[0] === 'editTransaction');
  assert.equal(edit[1], 'carrefour');
  assert.ok('isTransfer' in edit[2] && edit[2].isTransfer === undefined);
  assert.equal('bestEffort' in edit[2], false);
  assert.ok(h.events.some(e => e[0] === 'close'));
  const best = detail();
  byId(best.h.renderDetail({ ...best.h.state.transactions[1], id: 'be', isTransfer: true, bestEffort: true }), 'entry-unmark-transfer').props.onPress();
  const bestEdit = best.h.events.find(e => e[0] === 'editTransaction');
  assert.ok('bestEffort' in bestEdit[2] && bestEdit[2].bestEffort === undefined, 'saving the correction clears the best-effort flag like the mark does');
  const income = detail();
  const incomeTree = income.h.renderDetail({ ...income.h.state.transactions[7], id: 'in-flag', category: 'other', title: 'Cash deposit', isTransfer: true });
  assert.equal(byId(incomeTree, 'entry-unmark-transfer').props.accessibilityLabel, income.words.answers.in.none);
  const ordinary = detail();
  assert.equal(byId(ordinary.h.renderDetail(ordinary.h.state.transactions[1]), 'entry-unmark-transfer'), undefined);
  const manual = detail();
  assert.equal(byId(manual.h.renderDetail({ ...manual.h.state.transactions[1], id: 'm', source: 'manual', isTransfer: true }), 'entry-unmark-transfer'), undefined,
    'a manual flagged row is a candidate and answers through the question');
});

test('detail sheet: a card payment or other system-flagged row never offers the mark or the unmark', () => {
  const { h } = detail();
  const base = h.state.transactions[1];
  for (const extra of [
    { cardPaymentSide: 'payer', isTransfer: true },
    { cardPaymentSide: 'payer' },
    { paymentFlowSide: 'receipt', isTransfer: true },
    { title: 'Card payment', isTransfer: true },
    { category: 'salary', type: 'income', title: 'Salary', isTransfer: true },
  ]) {
    const tree = h.renderDetail({ ...base, id: 'system', source: 'sms', ...extra });
    assert.equal(byId(tree, 'entry-mark-transfer'), undefined, JSON.stringify(extra));
    assert.equal(byId(tree, 'entry-unmark-transfer'), undefined, JSON.stringify(extra));
  }
  assert.equal(h.events.some(e => e[0] === 'editTransaction'), false);
});

// ---- Final review fixes ----
test('answer choices: tapping the answer that is already selected reports nothing', () => {
  const h = harness('en');
  const { TransferAnswerChoices } = h.deps['@/components/transfers/transfer-answer-choices'];
  for (const layout of ['buttons', 'radios']) for (const value of ['own', 'external', 'none']) {
    const picked = [];
    const tree = TransferAnswerChoices({ incoming: true, value, layout, onChange: v => picked.push(v), palette: palette(h) });
    byId(tree, `transfer-answer-${value}`).props.onPress();
    assert.deepEqual(picked, [], `${layout} ${value}: the selected answer is a no-op`);
    const other = value === 'own' ? 'external' : 'own';
    byId(tree, `transfer-answer-${other}`).props.onPress();
    assert.deepEqual(picked, [other], `${layout}: a different answer is still reported`);
  }
});

test('detail sheet: tapping the selected answer saves nothing, shows no toast and stays open', async () => {
  const { h, subject } = detail();
  // A manual credit on a card flagged by hand reads "own" from the row itself, with no decision saved.
  const manual = { ...subject, id: 'manual-card', type: 'income', source: 'manual', smsKey: undefined,
    transferEvidence: undefined, accountId: 'credit', isTransfer: true };
  h.state.transactions.push(manual);
  const tree = h.renderDetail(manual);
  assert.equal(byId(tree, 'transfer-answer-own').props.accessibilityState.checked, true);
  byId(tree, 'transfer-answer-own').props.onPress(); await settle();
  assert.deepEqual(answers(h), [], 'no save');
  assert.equal(closes(h), 0, 'the sheet stays open');
  assert.equal(h.events.some(e => e[0] === 'state' && e[1] === PICKER), false, 'no picker');
  const declined = detail();
  const row = { ...declined.subject, transferDecision: { version: 1, ownership: 'none', decidedAt: 1 } };
  byId(declined.h.renderDetail(row), 'transfer-answer-none').props.onPress(); await settle();
  assert.deepEqual(answers(declined.h), []);
  byId(declined.h.renderDetail(row), 'transfer-answer-external').props.onPress(); await settle();
  assert.equal(answers(declined.h)[0].answer, 'external', 'a different answer still saves');
});

test('detail sheet: the picker is a no-op only for the link already saved', async () => {
  const words = h => h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  const manualOwn = s => ({ ...s, id: 'manual-own', source: 'manual', smsKey: undefined, transferEvidence: undefined, isTransfer: true });
  // A likely-own partner is a suggestion: picking it links, and the sheet does not claim a link before that.
  const likely = detail({ states: { [PICKER]: true } });
  const suggested = { status: 'likely-own', counterpartId: 'left', candidateIds: ['left'] };
  const answersTree = likely.h.renderDetail(manualOwn(likely.subject), { transferAssessment: suggested });
  byId(answersTree, 'entry-transfer-candidate-left').props.onPress(); await settle();
  assert.equal(answers(likely.h)[0].counterpart.id, 'left');
  const shown = detail();
  assert.ok(!text(shown.h.renderDetail(manualOwn(shown.subject), { transferAssessment: suggested })).includes(words(shown.h).route.linked('ADCB')));
  // A confirmed link re-picked, or "no link" on an unlinked own answer, saves nothing.
  const linked = detail({ states: { [PICKER]: true } });
  const confirmed = { status: 'confirmed-own', counterpartId: 'left', candidateIds: [] };
  byId(linked.h.renderDetail(linked.subject, { transferAssessment: confirmed }), 'entry-transfer-candidate-left').props.onPress(); await settle();
  assert.deepEqual(answers(linked.h), []);
  const unlinked = detail({ states: { [PICKER]: true } });
  byId(unlinked.h.renderDetail(manualOwn(unlinked.subject), { transferAssessment: unlinked.assessment }), 'entry-transfer-candidate-none').props.onPress(); await settle();
  assert.deepEqual(answers(unlinked.h), []);
  // Unlinking a confirmed pair is a change and still saves.
  const unlink = detail({ states: { [PICKER]: true } });
  byId(unlink.h.renderDetail(unlink.subject, { transferAssessment: confirmed }), 'entry-transfer-candidate-none').props.onPress(); await settle();
  assert.equal(answers(unlink.h)[0].answer, 'own');
  assert.equal(answers(unlink.h)[0].counterpart, undefined);
});

test('detail sheet: without a passed assessment it reads the cached reconciliation, and a passed one wins', () => {
  const ts = Date.UTC(2026, 8, 5, 10);
  const out = { id: 'pair-out', type: 'expense', amountFils: 150000, accountId: 'enbd', category: 'other',
    title: 'Outgoing transfer', date: '2026-09-05', ts, source: 'sms', smsKey: 'pair-1', isTransfer: true,
    captureInstrument: { last4: '4821', kind: 'account', bankIdentity: 'emirates nbd' },
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'Emirates NBD', explicitOwn: true,
      counterparty: { last4: '8310', kind: 'account', bankIdentity: 'adcb' } } };
  const inn = { id: 'pair-in', type: 'income', amountFils: 150000, accountId: 'adcb', category: 'other',
    title: 'Incoming transfer', date: '2026-09-05', ts: ts + 60000, source: 'sms', smsKey: 'pair-2',
    captureInstrument: { last4: '8310', kind: 'account', bankIdentity: 'adcb' },
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'ADCB' } };
  const { h, words } = detail();
  h.state.transactions.push(out, inn);
  // Account, Flow, Home, card, merchant and the other sheets pass no assessment.
  const plain = h.renderDetail(inn);
  assert.equal(byId(plain, 'transfer-answer-own').props.accessibilityState.checked, true, 'the confirmed pair reads as own');
  assert.ok(text(plain).includes(words.route.linked('Emirates NBD')), 'and names the other side');
  const explicit = h.renderDetail(inn, { transferAssessment: { status: 'ownership-unknown', candidateIds: [] } });
  assert.ok(!text(explicit).includes(words.route.linked('Emirates NBD')), 'the explicit prop takes precedence');
  // While a history import holds a provisional receipt there is no reconciliation: nothing is claimed, nothing breaks.
  Object.assign(h.state, { transferInternalIds: [], transferNormalizationVersion: -1, historyImport: { status: 'running' } });
  const importing = h.renderDetail(inn);
  assert.ok(byId(importing, 'entry-transfer-question'));
  assert.ok(!text(importing).includes(words.route.linked('Emirates NBD')));
});
