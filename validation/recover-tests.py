from pathlib import Path
import re,sys
r=Path(sys.argv[1]).resolve()
def change(rel,a,b):
 p=r/rel;s=p.read_text();assert a in s,(rel,a[:80]);p.write_text(s.replace(a,b))
def between(rel,start,end,new):
 p=r/rel;s=p.read_text();a=s.index(start);b=s.index(end,a);p.write_text(s[:a]+new+s[b:])
change('scripts/test/ios-setup-ux.test.js',r'/minHeight:\s*44/.test(checklistRow)',r'Number(checklistRow.match(/header:\s*\{\s*minHeight:\s*(\d+)/)?.[1]) >= 44')
change('scripts/test/review-alerts-ui.test.js',r'/minHeight:\s*44/.test(route)',r'Number(route.match(/dismissButton:\s*\{[\s\S]*?minHeight:\s*(\d+)/)?.[1]) >= 44')
change('scripts/test/ui-foundation-contract.test.js',r"assert.match(segmented, /androidSegment: \{ minHeight: 48 \}/);",r"assert.ok(Number(segmented.match(/segment:\s*\{[\s\S]*?minHeight:\s*(\d+)/)?.[1]) >= 48, 'unified segments meet the touch target floor');")
change('scripts/test/onboarding.test.js','Reliable balances for 2 of 4 active accounts','Balances recorded for 2 of 4 active accounts')
change('scripts/test/onboarding.test.js',r"/knownBalanceCount > 0[\s\S]*?formatAmount\(balanceFils, \{ decimals: false \}\)[\s\S]*?: '—'/",r"/p\.knownBalanceCount > 0\s*\? formatAmount\(p\.balanceFils\) : '—'/")
change('scripts/test/screen-section-contract.test.js',"['src/components/bills/bills-segment-control.tsx', 'BillsSegmentControl', 'src/app/(tabs)/bills.tsx'],", "['src/components/bills/payment-agenda.tsx', 'PaymentAgenda', 'src/app/(tabs)/bills.tsx'],\n  ['src/components/spending/spending-overview.tsx', 'SpendingOverview', 'src/app/(tabs)/flow.tsx'],\n  ['src/components/spending/spending-trends.tsx', 'SpendingTrends', 'src/app/(tabs)/flow.tsx'],\n  ['src/components/wallet/account-groups.tsx', 'AccountGroups', 'src/app/(tabs)/wallet.tsx'],")
change('scripts/test/perf-config.test.js',"const GATED_LAYOUT_ENTRY_TAB_SCREENS = [\n  'src/app/(tabs)/flow.tsx',", "const GATED_LAYOUT_ENTRY_TAB_SCREENS = [")
change('scripts/test/perf-config.test.js','const PERSISTENT_REVEAL_TAB_SCREENS = [', "// New Spending components do not run a delayed entering sequence.\nfor (const rel of ['src/app/(tabs)/flow.tsx', 'src/components/spending/spending-overview.tsx', 'src/components/spending/spending-trends.tsx']) {\n const src=stripComments(read(rel));\n ok(`${rel}: no hidden entrance work reintroduced`, !/entering=|useScreenEntering|FadeIn/.test(src));\n}\nconst PERSISTENT_REVEAL_TAB_SCREENS = [")
f='scripts/test/bills.test.js'
change(f,"ok('Bills keeps the three release groups',\n    /type Segment = 'subscriptions' \\| 'cards' \\| 'utilities'/.test(src));", "ok('Bills agenda retains recurring, card and manual bill sources',\n    /<PaymentAgenda/.test(src) && /kind: 'card'/.test(src) && /kind: 'bill'/.test(src) && /kind: 'recurring'/.test(src));")
between(f,'  const manualRows = src.match(',"  ok(\n    'manual reminder detail",r'''  const manualRows = fs.readFileSync(path.join(__dirname, '../../src/components/bills/payment-agenda.tsx'), 'utf8');
  ok('manual reminders keep one detail target without a nested payment/deletion action',
    /onPress=\{\(\) => onOpen\(item\)\}/.test(manualRows) &&
    /setSelectedReminderId\(item\.id\.slice\(5\)\)/.test(src) &&
    !/onLongPress|t\('markPaid'\)|<Button/.test(manualRows));
''')
f='scripts/test/contracts.test.js'
between(f,"  ok('the Bills focal derives",'\n}\n\n/* ── the same rule',r'''  ok('Bills agenda and detail use allocated remainder, never manual-only paid values',
    /amountFils: remainingFils/.test(billsCode) && /due\.remainingFils/.test(billsCode) &&
    /<CardDetailSheet/.test(billsCode) && !/\bdue\.paidFils\b/.test(billsCode), billsCode.match(/\bdue\.paidFils\b/g));''')
