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
  params = {}, resolveTransfers, resolveTransferBatch, ensureDurable, groupDefinitions, assessments = {}, pending = [], largeText = false } = {}) {
  const events = [], slots = [], refs = [];
  let cursor = 0, refCursor = 0, generation = 1;
  const state = { language, hydrated: true, transactions,
    accounts: [{ id: 'bank', name: 'Synthetic bank', last4: '1234' }, { id: 'other', name: 'Other bank', last4: '5678' }] };
  const store = { state, getStateGeneration: () => generation, getStateSnapshot: () => state,
    resolveTransfers: async request => { events.push(['resolve', plain(request)]); return resolveTransfers?.(request, state); },
    resolveTransferBatch: async request => { events.push(['batch', plain(request)]); return resolveTransferBatch?.(request, state); },
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
      const rows = txs.filter(tx => definition.transactionIds.includes(tx.id) && !tx.transferDecision &&
        (!assessments[tx.id] || pending.includes(tx.id)));
      return rows.length ? [{ id: definition.id, transactionIds: rows.map(tx => tx.id), accountId: rows[0].accountId,
        direction: rows[0].type, status: 'ownership-unknown', bulkEligible: definition.bulkEligible,
        counterparty: definition.bulkEligible ? { last4: '9876', kind: 'account', bankIdentity: 'synthetic-bank' } : undefined }] : [];
    });
    return { groups, pendingIds: new Set([...groups.flatMap(group => group.transactionIds), ...pending]), internalIds: new Set(),
      byId: new Map(txs.map(tx => [tx.id, { status: tx.transferDecision
        ? tx.transferDecision.ownership === 'own' ? 'counterpart-missing' : 'confirmed-external' : 'ownership-unknown', ...assessments[tx.id] }])) };
  };
  const deps = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ back: () => events.push(['back']), push: route => events.push(['route', route]) }) },
    '@/lib/store': { useStore: () => store, useStoreSelector: select => select(store), useStoreActions: () => store }, '@/lib/i18n': { getLanguage: () => language },
    '@/lib/markets': load(path.join(root, 'src/lib/markets.ts')),
    // Formatting is a boundary stub here, as with formatAED below; monetary implementation has its own suites.
    '@/lib/ledger-money': { formatMinorUnits: (amount, spec) => (amount / 10 ** spec.exponent).toFixed(spec.exponent) },
    '@/lib/format': { formatAED: amount => `AED ${(amount / 100).toFixed(2)}`, fullDateTime: tx => `${tx.date} ${tx.ts}`,
      shortDate: date => date, shortDateWithYear: date => date, toISODate: () => '2026-09-09', formatAmount: amount => (amount / 100).toFixed(2) },
    '@/lib/transfer-reconciliation': { reconcileTransfers: reconcile, transferFingerprint: fingerprint,
      isTransferCandidate: require('../build/transfer-reconciliation.js').isTransferCandidate,
      transferDeclined: require('../build/transfer-reconciliation.js').transferDeclined },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-theme': { useTheme: () => ({ cardBorder: '#ccc', primary: '#147', textSecondary: '#555' }) },
    '@/constants/theme': { Fonts: { sansSemi: 'Geist-SemiBold' }, Spacing: { one: 4, two: 8, three: 12, four: 16, six: 24 } },
    '@/components/themed-text': { ThemedText: props => jsx('Text', props) },
    '@/components/ui/icon': { Icon: props => jsx('Icon', props) },
    '@/components/ui/controls': { Button: props => jsx('Button', { ...props, accessibilityLabel: props.label, children: props.label }) },
    // The E button is the Transfers page's button: it names itself by its label (its own suite covers the rest).
    '@/components/ui/band/e-button': { EButton: props => jsx('Button', { ...props, accessibilityLabel: props.label, children: props.label }) },
    // Row amounts are Money, a formatting boundary here as formatAED is; the sign glyph is kept.
    '@/components/ui/money': { Money: props => jsx('Money', { ...props,
      children: `${props.sign === 'minus' ? '−' : props.sign === 'plus' ? '+' : ''}AED ${(props.fils / 100).toFixed(2)}` }) },
    '@/hooks/use-ledger-money': { useLedgerMoney: () => null },
    // The decorative coin lane is its own suite (transfer-coins); here it is an opaque, hidden child.
    '@/components/transfer-coins/route-coin': { RouteCoinLane: props => jsx('Lane', { ...props, accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants' }) },
    '@/components/ui/text-field': { TextField: props => jsx('TextInput', props) },
    '@/components/ui/toast': { useToast: () => ({ show: message => events.push(['toast', message]) }) },
    '@/components/ui/bottom-sheet': { BottomSheet: props => props.visible ? jsx('Sheet', props) : null },
    // Design language E: the slate band scaffold renders its band, then the sheet.
    '@/components/ui/band-scaffold': { BandScaffold: props => jsx('Scaffold', { ...props, children: [props.bandContent, props.children, props.footer] }),
      useBandBottomInset: () => 20 },
    '@/hooks/use-band': { useBand: id => ({ id, band: '#2F6577', onBand: '#F4F1EA', onBandSecondary: '#D6DCD9', sheet: '#F4F1EA',
      card: '#FBF9F4', rule: '#E3DED2', text: '#16130F', textSecondary: '#57524A', tint: '#2F6577', fill: '#2F6577', onFill: '#F4F1EA',
      glyphGround: '#EDE3CF', statusNear: '#7E5F14', statusNearSoft: '#F1E9D8' }) },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => largeText },
    // The current money month; the matched-pairs tests below decide membership themselves.
    '@/lib/period': { currentMonthPeriod: () => ({ mode: 'month', key: '2026-09' }), inPeriod: date => date.startsWith('2026-09') },
  };
  deps['@/lib/review-band-copy'] = load(path.join(root, 'src/lib/review-band-copy.ts'));
  deps['@/components/transfer-pair-accounts'] = load(path.join(root, 'src/components/transfer-pair-accounts.tsx'), deps);
  deps['@/lib/transfer-activity-copy'] = load(path.join(root, 'src/lib/transfer-activity-copy.ts'), deps);
  deps['@/lib/transfer-review-copy'] = load(path.join(root, 'src/lib/transfer-review-copy.ts'), deps);
  // The Transfers page's route row and chips, from source.
  deps['@/components/transfers/transfer-route-row'] = load(path.join(root, 'src/components/transfers/transfer-route-row.tsx'), deps);
  deps['@/lib/reference-copy'] = load(path.join(root, 'src/lib/reference-copy.ts'));
  deps['@/lib/transfer-review-presentation'] = load(path.join(root, 'src/lib/transfer-review-presentation.ts'), deps);
  deps['@/lib/details-copy'] = load(path.join(root, 'src/lib/details-copy.ts'));
  deps['@/lib/transfer-pairs'] = load(path.join(root, 'src/lib/transfer-pairs.ts'), deps);
  const screen = load(path.join(root, 'src/app/review-transfers.tsx'), deps).default;
  const notice = load(path.join(root, 'src/components/transfer-review-notice.tsx'), deps).TransferReviewNotice;
  const render = () => { cursor = 0; refCursor = 0; return screen(); };
  return { render, notice, state, store, events, words: deps['@/lib/transfer-review-copy'].transferReviewCopy(language),
    setGeneration: value => { generation = value; } };
}

