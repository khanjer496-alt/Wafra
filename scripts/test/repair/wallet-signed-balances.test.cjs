'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

// Execute the actual Wallet projection and shared balance calculator. Native
// children stay opaque: this checks the amounts/coverage passed to the header,
// not phone layout or rendering. No compiled fixture bundle is needed.
function project(accounts, transactions = []) {
  const state = { accounts, transactions, cardDues: [], goals: [], knownBanks: [], lastScanTs: 0,
    ledgerMoney: { schemaVersion: 2, currency: 'CAD', exponent: 2 } };
  const jsx = (type, props) => ({ type, props });
  const format = { toISODate: () => '2026-11-15', formatAED: String, shortDate: String,
    parseAmountWithMoneySpec: () => null };
  const balances = load(path.join(root, 'src/lib/balances.ts'), {
    '@/lib/transfer-reconciliation': { reconcileTransfers() { throw Error('Unexpected reconciliation'); } },
  });
  const places = load(path.join(root, 'src/lib/money-places.ts'), {
    '@/lib/format': format, '@/lib/ledger': {},
  });
  const bandCounts = load(path.join(root, 'src/lib/money-places-band.ts'), {
    '@/lib/format': format, '@/lib/limit-status': {},
  });
  const deps = {
    react: { useMemo: f => f(), useState: initial => [initial, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Platform: { OS: 'android' }, StyleSheet: { create: s => s, hairlineWidth: 1 },
      View: 'View', Pressable: 'Pressable' },
    '@/hooks/use-app-router': { useRouter: () => ({ push() {} }) },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-band': { useBand: () => ({}) },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => false },
    '@/hooks/use-language': { useLanguage: () => 'en' },
    '@/hooks/use-today': { useToday: () => new Date('2026-11-15T12:00:00Z'),
      useResumeClock: () => new Date('2026-11-15T12:00:00Z') },
    '@/lib/store': { useStoreSelector: f => f({ state }), useStoreActions: () => ({}) },
    '@/lib/balances': balances,
    '@/lib/money-places': places,
    '@/lib/money-places-band': bandCounts,
    '@/lib/cards': { openDues: () => [], reissueSuggestions: () => [], isInactiveAccount: a => !!a.archived },
    '@/lib/account-freshness': { accountSnapshotFreshness: () => null },
    '@/lib/runtime-performance': { measureRuntimeOperation: (_name, f) => f() },
    '@/lib/i18n': { t: key => key, tf: (key, values) => `${key}:${JSON.stringify(values)}` },
    '@/lib/format': format,
    '@/lib/markets': { ledgerCurrencyDisplay: () => 'CAD' },
    '@/lib/known-banks': { bankPickerOptions: () => [] },
    '@/lib/auto-import': { isSmsScanningAvailable: () => false },
    '@/lib/haptics': {},
    '@/lib/reference-copy': { accountGroupsCopy: { en: { unknown: 'Unknown', sourceBody: 'Recorded balances' } } },
    '@/lib/transfer-activity-copy': { transferActivityCopy: () => ({}) },
    '@/lib/money-places-copy': { moneyPlacesWords: () => ({ inactiveSplit: () => '', cardsApart: () => '' }) },
    '@/constants/theme': { Radius: {}, Spacing: {} },
    '@/components/ios-tab-gate': { withIosTabGate: component => component },
  };
  for (const [module, names] of [
    ['capture-refresh-control', ['CaptureRefreshControl']], ['themed-text', ['ThemedText']],
    ['ledger-currency-sheet', ['LedgerCurrencySheet']], ['wallet/balance-overview', ['BalanceOverview']],
    ['wallet/account-groups', ['AccountGroups', 'accountRowSpoken']], ['ui/bottom-sheet', ['BottomSheet']],
    ['ui/controls', ['Button']], ['ui/choice-sheet', ['ChoiceSheet']], ['ui/confirm-sheet', ['ConfirmSheet']],
    ['ui/tile', ['AccountTile']], ['ui/text-field', ['TextField']], ['ui/icon', ['Icon']],
    ['ui/progress-bar', ['ProgressBar']], ['ui/band-scaffold', ['BandScaffold']],
  ]) deps[`@/components/${module}`] = Object.fromEntries(names.map(name => [name, name]));
  deps['@/components/wallet/account-groups'].accountRowSpoken = () => '';
  const Screen = load(path.join(root, 'src/app/(tabs)/wallet.tsx'), deps).default;
  const nodes = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    visit(node.props?.children);
    visit(node.props?.bandContent);
  }
  visit(Screen());
  return { header: nodes.find(n => n.type === 'BalanceOverview').props,
    breakdown: balances.netWorthBreakdown(state) };
}