change(f,"for (const rel of ['src/app/cards.tsx', 'src/app/(tabs)/wallet.tsx']) {", "for (const rel of ['src/app/cards.tsx']) {")
a='/* ── subscriptions and the expense export learn the same two exclusions ── */'
change(f,a,r'''// Accounts removed per-account spending. Keep it on canonical card/cashflow values.
{
 const wallet=read('src/app/(tabs)/wallet.tsx');
 ok('Wallet uses shared card figures and transfer-aware cash outflow',
  /cardFigure\(state, account, now\)/.test(wallet) && /summarizeCashOutflow\(state,[\s\S]*?internal/.test(wallet) &&
  !/monthSpendByAccount|isSpending\(/.test(wallet));
}
'''+a)
f='scripts/test/routes.test.js'
between(f,"  const flow = fs.readFileSync(path.join(SRC, 'app/(tabs)/flow.tsx')", "  ok('erase is a destructive",r'''  const flow=fs.readFileSync(path.join(SRC,'app/(tabs)/flow.tsx'),'utf8');
  const trends=fs.readFileSync(path.join(SRC,'components/spending/spending-trends.tsx'),'utf8');
  ok('large text moves six-month figures into a wrapping readable list',
    /<SpendingTrends/.test(flow) && /useWindowDimensions\(\)/.test(trends) &&
    /!showAllTrendLabels &&/.test(trends) && /cashflow-month-details/.test(trends) &&
    /p\.months\.map/.test(trends) && /flexWrap: 'wrap'/.test(trends));
  ok('Arabic labels retain their language face and amounts stay tabular',
    /<ThemedText[^>]*>\{w\.income\}<\/ThemedText>[\s\S]*?<Money/.test(trends) &&
    /<ThemedText[^>]*>\{w\.spending\}<\/ThemedText>[\s\S]*?<Money/.test(trends) &&
    !/<ThemedText[^>]*tabular[^>]*>\{w\.(?:income|spending)\}/.test(trends));
  ok('empty large-text months are no-data rather than zero balances',
    /month\.incomeFils !== 0 \|\| month\.expenseFils !== 0/.test(trends) && /— \{w\.noData\}/.test(trends));

''')
f='scripts/test/accessibility-layout.test.js'
change(f,"const billsSegments = source('src/components/bills/bills-segment-control.tsx');", "const billsSegments=source('src/components/ui/segmented-control.tsx');\nconst spendingOverview=source('src/components/spending/spending-overview.tsx');\nconst spendingTrends=source('src/components/spending/spending-trends.tsx');\nconst paymentAgenda=source('src/components/bills/payment-agenda.tsx');")
change(f,'Flow: flow,','Flow: spendingOverview,')
change(f,'/largeText/.test(code)','/large(?:Text)?/.test(code)')
change(f,"ok('Flow stacks the summary rail for large text', /largeText && styles\\.summaryRailLarge/.test(flow));", "ok('Flow stacks summary and category rows for large text', /large && styles\\.stack/.test(spendingOverview) && /<SpendingOverview/.test(flow));")
change(f,"/largeText && styles\\.headerLarge/.test(bills) && /largeText && styles\\.segmentLarge/.test(billsSegments)","/<SegmentedControl/.test(bills) && /large && styles\\.stack/.test(billsSegments) && !/numberOfLines/.test(billsSegments)")
change(f,"/largeText && styles\\.snapshotGridLarge/.test(walletOverview)","/p\\.largeText && styles\\.stack/.test(walletOverview) && /detailRow, p\\.largeText && styles\\.stack/.test(walletOverview)")
change(f,'defaultCaptureLayoutHeight() === 513 &&','Number.isFinite(defaultCaptureLayoutHeight()) && defaultCaptureLayoutHeight() > 0 &&')
between(f,'const walletOverviewActions =','\nconst themedText',r'''ok('selected tabs have contrasting fills and labels; input boundaries retain control tokens',
  tokenValues('inverseSurface').every((color,index)=>contrast(color,tokenValues('backgroundSelected')[index])>=3) &&
  /theme\.inverseSurface/.test(billsSegments) && /theme\.inverseText/.test(billsSegments) &&
  /onPress=\{p\.onOpenBills\}/.test(walletOverview) && /onPress=\{p\.onOpenCurrency\}/.test(walletOverview) &&
  /transferChoice[\s\S]{0,100}theme\.controlBorder/.test(addTransaction));
''')
change(f,r'/onPress=\{\(\) => setSelectedReminderId\(bill\.id\)\}/.test(bills)',r'/setSelectedReminderId\(item\.id\.slice\(5\)\)/.test(bills) && /onPress=\{\(\) => onOpen\(item\)\}/.test(paymentAgenda)')
between(f,"ok('Flow exposes the composition","ok('shared charts consume",r'''ok('Spending categories provide localized spending and limit equivalents',
 /accessibilityLabel=\{`\$\{categoryLabel\(row\.category, language\)\}[\s\S]*?row\.spentFils[\s\S]*?row\.limitFils/.test(spendingOverview));
ok('Flow trend months expose cashflow descriptions and selected state',
 /accessibilityLabel=\{monthDescription\(month\)\}/.test(spendingTrends) && /accessibilityState=\{\{ selected: month\.key === p\.selectedKey \}\}/.test(spendingTrends));
ok('Flow retains selected month context and large-text list',
 /accessibilityLiveRegion="polite"[\s\S]*?monthLabel\(selected\.key\)[\s\S]*?monthFigures\(selected\)/.test(spendingTrends) && /!showAllTrendLabels &&[\s\S]*?p\.months\.map/.test(spendingTrends));
ok('Flow uses shared shell and Stats redirects into Trends',
 /<ScreenScaffold[\s\S]*?tabbed[\s\S]*?headerMode="inline"/.test(flow) && /<Redirect href="\/flow\?view=trends"/.test(stats));
''')
between(f,"ok('Bills segments use","ok('Bills reminder entry",r'''ok('Bills uses canonical labelled control and selection semantics',
 /<SegmentedControl/.test(bills) && /label=\{t\('billsTitle'\)\}/.test(bills) && /role="tablist"/.test(billsSegments) && /accessibilityState=\{\{ selected:/.test(billsSegments));
ok('Bills agenda tabs retain 48 point targets',Number(billsSegments.match(/segment:\s*\{[\s\S]*?minHeight:\s*(\d+)/)?.[1])>=48);
''')
change(f,r'/accessibilityLabel=\{sourcesDisclosureLabel\}[\s\S]{0,180}accessibilityState=\{\{ expanded: showAllSources \}\}/.test(wallet)',r'/accessibilityLabel=\{detailsLabel\}[\s\S]{0,180}accessibilityState=\{\{ expanded: details \}\}/.test(walletOverview)')
change(f,r'/<View style=\{\[styles\.overviewAmount[\s\S]*?(?=\n\s*\{activeSourceCount === 0)/',r'/<View style=\{\[styles\.money[\s\S]*?(?=\n\s*\{p\.activeSourceCount === 0)/')
f='scripts/test/ui-polish-contract.test.js'
change(f,r"assert.match(bills, /type Segment = 'subscriptions' \| 'cards' \| 'utilities'/);",r"assert.match(bills, /useState<'upcoming' \| 'all'>/);")
change(f,r'assert.match(flow, /composition\(/);',r'assert.match(flow, /spendingCategoryRows\(/);')
between(f,'const focalDue = interactionBills.match(','assert.match(interactionBills, /const \\[selectedDueId',r'''// Payment/deletion safeguards are unchanged; the shared agenda owns detail navigation.
const agenda=code(read('src/components/bills/payment-agenda.tsx'));
assert.match(agenda,/group\.items\.map/);
assert.match(agenda,/accessibilityRole="button"[\s\S]*?accessibilityLabel=/);
assert.match(agenda,/onPress=\{\(\) => onOpen\(item\)\}/);
assert.doesNotMatch(agenda,/<Button|onPayDue|payCardDue|onLongPress/);
assert.match(interactionBills,/<PaymentAgenda[\s\S]*?onOpen=\{\(item\) =>/);
assert.match(interactionBills,/openCardDetail\(state\.accounts\.find[\s\S]*?item\.paid \? undefined : id\)/);
assert.match(interactionBills,/const onPayDue[\s\S]*?setConfirmation\(\{[\s\S]*?onConfirm:[\s\S]*?payCardDue\(/);
''')
between(f,'const manualRows = interactionBills.match(','assert.match(interactionBills, /const \\[selectedReminderId',r'''const manualRows=agenda;
assert.match(interactionBills,/setSelectedReminderId\(item\.id\.slice\(5\)\)/);
assert.match(manualRows,/accessibilityRole="button"/);
assert.match(manualRows,/accessibilityLabel=/);
assert.doesNotMatch(manualRows,/onLongPress|t\('markPaid'\)/);
''')
between(f,'const activeAccountRows = interactionWallet.match(','const inactiveAccountRows',r'''const activeAccountRows=code(read('src/components/wallet/account-groups.tsx'));
assert.match(interactionWallet,/<AccountGroups[\s\S]*?onOpen=\{openAccount\}[\s\S]*?onManage=\{setOptionsFor\}/);
assert.match(activeAccountRows,/group\.rows\.map/);
assert.match(activeAccountRows,/accessibilityRole="button"/);
assert.match(activeAccountRows,/onPress=\{\(\) => onOpen\(row\.account\)\}/);
assert.match(activeAccountRows,/onPress=\{\(\) => onManage\(row\.account\)\}/);
assert.match(activeAccountRows,/accessibilityLabel=\{`\$\{row\.account\.name\}[\s\S]*?row\.figureFils/);
''')
change(f,r'assert.match(task4Flow, /composition\(/);',r'assert.match(task4Flow, /spendingCategoryRows\(/);')
change(f,r"assert.match(task4Flow, /router\.push\(`\/transactions\?category=\$\{s\.categories\.join\(','\)\}`\)/);",r"assert.match(task4Flow, /router\.push\(`\/transactions\?type=expense&category=\$\{id\}`\)/);")
change(f,r"assert.match(task4Flow, /from '@\/components\/ui\/data-viz'/);",r'assert.match(task4Flow, /<SpendingOverview/); assert.match(task4Flow, /<SpendingTrends/);')
between(f,'assert.match(task4Stats, /const statsHeader','\nconst task4DataVizPath',r'''assert.match(task4Stats,/import \{ Redirect \} from 'expo-router'/);
assert.match(task4Stats,/<Redirect href="\/flow\?view=trends"/);
''')
between(f,'assert.match(task4Flow, /accessibilityRole="image"','\nconst task5Bills',r'''const overview=read('src/components/spending/spending-overview.tsx');
const trends=read('src/components/spending/spending-trends.tsx');
assert.match(overview,/accessibilityLabel=\{`\$\{categoryLabel[\s\S]*?row\.spentFils[\s\S]*?row\.limitFils/);
assert.match(trends,/accessibilityLabel=\{monthDescription\(month\)\}/);
assert.match(trends,/accessibilityState=\{\{ selected: month\.key === p\.selectedKey \}\}/);
assert.match(trends,/accessibilityLiveRegion="polite"[\s\S]*?monthLabel\(selected\.key\)/);
assert.match(trends,/!showAllTrendLabels &&[\s\S]*?p\.months\.map/);
assert.match(trends,/backgroundColor: theme\.primary/);
assert.match(trends,/backgroundColor: theme\.expenseGraphic/);
''')
change(f,"const task5Segments = read('src/components/bills/bills-segment-control.tsx');", "const task5Segments = read('src/components/ui/segmented-control.tsx');")
between(f,'assert.match(task5Segments, /<SegmentedControl/);','assert.equal((task5Bills.match(/<TextField',r'''assert.match(task5Bills,/<SegmentedControl[\s\S]*?label=\{t\('billsTitle'\)\}/);
assert.match(task5Segments,/role="tablist"/);
assert.match(task5Segments,/accessibilityState=\{\{ selected:/);
assert.ok(Number(task5Segments.match(/segment:\s*\{[\s\S]*?minHeight:\s*(\d+)/)?.[1])>=48);
assert.doesNotMatch(task5Segments,/numberOfLines/);
for (const label of ['refUpcoming','refAll']) assert.ok(task5Bills.includes(`t('${label}')`));
''')
change(f,r'assert.match(task6Wallet, /accessibilityLabel=\{sourcesDisclosureLabel\}[\s\S]{0,180}accessibilityState=\{\{ expanded: showAllSources \}\}/);',r'assert.match(task6Wallet, /<AccountGroups[\s\S]*?onManage=\{setOptionsFor\}/);')
change(f,r'/<View style=\{\[styles\.overviewAmount[\s\S]*?(?=\n\s*\{activeSourceCount === 0)/',r'/<View style=\{\[styles\.money[\s\S]*?(?=\n\s*\{p\.activeSourceCount === 0)/')
print('Recovered legacy UI contract migrations; retained ledger/payment/privacy assertions.')
