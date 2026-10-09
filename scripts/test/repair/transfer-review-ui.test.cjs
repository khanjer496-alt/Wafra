'use strict';
// The one Transfers page (src/app/transfers.tsx) answering several transfers at
// once: groups, select mode, the "What is this?" sheet and its batch save.
// Production React components and hooks, explicit native/store/reconciliation
// boundaries. Synthetic ledger rows only; behaviour checks, not device screenshots.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { walk, text } = require('../workflows/workflow-harness.cjs');
const { createHarness } = require('./reference-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const core = require('../build/transfer-reconciliation.js');
const ledger = require('../build/ledger.js');
const plain = value => JSON.parse(JSON.stringify(value));
const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);
const allById = (tree, id) => walk(tree).filter(node => node.props?.testID === id);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const row = (id, overrides = {}) => ({ id, title: 'Bank transfer', type: 'expense', category: 'other', accountId: 'bank',
  amountFils: 12345, date: '2026-09-08', ts: 1788897600000, source: 'sms', ...overrides });
const fingerprint = tx => JSON.stringify([tx.id, tx.amountFils, tx.date, tx.accountId, tx.transferDecision ?? null]);
const flatStyle = style => Object.assign({}, ...[].concat(typeof style === 'function' ? style({ pressed: false }) : style)
  .flat(Infinity).filter(s => s && typeof s === 'object'));
const copyFor = language => load(path.join(root, 'src/lib/transfer-activity-copy.ts'),
  { '@/lib/i18n': { getLanguage: () => language } }).transferActivityCopy(language);

function createPage({ language = 'en', transactions = [row('one'), row('two')], bulk = false, params = {},
  resolveTransfers, resolveTransferBatch, ensureDurable, groupDefinitions, assessments = {}, pending = [], largeText = false } = {}) {
  const events = [], toasts = [], slots = [], refs = [];
  let cursor = 0, refCursor = 0, generation = 1;
  const state = { language, hydrated: true, transactions, monthStartDay: 1,
    accounts: [{ id: 'bank', name: 'Synthetic bank', last4: '1234' }, { id: 'other', name: 'Other bank', last4: '5678' }] };
  const store = { state, getStateGeneration: () => generation, getStateSnapshot: () => state,
    resolveTransfers: async request => { events.push(['resolve', plain(request)]); return resolveTransfers?.(request, state); },
    resolveTransferBatch: async request => { events.push(['batch', plain(request)]); return resolveTransferBatch?.(request, state); },
    ensureDurable: async () => { events.push(['durable']); return ensureDurable?.(state); },
  };
  const react = { useDeferredValue: value => value, useMemo: fn => fn(), useCallback: fn => fn, useEffect() {},
    useRef: initial => { const index = refCursor++; if (!refs[index]) refs[index] = { current: initial }; return refs[index]; },
    useState: initial => {
      const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    } };
  const jsx = (type, props = {}) => typeof type === 'function' ? type(props) : { type, props };
  const native = { View: 'View', Pressable: 'Pressable', Keyboard: { dismiss() {} }, Platform: { OS: 'ios' },
    StyleSheet: { create: styles => styles, hairlineWidth: 1 },
    FlatList: props => jsx('FlatList', { ...props, children: [props.ListHeaderComponent,
      ...(props.data.length ? props.data.map((item, index) => props.renderItem({ item, index })) : [props.ListEmptyComponent])] }),
  };
  // The reconciler is a boundary: one pending group of every row by default, and
  // the person's decisions as it reports them ("not a transfer" has no assessment).
  const reconcile = txs => {
    const definitions = groupDefinitions ?? [{ id: 'group', transactionIds: txs.map(tx => tx.id), bulkEligible: bulk }];
    const groups = definitions.flatMap(definition => {
      const rows = txs.filter(tx => definition.transactionIds.includes(tx.id) && !tx.transferDecision &&
        (!assessments[tx.id] || pending.includes(tx.id)));
      return rows.length ? [{ id: definition.id, transactionIds: rows.map(tx => tx.id), accountId: rows[0].accountId,
        direction: rows[0].type, status: assessments[rows[0].id]?.status ?? 'ownership-unknown', bulkEligible: definition.bulkEligible,
        counterparty: definition.bulkEligible ? { last4: '9876', kind: 'account', bankIdentity: 'synthetic-bank' } : undefined }] : [];
    });
    return { groups, pendingIds: new Set([...groups.flatMap(group => group.transactionIds), ...pending]), internalIds: new Set(),
      byId: new Map(txs.filter(tx => tx.transferDecision?.ownership !== 'none').map(tx => [tx.id, { id: tx.id, candidateIds: [],
        status: tx.transferDecision ? tx.transferDecision.ownership === 'own' ? 'counterpart-missing' : 'confirmed-external' : 'ownership-unknown',
        reason: tx.transferDecision ? 'user' : 'missing-evidence', ...assessments[tx.id] }])) };
  };
  const boundary = name => props => jsx(name, props);
  const deps = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ back: () => events.push(['back']), canGoBack: () => true,
      replace: route => events.push(['replace', route]), push: route => events.push(['route', route]) }),
    Redirect: props => jsx('Redirect', props) },
    '@/lib/store': { useStore: () => store, useStoreSelector: select => select(store), useStoreActions: () => store },
    '@/lib/i18n': { getLanguage: () => language, t: key => key, tf: key => key },
    '@/lib/markets': load(path.join(root, 'src/lib/markets.ts')),
    // Formatting is a boundary stub here; monetary implementation has its own suites.
    '@/lib/ledger-money': { formatMinorUnits: (amount, spec) => (amount / 10 ** spec.exponent).toFixed(spec.exponent) },
    '@/lib/format': { formatAED: amount => `AED ${(amount / 100).toFixed(2)}`, fullDateTime: tx => `${tx.date} ${tx.ts}`,
      shortDate: date => date, shortDateWithYear: date => date, clockTime: tx => tx.ts ? '14:32' : '', toISODate: () => '2026-09-09', formatAmount: amount => (amount / 100).toFixed(2) },
    '@/lib/ledger': { accountDisplayName: ledger.accountDisplayName, transferReconciliationForState: () => undefined },
    '@/lib/period': { inPeriod: date => date.startsWith('2026-09'), isCurrentMonth: () => true, periodLabel: () => 'Sep 2026' },
    '@/lib/period-context': { usePeriod: () => ({ period: { mode: 'month', key: '2026-09' } }) },
    '@/lib/transfer-reconciliation': { ...core, reconcileTransfers: reconcile, transferFingerprint: fingerprint },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-theme': { useTheme: () => ({ cardBorder: '#ccc', primary: '#147', textSecondary: '#555' }) },
    '@/constants/theme': { Fonts: { sansSemi: 'Geist-SemiBold' }, Spacing: { one: 4, two: 8, three: 12, four: 16, five: 20, six: 24 } },
    '@/components/themed-text': { ThemedText: props => jsx('Text', props) },
    '@/components/ui/icon': { Icon: props => jsx('Icon', props) },
    // The E button names itself by its label (its own suite covers the rest).
    '@/components/ui/band/e-button': { EButton: props => jsx('Button', { ...props, accessibilityLabel: props.label, children: props.label }) },
    '@/components/ui/band/band-figure': { BandFigure: boundary('BandFigure') },
    '@/components/ui/action-icon-button': { ActionIconButton: boundary('ActionIconButton') },
    // Row amounts are Money, a formatting boundary here as formatAED is; the sign glyph is kept.
    '@/components/ui/money': { Money: props => jsx('Money', { ...props,
      children: `${props.sign === 'minus' ? '−' : props.sign === 'plus' ? '+' : ''}AED ${(props.fils / 100).toFixed(2)}` }) },
    '@/hooks/use-ledger-money': { useLedgerMoney: () => null },
    // The decorative coin lane is its own suite (transfer-coins); here it is an opaque, hidden child.
    '@/components/transfer-coins/route-coin': { RouteCoinLane: props => jsx('Lane', { ...props, accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants' }) },
    '@/components/ui/text-field': { TextField: props => jsx('TextInput', props) },
    '@/components/ui/toast': { useToast: () => ({ show: (message, options) => { events.push(['toast', message]); toasts.push([message, options]); } }) },
    '@/components/ui/bottom-sheet': { BottomSheet: props => props.visible ? jsx('Sheet', props) : null },
    // The entry's own sheet is its own suite (entry-detail, the answer hook below); here it records what it was opened on.
    '@/components/entry-detail-sheet': { EntryDetailSheet: boundary('EntryDetailSheet') },
    '@/components/period-sheet': { PeriodSheet: boundary('PeriodSheet') },
    // Design language E: the slate band scaffold renders its band, then the sheet, then its footer.
    '@/components/ui/band-scaffold': { BandScaffold: props => jsx('Scaffold', { ...props, children: [props.bandContent, props.children, props.footer] }),
      useBandBottomInset: () => 20 },
    '@/hooks/use-band': { useBand: id => ({ id, band: '#2F6577', onBand: '#F4F1EA', onBandSecondary: '#D6DCD9', sheet: '#F4F1EA', tile: '#3A7486',
      card: '#FBF9F4', rule: '#E3DED2', text: '#16130F', textSecondary: '#57524A', tint: '#2F6577', fill: '#2F6577', onFill: '#F4F1EA',
      glyphGround: '#EDE3CF', statusNear: '#7E5F14', statusNearSoft: '#F1E9D8' }) },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => largeText },
  };
  const src = (name, file) => { deps[name] = load(path.join(root, file), deps); return deps[name]; };
  src('@/lib/transfer-activity-copy', 'src/lib/transfer-activity-copy.ts');
  src('@/lib/transfer-review-copy', 'src/lib/transfer-review-copy.ts');
  src('@/lib/reference-copy', 'src/lib/reference-copy.ts');
  for (const name of ['transfer-activity', 'transfer-people', 'transfer-list', 'transfer-pairs', 'transfer-answer', 'transfer-batch', 'transfer-review-presentation']) {
    src(`@/lib/${name}`, `src/lib/${name}.ts`);
  }
  src('@/components/transfer-coins/coin-cues', 'src/components/transfer-coins/coin-cues.ts');
  src('@/hooks/use-transfer-answer', 'src/hooks/use-transfer-answer.ts');
  src('@/hooks/use-transfer-batch', 'src/hooks/use-transfer-batch.ts');
  for (const name of ['transfer-select-mark', 'transfer-answer-choices', 'transfer-route-row', 'transfer-person-row', 'transfer-question-card',
    'transfer-group-row', 'transfer-answer-sheet']) src(`@/components/transfers/${name}`, `src/components/transfers/${name}.tsx`);
  const screen = load(path.join(root, 'src/app/transfers.tsx'), deps).default;
  const notice = load(path.join(root, 'src/components/transfer-review-notice.tsx'), deps).TransferReviewNotice;
  const render = () => { cursor = 0; refCursor = 0; return screen(); };
  return { render, notice, state, store, events, toasts, deps, words: copyFor(language),
    review: deps['@/lib/transfer-review-copy'].transferReviewCopy(language), setGeneration: value => { generation = value; } };
}

const list = tree => walk(tree).find(node => node.type === 'FlatList');
const transfers0 = () => fs.readFileSync(path.join(root, 'src/app/transfers.tsx'), 'utf8');
const groupRows = tree => walk(tree).filter(node => node.props?.testID?.startsWith('transfer-group-') &&
  node.props.accessibilityRole && !node.props.testID.startsWith('transfer-group-route') && node.props.testID !== 'transfer-group-count' &&
  node.props.testID !== 'transfer-group-entry');
const routeRows = tree => walk(tree).filter(node => node.props?.testID?.startsWith('transfer-row-'));
const sheetOf = h => byId(h.render(), 'transfer-answer-sheet');
const openGroup = (h, id = 'group') => { byId(h.render(), `transfer-group-${id}`).props.onPress(); return sheetOf(h); };
const answerIn = (node, answer) => byId(node, `transfer-answer-${answer}`).props.onPress();
const save = h => byId(sheetOf(h), 'transfer-answer-sheet-save').props.onPress();
const startSelecting = h => byId(h.render(), 'transfers-select').props.onPress();
const footer = h => byId(h.render(), 'transfer-selection-footer');
const detailSheet = tree => walk(tree).find(node => node.type === 'EntryDetailSheet');

// ---- Groups: several entries with the same account and other side ----

