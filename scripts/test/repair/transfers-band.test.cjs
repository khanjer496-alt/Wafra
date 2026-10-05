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

test('the several-candidates case opens the sheet straight onto the account picker, a row tap does not', async () => {
  const rows = [leg('q1', 'expense', 'current'), leg('c1', 'income', 'savings'), leg('c2', 'income', 'savings', { amountFils: 50100 })];
  const entries = [
    ['q1', { id: 'q1', status: 'likely-own', reason: 'amount-time', candidateIds: ['c1', 'c2'] }],
    ['c1', { id: 'c1', status: 'ownership-unknown', reason: 'missing-evidence', candidateIds: [] }],
    ['c2', { id: 'c2', status: 'ownership-unknown', reason: 'missing-evidence', candidateIds: [] }],
  ];
  const make = states => {
    const h = harness({ language: 'en', states, state: { transactions: rows, accounts: accountsFixture } });
    withReconciliation(h, entries, ['q1']);
    return h;
  };
  const first = make();
  await byId(byId(first.renderScreen('transfers'), 'transfer-question-card'), 'transfer-answer-own').props.onPress();
  const opened = first.events.filter(event => event[0] === 'state' && event[2] === 'q1').map(event => event[1]);
  assert.equal(opened.length, 2, 'the open row and the "start on the picker" marker are both set');
  const sheetOf = h => walk(h.renderScreen('transfers')).find(node => node.props?.name === 'EntryDetailSheet');
  const picker = sheetOf(make({ [opened[0]]: 'q1', [opened[1]]: 'q1' }));
  assert.equal(picker.props.transaction.id, 'q1');
  assert.equal(picker.props.startWithAccountPicker, true);
  const tapped = sheetOf(make({ [opened[0]]: 'q1' }));
  assert.equal(tapped.props.transaction.id, 'q1');
  assert.ok(!tapped.props.startWithAccountPicker, 'a row tap opens the three answers');
  const closed = sheetOf(make());
  assert.equal(closed.props.transaction, null);
  const closing = make({ [opened[0]]: 'q1', [opened[1]]: 'q1' });
  sheetOf(closing).props.onClose();
  const cleared = closing.events.filter(event => event[0] === 'state' && opened.includes(event[1]) && event[2] === null).map(event => event[1]);
  assert.deepEqual(cleared.sort(), [...opened].sort(), 'closing clears both');
});

test('no queued transfers means no question card', () => {
  const h = harness({ language: 'en', state: { transactions: mixedRows(), accounts: accountsFixture } });
  withReconciliation(h, mixedEntries());
  assert.equal(byId(h.renderScreen('transfers'), 'transfer-question-card'), undefined);
});

test('large text stacks the tiles instead of squeezing three across', () => {
  const rowOf = largeText => {
    const tree = harness({ language: 'en', largeText }).renderScreen('transfers');
    return byId(tree, 'transfers-tiles');
  };
  const direction = row => [row.props.style].flat(Infinity).filter(Boolean).map(style => style.flexDirection).filter(Boolean).pop();
  assert.equal(direction(rowOf(false)), 'row');
  assert.equal(direction(rowOf(true)), 'column');
});

// ---- fix round 1 ----
const stateOf = (h, value) => h.events.find(event => event[0] === 'state' && event[2] === value);

test('searching for the incoming account keeps a linked pair as one route row', () => {
  const rows = [leg('out', 'expense', 'current'), leg('in', 'income', 'savings')];
  // Hook order: tile is state 0 and the search query is state 1.
  const h = harness({ language: 'en', states: { 1: 'savings' }, state: { transactions: rows, accounts: accountsFixture } });
  withReconciliation(h, pairEntries);
  const tree = h.renderScreen('transfers');
  assert.deepEqual(rowIds(tree), ['transfer-row-out|in'], 'one pair row, not a one-sided leg');
  assert.match(byId(tree, 'transfer-row-out|in').props.accessibilityLabel, /Current account.*Savings/);
  const none = harness({ language: 'en', states: { 1: 'nomatch' }, state: { transactions: rows, accounts: accountsFixture } });
  withReconciliation(none, pairEntries);
  assert.deepEqual(rowIds(none.renderScreen('transfers')), []);
});

test('a pair is placed by its outgoing leg: it never splits on the period boundary', () => {
  const straddle = [leg('out', 'expense', 'current', { date: '2026-09-30' }), leg('in', 'income', 'savings', { date: '2026-10-01' })];
  const h = harness({ language: 'en', state: { transactions: straddle, accounts: accountsFixture } });
  withReconciliation(h, pairEntries);
  assert.deepEqual(rowIds(h.renderScreen('transfers')), ['transfer-row-out|in'], 'out leg in September: the pair is listed whole');
  const early = [leg('out', 'expense', 'current', { date: '2026-08-31' }), leg('in', 'income', 'savings', { date: '2026-09-01' })];
  const later = harness({ language: 'en', state: { transactions: early, accounts: accountsFixture } });
  withReconciliation(later, pairEntries);
  assert.deepEqual(rowIds(later.renderScreen('transfers')), [], 'out leg in August: not a lone September receipt');
});

test('the period chip sits in the band nav row and opens the period sheet', () => {
  const h = harness({ language: 'en' });
  const tree = h.renderScreen('transfers');
  const scaffold = walk(tree).find(node => node.type === 'BandScaffold');
  const chip = walk(scaffold.props.nav.trailing).find(node => node.props?.testID === 'transfers-period');
  assert.ok(chip, 'the nav row carries the period chip');
  chip.props.onPress();
  assert.ok(stateOf(h, true), 'pressing it opens the period sheet');
});

