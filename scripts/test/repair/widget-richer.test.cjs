'use strict';
// The richer widgets: Today's week bars, budget bar and pattern corner;
// Coming up's total, due pills and empty state; and the new Spending this
// month widget, whose figures must be the Spending tab's own (same month,
// same definition of spending, same category order), hidden-safe, and absent
// from older snapshots without breaking anything. Native code is checked as
// source here; the Kotlin geometry runs on the JVM and the Swift snapshot
// logic in scripts/test/widget-native/main.swift.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const real = require('../../universal-test/load-ts.cjs').createLoader();

const root = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const res = 'modules/wafra-widgets/android/src/main/res';
const kotlinDir = 'modules/wafra-widgets/android/src/main/java/expo/modules/wafrawidgets';
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.android } } });
const preview = load(path.join(root, 'src/lib/widget-preview.ts'));
const { widgetsCopy } = load(path.join(root, 'src/lib/widgets-copy.ts'));
const LRM = '‎';

const NOW = new Date(2026, 8, 26, 12, 0, 0);
const tx = (id, title, amountFils, category, date, extra = {}) => ({ id, title, amountFils, category, date, accountId: 'bank', type: 'expense', source: 'sms', ...extra });
function ledgerState(overrides = {}) {
  return {
    hydrated: true, onboarded: true, privateMode: false, language: 'en', marketId: 'AE',
    accounts: [{ id: 'bank', kind: 'bank', name: 'Everyday', openingFils: 0 }, { id: 'old', kind: 'bank', name: 'Old', archived: true, openingFils: 0 }],
    transactions: [
      tx('t1', 'Carrefour', 183600, 'groceries', '2026-09-26'),
      tx('t2', 'Talabat', 100400, 'dining', '2026-09-20'),
      tx('t3', 'Noon', 88000, 'shopping', '2026-09-12'),
      tx('t4', 'Careem', 56200, 'transport', '2026-09-03'),
      tx('t5', 'DEWA', 43800, 'utilities', '2026-09-05'),
      tx('t6', 'du', 21400, 'telecom', '2026-09-06'),
      tx('t7', 'Pharmacy', 18000, 'health', '2026-09-07'),
      tx('t8', 'Flights', 36600, 'travel', '2026-09-08'),
      tx('t9', 'August groceries', 99900, 'groceries', '2026-08-30'),
      tx('t10', 'Salary', 900000, 'salary', '2026-09-01', { type: 'income' }),
      tx('t11', 'Archived account', 77700, 'shopping', '2026-09-10', { accountId: 'old' }),
    ],
    budgets: [{ category: 'groceries', limitFils: 250000 }, { category: 'dining', limitFils: 80000 }],
    bills: [], cardDues: [], notSubscriptions: [], cancelledSubscriptions: {}, merchantOverrides: {}, billAliases: {},
    transferInternalIds: [], historyImport: null,
    ...overrides,
  };
}
const money = { currency: 'AED', exponent: 2 };
const plain = (value) => JSON.parse(JSON.stringify(value));

test('Spending this month carries the Spending tab’s own month, total and category order', () => {
  const ledger = real('@/lib/ledger');
  const snapshot = real('@/lib/widget-ledger').widgetSnapshotForLedger({ state: ledgerState(), now: NOW, moneySpec: money, language: 'en' }, []);
  // What Spending computes for the live month, with the same helpers.
  const state = ledgerState();
  const live = ledger.liveAccountIds(state.accounts);
  const internal = ledger.internalTransferIdsForState(state);
  const summary = real('@/lib/insights').summarizeMonth(state.transactions, { mode: 'month', key: real('@/lib/format').monthKey(NOW) }, live, internal);
  const rows = real('@/lib/reference-presentation').spendingCategoryRows(summary, state.budgets, true).filter((row) => row.spentFils > 0);
  assert.equal(snapshot.spending.monthKey, '2026-09');
  assert.equal(snapshot.spending.totalMinor, summary.expenseFils);
  assert.equal(snapshot.spending.totalMinor, 183600 + 100400 + 88000 + 56200 + 43800 + 21400 + 18000 + 36600,
    'income, last month and archived accounts are not this month’s spending');
  assert.deepEqual(plain(snapshot.spending.categories.map((c) => c.amountMinor)), rows.slice(0, 6).map((row) => row.spentFils));
  assert.deepEqual(plain(snapshot.spending.categories.map((c) => c.label)), ['Groceries', 'Dining', 'Shopping', 'Transport', 'Utilities', 'Travel']);
  assert.equal(snapshot.spending.otherMinor, 21400 + 18000, 'everything after six is one figure');
  assert.equal(snapshot.budgetTotalMinor, 330000, 'the limits behind the budget bar');
  const ar = real('@/lib/widget-ledger').widgetSnapshotForLedger({ state: ledgerState(), now: NOW, moneySpec: money, language: 'ar' }, []);
  assert.equal(ar.spending.categories[0].label, 'البقالة', 'names follow the widget language');
});