for (const language of ['en', 'ar']) {
  for (const reason of ['known-account', 'known-card']) {
    test(`${language}: ${reason} explains cross-SMS ownership without a fake receipt and allows correction`, async () => {
      const h = createUI({ language, transactions: [row('known')], params: { transactionId: 'known' },
        assessments: { known: { status: reason === 'known-card' ? 'card-repayment' : 'confirmed-own',
          reason, counterpartyAccountId: 'other' } } });
      openEntry(h);
      const tree = h.render();
      assert.ok(text(byId(tree, 'transfer-known-ownership-evidence')).includes(
        reason === 'known-card' ? h.words.knownCardEvidence : h.words.knownAccountEvidence));
      assert.equal(byId(tree, 'transfer-counterpart-evidence'), undefined, 'no invented receipt');
      assert.ok(byId(tree, 'transfer-choice-external'), 'automatic classification can be corrected');
      byId(tree, 'transfer-choice-external').props.onPress();
      byLabel(h.render(), h.words.confirm).props.onPress();
      await flush();
      assert.equal(h.events[0][1].ownership, 'external');
      assert.deepEqual(h.events[0][1].ids, ['known']);
    });
  }
}

for (const language of ['en', 'ar']) {
  test(`${language}: Home has a compact exclusion disclosure, not a monetary backlog or mandatory task list`, () => {
    const h = createUI({ language });
    assert.equal(h.notice({ pendingCount: 0, incomingFils: 0, outgoingFils: 0, onPress() {} }), null);
    const notice = h.notice({ pendingCount: 2, incomingFils: 12345, outgoingFils: 6789, onPress: () => h.events.push(['open']) });
    assert.ok(notice.props.accessibilityLabel.includes(h.words.noticeBody));
    const homeWords = load(path.join(root, 'src/lib/reference-copy.ts')).homeSummaryCopy[language];
    assert.ok(text(notice).includes(homeWords.transfersToConfirm(2)));
    assert.ok(text(notice).includes(homeWords.transfersNotCounted));
    assert.ok(!text(notice).includes('AED'));
    notice.props.onPress(); assert.deepEqual(h.events, [['open']]);
  });
  test(`${language}: catchall rows stay individual, virtualized and source-free`, () => {
    const h = createUI({ language, transactions: [row('a', { raw: 'PRIVATE_SOURCE_MUST_NOT_RENDER' }), row('b')] });
    assert.equal(walk(h.render()).filter(n => n.props?.testID === 'transfer-review-entry').length, 0);
    expandGroups(h);
    const tree = h.render();
    assert.equal(walk(tree).find(n => n.type === 'Scaffold').props.band, 'accounts');
    assert.ok(walk(tree).find(n => n.type === 'FlatList'), 'the sheet holds one virtualized list');
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

test('save submits the latest preview choice explicitly, including a changed choice', async () => {
  // The production transform misbound a default parameter that shared the
  // body-local `selection` name. Source execution alone did not catch it.
  const source = require('node:fs').readFileSync(path.join(root, 'src/app/review-transfers.tsx'), 'utf8');
  assert.match(source, /const save = async \(target: Selection \| null, oneTap = false\)/);
  assert.match(source, /onPress=\{\(\) => void save\(selection\)\}/);
  const h = createUI();
  openEntry(h);
  byId(h.render(), 'transfer-choice-own').props.onPress();
  byId(h.render(), 'transfer-choice-external').props.onPress();
  byLabel(h.render(), h.words.confirm).props.onPress();
  await flush();
  const resolved = h.events.filter(event => event[0] === 'resolve');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0][1].ownership, 'external');
  assert.deepEqual(resolved[0][1].ids, ['one']);
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
  // Confirmed transfers are no longer a second history browser. They remain
  // correctable from a contextual deep link (for example transaction details).
  const h = createUI({ transactions: [tx], params: { transactionId: 'reviewed' } });
  openEntry(h);
  const tree = h.render();
  assert.ok(text(byId(tree, 'transfer-review-confirmation')).includes(h.words.undoBody));
  byLabel(tree, h.words.undo).props.onPress(); await flush();
  assert.deepEqual(h.events[0], ['resolve', { ids: ['reviewed'], ownership: null,
    expectedFingerprints: { reviewed: fingerprint(tx) }, expectedGeneration: 1 }]);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.undone]);
});

