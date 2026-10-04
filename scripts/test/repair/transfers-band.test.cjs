'use strict';
// Transfers page (Mix 2): the slate band with its three filter tiles, the one
// question card and the route list, through the shared harness. Synthetic ledger
// rows only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');

const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);
/** The history list renders its header, rows and empty state so the tree holds them. */
function harness(options) {
  const h = createWorkflowHarness(options);
  h.deps['react-native'].Keyboard = { dismiss() {} };
  h.local('@/lib/transfer-list', 'src/lib/transfer-list.ts');
  h.local('@/lib/transfer-answer', 'src/lib/transfer-answer.ts');
  h.local('@/lib/transfer-pairs', 'src/lib/transfer-pairs.ts');
  for (const name of ['transfer-answer-choices', 'transfer-route-row', 'transfer-question-card']) h.local(`@/components/transfers/${name}`);
  h.answers = [];
  h.deps['@/hooks/use-transfer-answer'] = { useTransferAnswer: () => ({ busy: false,
    answer: async input => { h.answers.push(input); return 'saved'; } }) };
  return h;
}

/** Reconciliation is a boundary here; its rules have their own suites. */
function withReconciliation(h, byIdEntries, pendingIds = []) {
  const reconciliation = { groups: [], pendingIds: new Set(pendingIds), internalIds: new Set(), byId: new Map(byIdEntries) };
  h.deps['@/lib/transfer-reconciliation'] = { ...h.deps['@/lib/transfer-reconciliation'], reconcileTransfers: () => reconciliation };
  // The screen first asks for the reconciliation cached per stored transfer receipt.
  h.deps['@/lib/ledger'] = { ...h.deps['@/lib/ledger'], transferReconciliationForState: () => reconciliation };
}
const leg = (id, type, accountId, extra = {}) => ({ id, type, accountId, amountFils: 50000, date: '2026-09-10', ts: Date.now(),
  title: 'Transfer', category: 'transfer', source: 'sms',
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source' }, ...extra });
const accountsFixture = [{ id: 'current', name: 'Current account', type: 'bank' }, { id: 'savings', name: 'Savings', type: 'bank' }];
const pairEntries = [
  ['out', { id: 'out', status: 'confirmed-own', reason: 'user', counterpartId: 'in', candidateIds: [] }],
  ['in', { id: 'in', status: 'confirmed-own', reason: 'user', counterpartId: 'out', candidateIds: [] }],
];
const mixedRows = () => [leg('out', 'expense', 'current'), leg('in', 'income', 'savings'),
  leg('pay', 'expense', 'current', { amountFils: 8500 })];
const mixedEntries = () => [...pairEntries,
  ['pay', { id: 'pay', status: 'confirmed-external', reason: 'user', candidateIds: [] }]];
const rowIds = tree => walk(tree).map(node => node.props?.testID).filter(id => id?.startsWith('transfer-row-'));

test('Transfers wears the slate band with its plain title, the headline total and the history list', () => {
  const h = harness({ language: 'en' });
  const tree = h.renderScreen('transfers');
  const scaffold = walk(tree).find(node => node.type === 'BandScaffold');
  assert.equal(scaffold.props.band, 'accounts');
  assert.equal(scaffold.props.scroll, false, 'the sheet owns its virtualized history');
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  assert.equal(scaffold.props.nav.title, words.title);
  const band = byId(tree, 'transfers-band');
  assert.ok(text(band).includes(words.notCounted), 'the band says these totals are not spending or income');
  assert.ok(text(band).includes(words.headline('X').slice(1)), 'the band carries the period headline');
  assert.ok(byId(tree, 'transfer-history'));
});

for (const language of ['en', 'ar']) {
  test(`${language}: a confirmed pair is one route row from the outgoing account to the incoming one, and opens its entry`, () => {
    const rows = [leg('out', 'expense', 'current'), leg('in', 'income', 'savings')];
    const h = harness({ language, state: { transactions: rows, accounts: accountsFixture } });
    withReconciliation(h, pairEntries);
    const tree = h.renderScreen('transfers');
    const row = byId(tree, 'transfer-row-out|in');
    assert.ok(row, 'a linked pair is one route row');
    assert.deepEqual(rowIds(tree), ['transfer-row-out|in']);
    assert.match(row.props.accessibilityLabel, /Current account.*Savings/);
    row.props.onPress();
    assert.ok(h.events.some(event => event[0] === 'state' && event[2] === 'out'), 'the row opens the outgoing entry');
  });
}

test('tiles show totals and filter the list; tapping the same tile again clears', () => {
  const h = harness({ language: 'en', state: { transactions: mixedRows(), accounts: accountsFixture } });
  withReconciliation(h, mixedEntries());
  const tree = h.renderScreen('transfers');
  assert.ok(text(byId(tree, 'transfers-tile-own')).includes('500'));
  assert.ok(text(byId(tree, 'transfers-tile-sent')).includes('85'));
  assert.equal(byId(tree, 'transfers-tile-sent').props.accessibilityState.selected, false);
  assert.deepEqual(rowIds(tree).sort(), ['transfer-row-out|in', 'transfer-row-pay']);
  // The harness's useState only records the request; read the tile index from it
  // and render a fresh screen holding that value, as a re-render would.
  byId(tree, 'transfers-tile-sent').props.onPress();
  const request = h.events.find(event => event[0] === 'state' && event[2] === 'sent');
  assert.ok(request, 'pressing Sent asks to select the Sent tile');
  const filtered = harness({ language: 'en', state: { transactions: mixedRows(), accounts: accountsFixture }, states: { [request[1]]: 'sent' } });
  withReconciliation(filtered, mixedEntries());
  const after = filtered.renderScreen('transfers');
  assert.deepEqual(rowIds(after), ['transfer-row-pay'], 'only what was sent to someone else is listed');
  assert.equal(byId(after, 'transfers-tile-sent').props.accessibilityState.selected, true);
  byId(after, 'transfers-tile-sent').props.onPress();
  assert.ok(filtered.events.some(event => event[0] === 'state' && event[2] === null), 'pressing the selected tile again clears it');
});

test('question card answers the first queued transfer', async () => {
  const rows = [leg('q1', 'expense', 'current', { date: '2026-09-12' }), leg('q2', 'expense', 'current', { date: '2026-09-11' })];
  const h = harness({ language: 'en', state: { transactions: rows, accounts: accountsFixture } });
  withReconciliation(h, rows.map(r => [r.id, { id: r.id, status: 'ownership-unknown', reason: 'missing-evidence', candidateIds: [] }]), ['q1', 'q2']);
  const tree = h.renderScreen('transfers');
  const card = byId(tree, 'transfer-question-card');
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  assert.ok(text(card).includes(words.card.step(1, 2)));
  await byId(card, 'transfer-answer-external').props.onPress();
  assert.equal(h.answers.length, 1);
  assert.equal(h.answers[0].transaction.id, 'q1');
  assert.equal(h.answers[0].answer, 'external');
  assert.equal(h.answers[0].counterpart, undefined);
});

test('answering own with several candidate accounts opens the entry instead of guessing', async () => {
  const rows = [leg('q1', 'expense', 'current'), leg('c1', 'income', 'savings'), leg('c2', 'income', 'savings', { amountFils: 50100 })];
  const h = harness({ language: 'en', state: { transactions: rows, accounts: accountsFixture } });
  withReconciliation(h, [
    ['q1', { id: 'q1', status: 'likely-own', reason: 'amount-time', candidateIds: ['c1', 'c2'] }],
    ['c1', { id: 'c1', status: 'ownership-unknown', reason: 'missing-evidence', candidateIds: [] }],
    ['c2', { id: 'c2', status: 'ownership-unknown', reason: 'missing-evidence', candidateIds: [] }],
  ], ['q1']);
  const tree = h.renderScreen('transfers');
  await byId(byId(tree, 'transfer-question-card'), 'transfer-answer-own').props.onPress();
  assert.equal(h.answers.length, 0, 'nothing is saved until the person picks the account');
  assert.ok(h.events.some(event => event[0] === 'state' && event[2] === 'q1'), 'the entry detail sheet opens for that transfer');
});

test('no queued transfers means no question card', () => {
  const h = harness({ language: 'en', state: { transactions: mixedRows(), accounts: accountsFixture } });
  withReconciliation(h, mixedEntries());
  assert.equal(byId(h.renderScreen('transfers'), 'transfer-question-card'), undefined);
});

test('large text stacks the tiles instead of squeezing three across', () => {
  const rowOf = largeText => {
    const tree = harness({ language: 'en', largeText }).renderScreen('transfers');
    return walk(byId(tree, 'transfers-band')).find(node => node.props?.children?.[0]?.props?.testID === 'transfers-tile-own');
  };
  const direction = row => [row.props.style].flat(Infinity).filter(Boolean).map(style => style.flexDirection).filter(Boolean).pop();
  assert.equal(direction(rowOf(false)), 'row');
  assert.equal(direction(rowOf(true)), 'column');
});