for (const language of ['en', 'ar']) {
  test(`${language}: a group is one route row: account → unknown side, signed total, entry count and the open tag`, () => {
    const h = createPage({ language, transactions: [row('one', { title: 'First' }), row('two', { title: 'Second' })] });
    const tree = h.render();
    assert.equal(routeRows(tree).length, 0, 'grouped entries are not listed a second time on their own');
    const group = byId(tree, 'transfer-group-group');
    const route = byId(group, 'transfer-group-route-group');
    const chips = text(route);
    assert.ok(chips.includes('Synthetic bank'), 'the account it left');
    assert.ok(chips.includes('?'), 'an unidentified counterparty is the dashed "?" chip');
    assert.ok(!chips.includes('Counterparty not identified'), 'not the old "Counterparty not identified" line');
    assert.ok(chips.includes('−AED 246.90'), 'money out is signed, as on every Transfers row');
    assert.ok(walk(route).some(node => node.type === 'Lane'), 'the coin lane sits between the chips');
    assert.ok(text(byId(group, 'transfer-group-count')).includes(h.words.group.entries(2)), 'the entries it stands for');
    assert.ok(text(group).includes(h.words.tags.needsAnswer));
    assert.equal(group.props.accessibilityRole, 'button');
    for (const part of ['Synthetic bank', h.words.route.unknown, h.words.group.entries(2), h.words.outgoing, '246.90', h.words.tags.needsAnswer]) {
      assert.ok(group.props.accessibilityLabel.includes(part), part);
    }
    assert.ok(flatStyle(group.props.style).minHeight >= 44);
    // The waiting section heads the list, with Select at its end.
    const head = byId(tree, 'transfers-list-head');
    assert.ok(text(head).includes(h.words.group.section));
    assert.ok(flatStyle(byId(head, 'transfers-select').props.style).minHeight >= 44);
    assert.deepEqual(h.events, [], 'drawing a group never writes');
  });
}

test('a named counterparty is a chip, and money in reads from it to the account', () => {
  const h = createPage({ bulk: true, transactions: [row('a', { type: 'income' }), row('b', { type: 'income' })] });
  const route = text(byId(h.render(), 'transfer-group-route-group'));
  assert.ok(route.includes('••9876'), 'the masked other account the bank named');
  assert.ok(route.indexOf('••9876') < route.indexOf('Synthetic bank'), 'incoming: the other side → your account');
  assert.ok(route.includes('+AED 246.90'));
});

test('catchall rows stay in one bounded, virtualized, source-free list and render without writing', () => {
  const h = createPage({ transactions: [row('a', { raw: 'PRIVATE_SOURCE_MUST_NOT_RENDER' }), row('b')] });
  const tree = h.render();
  assert.equal(walk(tree).find(n => n.type === 'Scaffold').props.band, 'accounts');
  assert.equal(walk(tree).find(n => n.type === 'Scaffold').props.scroll, false);
  assert.ok(list(tree), 'the sheet holds one virtualized list');
  assert.ok(text(tree).includes('·1234'));
  const sheet = openGroup(h);
  assert.ok(!text(sheet).includes('PRIVATE_SOURCE_MUST_NOT_RENDER'));
  assert.ok(!text(h.render()).includes('PRIVATE_SOURCE_MUST_NOT_RENDER'));
  assert.deepEqual(h.events, []);
});

test('a group\'s sheet is "What is this?" with the three answers; nothing is saved until Save', async () => {
  const pending = deferred();
  const h = createPage({ bulk: true, resolveTransferBatch: () => pending.promise });
  let sheet = openGroup(h);
  assert.equal(sheet.props.title, h.words.answers.question);
  // The count, the total, the account and the masked other side, frozen as the person saw them.
  assert.ok(text(sheet).includes('AED 246.90'));
  assert.ok(text(sheet).includes('••9876'));
  assert.ok(text(sheet).includes(h.words.group.entries(2)));
  for (const answer of ['own', 'external', 'none']) assert.ok(byId(sheet, `transfer-answer-${answer}`), answer);
  assert.equal(byId(sheet, 'transfer-answer-sheet-save').props.disabled, true, 'no answer picked yet');
  answerIn(sheet, 'own');
  assert.deepEqual(h.events, [], 'picking an answer is only a preview');
  sheet = sheetOf(h);
  assert.equal(byId(sheet, 'transfer-answer-own').props.accessibilityState.checked, true);
  const saveButton = byId(sheet, 'transfer-answer-sheet-save');
  assert.equal(saveButton.props.accessibilityLabel, h.words.batch.save(2));
  saveButton.props.onPress(); saveButton.props.onPress();
  assert.equal(h.events.filter(event => event[0] === 'batch').length, 1, 'a repeated tap writes once');
  assert.equal(h.events.some(event => event[0] === 'resolve'), false, 'never a legacy multi-id group decision');
  assert.equal(h.events.some(event => event[0] === 'toast'), false);
  assert.deepEqual(h.events[0][1], { decisions: [{ ids: ['one'], ownership: 'own' }, { ids: ['two'], ownership: 'own' }],
    expectedFingerprints: { one: fingerprint(h.state.transactions[0]), two: fingerprint(h.state.transactions[1]) }, expectedGeneration: 1 });
  pending.resolve(); await flush();
  assert.deepEqual(h.events.at(-1), ['toast', h.words.batch.saved(2)]);
  assert.equal(sheetOf(h), undefined);
});

for (const language of ['en', 'ar']) {
  test(`${language}: the answers word money in and money out, each with its effect`, () => {
    for (const type of ['income', 'expense']) {
      const h = createPage({ language, bulk: true, transactions: [row(`${type}-1`, { type }), row(`${type}-2`, { type })] });
      const choice = byId(openGroup(h), 'transfer-answer-external');
      const words = h.words.answers;
      assert.ok(choice.props.accessibilityLabel.includes(type === 'income' ? words.in.external : words.out.external));
      assert.ok(choice.props.accessibilityLabel.includes(words.effect.external(type === 'income')));
      assert.deepEqual(h.events, []);
    }
  });
}

test('save submits the latest answer explicitly, including a changed answer, through the batch path', async () => {
  // The production transform misbound a default parameter that shared the
  // body-local `selection` name. Source execution alone did not catch it.
  const hook = fs.readFileSync(path.join(root, 'src/hooks/use-transfer-batch.ts'), 'utf8');
  assert.match(hook, /const save = async \(target: TransferBatch \| null\) => \{\n    const selection = target;/);
  assert.match(fs.readFileSync(path.join(root, 'src/app/transfers.tsx'), 'utf8'), /onSave=\{\(\) => void batch\.save\(batch\.batch\)\}/);
  const h = createPage({ bulk: true });
  answerIn(openGroup(h), 'own');
  answerIn(sheetOf(h), 'external');
  save(h); await flush();
  const batches = h.events.filter(event => event[0] === 'batch');
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0][1].decisions, [{ ids: ['one'], ownership: 'external' }, { ids: ['two'], ownership: 'external' }]);
  assert.equal(sheetOf(h), undefined);
});

test('"Not a transfer" for a group is saved for each entry, and is never "someone else"', async () => {
  const h = createPage({ bulk: true });
  answerIn(openGroup(h), 'none');
  save(h); await flush();
  const request = h.events.find(event => event[0] === 'batch')[1];
  assert.deepEqual(request.decisions.map(decision => decision.ownership), ['none', 'none']);
});

test('changed ledger fingerprints block saving and keep the original preview', () => {
  const h = createPage({ bulk: true });
  answerIn(openGroup(h), 'external');
  h.state.transactions = h.state.transactions.map(tx => tx.id === 'one' ? { ...tx, amountFils: 55500 } : tx);
  const sheet = sheetOf(h);
  assert.equal(byId(sheet, 'transfer-answer-sheet-save').props.disabled, true);
  assert.ok(text(byId(sheet, 'transfer-answer-sheet-error')).includes(h.words.batch.changed));
  assert.ok(text(byId(sheet, 'transfer-answer-sheet-route')).includes('AED 246.90'), 'the total the person saw');
  byId(sheet, 'transfer-answer-sheet-save').props.onPress();
  assert.deepEqual(h.events, []);
});

test('a rejected save keeps a visible error and never announces success', async () => {
  const h = createPage({ bulk: true, resolveTransferBatch: async () => { throw new Error('stale'); } });
  answerIn(openGroup(h), 'own');
  save(h); await flush();
  const sheet = sheetOf(h);
  assert.ok(sheet);
  assert.ok(text(byId(sheet, 'transfer-answer-sheet-error')).includes(h.words.batch.failed));
  assert.equal(h.events.some(event => event[0] === 'toast'), false);
});

for (const message of ['Transfer review is out of date', 'Transfer review changed; open it again']) {
  test(`the store refusing a moved ledger ("${message}") says the transfers changed, not "couldn't save"`, async () => {
    const h = createPage({ bulk: true, resolveTransferBatch: async () => { throw new Error(message); } });
    answerIn(openGroup(h), 'own');
    save(h); await flush();
    const error = text(byId(sheetOf(h), 'transfer-answer-sheet-error'));
    assert.ok(error.includes(h.words.batch.changed));
    assert.ok(!error.includes(h.words.batch.failed));
    assert.equal(h.events.some(event => event[0] === 'toast'), false);
  });
}

test('a failed durable write keeps the sheet and retries persistence without applying the answer twice', async () => {
  const retry = deferred();
  const h = createPage({ bulk: true, resolveTransferBatch: async (_request, state) => {
    state.transactions = state.transactions.map(tx => ({ ...tx, transferDecision: { version: 1, ownership: 'own', decidedAt: 1 } }));
    throw Object.assign(new Error('write failed'), { code: 'transfer-durability',
      expectedFingerprints: Object.fromEntries(state.transactions.map(tx => [tx.id, fingerprint(tx)])) });
  }, ensureDurable: () => retry.promise });
  answerIn(openGroup(h), 'own');
  save(h); await flush();
  let tree = h.render();
  let sheet = byId(tree, 'transfer-answer-sheet');
  assert.ok(sheet); assert.equal(sheet.props.dismissible, false);
  assert.ok(text(sheet).includes(h.words.batch.durability));
  assert.equal(byId(sheet, 'transfer-answer-sheet-cancel').props.disabled, true);
  assert.equal(walk(tree).find(n => n.type === 'Scaffold').props.nav.backDisabled, true, 'the page cannot be left mid-retry');
  sheet.props.onClose(); assert.ok(sheetOf(h), 'it cannot be dismissed');
  assert.equal(byId(sheet, 'transfer-answer-sheet-save').props.accessibilityLabel, h.words.batch.retry);
  assert.equal(byId(sheet, 'transfer-answer-own').props.accessibilityState.disabled, true, 'the applied answer cannot be changed');
  // Opening one entry on its own would close the sheet mid-retry: it waits until the answer is saved.
  const entry = allById(sheet, 'transfer-group-entry')[0];
  assert.equal(entry.props.disabled, true, 'Open this entry on its own waits for the retry');
  entry.props.onPress();
  assert.ok(sheetOf(h), 'the sheet stays');
  assert.equal(detailSheet(h.render()).props.transaction, null, 'no entry opened over a pending retry');
  byId(sheet, 'transfer-answer-sheet-save').props.onPress();
  assert.equal(h.events.filter(event => event[0] === 'batch').length, 1);
  assert.equal(h.events.filter(event => event[0] === 'durable').length, 1);
  assert.equal(h.events.some(event => event[0] === 'toast'), false);
  retry.resolve(); await flush(); tree = h.render();
  assert.equal(byId(tree, 'transfer-answer-sheet'), undefined);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.batch.saved(2)]);
});

test('a restored ledger invalidates even a pending durability retry', async () => {
  const h = createPage({ bulk: true, resolveTransferBatch: async (_request, state) => { throw Object.assign(new Error('write'), { code: 'transfer-durability',
    expectedFingerprints: Object.fromEntries(state.transactions.map(tx => [tx.id, fingerprint(tx)])) }); } });
  answerIn(openGroup(h), 'own');
  save(h); await flush();
  h.setGeneration(2);
  const sheet = sheetOf(h);
  assert.equal(byId(sheet, 'transfer-answer-sheet-save').props.disabled, true);
  assert.ok(text(byId(sheet, 'transfer-answer-sheet-error')).includes(h.words.batch.changed));
  assert.equal(byId(sheet, 'transfer-answer-sheet-cancel').props.disabled, false);
  assert.equal(h.events.some(event => event[0] === 'durable'), false);
});

for (const change of ['edit', 'delete']) {
  test(`${change} during failed storage invalidates retry against fresh state before rendering`, async () => {
    const h = createPage({ bulk: true, resolveTransferBatch: async (_request, state) => {
      state.transactions = state.transactions.map(tx => ({ ...tx, transferDecision: { version: 1, ownership: 'own', decidedAt: 3 } }));
      throw Object.assign(new Error('write'), { code: 'transfer-durability',
        expectedFingerprints: Object.fromEntries(state.transactions.map(tx => [tx.id, fingerprint(tx)])) });
    } });
    answerIn(openGroup(h), 'own');
    save(h); await flush();
    const retry = byId(sheetOf(h), 'transfer-answer-sheet-save');
    h.state.transactions = change === 'delete' ? [] : h.state.transactions.map(tx => ({ ...tx, amountFils: 45678 }));
    retry.props.onPress(); await flush();
    assert.equal(h.events.some(event => event[0] === 'durable'), false);
    assert.equal(h.events.some(event => event[0] === 'toast'), false);
    assert.ok(text(byId(sheetOf(h), 'transfer-answer-sheet-error')).includes(h.words.batch.changed));
  });
}

