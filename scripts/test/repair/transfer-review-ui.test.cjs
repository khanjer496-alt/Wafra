'use strict';
// Production React components, explicit native/store/reconciliation boundaries.
// Synthetic ledger rows only; these are behavior checks, not device screenshots.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { walk, text } = require('../workflows/workflow-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const plain = value => JSON.parse(JSON.stringify(value));
const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);
const byLabel = (tree, label) => walk(tree).find(node => node.props?.onPress && node.props.accessibilityLabel === label);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const row = (id, overrides = {}) => ({ id, title: 'Bank transfer', type: 'expense', category: 'other', accountId: 'bank',
  amountFils: 12345, date: '2026-09-08', ts: 1788897600000, source: 'sms', ...overrides });
const fingerprint = tx => JSON.stringify([tx.id, tx.amountFils, tx.date, tx.accountId, tx.transferDecision ?? null]);
const expandGroups = h => {
  for (const node of walk(h.render()).filter(node => node.props?.testID === 'transfer-group-toggle' &&
    !node.props.accessibilityState.expanded && !node.props.disabled)) node.props.onPress();
};
const openEntry = h => { expandGroups(h); byId(h.render(), 'transfer-review-entry').props.onPress(); };

function createUI({ language = 'en', transactions = [row('one'), row('two')], bulk = false,
  params = {}, resolveTransfers, ensureDurable, groupDefinitions } = {}) {
  const events = [], slots = [], refs = [];
  let cursor = 0, refCursor = 0, generation = 1;
  const state = { language, hydrated: true, transactions,
    accounts: [{ id: 'bank', name: 'Synthetic bank', last4: '1234' }, { id: 'other', name: 'Other bank', last4: '5678' }] };
  const store = { state, getStateGeneration: () => generation, getStateSnapshot: () => state,
    resolveTransfers: async request => { events.push(['resolve', plain(request)]); return resolveTransfers?.(request, state); },
    ensureDurable: async () => { events.push(['durable']); return ensureDurable?.(state); },
  };
  const react = { useDeferredValue: value => value, useMemo: fn => fn(), useRef: initial => {
    const index = refCursor++; if (!refs[index]) refs[index] = { current: initial }; return refs[index];
  }, useState: initial => {
    const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  } };
  const jsx = (type, props = {}) => typeof type === 'function' ? type(props) : { type, props };
  const native = { View: 'View', Pressable: 'Pressable', Keyboard: { dismiss() {} }, StyleSheet: { create: styles => styles, hairlineWidth: 1 },
    FlatList: props => jsx('FlatList', { ...props, children: [props.ListHeaderComponent,
      ...(props.data.length ? props.data.map(item => props.renderItem({ item })) : [props.ListEmptyComponent]), props.ListFooterComponent] }),
  };
  const reconcile = txs => {
    const definitions = groupDefinitions ?? [{ id: 'group', transactionIds: txs.map(tx => tx.id), bulkEligible: bulk }];
    const groups = definitions.flatMap(definition => {
      const rows = txs.filter(tx => definition.transactionIds.includes(tx.id) && !tx.transferDecision);
      return rows.length ? [{ id: definition.id, transactionIds: rows.map(tx => tx.id), accountId: rows[0].accountId,
        direction: rows[0].type, status: 'ownership-unknown', bulkEligible: definition.bulkEligible,
        counterparty: definition.bulkEligible ? { last4: '9876', kind: 'account', bankIdentity: 'synthetic-bank' } : undefined }] : [];
    });
    return { groups, pendingIds: new Set(groups.flatMap(group => group.transactionIds)), internalIds: new Set(),
      byId: new Map(txs.map(tx => [tx.id, { status: tx.transferDecision
        ? tx.transferDecision.ownership === 'own' ? 'counterpart-missing' : 'confirmed-external' : 'ownership-unknown' }])) };
  };
  const deps = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ back: () => events.push(['back']) }) },
    '@/lib/store': { useStore: () => store }, '@/lib/i18n': { getLanguage: () => language },
    '@/lib/markets': load(path.join(root, 'src/lib/markets.ts')),
    // Formatting is a boundary stub here, as with formatAED below; monetary implementation has its own suites.
    '@/lib/ledger-money': { formatMinorUnits: (amount, spec) => (amount / 10 ** spec.exponent).toFixed(spec.exponent) },
    '@/lib/format': { formatAED: amount => `AED ${(amount / 100).toFixed(2)}`, fullDateTime: tx => `${tx.date} ${tx.ts}`,
      shortDate: date => date, toISODate: () => '2026-09-09' },
    '@/lib/transfer-reconciliation': { reconcileTransfers: reconcile, transferFingerprint: fingerprint },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-theme': { useTheme: () => ({ cardBorder: '#ccc', primary: '#147', textSecondary: '#555' }) },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 12, four: 16, six: 24 } },
    '@/components/themed-text': { ThemedText: props => jsx('Text', props) },
    '@/components/ui/icon': { Icon: props => jsx('Icon', props) },
    '@/components/ui/controls': { Button: props => jsx('Button', { ...props, accessibilityLabel: props.label, children: props.label }) },
    '@/components/ui/text-field': { TextField: props => jsx('TextInput', props) },
    '@/components/ui/toast': { useToast: () => ({ show: message => events.push(['toast', message]) }) },
    '@/components/ui/bottom-sheet': { BottomSheet: props => props.visible ? jsx('Sheet', props) : null },
    '@/components/ui/screen-scaffold': { ScreenScaffold: props => jsx('Scaffold', props),
      useScreenContentInsets: () => ({ contentContainerStyle: {}, contentInset: { top: 12, bottom: 20 }, scrollIndicatorInsets: { top: 12, bottom: 20 } }) },
  };
  deps['@/lib/transfer-review-copy'] = load(path.join(root, 'src/lib/transfer-review-copy.ts'), deps);
  deps['@/lib/transfer-review-presentation'] = load(path.join(root, 'src/lib/transfer-review-presentation.ts'), deps);
  const screen = load(path.join(root, 'src/app/review-transfers.tsx'), deps).default;
  const notice = load(path.join(root, 'src/components/transfer-review-notice.tsx'), deps).TransferReviewNotice;
  const render = () => { cursor = 0; refCursor = 0; return screen(); };
  return { render, notice, state, store, events, words: deps['@/lib/transfer-review-copy'].transferReviewCopy(language),
    setGeneration: value => { generation = value; } };
}

