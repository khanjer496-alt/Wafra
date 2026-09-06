'use strict';
// Source-component contract harness, NOT React Native or a device renderer.
// It deliberately substitutes the OS, store and primitives. Real source owns
// composition and handlers; fixtures contain no personal data.
const path = require('node:path');
const fs = require('node:fs');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const icons = new Set([...fs.readFileSync(path.join(root, 'src/components/ui/icon.types.ts'), 'utf8').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
const themes = {
  light: { text: '#152033', textSecondary: '#4C5A70', textTertiary: '#5D6B81', background: '#F6F8FC',
    backgroundElement: '#FFFFFF', backgroundSelected: '#E9EDF5', cardBorder: '#DCE3EE', primary: '#2855D9', income: '#16724C', warning: '#865C05' },
  dark: { text: '#F3F6FC', textSecondary: '#BAC5D7', textTertiary: '#9BAAC1', background: '#0F1520',
    backgroundElement: '#172130', backgroundSelected: '#222F44', cardBorder: '#334159', primary: '#9DBAFF', income: '#77D8AE', warning: '#F1C66F' },
};
function harness(options = {}) {
  const events = [];
  const language = options.language ?? 'en';
  const theme = themes[options.theme ?? 'light'];
  const react = {
    memo: (component) => component, useMemo: (fn) => fn(), useCallback: (fn) => fn,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, (value) => events.push(['state', value])],
    useRef: (value) => ({ current: value }), useEffect() {}, Fragment: 'Fragment',
  };
  const jsx = (type, props = {}, key) => typeof type === 'function' ? type(props) : ({ type, props, key });
  const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const amount = (fils) => (fils / 100).toLocaleString(language === 'ar' ? 'ar-AE' : 'en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const labels = { netAfterSpending: language === 'ar' ? 'الصافي بعد الإنفاق' : 'Net after spending',
    allActivity: language === 'ar' ? 'عرض الكل' : 'See all', settingsTitle: 'Settings', captureAndroidOn: 'SMS capture enabled',
    turnOnTracking: 'Enable bank alerts', captureRefreshFailed: 'Import failed', loadingLedger: 'Loading ledger',
    checkBankAlerts: 'Check bank alerts', plusWord: 'plus', minusWord: 'minus', transferLabel: 'Transfer',
    captureIosWaitingForAlert: 'Waiting for your next alert', captureIosOff: 'Capture is off', trialEndedBanner: 'Trial ended' };
  const t = (key) => labels[key] ?? key;
  const account = { id: 'bank', name: language === 'ar' ? 'الحساب اليومي · 1234' : 'Everyday account · 1234' };
  const transactions = [
    ['careem', 'Careem', 2950, 'dining', '2026-09-06'], ['carrefour', 'Carrefour', 21485, 'shopping', '2026-09-06'],
    ['spotify', 'Spotify', 2199, 'entertainment', '2026-09-05'], ['fuel', 'ENOC', 11300, 'transport', '2026-09-05'],
  ].map(([id, title, amountFils, category, date]) => ({ id, title, amountFils, category, date, accountId: 'bank', type: 'expense', source: 'sms' }));
  const state = {
    hydrated: options.hydrated ?? true, onboarded: true, language,
    captureOptOut: options.optOut ?? false, historyImport: options.history ?? null, privateMode: true,
    transactions: options.empty ? [] : transactions, accounts: [account], budgets: [], bills: [], cardDues: [],
    notSubscriptions: [], merchantOverrides: {}, marketId: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 },
    reviewTray: { pending: options.reviews ? [{ expiresAt: Date.now() + 86400000 }] : [] },
  };
  const dashboard = {
    hero: { netFils: 941300, incomeFils: 1450000, expenseFils: 508700 }, live: true,
    activityRows: state.transactions, accountById: new Map([['bank', account]]), internalTransactionIds: new Set(),
    unreadFormats: { count: 0, shouldPrompt: false }, uncategorised: { shouldPrompt: false, summary: { merchants: [] } },
    upcoming: { items: options.empty ? [] : [{ id: 'utility', title: 'Electricity', kind: 'bill',
      dateISO: '2026-09-09', daysLeft: 3, amountFils: 38000, overdue: false, urgent: false }] },
  };
  const native = { View: 'View', Pressable: 'Pressable', RefreshControl: 'RefreshControl',
    Platform: { OS: options.platform ?? 'android' }, StyleSheet: { create: (style) => style, hairlineWidth: 1 },
    Alert: { alert: (message) => events.push(['alert', message]) }, AppState: { addEventListener: () => ({ remove() {} }) } };
  const dependencies = {
    react, 'react/jsx-runtime': runtime, 'react-native': native,
    'expo-router': { useRouter: () => ({ push: (route) => events.push(['route', route]) }) },
    '@react-navigation/native': { useIsFocused: () => true },
    '@/components/themed-text': { ThemedText: (props) => jsx('Text', props) },
    '@/components/ui/merchant-avatar': { MerchantAvatar: (props) => jsx('Avatar', props) },
    '@/components/ui/icon': { Icon: (props) => { if (!icons.has(props.name)) throw new Error(`Unknown icon ${props.name}`); return jsx('Icon', props); } },
    '@/components/ui/money': { Money: (props) => jsx('Money', props) },
    '@/components/ui/screen-scaffold': { ScreenScaffold: (props) => jsx('Scaffold', props) },
    '@/components/ui/states': { EmptyMonth: (props) => jsx('EmptyMonth', props), SkeletonRows: (props) => jsx('SkeletonRows', props) },
    '@/components/ui/toast': { useToast: () => ({ show: (message) => events.push(['toast', message]) }) },
    '@/components/lock-gate': { usePrivacyGateCleared: () => true },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => options.largeText ?? false },
    '@/hooks/use-theme': { useTheme: () => theme },
    '@/hooks/use-auto-import': { useAutoImport: () => ({ captureState: options.captureState ?? 'waiting-for-alert',
      needsPermission: options.needsPermission ?? false, runAutoImport: async () => { events.push(['scan']); } }) },
    '@/lib/categories': { getCategory: (category) => category, categoryLabel: (category) => category },
    '@/lib/format': { formatAmount: amount, clockTime: () => '', shortDate: (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString(language === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short' }) },
    '@/lib/markets': { ledgerCurrencyCode: () => 'AED' },
    '@/lib/i18n': { t, tf: (key, values) => key === 'historyImportLiveProgress' ? `${values.scanned} read · ${values.found} found` : `${key} ${values.count ?? ''}` },
    '@/lib/dashboard-projection': { projectDashboard: (request) => { if (request.includeInsights !== false) throw new Error('Home requested unused insights'); return dashboard; } },
    '@/lib/auto-import': { openSmsPermissionSettings: async () => events.push(['permissions']) },
    '@/lib/fx': { buildReferenceFxUpdates: async () => [] },
    '@/lib/leaving-soon': { daysPhrase: (days) => language === 'ar' ? `خلال ${days} أيام` : `In ${days} days` },
    '@/lib/launch-performance': { markLaunchPhase() {} },
    '@/lib/notifications': { syncPaymentReminders: async () => events.push(['reminders']) },
    '@/lib/period': { periodLabel: () => language === 'ar' ? 'سبتمبر 2026' : 'September 2026' },
    '@/lib/period-context': { usePeriod: () => ({ period: { month: 9, year: 2026 } }) },
    '@/lib/purchases': { isProActive: () => options.pro ?? true },
    '@/lib/store': { useStore: () => ({ state, getStateSnapshot: () => state, applyFxUpdates() {},
      setCaptureOptOut: async (value) => events.push(['optOut', value]), beginHistoryImport: async () => events.push(['resume']) }) },
  };
  for (const [module, name] of [['period-sheet', 'PeriodSheet'], ['entry-detail-sheet', 'EntryDetailSheet'],
    ['card-payment-sheet', 'CardPaymentSheet'], ['bill-detail-sheet', 'BillDetailSheet']]) {
    dependencies[`@/components/${module}`] = { [name]: (props) => jsx('Sheet', { ...props, name }) };
  }
  const { TransactionRow } = load(path.join(root, 'src/components/transaction-row.tsx'), dependencies);
  dependencies['@/components/transaction-row'] = { TransactionRow };
  const { default: Home } = load(path.join(root, 'src/screens/journal-home-screen.tsx'), dependencies);
  return { tree: Home(), events, theme, language, amount, jsx, TransactionRow, dashboard };
}
function walk(node, results = []) {
  if (Array.isArray(node)) { for (const item of node) walk(item, results); }
  else if (node && typeof node === 'object') { results.push(node); walk(node.props?.children, results); }
  return results;
}
const text = (node) => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object'
  ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
module.exports = { harness, walk, text };