test('Cancel leaves the entries unanswered: no write, no announcement', () => {
  const h = createPage();
  const before = plain(h.state.transactions);
  openGroup(h);
  byId(sheetOf(h), 'transfer-answer-sheet-cancel').props.onPress();
  assert.equal(sheetOf(h), undefined);
  assert.deepEqual(plain(h.state.transactions), before);
  assert.deepEqual(h.events, []);
});

test('a saved group answer offers Undo, which clears each entry from its current state', async () => {
  const h = createPage({ bulk: true, resolveTransferBatch: async (request, state) => {
    if (request.decisions[0].ownership === null) return;
    // One stamp per save, as the store's batch write does (request.now); a stamp per row can tick between rows.
    const decidedAt = Date.now();
    state.transactions = state.transactions.map(tx => ({ ...tx, transferDecision: { version: 1, ownership: 'own', decidedAt } }));
  } });
  answerIn(openGroup(h), 'own');
  save(h); await flush();
  const [message, options] = h.toasts.at(-1);
  assert.equal(message, h.words.batch.saved(2));
  const undo = options.actions.find(action => action.label === h.words.answers.undo);
  assert.ok(undo, 'the toast carries Undo');
  undo.onPress(); await flush(); await flush();
  const request = h.events.filter(event => event[0] === 'batch').at(-1)[1];
  assert.deepEqual(request.decisions, [{ ids: ['one'], ownership: null }, { ids: ['two'], ownership: null }]);
  assert.deepEqual(request.expectedFingerprints, Object.fromEntries(h.state.transactions.map(tx => [tx.id, fingerprint(tx)])),
    'Undo guards the rows as they are after the answer');
  assert.deepEqual(h.events.at(-1), ['toast', h.words.answers.undone]);
});

test('Undo never clears an answer given since the save: it says the transfers changed', async () => {
  const h = createPage({ bulk: true, resolveTransferBatch: async (request, state) => {
    if (request.decisions[0].ownership === null) return;
    // One stamp per save, as the store's batch write does (request.now); a stamp per row can tick between rows.
    const decidedAt = Date.now();
    state.transactions = state.transactions.map(tx => ({ ...tx, transferDecision: { version: 1, ownership: 'own', decidedAt } }));
  } });
  answerIn(openGroup(h), 'own');
  save(h); await flush();
  const undo = h.toasts.at(-1)[1].actions.find(action => action.label === h.words.answers.undo);
  // A newer answer to one entry (its own sheet, another device's restore) lands before Undo is pressed.
  h.state.transactions = h.state.transactions.map(tx => tx.id === 'two'
    ? { ...tx, transferDecision: { version: 1, ownership: 'external', decidedAt: 9 } } : tx);
  const batches = h.events.filter(event => event[0] === 'batch').length;
  undo.onPress(); await flush(); await flush();
  assert.equal(h.events.filter(event => event[0] === 'batch').length, batches, 'nothing is cleared');
  assert.deepEqual(h.events.at(-1), ['toast', h.words.answers.changed]);
  assert.equal(h.state.transactions.find(tx => tx.id === 'two').transferDecision.ownership, 'external', 'the newer answer stays');
});

test('while Undo runs the page knows: its controls wait until it is done', async () => {
  const undoing = deferred();
  const h = createPage({ bulk: true, transactions: [row('one'), row('two'), row('three', { accountId: 'other' })],
    groupDefinitions: [{ id: 'group', transactionIds: ['one', 'two'], bulkEligible: true }, { id: 'solo', transactionIds: ['three'], bulkEligible: false }],
    resolveTransferBatch: async (request, state) => {
      if (request.decisions[0].ownership === null) return undoing.promise;
      const decidedAt = Date.now();
      state.transactions = state.transactions.map(tx => tx.id === 'three' ? tx
        : { ...tx, transferDecision: { version: 1, ownership: 'own', decidedAt } });
    } });
  // The page's real answer hook keeps its busy flag in state; this harness re-renders from its slots.
  answerIn(openGroup(h), 'own');
  save(h); await flush();
  const undo = h.toasts.at(-1)[1].actions.find(action => action.label === h.words.answers.undo);
  undo.onPress(); await flush();
  const tree = h.render();
  assert.equal(byId(tree, 'transfers-select').props.disabled, true, 'Select waits');
  assert.equal(walk(tree).find(n => n.type === 'Scaffold').props.nav.backDisabled, true, 'leaving waits');
  assert.equal(byId(byId(tree, 'transfer-question-card'), 'transfer-answer-own').props.disabled, true, 'the question card waits');
  undoing.resolve(); await flush(); await flush();
  assert.equal(byId(h.render(), 'transfers-select').props.disabled, false, 'and comes back once Undo is done');
});

test('3,106 waiting entries stay one bounded group row; its entries page 20 at a time', () => {
  const h = createPage({ transactions: Array.from({ length: 3106 }, (_, i) => row(`old-${i}`, { date: '2022-11-05' })) });
  let tree = h.render();
  assert.equal(groupRows(tree).length, 1);
  assert.equal(routeRows(tree).length, 0);
  assert.equal(list(tree).props.data.length, 1, 'one list item, whatever the history');
  assert.equal(byId(tree, 'transfer-scope-all'), undefined, 'no second transfer-history mode');
  assert.ok(text(byId(tree, 'transfer-group-count')).includes(h.words.group.entries(3106)));
  let sheet = openGroup(h);
  assert.equal(allById(sheet, 'transfer-group-entry').length, 20);
  walk(sheet).find(node => node.props?.accessibilityLabel === h.words.group.more(20, 3106)).props.onPress();
  sheet = sheetOf(h);
  assert.equal(allById(sheet, 'transfer-group-entry').length, 40);
  // A catch-all group ("Account → ?") is never answered whole: its sheet lists the entries only.
  assert.equal(byId(sheet, 'transfer-answer-sheet-save'), undefined);
  assert.equal(byId(sheet, 'transfer-answer-own'), undefined);
  byId(sheet, 'transfer-answer-sheet-cancel').props.onPress();
  walk(h.render()).find(node => node.type === 'TextInput').props.onChangeText('Synthetic');
  tree = h.render();
  assert.equal(groupRows(tree).length, 1, 'search narrows the group, it does not unfold it');
  walk(h.render()).find(node => node.type === 'TextInput').props.onChangeText('nothing like this');
  assert.equal(groupRows(h.render()).length, 0);
  assert.deepEqual(h.events, []);
  assert.equal(h.state.transactions.length, 3106);
});

test('one entry of a group can still be answered on its own', () => {
  const h = createPage({ transactions: [row('a'), row('b', { title: 'Second' })] });
  const sheet = openGroup(h);
  const entry = allById(sheet, 'transfer-group-entry').find(node => node.props.accessibilityLabel.includes('Second'));
  assert.ok(entry.props.accessibilityLabel.includes(h.words.group.openEntry));
  entry.props.onPress();
  const tree = h.render();
  assert.equal(byId(tree, 'transfer-answer-sheet'), undefined, 'the group sheet gives way');
  assert.equal(detailSheet(tree).props.transaction.id, 'b', 'that entry\'s own "What is this?" opens');
  assert.deepEqual(h.events, []);
});

// ---- The card-repayment suggestion: "Linked to …" under the own answer ----

for (const language of ['en', 'ar']) {
  test(`${language}: a likely card repayment shows its matching card as "Looks like your …" under the own answer, never "Linked to"`, () => {
    const card = { id: 'card', name: 'ADCB Credit Card', last4: '7720' };
    const transactions = [row('r1', { date: '2026-09-02' }), row('r2', { date: '2026-09-05' }),
      row('c1', { type: 'income', accountId: 'card', title: 'Payment received' }), row('c2', { type: 'income', accountId: 'card', title: 'Payment received' })];
    const likely = (id, counterpartId) => ({ id, status: 'likely-card-repayment', reason: 'amount-time', counterpartId, candidateIds: [counterpartId] });
    const h = createPage({ language, transactions, pending: ['r1', 'r2'],
      groupDefinitions: [{ id: 'liv', transactionIds: ['r1', 'r2'], bulkEligible: false }],
      assessments: { r1: likely('r1', 'c1'), r2: likely('r2', 'c2'), c1: { status: 'card-repayment' }, c2: { status: 'card-repayment' } } });
    h.state.accounts.push(card);
    const tree = h.render();
    const group = byId(tree, 'transfer-group-liv');
    const label = ledger.accountDisplayName(card);
    assert.ok(text(group).includes(h.words.answers.looksLike(label)), 'the row says which card it looks like');
    const sheet = openGroup(h, 'liv');
    const suggestion = byId(sheet, 'transfer-answer-own-suggestion');
    assert.ok(text(suggestion).includes(h.words.answers.looksLike(label)));
    assert.ok(text(suggestion).includes(h.words.answers.suggestedOnly), 'a suggestion, said to be one');
    assert.ok(byId(sheet, 'transfer-answer-own').props.accessibilityLabel.includes(h.words.answers.looksLike(label)));
    // Answered "own", it is saved without a pair link, so it is never said to be linked.
    assert.ok(!text(sheet).includes(h.words.route.linked(label)), 'a suggestion is never "Linked to"');
    // Each entry names its matching card payment: account, what, when and how much (the old "matching bank entry").
    // No-break spaces keep a date or an amount on one line; read them as spaces here.
    const matches = allById(sheet, 'transfer-group-entry-match').map(node => text(node).replace(/\u00a0/g, ' '));
    assert.equal(matches.length, 2);
    for (const match of matches) {
      assert.ok(match.includes(h.words.answers.looksLike(label).replace(/\u00a0/g, ' ')) && match.includes('Payment received') && match.includes('AED 123.45'), match);
      // The app's short date and clock (format.ts shortDateWithYear + clockTime), each part isolated.
      assert.match(match, language === 'ar' ? /\u2067\u20682026-09-0\d\u2069، \u2068\d\d:\d\d\u2069\u2069/ : /\u2066\u20682026-09-0\d\u2069, \u2068\d\d:\d\d\u2069\u2069/, 'its date and time, with the language comma');
    }
    // Not the old verbose block or the retired sheet's words, which are gone from the copy too.
    for (const old of ['Matching bank entry', 'Matching amount and timing are a suggestion', 'Possible credit-card repayment',
      'Check a transfer', 'What was this transfer?', 'Save classification', 'Leave as recorded', 'Match as transfer', 'Not a pair']) {
      assert.ok(!text(sheet).includes(old), old);
      assert.ok(!text(h.render()).includes(old), old);
    }
  });
}

// ---- Deep links (old Review transfers links) ----

test('/review-transfers redirects to Transfers, carrying a linked entry', () => {
  const redirect = params => {
    const h = createPage({ params });
    return load(path.join(root, 'src/app/review-transfers.tsx'), h.deps).default();
  };
  assert.deepEqual(plain(redirect({ transactionId: 'one' }).props.href), { pathname: '/transfers', params: { transactionId: 'one' } });
  assert.equal(redirect({}).props.href, '/transfers');
  assert.deepEqual(plain(redirect({ transactionId: ['two', 'x'] }).props.href.params), { transactionId: 'two' });
});

test('a link to one entry opens its "What is this?" on Transfers; closing shows the whole page', () => {
  const h = createPage({ transactions: [row('a'), row('b', { accountId: 'other' })], params: { transactionId: 'b' },
    groupDefinitions: [{ id: 'a', transactionIds: ['a'], bulkEligible: false }, { id: 'b', transactionIds: ['b'], bulkEligible: false }] });
  let tree = h.render();
  assert.equal(detailSheet(tree).props.transaction.id, 'b');
  assert.equal(detailSheet(tree).props.transferAssessment.status, 'ownership-unknown');
  detailSheet(tree).props.onClose();
  tree = h.render();
  assert.equal(detailSheet(tree).props.transaction, null);
  assert.deepEqual(routeRows(tree).map(node => node.props.testID).sort(), ['transfer-row-a', 'transfer-row-b']);
  assert.deepEqual(h.events, [], 'opening a link never classifies');
});

// Owner decision (Transfers grouped by person): a generic unknown is kept out of the totals, so it is asked about.
test('a link to a low-signal transfer opens it; it needs an answer and select mode reaches it', () => {
  const tx = row('low-signal');
  const h = createPage({ transactions: [tx], params: { transactionId: tx.id }, groupDefinitions: [] });
  const tree = h.render();
  assert.equal(detailSheet(tree).props.transaction.id, tx.id, 'the requested record is reachable despite no pending group');
  assert.deepEqual(h.events, [], 'opening the route cannot classify a record');
  const page = createPage({ transactions: [tx], groupDefinitions: [] });
  const general = page.render();
  assert.equal(byId(general, 'transfer-question-card'), undefined, 'an unnamed one-off is not walked by the card');
  const link = byId(general, 'transfers-review-link');
  assert.ok(link && text(link).includes(copyFor('en').card.title(1)), 'but it is counted, and select mode answers it');
  link.props.onPress();
  assert.ok(byId(page.render(), 'transfer-selection-footer'));
  assert.equal(groupRows(general).length, 0, 'it names nobody: no person, no group');
  const rowNode = byId(general, 'transfer-row-low-signal');
  assert.ok(text(rowNode).includes(copyFor('en').tags.needsAnswer), 'one term for every unanswered transfer');
});