test('large text moves the tiles from the band into the list header', () => {
  const inBand = tree => !!byId(byId(tree, 'transfers-band'), 'transfers-tile-own');
  const inHeader = tree => !!byId(byId(tree, 'transfer-history').props.ListHeaderComponent, 'transfers-tile-own');
  const normal = harness({ language: 'en' }).renderScreen('transfers');
  assert.ok(inBand(normal) && !byId(byId(normal, 'transfer-history').props.ListHeaderComponent, 'transfers-tile-own'));
  const large = harness({ language: 'en', largeText: true }).renderScreen('transfers');
  assert.ok(!inBand(large), 'the fixed band no longer holds the tiles');
  assert.ok(inHeader(large), 'the tiles scroll with the list');
  assert.ok(byId(byId(large, 'transfers-band'), 'transfers-band') || text(byId(large, 'transfers-band')).includes('AED'), 'the figure stays in the band');
});

const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const textNodes = node => walk(node).filter(n => n.type === 'Text');

test('every tile figure draws its currency label in the tile\'s own secondary colour, on the band and on the sheet', () => {
  const words = harness({ language: 'en' }).deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  for (const [label, options, states] of [['band', { language: 'en' }, undefined], ['selected on band', { language: 'en' }, { 0: 'sent' }],
    ['sheet at large text', { language: 'en', largeText: true }, undefined]]) {
    const h = harness({ ...options, states });
    const tree = h.renderScreen('transfers');
    for (const key of ['own', 'sent', 'received']) {
      const tile = byId(tree, `transfers-tile-${key}`) ?? byId(byId(tree, 'transfer-history').props.ListHeaderComponent, `transfers-tile-${key}`);
      const caption = textNodes(tile).find(node => node.props.children === words.tiles[key]);
      const currency = textNodes(tile).find(node => node.props.children === 'AED');
      assert.ok(caption && currency, `${label} ${key}: tile has caption and currency`);
      assert.equal(flat(currency.props.style).color, flat(caption.props.style).color,
        `${label} ${key}: the currency label takes the tile's quiet colour, not the sheet's textSecondary`);
    }
  }
});

test('the period chip is one row: label shrinks, chevron stays beside it, 44pt pill', () => {
  const tree = harness({ language: 'en' }).renderScreen('transfers');
  const chip = walk(walk(tree).find(node => node.type === 'BandScaffold').props.nav.trailing).find(node => node.props?.testID === 'transfers-period');
  const style = flat(chip.props.style);
  assert.equal(style.flexDirection, 'row');
  assert.notEqual(style.flexWrap, 'wrap', 'the chevron must never drop onto a second line');
  assert.ok(style.minHeight >= 44);
  assert.ok(style.borderRadius >= 22, 'pill radius');
  const label = textNodes(chip)[0];
  assert.equal(flat(label.props.style).flexShrink, 1, 'the label shrinks, the chevron does not');
});

test('sent and received tiles say counted; your accounts does not', () => {
  const h = harness({ language: 'en', state: { transactions: mixedRows(), accounts: accountsFixture } });
  withReconciliation(h, mixedEntries());
  const tree = h.renderScreen('transfers');
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  for (const key of ['sent', 'received']) {
    const tile = byId(tree, `transfers-tile-${key}`);
    assert.ok(text(tile).includes(words.tiles.counted), key);
    assert.ok(tile.props.accessibilityLabel.includes(words.tiles.counted), `${key} label`);
  }
  assert.ok(!text(byId(tree, 'transfers-tile-own')).includes(words.tiles.counted));
  assert.ok(!byId(tree, 'transfers-tile-own').props.accessibilityLabel.includes(words.tiles.counted));
});

test('a tile that empties the list says so and offers to clear it', () => {
  const rows = [leg('out', 'expense', 'current'), leg('in', 'income', 'savings')];
  const h = harness({ language: 'en', states: { 0: 'sent' }, state: { transactions: rows, accounts: accountsFixture } });
  withReconciliation(h, pairEntries);
  const tree = h.renderScreen('transfers');
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  assert.ok(text(tree).includes(words.emptyTile));
  assert.ok(!text(tree).includes(words.emptyBody));
  byId(tree, 'transfers-clear-tile').props.onPress();
  assert.ok(stateOf(h, null), 'clearing sets the tile back to none');
});

test('a likely pair with both legs queued is one question, asked about the outgoing leg', async () => {
  const rows = [leg('p-in', 'income', 'savings', { date: '2026-09-12' }), leg('p-out', 'expense', 'current', { date: '2026-09-12' }),
    leg('q1', 'expense', 'current', { date: '2026-09-11', amountFils: 8500 })];
  const h = harness({ language: 'en', state: { transactions: rows, accounts: accountsFixture } });
  withReconciliation(h, [
    ['p-in', { id: 'p-in', status: 'likely-own', reason: 'amount-time', counterpartId: 'p-out', candidateIds: [] }],
    ['p-out', { id: 'p-out', status: 'likely-own', reason: 'amount-time', counterpartId: 'p-in', candidateIds: [] }],
    ['q1', { id: 'q1', status: 'ownership-unknown', reason: 'missing-evidence', candidateIds: [] }],
  ], ['p-in', 'p-out', 'q1']);
  const card = byId(h.renderScreen('transfers'), 'transfer-question-card');
  const words = h.deps['@/lib/transfer-activity-copy'].transferActivityCopy('en');
  assert.ok(text(card).includes(words.card.title(2)), 'two movements need an answer, not three entries');
  assert.ok(text(card).includes(words.card.step(1, 2)));
  await byId(card, 'transfer-answer-own').props.onPress();
  assert.equal(h.answers[0].transaction.id, 'p-out');
  assert.equal(h.answers[0].counterpart.id, 'p-in', 'answering own links the other leg');
});
