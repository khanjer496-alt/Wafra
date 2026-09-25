const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const code = (value) => value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const home = read('src/screens/ledger-home-screen.tsx');
assert.match(home, /projectDashboard\(\{/);
assert.match(home, /netFils=\{dashboard\.hero\.netFils\}/);
assert.match(home, /incomeFils=\{dashboard\.hero\.incomeFils\}/);
assert.match(home, /expenseFils=\{dashboard\.hero\.expenseFils\}/);

const transactions = read('src/app/transactions.tsx');
for (const parameter of ['source', 'type', 'category', 'merchant']) {
  assert.match(transactions, new RegExp(`${parameter}.*useLocalSearchParams|useLocalSearchParams[\\s\\S]*${parameter}`));
}
assert.match(transactions, /<SectionList/);
assert.match(transactions, /clearFilters/);

const add = read('src/app/add-transaction.tsx');
assert.match(add, /reviewId/);
assert.match(add, /promoteReviewAlert/);
assert.match(add, /addTransaction/);

const bills = code(read('src/app/(tabs)/bills.tsx'));
const billsFilter = code(read('src/components/bills/bills-segment-control.tsx'));
assert.match(bills, /useState<BillsSegment>\('upcoming'\)/);
// Two views; the payment types that were tabs are filters inside All.
assert.match(billsFilter, /export type BillsSegment = 'upcoming' \| 'all'/);
assert.match(billsFilter, /export type BillsGroupFilterValue = 'everything' \| 'subscriptions' \| 'utilities' \| 'cards'/);
for (const seam of ['openDues(', 'recentlySettledDues(', 'billsForMonth(', 'billFromSubscription(']) {
  assert.ok(bills.includes(seam), `Bills lost ${seam}`);
}
const cards = read('src/app/cards.tsx');
assert.match(cards, /useLocalSearchParams<\{ card\?: string \}>/);
assert.match(cards, /setDetail\(target\)/);

const flow = read('src/app/(tabs)/flow.tsx');
assert.match(flow, /summarizeMonth\(/);
assert.match(flow, /spendingCategoryRows\(/);

const pro = read('src/app/pro.tsx');
for (const seam of ['useWafraBilling(', 'purchasePro(', 'fetchProOffers(', 'restorePro(', 'subscriptionManagementUrl(']) {
  assert.ok(pro.includes(seam), `Pro lost ${seam}`);
}

const interactionBills = code(read('src/app/(tabs)/bills.tsx'));
// The recurring row is its own memoised component (RecurringRow).
const recurringRow = interactionBills.match(
  /const RecurringRow = React\.memo[\s\S]*?\n\}\);\n/,
)?.[0] ?? '';
assert.ok(recurringRow.length > 0, 'recurring row block was not found');
assert.doesNotMatch(recurringRow, /remindAboutA11y/);
assert.match(recurringRow, /accessibilityRole="button"/);
assert.match(recurringRow, /accessibilityLabel=/);
assert.match(recurringRow, /recurringChargePresentation\(sub\)/);
assert.match(recurringRow, /formatAED\(charge\.amountFils/);
assert.match(recurringRow, /'recurringEstimatedCharge'/);
assert.doesNotMatch(recurringRow, /formatAED\(sub\.monthlyEquivalentFils/,
  'an annual or weekly charge must not be presented as its monthly average');

// Payment/deletion safeguards are unchanged; the shared agenda owns detail navigation.
const agenda=code(read('src/components/bills/payment-agenda.tsx'));
// The Bills tabs choose payment type; due timing remains the outer hierarchy.
// Only the current render window is ordered eagerly so a large recurrence
// result cannot stall the JS thread before most rows are discarded.
assert.match(agenda,/const visibleItems = useMemo\([\s\S]*?paymentGroupFor\(item\) === selectedGroup[\s\S]*?\[selectedGroup, items\]/);
assert.match(agenda,/const sections = useMemo\([\s\S]*?groupPaymentAgendaWindow\(visibleItems, includePaid, renderLimit\)[\s\S]*?\[visibleItems, includePaid, renderLimit\]/);
assert.match(agenda,/sections\.map/);
assert.match(agenda,/section\.items\.map/);
assert.match(agenda,/accessibilityRole="button"[\s\S]*?accessibilityLabel=/);
assert.match(agenda,/onPress=\{\(\) => onOpen\(item\)\}/);
assert.doesNotMatch(agenda,/<Button|onPayDue|payCardDue|onLongPress/);
// A stable handler (the agenda is memoised) that still opens the tapped item.
assert.match(interactionBills,/<PaymentAgenda[\s\S]*?onOpen=\{onOpenAgendaItem\}/);
assert.match(interactionBills,/agendaOpenRef\.current = \(item\) =>/);
// A due opens its card's sheet; recording a payment happens there (Record a
// payment -> the card payment sheet and its own confirmation), never from Bills.
assert.match(interactionBills,/openCardDetail\(state\.accounts\.find\(\(a\) => a\.id === due\.accountId\) \?\? null\)/);
assert.match(interactionBills, /<CardDetailSheet[\s\S]{0,200}account=\{cardDetail\}/);
assert.doesNotMatch(interactionBills, /payCardDue\(/);
const cardSheetForBills = code(read('src/components/card-detail-sheet.tsx'));
assert.match(cardSheetForBills, /w\.recordPayment[\s\S]*?setPaying\(statement\)/);
assert.match(cardSheetForBills, /<CardPaymentSheet due=\{paying\}/);

const subscriptionDetail = interactionBills.match(
  /\{detail && \([\s\S]*?(?=\n\s*\{selectedReminder && \()/,
)?.[0] ?? '';
assert.ok(subscriptionDetail.length > 0, 'subscription detail was not found');
assert.match(subscriptionDetail, /<BillDetailSheet[\s\S]*?footer=/);
assert.match(subscriptionDetail, /remindable\(detail\)[\s\S]*?addBill\(billFromSubscription\(detail\)\)/);
assert.match(subscriptionDetail, /const sub = detail;[\s\S]*?setDetail\(null\);[\s\S]*?onDismissSub\(sub\)/);

const manualRows=agenda;
assert.match(interactionBills,/setSelectedReminderId\(\(item\.repeatOf \?\? item\.id\)\.slice\(5\)\)/);
assert.match(manualRows,/accessibilityRole="button"/);
assert.match(manualRows,/accessibilityLabel=/);
assert.doesNotMatch(manualRows,/onLongPress|t\('markPaid'\)/);
assert.match(interactionBills, /const \[selectedReminderId, setSelectedReminderId\] = useState<string \| null>\(null\)/);
assert.match(interactionBills, /const selectedReminder = useMemo\([\s\S]*?rows\.find\([\s\S]*?bill\.id === selectedReminderId/);
const manualDetail = interactionBills.match(
  /\{selectedReminder && \([\s\S]*?(?=\n\s*<BottomSheet[\s\n]*visible=\{adderVisible\})/,
)?.[0] ?? '';
assert.ok(manualDetail.length > 0, 'manual reminder detail was not found');
assert.match(manualDetail, /<BillDetailSheet[\s\S]*?footer=\{\([\s\S]*?t\('markPaid'\)[\s\S]*?t\('delete'\)/);
assert.match(manualDetail, /const reminder = selectedReminder;[\s\S]*?setSelectedReminderId\(null\);[\s\S]*?onPay\(reminder\.bill\.id\)/);
assert.match(manualDetail, /const reminder = selectedReminder;[\s\S]*?setSelectedReminderId\(null\);[\s\S]*?onLongPressBill\(reminder\.bill\.id/);

const cardDetailSheet = code(read('src/components/card-detail-sheet.tsx'));
assert.match(cardDetailSheet, /footer\?: React\.ReactNode/);
assert.match(cardDetailSheet, /CardDetailSheet\(\{ account, onClose, footer \}/);
assert.match(cardDetailSheet, /<BottomSheet[^>]*footer=\{footer\}/);

const interactionCards = code(read('src/app/cards.tsx'));
assert.match(interactionCards, /type CardAction = 'visibility' \| 'bank' \| 'delete'/);
assert.doesNotMatch(interactionCards, /CardAction =[^\n]*'limit'|value: 'limit'|onPress=\{isCredit && limitLeft/);
const cardsDetail = interactionCards.match(
  /<CardDetailSheet[\s\S]*?(?=\n\s*<BottomSheet visible=\{limitFor)/,
)?.[0] ?? '';
assert.ok(cardsDetail.length > 0, 'Cards detail footer was not found');
assert.match(cardsDetail, /footer=\{detail \?/);
assert.match(cardsDetail, /label=\{t\('setCreditLimit'\)\}[\s\S]*?setDetail\(null\);[\s\S]*?askCreditLimit\(detail\)/);
assert.match(cardsDetail, /label=\{t\('manage'\)\}[\s\S]*?setDetail\(null\);[\s\S]*?setOptionsFor\(detail\)/);

const interactionWallet = code(read('src/app/(tabs)/wallet.tsx'));
assert.match(interactionWallet, /const openAccount = \(account: Account\)/);
const activeAccountRows=code(read('src/components/wallet/account-groups.tsx'));
assert.match(interactionWallet,/<AccountGroups[\s\S]*?onOpen=\{openAccount\}[\s\S]*?onManage=\{setOptionsFor\}/);
assert.match(activeAccountRows,/group\.rows\.map/);
assert.match(activeAccountRows,/accessibilityRole="button"/);
assert.match(activeAccountRows,/onPress=\{\(\) => onOpen\(row\.account\)\}/);
assert.match(activeAccountRows,/onPress=\{\(\) => onManage\(row\.account\)\}/);
assert.match(activeAccountRows,/accessibilityLabel=\{`\$\{row\.account\.name\}[\s\S]*?row\.figureFils/);
const inactiveAccountRows = interactionWallet.match(
  /inactiveAccounts\.map\([\s\S]*?(?=\n\s*<SectionHeader[\s\S]{0,80}goalsHeader)/,
)?.[0] ?? '';
assert.ok(inactiveAccountRows.length > 0, 'inactive Wallet source rows were not found');
assert.match(inactiveAccountRows, /accessibilityRole="button"/);
assert.match(inactiveAccountRows, /accessibilityLabel=\{`\$\{account\.name\}[\s\S]*?account\.archived \? t\('hidden'\) : t\('noActivity90'\)/);
assert.match(inactiveAccountRows, /onPress=\{\(\) => openAccount\(account\)\}/);
assert.match(inactiveAccountRows, /onLongPress=\{\(\) => setOptionsFor\(account\)\}/);
assert.match(interactionWallet, /accessibilityState=\{\{ expanded: showInactive \}\}/);
assert.doesNotMatch(interactionWallet, /longPressInactive/);

const task3Home = read('src/screens/ledger-home-screen.tsx');
assert.match(task3Home, /const homeHeader: ScreenHeaderProps = \{/);
assert.match(task3Home, /<ScreenScaffold[\s\S]*?tabbed[\s\S]*?header=\{homeHeader\}/);
assert.match(task3Home, /homeHeader[\s\S]*?searchMerchants[\s\S]*?settingsTitle/);
assert.match(task3Home, /function Hero[\s\S]*?<PeriodPill onPress=\{onChangePeriod\}/);
assert.match(task3Home, /<Hero[\s\S]*?onChangePeriod=\{\(\) => setPeriodSheetOpen\(true\)\}/);

const task3Transactions = read('src/app/transactions.tsx');
assert.match(task3Transactions, /useScreenContentInsets\(\{ hasFooter: false \}\)/);
assert.match(task3Transactions, /<ScreenScaffold[\s\S]*?scroll=\{false\}[\s\S]*?virtualized[\s\S]*?headerMode="native"/);
assert.match(task3Transactions, /header=\{\{[\s\S]*?back:[\s\S]*?actions:/);
assert.match(task3Transactions, /<SectionList[\s\S]*?ListHeaderComponent=/);
assert.match(task3Transactions, /contentContainerStyle=\{\[listInsets\.contentContainerStyle, styles\.listContent\]\}/);
assert.match(task3Transactions, /listContent: \{ gap: 0 \}/);
assert.match(task3Transactions, /contentInset=\{listInsets\.contentInset\}/);
assert.match(task3Transactions, /scrollIndicatorInsets=\{listInsets\.scrollIndicatorInsets\}/);
assert.match(task3Transactions, /contentInsetAdjustmentBehavior="automatic"/);
assert.match(task3Transactions, /<TextField[\s\S]*?label=\{tr\('transactionSearchLabel'\)\}[\s\S]*?accessibilityLabel=\{tr\('searchMerchants'\)\}/);
assert.match(task3Transactions, /<ActionIconButton[\s\S]*?label=\{tr\('clearSearch'\)\}[\s\S]*?variant="plain"/);
assert.match(task3Transactions, /const clearFilters[\s\S]*?setSmsOnly\(false\)/);

const task3Add = read('src/app/add-transaction.tsx');
assert.match(task3Add, /<ScreenScaffold[\s\S]*?keyboardAware[\s\S]*?headerMode="inline"/);
assert.match(task3Add, /scrollProps=\{\{ keyboardShouldPersistTaps: 'handled' \}\}/);
assert.match(task3Add, /footer=\{/);
assert.ok((task3Add.match(/<TextField/g) ?? []).length >= 2,
  'Manual Add keeps labelled amount/title fields while alert review avoids redundant editable fields');
assert.match(task3Add, /!reviewItem \? <TextField[\s\S]*?descriptionOptional/,
  'captured-alert review does not ask the user to rewrite a title Wafra already has');
assert.match(task3Add, /const focusFirstInvalid = \(\) => \{/);
assert.match(task3Add, /const onSavePress = \(\) => \{[\s\S]*?setShowValidation\(true\)[\s\S]*?focusFirstInvalid\(\)/);
assert.match(task3Add, /disabled=\{saving \|\| reviewRouteInvalid\}/);
assert.match(task3Add, /accessibilityRole="radiogroup"/);
assert.match(task3Add, /type WebGroupAriaProps = \{/);
assert.match(task3Add, /Platform\.OS === 'web' \? [a-zA-Z]+WebAriaProps : \{\}/);
assert.doesNotMatch(task3Add, /useKeyboardHeight/);

const task3Scaffold = read('src/components/ui/screen-scaffold.tsx');
assert.match(task3Scaffold, /useKeyboardHeight\(keyboardAware && Platform\.OS !== 'ios'\)/);
assert.match(task3Scaffold, /contentInset: \{ top, bottom:/);
assert.match(task3Scaffold, /keyboardAware && Platform\.OS !== 'ios'[\s\S]*?keyboardHeight/);
assert.match(task3Scaffold, /scrollIndicatorInsets:[\s\S]*?bottom:[\s\S]*?keyboardHeight/);

const task4Flow = read('src/app/(tabs)/flow.tsx');
assert.match(task4Flow, /const flowHeader: ScreenHeaderProps = \{/);
assert.match(task4Flow, /<ScreenScaffold[\s\S]*?tabbed[\s\S]*?headerMode="inline"[\s\S]*?header=\{flowHeader\}/);
assert.match(task4Flow, /summarizeMonth\(/);
assert.match(task4Flow, /spendingCategoryRows\(/);
assert.match(task4Flow, /router\.push\(`\/transactions\?type=expense&category=\$\{id\}`\)/);
assert.match(task4Flow, /<SpendingOverview/); assert.match(task4Flow, /<SpendingTrends/);
assert.match(task4Flow, /foreign\.transactions\.length > 0[\s\S]*?testID="foreign-spending-entry"[\s\S]*?router\.push\('\/currency'\)/);
assert.match(task4Flow, /live\.has\(tx\.accountId\) && !internal\.has\(tx\.id\) && inPeriod\(tx\.date, period\)/,
  'Foreign spending uses the same live-account and transfer exclusions as Spending totals');

const task4Stats = read('src/app/stats.tsx');
assert.match(task4Stats,/import \{ Redirect \} from 'expo-router'/);
assert.match(task4Stats,/<Redirect href="\/flow\?view=trends"/);

const task4DataVizPath = path.join(ROOT, 'src/components/ui/data-viz.ts');
assert.ok(fs.existsSync(task4DataVizPath), 'Task 4 data-viz helper exists');
const task4Charts = read('src/components/ui/charts.tsx');
assert.match(task4Charts, /import \{[^}]*\bDataViz\b[^}]*\} from '@\/constants\/theme'/);
assert.match(task4Charts, /from '@\/components\/ui\/data-viz'/);
assert.doesNotMatch(read('src/lib/categories.ts'), /CATEGORY_RAMP|rampColor|onRampColor/);
const overview=read('src/components/spending/spending-overview.tsx');
const trends=read('src/components/spending/spending-trends.tsx');
assert.match(overview,/accessibilityLabel=\{`\$\{categoryLabel[\s\S]*?row\.spentFils[\s\S]*?row\.limitFils/);
assert.match(overview,/function categoryPaletteIndex\(/,
  'Spending list gives tail categories a stable visible accent instead of the donut neutral');
assert.match(overview,/segmentColors\.get\(row\.category\) \?\?[\s\S]*?palette\[categoryPaletteIndex\(row\.category, palette\.length\)\]/,
  'categories collapsed into the share bar\'s Other segment still use readable categorical ink in the list');
assert.doesNotMatch(overview,/const sliceColor = (?:segmentColors|donutColors)\.get\(row\.category\) \?\? neutral/,
  'dark-mode tail rows must never reuse the near-background donut neutral');
assert.match(overview,/trackColor=\{scheme === 'dark' \? theme\.cardBorderStrong : theme\.track\}/,
  'thin category progress tracks keep enough dark-mode contrast');
assert.match(trends,/accessibilityLabel=\{monthDescription\(month\)\}/);
assert.match(trends,/accessibilityState=\{\{ selected: month\.key === p\.selectedKey \}\}/);
assert.match(trends,/accessibilityLiveRegion="polite"[\s\S]*?monthLabel\(selected\.key\)/);
assert.match(trends,/!showAllTrendLabels &&[\s\S]*?p\.months\.map/);
assert.match(trends,/backgroundColor: theme\.primary/);
assert.match(trends,/backgroundColor: theme\.expenseGraphic/);

const task5Bills = read('src/app/(tabs)/bills.tsx');
const task5Segments = read('src/components/bills/bills-segment-control.tsx');
assert.match(task5Bills, /const billsHeader: ScreenHeaderProps = \{/);
assert.match(task5Bills, /title: t\('billsTitle'\)[\s\S]*?label: t\('newReminder'\)[\s\S]*?icon: 'plus'/);
assert.match(task5Bills, /<ScreenScaffold[\s\S]*?tabbed[\s\S]*?headerMode="inline"[\s\S]*?header=\{billsHeader\}/);
assert.equal((task5Bills.match(/<ScrollView/g) ?? []).length, 0, 'Bills history shares the BottomSheet scroller');
// Charge history lives in the one shared bill detail sheet now.
const task5BillSheet = read('src/components/bill-detail-sheet.tsx');
assert.equal((task5BillSheet.match(/<ScrollView/g) ?? []).length, 0, 'bill history shares the BottomSheet scroller');
assert.match(task5BillSheet, /data\.txs\.slice\(0, 36\)/);
assert.match(task5BillSheet, /<MerchantSpendingLink merchant=\{subscription\.title\}/);
assert.match(task5BillSheet, /testID="subscription-history-scroll"/);
assert.match(task5Bills,/<BillsSegmentControl[\s\S]*?segment=\{agendaView\}[\s\S]*?onChange=\{setAgendaView\}/);
assert.match(task5Segments,/role="tablist"/);
assert.match(task5Segments,/accessibilityState=\{\{ selected:/);
assert.ok(Number(task5Segments.match(/segmentItem:\s*\{[\s\S]*?minHeight:\s*(\d+)/)?.[1])>=48);
assert.doesNotMatch(task5Segments,/numberOfLines/);
// Next 30 days / All, and the payment types as filters inside All.
for (const label of ['w.next30Days', 'w.allBills', 'w.everything', 'agenda.subscriptions', 'agenda.utilities', 'agenda.cards']) assert.ok(task5Segments.includes(label), label);
assert.equal((task5Bills.match(/<TextField/g) ?? []).length, 3, 'Bills reminder adder has exactly three shared fields');
assert.doesNotMatch(task5Bills, /<TextInput/);
assert.match(task5Bills, /<BottomSheet[^>]*visible=\{adderVisible\}[\s\S]*?footer=\{\([\s\S]*?<Button[\s\S]*?label=\{t\('saveReminder'\)\}[\s\S]*?disabled=\{!draftValid\}/);

const task6Wallet = read('src/app/(tabs)/wallet.tsx');
assert.match(task6Wallet, /const walletHeader: ScreenHeaderProps = \{/);
assert.match(task6Wallet, /title: t\('walletTitle'\)[\s\S]*?label: t\('settingsTitle'\)[\s\S]*?icon: 'sliders'[\s\S]*?label: t\('newAccount'\)[\s\S]*?icon: 'plus'/);
assert.match(task6Wallet, /<ScreenScaffold[\s\S]*?tabbed[\s\S]*?headerMode="inline"[\s\S]*?header=\{walletHeader\}/);
assert.match(task6Wallet, /const openAccount = \(account: Account\)[\s\S]*?router\.push\(`\/cards\?card=\$\{account\.id\}`\)[\s\S]*?router\.push\(`\/account\?id=\$\{encodeURIComponent\(account\.id\)\}`\)[\s\S]*?setOptionsFor\(account\)/);
assert.match(task6Wallet, /<AccountGroups[\s\S]*?onManage=\{setOptionsFor\}/);
assert.match(task6Wallet, /accessibilityLabel=\{inactiveDisclosureLabel\}[\s\S]{0,180}accessibilityState=\{\{ expanded: showInactive \}\}/);

const task6Balance = read('src/components/wallet/balance-overview.tsx');
const headlineAmount = task6Balance.match(
  /<View style=\{\[styles\.money[\s\S]*?(?=\n\s*\{p\.activeSourceCount === 0)/,
)?.[0] ?? '';
assert.ok(headlineAmount.length > 0, 'Wallet headline amount block was not found');
assert.doesNotMatch(headlineAmount, /numberOfLines=\{1\}|adjustsFontSizeToFit|minimumFontScale/);

const task6Cards = read('src/app/cards.tsx');
assert.match(task6Cards, /const cardsHeader: ScreenHeaderProps = \{/);
assert.match(task6Cards, /title: t\('cardsTitle'\)[\s\S]*?back: \{ label: t\('back'\), onPress: \(\) => router\.back\(\) \}/);
assert.match(task6Cards, /<ScreenScaffold[\s\S]*?headerMode="native"[\s\S]*?header=\{cardsHeader\}/);
assert.match(task6Cards, /useLocalSearchParams<\{ card\?: string \}>/);
assert.match(task6Cards, /useLargeTextLayout\(\)/);
assert.match(task6Cards, /numberOfLines=\{largeText \? undefined : 1\}/);
assert.match(task6Cards, /accessibilityLabel=\{inactiveDisclosureLabel\}[\s\S]{0,180}accessibilityState=\{\{ expanded: showInactive \}\}/);
assert.match(task6Cards, /disclosureAction: \{[\s\S]*?minWidth: 44[\s\S]*?minHeight: 44[\s\S]*?androidDisclosureAction: \{ minWidth: 48, minHeight: 48 \}/);
assert.match(task6Cards, /label=\{t\('setCreditLimit'\)\}[\s\S]*?askCreditLimit\(detail\)[\s\S]*?label=\{t\('manage'\)\}/);

const task6CardDetail = read('src/components/card-detail-sheet.tsx');
assert.equal(
  (task6CardDetail.match(/cardStatementView\(state, account\.id\)/g) ?? []).length,
  1,
  'Card detail keeps one cardStatementView calculation call',
);
assert.doesNotMatch(task6CardDetail, /openDues\(|duePaidFils|state\.cardDues/);
const billableDetailStart = task6CardDetail.indexOf('{data.billable && (');
const billableDetailEnd = task6CardDetail.lastIndexOf('</BottomSheet>');
const billableDetail = billableDetailStart >= 0 && billableDetailEnd > billableDetailStart
  ? task6CardDetail.slice(billableDetailStart, billableDetailEnd)
  : '';
assert.ok(billableDetail.length > 0, 'billable CardDetail presentation block was not found');
for (const [before, after] of [
  ['styles.summary', "title={t('statements')}"],
  ["title={t('statements')}", 'styles.head'],
  ['styles.head', "title={t('paymentsMade')}"],
]) {
  assert.ok(
    billableDetail.indexOf(before) >= 0 && billableDetail.indexOf(before) < billableDetail.indexOf(after),
    `CardDetail order keeps ${before} before ${after}`,
  );
}
assert.match(task6CardDetail, /!data\.billable && \([\s\S]*?styles\.head[\s\S]*?debitHasNoStatement/);
assert.doesNotMatch(task6CardDetail, /type="subtitle" numberOfLines=\{1\}/);
assert.match(task6CardDetail, /<BottomSheet[^>]*footer=\{footer\}/);

const task7Settings = code(read('src/app/settings.tsx'));
// Data and help: exports, backup, the clean-ups, public links and Erase.
const task7SettingsData = code(read('src/app/settings-data.tsx'));
const task7Pro = code(read('src/app/pro.tsx'));
const task7I18n = read('src/lib/i18n.ts');
const task7PublicLinksPath = path.join(ROOT, 'src/lib/public-links.ts');

assert.match(task7Settings, /const settingsHeader: ScreenHeaderProps = \{[\s\S]*?title: t\('settingsTitle'\)[\s\S]*?back: \{ label: t\('back'\), onPress: \(\) => router\.back\(\) \}/);
assert.match(task7Settings, /<ScreenScaffold[\s\S]*?headerMode="native"[\s\S]*?header=\{settingsHeader\}/);
assert.match(task7Pro, /const proHeader: ScreenHeaderProps = \{[\s\S]*?title: t\('wafraPro'\)[\s\S]*?back: \{ label: t\('back'\), onPress: \(\) => router\.back\(\) \}/);
assert.match(task7Pro, /<ScreenScaffold[\s\S]*?headerMode="native"[\s\S]*?header=\{proHeader\}/);
assert.doesNotMatch(task7Pro, /footer=\{purchaseFooter\}/);
assert.match(task7Pro, /<View style=\{styles\.actions\}>[\s\S]*?<View style=\{\[styles\.legalLinks/);

const settingsRenderStart = task7Settings.indexOf('<React.Fragment>');
assert.ok(settingsRenderStart >= 0, 'Settings route-owned Fragment was not found');
const settingsRender = task7Settings.slice(settingsRenderStart);
assert.equal((settingsRender.match(/<Section index=\{/g) ?? []).length, 7, 'Settings renders exactly seven compact groups');
const settingsGroupMarkers = [
  'testID="settings-pro-card"',
  "<SectionHeader title={t('settingsImportsHeader')} />",
  "<SectionHeader title={t('settingsNotificationsHeader')} />",
  "<SectionHeader title={t('settingsPreferencesHeader')} />",
  '<SectionHeader title={copy.countryAndCurrency} />',
  '<SectionHeader title={copy.privacyAndSecurity} />',
  "router.push('/settings-data')",
];
let previousSettingsGroup = -1;
for (const marker of settingsGroupMarkers) {
  const next = settingsRender.indexOf(marker);
  assert.ok(next > previousSettingsGroup, `Settings group order lost ${marker}`);
  previousSettingsGroup = next;
}
const settingsDataRender = task7SettingsData.slice(task7SettingsData.indexOf('<React.Fragment>'));
assert.equal((settingsDataRender.match(/<Section index=\{/g) ?? []).length, 5, 'Data and help renders five groups');
let previousDataGroup = -1;
for (const marker of [
  '<SectionHeader title={copy.yourData} />',
  '<SectionHeader title={copy.helpImprove} />',
  '<SectionHeader title={copy.advanced} />',
  '<SectionHeader title={copy.about} />',
  "<SectionHeader title={t('settingsDangerHeader')} />",
]) {
  const next = settingsDataRender.indexOf(marker);
  assert.ok(next > previousDataGroup, `Data and help group order lost ${marker}`);
  previousDataGroup = next;
}
assert.doesNotMatch(task7Settings, /StatusFacts|settingsStatusHeader/);
assert.match(task7Settings, /from '@\/components\/ui\/section-header'/);
assert.doesNotMatch(task7Settings, /from '@\/components\/ui\/segmented-control'/);
assert.match(task7Settings, /visible=\{preferenceSheet === 'appearance'\}[\s\S]*?onSelect=\{setThemePreference\}/);
assert.doesNotMatch(task7Settings, /<Segmented\b|SectionHeader.*from '@\/components\/ui\/layout'/);

for (const [key, en, ar] of [
  ['settingsImportsHeader', 'Capture', 'الالتقاط'],
  ['settingsNotificationsHeader', 'Notifications', 'الإشعارات'],
  ['settingsPreferencesHeader', 'Appearance', 'المظهر'],
  ['settingsDangerHeader', 'Danger zone', 'منطقة الخطر'],
  ['supportWebsite', 'Support', 'الدعم'],
  ['publicLinkUnavailable', 'Unavailable in this build', 'غير متاح في هذا الإصدار'],
]) {
  assert.ok(
    task7I18n.includes(`${key}: { en: '${en}', ar: '${ar}' }`),
    `Task 7 bilingual key ${key} is missing or changed`,
  );
}

assert.ok(fs.existsSync(task7PublicLinksPath), 'Task 7 public-links helper exists');
const task7PublicLinks = fs.existsSync(task7PublicLinksPath) ? read('src/lib/public-links.ts') : '';
assert.match(task7PublicLinks, /export type PublicLinkKey = 'privacyPolicyUrl' \| 'termsOfUseUrl' \| 'supportUrl'/);
assert.match(task7PublicLinks, /export const configuredPublicUrl = \(key: PublicLinkKey\): string \| null => \{/);
assert.match(task7PublicLinks, /const extra = Constants\.expoConfig\?\.extra as Record<string, unknown> \| undefined/);
assert.match(task7PublicLinks, /const value = extra\?\.\[key\]/);
assert.match(task7PublicLinks, /const url = new URL\(value\)/);
assert.match(task7PublicLinks, /return url\.protocol === 'https:' \? url\.toString\(\) : null/);

for (const screen of [task7SettingsData, task7Pro]) {
  assert.match(screen, /import \{ configuredPublicUrl \} from '@\/lib\/public-links'/);
  assert.match(screen, /configuredPublicUrl\('privacyPolicyUrl'\)/);
  assert.match(screen, /configuredPublicUrl\('termsOfUseUrl'\)/);
}
assert.match(task7SettingsData, /configuredPublicUrl\('supportUrl'\)/);
const settingsPublicRows = task7SettingsData.match(
  /const publicLinkRow[\s\S]*?(?=\n  return \()/,
)?.[0] ?? '';
assert.ok(settingsPublicRows.length > 0, 'Settings public-link row helper was not found');
assert.match(settingsPublicRows, /if \(url\) return linkRow\(title, null, \(\) => void openPublicLink\(url\)/);
const unavailableSettingsPublicRow = settingsPublicRows.match(
  /return \(\s*(<Row last=\{last\}>[\s\S]*?<\/Row>)\s*\);/,
)?.[1] ?? '';
assert.match(unavailableSettingsPublicRow, /<Icon name="alert"/);
assert.match(unavailableSettingsPublicRow, /t\('publicLinkUnavailable'\)/);
assert.doesNotMatch(unavailableSettingsPublicRow, /onPress|chevron/);
for (const row of [
  "publicLinkRow(t('privacyPolicy'), privacyPolicyUrl)",
  "publicLinkRow(t('termsOfUse'), termsOfUseUrl)",
  "publicLinkRow(t('supportWebsite'), supportUrl, true)",
]) assert.ok(settingsDataRender.includes(row), `Data and help does not always render ${row}`);
assert.match(task7SettingsData, /publicLinkNotice && \([\s\S]*?accessibilityRole="alert"[\s\S]*?accessibilityLiveRegion="polite"[\s\S]*?legalLinkFailed[\s\S]*?legalLinkFailedBody/);

const proPublicRows = task7Pro.match(
  /const publicLinkRow[\s\S]*?\n  \};/,
)?.[0] ?? '';
assert.ok(proPublicRows.length > 0, 'Pro public-link row helper was not found');
assert.match(proPublicRows, /if \(url\) return \([\s\S]*?<Pressable[\s\S]*?accessibilityRole="link"[\s\S]*?openLegal\(url\)/);
const unavailableProPublicRow = proPublicRows.match(
  /return \(\s*(<Row last=\{last\}>[\s\S]*?<\/Row>)\s*\);/,
)?.[1] ?? '';
assert.match(unavailableProPublicRow, /<Icon name="alert"/);
assert.match(unavailableProPublicRow, /t\('publicLinkUnavailable'\)/);
assert.doesNotMatch(unavailableProPublicRow, /onPress|chevron/);
assert.match(task7Pro, /publicLinkRow\(t\('privacyPolicy'\), privacyPolicyUrl\)[\s\S]*publicLinkRow\(t\('termsOfUse'\), termsOfUseUrl, true\)/);

for (const seam of [
  'useWafraBilling(', 'billing.purchasePro(', 'billing.restorePro(',
  'subscriptionManagementUrl(', 'legalReady',
]) assert.ok(task7Pro.includes(seam), `Pro lost ${seam}`);
assert.match(task7Pro, /notice && \([\s\S]*?accessibilityLiveRegion="polite"/);
assert.match(task7Pro, /if \(!legalReady\)[\s\S]*?purchaseLegalMissingBody/);
assert.match(task7Pro, /entitled \? \([\s\S]*?manageSubscription[\s\S]*?proContinue[\s\S]*?: \([\s\S]*?buySelectedPlan\(\)[\s\S]*?restorePurchase/);

const task8Routes = [
  ['accuracy', 'accuracyHeader'],
  ['categorise', 'categoriseHeader'],
  ['currency', 'currencyHeader'],
  ['feedback', 'feedbackHeader'],
  ['review-alerts', 'reviewAlertsHeader'],
  ['trusted-devices', 'trustedDevicesHeader'],
];
for (const [route, header] of task8Routes) {
  const source = read(`src/app/${route}.tsx`);
  assert.match(source, new RegExp(`const ${header}: ScreenHeaderProps = \\{[\\s\\S]*?back: \\{ label: [\\s\\S]*?onPress: \\(\\) => router\\.back\\(\\) \\}`));
  assert.match(source, new RegExp(`<ScreenScaffold[\\s\\S]*?headerMode="native"[\\s\\S]*?header=\\{${header}\\}`), `${route} lacks its native ScreenScaffold header`);
}

const task8Accuracy = read('src/app/accuracy.tsx');
for (const seam of [
  'unreadFormats(', 'noFormatsReason({', 'maskDigits(', "section(t('accuracyShareUnread'), unread)",
  'Share.share({', 'cardDiagnostics(state)', "shareText('wafra-card-diagnostic.txt'",
  "router.push('/categorise')",
]) assert.ok(task8Accuracy.includes(seam), `Accuracy lost ${seam}`);
assert.doesNotMatch(task8Accuracy, /accuracyShareUncategorized/);

const task8Categorise = read('src/app/categorise.tsx');
// Every row is open with one suggestion; answers are staged and written
// together by "Save N answers" (redesign), never on the first tap.
assert.match(task8Categorise, /const \[answers, setAnswers\] = useState<Record<string, CategoryId>>\(\{\}\)/);
assert.match(task8Categorise, /const \[pickerId, setPickerId\] = useState<string \| null>\(null\)/);
assert.match(task8Categorise, /const \[sortedRows, setSortedRows\] = useState\(0\)/);
assert.match(task8Categorise, /const save = \(\) => \{[\s\S]*?for \(const item of staged\)[\s\S]*?moved \+= item\.count/);
assert.match(task8Categorise, /useCategorySuggestions\(\{/);
assert.match(task8Categorise, /setMerchantOverride\(item\.merchant, category, true\)/);
assert.match(task8Categorise, /setBillAlias\(item\.sourceTitle, item\.billIdentity, item\.sourceTitle, category, true\)/);
assert.match(task8Categorise, /INITIAL_VISIBLE_ITEMS = 12/);
assert.match(task8Categorise, /summary\.paymentPurposes[\s\S]*?kind: 'payment-purpose'/);
for (const count of ['summary.rowCount', 'item.count', 'sortedRows']) {
  assert.ok(task8Categorise.includes(count), `Categorise lost ${count}`);
}

const task8Currency = read('src/app/currency.tsx');
for (const seam of [
  'summarizeForeignActivity(', 'inPeriod(transaction.date, period)', 'ledgerCurrency,',
  'visibleGroups', 'visibleTransactions', 'normalizedQuery', 'liveAccountIds(', 'internalTransferIdsForState(',
  '<PeriodSheet', '<EntryDetailSheet', '<MerchantAvatar', '<Money',
]) assert.ok(task8Currency.includes(seam), `Currency lost ${seam}`);
assert.match(task8Currency, /<ScreenScaffold[\s\S]*?scroll=\{false\}[\s\S]*?virtualized[\s\S]*?headerMode="native"/,
  'Foreign spending virtualizes its transaction history instead of mounting the whole ledger in a ScrollView');
assert.match(task8Currency, /<FlatList[\s\S]*?ListHeaderComponent=\{listHeader\}/);
assert.match(task8Currency, /contentContainerStyle=\{\[listInsets\.contentContainerStyle, styles\.listContent\]\}/);
assert.match(task8Currency, /removeClippedSubviews=\{Platform\.OS === 'android'\}/);
assert.doesNotMatch(task8Currency, /visibleTransactions\.map|summary\.transactions\.map/,
  'hundreds of foreign charges must not be mounted eagerly');
assert.match(task8Currency, /const INITIAL_CURRENCY_ROWS = 5/);
assert.match(task8Currency, /summary\.groups\.slice\(0, INITIAL_CURRENCY_ROWS\)/);
assert.match(task8Currency, /const percent = summary\.totalLocalFils > 0[\s\S]*?group\.localFils \/ summary\.totalLocalFils/);
assert.match(task8Currency, /styles\.currencyTrack[\s\S]*?styles\.currencyFill/,
  'currency impact stays a restrained Ledger & Light progress treatment rather than decorative cards');
assert.match(task8Currency, /setSelectedCurrency\(\(current\) => current === currency \? null : currency\)/);
assert.match(task8Currency, /transaction\.originalCurrency\?\.toUpperCase\(\) !== selectedCurrency/);
const currencyHierarchy = task8Currency.match(
  /<Money[\s\S]*?<SectionHeader title=\{t\('currencyBreakdown'[\s\S]*?<SectionHeader title=\{t\('foreignRecent'[\s\S]*?<TextField/,
)?.[0] ?? '';
assert.ok(currencyHierarchy.length > 0,
  'Currency hierarchy remains total → currencies → transactions/search');
assert.match(task8Currency, /const showSearch = chargeCount >= 12/);
assert.match(task8Currency, /<TextField[\s\S]*?label=\{t\('searchForeignSpending', language\)\}[\s\S]*?value=\{query\}[\s\S]*?onChangeText=\{setQuery\}/);
assert.match(task8Currency, /leading=\{<Icon name="search"/);
assert.match(task8Currency, /originalMoneyOf\(item\)[\s\S]*?formatOriginalCurrency\(originalMoney\.minorUnits[\s\S]*?formatAED\(item\.amountFils/,
  'Foreign rows keep original and ledger amounts together');
assert.doesNotMatch(task8Currency, /FadeInDown|Animated\.View/,
  'data-heavy foreign spending should not delay Android readability with entrance animation');
assert.doesNotMatch(task8Currency, /conversionQuality|bankQuoted|referenceRate|offlineEstimate/,
  'Foreign spending should not expose FX diagnostics as a primary page section');

const task8Feedback = read('src/app/feedback.tsx');
assert.match(task8Feedback, /<ScreenScaffold[\s\S]*?keyboardAware[\s\S]*?headerMode="native"[\s\S]*?header=\{feedbackHeader\}/);
assert.match(task8Feedback, /scrollProps=\{\{ keyboardShouldPersistTaps: 'handled'/);
assert.match(task8Feedback, /<TextField[\s\S]*?label=\{t\('feedbackInputA11y'\)\}[\s\S]*?value=\{message\}[\s\S]*?multiline[\s\S]*?maxLength=\{FEEDBACK_MESSAGE_MAX\}/);
for (const seam of [
  'scrubFeedbackMessage(message)', 'buildFeedbackPayload({', 'formatFeedbackPayload(payload)',
  'submitFeedback(payload)', 'setMessage(\'\')', '<ConfirmSheet',
]) assert.ok(task8Feedback.includes(seam), `Feedback lost ${seam}`);
assert.match(task8Feedback, /isParserResearchBuild\(\)[\s\S]{0,500}router\.push\('\/parser-research' as Href\)/);
assert.match(task8Feedback, /fontFamily: Fonts\.mono[\s\S]*?textAlign: 'left'[\s\S]*?writingDirection: 'ltr'/);

const task8Review = read('src/app/review-alerts.tsx');
assert.match(task8Review, /useScreenContentInsets\(\{ hasFooter: false \}\)/);
assert.match(task8Review, /<ScreenScaffold[\s\S]*?scroll=\{false\}[\s\S]*?virtualized[\s\S]*?headerMode="native"[\s\S]*?header=\{reviewAlertsHeader\}/);
assert.match(task8Review, /<FlatList[\s\S]*?contentContainerStyle=\{\[listInsets\.contentContainerStyle,[\s\S]*?contentInset=\{listInsets\.contentInset\}[\s\S]*?scrollIndicatorInsets=\{listInsets\.scrollIndicatorInsets\}[\s\S]*?contentInsetAdjustmentBehavior="automatic"/);
assert.match(task8Review, /item\.expiresAt > now/);
assert.match(task8Review, /minorUnits\.padStart\(exponent \+ 1, '0'\)/);
assert.match(task8Review, /pathname: '\/add-transaction', params: \{ reviewId: item\.id \}/);
assert.match(task8Review, /dismissReviewAlert\(item\.id, 'dismissed'\)/);
assert.match(task8Review, /<ConfirmSheet[\s\S]*?destructive/);

const task8Trusted = read('src/app/trusted-devices.tsx');
assert.match(task8Trusted, /useLocalSearchParams<\{ relay\?: string; invite\?: string \}>\(\)/);
for (const seam of [
  'parseTrustedDeviceInvite(', 'createTrustedDeviceInvite(', 'joinTrustedVault(',
  'renameTrustedDevice(', 'revokeTrustedDevice(', 'deleteTrustedVault(',
  'trustedDeviceInviteLink(', 'openShortcutsApp', 'shortcutCleanupApplies(',
]) assert.ok(task8Trusted.includes(seam), `Trusted Devices lost ${seam}`);
assert.equal((task8Trusted.match(/<TextField/g) ?? []).length, 3, 'Trusted Devices keeps its three labelled security-sensitive sheet inputs');
assert.equal((task8Trusted.match(/<BottomSheet/g) ?? []).length, 2, 'Trusted Devices keeps both stateful sheets');
assert.ok((task8Trusted.match(/<ConfirmSheet/g) ?? []).length >= 3, 'Trusted Devices keeps removal, vault, and recovery confirmations');

console.log('✓ core screen preservation baseline');