test('the preview reads the month as the native widgets draw it, and hides amounts when asked', () => {
  const snapshot = real('@/lib/widget-ledger').widgetSnapshotForLedger({ state: ledgerState(), now: NOW, moneySpec: money, language: 'en' }, []);
  const view = preview.widgetSpendingView(snapshot, widgetsCopy('en'));
  assert.equal(view.month, 'September');
  assert.equal(view.total, 'AED 5,480');
  assert.deepEqual(plain(view.top), [{ label: 'Groceries', amount: '1,836' }, { label: 'Dining', amount: '1,004' }, { label: 'Shopping', amount: '880' }]);
  assert.deepEqual(plain(view.segments.map((s) => s.alpha)), [0.92, 0.7, 0.5, 0.24, 0.24, 0.24, 0.24], 'three named, the rest quiet');
  assert.ok(Math.abs(view.segments.reduce((sum, s) => sum + s.share, 0) - 1) < 1e-9);
  const ar = preview.widgetSpendingView({ ...snapshot, language: 'ar' }, widgetsCopy('ar'));
  assert.equal(ar.month, 'سبتمبر');
  assert.equal(ar.total, `${LRM}AED 5,480${LRM}`);
  // Hidden: the month and names, no total, no shares.
  const hidden = preview.widgetSpendingView({ ...snapshot, hidden: true,
    spending: { ...snapshot.spending, totalMinor: null, otherMinor: null, categories: snapshot.spending.categories.map((c) => ({ ...c, amountMinor: null })) } }, widgetsCopy('en'));
  assert.equal(hidden.total, null);
  assert.deepEqual(plain(hidden.segments), []);
  assert.ok(hidden.top.every((row) => row.amount === null && row.label));
  // An older snapshot has no month: the widget asks to open Wafra, nothing throws.
  const { spending, ...older } = snapshot;
  assert.equal(preview.widgetSpendingView(older, widgetsCopy('en')), null);
  assert.equal(preview.widgetSpendingView({ ...snapshot, spending: { ...spending, monthKey: '2026-13' } }, widgetsCopy('en')), null);
  assert.equal(preview.widgetBudgetProgress(older).fraction, (330000 - snapshot.leftInBudgetsMinor) / 330000);
  const { budgetTotalMinor, ...withoutLimits } = snapshot;
  assert.equal(preview.widgetBudgetProgress(withoutLimits), null, 'older snapshots draw no budget bar');
});

test('whole units round half up, as Home’s week columns', () => {
  assert.equal(preview.widgetWholeNumber(183650, 2), '1,837');
  assert.equal(preview.widgetWholeNumber(183649, 2), '1,836');
  assert.equal(preview.widgetWholeNumber(1234, 0), '1,234');
  assert.equal(preview.widgetWholeNumber(1500, 3), '2');
  assert.equal(preview.widgetWholeNumber(-40, 2), '0');
  const spec = { currency: 'AED', exponent: 2 };
  const format = real('@/lib/ledger-money').formatMinorUnits;
  for (const minor of [0, 49, 50, 149, 150, 183650, 99999999]) {
    assert.equal(preview.widgetWholeNumber(minor, 2), format(minor, spec, { decimals: false, conventions: { decimal: '.', group: ',', grouping: 'western' } }), String(minor));
  }
});

