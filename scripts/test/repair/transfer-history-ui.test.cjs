'use strict';
// The shipping Transfers screen with explicit native/UI boundaries and the real
// transfer projection. Synthetic ledger rows; not a device rendering.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const core = require('../build/transfer-reconciliation.js');
const ledger = require('../build/ledger.js');

const walk = (node, out = []) => {
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return out; }
  if (!node || typeof node !== 'object') return out;
  out.push(node); walk(node.props?.children, out); return out;
};
const text = node => walk(node).flatMap(n => [n.props?.children].flat()).filter(v => typeof v === 'string' || typeof v === 'number').join(' ');
const NOW = Date.parse('2026-09-08T10:00:00Z');
const row = (id, extra = {}) => ({ id, type: 'expense', amountFils: 10000, category: 'other', accountId: 'bank',
  title: `Transfer ${id}`, date: '2026-09-08', ts: NOW, source: 'sms', smsKey: `s${NOW}-${id}`,
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source' }, ...extra });

function renderTransfers({ language = 'en', transactions, accounts, adjust = () => {} }) {
  const events = [];
  const jsx = (type, props = {}) => typeof type === 'function' ? type(props) : { type, props };
  const boundary = name => props => ({ type: name, props });
  // Design language E: the screen sits on the slate band and colours status
  // from the band palette rather than theme names.
  const band = { band: 'band', onBand: 'ink', onBandSecondary: 'ink2', tile: 'tile', textSecondary: 'band-secondary', statusNear: 'band-near',
    statusNearSoft: 'band-near-soft', tint: 'band-tint', rule: 'band-rule', card: 'card', sheet: 'sheet', glyphGround: 'glyph',
    fill: 'fill', onFill: 'on-fill', text: 'text' };
  const state = { language, transactions, accounts };
  const answers = [];
  // State persists across renders (in hook order) so a press followed by rerender() shows its effect.
  const slots = [];
  let cursor = 0;
  const deps = {
    react: { useDeferredValue: v => v, useMemo: f => f(), useRef: v => ({ current: v }), useEffect() {},
      useState: initial => {
        const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
      } },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Keyboard: { dismiss() {} }, Platform: { OS: 'ios' }, Pressable: 'Pressable', View: 'View',
      FlatList: props => ({ type: 'FlatList', props }), StyleSheet: { create: s => s, hairlineWidth: 1 } },
    'expo-router': { useRouter: () => ({ push: route => events.push(['route', route]), back() {}, canGoBack: () => true, replace() {} }),
      useLocalSearchParams: () => ({}) },
    '@/components/entry-detail-sheet': { EntryDetailSheet: boundary('EntryDetailSheet') },
    '@/components/period-sheet': { PeriodSheet: boundary('PeriodSheet') },
    // The route's travelling coin is decorative; its own suite (transfer-coins) draws it.
    '@/components/transfer-coins/route-coin': { RouteCoinLane: boundary('RouteCoinLane') },
    '@/components/themed-text': { ThemedText: boundary('Text') },
    '@/components/ui/band-scaffold': { BandScaffold: props => ({ type: 'BandScaffold', props }), useBandBottomInset: () => 0 },
    '@/components/ui/band/band-figure': { BandFigure: boundary('BandFigure') },
    '@/components/ui/action-icon-button': { ActionIconButton: boundary('ActionIconButton') },
    '@/components/ui/icon': { Icon: boundary('Icon') },
    '@/components/ui/money': { Money: boundary('Money') },
    '@/components/ui/period-pill': { PeriodPill: boundary('PeriodPill') },
    '@/components/ui/text-field': { TextField: boundary('TextField') },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 12, four: 16, five: 24 } },
    '@/hooks/use-band': { useBand: () => band },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => false },
    '@/hooks/use-ledger-money': { useLedgerMoney: () => null },
    '@/hooks/use-transfer-answer': { useTransferAnswer: () => ({ busy: false, answer: async input => { answers.push(input); return 'saved'; } }) },
    '@/lib/format': { formatAED: fils => `AED ${(fils / 100).toFixed(2)}`, formatAmount: fils => (fils / 100).toFixed(2), shortDate: date => date, shortDateWithYear: date => date },
    '@/lib/i18n': { t: key => key, tf: key => key },
    '@/lib/ledger': { accountDisplayName: ledger.accountDisplayName, transferReconciliationForState: current => {
      const result = core.reconcileTransfers(current.transactions, current.accounts);
      adjust(result); return result;
    } },
    '@/lib/ledger-money': { formatMinorUnits: fils => String(fils) },
    '@/lib/markets': { ledgerCurrencyDisplay: () => 'AED', bankBrandForName: () => undefined },
    '@/lib/period': { inPeriod: () => true, isCurrentMonth: () => true, periodLabel: () => 'Sep 2026' },
    '@/lib/period-context': { usePeriod: () => ({ period: { mode: 'all' } }) },
    '@/lib/store': { useStore: () => ({ state, getStateGeneration: () => 1 }),
      useStoreActions: () => ({ getStateGeneration: () => 1, getStateSnapshot: () => state }) },
    '@/components/ui/toast': { useToast: () => ({ show() {} }) },
    '@/components/ui/bottom-sheet': { BottomSheet: props => props.visible ? { type: 'Sheet', props } : null },
    '@/components/ui/band/e-button': { EButton: boundary('EButton') },
    '@/lib/transfer-reconciliation': core,
  };
  const src = file => load(path.join(root, file), deps);
  deps['@/lib/transfer-pairs'] = src('src/lib/transfer-pairs.ts');
  deps['@/lib/transfer-activity'] = src('src/lib/transfer-activity.ts');
  deps['@/lib/transfer-people'] = src('src/lib/transfer-people.ts');
  deps['@/lib/transfer-activity-copy'] = load(path.join(root, 'src/lib/transfer-activity-copy.ts'),
    { '@/lib/i18n': { getLanguage: () => language } });
  deps['@/lib/transfer-answer'] = src('src/lib/transfer-answer.ts');
  deps['@/lib/transfer-list'] = src('src/lib/transfer-list.ts');
  deps['@/components/transfer-coins/coin-cues'] = src('src/components/transfer-coins/coin-cues.ts');
  deps['@/lib/transfer-batch'] = src('src/lib/transfer-batch.ts');
  deps['@/lib/transfer-review-presentation'] = src('src/lib/transfer-review-presentation.ts');
  deps['@/hooks/use-transfer-batch'] = src('src/hooks/use-transfer-batch.ts');
  for (const name of ['transfer-select-mark', 'transfer-answer-choices', 'transfer-route-row', 'transfer-person-row', 'transfer-question-card',
    'transfer-group-row', 'transfer-answer-sheet']) {
    deps[`@/components/transfers/${name}`] = src(`src/components/transfers/${name}.tsx`);
  }
  const Screen = load(path.join(root, 'src/app/transfers.tsx'), deps).default;
  const render = () => {
    cursor = 0;
    const screen = Screen();
    const list = walk(screen).find(node => node.type === 'FlatList');
    const records = list.props.data;
    const items = records.map((item, index) => ({ item, tree: list.props.renderItem({ item, index }) }));
    return { screen, list, records, items };
  };
  return { events, answers, ...render(), rerender: render, band, words: deps['@/lib/transfer-activity-copy'].transferActivityCopy(language) };
}

