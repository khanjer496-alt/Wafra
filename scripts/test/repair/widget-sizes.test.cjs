'use strict';
// The widgets at every size and in both reading directions: Android height
// breakpoints (Today drops its seven-day total below 152dp, Coming up lists
// 3/2/1 bills from 170/130dp), the over-budget line on every surface, Arabic
// ordering of masked cards and estimates, Arabic tile initials, Android 12+
// corners, and dark-mode tinting of single-ink logos. Neither native platform
// builds here, so Kotlin and XML are checked as source; the preview logic runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const res = 'modules/wafra-widgets/android/src/main/res';
const kotlinDir = 'modules/wafra-widgets/android/src/main/java/expo/modules/wafrawidgets';
const kotlin = read(`${kotlinDir}/WafraWidgets.kt`);
const swiftViews = read('targets/widget/WafraWidgetViews.swift');
const swiftSnapshot = read('targets/widget/WafraSnapshot.swift');
const { widgetsCopy } = load(path.join(root, 'src/lib/widgets-copy.ts'));
const preview = load(path.join(root, 'src/lib/widget-preview.ts'));
const LRM = '\u200E';

const androidString = (dir, name) => {
  const match = new RegExp(`<string name="${name}"[^>]*>([^<]*)</string>`).exec(read(`${res}/${dir}/strings.xml`));
  assert.ok(match, `${dir}/${name} exists`);
  return match[1];
};
const swiftPick = (name) => {
  const match = new RegExp(`var ${name}: String \\{ pick\\("([^"]*)", "([^"]*)"\\) \\}`).exec(swiftSnapshot);
  assert.ok(match, `iOS ${name} exists`);
  return { en: match[1], ar: match[2] };
};
const constant = (name) => {
  const match = new RegExp(`const val ${name} = (\\d+)`).exec(kotlin);
  assert.ok(match, `${name} is defined`);
  return Number(match[1]);
};
const fixture = (patch = {}) => ({
  version: 1, generatedAt: Date.UTC(2026, 8, 26, 9), language: 'en', todayISO: '2026-09-26', currency: 'AED', exponent: 2,
  amountsSensitive: true, hidden: false, todayMinor: 2400, todayCount: 3, last7Minor: [0, 0, 0, 0, 0, 0, 2400],
  leftInBudgetsMinor: 36000, perDayMinor: 1200, budgetsOver: 0, bills: [], ...patch,
});

