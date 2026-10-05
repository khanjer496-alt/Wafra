'use strict';
// One queue for Home and the Transfers question card, and a way to every queued
// entry the card cannot ask about. Synthetic ledger rows only; reconciliation is
// a boundary here (its rules have their own suites).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { core } = require('./load-transfer-ledger.cjs');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const activityLib = load(path.join(root, 'src/lib/transfer-activity.ts'), { '@/lib/transfer-reconciliation': core });
const homeToday = require('fs').readFileSync(path.join(root, 'src/screens/journal-home-screen.tsx'), 'utf8');
const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);

const leg = (id, type, accountId, extra = {}) => ({ id, type, accountId, amountFils: 50000, date: '2026-09-10', ts: 1,
  title: 'Transfer', category: 'transfer', source: 'sms',
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source' }, ...extra });
const accounts = [{ id: 'current', name: 'Current account', type: 'bank' }, { id: 'savings', name: 'Savings', type: 'bank' },
  { id: 'old', name: 'Closed account', type: 'bank', archived: true }];
const reconciliation = (entries, pendingIds) => ({ groups: [], internalIds: new Set(), pendingIds: new Set(pendingIds), byId: new Map(entries) });
const pairEntries = [
  ['out', { id: 'out', status: 'likely-own', reason: 'amount-time', counterpartId: 'in', candidateIds: ['in'] }],
  ['in', { id: 'in', status: 'likely-own', reason: 'amount-time', counterpartId: 'out', candidateIds: ['out'] }],
];
/** What Home's notice holds: the card's questions, or the unasked entries when there are none. */
function homeQueue(rows, rec) {
  const activity = activityLib.getTransferActivity(rows, accounts, rec);
  const queue = activityLib.transferQuestionQueue(activity);
  const unasked = activityLib.unaskedPendingIds(activity, rec.pendingIds);
  return { questions: queue.length, unasked: unasked.size, queue };
}

test('Home and the card count one own-account pair once', () => {
  const rows = [leg('out', 'expense', 'current'), leg('in', 'income', 'savings')];
  const result = homeQueue(rows, reconciliation(pairEntries, ['out', 'in']));
  assert.equal(result.questions, 1, 'one movement, one question');
  assert.equal(result.queue[0].transaction.id, 'out', 'asked about its outgoing leg');
  assert.equal(result.unasked, 0, 'the incoming leg is settled by that answer, not left behind');
});

test('duplicate observations, archived accounts and likely card repayments are queued but unasked', () => {
  const rows = [leg('dup', 'expense', 'current'), leg('dup', 'expense', 'current'), leg('gone', 'expense', 'old'),
    leg('card', 'expense', 'current'), leg('ask', 'expense', 'current', { date: '2026-09-12' }),
    leg('older', 'expense', 'savings', { date: '2026-09-01' })];
  const unknown = id => [id, { id, status: 'ownership-unknown', candidateIds: [] }];
  const rec = reconciliation([unknown('dup'), unknown('gone'), ['card', { id: 'card', status: 'likely-card-repayment', candidateIds: [] }],
    unknown('ask'), unknown('older')], ['dup', 'gone', 'card', 'ask', 'older']);
  const result = homeQueue(rows, rec);
  assert.deepEqual([...result.queue.map(item => item.transaction.id)], ['ask', 'older'], 'newest first');
  assert.deepEqual([...activityLib.unaskedPendingIds(activityLib.getTransferActivity(rows, accounts, rec), rec.pendingIds)].sort(),
    ['card', 'dup', 'gone']);
});

test('Home counts the card\'s queue and always opens the one Transfers page', () => {
  assert.match(homeToday, /const queue = transferQuestionQueue\(activity\);/);
  assert.match(homeToday, /queue\.length > 0 \? new Set\(queue\.map\(item => item\.transaction\.id\)\)\s*: unaskedPendingIds\(activity, reconciliation\.pendingIds\)/);
  // What the card cannot ask waits on Transfers as a group row, so there is no second page to open.
  assert.match(homeToday, /onPress=\{\(\) => router\.push\('\/transfers'\)\} \/>/);
  assert.doesNotMatch(homeToday, /review-transfers/);
});

function transfersHarness(rows, rec) {
  const h = createWorkflowHarness({ language: 'en', state: { transactions: rows, accounts } });
  h.deps['react-native'].Keyboard = { dismiss() {} };
  h.local('@/lib/transfer-list', 'src/lib/transfer-list.ts');
  h.local('@/lib/transfer-answer', 'src/lib/transfer-answer.ts');
  h.local('@/lib/transfer-pairs', 'src/lib/transfer-pairs.ts');
  h.local('@/components/transfer-coins/coin-cues', 'src/components/transfer-coins/coin-cues.ts');
  h.local('@/components/transfer-coins/route-coin');
  for (const name of ['transfer-answer-choices', 'transfer-route-row', 'transfer-question-card']) h.local(`@/components/transfers/${name}`);
  h.deps['@/hooks/use-transfer-answer'] = { useTransferAnswer: () => ({ busy: false, answer: async () => 'saved' }) };
  h.deps['@/lib/transfer-reconciliation'] = { ...h.deps['@/lib/transfer-reconciliation'], reconcileTransfers: () => rec };
  h.deps['@/lib/ledger'] = { ...h.deps['@/lib/ledger'], transferReconciliationForState: () => rec };
  return h;
}

test('Transfers: nothing the card can ask, but entries still queued, lists them and opens select mode instead of a dead end', () => {
  const rows = [leg('dup', 'expense', 'current'), leg('dup', 'expense', 'current')];
  const rec = reconciliation([['dup', { id: 'dup', status: 'ownership-unknown', candidateIds: [] }]], ['dup']);
  // The reconciler groups every queued id (here the duplicate observation) by account and other side.
  rec.groups = [{ id: 'g-dup', transactionIds: ['dup'], accountId: 'current', direction: 'expense', status: 'ownership-unknown', bulkEligible: false }];
  const h = transfersHarness(rows, rec);
  const tree = h.renderScreen('transfers');
  assert.equal(byId(tree, 'transfer-question-card'), undefined);
  const link = byId(tree, 'transfers-review-link');
  assert.ok(link, 'the queued entry stays reachable');
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  assert.ok(text(link).includes(words.card.title(1)) && text(link).includes(words.card.seeAllPlain), 'the count once, then See all');
  assert.equal(link.props.accessibilityRole, 'button');
  // The queued entry is on the page itself, as a group row the card cannot ask about.
  assert.ok(walk(tree).some(node => node.props?.testID?.startsWith('transfer-group-')), 'the unasked entry is a row here');
  link.props.onPress();
  assert.equal(h.events.filter(event => event[0] === 'route').length, 0, 'no second page');
  assert.ok(h.events.some(event => event[0] === 'state' && event[2] === true), 'See all turns on select mode on this page');
});

test('Transfers: one question plus an unasked entry keeps See all on the card', () => {
  const rows = [leg('ask', 'expense', 'current'), leg('gone', 'expense', 'old')];
  const unknown = id => [id, { id, status: 'ownership-unknown', candidateIds: [] }];
  const h = transfersHarness(rows, reconciliation([unknown('ask'), unknown('gone')], ['ask', 'gone']));
  const tree = h.renderScreen('transfers');
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  const card = byId(tree, 'transfer-question-card');
  assert.ok(text(card).includes(words.card.title(1)), 'the card asks its one question');
  const seeAll = byId(card, 'transfer-question-see-all');
  assert.ok(seeAll, 'See all is offered although the card has one question');
  assert.ok(text(seeAll).includes(words.card.seeAll(2)));
  assert.equal(byId(tree, 'transfers-review-link'), undefined);
  const lone = transfersHarness([leg('ask', 'expense', 'current')], reconciliation([unknown('ask')], ['ask']));
  assert.equal(byId(lone.renderScreen('transfers'), 'transfer-question-see-all'), undefined, 'one question and nothing else: no See all');
});

const flatStyle = style => Object.assign({}, ...[].concat(style).flat(Infinity).filter(s => s && typeof s === 'object'));
function componentHarness(language = 'en') {
  const h = createWorkflowHarness({ language });
  h.local('@/lib/transfer-activity-copy', 'src/lib/transfer-activity-copy.ts');
  h.local('@/components/transfer-coins/coin-cues', 'src/components/transfer-coins/coin-cues.ts');
  h.local('@/components/transfer-coins/route-coin');
  for (const name of ['transfer-answer-choices', 'transfer-route-row', 'transfer-question-card']) h.local(`@/components/transfers/${name}`);
  return h;
}

for (const language of ['en', 'ar']) {
  test(`${language}: an answered end ("Someone else", "Your account") is never capped or cut; the account chip yields`, () => {
    const h = componentHarness(language);
    const { RouteChip } = h.deps['@/components/transfers/transfer-route-row'];
    const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy(language);
    const palette = h.deps['@/hooks/use-band'].useBand('accounts');
    for (const [answered, label] of [['external', words.route.someoneElse], ['own', words.route.yourAccount]]) {
      const chip = RouteChip({ end: { kind: 'unknown' }, label, palette, large: false, answered, direction: 'out' });
      const style = flatStyle(chip.props.style);
      assert.notEqual(style.maxWidth, '42%', `${answered}: not capped`);
      assert.equal(style.flexShrink, 0, `${answered}: keeps its width`);
      const name = walk(chip).find(node => node.type === 'ThemedText' || (node.props?.children === label));
      assert.equal(name.props.numberOfLines, undefined, `${answered}: never truncated`);
      assert.ok(text(chip).includes(label));
    }
    const account = RouteChip({ end: { kind: 'account', accountId: 'a' }, label: 'A very long current account name ·4410', palette, large: false });
    assert.equal(flatStyle(account.props.style).flexShrink, 1, 'the named account shrinks (it truncates, with its label spoken)');
  });
}

test('the question card gives its count once in the title; See all counts only what the card does not ask', () => {
  const h = componentHarness('en');
  const { TransferQuestionCard } = h.deps['@/components/transfers/transfer-question-card'];
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  const palette = h.deps['@/hooks/use-band'].useBand('accounts');
  const transaction = { id: 'q', type: 'expense', amountFils: 500000, date: '2026-10-02', accountId: 'fab', title: 'Transfer', category: 'other' };
  const plain = byId(TransferQuestionCard({ transaction, index: 0, total: 3, accountLabel: 'FAB', palette, busy: false,
    onAnswer() {}, onSeeAll() {} }), 'transfer-question-see-all');
  assert.equal(text(plain).trim(), words.card.seeAllPlain);
  const more = byId(TransferQuestionCard({ transaction, index: 0, total: 3, more: 2, accountLabel: 'FAB', palette, busy: false,
    onAnswer() {}, onSeeAll() {} }), 'transfer-question-see-all');
  assert.ok(text(more).includes(words.card.seeAll(5)));
  const ar = componentHarness('ar').deps['@/lib/transfer-activity-copy'].transferActivityCopy('ar');
  assert.equal(typeof ar.card.seeAllPlain, 'string');
  assert.notEqual(ar.card.seeAllPlain, words.card.seeAllPlain, 'Arabic has its own words');
});