for (const language of ['en', 'ar']) {
  test(`${language}: Home has a compact exclusion disclosure, not a monetary backlog or mandatory task list`, () => {
    const h = createUI({ language });
    assert.equal(h.notice({ pendingCount: 0, incomingFils: 0, outgoingFils: 0, onPress() {} }), null);
    const notice = h.notice({ pendingCount: 2, incomingFils: 12345, outgoingFils: 6789, onPress: () => h.events.push(['open']) });
    assert.ok(notice.props.accessibilityLabel.includes(h.words.noticeBody));
    assert.ok(text(notice).includes(h.words.noticeCount(2)));
    assert.ok(!text(notice).includes('AED'));
    notice.props.onPress(); assert.deepEqual(h.events, [['open']]);
  });
  test(`${language}: catchall rows stay individual, virtualized and source-free`, () => {
    const h = createUI({ language, transactions: [row('a', { raw: 'PRIVATE_SOURCE_MUST_NOT_RENDER' }), row('b')] });
    assert.equal(walk(h.render()).filter(n => n.props?.testID === 'transfer-review-entry').length, 0);
    expandGroups(h);
    const tree = h.render();
    assert.equal(walk(tree).find(n => n.type === 'Scaffold').props.virtualized, true);
    assert.equal(walk(tree).find(n => n.type === 'Scaffold').props.scroll, false);
    assert.equal(walk(tree).filter(n => n.props?.testID === 'transfer-review-entry').length, 2);
    assert.equal(byLabel(tree, h.words.reviewGroup(2)), undefined);
    assert.ok(text(tree).includes(h.words.individualOnly));
    assert.ok(text(tree).includes('••1234'));
    assert.ok(!text(tree).includes('PRIVATE_SOURCE_MUST_NOT_RENDER'));
    assert.deepEqual(h.events, []);
  });
  test(`${language}: income and outgoing choices explain their effect`, () => {
    for (const type of ['income', 'expense']) {
      const h = createUI({ language, transactions: [row(type, { type })] });
      openEntry(h);
      const choice = byId(h.render(), 'transfer-choice-external');
      assert.equal(choice.props.accessibilityLabel, type === 'income' ? h.words.externalIn : h.words.externalOut);
      assert.equal(choice.props.accessibilityHint, type === 'income' ? h.words.externalInBody : h.words.externalOutBody);
      assert.deepEqual(h.events, []);
    }
  });
}