test('Android breakpoints: Today drops the week total below 152dp; Coming up lists 3, 2 or 1 bills', () => {
  assert.equal(constant('TODAY_FULL_MIN_HEIGHT_DP'), 152);
  assert.equal(constant('UPCOMING_TWO_ROWS_MIN_HEIGHT_DP'), 130);
  assert.equal(constant('UPCOMING_THREE_ROWS_MIN_HEIGHT_DP'), 170);
  assert.match(kotlin, /fun todayIsCompact\(heightDp: Int\): Boolean = heightDp < TODAY_FULL_MIN_HEIGHT_DP/);
  assert.match(kotlin, /heightDp >= UPCOMING_THREE_ROWS_MIN_HEIGHT_DP -> 3\s+heightDp >= UPCOMING_TWO_ROWS_MIN_HEIGHT_DP -> 2\s+else -> 1/);
  // Android 12+ gets one layout per breakpoint and picks among them itself.
  assert.match(kotlin, /TODAY_BREAKPOINTS = intArrayOf\(1, TODAY_FULL_MIN_HEIGHT_DP\)/);
  assert.match(kotlin, /UPCOMING_BREAKPOINTS = intArrayOf\(1, UPCOMING_TWO_ROWS_MIN_HEIGHT_DP, UPCOMING_THREE_ROWS_MIN_HEIGHT_DP\)/);
  assert.match(kotlin, /if \(Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.S\) \{[\s\S]{0,260}return RemoteViews\(layouts\)/);
  // Older versions read the reported minimum height per widget id.
  assert.match(kotlin, /getAppWidgetOptions\(appWidgetId\)\?\.getInt\(AppWidgetManager\.OPTION_APPWIDGET_MIN_HEIGHT, 0\)/);
  assert.match(kotlin, /setViewVisibility\(R\.id\.wafra_today_week, if \(compact\) View\.GONE else View\.VISIBLE\)/);
  assert.match(kotlin, /take\(maxRows\.coerceIn\(1, BILL_ROWS\.size\)\)/);
  for (const provider of ['TodayWidgetProvider', 'UpcomingWidgetProvider']) {
    assert.match(read(`${kotlinDir}/${provider}.kt`), /override fun onAppWidgetOptionsChanged\([\s\S]{0,200}WafraWidgets\.refreshAll\(context\)/,
      `${provider} re-renders on resize`);
  }
  const upcoming = read(`${res}/xml/wafra_widget_upcoming_info.xml`);
  assert.match(upcoming, /android:minHeight="170dp"/, 'Coming up is placed tall enough for three bills');
  assert.match(upcoming, /android:minResizeWidth="250dp"/, 'Coming up never narrows past its amounts');
});

test('Android Today never cuts a number: the figures shrink and the budget amount stands apart', () => {
  const layout = read(`${res}/layout/wafra_widget_today.xml`);
  const view = (id) => {
    const start = layout.indexOf(`android:id="@+id/${id}"`);
    assert.ok(start >= 0, `${id} exists`);
    return layout.slice(start, layout.indexOf('/>', start));
  };
  assert.match(view('wafra_today_amount'), /autoSizeMinTextSize="11sp"/);
  // The week total is whole units on one line; its label gives way instead.
  const week = view('wafra_today_week_amount');
  assert.match(week, /layout_height="18dp"/);
  assert.match(week, /maxLines="1"/);
  assert.match(view('wafra_today_week_label'), /ellipsize="end"/);
  assert.match(kotlin, /WidgetGraphics\.wholeNumber\(weekTotal, snapshot\.exponent\)/);
  assert.match(view('wafra_today_budget_amount'), /maxLines="1"/);
  for (const id of ['wafra_today_budget_lead', 'wafra_today_budget_trail']) {
    assert.match(view(id), /ellipsize="end"/, `${id} gives way to the amount`);
    assert.match(view(id), /layout_weight="1"/);
  }
  // The currency code is smaller and dimmed, as on iOS and in the preview.
  assert.match(kotlin, /ForegroundColorSpan\(context\.getColor\(R\.color\.wafra_widget_today_secondary\)\)/);
});

test('over budgets reads the same on Android, iOS and the preview, in both languages', () => {
  assert.match(kotlin, /if \(leftMinor < 0\) R\.string\.wafra_widget_over_budgets else R\.string\.wafra_widget_left_in_budgets/);
  assert.match(kotlin, /formatMinor\(Math\.abs\(left\)\)/, 'the amount is printed without its minus sign');
  // Mirror of WafraWidgets.budgetLine: the words before and after the amount.
  const split = (template) => {
    const at = template.indexOf('%1$s');
    return { lead: template.slice(0, at).trim(), trail: template.slice(at + 4).trim() };
  };
  const words = { left: swiftPick('leftInBudgets'), over: swiftPick('overBudgets') };
  for (const [language, dir] of [['en', 'values'], ['ar', 'values-ar']]) {
    const copy = widgetsCopy(language);
    for (const [kind, name, previewWords] of [
      ['left', 'wafra_widget_left_in_budgets', copy.widgetLeftInBudgets],
      ['over', 'wafra_widget_over_budgets', copy.widgetOverBudgets],
    ]) {
      const { lead, trail } = split(androidString(dir, name));
      // English puts the amount first; Arabic the words (iOS amountLeadsBudgetLine).
      assert.equal(language === 'en' ? trail : lead, words[kind][language], `${language} ${kind}: Android words match iOS`);
      assert.equal(language === 'en' ? lead : trail, '', `${language} ${kind}: words sit on one side`);
      const line = [lead, 'AED 40.00', trail].filter(Boolean).join(' ');
      assert.equal(line, previewWords('AED 40.00'), `${language} ${kind}: Android matches the preview`);
    }
  }
  assert.equal(preview.widgetTodayLine(fixture({ leftInBudgetsMinor: -4000 }), widgetsCopy('en')), 'AED 40.00 over budgets');
  assert.equal(preview.widgetTodayLine(fixture({ leftInBudgetsMinor: -4000 }), widgetsCopy('ar')), 'تجاوز الميزانيات AED 40.00');
  assert.equal(preview.widgetTodayLine(fixture({ leftInBudgetsMinor: 0 }), widgetsCopy('en')), 'AED 0.00 left in budgets');
});

test('Arabic keeps masked cards and estimates in reading order', () => {
  const ar = fixture({ language: 'ar' });
  const masked = { title: '•••• 1234', amountMinor: 120050, estimated: false, dueISO: '2026-09-27' };
  const estimate = { title: 'DEWA', amountMinor: 38000, estimated: true, dueISO: '2026-09-27' };
  assert.equal(preview.widgetBillTitle(masked, ar), `${LRM}•••• 1234${LRM}`);
  assert.equal(preview.widgetBillTitle(masked, fixture()), '•••• 1234');
  assert.equal(preview.widgetBillTitle({ ...estimate, title: 'الكهرباء' }, ar), 'الكهرباء');
  assert.equal(preview.widgetBillAmount(estimate, ar), `${LRM}≈ AED 380.00${LRM}`, '≈ stays before the code');
  assert.equal(preview.widgetBillAmount(estimate, fixture()), '≈ AED 380.00');
  assert.equal(preview.widgetBillAmount(estimate, { ...ar, hidden: true }), '—');
  // Android: first strong letter decides, falling back to left to right.
  const layout = read(`${res}/layout/wafra_widget_upcoming.xml`);
  for (const n of [1, 2, 3]) {
    for (const id of [`wafra_bill_title_${n}`, `wafra_bill_amount_${n}`]) {
      const start = layout.indexOf(`android:id="@+id/${id}"`);
      assert.match(layout.slice(start, layout.indexOf('/>', start)), /textDirection="firstStrongLtr"/, id);
    }
  }
  // iOS: the same LRM wrap for titles without a letter.
  assert.match(swiftViews, /Text\(WafraTitle\.display\(bill\.title, snapshot\.language\)\)/);
  assert.match(swiftSnapshot, /guard language == \.ar, WafraInitial\.of\(title\) == nil else \{ return title \}/);
});

test('tile initials skip the Arabic article on every surface', () => {
  assert.equal(preview.widgetInitial('الكهرباء'), 'ك');
  assert.equal(preview.widgetInitial('الإيجار'), 'إ');
  assert.equal(preview.widgetInitial('ال'), 'ا');
  assert.equal(preview.widgetInitial('Allianz'), 'A');
  assert.equal(preview.widgetInitial('  netflix'), 'N');
  assert.equal(preview.widgetInitial('•••• 1234'), null);
  assert.match(kotlin, /ARABIC_ARTICLE = "\\u0627\\u0644"/);
  assert.match(swiftSnapshot, /arabicArticle = "\\u\{0627\}\\u\{0644\}"/);
  // The picker preview's sample tiles follow the same rule.
  assert.equal(androidString('values-ar', 'wafra_widget_preview_tile_1'), preview.widgetInitial(androidString('values-ar', 'wafra_widget_preview_bill_1')));
  assert.equal(androidString('values-ar', 'wafra_widget_preview_tile_3'), preview.widgetInitial(androidString('values-ar', 'wafra_widget_preview_bill_3')));
});

test('the empty Coming up message is the same everywhere, and Arabic copy uses Latin digits', () => {
  const nothing = swiftPick('nothingComingUp');
  for (const [language, dir] of [['en', 'values'], ['ar', 'values-ar']]) {
    assert.equal(androidString(dir, 'wafra_widget_no_bills'), nothing[language]);
    assert.equal(widgetsCopy(language).widgetNothingComingUp, nothing[language]);
  }
  assert.doesNotMatch(read(`${res}/values-ar/strings.xml`), /[٠-٩]/);
});

test('Android 12+ corners follow the launcher, and single-ink logos follow dark mode', () => {
  for (const name of ['today', 'upcoming']) {
    for (const file of [`wafra_widget_${name}.xml`, `wafra_widget_${name}_preview.xml`]) {
      const layout = read(`${res}/layout/${file}`);
      const outer = layout.slice(layout.indexOf('<FrameLayout'), layout.indexOf('>', layout.indexOf('<FrameLayout')));
      assert.match(outer, /android:id="@android:id\/background"/, `${file} names the widget background`);
      assert.match(outer, /android:clipToOutline="true"/, `${file} clips to the rounded outline`);
    }
    assert.match(read(`${res}/drawable-v31/wafra_widget_${name}_background.xml`),
      /android:radius="@android:dimen\/system_app_widget_background_radius"/);
  }
  assert.match(read(`${res}/drawable/wafra_widget_tile.xml`), /android:radius="8dp"/, 'tiles keep their own 8dp corners');
  const upcoming = read(`${res}/layout/wafra_widget_upcoming.xml`);
  for (const n of [1, 2, 3]) {
    const start = upcoming.indexOf(`android:id="@+id/wafra_bill_logo_mono_${n}"`);
    assert.ok(start >= 0, `row ${n} has a tinted logo view`);
    assert.match(upcoming.slice(start, upcoming.indexOf('/>', start)), /android:tint="@color\/wafra_widget_upcoming_text"/);
  }
  // No bitmap with the ink colour baked in at render time.
  assert.doesNotMatch(kotlin, /setImageViewBitmap\(BILL_|tintedLogo|PorterDuff/);
});

test('iOS caps Dynamic Type, keeps figures whole and tints only tiles and initials', () => {
  assert.equal((swiftViews.match(/\.dynamicTypeSize\(\.\.\.DynamicTypeSize\.xxLarge\)/g) || []).length, 3);
  assert.match(swiftViews, /\.lineLimit\(1\)\s+\.minimumScaleFactor\(0\.75\)/, 'the week total stays on one line');
  assert.match(swiftViews, /WafraBandFigure\([^)]*\)\s+\.layoutPriority\(1\)/);
  assert.match(swiftViews, /\.minimumScaleFactor\(0\.6\)\s+\.layoutPriority\(1\)\s+\.wafraAmount\(snapshot\)/, 'Coming up amounts win space');
  const tile = swiftViews.slice(swiftViews.indexOf('struct WafraMerchantTile'), swiftViews.indexOf('// MARK: - Lock Screen'));
  assert.match(tile, /\.fill\(band\.tile\)\s+\.widgetAccentable\(\)/);
  assert.match(tile, /Text\(initial\)[\s\S]{0,140}\.widgetAccentable\(\)/);
  assert.equal((tile.match(/\.widgetAccentable\(\)/g) || []).length, 2, 'only the tile shape and the initial');
  assert.match(tile, /#available\(iOS 18\.0, \*\)[\s\S]{0,200}\.widgetAccentedRenderingMode\(\.accentedDesaturated\)/);
});
