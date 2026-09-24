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
  const state = { language, transactions, accounts };
  const deps = {
    react: { useDeferredValue: v => v, useMemo: f => f(), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Keyboard: { dismiss() {} }, Platform: { OS: 'ios' }, Pressable: 'Pressable', View: 'View',
      SectionList: props => ({ type: 'SectionList', props }), StyleSheet: { create: s => s, hairlineWidth: 1 } },
    'expo-router': { useRouter: () => ({ push: route => events.push(['route', route]), back() {}, canGoBack: () => true, replace() {} }) },
    '@/components/entry-detail-sheet': { EntryDetailSheet: boundary('EntryDetailSheet') },
    '@/components/period-sheet': { PeriodSheet: boundary('PeriodSheet') },
    '@/components/themed-text': { ThemedText: boundary('Text') },
    '@/components/ui/action-icon-button': { ActionIconButton: boundary('ActionIconButton') },
    '@/components/ui/icon': { Icon: boundary('Icon') },
    '@/components/ui/money': { Money: boundary('Money') },
    '@/components/ui/period-pill': { PeriodPill: boundary('PeriodPill') },
    '@/components/ui/screen-scaffold': { ScreenScaffold: props => ({ type: 'Scaffold', props }),
      useScreenContentInsets: () => ({ contentContainerStyle: {}, contentInset: {}, scrollIndicatorInsets: {} }) },
    '@/components/ui/segmented-control': { SegmentedControl: boundary('SegmentedControl') },
    '@/components/ui/text-field': { TextField: boundary('TextField') },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 12, four: 16, five: 24 } },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => false },
    '@/hooks/use-ledger-money': { useLedgerMoney: () => null },
    '@/hooks/use-theme': { useTheme: () => ({ primary: 'green', textSecondary: 'gray', textTertiary: 'gray', cardBorder: 'line' }) },
    '@/lib/format': { formatAED: fils => `AED ${(fils / 100).toFixed(2)}`, friendlyDate: date => date, toISODate: () => '2026-09-15' },
    '@/lib/i18n': { t: key => key },
    '@/lib/ledger': { accountDisplayName: ledger.accountDisplayName, transferReconciliationForState: current => {
      const result = core.reconcileTransfers(current.transactions, current.accounts);
      adjust(result); return result;
    } },
    '@/lib/ledger-money': { formatMinorUnits: fils => String(fils) },
    '@/lib/period': { inPeriod: () => true },
    '@/lib/period-context': { usePeriod: () => ({ period: { mode: 'all' } }) },
    '@/lib/store': { useStore: () => ({ state }) },
    '@/lib/transfer-reconciliation': core,
  };
  deps['@/lib/transfer-activity'] = load(path.join(root, 'src/lib/transfer-activity.ts'), deps);
  deps['@/lib/transfer-activity-copy'] = load(path.join(root, 'src/lib/transfer-activity-copy.ts'),
    { '@/lib/i18n': { getLanguage: () => language } });
  const screen = load(path.join(root, 'src/app/transfers.tsx'), deps).default();
  const list = walk(screen).find(node => node.type === 'SectionList');
  const records = list.props.sections.flatMap(section => section.data);
  const items = records.map(item => ({ item, tree: list.props.renderItem({ item }) }));
  return { events, list, records, items, words: deps['@/lib/transfer-activity-copy'].transferActivityCopy(language) };
}

for (const language of ['en', 'ar']) test(`${language}: generic unknowns are neutral; only reconciler review items offer a review action`, () => {
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
  const ids = Array.from(h.records, item => item.transaction.id);
  assert.deepEqual(ids.slice().sort(), ['generic', 'queued', 'sent'], 'archived and duplicate-id rows are not listed');
  const keys = h.records.map(item => h.list.props.keyExtractor(item));
  assert.equal(new Set(keys).size, keys.length, 'every rendered record has a unique key');
  const by = id => h.items.find(entry => entry.item.transaction.id === id).tree;
  const reviewButton = tree => walk(tree).find(node => node.props?.accessibilityLabel?.startsWith(`${h.words.review}:`));
  const statusNode = tree => walk(tree).find(node => node.type === 'Text' && [h.words.unconfirmed, h.words.needsReview,
    h.words.own, h.words.external].includes(node.props.children));
  assert.equal(statusNode(by('generic')).props.children, h.words.unconfirmed);
  assert.equal(statusNode(by('generic')).props.themeColor, 'textSecondary');
  assert.equal(reviewButton(by('generic')), undefined, 'a generic unknown is not a review chore');
  assert.equal(statusNode(by('queued')).props.children, h.words.needsReview);
  assert.equal(statusNode(by('queued')).props.themeColor, 'warning');
  assert.ok(reviewButton(by('queued')));
  assert.equal(statusNode(by('sent')).props.children, h.words.external);
  assert.equal(reviewButton(by('sent')), undefined);
  assert.doesNotMatch(text(by('generic')), new RegExp(h.words.needsReview));
});