test('eligible group freezes count, sum, account and masked counterparty before any write', async () => {
  const pending = deferred();
  const h = createUI({ bulk: true, resolveTransfers: () => pending.promise });
  expandGroups(h);
  byLabel(h.render(), h.words.reviewGroup(2)).props.onPress();
  let tree = h.render();
  const sheet = byId(tree, 'transfer-review-confirmation');
  assert.ok(text(sheet).includes('AED 246.90'));
  assert.ok(text(sheet).includes(h.words.accountEnding('9876')));
  assert.ok(text(sheet).includes(h.words.count(2)));
  assert.equal(byLabel(sheet, h.words.confirm).props.disabled, true);
  byId(tree, 'transfer-choice-own').props.onPress();
  tree = h.render();
  const save = byLabel(tree, h.words.confirm);
  save.props.onPress(); save.props.onPress();
  assert.equal(h.events.filter(event => event[0] === 'resolve').length, 1);
  assert.equal(h.events.some(event => event[0] === 'toast'), false);
  assert.deepEqual(h.events[0][1], { ids: ['one', 'two'], ownership: 'own',
    expectedFingerprints: { one: fingerprint(h.state.transactions[0]), two: fingerprint(h.state.transactions[1]) }, expectedGeneration: 1 });
  pending.resolve(); await flush();
  assert.deepEqual(h.events.at(-1), ['toast', h.words.saved]);
  assert.equal(byId(h.render(), 'transfer-review-confirmation'), undefined);
});

test('changed ledger fingerprints block confirmation and preserve the original preview', () => {
  const h = createUI();
  openEntry(h);
  byId(h.render(), 'transfer-choice-external').props.onPress();
  h.state.transactions = h.state.transactions.map(tx => tx.id === 'one' ? { ...tx, amountFils: 55500 } : tx);
  const tree = h.render();
  assert.equal(byLabel(tree, h.words.confirm).props.disabled, true);
  assert.ok(text(byId(tree, 'transfer-review-error')).includes(h.words.changed));
  assert.ok(text(byId(tree, 'transfer-review-confirmation')).includes('AED 123.45'));
  byLabel(tree, h.words.confirm).props.onPress();
  assert.deepEqual(h.events, []);
});

test('ordinary rejected decisions retain a visible error and never announce success', async () => {
  const h = createUI({ resolveTransfers: async () => { throw new Error('stale'); } });
  openEntry(h);
  byId(h.render(), 'transfer-choice-own').props.onPress();
  byLabel(h.render(), h.words.confirm).props.onPress(); await flush();
  const tree = h.render();
  assert.ok(byId(tree, 'transfer-review-confirmation'));
  assert.ok(text(byId(tree, 'transfer-review-error')).includes(h.words.saveFailed));
  assert.equal(h.events.some(event => event[0] === 'toast'), false);
});

test('failed durable write keeps the panel and retries persistence without applying the decision twice', async () => {
  const retry = deferred();
  const h = createUI({ transactions: [row('one')], resolveTransfers: async (request, state) => {
    state.transactions = state.transactions.map(tx => ({ ...tx, transferDecision: { version: 1, ownership: request.ownership, decidedAt: 1 } }));
    throw Object.assign(new Error('write failed'), { code: 'transfer-durability',
      expectedFingerprints: Object.fromEntries(state.transactions.map(tx => [tx.id, fingerprint(tx)])) });
  }, ensureDurable: () => retry.promise });
  openEntry(h);
  byId(h.render(), 'transfer-choice-own').props.onPress();
  byLabel(h.render(), h.words.confirm).props.onPress(); await flush();
  let tree = h.render();
  const sheet = byId(tree, 'transfer-review-confirmation');
  assert.ok(sheet); assert.equal(sheet.props.dismissible, false);
  assert.ok(text(sheet).includes(h.words.durabilityFailed));
  assert.equal(byLabel(sheet, h.words.cancel).props.disabled, true);
  sheet.props.onClose(); assert.ok(byId(h.render(), 'transfer-review-confirmation'));
  byLabel(tree, h.words.retrySave).props.onPress();
  assert.equal(h.events.filter(event => event[0] === 'resolve').length, 1);
  assert.equal(h.events.filter(event => event[0] === 'durable').length, 1);
  assert.equal(h.events.some(event => event[0] === 'toast'), false);
  retry.resolve(); await flush(); tree = h.render();
  assert.equal(byId(tree, 'transfer-review-confirmation'), undefined);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.saved]);
});

test('a restored ledger invalidates even a pending durability retry', async () => {
  const h = createUI({ resolveTransfers: async (_request, state) => { throw Object.assign(new Error('write'), { code: 'transfer-durability',
    expectedFingerprints: Object.fromEntries(state.transactions.map(tx => [tx.id, fingerprint(tx)])) }); } });
  openEntry(h);
  byId(h.render(), 'transfer-choice-own').props.onPress();
  byLabel(h.render(), h.words.confirm).props.onPress(); await flush();
  h.setGeneration(2);
  const tree = h.render();
  assert.equal(byLabel(tree, h.words.retrySave).props.disabled, true);
  assert.ok(text(byId(tree, 'transfer-review-error')).includes(h.words.changed));
  assert.equal(byLabel(tree, h.words.cancel).props.disabled, false);
  assert.equal(h.events.some(event => event[0] === 'durable'), false);
});

