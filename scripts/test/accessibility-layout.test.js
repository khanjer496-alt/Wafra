const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
const ok = (name, condition) => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`); }
};
const source = (relative) => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

const home = source('src/screens/ledger-home-screen.tsx');
const flow = source('src/app/(tabs)/flow.tsx');
const bills = source('src/app/(tabs)/bills.tsx');
const wallet = source('src/app/(tabs)/wallet.tsx');
const settings = source('src/app/settings.tsx');
const tabBar = source('src/components/tab-bar.tsx');
const billsSegments=source('src/components/ui/segmented-control.tsx');
const spendingOverview=source('src/components/spending/spending-overview.tsx');
const spendingTrends=source('src/components/spending/spending-trends.tsx');
const paymentAgenda=source('src/components/bills/payment-agenda.tsx');
const walletOverview = source('src/components/wallet/balance-overview.tsx');
const navigationE2e = source('scripts/e2e/e2e-navigation.mjs');
const themeTokens = source('src/constants/theme.ts');
const themeHook = source('src/hooks/use-theme.ts');
const onboardingGate = source('src/components/onboarding-gate.tsx');
const controls = source('src/components/ui/controls.tsx');
const addTransaction = source('src/app/add-transaction.tsx');
const transactionRow = source('src/components/transaction-row.tsx');
const stats = source('src/app/stats.tsx');
const charts = source('src/components/ui/charts.tsx');
const cards = source('src/app/cards.tsx');
const cardDetail = source('src/components/card-detail-sheet.tsx');
const limitSheet = source('src/components/limit-sheet.tsx');

const hex = (value) => {
  const match = value.match(/^#([0-9a-f]{6})$/i);
  return match ? [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255) : null;
};
const luminance = (value) => {
  const rgb = hex(value);
  if (!rgb) return NaN;
  const linear = rgb.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};
const contrast = (a, b) => {
  const left = luminance(a);
  const right = luminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
};
const tokenValues = (name) => [...themeTokens.matchAll(new RegExp(`${name}: '(#[0-9A-F]{6})'`, 'g'))]
  .map((match) => match[1]);

for (const [name, code] of Object.entries({ Home: home, Flow: spendingOverview, Bills: bills, Wallet: wallet, Settings: settings })) {
  ok(`${name} switches layout at accessibility text sizes`,
    /useLargeTextLayout/.test(code) && /large(?:Text)?/.test(code));
}

ok('Home stacks its hero breakdown for large text', /largeText && styles\.splitLarge/.test(home));
ok('Flow stacks summary and category rows for large text', /large && styles\.stack/.test(spendingOverview) && /<SpendingOverview/.test(flow));
ok('Bills reflows its header and segments for large text',
  /<SegmentedControl/.test(bills) && /large && styles\.stack/.test(billsSegments) && !/numberOfLines/.test(billsSegments));
ok('Wallet collapses overview facts to a vertical list',
  /p\.largeText && styles\.stack/.test(walletOverview) && /detailRow, p\.largeText && styles\.stack/.test(walletOverview));
ok('Bills uses the shared accessible sheet contract',
  /<BottomSheet/.test(bills) && !/<Modal/.test(bills) && /accessibilityLabel=\{t\('reminderName/.test(bills));
ok('Wallet uses shared sheets and selected choice semantics',
  /<BottomSheet/.test(wallet) && !/<Modal/.test(wallet) &&
    /accessibilityRole="radio"/.test(wallet) && /accessibilityState=\{\{ selected:/.test(wallet));
ok('the primary tab bar exposes tab-list and explicit web selected semantics',
  /role="tablist"/.test(tabBar) && /aria-selected=\{focused\}/.test(tabBar));
ok('navigation E2E targets the exact actionable tab rather than duplicate body text',
  /const tapTab[\s\S]{0,800}getByRole\('tab', \{ name, exact: true \}\)\.click\(\{ timeout: 8000 \}\)/.test(navigationE2e) &&
    !/force:\s*true/.test(navigationE2e));
ok('navigation E2E waits for the tab selected state instead of animation stability',
  /const tapTab[\s\S]{0,1200}aria-selected/.test(navigationE2e) &&
    /const tapTab[\s\S]{0,1800}elementFromPoint/.test(navigationE2e));
const controlBorders = tokenValues('controlBorder');
const elementBackgrounds = tokenValues('backgroundElement');
ok('light and dark control borders meet the 3:1 non-text contrast floor',
  controlBorders.length === 2 && elementBackgrounds.length === 2 &&
    controlBorders.every((color, index) => contrast(color, elementBackgrounds[index]) >= 3));
ok('the theme responds to native and web increased-contrast preferences',
  /useIncreasedContrast/.test(themeHook) && /controlBorderHigh/.test(themeHook));
const spacingValues = Object.fromEntries(
  [...themeTokens.matchAll(/^  (\w+): (\d+),$/gm)].map((match) => [match[1], Number(match[2])]),
);
const declaredStyleValue = (sourceText, style, property) => {
  const match = sourceText.match(new RegExp(
    `${style}: \\{[\\s\\S]*?${property}: (?:Spacing\\.(\\w+)|(\\d+))`,
  ));
  if (!match) return NaN;
  return match[1] ? spacingValues[match[1]] : Number(match[2]);
};
const defaultCaptureLayoutHeight = () => {
  const header = declaredStyleValue(onboardingGate, 'progressHeader', 'paddingTop') +
    declaredStyleValue(onboardingGate, 'progressTopline', 'minHeight') +
    declaredStyleValue(onboardingGate, 'progressSegment', 'height');
  const hero = declaredStyleValue(onboardingGate, 'captureIcon', 'height') +
    declaredStyleValue(onboardingGate, 'questionTitle', 'lineHeight') +
    declaredStyleValue(onboardingGate, 'questionBodyCopy', 'lineHeight') +
    declaredStyleValue(onboardingGate, 'captureHero', 'gap') * 2;
  const choices = declaredStyleValue(onboardingGate, 'startOptions', 'paddingTop') +
    declaredStyleValue(onboardingGate, 'startOption', 'minHeight') * 2 +
    declaredStyleValue(onboardingGate, 'startOptions', 'gap');
  const footer = declaredStyleValue(onboardingGate, 'capturePrivacyText', 'lineHeight') +
    declaredStyleValue(onboardingGate, 'learnMoreButton', 'marginTop') +
    declaredStyleValue(controls, 'button', 'minHeight');
  return header +
    declaredStyleValue(onboardingGate, 'questionBody', 'paddingTop') +
    hero + choices + footer +
    declaredStyleValue(onboardingGate, 'scrollContent', 'paddingBottom');
};
ok('onboarding choice cards fit the 402×874 default viewport from their declared layout budget',
  Number.isFinite(defaultCaptureLayoutHeight()) && defaultCaptureLayoutHeight() > 0 &&
    defaultCaptureLayoutHeight() <= 874 - 96 &&
    !/numberOfLines/.test(onboardingGate) &&
    /<ScrollView/.test(onboardingGate) &&
    /<BottomSheet/.test(onboardingGate));
ok('selected tabs have contrasting fills and labels; input boundaries retain control tokens',
  tokenValues('inverseSurface').every((color,index)=>contrast(color,tokenValues('backgroundSelected')[index])>=3) &&
  /theme\.inverseSurface/.test(billsSegments) && /theme\.inverseText/.test(billsSegments) &&
  /onPress=\{p\.onOpenBills\}/.test(walletOverview) && /onPress=\{p\.onOpenCurrency\}/.test(walletOverview) &&
  /transferChoice[\s\S]{0,100}theme\.controlBorder/.test(addTransaction));

const themedText = source('src/components/themed-text.tsx');
ok('ThemedText does not impose a global Dynamic Type ceiling',
  !/const MAX_SCALE/.test(themedText) &&
    !/maxFontSizeMultiplier=\{rest\.maxFontSizeMultiplier/.test(themedText));
ok('the compatibility tab bar does not clip or cap localized tab labels',
  !/maxFontSizeMultiplier=\{1\.3\}/.test(tabBar) &&
    !/numberOfLines=\{1\}[\s\S]{0,120}styles\.tabLabel/.test(tabBar));
for (const token of ['text', 'textSecondary', 'textTertiary']) {
  const values = tokenValues(token);
  ok(`${token} meets 4.5:1 normal-text contrast on the page`,
    values.length === 2 && values.every((value, index) =>
      contrast(value, tokenValues('background')[index]) >= 4.5));
}
ok('meaningful control boundaries meet the 3:1 non-text floor',
  controlBorders.length === 2 && elementBackgrounds.length === 2 &&
    controlBorders.every((value, index) => contrast(value, elementBackgrounds[index]) >= 3));
const tabMetrics = source('src/components/ui/tab-bar-metrics.tsx');
const tabClearance = source('src/hooks/use-tab-bar-clearance.ts');
ok('tab clearance follows the measured wrapped label height',
  /onLayout/.test(tabBar) && /setMeasuredHeight/.test(tabBar) &&
    /measuredHeight \?\?/.test(tabClearance) && /TabBarMetricsProvider/.test(tabMetrics));

const scaffold = source('src/components/ui/screen-scaffold.tsx');
const notFound = source('src/app/+not-found.tsx');
ok('screen scaffold owns safe area, width, and tab clearance',
  /useSafeAreaInsets/.test(scaffold) && /MaxContentWidth/.test(scaffold) && /useTabBarClearance/.test(scaffold));
ok('virtualized screens can consume the same insets without nested scrolling',
  /export function useScreenContentInsets/.test(scaffold) && /scrollIndicatorInsets/.test(scaffold) &&
    /virtualized/.test(scaffold) && /virtualized \? undefined : contentInsets/.test(scaffold));
ok('tabbed footer clearance is not dropped',
  /tabBarClearance \+ footerClearance/.test(scaffold));
ok('Not Found is the first scaffold adoption', /<ScreenScaffold/.test(notFound));

const recurringAccessibilityBlock = bills.match(
  /const renderRecurringRow[\s\S]*?\n  \};\n\n  return \(/,
)?.[0] ?? '';
ok('Bills recurring rows have one labelled primary target',
  recurringAccessibilityBlock.length > 0 &&
    !/remindAboutA11y/.test(recurringAccessibilityBlock) &&
    /accessibilityRole="button"/.test(recurringAccessibilityBlock) &&
    /accessibilityLabel=/.test(recurringAccessibilityBlock));
ok('Bills card actions move to the labelled detail footer',
  /<CardDetailSheet[\s\S]{0,900}footer=/.test(bills) &&
    /<Button[\s\S]{0,120}label=\{t\('markPaid'\)\}/.test(bills));
ok('Bills manual reminder rows open one labelled detail target',
  /setSelectedReminderId\(item\.id\.slice\(5\)\)/.test(bills) && /onPress=\{\(\) => onOpen\(item\)\}/.test(paymentAgenda) &&
    /accessibilityRole="button"/.test(bills) &&
    /accessibilityLabel=/.test(bills) &&
    !/onLongPress=\{\(\) => onLongPressBill/.test(bills));
ok('Wallet source rows open on normal tap and keep long press optional',
  /onPress=\{\(\) => openAccount\(account\)\}/.test(wallet) &&
    /onLongPress=\{\(\) => setOptionsFor\(account\)\}/.test(wallet) &&
    (wallet.match(/accessibilityRole="button"/g) ?? []).length >= 8);
ok('Wallet inactive disclosure exposes a localized expanded button',
  /accessibilityRole="button"[\s\S]{0,180}accessibilityLabel=\{inactiveDisclosureLabel\}[\s\S]{0,180}accessibilityState=\{\{ expanded: showInactive \}\}/.test(wallet));

ok('transaction rows wrap merchant and complete category/account meaning at large text sizes',
  !/<ThemedText[^>]*numberOfLines=\{1\}[^>]*>[\s\S]{0,100}\{transaction\.title\}/.test(transactionRow) &&
    !/<ThemedText[^>]*numberOfLines=\{1\}[^>]*>[\s\S]{0,180}\{where\}/.test(transactionRow) &&
    /const accountLabel = accountReview \?\? account\?\.name/.test(transactionRow) &&
    /const label = \[[\s\S]*?transaction\.title[\s\S]*?where[\s\S]*?accountLabel[\s\S]*?clock/.test(transactionRow));
ok('Add category and account containers expose labelled radio groups with hints',
  (addTransaction.match(/accessibilityRole="radiogroup"/g) ?? []).length === 2 &&
    /accessibilityLabel=\{tUi\('category'\)\}/.test(addTransaction) &&
    /accessibilityLabel=\{tUi\('account'\)\}/.test(addTransaction) &&
    (addTransaction.match(/accessibilityHint=\{/g) ?? []).length >= 2 &&
    /collapsable=\{false\}/.test(addTransaction));
ok('Add groups associate stable labels and errors only through a web compatibility spread',
  /categoryLabelId/.test(addTransaction) && /categoryErrorId/.test(addTransaction) &&
    /accountLabelId/.test(addTransaction) && /accountErrorId/.test(addTransaction) &&
    /type WebGroupAriaProps = \{/.test(addTransaction) &&
    /Platform\.OS === 'web' \? categoryWebAriaProps : \{\}/.test(addTransaction) &&
    /Platform\.OS === 'web' \? accountWebAriaProps : \{\}/.test(addTransaction) &&
    !/<View[^>]*aria-invalid=/.test(addTransaction));
ok('Add invalid groups and fields announce adjacent localized errors politely',
  /const categoryInvalid = showValidation && !category/.test(addTransaction) &&
    /const accountInvalid = showValidation && !accountId/.test(addTransaction) &&
    /categoryInvalid && \([\s\S]*?accessibilityLiveRegion="polite"/.test(addTransaction) &&
    /accountInvalid && \([\s\S]*?accessibilityLiveRegion="polite"/.test(addTransaction) &&
    /invalid=\{amountInvalid\}/.test(addTransaction) &&
    /errorText=\{amountInvalid \?/.test(addTransaction) &&
    /invalid=\{reviewDateInvalid\}/.test(addTransaction) &&
    /errorText=\{reviewDateInvalid \?/.test(addTransaction));

ok('Spending categories provide localized spending and limit equivalents',
 /accessibilityLabel=\{`\$\{categoryLabel\(row\.category, language\)\}[\s\S]*?row\.spentFils[\s\S]*?row\.limitFils/.test(spendingOverview));