const cash = (id, openingFils = 0, extra = {}) => ({ id, name: id, kind: 'cash', openingFils, ...extra });
const expense = (id, amountFils) => ({ id: `tx-${id}`, accountId: id, type: 'expense', amountFils,
  date: '2026-11-15', source: 'manual' });

test('negative-only manual cash is included in the header without changing the ledger subtotal', () => {
  const { header, breakdown } = project([cash('qa')], [expense('qa', 8725)]);
  assert.equal(header.balanceFils, -8725, 'Known CAD -87.25 cash must not appear as header zero');
  assert.equal(header.knownBalanceCount, 1);
  assert.equal(breakdown.balanceByAccountId.qa, -8725);
  assert.equal(breakdown.balanceFils, 0, 'Shared positive-assets semantics stay unchanged');
  assert.equal(breakdown.debtFils, 8725);
});

test('negative bank snapshot and mixed signed cash/bank balances are summed as recorded', () => {
  const bank = cash('bank', 0, { kind: 'bank', snapshotKind: 'balance', snapshotFils: -5000 });
  assert.equal(project([bank]).header.balanceFils, -5000);
  const { header } = project([bank, cash('negative', -8725), cash('positive', 20000)]);
  assert.equal(header.balanceFils, 6275);
  assert.equal(header.knownBalanceCount, 3);
});

test('zero is known, bank history without a snapshot stays unknown, and empty coverage stays empty', () => {
  const unknown = cash('unknown', 0, { kind: 'bank' });
  const captured = { ...expense('unknown', 123), source: 'sms' };
  const mixed = project([cash('zero'), unknown], [captured]);
  assert.equal(mixed.header.balanceFils, 0);
  assert.equal(mixed.header.knownBalanceCount, 1);
  assert.equal(mixed.breakdown.balanceByAccountId.unknown, null);
  assert.equal(mixed.header.balanceCoverageText, 'balanceCoverage:{"known":1,"total":2}');
  const onlyUnknown = project([unknown], [captured]).header;
  assert.equal(onlyUnknown.knownBalanceCount, 0, 'BalanceOverview must keep its unknown/dash branch');
  assert.equal(onlyUnknown.balanceFils, 0);
  const empty = project([]).header;
  assert.equal(empty.knownBalanceCount, 0);
  assert.equal(empty.balanceCoverageText, 'addAccountForBalances');
});

test('archived accounts and all payment cards are excluded from both header amount and coverage', () => {
  const { header, breakdown } = project([
    cash('qa', -8725), cash('archived-positive', 50000, { archived: true }),
    cash('archived-negative', -30000, { archived: true }),
    cash('credit', 0, { kind: 'card', cardType: 'credit', snapshotKind: 'outstanding', snapshotFils: 20000 }),
    cash('debit', 0, { kind: 'card', cardType: 'debit', snapshotKind: 'balance', snapshotFils: 40000 }),
    cash('generic-card', 10000, { kind: 'card' }),
  ]);
  assert.equal(header.balanceFils, -8725);
  assert.equal(header.knownBalanceCount, 1);
  assert.equal(header.balanceCoverageText, 'balanceCoverage:{"known":1,"total":1}');
  assert.equal(header.creditCardCount, 1, 'Credit cards remain a separate chip');
  assert.equal(breakdown.debtFils, 28725, 'Shared calculation still retains credit-card debt');
});

test('income changes the negative cash figure to CAD 912.75, while separate card debt is never netted', () => {
  const accounts = [cash('qa'), cash('credit', 0, { kind: 'card', cardType: 'credit',
    snapshotKind: 'outstanding', snapshotFils: 20000 })];
  const { header, breakdown } = project(accounts, [expense('qa', 8725),
    { ...expense('qa', 100000), id: 'income', type: 'income' }]);
  assert.equal(header.balanceFils, 91275);
  assert.equal(header.knownBalanceCount, 1);
  assert.equal(breakdown.totalFils, 71275, 'Using net-worth total here would incorrectly subtract card debt');
});