for (const change of ['edit', 'delete']) {
  test(`${change} during failed storage invalidates retry against fresh state before rendering`, async () => {
    const h = createUI({ transactions: [row('one')], resolveTransfers: async (request, state) => {
      state.transactions = state.transactions.map(tx => ({ ...tx, transferDecision: { version: 1, ownership: request.ownership, decidedAt: 3 } }));
      throw Object.assign(new Error('write'), { code: 'transfer-durability',
        expectedFingerprints: Object.fromEntries(state.transactions.map(tx => [tx.id, fingerprint(tx)])) });
    } });
    openEntry(h);
    byId(h.render(), 'transfer-choice-own').props.onPress();
    byLabel(h.render(), h.words.confirm).props.onPress(); await flush();
    const retry = byLabel(h.render(), h.words.retrySave);
    h.state.transactions = change === 'delete' ? [] : h.state.transactions.map(tx => ({ ...tx, amountFils: 45678 }));
    retry.props.onPress(); await flush();
    assert.equal(h.events.some(event => event[0] === 'durable'), false);
    assert.equal(h.events.some(event => event[0] === 'toast'), false);
    assert.ok(text(byId(h.render(), 'transfer-review-error')).includes(h.words.changed));
  });
}

test('reviewed decisions undo individually with the current decision fingerprint', async () => {
  const tx = row('reviewed', { transferDecision: { version: 1, ownership: 'external', decidedAt: 2 } });
  const h = createUI({ transactions: [tx] });
  byId(h.render(), 'transfer-filter-reviewed').props.onPress();
  openEntry(h);
  const tree = h.render();
  assert.ok(text(byId(tree, 'transfer-review-confirmation')).includes(h.words.undoBody));
  byLabel(tree, h.words.undo).props.onPress(); await flush();
  assert.deepEqual(h.events[0], ['resolve', { ids: ['reviewed'], ownership: null,
    expectedFingerprints: { reviewed: fingerprint(tx) }, expectedGeneration: 1 }]);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.undone]);
});

test('deep links derive their current group and can show the complete review list', () => {
  const h = createUI({ transactions: [row('a'), row('b', { accountId: 'other' })], params: { transactionId: 'b' },
    groupDefinitions: [{ id: 'a', transactionIds: ['a'], bulkEligible: false }, { id: 'b', transactionIds: ['b'], bulkEligible: false }] });
  let tree = h.render();
  assert.equal(walk(tree).filter(node => node.props?.testID === 'transfer-review-entry').length, 1);
  assert.ok(text(tree).includes('Other bank'));
  byLabel(tree, h.words.showAll).props.onPress(); tree = h.render();
  assert.equal(walk(tree).filter(node => node.props?.testID === 'transfer-review-entry').length, 0);
  expandGroups(h); tree = h.render();
  assert.equal(walk(tree).filter(node => node.props?.testID === 'transfer-review-entry').length, 2);
});

test('leaving an uncertain entry unclassified does not write, dismiss, or announce success', () => {
  const h = createUI();
  const before = plain(h.state.transactions);
  openEntry(h);
  byLabel(h.render(), h.words.keepSeparate).props.onPress();
  assert.equal(byId(h.render(), 'transfer-review-confirmation'), undefined);
  assert.deepEqual(plain(h.state.transactions), before);
  assert.deepEqual(h.events, []);
});

test('3,106 old entries stay optional and collapse into a bounded historical view', () => {
  const h = createUI({ transactions: Array.from({ length: 3106 }, (_, i) => row(`old-${i}`, { date: '2022-11-05' })) });
  let tree = h.render();
  assert.ok(text(tree).includes(h.words.recentEmpty));
  assert.ok(text(tree).includes(h.words.historyAvailable(3106)));
  byId(tree, 'transfer-scope-all').props.onPress();
  tree = h.render();
  assert.equal(walk(tree).filter(n => n.props?.testID === 'transfer-group-toggle').length, 1);
  assert.equal(walk(tree).filter(n => n.props?.testID === 'transfer-review-entry').length, 0);
  expandGroups(h); tree = h.render();
  assert.equal(walk(tree).filter(n => n.props?.testID === 'transfer-review-entry').length, 20);
  byLabel(tree, h.words.more(20, 3106)).props.onPress();
  assert.equal(walk(h.render()).filter(n => n.props?.testID === 'transfer-review-entry').length, 40);
  byId(h.render(), 'transfer-search').props.onChangeText('old');
  assert.deepEqual(h.events, []);
  assert.equal(h.state.transactions.length, 3106);
});
