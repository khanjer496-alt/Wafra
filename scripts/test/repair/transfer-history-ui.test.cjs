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
  const deps = {
    react: { useDeferredValue: v => v, useMemo: f => f(), useRef: v => ({ current: v }), useEffect() {},
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
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
  deps['@/lib/transfer-activity-copy'] = load(path.join(root, 'src/lib/transfer-activity-copy.ts'),
    { '@/lib/i18n': { getLanguage: () => language } });
  deps['@/lib/transfer-answer'] = src('src/lib/transfer-answer.ts');
  deps['@/lib/transfer-list'] = src('src/lib/transfer-list.ts');
  deps['@/components/transfer-coins/coin-cues'] = src('src/components/transfer-coins/coin-cues.ts');
  deps['@/lib/transfer-batch'] = src('src/lib/transfer-batch.ts');
  deps['@/lib/transfer-review-presentation'] = src('src/lib/transfer-review-presentation.ts');
  deps['@/hooks/use-transfer-batch'] = src('src/hooks/use-transfer-batch.ts');
  for (const name of ['transfer-select-mark', 'transfer-answer-choices', 'transfer-route-row', 'transfer-question-card',
    'transfer-group-row', 'transfer-answer-sheet']) {
    deps[`@/components/transfers/${name}`] = src(`src/components/transfers/${name}.tsx`);
  }
  const screen = load(path.join(root, 'src/app/transfers.tsx'), deps).default();
  const list = walk(screen).find(node => node.type === 'FlatList');
  const records = list.props.data;
  const items = records.map((item, index) => ({ item, tree: list.props.renderItem({ item, index }) }));
  return { events, answers, screen, list, records, items, band, words: deps['@/lib/transfer-activity-copy'].transferActivityCopy(language) };
}

for (const language of ['en', 'ar']) test(`${language}: generic unknowns are neutral; only reconciler review items are queued as questions`, () => {
  const accounts = [{ id: 'bank', name: 'Bank', kind: 'bank', openingFils: 0 },
    { id: 'old', name: 'Old', kind: 'bank', openingFils: 0, archived: true }];
  const transactions = [
    row('generic'), row('queued'),
    row('sent', { transferDecision: { version: 1, ownership: 'external', decidedAt: NOW } }),
    row('archived', { accountId: 'old' }),
    row('twice'), row('twice', { amountFils: 20000 }),
  ];
  const h = renderTransfers({ language, transactions, accounts, adjust: result => {
    result.byId.set('queued', { id: 'queued', status: 'likely-own', reason: 'amount-time', candidateIds: ['x'] });
    result.pendingIds.add('queued');
  } });
  const routes = h.records.filter(item => !item.kind);
  const ids = Array.from(routes, item => item.transactionId);
  assert.deepEqual(ids.slice().sort(), ['generic', 'queued', 'sent'], 'archived and duplicate-id rows are not listed as transfers');
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
  assert.deepEqual(Array.from(h.records.filter(item => item.kind === 'header'), item => item.title), [h.words.listTitle],
    'the period heading sits above the period\'s transfers');
  const keys = h.records.map(item => h.list.props.keyExtractor(item));
  assert.equal(new Set(keys).size, keys.length, 'every rendered record has a unique key');
  const by = id => h.items.find(entry => entry.item.transactionId === id).tree;
  // The tag pill is the View whose only child is its label.
  const tagBox = (tree, label) => walk(tree).find(node => node.type === 'View'
    && node.props.children?.type === 'Text' && node.props.children.props.children === label);
  const tagLabels = [h.words.tags.unconfirmed, h.words.tags.needsAnswer, h.words.tags.external, h.words.tags.own];
  const tagOf = tree => tagLabels.find(label => tagBox(tree, label)?.props.style);
  assert.equal(tagOf(by('generic')), h.words.tags.unconfirmed);
  const generic = walk(by('generic')).find(node => node.type === 'Text' && node.props.children === h.words.tags.unconfirmed);
  assert.equal(generic.props.style.color, h.band.textSecondary);
  assert.equal(tagOf(by('queued')), h.words.tags.needsAnswer);
  assert.equal(tagBox(by('queued'), h.words.tags.needsAnswer).props.style[1].backgroundColor, h.band.statusNear);
  assert.equal(tagOf(by('sent')), h.words.tags.external);
  assert.doesNotMatch(text(by('generic')), new RegExp(h.words.tags.needsAnswer));
  assert.equal(walk(by('generic')).filter(node => node.type === 'Pressable').length, 1, 'a row carries no second per-row Review button');
  // The question card lists exactly the queued rows, not the generic unknown.
  const card = walk(h.list.props.ListHeaderComponent).find(node => node.props?.testID === 'transfer-question-card');
  assert.ok(card, 'a queued transfer shows the question card');
  // The title counts everything waiting: the one question and the duplicate observation it cannot ask.
  assert.ok(text(card).includes(h.words.card.title(2)), 'one queued row plus one it cannot ask');
  assert.ok(!text(card).includes(h.words.card.step(1, 1)), 'no step while the card cannot walk them all');
});
