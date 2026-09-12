'use strict';
// Source-component contract harness, NOT React Native or a device renderer.
// It deliberately substitutes the OS, store and primitives. Real source owns
// composition and handlers; fixtures contain no personal data.
const path = require('node:path');
const fs = require('node:fs');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const icons = new Set([...fs.readFileSync(path.join(root, 'src/components/ui/icon.types.ts'), 'utf8').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
const themeModule = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (o) => o.android } } });
const themes = themeModule.Colors;
function harness(options = {}) {
  const events = [];
  const language = options.language ?? 'en';
  const theme = themes[options.theme ?? 'light'];
  const react = {
    memo: (component) => component, isValidElement: (node) => !!node && typeof node === 'object' && !!node.props, useMemo: (fn) => fn(), useCallback: (fn) => fn,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, (value) => events.push(['state', value])],
    useRef: (value) => ({ current: value }), useEffect() {}, Fragment: 'Fragment',
  };
  const jsx = (type, props = {}, key) => typeof type === 'function' ? type(props) : ({ type, props, key });
  const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const amount = (fils) => (fils / 100).toLocaleString(language === 'ar' ? 'ar-AE' : 'en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const labels = { tabHome: language === 'ar' ? 'الرئيسية' : 'Home', tabFlow: language === 'ar' ? 'الإنفاق' : 'Spending', tabBills: language === 'ar' ? 'الفواتير' : 'Bills', tabWallet: language === 'ar' ? 'الحسابات' : 'Accounts', netAfterSpending: language === 'ar' ? 'الصافي بعد الإنفاق' : 'Net after spending',
    allActivity: language === 'ar' ? 'عرض الكل' : 'See all', settingsTitle: 'Settings', captureAndroidOn: 'SMS capture enabled',
    turnOnTracking: 'Enable bank alerts', captureRefreshFailed: 'Import failed', loadingLedger: 'Loading ledger',
    checkBankAlerts: 'Check bank alerts', plusWord: 'plus', minusWord: 'minus', transferLabel: 'Transfer',
    captureIosWaitingForAlert: 'Waiting for your next alert', captureIosOff: 'Capture is off', trialEndedBanner: 'Trial ended' };
  const t = (key) => labels[key] ?? key;
  const account = { id: 'bank', kind: 'bank', openingFils: 0, ...(options.knownBalance !== undefined ? { snapshotFils: options.knownBalance, snapshotKind: 'balance' } : {}), name: language === 'ar' ? 'الحساب اليومي · 1234' : 'Everyday account · 1234' };
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
  const native = { View: 'View', ActivityIndicator: 'ActivityIndicator', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', RefreshControl: 'RefreshControl',
    Platform: { OS: options.platform ?? 'android' }, StyleSheet: { create: (style) => style, flatten: (style) => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style])), hairlineWidth: 1 },
    Alert: { alert: (message) => events.push(['alert', message]) }, AppState: { addEventListener: () => ({ remove() {} }) } };
  const dependencies = {
    react, 'react/jsx-runtime': runtime, 'react-native': native,
    'expo-linear-gradient': { LinearGradient: (props) => jsx('Gradient', props) },
    // Balances now excludes corroborating transfer observations. Load the real
    // reconciler as well; a fake empty result would bypass that accounting rule.
    '@/lib/balances': load(path.join(root, 'src/lib/balances.ts'), {
      '@/lib/transfer-reconciliation': require('./load-transfer-ledger.cjs').core,
    }),
    '@/constants/theme': themeModule,
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
    '@/hooks/use-ledger-money': { useLedgerMoney: () => null },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => options.largeText ?? false },
    '@/hooks/use-theme': { useTheme: () => theme },
    '@/hooks/use-auto-import': { useAutoImport: () => ({ captureState: options.captureState ?? 'waiting-for-alert',
      needsPermission: options.needsPermission ?? false, runAutoImport: async () => { events.push(['scan']); } }) },
    '@/lib/categories': { getCategory: (category) => category, categoryLabel: (category) => category },
    '@/lib/format': { formatAmount: amount, clockTime: () => '', shortDate: (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString(language === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short' }) },
    '@/lib/markets': { ledgerCurrencyCode: () => 'AED', ledgerCurrencyDisplay: () => 'AED' },
    '@/lib/i18n': { t, hasArabicScript: (s) => /[\u0600-\u06ff]/.test(s), tf: (key, values) => key === 'balanceCoverage' ? `${values.known} of ${values.total} account balances recorded` : key === 'historyImportLiveProgress' ? `${values.scanned} read · ${values.found} found` : `${key} ${values.count ?? ''}` },
    '@/lib/dashboard-projection': { projectDashboard: (request) => {
      if (request.surface === 'home' && request.includeInsights === false) return dashboard;
      if (request.surface === 'dashboard' && request.includeInsights === true) return dashboard;
      throw new Error('Home requested an unexpected financial projection');
    } },
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
  dependencies['@/lib/currency-metadata'] = load(path.join(root, 'src/lib/currency-metadata.ts'));
  dependencies['@/lib/ledger-money'] = load(path.join(root, 'src/lib/ledger-money.ts'), dependencies);
  dependencies['@react-native-async-storage/async-storage'] = { getItem: async () => null, setItem: async () => {} };
  dependencies['@/lib/home-widget-preferences'] = load(path.join(root, 'src/lib/home-widget-preferences.ts'));
  dependencies['@/lib/home-widgets'] = load(path.join(root, 'src/lib/home-widgets.ts'), dependencies);
  if (options.render) {
    const svg = { __esModule: true, default: 'svg', Circle: 'circle', Line: 'line', Path: 'path', Rect: 'rect' };
    dependencies['react-native-svg'] = svg;
    dependencies['@/components/ui/platform-symbol'] = { PlatformSymbol: (props) => props.fallback };
    dependencies['@/components/themed-text'] = load(path.join(root, 'src/components/themed-text.tsx'), dependencies);
    dependencies['@/components/ui/money'] = load(path.join(root, 'src/components/ui/money.tsx'), dependencies);
    dependencies['@/components/ui/icon'] = load(path.join(root, 'src/components/ui/icon.tsx'), dependencies);
    dependencies['@/lib/categories'] = {
      getCategory: (id) => ({ id, type: 'expense', icon: ({dining:'dining', shopping:'bag', entertainment:'play', transport:'car'})[id] ?? 'receipt' }),
      categoryLabel: (meta) => typeof meta === 'string' ? meta : ({dining:'Dining',shopping:'Shopping',entertainment:'Entertainment',transport:'Transport'})[meta.id] ?? meta.id,
    };
    const { CategoryAvatar } = load(path.join(root, 'src/components/ui/category-avatar.tsx'), dependencies);
    dependencies['@/components/ui/merchant-avatar'] = { MerchantAvatar: (props) => CategoryAvatar(props) };
  }
  dependencies['@/lib/reference-copy'] = load(path.join(root, 'src/lib/reference-copy.ts'), dependencies);
  dependencies['@/components/wafra-logo'] = { WafraMark: () => null };
  dependencies['@/lib/ledger-light-copy'] = load(path.join(root, 'src/lib/ledger-light-copy.ts'), dependencies);
  dependencies['@/components/history-reading-status'] = load(path.join(root, 'src/components/history-reading-status.tsx'), dependencies);
  dependencies['@/components/reference-home-summary'] = load(path.join(root, 'src/components/reference-home-summary.tsx'), dependencies);
  dependencies['@/lib/merchant-spending-copy'] = load(path.join(root, 'src/lib/merchant-spending-copy.ts'));
  const bankIdentity = load(path.join(root, 'src/lib/markets.ts'));
  Object.assign(dependencies['@/lib/markets'], { bankIdentityForName: bankIdentity.bankIdentityForName, bankBrandForName: bankIdentity.bankBrandForName });
  dependencies['@noble/hashes/sha2.js'] = require('@noble/hashes/sha2.js');
  dependencies['@noble/hashes/utils.js'] = require('@noble/hashes/utils.js');
  dependencies['@/lib/transfer-reconciliation'] = load(path.join(root, 'src/lib/transfer-reconciliation.ts'), dependencies);
  dependencies['@/lib/transfer-review-copy'] = load(path.join(root, 'src/lib/transfer-review-copy.ts'), dependencies);
  dependencies['@/components/transfer-review-notice'] = load(path.join(root, 'src/components/transfer-review-notice.tsx'), dependencies);
  dependencies['@/lib/ledger'] = load(path.join(root, 'src/lib/ledger.ts'), dependencies);
  const { TransactionRow } = load(path.join(root, 'src/components/transaction-row.tsx'), dependencies);
  dependencies['@/components/transaction-row'] = { TransactionRow };
  const { default: Home } = load(path.join(root, 'src/screens/journal-home-screen.tsx'), dependencies);
  let tabTree = null;
  if (options.render) {
    const interpolate = (v, a, b) => b[0] + (v-a[0])/(a[1]-a[0])*(b[1]-b[0]);
    dependencies['react-native-reanimated'] = { __esModule: true, default: { View: 'View' },
      ReduceMotion: { System: 'system' }, interpolate, useAnimatedStyle: (fn) => fn(),
      useSharedValue: (value) => ({ value }), withSpring: (value) => value };
    dependencies['react-native-safe-area-context'] = { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 10, left: 0 }) };
    dependencies['@/components/ui/spring-pressable'] = { SpringPressable: (props) => jsx('Pressable', props) };
    dependencies['@/components/ui/tab-bar-metrics'] = { useTabBarMetrics: () => ({ measuredHeight: 78, setMeasuredHeight() {} }) };
    dependencies['@/hooks/use-reduced-motion'] = { useReducedMotion: () => true };
    dependencies['@/lib/haptics'] = { tapped() {} };
    const { WafraTabBar } = load(path.join(root, 'src/components/tab-bar.tsx'), dependencies);
    tabTree = WafraTabBar({ state: { index: 0, routes: ['index','flow','bills','wallet'].map((name) => ({name,key:name})) },
      navigation: { emit: () => ({ defaultPrevented: false }), navigate: (name) => events.push(['route',name]) } });
  }
  return { tree: Home(), tabTree, events, theme, language, amount, jsx, TransactionRow, dashboard };
}
function walk(node, results = []) {
  if (Array.isArray(node)) { for (const item of node) walk(item, results); }
  else if (node && typeof node === 'object') { results.push(node); walk(node.props?.children, results); }
  return results;
}
const text = (node) => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object'
  ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
module.exports = { harness, walk, text };