test('a link to a missing entry or a non-transfer opens nothing and says so', () => {
  const missing = createPage({ params: { transactionId: 'deleted-entry' } }).render();
  assert.equal(detailSheet(missing).props.transaction, null, 'a stale route cannot open or classify another row');
  assert.ok(text(byId(missing, 'transfers-link-notice')).includes(copyFor('en').link.missing));
  const salary = createPage({ transactions: [row('salary', { title: 'Salary', category: 'salary' })],
    params: { transactionId: 'salary' }, groupDefinitions: [] });
  const tree = salary.render();
  assert.equal(detailSheet(tree).props.transaction, null);
  assert.ok(text(byId(tree, 'transfers-link-notice')).includes(salary.words.link.notTransfer));
  byId(tree, 'transfers-link-notice').props.onPress();
  assert.equal(byId(salary.render(), 'transfers-link-notice'), undefined, 'the notice can be dismissed');
});

test('a row answered "not a transfer" is never listed as "with someone else"', () => {
  const external = row('external', { transferDecision: { version: 1, ownership: 'external', decidedAt: 2 } });
  const declined = row('declined', { transferDecision: { version: 1, ownership: 'none', decidedAt: 3 } });
  const h = createPage({ transactions: [external, declined] });
  const tree = h.render();
  assert.deepEqual(routeRows(tree).map(node => node.props.testID), ['transfer-row-external']);
  assert.ok(text(byId(tree, 'transfer-row-external')).includes(h.words.tags.external), 'the real external answer still reads as one');
  assert.equal(groupRows(tree).length, 0, 'the declined row waits nowhere');
  assert.ok(!text(tree).includes('declined'));
});

// ---- Select several ----

function manyPairs(count = 2, extra = () => ({})) {
  const transactions = [], assessments = {}, pending = [];
  for (let i = 0; i < count; i++) {
    const out = `out-${i}`, into = `in-${i}`, amountFils = 12345 + i * 100;
    transactions.push(row(out, { amountFils, ...extra(i) }), row(into, { type: 'income', accountId: 'other', amountFils, ...extra(i) }));
    assessments[out] = { status: 'likely-own', reason: 'amount-time', counterpartId: into, candidateIds: [into] };
    assessments[into] = { status: 'likely-own', reason: 'amount-time', counterpartId: out, candidateIds: [out] };
    pending.push(out, into);
  }
  return { transactions, assessments, pending, groupDefinitions: [] };
}
const pairChecks = h => routeRows(h.render()).filter(node => node.props.testID.includes('|'));

for (const language of ['en', 'ar']) {
  test(`${language}: selected pairs save in one durable batch, with reciprocal links and a repeated-tap guard`, async () => {
    const pending = deferred();
    const h = createPage({ ...manyPairs(), language, resolveTransferBatch: () => pending.promise });
    assert.equal(byId(h.render(), 'transfer-selection-footer'), undefined, 'no select bar until Select');
    startSelecting(h);
    assert.equal(byId(h.render(), 'transfer-question-card'), undefined, 'select mode lists; it does not ask one at a time');
    assert.equal(pairChecks(h).length, 2, 'a suggested pair is one selectable route');
    pairChecks(h)[0].props.onPress(); pairChecks(h)[1].props.onPress();
    assert.equal(pairChecks(h).every(n => n.props.accessibilityRole === 'checkbox' && n.props.accessibilityState.checked), true);
    assert.equal(pairChecks(h).every(n => n.props['aria-checked']), true, 'web exposes the checked state');
    assert.deepEqual(h.events, [], 'ticking a row never changes the ledger');
    assert.ok(text(footer(h)).includes(h.words.select.selected(2)));
    answerIn(footer(h), 'own');
    const sheet = sheetOf(h);
    assert.equal(allById(sheet, 'transfer-batch-preview-item').length, 2);
    assert.equal(byId(sheet, 'transfer-answer-own').props.accessibilityState.checked, true, 'the bar\'s answer is preselected');
    const saveButton = byId(sheet, 'transfer-answer-sheet-save');
    assert.equal(saveButton.props.accessibilityLabel, h.words.batch.save(4), 'both legs of both pairs');
    saveButton.props.onPress(); saveButton.props.onPress();
    assert.equal(h.events.filter(e => e[0] === 'batch').length, 1);
    const request = h.events[0][1];
    assert.deepEqual(request.decisions.map(d => [d.ids.length, d.ids[0], d.counterpartId, d.ownership]).sort(),
      [[1, 'out-0', 'in-0', 'own'], [1, 'out-1', 'in-1', 'own']]);
    assert.deepEqual(Object.keys(request.expectedFingerprints).sort(), ['in-0', 'in-1', 'out-0', 'out-1']);
    assert.equal(request.expectedGeneration, 1);
    assert.equal(h.events.some(e => e[0] === 'toast'), false);
    pending.resolve(); await flush();
    assert.equal(sheetOf(h), undefined);
    assert.equal(byId(h.render(), 'transfer-selection-footer'), undefined, 'select mode ends with the save');
    assert.deepEqual(h.events.at(-1), ['toast', h.words.batch.saved(4)]);
  });
}

test('a suggested pair answered "someone else" answers both legs, each alone and never linked', async () => {
  const h = createPage(manyPairs(1));
  startSelecting(h);
  pairChecks(h)[0].props.onPress();
  // A pair moves money out of one account and into another: its answers are worded for both directions.
  const bar = byId(footer(h), 'transfer-answer-external');
  assert.ok(bar.props.accessibilityLabel.includes(h.words.answers.mixed.external));
  assert.ok(!bar.props.accessibilityLabel.includes(h.words.answers.out.external), 'not the outgoing-only wording');
  answerIn(footer(h), 'external');
  const choice = byId(sheetOf(h), 'transfer-answer-external');
  assert.ok(choice.props.accessibilityLabel.includes(h.words.answers.mixed.external));
  assert.ok(choice.props.accessibilityLabel.includes(h.words.answers.mixedEffect.external));
  assert.ok(!choice.props.accessibilityLabel.includes(h.words.answers.out.external));
  save(h); await flush();
  const request = h.events.find(e => e[0] === 'batch')[1];
  assert.deepEqual(request.decisions, [{ ids: ['out-0'], ownership: 'external' }, { ids: ['in-0'], ownership: 'external' }]);
});

test('ticked groups and entries enter as single-entry decisions, never a catchall group decision', async () => {
  const h = createPage({ transactions: [row('a'), row('b', { accountId: 'other' }), row('untouched', { date: '2026-09-07' })],
    groupDefinitions: [{ id: 'a', transactionIds: ['a', 'untouched'], bulkEligible: true },
      { id: 'b', transactionIds: ['b'], bulkEligible: false }] });
  startSelecting(h);
  byId(h.render(), 'transfer-group-a').props.onPress();
  byId(h.render(), 'transfer-row-b').props.onPress();
  answerIn(footer(h), 'own');
  save(h); await flush();
  assert.equal(h.events.filter(e => e[0] === 'batch').length, 1);
  const request = h.events[0][1];
  assert.equal(request.decisions.every(d => d.ids.length === 1 && !d.counterpartId), true);
  assert.deepEqual(request.decisions.flatMap(d => d.ids).sort(), ['a', 'b', 'untouched']);
  assert.equal(Object.keys(request.expectedFingerprints).length, 3);
});

