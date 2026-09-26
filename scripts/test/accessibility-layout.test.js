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
const billsSegments=source('src/components/bills/bills-segment-control.tsx');
const spendingOverview=source('src/components/spending/spending-overview.tsx');
const spendingTrends=source('src/components/spending/spending-trends.tsx');
const paymentAgenda=source('src/components/bills/payment-agenda.tsx');
const walletOverview = source('src/components/wallet/balance-overview.tsx');
const navigationE2e = source('scripts/e2e/e2e-navigation.mjs');
const themeTokens = source('src/constants/theme.ts');
const themeHook = source('src/hooks/use-theme.ts');
const onboardingGate = source('src/components/onboarding-gate.tsx');
// Design language E (2026-09-26): each step is its own file beside the gate.
const onboardingStepFiles = fs.readdirSync(path.join(__dirname, '../../src/components/onboarding'))
  .filter((name) => /^e-.*\.tsx$/.test(name))
  .map((name) => `src/components/onboarding/${name}`);
const onboardingFrame = source('src/components/onboarding/e-frame.tsx');
const onboardingSteps = onboardingStepFiles.map(source).join('\n');
const eButton = source('src/components/ui/band/e-button.tsx');
const onboardingExample = source('src/components/onboarding/money-preview.tsx');
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
  /<BillsSegmentControl/.test(bills) && /<ScrollView[\s\S]*?horizontal/.test(billsSegments) && !/numberOfLines/.test(billsSegments));