test('Coming up adds up the listed bills, and the budget bar reads (limits - left) / limits', () => {
  const s = { hidden: false, language: 'en', currency: 'AED', exponent: 2, leftInBudgetsMinor: 26000, budgetTotalMinor: 100000, budgetsOver: 0 };
  const bills = [{ title: 'DEWA', amountMinor: 38000, estimated: true, dueISO: '2026-09-27' }, { title: 'ADCB', amountMinor: 120050, estimated: false, dueISO: '2026-09-28' }];
  assert.equal(preview.widgetBillsTotal(bills, s), '≈ AED 1,580.50');
  assert.equal(preview.widgetBillsTotal(bills.map((b) => ({ ...b, estimated: false })), s), 'AED 1,580.50');
  assert.equal(preview.widgetBillsTotal(bills, { ...s, language: 'ar' }), `${LRM}≈ AED 1,580.50${LRM}`);
  assert.equal(preview.widgetBillsTotal([...bills, { ...bills[0], amountMinor: null }], s), null, 'a partial sum would understate');
  assert.equal(preview.widgetBillsTotal(bills, { ...s, hidden: true }), null);
  assert.equal(preview.widgetBillsTotal([], s), null);
  assert.deepEqual(plain(preview.widgetBudgetProgress(s)), { fraction: 0.74, over: false });
  assert.deepEqual(plain(preview.widgetBudgetProgress({ ...s, budgetsOver: 1, leftInBudgetsMinor: 0 })), { fraction: 1, over: true });
  assert.equal(preview.widgetBudgetProgress({ ...s, hidden: true }), null);
  assert.equal(preview.widgetBudgetProgress({ ...s, budgetTotalMinor: 0 }), null);
});

