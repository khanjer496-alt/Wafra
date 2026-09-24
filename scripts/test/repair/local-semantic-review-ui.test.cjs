'use strict';
// Actual Review screen with explicit React/native boundaries; this is not device QA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { walk, text } = require('../workflows/workflow-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const { createLocalReviewAdvisor } = load(path.join(root, 'src/lib/local-semantic-review.ts'), {
  '@/lib/local-semantic-review-runtime': { evaluateLocalReviewWindow: async () => ({ kind: 'refused', reason: 'model-unavailable' }) },
});
const missing = () => ({ value: null, evidence: 'missing', alternatives: [], spans: [], issues: [] });
function harness() {
  let finish;
  const advisor = createLocalReviewAdvisor(() => new Promise(resolve => { finish = resolve; }));
  const event = { family: 'unknown', decision: 'review', status: 'posted', direction: 'debit', issues: [],
    amount: { ...missing(), evidence: 'explicit', value: { currency: 'AED', minorUnits: '4500', exponent: 2 } },
    merchant: missing(), balance: missing(), creditLimit: missing(), minimumDue: missing(), statementTotal: missing() };
  const item = { kind: 'universal', id: 'review_test_id_0001', sourceKey: 'source_test_key_01', observedAt: Date.now(), expiresAt: Date.now() + 60000, event };
  const state = { language: 'en', reviewTray: { pending: [item] }, transactions: [] };
  const navigation = [];
  const jsx = (type, props = {}) => typeof type === 'function' ? type(props) : { type, props };
  const wrap = type => props => jsx(type, props);
  const deps = {
    react: { useMemo: fn => fn(), useState: initial => [initial, () => {}], useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: s => s, hairlineWidth: 1 },
      FlatList: props => jsx('FlatList', { ...props, children: [props.ListHeaderComponent,
        ...props.data.map(item => props.renderItem({ item })), props.ListFooterComponent] }) },
    'expo-router': { useRouter: () => ({ push: params => navigation.push(params), back() {} }) },
    '@/components/workflows/workflow-copy': { workflowCopy: () => ({ reviewTitle: 'Review', reviewBody: 'Check details', complete: 'Done' }) },
    '@/components/themed-text': { ThemedText: wrap('Text') },
    '@/components/ui/confirm-sheet': { ConfirmSheet: () => null },
    '@/components/ui/icon': { Icon: wrap('Icon') },
    '@/components/ui/screen-scaffold': { ScreenScaffold: wrap('Screen'), useScreenContentInsets: () => ({}) },
    '@/components/ui/toast': { useToast: () => ({ show() {} }) },
    '@/constants/theme': { Radius: { full: 100 }, Spacing: { half: 2, two: 8, three: 12, six: 24 } },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-language': { useLanguage: () => 'en' },
    '@/lib/format': { shortDate: value => value, toISODate: value => value.toISOString().slice(0, 10) },
    '@/lib/haptics': { tapped() {} },
    '@/lib/i18n': { t: key => key === 'reviewAlertPossiblePurchase' ? 'Possible purchase' : key, tf: key => key },
    '@/lib/alert-review-tray': { isUniversalReviewAlert: item => item.kind === 'universal',
      isIosNotificationReview: require('../build/alert-review-tray.js').isIosNotificationReview,
      isIosApplePayReview: require('../build/alert-review-tray.js').isIosApplePayReview,
      recentlyExpiredReviewCount: require('../build/alert-review-tray.js').recentlyExpiredReviewCount,
      recentlyLostReviewCount: require('../build/alert-review-tray.js').recentlyLostReviewCount,
      reviewCaptureBacklog: require('../build/alert-review-tray.js').reviewCaptureBacklog,
      reviewExpiresInDays: require('../build/alert-review-tray.js').reviewExpiresInDays,
      reviewTrayCapacity: require('../build/alert-review-tray.js').reviewTrayCapacity },
    '@/components/universal-review-fields': { isOrdinaryUniversalPosting: () => true, universalMoneyLabel: money => `${money.currency} ${money.minorUnits}` },
    '@/lib/review-alert-copy': load(path.join(root, 'src/lib/review-alert-copy.ts')),
    '@/lib/local-semantic-review': { localReviewAdvisor: advisor },
    '@/lib/store': { useStore: () => ({ state, dismissReviewAlert: async () => {} }) },
  };
  const render = load(path.join(root, 'src/app/review-alerts.tsx'), deps).default;
  return { advisor, event, item, state, render, navigation,
    complete: () => finish({ kind: 'parser-family-advisory', advisoryOnly: true, family: 'purchase', score: .98, margin: .7, prototypeId: 'parser.family.purchase' }) };
}
test('async AI suggestion appears on Review and still opens ordinary user confirmation without posting', async () => {
  const h = harness();
  const before = JSON.stringify(h.state);
  const pending = h.advisor.enqueue(h.item, h.event, 'movement <money>');
  assert.match(text(h.render()), /Checking the alert type on your device/);
  await Promise.resolve();
  h.complete();
  await pending;
  const screen = h.render();
  assert.match(text(screen), /On-device AI suggestion: Possible purchase/);
  assert.match(text(screen), /Check the transaction type, amount and direction/);
  walk(screen).find(node => node.props?.testID === 'review-alert-open').props.onPress();
  assert.equal(h.navigation[0].pathname, '/add-transaction');
  assert.equal(h.navigation[0].params.reviewId, h.item.id);
  assert.equal(JSON.stringify(h.state), before, 'suggesting and opening review never post or alter grounded facts');
});
test('Review never displays stale async advice after data generation is cleared', async () => {
  const h = harness();
  const pending = h.advisor.enqueue(h.item, h.event, 'movement <money>');
  await Promise.resolve();
  h.advisor.clear();
  h.complete();
  await pending;
  assert.doesNotMatch(text(h.render()), /On-device AI suggestion/);
  assert.equal(h.state.transactions.length, 0);
});