test('Select all obeys search and Clear leaves the ledger unchanged', () => {
  const h = createPage(manyPairs(12, i => ({ title: `Transfer ref ${i}x`,
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source' } })));
  startSelecting(h);
  walk(h.render()).find(node => node.type === 'TextInput').props.onChangeText('ref 3x');
  assert.equal(pairChecks(h).length, 1);
  assert.equal(byId(h.render(), 'transfer-select-shown').props.accessibilityLabel, h.words.select.all(1));
  byId(h.render(), 'transfer-select-shown').props.onPress();
  assert.equal(pairChecks(h)[0].props.accessibilityState.checked, true);
  walk(h.render()).find(node => node.type === 'TextInput').props.onChangeText('');
  assert.equal(pairChecks(h).filter(n => n.props.accessibilityState.checked).length, 1);
  byId(h.render(), 'transfer-clear-selection').props.onPress();
  assert.ok(text(footer(h)).includes(h.words.select.none));
  assert.equal(byId(footer(h), 'transfer-answer-own'), undefined, 'no answers to press with nothing ticked');
  assert.deepEqual(h.events, []);
});

test('300 suggested pairs are list items, never eagerly mounted in the list header', () => {
  const h = createPage(manyPairs(300));
  startSelecting(h);
  const flat = list(h.render());
  assert.equal(flat.props.data.filter(item => item.key?.includes('|')).length, 300);
  assert.equal(walk(flat.props.ListHeaderComponent).filter(n => n.props?.testID?.startsWith('transfer-row-')).length, 0);
  assert.ok(flat.props.initialNumToRender <= 14);
  assert.ok(flat.props.maxToRenderPerBatch <= 10);
});

test('a ticked transfer keeps its original preview and blocks the whole batch if a leg changes', async () => {
  const h = createPage(manyPairs());
  startSelecting(h); byId(h.render(), 'transfer-select-shown').props.onPress();
  h.state.transactions = h.state.transactions.map(tx => tx.id === 'in-1' ? { ...tx, amountFils: 99999 } : tx);
  answerIn(footer(h), 'own');
  const sheet = sheetOf(h);
  assert.ok(text(sheet).includes('AED 124.45'));
  assert.ok(!text(sheet).includes('AED 999.99'));
  assert.equal(byId(sheet, 'transfer-answer-sheet-save').props.disabled, true);
  byId(sheet, 'transfer-answer-sheet-save').props.onPress(); await flush();
  assert.equal(h.events.some(e => e[0] === 'batch'), false);
});

test('a restore between ticking and answering invalidates the selection', () => {
  const h = createPage(manyPairs());
  startSelecting(h); byId(h.render(), 'transfer-select-shown').props.onPress();
  h.setGeneration(2);
  answerIn(footer(h), 'own');
  assert.equal(sheetOf(h), undefined);
  assert.deepEqual(h.events, [['toast', h.words.batch.changed]]);
});

test('batch storage failure retries the write once without reapplying any selected decisions', async () => {
  const h = createPage({ ...manyPairs(), resolveTransferBatch: async (_request, state) => {
    state.transactions = state.transactions.map(tx => ({ ...tx, transferDecision: { version: 1, ownership: 'own', decidedAt: 1 } }));
    throw Object.assign(new Error('write failed'), { code: 'transfer-durability',
      expectedFingerprints: Object.fromEntries(state.transactions.map(tx => [tx.id, fingerprint(tx)])) });
  } });
  startSelecting(h); byId(h.render(), 'transfer-select-shown').props.onPress();
  answerIn(footer(h), 'own');
  save(h); await flush();
  const sheet = sheetOf(h);
  assert.equal(sheet.props.dismissible, false);
  assert.equal(byId(sheet, 'transfer-answer-sheet-cancel').props.disabled, true);
  assert.equal(byId(h.render(), 'transfer-cancel-selection').props.disabled, true, 'select mode cannot be left mid-retry');
  byId(sheet, 'transfer-answer-sheet-save').props.onPress(); await flush();
  assert.equal(h.events.filter(e => e[0] === 'batch').length, 1);
  assert.equal(h.events.filter(e => e[0] === 'durable').length, 1);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.batch.saved(4)]);
});

test('mixed money in and out are answered with words for both directions', () => {
  const h = createPage({ transactions: [row('out'), row('in', { type: 'income', accountId: 'other' })],
    groupDefinitions: [{ id: 'o', transactionIds: ['out'], bulkEligible: false }, { id: 'i', transactionIds: ['in'], bulkEligible: false }] });
  startSelecting(h);
  byId(h.render(), 'transfer-select-shown').props.onPress();
  const own = byId(footer(h), 'transfer-answer-own');
  assert.ok(own.props.accessibilityLabel.includes(h.words.answers.mixed.own));
  assert.ok(own.props.accessibilityLabel.includes(h.words.answers.mixedEffect.own));
});

test('select controls, the bar and the sheet use the Transfers page\'s buttons; previews are routes', () => {
  const h = createPage(manyPairs());
  startSelecting(h);
  let tree = h.render();
  for (const id of ['transfer-select-shown', 'transfer-cancel-selection']) {
    const style = flatStyle(byId(tree, id).props.style);
    assert.ok(style.minHeight >= 44 && style.borderRadius === 14, id);
  }
  byId(tree, 'transfer-select-shown').props.onPress();
  const own = byId(footer(h), 'transfer-answer-own');
  assert.ok(flatStyle(own.props.style).minHeight >= 44, 'the bar\'s answers are the question card\'s 48pt buttons');
  assert.equal(flatStyle(own.props.style).backgroundColor, '#2F6577', 'the first answer is the band fill');
  answerIn(footer(h), 'own');
  const items = allById(sheetOf(h), 'transfer-batch-preview-item');
  assert.ok(items.every(item => walk(item).some(node => node.type === 'Lane')), 'each ticked transfer is drawn as its route');
  assert.ok(byId(sheetOf(h), 'transfer-answer-sheet-save').props.palette, 'Save is an E button');
  assert.deepEqual(h.events, [], 'restyling never writes');
});

test('large text stacks the routes, the controls and the answer buttons', () => {
  const h = createPage({ ...manyPairs(1), largeText: true });
  startSelecting(h);
  const tree = h.render();
  assert.equal(flatStyle(byId(tree, 'transfer-route-out-0|in-0').props.style).flexDirection, 'column');
  const controls = walk(tree).find(node => node.props?.children?.some?.(child => child?.props?.testID === 'transfer-select-shown'));
  assert.equal(flatStyle(controls.props.style).flexDirection, 'column');
  assert.equal(flatStyle(byId(tree, 'transfer-select-shown').props.style).alignSelf, 'stretch');
  byId(tree, 'transfer-select-shown').props.onPress();
  const bar = walk(footer(h)).find(node => node.props?.accessibilityRole === 'radiogroup');
  assert.equal(flatStyle(bar.props.style).flexDirection, 'column');
  const grouped = createPage({ largeText: true });
  assert.equal(flatStyle(byId(grouped.render(), 'transfer-group-route-group').props.style).flexDirection, 'column');
});

test('select mode: a group is one tick; no checkbox outside select mode; Select all counts what has one', async () => {
  const h = createPage({ transactions: [row('a'), row('b', { accountId: 'other' }), row('c')],
    groupDefinitions: [{ id: 'one', transactionIds: ['b'], bulkEligible: false }, { id: 'two', transactionIds: ['a', 'c'], bulkEligible: true }] });
  let tree = h.render();
  assert.equal(byId(tree, 'transfer-group-two').props.accessibilityRole, 'button', 'no checkbox outside select mode');
  assert.ok(byId(byId(tree, 'transfer-group-two'), 'transfer-group-count'), 'several entries keep their count');
  assert.ok(byId(tree, 'transfer-row-b'), 'a lone listed entry is its own row');
  startSelecting(h); tree = h.render();
  const group = byId(tree, 'transfer-group-two');
  assert.equal(group.props.accessibilityRole, 'checkbox');
  assert.ok(group.props.accessibilityLabel.startsWith(h.words.select.item));
  assert.equal(byId(tree, 'transfer-select-shown').props.accessibilityLabel, h.words.select.all(2));
  group.props.onPress();
  assert.equal(byId(h.render(), 'transfer-group-two').props.accessibilityState.checked, true);
  answerIn(footer(h), 'none');
  save(h); await flush();
  const request = h.events.find(event => event[0] === 'batch')[1];
  assert.deepEqual(request.decisions, [{ ids: ['a'], ownership: 'none' }, { ids: ['c'], ownership: 'none' }]);
});

// ---- A catch-all group ("Account → ?"): every entry needs its own answer ----

const catchAll = (extra = {}) => createPage({ transactions: [row('a', { title: 'First' }), row('c', { title: 'Second' }),
  row('b', { accountId: 'other' })], groupDefinitions: [{ id: 'two', transactionIds: ['a', 'c'], bulkEligible: false },
  { id: 'one', transactionIds: ['b'], bulkEligible: false }], ...extra });

test('a catch-all group\'s sheet lists its entries, each opened on its own; there is no answer for all of them', () => {
  const h = catchAll();
  const sheet = openGroup(h, 'two');
  assert.equal(sheet.props.title, h.words.answers.question);
  for (const answer of ['own', 'external', 'none']) assert.equal(byId(sheet, `transfer-answer-${answer}`), undefined, answer);
  assert.equal(byId(sheet, 'transfer-answer-sheet-save'), undefined, 'nothing to save for all of them');
  assert.ok(text(byId(sheet, 'transfer-answer-sheet-one-by-one')).includes(h.words.group.oneByOne));
  assert.equal(text(byId(sheet, 'transfer-answer-sheet-cancel')), h.words.answers.done);
  const entries = allById(sheet, 'transfer-group-entry');
  assert.equal(entries.length, 2);
  entries.find(node => node.props.accessibilityLabel.includes('Second')).props.onPress();
  const tree = h.render();
  assert.equal(byId(tree, 'transfer-answer-sheet'), undefined);
  assert.equal(detailSheet(tree).props.transaction.id, 'c', 'its own "What is this?"');
  assert.deepEqual(h.events, []);
});

test('select mode never ticks a catch-all group whole, not even Select all; it opens to tick its entries one by one', async () => {
  const h = catchAll();
  startSelecting(h);
  let tree = h.render();
  const group = byId(tree, 'transfer-group-two');
  assert.equal(group.props.accessibilityRole, 'button', 'a disclosure, not a checkbox');
  assert.equal(group.props.accessibilityState.expanded, false);
  assert.ok(text(group).includes(h.words.group.showEntries));
  assert.equal(byId(tree, 'transfer-select-shown').props.accessibilityLabel, h.words.select.all(1), 'only the lone entry has a tick');
  byId(tree, 'transfer-select-shown').props.onPress();
  assert.ok(text(footer(h)).includes(h.words.select.selected(1)), 'Select all ticked the lone entry only');
  byId(h.render(), 'transfer-clear-selection').props.onPress();
  // Opened, its entries are rows of their own, each with its own tick.
  byId(h.render(), 'transfer-group-two').props.onPress();
  tree = h.render();
  assert.equal(byId(tree, 'transfer-group-two').props.accessibilityState.expanded, true);
  assert.ok(byId(tree, 'transfer-row-a') && byId(tree, 'transfer-row-c'));
  assert.equal(byId(tree, 'transfer-row-a').props.accessibilityRole, 'checkbox');
  // Opened, its entries are still not Select all's: "show entries" then "Select all" never answers the group whole.
  assert.equal(byId(tree, 'transfer-select-shown').props.accessibilityLabel, h.words.select.all(1));
  byId(tree, 'transfer-select-shown').props.onPress();
  tree = h.render();
  assert.ok(text(footer(h)).includes(h.words.select.selected(1)));
  assert.equal(byId(tree, 'transfer-row-a').props.accessibilityState.checked, false);
  assert.equal(byId(tree, 'transfer-row-c').props.accessibilityState.checked, false);
  assert.equal(byId(tree, 'transfer-row-b').props.accessibilityState.checked, true);
  byId(tree, 'transfer-clear-selection').props.onPress();
  byId(h.render(), 'transfer-row-c').props.onPress();
  assert.ok(text(footer(h)).includes(h.words.select.selected(1)));
  // Closing it again unticks what it hid, so nothing hidden is saved.
  byId(h.render(), 'transfer-group-two').props.onPress();
  assert.ok(text(footer(h)).includes(h.words.select.none));
  byId(h.render(), 'transfer-group-two').props.onPress();
  byId(h.render(), 'transfer-row-c').props.onPress();
  answerIn(footer(h), 'own');
  save(h); await flush();
  const request = h.events.find(event => event[0] === 'batch')[1];
  assert.deepEqual(request.decisions, [{ ids: ['c'], ownership: 'own' }], 'only the entry ticked on its own');
});

test('a group with one shared suggestion is still answered whole; a catch-all never enters a batch', () => {
  const batch = load(path.join(root, 'src/lib/transfer-batch.ts'), { '@/lib/transfer-reconciliation': core });
  assert.throws(() => batch.transferBatchDecisions([{ kind: 'group', ids: ['a', 'b'], listOnly: true }], 'own'));
  assert.deepEqual(plain(batch.transferBatchDecisions([{ kind: 'group', ids: ['a', 'b'] }], 'own')),
    [{ ids: ['a'], ownership: 'own' }, { ids: ['b'], ownership: 'own' }]);
});

test('a ticked group whose row search changes is unticked, so its save never covers entries the row no longer shows', () => {
  const h = createPage({ bulk: true, transactions: [row('one', { title: 'Rent' }), row('two', { title: 'Gym' }), row('three', { title: 'Rent too' })],
    groupDefinitions: [{ id: 'group', transactionIds: ['one', 'two', 'three'], bulkEligible: true }] });
  // The real effect runs after render here.
  const effects = [];
  h.deps.react.useEffect = fn => { effects.push(fn); };
  const render = () => { effects.length = 0; const tree = h.render(); effects.forEach(fn => fn()); return tree; };
  startSelecting(h); render();
  byId(render(), 'transfer-group-group').props.onPress(); render();
  assert.equal(byId(render(), 'transfer-group-group').props.accessibilityState.checked, true);
  assert.ok(text(footer(h)).includes(h.words.select.selected(1)));
  walk(render()).find(node => node.type === 'TextInput').props.onChangeText('Rent');
  render(); const tree = render();
  assert.ok(text(byId(tree, 'transfer-group-group')).includes(h.words.group.entries(2)), 'the row now shows two entries');
  assert.equal(byId(tree, 'transfer-group-group').props.accessibilityState.checked, false, 'and is no longer ticked');
  assert.ok(text(footer(h)).includes(h.words.select.none));
  byId(render(), 'transfer-group-group').props.onPress(); render();
  answerIn(footer(h), 'own');
  assert.equal(byId(sheetOf(h), 'transfer-answer-sheet-save').props.accessibilityLabel, h.words.batch.save(2), 'ticked again: the two it shows');
});

/** A page whose effects run after each render, as React runs them. */
function withEffects(h) {
  const effects = [];
  h.deps.react.useEffect = fn => { effects.push(fn); };
  return () => { effects.length = 0; const tree = h.render(); effects.forEach(fn => fn()); return tree; };
}
const searchFor = (render, value) => walk(render()).find(node => node.type === 'TextInput').props.onChangeText(value);

test('anything ticked that search hides is unticked, groups and lone entries alike, and stays unticked', () => {
  const evidence = { transferEvidence: { version: 1, currency: 'AED', attribution: 'source' } };
  const h = createPage({ transactions: [row('rent-1', { title: 'Rent', ...evidence }), row('rent-2', { title: 'Rent', ...evidence }),
    row('gym', { title: 'Gym', accountId: 'other', ...evidence })],
  groupDefinitions: [{ id: 'rent', transactionIds: ['rent-1', 'rent-2'], bulkEligible: true },
    { id: 'gym', transactionIds: ['gym'], bulkEligible: false }] });
  const render = withEffects(h);
  startSelecting(h); render();
  byId(render(), 'transfer-select-shown').props.onPress(); render();
  assert.ok(text(footer(h)).includes(h.words.select.selected(2)), 'the group and the lone entry');
  // Search hides the whole group: it is unticked, not kept out of sight.
  searchFor(render, 'gym'); render();
  assert.equal(byId(render(), 'transfer-group-rent'), undefined);
  assert.ok(text(footer(h)).includes(h.words.select.selected(1)));
  // Search hides the lone entry too.
  searchFor(render, 'nothing like this'); render();
  assert.ok(text(footer(h)).includes(h.words.select.none));
  // Clearing the search shows them again, unticked: nothing the person cannot see comes back ticked.
  searchFor(render, ''); const tree = render();
  assert.equal(byId(tree, 'transfer-group-rent').props.accessibilityState.checked, false);
  assert.equal(byId(tree, 'transfer-row-gym').props.accessibilityState.checked, false);
  assert.ok(text(footer(h)).includes(h.words.select.none));
  assert.deepEqual(h.events, []);
});

test('a catch-all group that becomes whole drops its ticked entries, so no entry is answered twice', async () => {
  const definitions = [{ id: 'two', transactionIds: ['a', 'c'], bulkEligible: false }, { id: 'one', transactionIds: ['b'], bulkEligible: false }];
  const h = catchAll({ groupDefinitions: definitions });
  const render = withEffects(h);
  startSelecting(h); render();
  byId(render(), 'transfer-group-two').props.onPress(); render();
  byId(render(), 'transfer-row-a').props.onPress(); render();
  assert.ok(text(footer(h)).includes(h.words.select.selected(1)));
  // The reconciler now has one known other side for the group: it is one tick, and its entries are not rows.
  definitions[0].bulkEligible = true;
  let tree = render(); tree = render();
  assert.equal(byId(tree, 'transfer-row-a'), undefined);
  assert.equal(byId(tree, 'transfer-group-two').props.accessibilityRole, 'checkbox');
  assert.ok(text(footer(h)).includes(h.words.select.none), 'the entry ticked on its own is unticked');
  byId(tree, 'transfer-group-two').props.onPress(); render();
  answerIn(footer(h), 'own');
  save(h); await flush();
  const request = h.events.find(event => event[0] === 'batch')[1];
  assert.deepEqual(request.decisions.flatMap(decision => decision.ids).sort(), ['a', 'c'], 'each entry once');
});

test('the batch sheet refuses picks that name one entry twice, and the resolver\'s "selected more than once" says the transfers changed', async () => {
  const h = createPage({ bulk: true });
  const hook = h.deps['@/hooks/use-transfer-batch'];
  assert.ok(hook);
  // Two items naming the same entry (picked before the ledger regrouped it) never open the sheet.
  const item = (key, ids) => ({ key, kind: 'entry', ids, direction: 'expense', expectedFingerprints: {}, expectedGeneration: 1,
    preview: { from: { kind: 'unknown' }, to: { kind: 'unknown' }, fromLabel: '?', toLabel: '?', amountFils: 1, sign: 'minus', count: 1, dates: '', spoken: '' } });
  h.deps.react.useState = initial => [typeof initial === 'function' ? initial() : initial, () => {}];
  const batch = hook.useTransferBatch({ rowsById: new Map(), answers: { busy: false } });
  assert.equal(batch.open([item('x', ['one']), item('group', ['one', 'two'])], 'own'), false);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.batch.changed]);
  // The store's own refusal of a doubled entry reads as "changed", not "couldn't save".
  const refused = createPage({ bulk: true, resolveTransferBatch: async () => { throw new Error('A transfer entry was selected more than once'); } });
  answerIn(openGroup(refused), 'own');
  save(refused); await flush();
  assert.ok(text(byId(sheetOf(refused), 'transfer-answer-sheet-error')).includes(refused.words.batch.changed));
});