test('Android draws the shapes as tinted masks so night mode recolours them, and registers Spending', () => {
  const kotlin = read(`${kotlinDir}/WafraWidgets.kt`);
  const graphics = read(`${kotlinDir}/WidgetGraphics.kt`);
  assert.match(graphics, /Color\.WHITE/, 'masks are white; the layout tints them');
  assert.doesNotMatch(graphics, /getColor\(/, 'no colour is resolved at render time');
  const today = read(`${res}/layout/wafra_widget_today.xml`);
  const tint = (layout, id) => {
    const start = layout.indexOf(`android:id="@+id/${id}"`);
    assert.ok(start >= 0, id);
    return /android:tint="@color\/(\w+)"/.exec(layout.slice(start, layout.indexOf('/>', start)))?.[1];
  };
  assert.equal(tint(today, 'wafra_today_bars'), 'wafra_widget_today_mark');
  assert.equal(tint(today, 'wafra_today_bars_today'), 'wafra_widget_today_accent');
  assert.equal(tint(today, 'wafra_today_progress_fill'), 'wafra_widget_today_accent');
  assert.equal(tint(today, 'wafra_today_progress_over'), 'wafra_widget_today_over');
  assert.equal(tint(read(`${res}/layout/wafra_widget_spending.xml`), 'wafra_spending_bar'), 'wafra_widget_spending_text');
  // The week, bars and pattern included, sits in the block the short size leaves out.
  const week = today.slice(today.indexOf('android:id="@+id/wafra_today_week"'), today.indexOf('android:id="@+id/wafra_today_label"'));
  assert.match(week, /wafra_today_bars_today/);
  assert.match(week, /@drawable\/wafra_widget_pattern_today/);
  assert.match(kotlin, /if \(!compact\) \{[\s\S]{0,900}setImageViewBitmap\(R\.id\.wafra_today_bars_today/);
  assert.match(kotlin, /val over = snapshot\.budgetsOver > 0/);
  // Spending: provider, receiver, info, preview.
  assert.match(read(`${kotlinDir}/SpendingWidgetProvider.kt`), /class SpendingWidgetProvider : AppWidgetProvider\(\)[\s\S]*onAppWidgetOptionsChanged/);
  assert.match(read('modules/wafra-widgets/android/src/main/AndroidManifest.xml'),
    /android:name="expo\.modules\.wafrawidgets\.SpendingWidgetProvider"[\s\S]{0,700}@xml\/wafra_widget_spending_info/);
  assert.match(read(`${res}/xml/wafra_widget_spending_info.xml`), /android:previewLayout="@layout\/wafra_widget_spending_preview"/);
  assert.match(kotlin, /SpendingWidgetProvider::class\.java/);
  assert.match(kotlin, /snapshot\?\.spending\?\.takeIf \{ snapshot\.isFresh\(now\) \}/, 'no month (older snapshot) asks to open Wafra');
  assert.match(read('modules/wafra-widgets/index.ts'), /export type PinnableWidget = 'today' \| 'upcoming' \| 'spending';/);
});

test('the Spending widget wears Spending’s clay band on both platforms, light and dark', () => {
  const colors = (dir) => Object.fromEntries([...read(`${res}/${dir}/colors.xml`).matchAll(/<color name="(\w+)">(#[0-9A-F]{6})<\/color>/g)].map((m) => [m[1], m[2]]));
  const swift = read('targets/widget/WafraWidgetViews.swift');
  const body = swift.slice(swift.indexOf('static func spending(_ scheme: ColorScheme) -> WafraBand'));
  const [dark, light] = body.slice(0, body.indexOf('\n  }\n')).split('return WafraBand(').slice(1)
    .map((chunk) => Object.fromEntries([...chunk.matchAll(/(\w+): Color\(hex: 0x([0-9A-F]{6})\)/g)].map((m) => [m[1], `#${m[2]}`])));
  for (const [scheme, dir, ios] of [['light', 'values', light], ['dark', 'values-night', dark]]) {
    const band = theme.BandPalettes[scheme].spending;
    const android = colors(dir);
    assert.equal(android.wafra_widget_spending_band, band.band, `Android ${scheme} band`);
    assert.equal(android.wafra_widget_spending_text, band.onBand, `Android ${scheme} text`);
    assert.equal(android.wafra_widget_spending_secondary, band.onBandSecondary, `Android ${scheme} secondary`);
    assert.equal(android.wafra_widget_today_tile, theme.BandPalettes[scheme].home.tile, `Android ${scheme} ink tile`);
    assert.equal(ios.band, band.band, `iOS ${scheme} band`);
    assert.equal(ios.onBand, band.onBand, `iOS ${scheme} text`);
    assert.equal(ios.onBandSecondary, band.onBandSecondary, `iOS ${scheme} secondary`);
    assert.equal(ios.tile, band.tile, `iOS ${scheme} tile`);
    assert.equal(ios.mark, band.bandMark, `iOS ${scheme} mark`);
  }
  assert.equal(colors('values').wafra_widget_today_over, theme.BandPalettes.dark.home.statusOver, 'over budget reads on ink in both schemes');
});

test('iOS registers Spending, lets Coming up be small, and keeps amounts redacted', () => {
  const index = read('targets/widget/index.swift');
  assert.match(index, /WafraComingUpWidget\(\)\s+WafraSpendingWidget\(\)\s+WafraLockScreenWidget\(\)/);
  assert.match(index, /let kind = "WafraSpending"[\s\S]{0,400}\.supportedFamilies\(\[\.systemMedium\]\)/);
  assert.match(index, /\.supportedFamilies\(\[\.systemSmall, \.systemMedium\]\)/);
  const swift = read('targets/widget/WafraWidgetViews.swift');
  const spending = swift.slice(swift.indexOf('struct WafraSpendingView'));
  assert.ok((spending.match(/\.wafraAmount\(snapshot\)/g) || []).length >= 2, 'total and category amounts redact');
  assert.match(spending, /if let snapshot = entry\.freshSnapshot, let spending = snapshot\.spending/);
  assert.match(swift, /\.accessibilityLabel\(strings\.totalDue\(total\)\)/);
  assert.match(swift, /Image\(systemName: "calendar"\)[\s\S]{0,200}Text\(strings\.nothingComingUp\)/);
});

test('due pills count days past the coming week, in both languages, on every surface', () => {
  const en = widgetsCopy('en'); const ar = widgetsCopy('ar');
  assert.equal(preview.widgetDueLabel('2026-10-03', '2026-09-26', en), 'in 7 days');
  assert.equal(preview.widgetDueLabel('2026-10-06', '2026-09-26', ar), 'بعد 10 أيام');
  assert.equal(preview.widgetDueLabel('2026-10-07', '2026-09-26', ar), 'بعد 11 يومًا');
  const plural = (dir) => /<plurals name="wafra_widget_in_days">([\s\S]*?)<\/plurals>/.exec(read(`${res}/${dir}/strings.xml`))[1];
  assert.match(plural('values'), /quantity="other">in %d days</);
  assert.match(plural('values-ar'), /quantity="few">بعد %d أيام</);
  assert.match(plural('values-ar'), /quantity="many">بعد %d يومًا</);
  assert.match(read('targets/widget/WafraSnapshot.swift'), /days <= 10 \? "بعد \\\(days\) أيام" : "بعد \\\(days\) يومًا"/);
  assert.match(read(`${kotlinDir}/WafraWidgets.kt`), /R\.plurals\.wafra_widget_in_days/);
});