ok('Flow trend months expose cashflow descriptions and selected state',
 /accessibilityLabel=\{monthDescription\(month\)\}/.test(spendingTrends) && /accessibilityState=\{\{ selected: month\.key === p\.selectedKey \}\}/.test(spendingTrends));
ok('Flow retains selected month context and large-text list',
 /accessibilityLiveRegion="polite"[\s\S]*?monthLabel\(selected\.key\)[\s\S]*?monthFigures\(selected\)/.test(spendingTrends) && /!showAllTrendLabels &&[\s\S]*?p\.months\.map/.test(spendingTrends));
ok('Flow uses shared shell and Stats redirects into Trends',
 /<ScreenScaffold[\s\S]*?tabbed[\s\S]*?headerMode="inline"/.test(flow) && /<Redirect href="\/flow\?view=trends"/.test(stats));
ok('shared charts consume the semantic data-visualization palette',
  /import \{[^}]*\bDataViz\b[^}]*\} from '@\/constants\/theme'/.test(charts) &&
    /from '@\/components\/ui\/data-viz'/.test(charts));

ok('Bills uses one scaffold scroller with an inline typed header',
  /const billsHeader: ScreenHeaderProps = \{/.test(bills) &&
    /<ScreenScaffold[\s\S]*?tabbed[\s\S]*?headerMode="inline"[\s\S]*?header=\{billsHeader\}/.test(bills) &&
    (bills.match(/<ScrollView/g) ?? []).length === 1 &&
    /testID="subscription-history-scroll"/.test(bills));
ok('Bills uses canonical labelled control and selection semantics',
 /<SegmentedControl/.test(bills) && /label=\{t\('billsTitle'\)\}/.test(bills) && /role="tablist"/.test(billsSegments) && /accessibilityState=\{\{ selected:/.test(billsSegments));
ok('Bills agenda tabs retain 48 point targets',Number(billsSegments.match(/segment:\s*\{[\s\S]*?minHeight:\s*(\d+)/)?.[1])>=48);
ok('Bills reminder entry exposes three labelled shared fields and a disabled Save footer',
  (bills.match(/<TextField/g) ?? []).length === 3 &&
    !/<TextInput/.test(bills) &&
    /<BottomSheet[^>]*visible=\{adderVisible\}[\s\S]*?footer=\{\([\s\S]*?<Button[\s\S]*?label=\{t\('saveReminder'\)\}[\s\S]*?disabled=\{!draftValid\}/.test(bills));

ok('Wallet uses the typed inline scaffold header and labels both disclosures',
  /const walletHeader: ScreenHeaderProps = \{/.test(wallet) &&
    /<ScreenScaffold[\s\S]*?tabbed[\s\S]*?headerMode="inline"[\s\S]*?header=\{walletHeader\}/.test(wallet) &&
    /accessibilityLabel=\{detailsLabel\}[\s\S]{0,180}accessibilityState=\{\{ expanded: details \}\}/.test(walletOverview) &&
    /accessibilityLabel=\{inactiveDisclosureLabel\}[\s\S]{0,180}accessibilityState=\{\{ expanded: showInactive \}\}/.test(wallet));
ok('Wallet starts its iOS inset scroller at the visible content origin',
  /const walletInsets = useScreenContentInsets\(\{ tabbed: true \}\)/.test(wallet) &&
    /scrollProps=\{\{[\s\S]{0,240}contentOffset: Platform\.OS === 'ios'[\s\S]{0,120}\{ x: 0, y: -walletInsets\.contentInset\.top \}[\s\S]{0,120}: undefined[\s\S]{0,240}showsVerticalScrollIndicator: false/.test(wallet));
const balanceHeadline = walletOverview.match(
  /<View style=\{\[styles\.money[\s\S]*?(?=\n\s*\{p\.activeSourceCount === 0)/,
)?.[0] ?? '';
ok('Wallet headline amount wraps instead of shrinking at accessibility sizes',
  balanceHeadline.length > 0 &&
    !/numberOfLines=\{1\}|adjustsFontSizeToFit|minimumFontScale/.test(balanceHeadline));
ok('Cards uses a typed native header and wraps card identity at large text sizes',
  /const cardsHeader: ScreenHeaderProps = \{/.test(cards) &&
    /<ScreenScaffold[\s\S]*?headerMode="native"[\s\S]*?header=\{cardsHeader\}/.test(cards) &&
    /useLargeTextLayout\(\)/.test(cards) &&
    /numberOfLines=\{largeText \? undefined : 1\}/.test(cards));
ok('Cards inactive disclosure is labelled, expanded, and preserves platform touch floors',
  /accessibilityLabel=\{inactiveDisclosureLabel\}[\s\S]{0,180}accessibilityState=\{\{ expanded: showInactive \}\}/.test(cards) &&
    /disclosureAction: \{[\s\S]*?minWidth: 44[\s\S]*?minHeight: 44/.test(cards) &&
    /androidDisclosureAction: \{ minWidth: 48, minHeight: 48 \}/.test(cards));
ok('Card detail presents billable obligations before identity and payment history',
  /\{data\.billable && \([\s\S]*?styles\.summary[\s\S]*?title=\{t\('statements'\)\}[\s\S]*?styles\.head[\s\S]*?title=\{t\('paymentsMade'\)\}/.test(cardDetail) &&
    !/type="subtitle" numberOfLines=\{1\}/.test(cardDetail));
ok('Limit editor delegates keyboard scrolling to the shared labelled sheet and field',
  /<BottomSheet/.test(limitSheet) && /<TextField[\s\S]*?label=\{t\('monthlyLimit'\)\}/.test(limitSheet) &&
    !/<Modal/.test(limitSheet) && !/<ScrollView/.test(limitSheet) && !/useKeyboardHeight/.test(limitSheet));

console.log(`\naccessibility-layout: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