test('the toast\'s Undo waits for a save that is still writing: one transfer write at a time', async () => {
  const writing = deferred();
  let saves = 0;
  const h = createPage({ transactions: [row('one'), row('two'), row('three', { accountId: 'other' }), row('four', { accountId: 'other' })],
    groupDefinitions: [{ id: 'group', transactionIds: ['one', 'two'], bulkEligible: true }, { id: 'other', transactionIds: ['three', 'four'], bulkEligible: true }],
    resolveTransferBatch: async (request, state) => {
      if (request.decisions[0].ownership === null) return;
      saves += 1;
      const ids = new Set(request.decisions.flatMap(decision => decision.ids));
      const decidedAt = Date.now();
      state.transactions = state.transactions.map(tx => ids.has(tx.id)
        ? { ...tx, transferDecision: { version: 1, ownership: request.decisions[0].ownership, decidedAt } } : tx);
      if (saves === 2) await writing.promise;
    } });
  answerIn(openGroup(h), 'own');
  save(h); await flush();
  const undo = h.toasts.at(-1)[1].actions.find(action => action.label === h.words.answers.undo);
  // A second save starts writing; the first save's Undo is pressed while it writes.
  answerIn(openGroup(h, 'other'), 'external');
  save(h); await flush();
  const before = h.events.filter(event => event[0] === 'batch').length;
  undo.onPress(); await flush();
  assert.equal(h.events.filter(event => event[0] === 'batch').length, before, 'nothing is cleared while another write runs');
  assert.deepEqual(h.events.at(-1), ['toast', h.words.answers.failed]);
  writing.resolve(); await flush(); await flush();
  // Once the save is done, the same Undo runs.
  undo.onPress(); await flush(); await flush();
  assert.deepEqual(h.events.filter(event => event[0] === 'batch').at(-1)[1].decisions, [{ ids: ['one'], ownership: null }, { ids: ['two'], ownership: null }]);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.answers.undone]);
});

test('Undo is offered only for the decision this save wrote: a ledger that does not carry it refuses Undo', async () => {
  // The ledger after the write does not show this save's answer (a restore landed): Undo cannot vouch for it.
  const h = createPage({ bulk: true, resolveTransferBatch: async (request, state) => {
    if (request.decisions[0].ownership === null) return;
    state.transactions = state.transactions.map(tx => ({ ...tx, transferDecision: { version: 1, ownership: 'own', decidedAt: 1 } }));
  } });
  answerIn(openGroup(h), 'own');
  save(h); await flush();
  const undo = h.toasts.at(-1)[1].actions.find(action => action.label === h.words.answers.undo);
  const writes = h.events.filter(event => event[0] === 'batch').length;
  undo.onPress(); await flush();
  assert.equal(h.events.filter(event => event[0] === 'batch').length, writes, 'nothing is cleared');
  assert.deepEqual(h.events.at(-1), ['toast', h.words.answers.changed]);
  // After a retried write, Undo uses the fingerprints the store reported for the decided rows.
  const retried = createPage({ bulk: true, resolveTransferBatch: async (request, state) => {
    if (request.decisions[0].ownership === null) return;
    state.transactions = state.transactions.map(tx => ({ ...tx, transferDecision: { version: 1, ownership: 'own', decidedAt: 1 } }));
    throw Object.assign(new Error('write failed'), { code: 'transfer-durability',
      expectedFingerprints: Object.fromEntries(state.transactions.map(tx => [tx.id, fingerprint(tx)])) });
  } });
  answerIn(openGroup(retried), 'own');
  save(retried); await flush();
  byId(sheetOf(retried), 'transfer-answer-sheet-save').props.onPress(); await flush();
  const retriedUndo = retried.toasts.at(-1)[1].actions.find(action => action.label === retried.words.answers.undo);
  retriedUndo.onPress(); await flush();
  assert.deepEqual(retried.events.filter(event => event[0] === 'batch').at(-1)[1].decisions,
    [{ ids: ['one'], ownership: null }, { ids: ['two'], ownership: null }]);
  assert.deepEqual(retried.events.at(-1), ['toast', retried.words.answers.undone]);
});

test('an id stored twice is shown read-only with its reason, never ticked or saved', () => {
  const h = createPage({ transactions: [row('dup'), row('dup', { amountFils: 500 }), row('solo', { accountId: 'other' })],
    groupDefinitions: [{ id: 'g', transactionIds: ['dup'], bulkEligible: true }, { id: 's', transactionIds: ['solo'], bulkEligible: false }] });
  let tree = h.render();
  const blocked = byId(tree, 'transfer-group-g:duplicate');
  assert.ok(blocked, 'still shown, so nothing waiting is hidden');
  assert.equal(blocked.type, 'View', 'not a button');
  assert.ok(text(blocked).includes(h.words.group.duplicate));
  assert.ok(blocked.props.accessibilityLabel.includes(h.words.group.duplicate));
  startSelecting(h); tree = h.render();
  const shown = byId(tree, 'transfer-group-g:duplicate');
  assert.equal(shown.type, 'View');
  assert.equal(shown.props.accessibilityState, undefined, 'no tick');
  assert.equal(byId(tree, 'transfer-select-shown').props.accessibilityLabel, h.words.select.all(1));
  byId(tree, 'transfer-select-shown').props.onPress();
  answerIn(footer(h), 'own');
  assert.equal(byId(sheetOf(h), 'transfer-answer-sheet-save').props.accessibilityLabel, h.words.batch.save(1), 'only the other entry');
});

test('disabled select controls stay legible: no faded fill', () => {
  const empty = createPage({ transactions: [] });
  assert.equal(byId(empty.render(), 'transfers-select'), undefined, 'nothing to select, no Select');
  const h = createPage(manyPairs());
  startSelecting(h);
  h.state.transactions = [];
  const selectAll = byId(h.render(), 'transfer-select-shown');
  assert.equal(selectAll.props.disabled, true);
  const style = flatStyle(selectAll.props.style);
  assert.equal(style.opacity, 1, 'not faded');
  assert.equal(style.borderColor, '#E3DED2');
  const label = walk(selectAll).find(node => node.type === 'Text');
  assert.equal(flatStyle(label.props.style).color, '#57524A', 'secondary ink (about 7:1 on the sheet)');
});

test('previews sign single entries like the list and show each amount once; a pair is unsigned', () => {
  const h = createPage({ transactions: [row('a'), row('b', { accountId: 'other' })],
    groupDefinitions: [{ id: 'ga', transactionIds: ['a'], bulkEligible: false }, { id: 'gb', transactionIds: ['b'], bulkEligible: false }] });
  startSelecting(h); byId(h.render(), 'transfer-select-shown').props.onPress();
  answerIn(footer(h), 'own');
  const items = allById(sheetOf(h), 'transfer-batch-preview-item');
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.ok(text(item).includes('−AED 123.45'), 'money out, signed as in the list');
    assert.equal(text(item).split('123.45').length - 1, 1, 'the amount appears once');
  }
  const pairs = createPage(manyPairs());
  startSelecting(pairs); byId(pairs.render(), 'transfer-select-shown').props.onPress(); answerIn(footer(pairs), 'own');
  const pairItem = allById(sheetOf(pairs), 'transfer-batch-preview-item')[0];
  assert.ok(!text(pairItem).includes('−') && !text(pairItem).includes('+'), 'a pair between your accounts is unsigned');
  assert.equal(text(pairItem).split('AED 123.45').length - 1, 1);
});

test('pair legs with different amounts show both, never one merged figure', () => {
  const h = createPage({ ...manyPairs(1), transactions: [row('out-0'), row('in-0', { type: 'income', accountId: 'other', amountFils: 12000 })] });
  startSelecting(h); byId(h.render(), 'transfer-select-shown').props.onPress(); answerIn(footer(h), 'own');
  // One ticked item is drawn at the top of the sheet as its route.
  const item = text(byId(sheetOf(h), 'transfer-answer-sheet-route'));
  assert.ok(item.includes('AED 123.45') && item.includes('AED 120.00'));
});

test('card repayments are never offered as a linked pair', () => {
  const h = createPage({ ...manyPairs(1), groupDefinitions: [{ id: 'o', transactionIds: ['out-0'], bulkEligible: false },
    { id: 'i', transactionIds: ['in-0'], bulkEligible: false }], assessments: {
    'out-0': { status: 'likely-card-repayment', reason: 'amount-time', counterpartId: 'in-0', candidateIds: ['in-0'] },
    'in-0': { status: 'likely-card-repayment', reason: 'amount-time', counterpartId: 'out-0', candidateIds: ['out-0'] } } });
  startSelecting(h);
  assert.equal(pairChecks(h).length, 0);
});

test('a pair whose legs no longer name each other is not one route', () => {
  const h = createPage({ groupDefinitions: [], transactions: [row('m-out', { date: '2026-09-03' }), row('m-in', { type: 'income', accountId: 'other', date: '2026-09-03' })],
    assessments: { 'm-out': { status: 'confirmed-own', counterpartId: 'm-in' }, 'm-in': { status: 'confirmed-own', counterpartId: 'elsewhere' } } });
  assert.equal(byId(h.render(), 'transfer-row-m-out|m-in'), undefined);
});

// ---- Where the page is reached from ----