test('a row answered "not a transfer" is never listed here as "with someone else"', () => {
  const external = row('external', { transferDecision: { version: 1, ownership: 'external', decidedAt: 2 } });
  const declined = row('declined', { transferDecision: { version: 1, ownership: 'none', decidedAt: 3 } });
  const h = createUI({ transactions: [external, declined], params: { transactionId: 'external' } });
  byLabel(h.render(), h.words.showAll).props.onPress();
  expandGroups(h);
  const tree = h.render();
  const entries = walk(tree).filter(node => node.props?.testID === 'transfer-review-entry');
  assert.equal(entries.length, 1, 'the declined row has no place on the transfer review screen');
  assert.ok(entries[0].props.accessibilityLabel.includes(external.title));
  assert.equal(text(tree).includes(h.words.confirmedExternal), true, 'the real external answer still reads as one');
  const alone = createUI({ transactions: [declined], params: { transactionId: 'declined' } });
  byLabel(alone.render(), alone.words.showAll)?.props.onPress();
  expandGroups(alone);
  assert.equal(walk(alone.render()).filter(node => node.props?.testID === 'transfer-review-entry').length, 0);
  assert.equal(text(alone.render()).includes(alone.words.confirmedExternal), false);
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

test('focused low-signal transfers open a guarded review without adding generic unknowns to the default queue', async () => {
  const tx = row('low-signal');
  const h = createUI({ transactions: [tx], params: { transactionId: tx.id }, groupDefinitions: [] });
  const first = h.render();
  assert.ok(byId(first, 'transfer-review-entry'), 'explicitly requested unknown record is reachable despite no pending group');
  assert.deepEqual(h.events, [], 'opening the route cannot classify a record');
  openEntry(h);
  assert.equal(byLabel(h.render(), h.words.confirm).props.disabled, true);
  byId(h.render(), 'transfer-choice-external').props.onPress();
  assert.deepEqual(h.events, [], 'choosing ownership is only a preview');
  byLabel(h.render(), h.words.confirm).props.onPress();
  await flush();
  assert.deepEqual(h.events[0], ['resolve', { ids: [tx.id], ownership: 'external',
    expectedFingerprints: { [tx.id]: fingerprint(tx) }, expectedGeneration: 1 }]);
  const general = createUI({ transactions: [tx], groupDefinitions: [] });
  assert.equal(byId(general.render(), 'transfer-review-entry'), undefined, 'default queue remains unchanged');
  const focused = createUI({ transactions: [tx], params: { transactionId: tx.id }, groupDefinitions: [] });
  byLabel(focused.render(), focused.words.showAll).props.onPress();
  assert.equal(byId(focused.render(), 'transfer-review-entry'), undefined, 'Show all returns only mandatory review groups');
});

test('focused low-signal review retains stale fingerprint protection and rejects non-transfer route targets', () => {
  const h = createUI({ transactions: [row('low-signal')], params: { transactionId: 'low-signal' }, groupDefinitions: [] });
  openEntry(h);
  byId(h.render(), 'transfer-choice-own').props.onPress();
  h.state.transactions = h.state.transactions.map(tx => ({ ...tx, amountFils: 55500 }));
  assert.equal(byLabel(h.render(), h.words.confirm).props.disabled, true);
  byLabel(h.render(), h.words.confirm).props.onPress();
  assert.deepEqual(h.events, []);
  const salary = createUI({ transactions: [row('salary', { title: 'Salary', category: 'salary' })],
    params: { transactionId: 'salary' }, groupDefinitions: [] });
  assert.equal(byId(salary.render(), 'transfer-review-entry'), undefined);
});

test('3,106 unresolved entries stay bounded without exposing a second transfer-history mode', () => {
  const h = createUI({ transactions: Array.from({ length: 3106 }, (_, i) => row(`old-${i}`, { date: '2022-11-05' })) });
  let tree = h.render();
  assert.equal(byId(tree, 'transfer-scope-all'), undefined);
  assert.equal(byId(tree, 'transfer-filter-reviewed'), undefined);
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

// Suggested own-account pairs (redesign): one card per Out/In pair, answered
// with one tap through the same link request and change checks as the sheet.
const pairLegs = () => [row('out'), row('in', { type: 'income', accountId: 'other' })];
const pairAssessments = {
  out: { status: 'likely-own', reason: 'amount-time', counterpartId: 'in', candidateIds: ['in'] },
  in: { status: 'likely-own', reason: 'amount-time', counterpartId: 'out', candidateIds: ['out'] },
};
test('external classification of a suggested leg can retry storage without requiring an unchanged counterpart receipt', async () => {
  const h = createUI({ transactions: pairLegs(),
    groupDefinitions: [{ id: 'out-group', transactionIds: ['out'], bulkEligible: false }], params: { transactionId: 'out' },
    pending: ['out', 'in'], assessments: pairAssessments,
    resolveTransfers: async (request, state) => {
      state.transactions = state.transactions.map(tx => tx.id === 'out'
        ? { ...tx, transferDecision: { version: 1, ownership: request.ownership, decidedAt: 1 } } : tx);
      throw Object.assign(new Error('write failed'), { code: 'transfer-durability',
        expectedFingerprints: { out: fingerprint(state.transactions.find(tx => tx.id === 'out')) } });
    } });
  const screen = h.render();
  const entry = byId(screen, 'transfer-review-entry');
  assert.ok(entry, 'the suggested outgoing entry is available for individual review');
  entry.props.onPress();
  byId(h.render(), 'transfer-choice-external').props.onPress();
  byLabel(h.render(), h.words.confirm).props.onPress();
  await flush();
  const retry = byLabel(h.render(), h.words.retrySave);
  assert.equal(retry.props.disabled, false);
  retry.props.onPress();
  await flush();
  assert.equal(h.events.filter(event => event[0] === 'resolve').length, 1);
  assert.equal(h.events.filter(event => event[0] === 'durable').length, 1);
  assert.equal(byId(h.render(), 'transfer-review-confirmation'), undefined);
});

test('an active transfer search remains clearable when the pending count drops below the search threshold', () => {
  const h = createUI({ transactions: Array.from({ length: 10 }, (_, i) => row(`search-${i}`)) });
  byId(h.render(), 'transfer-search').props.onChangeText('Bank');
  h.state.transactions = h.state.transactions.slice(0, 3);
  const search = byId(h.render(), 'transfer-search');
  assert.ok(search);
  assert.equal(search.props.value, 'Bank');
  search.props.onChangeText('');
  assert.equal(byId(h.render(), 'transfer-search'), undefined);
});
const pairCopy = language => load(path.join(root, 'src/lib/details-copy.ts')).detailsCopy[language];
const bandCopy = language => load(path.join(root, 'src/lib/review-band-copy.ts')).reviewBandCopy(language);

for (const language of ['en', 'ar']) {
  test(`${language}: a suggested pair is one card and Match links both legs with their fingerprints`, async () => {
    const h = createUI({ language, transactions: pairLegs(), groupDefinitions: [], pending: ['out', 'in'], assessments: pairAssessments });
    const words = pairCopy(language);
    const tree = h.render();
    assert.equal(walk(tree).filter(n => n.props?.testID === 'transfer-pair-card').length, 1);
    // Drawn as a Transfers route: <account> → <account>, one amount (the legs agree), the date.
    const card = text(byId(tree, 'transfer-pair-card'));
    for (const part of ['Synthetic bank', 'Other bank', 'AED 123.45']) assert.ok(card.includes(part), part);
    assert.ok(text(byId(tree, 'transfer-pair-route')).indexOf('Synthetic bank') < text(byId(tree, 'transfer-pair-route')).indexOf('Other bank'),
      'the route reads from the account it left to the account it reached');
    assert.ok(!card.includes(words.transfers.in + ':'), 'equal legs show one amount');
    // The band counts what is left to check: one suggested pair here.
    assert.ok(text(byId(tree, 'transfer-review-band')).includes(activityCopy(language).card.title(1)));
    // The legs are one labelled, focusable element; Match stays outside it.
    const legs = byId(tree, 'transfer-pair-legs');
    assert.equal(legs.props.accessible, true);
    assert.match(legs.props.accessibilityLabel, /\S/);
    assert.equal(byId(legs, 'transfer-pair-match'), undefined);
    byLabel(tree, words.transfers.match).props.onPress();
    await flush();
    const resolved = h.events.filter(event => event[0] === 'resolve');
    assert.equal(resolved.length, 1);
    const request = resolved[0][1];
    assert.equal(request.ownership, 'own');
    assert.deepEqual([request.ids.length, request.ids[0] === 'out' ? request.counterpartId : request.ids[0]], [1, 'in']);
    assert.deepEqual(Object.keys(request.expectedFingerprints).sort(), ['in', 'out']);
    assert.equal(request.expectedGeneration, 1);
    assert.ok(h.events.some(event => event[0] === 'toast' && event[1] === words.transfers.matched));
  });
}

test('a pair that changed before Match is refused without a write', async () => {
  const h = createUI({ transactions: pairLegs(), groupDefinitions: [], pending: ['out', 'in'], assessments: pairAssessments });
  const words = pairCopy('en');
  const tree = h.render();
  h.state.transactions = h.state.transactions.map(tx => tx.id === 'in' ? { ...tx, amountFils: 99 } : tx);
  byLabel(tree, words.transfers.match).props.onPress();
  await flush();
  assert.equal(h.events.some(event => event[0] === 'resolve'), false);
  assert.ok(h.events.some(event => event[0] === 'toast' && event[1] === h.words.changed));
});

test('a rejected Match opens the review sheet with the error instead of announcing success', async () => {
  const h = createUI({ transactions: pairLegs(), groupDefinitions: [], pending: ['out', 'in'], assessments: pairAssessments,
    resolveTransfers: () => { throw new Error('rejected'); } });
  const words = pairCopy('en');
  byLabel(h.render(), words.transfers.match).props.onPress();
  await flush();
  const tree = h.render();
  assert.ok(byId(tree, 'transfer-review-confirmation'), 'the sheet shows the failed decision');
  assert.ok(text(byId(tree, 'transfer-review-error')).includes(h.words.saveFailed));
  assert.equal(h.events.some(event => event[0] === 'toast' && event[1] === words.transfers.matched), false);
});

test('Not a pair writes nothing and removes only the suggestion', () => {
  const h = createUI({ transactions: pairLegs(), groupDefinitions: [], pending: ['out', 'in'], assessments: pairAssessments });
  const words = pairCopy('en');
  byLabel(h.render(), words.transfers.notPair).props.onPress();
  assert.equal(byId(h.render(), 'transfer-pair-card'), undefined);
  assert.deepEqual(h.events, [['toast', words.transfers.notPairDone]]);
  assert.equal(h.state.transactions.length, 2);
});

test('card repayments are never offered as a transfer pair', () => {
  const h = createUI({ transactions: pairLegs(), groupDefinitions: [], pending: ['out', 'in'],
    assessments: { out: { ...pairAssessments.out, status: 'likely-card-repayment' }, in: { ...pairAssessments.in, status: 'likely-card-repayment' } } });
  assert.equal(byId(h.render(), 'transfer-pair-card'), undefined);
});

// "Matched this month" (slate band): only pairs the reconciler confirmed,
// both legs naming each other, in the current money month. Never a suggestion.
const confirmedPair = (outId, inId, date) => [row(outId, { date }), row(inId, { type: 'income', accountId: 'other', date })];
const confirmedAssessments = (outId, inId) => ({
  [outId]: { status: 'confirmed-own', counterpartId: inId }, [inId]: { status: 'confirmed-own', counterpartId: outId },
});
for (const language of ['en', 'ar']) {
  test(`${language}: matched this month lists confirmed pairs only and links to Transfers`, () => {
    const h = createUI({ language, groupDefinitions: [],
      transactions: [...confirmedPair('m-out', 'm-in', '2026-09-03'), ...confirmedPair('old-out', 'old-in', '2026-08-20'), ...pairLegs()],
      pending: ['out', 'in'],
      assessments: { ...confirmedAssessments('m-out', 'm-in'), ...confirmedAssessments('old-out', 'old-in'), ...pairAssessments } });
    const tree = h.render();
    const section = byId(tree, 'transfer-matched-pairs');
    assert.ok(text(section).includes(bandCopy(language).matchedThisMonth));
    const rows = walk(section).filter(node => node.props?.testID === 'transfer-matched-pair');
    assert.equal(rows.length, 1, 'last month and the open suggestion are not "matched this month"');
    assert.ok(rows[0].props.accessibilityLabel.includes('2026-09-03'));
    byId(section, 'transfer-matched-all').props.onPress();
    assert.deepEqual(h.events, [['route', '/transfers']]);
  });
}
test('a pair whose legs no longer name each other is not shown as matched', () => {
  const h = createUI({ groupDefinitions: [], transactions: confirmedPair('m-out', 'm-in', '2026-09-03'),
    assessments: { 'm-out': { status: 'confirmed-own', counterpartId: 'm-in' }, 'm-in': { status: 'confirmed-own', counterpartId: 'elsewhere' } } });
  assert.equal(byId(h.render(), 'transfer-matched-pairs'), undefined);
});
test('pair legs with different amounts show both, never one merged figure', () => {
  const legs = [row('out'), row('in', { type: 'income', accountId: 'other', amountFils: 12000 })];
  const h = createUI({ transactions: legs, groupDefinitions: [], pending: ['out', 'in'], assessments: pairAssessments });
  const card = text(byId(h.render(), 'transfer-pair-card'));
  assert.ok(card.includes('AED 123.45') && card.includes('AED 120.00'));
});

function manyPairs(count = 2) {
  const transactions = [], assessments = {}, pending = [];
  for (let i = 0; i < count; i++) {
    const out = `out-${i}`, into = `in-${i}`, amountFils = 12345 + i * 100;
    transactions.push(row(out, { amountFils }), row(into, { type: 'income', accountId: 'other', amountFils }));
    assessments[out] = { status: 'likely-own', reason: 'amount-time', counterpartId: into, candidateIds: [into] };
    assessments[into] = { status: 'likely-own', reason: 'amount-time', counterpartId: out, candidateIds: [out] };
    pending.push(out, into);
  }
  return { transactions, assessments, pending, groupDefinitions: [] };
}
const startSelecting = h => byLabel(h.render(), h.words.selectTransfers).props.onPress();
const checks = h => walk(h.render()).filter(n => n.props?.testID === 'transfer-pair-select');
const reviewSelected = (h, count) => byLabel(h.render(), h.words.reviewSelected(count)).props.onPress();

for (const language of ['en', 'ar']) {
  test(`${language}: selected pairs confirm in one durable batch, with reciprocal targets and a repeated-tap guard`, async () => {
    const pending = deferred();
    const h = createUI({ ...manyPairs(), language, resolveTransferBatch: () => pending.promise });
    startSelecting(h);
    checks(h)[0].props.onPress(); checks(h)[1].props.onPress();
    assert.equal(checks(h).every(n => n.props.accessibilityState.checked), true);
    assert.equal(checks(h).every(n => n.props['aria-checked']), true, 'web exposes the checked state');
    assert.deepEqual(h.events, [], 'checking a row never changes the ledger');
    reviewSelected(h, 2);
    const sheet = byId(h.render(), 'transfer-review-confirmation');
    assert.equal(walk(sheet).filter(n => n.props?.testID === 'transfer-batch-preview-item').length, 2);
    assert.ok(text(sheet).includes(h.words.ownBody));
    assert.equal(byId(sheet, 'transfer-choice-external'), undefined, 'the batch action explicitly confirms own-account transfers');
    const confirm = byLabel(sheet, h.words.confirmSelected(2));
    confirm.props.onPress(); confirm.props.onPress();
    assert.equal(h.events.filter(e => e[0] === 'batch').length, 1);
    const request = h.events[0][1];
    assert.equal(request.decisions.length, 2);
    assert.deepEqual(request.decisions.map(d => [d.ids[0], d.counterpartId]).sort(), [['out-0', 'in-0'], ['out-1', 'in-1']]);
    assert.deepEqual(Object.keys(request.expectedFingerprints).sort(), ['in-0', 'in-1', 'out-0', 'out-1']);
    assert.equal(request.expectedGeneration, 1);
    assert.equal(h.events.some(e => e[0] === 'toast'), false);
    pending.resolve(); await flush();
    assert.equal(byId(h.render(), 'transfer-review-confirmation'), undefined);
    assert.equal(byId(h.render(), 'transfer-selection-footer'), undefined);
    assert.deepEqual(h.events.at(-1), ['toast', h.words.batchSaved(2)]);
  });
}

test('individual entries from different groups can be selected without applying a catchall group decision', async () => {
  const h = createUI({ transactions: [row('a'), row('b', { accountId: 'other' }), row('untouched')],
    groupDefinitions: [{ id: 'a', transactionIds: ['a', 'untouched'], bulkEligible: false },
      { id: 'b', transactionIds: ['b'], bulkEligible: false }] });
  startSelecting(h); expandGroups(h);
  const entries = walk(h.render()).filter(n => n.props?.testID === 'transfer-review-entry');
  entries[0].props.onPress(); entries[2].props.onPress();
  reviewSelected(h, 2);
  byLabel(byId(h.render(), 'transfer-review-confirmation'), h.words.confirmSelected(2)).props.onPress(); await flush();
  assert.equal(h.events.filter(e => e[0] === 'batch').length, 1);
  const request = h.events[0][1];
  assert.equal(request.decisions.every(d => d.ids.length === 1 && !d.counterpartId), true);
  assert.equal(request.decisions.length, 2);
  assert.deepEqual(request.decisions.flatMap(d => d.ids).sort(), ['a', 'b']);
  assert.equal(Object.keys(request.expectedFingerprints).length, 2);
});

test('Select all shown obeys pair search and clear selection leaves the ledger unchanged', () => {
  const h = createUI(manyPairs(12));
  startSelecting(h);
  byId(h.render(), 'transfer-search').props.onChangeText('124.45');
  assert.equal(checks(h).length, 1);
  byId(h.render(), 'transfer-select-shown').props.onPress();
  assert.equal(checks(h)[0].props.accessibilityState.checked, true);
  byId(h.render(), 'transfer-search').props.onChangeText('');
  assert.equal(checks(h).filter(n => n.props.accessibilityState.checked).length, 1);
  byId(h.render(), 'transfer-clear-selection').props.onPress();
  assert.equal(byLabel(h.render(), h.words.reviewSelected(0)).props.disabled, true);
  assert.deepEqual(h.events, []);
});

test('300 suggested pair cards are list items, never eagerly mounted in the list header', () => {
  const h = createUI(manyPairs(300));
  const list = walk(h.render()).find(n => n.type === 'FlatList');
  assert.equal(list.props.data.filter(item => item.kind === 'pair').length, 300);
  assert.equal(walk(list.props.ListHeaderComponent).filter(n => n.props?.testID === 'transfer-pair-card').length, 0);
  assert.equal(list.props.initialNumToRender, 8);
  assert.equal(list.props.maxToRenderPerBatch, 8);
});

test('a checked transfer keeps its original preview and blocks the entire batch if a leg changes', async () => {
  const h = createUI(manyPairs());
  startSelecting(h); byId(h.render(), 'transfer-select-shown').props.onPress();
  h.state.transactions = h.state.transactions.map(tx => tx.id === 'in-1' ? { ...tx, amountFils: 99999 } : tx);
  reviewSelected(h, 2);
  const sheet = byId(h.render(), 'transfer-review-confirmation');
  assert.ok(text(sheet).includes('AED 124.45'));
  assert.ok(!text(sheet).includes('AED 999.99'));
  assert.equal(byLabel(sheet, h.words.confirmSelected(2)).props.disabled, true);
  byLabel(sheet, h.words.confirmSelected(2)).props.onPress(); await flush();
  assert.equal(h.events.some(e => e[0] === 'batch'), false);
});

test('restore between checking and opening confirmation invalidates the selected ledger', () => {
  const h = createUI(manyPairs());
  startSelecting(h); byId(h.render(), 'transfer-select-shown').props.onPress();
  h.setGeneration(2); reviewSelected(h, 2);
  assert.equal(byId(h.render(), 'transfer-review-confirmation'), undefined);
  assert.deepEqual(h.events, [['toast', h.words.changed]]);
});

test('batch storage failure retries the write once without reapplying any selected decisions', async () => {
  const h = createUI({ ...manyPairs(), resolveTransferBatch: async (request, state) => {
    state.transactions = state.transactions.map(tx => ({ ...tx, transferDecision: { version: 1, ownership: 'own', decidedAt: 1 } }));
    throw Object.assign(new Error('write failed'), { code: 'transfer-durability',
      expectedFingerprints: Object.fromEntries(state.transactions.map(tx => [tx.id, fingerprint(tx)])) });
  } });
  startSelecting(h); byId(h.render(), 'transfer-select-shown').props.onPress(); reviewSelected(h, 2);
  byLabel(byId(h.render(), 'transfer-review-confirmation'), h.words.confirmSelected(2)).props.onPress(); await flush();
  const sheet = byId(h.render(), 'transfer-review-confirmation');
  assert.equal(sheet.props.dismissible, false);
  assert.equal(byLabel(sheet, h.words.cancel).props.disabled, true);
  byLabel(sheet, h.words.retrySave).props.onPress(); await flush();
  assert.equal(h.events.filter(e => e[0] === 'batch').length, 1);
  assert.equal(h.events.filter(e => e[0] === 'durable').length, 1);
  assert.deepEqual(h.events.at(-1), ['toast', h.words.batchSaved(2)]);
});

// ---- The review screen in the Transfers page's design ----
// Home's notice opens the Transfers page (the question card, one at a time); its
// "See all" opens this screen, which draws transfers as the same routes.
const fs = require('node:fs');
const flatStyle = style => Object.assign({}, ...[].concat(typeof style === 'function' ? style({ pressed: false }) : style)
  .flat(Infinity).filter(s => s && typeof s === 'object'));
const activityCopy = language => load(path.join(root, 'src/lib/transfer-activity-copy.ts'),
  { '@/lib/i18n': { getLanguage: () => language } }).transferActivityCopy(language);

test('Home\'s transfer notice opens the Transfers page; its question card\'s See all opens this review', () => {
  const home = fs.readFileSync(path.join(root, 'src/screens/journal-home-screen.tsx'), 'utf8');
  const notice = home.slice(home.indexOf('<TransferReviewNotice'), home.indexOf('/> : null;', home.indexOf('<TransferReviewNotice')));
  // The question card first; straight here only when the card has nothing it can ask.
  assert.match(notice, /onPress=\{\(\) => router\.push\(pendingTransfers\.questions === 0 \? '\/review-transfers' : '\/transfers'\)\}/);
  assert.doesNotMatch(home, /router\.push\('\/review-transfers'\)/, 'Home never skips a question the card can ask');
  assert.match(home, /transferQuestionQueue\(activity\)/, 'Home counts the queue the card answers');
  const transfers = fs.readFileSync(path.join(root, 'src/app/transfers.tsx'), 'utf8');
  assert.match(transfers, /onSeeAll=\{\(\) => router\.push\('\/review-transfers'\)\}/, 'See all still reaches the bulk review');
  // Back from Transfers pops to Home; this screen's back pops to Transfers.
  assert.match(transfers, /back: \(\) => \{ if \(router\.canGoBack\(\)\) router\.back\(\);/);
  assert.match(fs.readFileSync(path.join(root, 'src/app/review-transfers.tsx'), 'utf8'), /nav=\{\{ back: true,/);
});

for (const language of ['en', 'ar']) {
  test(`${language}: a group is one route card: account → unknown side, signed total, entry count and the open tag`, () => {
    const h = createUI({ language, transactions: [row('one', { title: 'First' }), row('two', { title: 'Second' })] });
    const tag = activityCopy(language).tags.needsAnswer;
    let tree = h.render();
    const group = byId(tree, 'transfer-review-group');
    const route = byId(group, 'transfer-group-route-group');
    assert.ok(route, 'the group is drawn as a route');
    const chips = text(route);
    assert.ok(chips.includes('Synthetic bank'), 'the account it left');
    assert.ok(chips.includes('?'), 'an unidentified counterparty is the dashed "?" chip');
    assert.ok(!chips.includes(h.words.counterpartyUnknown), 'not the old "Counterparty not identified" line');
    assert.ok(chips.includes('−AED 246.90'), 'money out is signed, as on the Transfers page');
    assert.ok(walk(route).some(node => node.type === 'Lane'), 'the coin lane sits between the chips');
    assert.ok(text(byId(group, 'transfer-group-count')).includes(h.words.count(2)), 'the entries it stands for, shown on the card');
    assert.ok(text(group).includes(tag));
    assert.ok(!text(group).includes(h.words.sent), 'the direction reads from the route, not "· Sent"');
    // The toggle still speaks the account, the counterparty and what tapping does.
    const toggle = byId(group, 'transfer-group-toggle');
    assert.equal(toggle.props.accessibilityLabel, `Synthetic bank · ••1234. ${h.words.counterpartyUnknown}. ${h.words.expand(2)}`);
    assert.ok(flatStyle(toggle.props.style).minHeight >= 44);
    // Expanded, the entries are set in under the route in the same card, each with its own signed amount.
    expandGroups(h); tree = h.render();
    const entries = walk(tree).filter(node => node.props?.testID === 'transfer-review-entry');
    assert.equal(entries.length, 2);
    assert.ok(text(entries[0]).includes('−AED 123.45'));
    assert.equal(flatStyle(entries[0].props.style).backgroundColor, '#FBF9F4', 'the entry continues the group card');
    assert.ok(flatStyle(entries.at(-1).props.style).borderBottomEndRadius > 0, 'the last entry closes the card');
    assert.equal(flatStyle(byId(tree, 'transfer-review-group').props.style).borderBottomEndRadius, undefined, 'an open group continues below');
  });
}

test('a named counterparty is a chip, and money in reads from it to the account', () => {
  const h = createUI({ bulk: true, transactions: [row('a', { type: 'income' }), row('b', { type: 'income' })] });
  const route = text(byId(h.render(), 'transfer-group-route-group'));
  const other = h.words.accountEnding('9876');
  assert.ok(route.includes(other));
  assert.ok(route.indexOf(other) < route.indexOf('Synthetic bank'), 'incoming: the other side → your account');
  assert.ok(route.includes('+AED 246.90'));
});

test('pair answers and selection controls use the Transfers page\'s buttons; Select and Review are E buttons', () => {
  const h = createUI(manyPairs());
  let tree = h.render();
  const match = byId(tree, 'transfer-pair-match');
  const separate = byId(tree, 'transfer-pair-separate');
  for (const button of [match, separate]) {
    const style = flatStyle(button.props.style);
    assert.ok(style.minHeight >= 44 && style.borderRadius === 14, 'the question card\'s 48pt, 14pt-radius answer');
  }
  assert.equal(flatStyle(match.props.style).backgroundColor, '#2F6577', 'the first answer is the band fill');
  assert.ok(flatStyle(separate.props.style).borderWidth >= 1, 'the other answer is bordered');
  const select = byLabel(tree, h.words.selectTransfers);
  assert.ok(select.props.palette, 'Select transfers is an E button on the band palette');
  assert.equal(select.props.variant, 'secondary');
  select.props.onPress(); tree = h.render();
  for (const id of ['transfer-select-shown', 'transfer-cancel-selection']) {
    assert.ok(flatStyle(byId(tree, id).props.style).minHeight >= 44, id);
  }
  const footer = byId(tree, 'transfer-selection-footer');
  assert.ok(byLabel(footer, h.words.reviewSelected(0)).props.palette, 'Review selected is an E button');
  byId(tree, 'transfer-select-shown').props.onPress();
  reviewSelected(h, 2);
  const sheet = byId(h.render(), 'transfer-review-confirmation');
  const items = walk(sheet).filter(node => node.props?.testID === 'transfer-batch-preview-item');
  assert.ok(items.every(item => walk(item).some(node => node.type === 'Lane')), 'each selected transfer is drawn as its route');
  assert.ok(text(items[0]).includes(h.words.sent) && text(items[0]).includes(h.words.received));
  assert.ok(byLabel(sheet, h.words.confirmSelected(2)).props.palette, 'the batch confirm is an E button');
  assert.deepEqual(h.events, [], 'restyling never writes');
});

test('large text stacks the routes, the entries and the answer buttons', () => {
  const h = createUI({ ...manyPairs(1), largeText: true });
  const tree = h.render();
  assert.equal(flatStyle(byId(tree, 'transfer-pair-route').props.style).flexDirection, 'column');
  const choices = walk(tree).find(node => node.props?.children?.some?.(child => child?.props?.testID === 'transfer-pair-match'));
  assert.equal(flatStyle(choices.props.style).flexDirection, 'column');
  assert.equal(flatStyle(byId(tree, 'transfer-pair-match').props.style).alignSelf, 'stretch');
  const grouped = createUI({ largeText: true });
  expandGroups(grouped);
  const entry = byId(grouped.render(), 'transfer-review-entry');
  assert.ok(walk(entry).some(node => flatStyle(node.props?.style).flexDirection === 'column'), 'entry text and amount stack');
  assert.equal(flatStyle(byId(grouped.render(), 'transfer-group-route-group').props.style).flexDirection, 'column');
});

for (const language of ['en', 'ar']) {
  test(`${language}: the band reads like the Transfers band: the count, then that it is not counted`, () => {
    const h = createUI({ language });
    const band = text(byId(h.render(), 'transfer-review-band'));
    // The same words as the question card ("N transfers need an answer"), not a third name for the queue.
    assert.ok(band.includes(activityCopy(language).card.title(2)));
    assert.ok(!band.includes(bandCopy(language).toCheck(2)));
    assert.ok(band.includes(activityCopy(language).notCounted));
    assert.ok(band.includes(h.words.intro));
  });
}

test('confirmed pairs this month are routes tagged as your accounts', () => {
  const h = createUI({ groupDefinitions: [], transactions: confirmedPair('m-out', 'm-in', '2026-09-03'),
    assessments: confirmedAssessments('m-out', 'm-in') });
  const pair = byId(h.render(), 'transfer-matched-pair');
  assert.ok(text(pair).includes(activityCopy('en').tags.own));
  assert.ok(walk(pair).some(node => node.type === 'Lane'));
  assert.equal(pair.props.accessible, true, 'one spoken row');
});

for (const language of ['en', 'ar']) {
  test(`${language}: at large text the band keeps only a capped, whole-word headline; the rest moves onto the sheet`, () => {
    const h = createUI({ language, largeText: true });
    const tree = h.render();
    const band = byId(tree, 'transfer-review-band');
    const headline = walk(band).find(node => node.props?.accessibilityRole === 'header');
    assert.ok(headline.props.maxFontSizeMultiplier <= 1.3, 'the headline cannot grow past the screen');
    const style = flatStyle(headline.props.style);
    assert.ok(style.fontSize <= 24 && style.maxWidth === '100%');
    assert.equal(headline.props.numberOfLines, undefined, 'it wraps whole words, never truncates');
    assert.equal(text(band).includes(activityCopy(language).notCounted), false);
    assert.equal(text(band).includes(h.words.intro), false);
    const list = walk(tree).find(node => node.type === 'FlatList');
    assert.ok(text(list.props.ListHeaderComponent).includes(activityCopy(language).notCounted));
    assert.ok(text(list.props.ListHeaderComponent).includes(h.words.intro));
  });
}

test('select mode: a one-entry group carries its entry\'s checkbox, no "1 entry" pill, and Select all counts it', async () => {
  const h = createUI({ transactions: [row('a'), row('b', { accountId: 'other' }), row('c')],
    groupDefinitions: [{ id: 'one', transactionIds: ['b'], bulkEligible: false }, { id: 'two', transactionIds: ['a', 'c'], bulkEligible: false }] });
  let tree = h.render();
  const groups = walk(tree).filter(node => node.props?.testID === 'transfer-review-group');
  const single = groups.find(group => text(group).includes('Other bank'));
  assert.equal(byId(single, 'transfer-group-count'), undefined, 'one entry needs no count');
  assert.ok(byId(groups.find(group => group !== single), 'transfer-group-count'), 'several entries keep theirs');
  assert.equal(byId(tree, 'transfer-group-select'), undefined, 'no checkbox outside select mode');
  startSelecting(h); tree = h.render();
  const check = byId(tree, 'transfer-group-select');
  assert.equal(check.props.accessibilityRole, 'checkbox');
  assert.ok(check.props.accessibilityLabel.includes(h.words.selectItem));
  // What has a checkbox on screen is what "Select all shown" counts: the one-entry group's entry only
  // (the two-entry group stays collapsed and is never selected whole).
  assert.equal(byId(tree, 'transfer-select-shown').props.accessibilityLabel, h.words.selectShown(1));
  check.props.onPress();
  assert.equal(byId(h.render(), 'transfer-group-select').props.accessibilityState.checked, true);
  // Expanded, the same entry's row is checked: one selection, one key.
  expandGroups(h);
  const entry = walk(h.render()).filter(node => node.props?.testID === 'transfer-review-entry')
    .find(node => node.props.accessibilityLabel.includes('Bank transfer') && node.props.accessibilityState.checked);
  assert.ok(entry, 'the entry row shows the same check');
  assert.equal(byId(h.render(), 'transfer-group-select'), undefined, 'expanded, the entry row carries it');
  reviewSelected(h, 1);
  byLabel(byId(h.render(), 'transfer-review-confirmation'), h.words.confirmSelected(1)).props.onPress(); await flush();
  const request = h.events.find(event => event[0] === 'batch')[1];
  assert.deepEqual([...request.decisions.map(d => [...d.ids])], [['b']]);
});

test('disabled selection controls stay legible: no faded fill', () => {
  const h = createUI(manyPairs());
  startSelecting(h);
  const tree = h.render();
  const review = byLabel(byId(tree, 'transfer-selection-footer'), h.words.reviewSelected(0));
  assert.equal(review.props.disabled, true);
  assert.equal(review.props.variant, 'secondary', 'an outline at full ink, not the band fill at 45%');
  assert.equal(flatStyle(review.props.style).opacity, 1);
  // Select all with nothing to select (one collapsed group of two): the secondary ink on a ruled outline.
  const empty = createUI();
  startSelecting(empty);
  const selectAll = byId(empty.render(), 'transfer-select-shown');
  assert.equal(selectAll.props.disabled, true);
  const style = flatStyle(selectAll.props.style);
  assert.equal(style.opacity, 1, 'not faded');
  assert.equal(style.borderColor, '#E3DED2');
  const label = walk(selectAll).find(node => node.type === 'Text');
  assert.equal(flatStyle(label.props.style).color, '#57524A', 'secondary ink (about 7:1 on the sheet)');
});

test('batch preview signs single entries like the list and shows each amount once', () => {
  const h = createUI({ transactions: [row('a'), row('b')],
    groupDefinitions: [{ id: 'g', transactionIds: ['a', 'b'], bulkEligible: false }] });
  startSelecting(h); expandGroups(h);
  byId(h.render(), 'transfer-select-shown').props.onPress();
  reviewSelected(h, 2);
  const items = walk(byId(h.render(), 'transfer-review-confirmation')).filter(node => node.props?.testID === 'transfer-batch-preview-item');
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.ok(text(item).includes('−AED 123.45'), 'money out, signed as in the list');
    assert.equal(text(item).split('123.45').length - 1, 1, 'the amount appears once');
  }
  const pairs = createUI(manyPairs());
  startSelecting(pairs); byId(pairs.render(), 'transfer-select-shown').props.onPress(); reviewSelected(pairs, 2);
  const pairItem = walk(byId(pairs.render(), 'transfer-review-confirmation')).find(node => node.props?.testID === 'transfer-batch-preview-item');
  assert.ok(!text(pairItem).includes('−') && !text(pairItem).includes('+'), 'a pair between your accounts is unsigned, as its card');
  assert.equal(text(pairItem).split('AED 123.45').length - 1, 1);
});