// Owner decision (Transfers grouped by person): every transfer kept out of the totals needs an answer and is
// counted. A generic unknown with no name reads "Needs an answer" like a queued row; the card does not walk such
// one-offs: To answer lists them as one "without a name" row that opens select mode for them.
const byTestId = (tree, id) => walk(tree).find(node => node.props?.testID === id);
for (const language of ['en', 'ar']) test(`${language}: a generic unknown needs an answer too, reached from the To answer list`, () => {
  const accounts = [{ id: 'bank', name: 'Bank', kind: 'bank', openingFils: 0 },
    { id: 'old', name: 'Old', kind: 'bank', openingFils: 0, archived: true }];
  const transactions = [
    row('generic'), row('queued'),
    row('sent', { transferDecision: { version: 1, ownership: 'external', decidedAt: NOW } }),
    row('archived', { accountId: 'old' }),
    row('twice'), row('twice', { amountFils: 20000 }),
  ];
  const adjust = result => {
    result.byId.set('queued', { id: 'queued', status: 'likely-own', reason: 'amount-time', candidateIds: ['x'] });
    result.pendingIds.add('queued');
  };
  const h = renderTransfers({ language, transactions, accounts, adjust });
  // Something waits, so the page opens on To answer.
  const header = h.list.props.ListHeaderComponent;
  assert.equal(byTestId(header, 'transfers-view-answer').props.accessibilityState.selected, true);
  assert.equal(byTestId(header, 'transfers-view-history').props.accessibilityState.selected, false);
  assert.equal(byTestId(header, 'transfers-view-answer').props.accessibilityRole, 'tab');
  // To answer lists only what waits: the period's transfers are under History.
  assert.equal(h.records.filter(item => !item.kind).length, 0, 'no period routes in To answer');
  // The queued duplicate observation is still reachable: it waits as a group row the card cannot ask about.
  const groups = h.records.filter(item => item.kind === 'group');
  assert.deepEqual(Array.from(groups, item => Array.from(item.group.ids)), [['twice']]);
  // An id stored twice cannot be answered (the store refuses it): the row says why and is never pressed or ticked.
  assert.equal(groups[0].group.blocked, h.words.group.duplicate);
  assert.equal(groups[0].group.whole, false);
  const blocked = h.items.find(entry => entry.item.kind === 'group').tree;
  const blockedRow = walk(blocked).find(node => node.props?.testID === `transfer-group-${groups[0].group.key}`);
  assert.equal(blockedRow.type, 'View', 'read-only, not a button');
  assert.ok(text(blocked).includes(h.words.group.duplicate));
  assert.ok(blockedRow.props.accessibilityLabel.includes(h.words.group.duplicate));
  assert.equal(h.records[0].kind, 'group', 'what waits for an answer comes first');
  // The unnamed one-off is not walked by the card: it is one row in the list, after the groups.
  assert.deepEqual(Array.from(h.records, item => item.kind), ['group', 'unnamed']);
  const keys = h.records.map(item => h.list.props.keyExtractor(item));
  assert.equal(new Set(keys).size, keys.length, 'every rendered record has a unique key');
  const card = walk(header).find(node => node.props?.testID === 'transfer-question-card');
  assert.ok(card, 'a queued transfer shows the question card');
  // The reconciler's queue first: the likely own-account match is the first question.
  assert.ok(text(card).includes(h.words.card.whereOut));
  // The title counts everything waiting: the queued row, the generic unknown and the duplicate observation it cannot ask.
  assert.ok(text(card).includes(h.words.card.title(3)), 'two questions plus one it cannot ask');
  assert.ok(!text(card).includes(h.words.card.step(1, 1)), 'no step while queued entries wait that no question reaches');
  assert.equal(walk(card).find(node => node.props?.testID === 'transfer-question-unnamed'), undefined, 'the unnamed link left the card');
  const unnamedTree = h.items.find(entry => entry.item.kind === 'unnamed').tree;
  const unnamed = byTestId(unnamedTree, 'transfer-question-unnamed');
  assert.equal(unnamed.type, 'Pressable');
  assert.equal(unnamed.props.accessibilityRole, 'button');
  assert.equal(unnamed.props.accessibilityLabel, `${h.words.card.unnamedTitle(1)}. ${h.words.card.unnamedBody}`);
  assert.ok(text(unnamedTree).includes(h.words.card.unnamedTitle(1)));
  // Anything listed under the card can be searched: the field sits under the card, above the list head.
  const order = walk(header).map(node => node.props?.testID ?? (node.type === 'TextField' ? 'search' : null)).filter(Boolean);
  assert.ok(order.indexOf('transfer-question-card') < order.indexOf('search') && order.indexOf('search') < order.indexOf('transfers-list-head'),
    order.join(' '));

  // History: the period's transfers, under the period's heading, with the tiles above them.
  byTestId(header, 'transfers-view-history').props.onPress();
  const history = h.rerender();
  const historyHeader = history.list.props.ListHeaderComponent;
  assert.equal(byTestId(historyHeader, 'transfers-view-history').props.accessibilityState.selected, true);
  assert.equal(byTestId(historyHeader, 'transfer-question-card'), undefined, 'History asks nothing');
  assert.equal(byTestId(historyHeader, 'transfers-select'), undefined);
  assert.ok(byTestId(historyHeader, 'transfers-tile-own'));
  assert.ok(walk(historyHeader).find(node => node.type === 'TextField'), 'History can be searched');
  const routes = history.records.filter(item => !item.kind);
  const ids = Array.from(routes, item => item.transactionId);
  assert.deepEqual(ids.slice().sort(), ['generic', 'queued', 'sent'], 'archived and duplicate-id rows are not listed as transfers');
  assert.equal(routes.length, history.records.length, 'History lists the period\'s routes only');
  assert.ok(text(byTestId(historyHeader, 'transfers-list-head')).includes(h.words.listTitle),
    'the period heading sits above the period\'s transfers');
  const historyKeys = history.records.map(item => history.list.props.keyExtractor(item));
  assert.equal(new Set(historyKeys).size, historyKeys.length, 'every rendered record has a unique key');
  const by = id => history.items.find(entry => entry.item.transactionId === id).tree;
  // The tag pill is the View whose only child is its label.
  const tagBox = (tree, label) => walk(tree).find(node => node.type === 'View'
    && node.props.children?.type === 'Text' && node.props.children.props.children === label);
  const tagLabels = [h.words.tags.needsAnswer, h.words.tags.external, h.words.tags.own];
  const tagOf = tree => tagLabels.find(label => tagBox(tree, label)?.props.style);
  assert.equal(h.words.tags.unconfirmed, undefined, 'one term for an unanswered transfer: "Not answered yet" is gone');
  for (const id of ['generic', 'queued']) {
    assert.equal(tagOf(by(id)), h.words.tags.needsAnswer, `${id}: Needs an answer`);
    assert.equal(tagBox(by(id), h.words.tags.needsAnswer).props.style[1].backgroundColor, h.band.statusNear);
  }
  assert.equal(tagOf(by('sent')), h.words.tags.external);
  assert.equal(walk(by('generic')).filter(node => node.type === 'Pressable').length, 1, 'a row carries no second per-row Review button');

  // The unnamed row opens select mode, where the generic unknown can be ticked on its own.
  const fresh = renderTransfers({ language, transactions, accounts, adjust });
  byTestId(fresh.items.find(entry => entry.item.kind === 'unnamed').tree, 'transfer-question-unnamed').props.onPress();
  const selecting = fresh.rerender();
  assert.ok(byTestId(selecting.list.props.ListHeaderComponent, 'transfer-select-controls'), 'select mode is on');
  assert.equal(byTestId(selecting.list.props.ListHeaderComponent, 'transfers-views'), undefined, 'select mode hides the views switch');
  assert.ok(selecting.records.some(item => !item.kind && item.transactionId === 'generic'), 'the unnamed transfer can be ticked');
  assert.deepEqual(fresh.answers, [], 'opening select mode saves nothing');
});