test('Home and the question card reach this one page; nothing routes to the old review screen', () => {
  const home = fs.readFileSync(path.join(root, 'src/screens/journal-home-screen.tsx'), 'utf8');
  const notice = home.slice(home.indexOf('<TransferReviewNotice'), home.indexOf('/> : null;', home.indexOf('<TransferReviewNotice')));
  assert.match(notice, /onPress=\{\(\) => router\.push\('\/transfers'\)\}/);
  assert.match(home, /transferWaitingSummary\(activity\)/, 'Home counts what the card counts: every transfer waiting');
  assert.match(transfers0(), /transferWaitingSummary\(activity\)\.transfers/, 'and the card says the same number');
  const transfers = fs.readFileSync(path.join(root, 'src/app/transfers.tsx'), 'utf8');
  assert.match(transfers, /onSeeAll=\{startSelecting\}/, 'See all selects several on this page');
  assert.match(transfers, /back: \(\) => \{ if \(router\.canGoBack\(\)\) router\.back\(\);/);
  // Every entry point (rows, groups, Home, Transactions, Accounts, Spending, entry sheets, links) lands on
  // Transfers or the entry's own "What is this?": no source names the old address except the redirect itself
  // and the route list, and the old sheet's words are gone from the app.
  for (const dir of ['src/app', 'src/components', 'src/screens', 'src/lib', 'src/hooks']) {
    for (const file of fs.readdirSync(path.join(root, dir), { recursive: true })) {
      if (!/\.tsx?$/.test(file)) continue;
      const source = fs.readFileSync(path.join(root, dir, file), 'utf8');
      if (!['src/app/review-transfers.tsx', 'src/lib/routes.ts'].includes(`${dir}/${file}`)) {
        assert.doesNotMatch(source, /['"`]\/review-transfers/, `${dir}/${file}`);
      }
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const old of ['Check a transfer', 'What was this transfer?', 'Save classification', 'Leave as recorded', 'Matching bank entry',
        'transfer-review-confirmation', 'transfer-choice-', 'TransferPairAccounts']) {
        assert.ok(!code.includes(old), `${dir}/${file}: ${old}`);
      }
    }
  }
});

test('See all on the question card turns on select mode', () => {
  const h = createPage({ transactions: [row('q1'), row('q2', { accountId: 'other' })], pending: ['q1', 'q2'],
    groupDefinitions: [{ id: 'g1', transactionIds: ['q1'], bulkEligible: false }, { id: 'g2', transactionIds: ['q2'], bulkEligible: false }] });
  const card = byId(h.render(), 'transfer-question-card');
  byId(card, 'transfer-question-see-all').props.onPress();
  assert.ok(byId(h.render(), 'transfer-selection-footer'));
  assert.deepEqual(h.events, []);
});

for (const language of ['en', 'ar']) {
  test(`${language}: Home has a compact exclusion disclosure, not a monetary backlog or mandatory task list`, () => {
    const h = createPage({ language });
    assert.equal(h.notice({ pendingCount: 0, incomingFils: 0, outgoingFils: 0, onPress() {} }), null);
    const notice = h.notice({ pendingCount: 2, incomingFils: 12345, outgoingFils: 6789, onPress: () => h.events.push(['open']) });
    assert.ok(notice.props.accessibilityLabel.includes(h.review.noticeBody));
    const homeWords = load(path.join(root, 'src/lib/reference-copy.ts')).homeSummaryCopy[language];
    assert.ok(text(notice).includes(homeWords.transfersToConfirm(2)));
    assert.ok(text(notice).includes(homeWords.transfersNotCounted));
    assert.ok(!text(notice).includes('AED'));
    notice.props.onPress(); assert.deepEqual(h.events, [['open']]);
  });
  test(`${language}: the new copy has Arabic of its own`, () => {
    const en = copyFor('en'), ar = copyFor(language);
    for (const key of ['group', 'select', 'batch', 'link']) {
      assert.deepEqual(Object.keys(ar[key]).sort(), Object.keys(en[key]).sort(), key);
    }
    if (language === 'ar') assert.notEqual(ar.select.action, en.select.action);
  });
}

// ---- One entry: the answer hook behind the detail sheet and the question card ----

function answerHook({ transactions, resolveTransfers, ensureDurable } = {}) {
  const h = createPage({ transactions, resolveTransfers, ensureDurable });
  h.deps.react.useState = initial => [typeof initial === 'function' ? initial() : initial, () => {}];
  const hook = load(path.join(root, 'src/hooks/use-transfer-answer.ts'), h.deps).useTransferAnswer();
  return { ...h, hook };
}

test('a decided entry is cleared on its own with its current decision fingerprint', async () => {
  const tx = row('reviewed', { transferDecision: { version: 1, ownership: 'external', decidedAt: 2 } });
  const h = answerHook({ transactions: [tx] });
  await h.hook.undo('reviewed');
  assert.deepEqual(h.events[0], ['resolve', { ids: ['reviewed'], ownership: null,
    expectedFingerprints: { reviewed: fingerprint(tx) }, expectedGeneration: 1 }]);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.answers.undone]);
});

test('an answer\'s Undo clears exactly that answer: refused once the entry is answered again', async () => {
  const shown = row('mine');
  const h = answerHook({ transactions: [shown], resolveTransfers: async (request, state) => {
    state.transactions = state.transactions.map(tx => tx.id === 'mine' ? { ...tx, transferDecision: request.ownership === null ? undefined
      : { version: 1, ownership: request.ownership, decidedAt: Date.now() } } : tx);
  } });
  assert.equal(await h.hook.answer({ transaction: shown, answer: 'external', label: 'x' }), 'saved');
  const undo = h.toasts.at(-1)[1].actions.find(action => action.label === h.words.answers.undo);
  // Answered again (its own sheet) before Undo is pressed.
  h.state.transactions = h.state.transactions.map(tx => ({ ...tx, transferDecision: { version: 1, ownership: 'none', decidedAt: 6 } }));
  const writes = h.events.filter(event => event[0] === 'resolve').length;
  undo.onPress(); await flush();
  assert.equal(h.events.filter(event => event[0] === 'resolve').length, writes, 'the newer answer is not cleared');
  assert.deepEqual(h.events.at(-1), ['toast', h.words.answers.changed]);
  // Unchanged since the save, Undo clears it.
  const again = answerHook({ transactions: [shown], resolveTransfers: async (request, state) => {
    state.transactions = state.transactions.map(tx => tx.id === 'mine' ? { ...tx, transferDecision: request.ownership === null ? undefined
      : { version: 1, ownership: request.ownership, decidedAt: Date.now() } } : tx);
  } });
  await again.hook.answer({ transaction: shown, answer: 'external', label: 'x' });
  again.toasts.at(-1)[1].actions[0].onPress(); await flush();
  assert.deepEqual(again.events.at(-1), ['toast', again.words.answers.undone]);
  assert.equal(again.state.transactions[0].transferDecision, undefined);
});

test('one entry\'s answer, Undo and Clear wait while another transfer write runs', async () => {
  const shown = row('mine');
  const h = answerHook({ transactions: [shown] });
  const lock = h.deps['@/lib/transfer-answer'].transferWriteLock;
  assert.equal(lock.acquire(), true, 'a group save is writing');
  assert.equal(await h.hook.answer({ transaction: shown, answer: 'external', label: 'x' }), 'busy');
  await h.hook.undo('mine');
  await h.hook.undoMany(['mine']);
  assert.equal(h.events.some(event => event[0] === 'resolve' || event[0] === 'batch'), false, 'nothing written');
  lock.release();
  assert.equal(await h.hook.answer({ transaction: shown, answer: 'external', label: 'x' }), 'saved');
  assert.equal(lock.held(), false, 'released after the write');
});

test('Clear refuses when the entry changed since it was shown', async () => {
  const tx = row('reviewed', { transferDecision: { version: 1, ownership: 'external', decidedAt: 2 } });
  const h = answerHook({ transactions: [{ ...tx, transferDecision: { version: 1, ownership: 'none', decidedAt: 3 } }] });
  await h.hook.undo('reviewed', undefined, { reviewed: fingerprint(tx) });
  assert.equal(h.events.some(event => event[0] === 'resolve' || event[0] === 'batch'), false);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.answers.changed]);
});

test('an entry that changed since it was shown is refused, not overwritten', async () => {
  const shown = row('low-signal');
  const h = answerHook({ transactions: [{ ...shown, amountFils: 55500 }] });
  const outcome = await h.hook.answer({ transaction: shown, answer: 'own', label: 'x' });
  assert.equal(outcome, 'changed');
  assert.equal(h.events.some(event => event[0] === 'resolve'), false);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.answers.changed]);
});

test('an external answer to a suggested leg retries storage without needing an unchanged counterpart', async () => {
  const legs = [row('out'), row('in', { type: 'income', accountId: 'other' })];
  const h = answerHook({ transactions: legs, resolveTransfers: async (request, state) => {
    state.transactions = state.transactions.map(tx => tx.id === 'out'
      ? { ...tx, transferDecision: { version: 1, ownership: request.ownership, decidedAt: 1 } } : tx);
    throw Object.assign(new Error('write failed'), { code: 'transfer-durability',
      expectedFingerprints: { out: fingerprint(state.transactions.find(tx => tx.id === 'out')) } });
  } });
  const outcome = await h.hook.answer({ transaction: legs[0], answer: 'external', label: 'x' });
  assert.equal(outcome, 'saved');
  assert.equal(h.events.filter(event => event[0] === 'resolve').length, 1);
  assert.equal(h.events.filter(event => event[0] === 'durable').length, 1);
});

for (const language of ['en', 'ar']) {
  for (const reason of ['known-account', 'known-card']) {
    test(`${language}: ${reason} explains cross-SMS ownership without a fake receipt and allows correction`, () => {
      const h = createHarness({ language, state: { transactions: [row('known', { transferEvidence: { version: 1, currency: 'AED', attribution: 'source' } })] } });
      const tree = h.renderDetail(h.state.transactions[0], { transferAssessment: { id: 'known',
        status: reason === 'known-card' ? 'card-repayment' : 'confirmed-own', reason, counterpartyAccountId: 'other', candidateIds: [] } });
      const review = load(path.join(root, 'src/lib/transfer-review-copy.ts'), { '@/lib/i18n': { getLanguage: () => language } }).transferReviewCopy(language);
      const evidence = byId(tree, 'transfer-known-ownership-evidence');
      assert.ok(text(evidence).includes(reason === 'known-card' ? review.knownCardEvidence : review.knownAccountEvidence));
      assert.equal(byId(tree, 'transfer-counterpart-evidence'), undefined, 'no invented receipt');
      const external = byId(byId(tree, 'entry-transfer-question'), 'transfer-answer-external');
      assert.ok(external, 'the automatic answer can be corrected');
      external.props.onPress();
      const answered = h.events.find(event => event[0] === 'answer');
      assert.equal(answered[1].answer, 'external');
      assert.equal(answered[1].transaction.id, 'known');
    });
  }
}

test('the detail sheet offers "Clear my answer" for a saved answer, clearing both sides of a link', () => {
  const h = createHarness({ language: 'en', state: { transactions: [
    row('mine', { transferEvidence: { version: 1, currency: 'AED', attribution: 'source' },
      transferDecision: { version: 1, ownership: 'own', decidedAt: 2, counterpartId: 'theirs' } })] } });
  h.renderDetail(h.state.transactions[0]);
  const cleared = [];
  h.deps['@/hooks/use-transfer-answer'] = { useTransferAnswer: () => ({ busy: false, answer: async () => 'saved',
    undo: async (...args) => { cleared.push(args); } }) };
  h.local('@/components/entry-detail-sheet');
  const tree = h.deps['@/components/entry-detail-sheet'].EntryDetailSheet({ transaction: h.state.transactions[0], onClose() {} });
  const clear = byId(tree, 'entry-transfer-clear');
  assert.equal(clear.props.accessibilityLabel, copyFor('en').answers.clear);
  clear.props.onPress();
  // Clear takes back exactly the answer shown: the rows' fingerprints as shown go with it.
  const fingerprintOf = h.deps['@/lib/transfer-reconciliation'].transferFingerprint;
  assert.deepEqual(plain(cleared), [['mine', 'theirs', { mine: fingerprintOf(h.state.transactions[0]) }]]);
  const fresh = createHarness({ language: 'en', state: { transactions: [row('open', { transferEvidence: { version: 1, currency: 'AED', attribution: 'source' } })] } });
  assert.equal(byId(fresh.renderDetail(fresh.state.transactions[0]), 'entry-transfer-clear'), undefined, 'nothing to clear before an answer');
});

for (const language of ['en', 'ar']) {
  test(`${language}: one entry's sheet names its matching card payment as the likely other side, as a suggestion`, async () => {
    const card = { id: 'card', name: 'ADCB Credit Card', last4: '7720', kind: 'card' };
    const debit = row('debit', { transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'Liv' } });
    const receipt = row('receipt', { type: 'income', accountId: 'card', title: 'Payment received', amountFils: 12345, ts: 1788898200000 });
    const h = createHarness({ language, state: { transactions: [debit, receipt],
      accounts: [{ id: 'bank', name: 'Liv Account', kind: 'bank' }, card] } });
    const tree = h.renderDetail(debit, { transferAssessment: { id: 'debit', status: 'likely-card-repayment', reason: 'amount-time',
      counterpartId: 'receipt', candidateIds: ['receipt'] } });
    const words = copyFor(language);
    const suggestion = byId(byId(tree, 'entry-transfer-question'), 'transfer-answer-own-suggestion');
    assert.ok(suggestion, 'the likely other side is under "my own account"');
    const said = text(suggestion);
    assert.ok(said.includes(words.answers.looksLike(ledger.accountDisplayName(card))));
    assert.ok(!text(tree).includes(words.route.linked(ledger.accountDisplayName(card))), 'a suggestion is never "Linked to"');
    assert.ok(said.includes('Payment received'), 'what the matching entry was');
    assert.ok(said.includes('123.45'), 'its amount');
    assert.ok(said.includes(words.answers.suggestedOnly), 'not confirmed until answered');
    for (const old of ['Check a transfer', 'Save classification', 'Leave as recorded', 'What was this transfer?']) {
      assert.ok(!text(tree).includes(old), old);
    }
    // Answered "own", a likely card repayment is saved as own without a pair link, as the group and selection saves do.
    byId(byId(tree, 'entry-transfer-question'), 'transfer-answer-own').props.onPress(); await flush();
    const answered = h.events.find(event => event[0] === 'answer');
    assert.equal(answered[1].answer, 'own');
    assert.equal(answered[1].counterpart, undefined, 'no link to the card receipt');
    assert.equal(h.events.some(event => event[0] === 'state' && event[1] === 'picking'), false);
  });
}

