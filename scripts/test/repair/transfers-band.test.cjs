'use strict';
// Transfers history on the slate band (design language E): real screen source
// through the shared harness; synthetic ledger rows only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');

const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);
/** The history list renders its header, rows and empty state so the tree holds them. */
function harness(options) {
  const h = createWorkflowHarness(options);
  h.deps['react-native'].SectionList = p => h.jsx('SectionList', { ...p, children: [p.ListHeaderComponent,
    ...(p.sections.length ? p.sections.flatMap(section => section.data.map(item => p.renderItem({ item, section }))) : [p.ListEmptyComponent])] });
  h.deps['react-native'].Keyboard = { dismiss() {} };
  h.local('@/lib/review-band-copy', 'src/lib/review-band-copy.ts');
  h.local('@/components/transfer-pair-accounts');
  h.local('@/lib/transfer-pairs', 'src/lib/transfer-pairs.ts');
  return h;
}

test('Transfers wears the slate band with its plain title and keeps the history list', () => {
  const h = harness({ language: 'en' });
  const tree = h.renderScreen('transfers');
  const scaffold = walk(tree).find(node => node.type === 'BandScaffold');
  assert.equal(scaffold.props.band, 'accounts');
  assert.equal(scaffold.props.scroll, false, 'the sheet owns its virtualized history');
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  assert.ok(text(byId(tree, 'transfers-band')).includes(words.title));
  assert.ok(byId(tree, 'transfer-history'));
});

for (const language of ['en', 'ar']) {
  test(`${language}: a confirmed pair reads Out of / Into with one amount, and opens its entry`, () => {
    const today = '2026-09-10'; // inside the harness's selected month
    const leg = (id, type, accountId) => ({ id, type, accountId, amountFils: 50000, date: today, ts: Date.now(),
      title: 'Own transfer', category: 'transfer', source: 'sms' });
    const rows = [leg('out', 'expense', 'current'), leg('in', 'income', 'savings')];
    const h = harness({ language, state: { transactions: rows,
      accounts: [{ id: 'current', name: 'Current account', type: 'bank' }, { id: 'savings', name: 'Savings', type: 'bank' }] } });
    // Reconciliation is a boundary here; the matched-pair rule has its own pure suite.
    const reconciliation = { groups: [], pendingIds: new Set(), internalIds: new Set(['out', 'in']), byId: new Map([
      ['out', { id: 'out', status: 'confirmed-own', reason: 'user', counterpartId: 'in', candidateIds: [] }],
      ['in', { id: 'in', status: 'confirmed-own', reason: 'user', counterpartId: 'out', candidateIds: [] }],
    ]) };
    h.deps['@/lib/transfer-reconciliation'] = { ...h.deps['@/lib/transfer-reconciliation'], reconcileTransfers: () => reconciliation };
    // The screen first asks for the reconciliation cached per stored transfer receipt.
    h.deps['@/lib/ledger'] = { ...h.deps['@/lib/ledger'], transferReconciliationForState: () => reconciliation };
    const tree = h.renderScreen('transfers');
    const pairs = walk(tree).filter(node => node.props?.testID === 'transfer-matched-pair');
    assert.equal(pairs.length, 1);
    const copy = h.deps['@/lib/review-band-copy'].reviewBandCopy(language);
    for (const part of [copy.outOf, 'Current account', copy.into, 'Savings']) assert.ok(text(pairs[0]).includes(part), part);
    pairs[0].props.onPress();
    assert.ok(h.events.some(event => event[0] === 'state' && event[2] === 'out'), 'the row opens the outgoing entry');
  });
}