// Design language E: the headline is the slate band's BandFigure (which puts
// the currency on its own line at large text) and its chips stack.
ok('Wallet stacks its recorded-balance headline at accessibility text sizes',
  /<BandFigure/.test(walletOverview) &&
    /styles\.chips, p\.largeText && styles\.stack/.test(walletOverview) &&
    /stack: \{ flexDirection: 'column', alignItems: 'flex-start' \}/.test(walletOverview));
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
// Every onboarding step is a one-screen composition (flexGrow + marginTop:auto
// footer). 2026-09-25: it always scrolls instead of clipping — an iPhone SE
// at the largest non-accessibility text size overflowed with scrolling off —
// and only bounces at accessibility sizes, so a fitting screen stays still.
// Design language E: one frame (e-frame.tsx) owns that scroll for every step,
// and its footer scrolls with the content rather than pinning over it.
ok('onboarding keeps a one-screen composition but scrolls instead of clipping at any text size',
  /useLargeTextLayout/.test(onboardingFrame) &&
    /<ScrollView[\s\S]{0,120}bounces=\{largeText\} alwaysBounceVertical=\{false\}[\s\S]{0,120}contentContainerStyle=\{styles\.scroll\}/.test(onboardingFrame) &&
    ![onboardingGate, onboardingSteps].some((code) => /scrollEnabled=/.test(code)) &&
    /scroll: \{ flexGrow: 1/.test(onboardingFrame) &&
    /footer: \{ marginTop: 'auto'/.test(onboardingFrame) &&
    onboardingStepFiles.filter((file) => /-(welcome|name|goals|watch|reminders|pattern|paywall)\.tsx$/.test(file))
      .every((file) => /<EStepFrame\b/.test(source(file))) &&
    /<BottomSheet/.test(onboardingGate));
ok('onboarding text and its sample can grow without truncation or a scale ceiling',
  [onboardingGate, onboardingSteps, onboardingExample].every((code) =>
    !/numberOfLines|maxFontSizeMultiplier|adjustsFontSizeToFit|minimumFontScale/.test(code)));
ok('every onboarding button permits its localized label to wrap',
  !/<Button\b/.test(onboardingGate + onboardingSteps) &&
    /<EButton\b/.test(onboardingGate) &&
    /styles\.label, \{ color: fg \}/.test(eButton) && /label: \{[^}]*flexShrink: 1/.test(eButton) &&
    !/numberOfLines/.test(eButton));
ok('onboarding action targets retain native accessibility size floors',
  /minHeight: BandLayout\.buttonHeight/.test(eButton) &&
    declaredStyleValue(onboardingFrame, 'textAction', 'minHeight') >= 48 &&
    declaredStyleValue(onboardingFrame, 'iconButton', 'width') >= 44 &&
    declaredStyleValue(onboardingFrame, 'iconButton', 'height') >= 44 &&
    declaredStyleValue(source('src/components/onboarding/e-name.tsx'), 'input', 'minHeight') >= 48 &&
    declaredStyleValue(source('src/components/onboarding/e-name.tsx'), 'row', 'minHeight') >= 44 &&
    declaredStyleValue(source('src/components/onboarding/e-goals.tsx'), 'pill', 'minHeight') >= 48 &&
    declaredStyleValue(source('src/components/onboarding/e-first-payment.tsx'), 'source', 'minHeight') >= 48 &&
    declaredStyleValue(onboardingExample, 'action', 'minHeight') >= 48 &&
    declaredStyleValue(controls, 'button', 'minHeight') >= 48);
ok('name personalization exposes a labelled optional input and skip action to assistive technology',
  /testID="onboarding-name-input"[\s\S]{0,260}accessibilityLabel=\{words\.namePlaceholder\}/.test(source('src/components/onboarding/e-name.tsx')) &&
    /<ETextAction palette=\{band\} label=\{t\('onboardNameSkip'\)\}/.test(source('src/components/onboarding/e-name.tsx')) &&
    /accessibilityRole="button" accessibilityLabel=\{label\}/.test(onboardingFrame) &&
    /onboardNamePrivacy/.test(source('src/components/onboarding/e-name.tsx')));
ok('selected tabs have contrasting fills and labels; input boundaries retain control tokens',
  tokenValues('inverseSurface').every((color,index)=>contrast(color,tokenValues('backgroundSelected')[index])>=3) &&
  // Bills' views are the band's tablist (its pill contrast is tested with the
  // band palette); the filter chips inside All fill the selected one.
  /<BandSegmented/.test(billsSegments) && /palette\.fill/.test(billsSegments) && /palette\.onFill/.test(billsSegments) &&
  /const borderColor = accountInvalid \? theme\.expense : selected \? selected\.color : theme\.controlBorder/.test(addTransaction) &&
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
// Design language E: Not Found is a plain sand screen that owns its own safe
// area and content width, and scrolls rather than clipping at large text.
ok('Not Found owns its safe area, width and large-text scrolling',
  /useSafeAreaInsets/.test(notFound) && /MaxContentWidth/.test(notFound) && /<ScrollView/.test(notFound));

// The recurring row is its own memoised component (RecurringRow) so Bills
// re-renders do not redraw every row; check the row it actually renders.
const recurringAccessibilityBlock = bills.match(
  /const RecurringRow = React\.memo[\s\S]*?\n\}\);\n/,
)?.[0] ?? '';
ok('Bills recurring rows have one labelled primary target',
  recurringAccessibilityBlock.length > 0 &&
    !/remindAboutA11y/.test(recurringAccessibilityBlock) &&
    /accessibilityRole="button"/.test(recurringAccessibilityBlock) &&
    /accessibilityLabel=/.test(recurringAccessibilityBlock));
ok('Bills card actions live in the card sheet as one labelled button',
  /<CardDetailSheet[\s\S]{0,200}account=\{cardDetail\}/.test(bills) &&
    /<EButton palette=\{band\} label=\{w\.recordPayment\}/.test(cardDetail) &&
    /<EButton[\s\S]{0,120}label=\{t\('markPaid'\)\}/.test(bills));
ok('Bills manual reminder rows open one labelled detail target',
  /setSelectedReminderId\(\(item\.repeatOf \?\? item\.id\)\.slice\(5\)\)/.test(bills) && /onPress=\{\(\) => onOpen\(item\)\}/.test(paymentAgenda) &&
    /accessibilityRole="button"/.test(bills) &&
    /accessibilityLabel=/.test(bills) &&
    !/onLongPress=\{\(\) => onLongPressBill/.test(bills));
ok('Wallet source rows open on normal tap and keep long press optional',
  /onPress=\{\(\) => openAccount\(account\)\}/.test(wallet) &&
    /onLongPress=\{\(\) => setOptionsFor\(account\)\}/.test(wallet) &&
    ((wallet.match(/accessibilityRole="button"/g) ?? []).length + (wallet.match(/<Button\b/g) ?? []).length) >= 8);
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
    /reviewItem \? validReviewDate\(reviewDate\)/.test(addTransaction) &&
    /event\.transactionDate\.evidence !== 'explicit' && hasRealDateChoice/.test(
      source('src/components/universal-review-fields.tsx'),
    ));

ok('Spending categories provide localized spending and limit equivalents',
 /accessibilityLabel=\{`\$\{categoryLabel\(row\.category, language\)\}[\s\S]*?row\.spentFils[\s\S]*?row\.limitFils/.test(spendingOverview));
ok('Flow trend months expose cashflow descriptions and selected state',
 /accessibilityLabel=\{monthDescription\(month\)\}/.test(spendingTrends) && /accessibilityState=\{\{ selected: month\.key === p\.selectedKey \}\}/.test(spendingTrends));
ok('Flow retains selected month context and large-text list',
 /accessibilityLiveRegion="polite"[\s\S]*?monthLabel\(selected\.key\)[\s\S]*?monthFigures\(selected\)/.test(spendingTrends) && /!showAllTrendLabels &&[\s\S]*?p\.months\.map/.test(spendingTrends));
ok('Flow uses shared shell and Stats redirects into Trends',
 /<BandScaffold band="spending" tabbed/.test(flow) && /<Redirect href="\/flow\?view=trends"/.test(stats));
ok('shared charts consume the semantic data-visualization palette',
  /import \{[^}]*\bDataViz\b[^}]*\} from '@\/constants\/theme'/.test(charts) &&
    /from '@\/components\/ui\/data-viz'/.test(charts));

ok('Bills uses one band scaffold scroller with a typed nav row',
  /const billsNav: BandNav = \{/.test(bills) &&
    /<BandScaffold[\s\S]*?band="bills"[\s\S]*?tabbed[\s\S]*?nav=\{billsNav\}/.test(bills) &&
    (bills.match(/<ScrollView/g) ?? []).length === 0 &&
    /testID="subscription-history-scroll"/.test(source('src/components/bill-detail-sheet.tsx')));
const bandSegmented = source('src/components/ui/band/band-segmented.tsx');
ok('Bills uses canonical labelled control and selection semantics',
 /<BillsSegmentControl/.test(bills) && /<BandSegmented/.test(billsSegments) && /label=\{w\.billsViews\}/.test(billsSegments) &&
   /role="tablist"/.test(bandSegmented) && /accessibilityState=\{\{ selected: active \}\}/.test(bandSegmented) &&
   /accessibilityState=\{\{ selected: active \}\}/.test(billsSegments));
// The band's segments are 44pt pills inside a 4pt track (52pt of track per row).
ok('Bills agenda tabs retain 44 point targets',
  Number(bandSegmented.match(/segment:\s*\{[\s\S]*?minHeight:\s*(\d+)/)?.[1])>=44);
ok('Bills reminder entry exposes three labelled shared fields and a disabled Save footer',
  (bills.match(/<TextField/g) ?? []).length === 3 &&
    !/<TextInput/.test(bills) &&
    /<BottomSheet[^>]*visible=\{adderVisible\}[\s\S]*?footer=\{\([\s\S]*?<Button[\s\S]*?label=\{t\('saveReminder'\)\}[\s\S]*?disabled=\{!draftValid\}/.test(bills));

ok('Wallet uses the typed band nav row and labels its remaining disclosure',
  /const walletNav: BandNav = \{/.test(wallet) &&
    /<BandScaffold[\s\S]*?band="accounts"[\s\S]*?tabbed[\s\S]*?nav=\{walletNav\}/.test(wallet) &&
    !/detailsLabel|expanded: details/.test(walletOverview) &&
    /accessibilityLabel=\{inactiveDisclosureLabel\}[\s\S]{0,180}accessibilityState=\{\{ expanded: showInactive \}\}/.test(wallet));
// BandScaffold's scroller never adjusts content insets (the band covers the
// status bar), so Wallet no longer offsets its first frame by an inset.
ok('Wallet starts its scroller at the visible content origin',
  !/contentOffset:/.test(wallet) && !/useScreenContentInsets/.test(wallet) &&
    /contentInsetAdjustmentBehavior="never"/.test(source('src/components/ui/band-scaffold.tsx')) &&
    /scrollProps=\{\{ showsVerticalScrollIndicator: false \}\}/.test(wallet));
const balanceHeadline = walletOverview.match(
  /\{p\.knownBalanceCount > 0[\s\S]*?(?=\n\s*\{p\.activeSourceCount === 0)/,
)?.[0] ?? '';
ok('Wallet headline amount wraps instead of shrinking at accessibility sizes',
  balanceHeadline.length > 0 &&
    !/numberOfLines=\{1\}|adjustsFontSizeToFit|minimumFontScale/.test(balanceHeadline));
ok('Cards uses a typed band nav row and wraps card identity at large text sizes',
  /const cardsNav: BandNav = \{/.test(cards) &&
    /<BandScaffold[\s\S]*?band="accounts"[\s\S]*?nav=\{cardsNav\}/.test(cards) &&
    /useLargeTextLayout\(\)/.test(cards) &&
    /numberOfLines=\{largeText \? undefined : 1\}/.test(cards));
ok('Cards inactive disclosure is labelled, expanded, and preserves platform touch floors',
  /accessibilityLabel=\{inactiveDisclosureLabel\}[\s\S]{0,180}accessibilityState=\{\{ expanded: showInactive \}\}/.test(cards) &&
    /disclosureAction: \{[\s\S]*?minWidth: 44[\s\S]*?minHeight: 44/.test(cards) &&
    /androidDisclosureAction: \{ minWidth: 48, minHeight: 48 \}/.test(cards));
// Design language E: the statement balance sits on the ink card under the
// card's name, then the due line and Record a payment, then the history.
ok('Card detail presents billable obligations on the card before payment history',
  /\{data\.billable && \([\s\S]*?styles\.inkCard[\s\S]*?testID="card-statement-hero"[\s\S]*?styles\.summary[\s\S]*?\{t\('statements'\)\}[\s\S]*?\{t\('paymentsMade'\)\}/.test(cardDetail) &&
    !/type="subtitle" numberOfLines=\{1\}/.test(cardDetail));
ok('Limit editor delegates keyboard scrolling to the shared labelled sheet and field',
  /<BottomSheet/.test(limitSheet) && /<TextField[\s\S]*?label=\{state\.ledgerMoney \? bandWords\.exactLimit : t\('monthlyLimit'\)\}/.test(limitSheet) &&
    !/<Modal/.test(limitSheet) && !/<ScrollView/.test(limitSheet) && !/useKeyboardHeight/.test(limitSheet));

/* ── Larger Text (docs/design/2026-09-25-large-text-audit.md) ─────────── */
const money = source('src/components/ui/money.tsx');
const bottomSheet = source('src/components/ui/bottom-sheet.tsx');
const fontScaleHarness = source('src/lib/e2e-font-scale.ts');
const rampCaps = Object.fromEntries([...(themedText.match(/const RAMP_CAP[\s\S]*?\};/)?.[0] ?? '')
  .matchAll(/^\s+(\w+): ([\d.]+),$/gm)].map((m) => [m[1], Number(m[2])]));
ok('Only display sizes carry a Larger Text cap, and each still grows at least 1.75x',
  Object.keys(rampCaps).sort().join() === 'amount,display,heading,sheetAmount,subtitle,title' &&
    Object.values(rampCaps).every((cap) => cap >= 1.75));
ok('A caller-supplied maxFontSizeMultiplier wins over the ramp cap',
  /rest\.maxFontSizeMultiplier !== undefined\s*\? rest\.maxFontSizeMultiplier : RAMP_CAP\[type\]/.test(themedText) &&
    /\{\.\.\.rest\}\s*maxFontSizeMultiplier=\{maxFontSizeMultiplier\}/.test(themedText));
ok('Money keeps hero figures whole: fitted from the width, never truncated, full amount labelled',
  /useHeroFigureMultiplier\(amount, type, fitInset\)/.test(money) &&
    /large && styles\.valueWhole/.test(money) && /valueWhole: \{ flexShrink: 0, maxWidth: '100%' \}/.test(money) &&
    /accessibilityLabel=\{label\}/.test(money) && !/numberOfLines/.test(money));
// Design language E: the selected tab shows its name in its own colour; the
// others are icons. At the accessibility sizes every tab is an icon. Every
// unlabelled tab can be held to show its name, and every tab is spoken.
ok('Tab bar goes icon-only at the accessibility sizes and keeps every label for assistive tech',
  /const iconOnly = useLargeTextLayout\(\)/.test(tabBar) && /accessibilityLabel=\{label\}/.test(tabBar) &&
    /const showLabel = focused && !iconOnly;/.test(tabBar) && /\{showLabel && <ThemedText/.test(tabBar) &&
    /onLongPress=\{!showLabel \?/.test(tabBar));
ok('Sheets scroll their footer with the content at the accessibility sizes',
  /const pinFooter = hasFooter && !largeText;/.test(bottomSheet) &&
    /\{pinFooter \? null : footerNode\}\s*<\/ScrollView>/.test(bottomSheet));
ok('The font-scale emulation only exists in the seeded web E2E export',
  /Platform\.OS !== 'web' \|\| process\.env\.EXPO_PUBLIC_WAFRA_E2E_DEMO !== '1'\) return null/.test(fontScaleHarness) &&
    /E2E_FONT_SCALE === null\s*\? composed/.test(themedText));
ok('Transactions scroll the search controls with the list at the accessibility sizes',
  /bandContent=\{onBand \? searchControls : undefined\}/.test(source('src/app/transactions.tsx')) &&
    /const onBand = !largeText;/.test(source('src/app/transactions.tsx')) &&
    /\{scrollingSearchControls\}/.test(source('src/app/transactions.tsx')));
{
  // Behaviour of the figure fit, from the compiled module when the suite has
  // built it (npm test); skipped when this file is run on its own.
  const built = path.join(__dirname, 'build/large-text-figure.js');
  if (fs.existsSync(built)) {
    const { figureFontMultiplier } = require(built);
    ok('Figure fit is inert at the default text size', figureFontMultiplier(9, 36, 1.75, 327, 1) === undefined);
    ok('Figure fit keeps the requested size when the figure fits', figureFontMultiplier(6, 36, 1.75, 327, 1.35) === 1.35);
    ok('Figure fit never exceeds its ramp cap', figureFontMultiplier(4, 36, 1.75, 1000, 3.1) === 1.75);
    const tight = figureFontMultiplier(9, 36, 1.75, 327, 3.1);
    ok(`Figure fit shrinks a wide figure to its width (${tight?.toFixed(3)})`,
      tight !== undefined && tight < 1.75 && 9 * 36 * 0.62 * tight <= 327.01);
    ok('Figure fit never goes under 60% of the requested size',
      Math.abs(figureFontMultiplier(16, 36, 1.75, 200, 3.1) - 1.75 * 0.6) < 1e-9 &&
        figureFontMultiplier(16, 36, 1.75, 50, 1.2) === 1);
  }
}

console.log(`\naccessibility-layout: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