test('select mode names the count once, in the footer: the list head keeps its section title', () => {
  for (const language of ['en', 'ar']) {
    const h = createPage({ language, bulk: true });
    startSelecting(h);
    const head = text(byId(h.render(), 'transfers-list-head'));
    assert.ok(head.includes(h.words.group.section), `${language}: the waiting section's title`);
    assert.ok(!head.includes(h.words.select.selected(0)), `${language}: no "0 selected" above "Nothing selected yet"`);
    assert.ok(text(footer(h)).includes(h.words.select.none));
    byId(h.render(), 'transfer-select-shown').props.onPress();
    assert.ok(!text(byId(h.render(), 'transfers-list-head')).includes(h.words.select.selected(1)));
    assert.ok(text(footer(h)).includes(h.words.select.selected(1)), 'the count lives in the footer');
  }
});

// ---- People: every waiting transfer with one person, one answer for all of them ----

const named = (id, name, extra = {}) => row(id, { title: `Transfer ${extra.type === 'income' ? 'from' : 'to'} ${name}`,
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source', counterpartyName: name }, ...extra });
const peoplePage = (extra = {}) => createPage({ groupDefinitions: [], transactions: [
  named('m1', 'MARIAM S'), named('m2', 'Mariam S.', { type: 'income', amountFils: 5000 }), named('m3', 'MARIAM S'),
  named('k1', 'KHALID R'), row('u1')], ...extra });
const personOf = (tree, key) => byId(tree, `transfer-person-${key}`);
const savingPage = () => peoplePage({ resolveTransferBatch: async (request, state) => {
  const decidedAt = Date.now();
  const byIdDecision = new Map(request.decisions.map(decision => [decision.ids[0], decision.ownership]));
  state.transactions = state.transactions.map(tx => !byIdDecision.has(tx.id) ? tx : byIdDecision.get(tx.id) === null
    ? (({ transferDecision: _removed, ...rest }) => rest)(tx)
    : { ...tx, transferDecision: { version: 1, ownership: byIdDecision.get(tx.id), decidedAt } });
} });

for (const language of ['en', 'ar']) {
  test(`${language}: a person is one row: initial, name, how many transfers, money each way, dates and the open tag`, () => {
    const h = peoplePage({ language });
    const tree = h.render();
    const mariam = personOf(tree, 'person:mariam s');
    assert.ok(mariam, 'every spelling of the name is one person');
    assert.ok(text(mariam).includes('MARIAM S'), 'the spelling the bank used most');
    assert.ok(text(mariam).includes('M'), 'the avatar initial');
    assert.ok(text(byId(mariam, 'transfer-person-count')).includes(h.words.person.transfers(3)));
    assert.ok(text(mariam).includes(h.words.person.sent('AED 246.90', 2)), 'money out, with how many');
    assert.ok(text(mariam).includes(h.words.person.received('AED 50.00', 1)), 'money in, with how many');
    assert.ok(text(mariam).includes(h.words.tags.needsAnswer));
    assert.equal(mariam.props.accessibilityRole, 'button');
    for (const part of ['MARIAM S', h.words.person.transfers(3), h.words.tags.needsAnswer]) {
      assert.ok(mariam.props.accessibilityLabel.includes(part), part);
    }
    assert.ok(flatStyle(mariam.props.style).minHeight >= 44);
    assert.ok(personOf(tree, 'person:khalid r'), 'one transfer is still a person');
    for (const id of ['m1', 'm2', 'm3', 'k1']) assert.equal(byId(tree, `transfer-row-${id}`), undefined, `${id} is answered with its person`);
    const unnamed = byId(tree, 'transfer-row-u1');
    assert.ok(unnamed, 'a transfer naming nobody stays its own row');
    assert.ok(text(unnamed).includes(h.words.tags.needsAnswer), 'with the same one term');
    assert.ok(text(byId(tree, 'transfers-list-head')).includes(h.words.group.section));
    assert.deepEqual(h.events, [], 'drawing people never writes');
  });
}

test('the card asks about the top person; an answer opens the sheet with every entry and its count, nothing saved yet', () => {
  const h = peoplePage();
  const card = byId(h.render(), 'transfer-question-card');
  assert.ok(text(card).includes(h.words.person.question('MARIAM S')), 'the person with the most transfers first');
  assert.ok(text(card).includes(h.words.card.title(5)), 'every transfer waiting: three with Mariam, one with Khalid, one unnamed');
  assert.ok(text(card).includes(h.words.card.step(1, 2)), 'the card walks the two people; the unnamed one-off is not a question');
  const unnamed = byId(card, 'transfer-question-unnamed');
  assert.ok(text(unnamed).includes(h.words.card.moreUnnamed(1)));
  assert.equal(unnamed.props.accessibilityRole, 'button');
  // Money both ways: the answers are worded for both directions.
  assert.ok(text(card).includes(h.words.answers.mixed.own));
  answerIn(card, 'external');
  assert.deepEqual(h.events, [], 'a person is never answered by one tap: the sheet shows what it covers');
  const sheet = sheetOf(h);
  assert.ok(sheet, 'the confirmation sheet opens');
  assert.equal(byId(sheet, 'transfer-answer-external').props.accessibilityState.checked, true, 'on the answer picked');
  assert.ok(text(byId(sheet, 'transfer-answer-sheet-person')).includes(h.words.person.oneAnswer('MARIAM S')));
  assert.ok(byId(sheet, 'transfer-batch-preview-person'));
  assert.equal(allById(sheet, 'transfer-group-entry').length, 3, 'every entry is listed');
  assert.equal(byId(sheet, 'transfer-answer-sheet-save').props.accessibilityLabel, h.words.batch.save(3));
});

test('the card\'s "N more without a name" opens select mode, where each unnamed transfer can be ticked', () => {
  const h = peoplePage();
  byId(byId(h.render(), 'transfer-question-card'), 'transfer-question-unnamed').props.onPress();
  const tree = h.render();
  assert.ok(byId(tree, 'transfer-selection-footer'), 'select mode');
  const row = byId(tree, 'transfer-row-u1');
  assert.equal(row.props.accessibilityRole, 'checkbox');
  row.props.onPress();
  assert.equal(byId(h.render(), 'transfer-row-u1').props.accessibilityState.checked, true);
  assert.deepEqual(h.events, []);
});

test('a person\'s answer is one single-entry decision per transfer, with Undo clearing exactly those', async () => {
  const h = savingPage();
  byId(h.render(), `transfer-person-person:mariam s`).props.onPress();
  answerIn(sheetOf(h), 'own');
  const original = Object.fromEntries(h.state.transactions.filter(tx => tx.id.startsWith('m')).map(tx => [tx.id, fingerprint(tx)]));
  save(h); await flush();
  const request = h.events.find(event => event[0] === 'batch')[1];
  assert.deepEqual(request.decisions, [{ ids: ['m1'], ownership: 'own' }, { ids: ['m2'], ownership: 'own' }, { ids: ['m3'], ownership: 'own' }],
    'own for a person: no pair link, no group decision');
  assert.deepEqual(request.expectedFingerprints, original, 'frozen when the person was opened');
  assert.equal(request.expectedGeneration, 1);
  const [message, options] = h.toasts.at(-1);
  assert.equal(message, h.words.batch.saved(3));
  assert.equal(personOf(h.render(), 'person:mariam s'), undefined, 'answered: the person leaves the waiting list');
  options.actions.find(action => action.label === h.words.answers.undo).onPress(); await flush(); await flush();
  const undo = h.events.filter(event => event[0] === 'batch').at(-1)[1];
  assert.deepEqual(undo.decisions, [{ ids: ['m1'], ownership: null }, { ids: ['m2'], ownership: null }, { ids: ['m3'], ownership: null }]);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.answers.undone]);
  assert.ok(personOf(h.render(), 'person:mariam s'), 'back to waiting');
});

test('a person changed after it was opened blocks Save and says so; nothing is written', () => {
  const h = peoplePage();
  byId(h.render(), `transfer-person-person:mariam s`).props.onPress();
  answerIn(sheetOf(h), 'external');
  h.state.transactions = h.state.transactions.map(tx => tx.id === 'm2' ? { ...tx, amountFils: 5100 } : tx);
  const sheet = sheetOf(h);
  assert.equal(byId(sheet, 'transfer-answer-sheet-save').props.disabled, true);
  assert.ok(text(byId(sheet, 'transfer-answer-sheet-error')).includes(h.words.batch.changed));
  byId(sheet, 'transfer-answer-sheet-save').props.onPress();
  assert.deepEqual(h.events, []);
});

test('select mode: a person is one tick, Select all counts people, and the save covers each of their transfers', async () => {
  const h = peoplePage();
  startSelecting(h);
  let tree = h.render();
  const mariam = personOf(tree, 'person:mariam s');
  assert.equal(mariam.props.accessibilityRole, 'checkbox');
  assert.ok(mariam.props.accessibilityLabel.startsWith(h.words.select.item));
  assert.equal(byId(tree, 'transfer-select-shown').props.accessibilityLabel, h.words.select.all(3), 'two people and the unnamed transfer');
  mariam.props.onPress();
  tree = h.render();
  assert.equal(personOf(tree, 'person:mariam s').props.accessibilityState.checked, true);
  answerIn(footer(h), 'external');
  save(h); await flush();
  const request = h.events.find(event => event[0] === 'batch')[1];
  assert.deepEqual(request.decisions, [{ ids: ['m1'], ownership: 'external' }, { ids: ['m2'], ownership: 'external' },
    { ids: ['m3'], ownership: 'external' }]);
});

test('search narrows a person to the transfers it matches; the answer covers only those', async () => {
  const h = peoplePage();
  walk(h.render()).find(node => node.type === 'TextInput').props.onChangeText('from');
  const tree = h.render();
  const mariam = personOf(tree, 'person:mariam s');
  assert.ok(text(byId(mariam, 'transfer-person-count')).includes(h.words.person.transfers(1)), 'only "Transfer from Mariam S."');
  assert.equal(personOf(tree, 'person:khalid r'), undefined, 'a person with no match steps aside');
  mariam.props.onPress();
  answerIn(sheetOf(h), 'none');
  save(h); await flush();
  assert.deepEqual(h.events.find(event => event[0] === 'batch')[1].decisions, [{ ids: ['m2'], ownership: 'none' }]);
});

test('many people: the first five, then "Show all N people"; select mode lists everyone', () => {
  const names = ['AMAL A', 'BADR B', 'CYRUS C', 'DIMA D', 'EHAB E', 'FARAH F', 'GHADA G'];
  const h = createPage({ groupDefinitions: [], transactions: names.flatMap((name, i) =>
    Array.from({ length: 7 - i }, (_, k) => named(`${i}-${k}`, name))) });
  let tree = h.render();
  const shown = walk(tree).filter(node => node.props?.testID?.startsWith('transfer-person-person:'));
  assert.deepEqual(shown.map(node => node.props.testID.slice('transfer-person-'.length)),
    ['person:amal a', 'person:badr b', 'person:cyrus c', 'person:dima d', 'person:ehab e'], 'most transfers first');
  const toggle = byId(tree, 'transfer-people-toggle');
  assert.equal(toggle.props.accessibilityLabel, h.words.person.showAll(7));
  assert.equal(toggle.props.accessibilityState.expanded, false);
  toggle.props.onPress();
  tree = h.render();
  assert.equal(walk(tree).filter(node => node.props?.testID?.startsWith('transfer-person-person:')).length, 7);
  assert.equal(byId(tree, 'transfer-people-toggle').props.accessibilityLabel, h.words.person.showFewer);
  byId(tree, 'transfer-people-toggle').props.onPress();
  startSelecting(h);
  tree = h.render();
  assert.equal(walk(tree).filter(node => node.props?.testID?.startsWith('transfer-person-person:')).length, 7);
  assert.equal(byId(tree, 'transfer-people-toggle'), undefined);
  assert.equal(byId(tree, 'transfer-select-shown').props.accessibilityLabel, h.words.select.all(7));
});

for (const language of ['en', 'ar']) {
  test(`${language}: person words have Arabic of their own and count people and transfers`, () => {
    const words = copyFor(language).person;
    const en = copyFor('en').person;
    assert.deepEqual(Object.keys(words).sort(), Object.keys(en).sort());
    if (language === 'ar') {
      for (const value of [words.question('مريم'), words.transfers(1), words.transfers(2), words.transfers(5), words.transfers(40),
        words.oneAnswer('مريم'), words.people(1), words.people(2), words.people(7), words.people(24), words.showAll(24), words.showFewer,
        copyFor('ar').card.moreUnnamed(1), copyFor('ar').card.moreUnnamed(2), copyFor('ar').card.moreUnnamed(40)]) {
        assert.doesNotMatch(value, /[A-Za-z]/, value);
      }
      assert.equal(words.transfers(1), 'تحويل واحد');
      assert.equal(words.transfers(2), 'تحويلان');
      assert.equal(words.transfers(5), '5 تحويلات');
      assert.equal(words.transfers(40), '40 تحويلاً');
    } else {
      assert.equal(words.transfers(1), '1 transfer');
      assert.equal(words.transfers(40), '40 transfers');
      assert.equal(copyFor('en').card.moreUnnamed(12), '12 more without a name — select to answer');
      assert.equal(words.question('Mariam S'), '⁨Mariam S⁩: your own account or someone else?');
    }
  });
}
