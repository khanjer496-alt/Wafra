'use strict';
// The widgets' coins: Today's stack, Spending's coin row, Coming up's date
// strip and the Lock Screen ring, plus the iOS 17 update animation and
// tap-to-flip. The arithmetic runs here from src/lib/widget-coins.ts (the
// reference both native ports follow); Swift and Kotlin are checked as
// source, and the Swift math also runs on macOS (widget-native/main.swift).
// Synthetic figures only.
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
const coins = real('@/lib/widget-coins');
const { buildWidgetSnapshot } = real('@/lib/widget-snapshot');
const { categoryColor, CATEGORY_REST } = real('@/lib/category-colors');
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.android } } });
const swiftCoins = read('targets/widget/WafraCoins.swift');
const swiftViews = read('targets/widget/WafraWidgetViews.swift');
const swiftSnapshot = read('targets/widget/WafraSnapshot.swift');
const swiftFlip = read('targets/widget/WafraTodayFlip.swift');
const swiftIndex = read('targets/widget/index.swift');
const graphics = read(`${kotlinDir}/WidgetGraphics.kt`);
const widgets = read(`${kotlinDir}/WafraWidgets.kt`);
const snapshotKt = read(`${kotlinDir}/WidgetSnapshot.kt`);
const plain = (value) => JSON.parse(JSON.stringify(value));

const NOW = new Date(2026, 8, 26, 12, 0, 0);
const today = {
  todayFils: 5237, todayCount: 2, weekFils: 52877,
  week: [4200, 11800, 3600, 6400, 9500, 12140, 5237].map((fils, i) => ({ dateISO: `2026-09-${20 + i}`, weekday: i, fils, today: i === 6 })),
  budget: null, average: null,
};
const base = { today, currency: 'AED', exponent: 2, now: NOW, upcoming: [], hideAmounts: false, language: 'en' };
const spendingInput = (extra = {}) => ({
  monthKey: '2026-09', totalFils: 400000,
  categories: [['Groceries', 183600, '#FFB86B'], ['Dining', 100400, '#EC9FE8'], ['Shopping', 88000, '#5FE08A'],
    ['Transport', 10000, '#ECDFA8'], ['Utilities', 8000, '#67DCCB'], ['Telecom', 5000, '#97A9F8'], ['Health', 3000, '#B9A2F8'],
    ['Travel', 2000, '#F6A9BA']].map(([label, fils, color]) => ({ label, fils, color })),
  restColor: CATEGORY_REST, ...extra,
});

test('the snapshot carries each category’s colour and the rest’s, never more', () => {
  const s = buildWidgetSnapshot({ ...base, spending: spendingInput() });
  assert.deepEqual(plain(s.spending.categories.map((c) => c.color)), ['#FFB86B', '#EC9FE8', '#5FE08A', '#ECDFA8', '#67DCCB', '#97A9F8']);
  assert.equal(s.spending.otherColor, CATEGORY_REST);
  assert.equal(s.spending.otherMinor, 5000);
  // Hidden: colours are not amounts, so they stay; every amount goes.
  const hidden = buildWidgetSnapshot({ ...base, hideAmounts: true, spending: spendingInput() });
  assert.ok(hidden.spending.categories.every((c) => c.amountMinor === null && /^#[0-9A-F]{6}$/.test(c.color)));
  assert.doesNotMatch(JSON.stringify(hidden.spending), /183600|100400|5000/);
  // Older callers (no colours) write exactly the older shape; so does a half-coloured month.
  const older = buildWidgetSnapshot({ ...base, spending: { monthKey: '2026-09', totalFils: 10, categories: [{ label: 'A', fils: 10 }] } });
  assert.deepEqual(Object.keys(older.spending).sort(), ['categories', 'monthKey', 'otherMinor', 'totalMinor']);
  assert.deepEqual(Object.keys(older.spending.categories[0]).sort(), ['amountMinor', 'label']);
  const partial = spendingInput();
  partial.categories[1] = { ...partial.categories[1], color: 'url(x)' };
  const half = buildWidgetSnapshot({ ...base, spending: partial });
  assert.ok(half.spending.categories.every((c) => !('color' in c)) && !('otherColor' in half.spending), 'all or none');
});

test('the ledger writes the Spending tab’s own category colours', () => {
  const tx = (id, amountFils, category) => ({ id, title: id, amountFils, category, date: '2026-09-10', accountId: 'bank', type: 'expense', source: 'sms' });
  const state = {
    hydrated: true, onboarded: true, privateMode: false, language: 'en', marketId: 'AE',
    accounts: [{ id: 'bank', kind: 'bank', name: 'Everyday', openingFils: 0 }],
    transactions: [tx('a', 50000, 'groceries'), tx('b', 30000, 'dining'), tx('c', 1000, 'telecom')],
    budgets: [], bills: [], cardDues: [], notSubscriptions: [], cancelledSubscriptions: {}, merchantOverrides: {}, billAliases: {},
    transferInternalIds: [], historyImport: null,
  };
  const s = real('@/lib/widget-ledger').widgetSnapshotForLedger({ state, now: NOW, moneySpec: { currency: 'AED', exponent: 2 }, language: 'en' }, []);
  assert.deepEqual(plain(s.spending.categories.map((c) => c.color)), ['groceries', 'dining', 'telecom'].map(categoryColor));
  assert.equal(s.spending.otherColor, CATEGORY_REST);
});

test('Today: one coin per payment, at most six, none with none', () => {
  assert.equal(coins.widgetTodayCoins(0), 0);
  assert.equal(coins.widgetTodayCoins(1), 1);
  assert.equal(coins.widgetTodayCoins(6), 6);
  assert.equal(coins.widgetTodayCoins(40), 6);
  assert.equal(coins.widgetTodayCoins(Number.NaN), 0);
  assert.equal(coins.widgetTodayCoins(null), 0);
  assert.deepEqual(plain(coins.widgetDiscGeometry(22)), { face: 8, edge: 3 });
  // Swift and Kotlin read the same count and cap.
  assert.match(swiftSnapshot, /static let todayCoinLimit = 6/);
  assert.match(graphics, /const val TODAY_COINS = 6/);
  assert.match(swiftViews, /WafraCoinStack\(count: snapshot\.todayCount \?\? 0, band: band\)/);
  assert.match(widgets, /val coins = WidgetGraphics\.todayCoins\(snapshot\.todayCount\)\s+views\.setViewVisibility\(R\.id\.wafra_today_coins, if \(coins > 0\) View\.VISIBLE else View\.GONE\)/);
});

test('Spending: coins sized by share with the tab’s rule; hidden amounts draw equal coins and no rest', () => {
  const s = buildWidgetSnapshot({ ...base, spending: spendingInput() });
  const row = coins.widgetSpendingCoins(s.spending, false);
  assert.deepEqual(plain(row.map((c) => c.value)), [183600, 100400, 88000, 10000, 8000, 5000, 5000], 'six named, then the rest');
  assert.equal(row[6].color, CATEGORY_REST);
  const widths = coins.widgetCoinWidths(row.map((c) => c.value), 300);
  const { overlap, minWidth } = coins.WIDGET_COIN_ROW;
  assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - (300 + overlap * 6)) < 1e-9, 'coins fill the row with their overlaps');
  assert.ok(widths.every((w) => w >= minWidth - 1e-9));
  assert.ok(widths[0] > widths[1] && widths[1] > widths[2], 'bigger share, wider coin');
  // Hidden: one equal coin per named category, no rest coin.
  const hidden = buildWidgetSnapshot({ ...base, hideAmounts: true, spending: spendingInput() });
  const blind = coins.widgetSpendingCoins(hidden.spending, true);
  assert.equal(blind.length, 6);
  assert.ok(blind.every((c) => c.value === null));
  assert.equal(new Set(coins.widgetCoinWidths(blind.map((c) => c.value), 300)).size, 1, 'equal widths reveal nothing');
  // A visible snapshot that is somehow hidden draws equal coins too.
  assert.ok(coins.widgetSpendingCoins(s.spending, true).every((c) => c.value === null));
  // Older snapshots (no colours) keep the share bar.
  const older = buildWidgetSnapshot({ ...base, spending: { monthKey: '2026-09', totalFils: 10, categories: [{ label: 'A', fils: 10 }] } });
  assert.equal(coins.widgetSpendingCoins(older.spending, false), null);
  assert.equal(coins.widgetSpendingCoins(null, false), null);
  // Right to left mirrors the row.
  const ltr = coins.widgetCoinOffsets([100, 60], 155, 5, false);
  const rtl = coins.widgetCoinOffsets([100, 60], 155, 5, true);
  assert.deepEqual(plain(ltr), [0, 95]);
  assert.deepEqual(plain(rtl), [55, 0]);
});

test('native ports keep the coin row’s numbers and the hidden rule', () => {
  for (const [name, value] of Object.entries({ rowHeight: 26, rowFace: 10, rowMinWidth: 16, rowOverlap: 5, stripTile: 20, stripLift: 6, stripHeight: 30 })) {
    assert.match(swiftSnapshot, new RegExp(`static let ${name}: Double = ${value}\\b`), `iOS ${name}`);
  }
  for (const [name, value] of Object.entries({ COIN_ROW_HEIGHT_DP: '26', COIN_ROW_FACE_DP: '10f', COIN_ROW_MIN_DP: '16f', COIN_ROW_OVERLAP_DP: '5f',
    STRIP_TILE_DP: '20f', STRIP_LIFT_DP: '6f', STRIP_HEIGHT_DP: '30', STRIP_DAYS: '30', TODAY_COIN_WIDTH_DP: '22f' })) {
    assert.match(graphics, new RegExp(`const val ${name} = ${value}\\b`), `Android ${name}`);
  }
  assert.equal(coins.WIDGET_COIN_ROW.height, 26);
  assert.equal(coins.WIDGET_STRIP.tile, 20);
  assert.equal(coins.WIDGET_TODAY_COIN_WIDTH, 22);
  // Hidden or unknown amounts: equal coins and no rest, on both platforms.
  assert.match(swiftSnapshot, /guard known, sum > 0 else \{ return colors\.map \{ WafraCoinSpec\(color: \$0, value: nil\) \} \}/);
  assert.match(swiftSnapshot, /var known = !hidden && amounts\.allSatisfy/);
  assert.match(graphics, /if \(!known \|\| sum <= 0L\) return colors\.map \{ SpendingCoin\(it, null\) \}/);
  assert.match(graphics, /var known = !hidden && amounts\.all/);
  // Readers: colours are optional and strictly "#RRGGBB".
  assert.match(swiftSnapshot, /color: WafraHexColor\.parse\(row\.color\)/);
  assert.match(swiftSnapshot, /otherColor: WafraHexColor\.parse\(otherColor\)/);
  assert.match(snapshotKt, /hexColor\(item\.optString\("color", ""\)\)/);
  assert.match(snapshotKt, /otherColor = hexColor\(source\.optString\("otherColor", ""\)\)/);
  assert.match(snapshotKt, /Regex\("\^#\[0-9A-Fa-f\]\{6\}\$"\)/);
  assert.match(snapshotKt, /val color: Int\? = null\)/, 'older snapshots parse without colours');
  // Without colours each keeps the share bar.
  assert.match(swiftCoins, /if !band\.isAdapted, let coins = spending\.coins\(hidden: snapshot\.hidden\) \{[\s\S]{0,200}\} else \{\s+WafraShareBar/);
  assert.match(widgets, /views\.setViewVisibility\(R\.id\.wafra_spending_bar, if \(coins != null\) View\.GONE else View\.VISIBLE\)/);
});

test('Coming up: tiles on their dates, nudged apart, next one lifted, mirrored in Arabic', () => {
  assert.equal(coins.widgetPinPosition(0), 3);
  assert.equal(coins.widgetPinPosition(30), 97);
  assert.equal(coins.widgetPinPosition(-4), 3);
  const centers = coins.widgetStripCenters([1, 1, 2], 300);
  assert.ok(centers[1] - centers[0] >= 14 - 1e-9 && centers[2] - centers[1] >= 14 - 1e-9, 'same-day tiles stay readable');
  const crowded = coins.widgetStripCenters([30, 30, 30], 300);
  assert.equal(crowded[2], 290);
  assert.ok(crowded.every((c) => c >= 10 && c <= 290), 'inside the strip');
  // iOS: the strip shares the rows' bills, the soonest lifted, and only takes room the rows leave.
  assert.match(swiftCoins, /\.offset\(x: centers\[index\] - tile \/ 2, y: index == 0 \? 0 : lift\)/);
  assert.match(swiftCoins, /\.map \{ CGFloat\(rtl \? width - \$0 : \$0\) \}/);
  assert.match(swiftViews, /listing\(bills, [^\n]*strip: true\)\s+listing\(bills, [^\n]*strip: false\)/);
  assert.match(swiftViews, /if strip \{\s+WafraBillStrip\(bills: bills, now: entry\.date, band: band, rtl: snapshot\.language == \.ar\)/);
  // Android: same, from 158dp with two rows and 198dp with three; rows never give way to it.
  assert.match(widgets, /internal const val UPCOMING_STRIP_DP = 28/);
  assert.match(widgets, /3 -> heightDp >= UPCOMING_THREE_ROWS_MIN_HEIGHT_DP \+ UPCOMING_STRIP_DP\s+2 -> heightDp >= UPCOMING_TWO_ROWS_MIN_HEIGHT_DP \+ UPCOMING_STRIP_DP\s+else -> false/);
  assert.match(widgets, /center = if \(rtl\) width - centers\[index\] else centers\[index\]/);
  assert.match(widgets, /LOGO_DRAWABLES\[bill\.logoId\]\?\.let \{ BitmapFactory\.decodeResource/, 'only bundled, allowlisted logos');
  const upcoming = read(`${res}/layout/wafra_widget_upcoming.xml`);
  const strip = upcoming.slice(upcoming.indexOf('android:id="@+id/wafra_upcoming_strip"'), upcoming.indexOf('</FrameLayout>', upcoming.indexOf('android:id="@+id/wafra_upcoming_strip"')));
  assert.match(strip, /importantForAccessibility="noHideDescendants"/);
  assert.match(strip, /wafra_upcoming_strip_tiles"[\s\S]*?android:tint="@color\/wafra_widget_upcoming_tile"/);
  assert.match(strip, /wafra_upcoming_strip_marks"[\s\S]*?android:tint="@color\/wafra_widget_upcoming_text"/);
  const logos = strip.slice(strip.indexOf('wafra_upcoming_strip_logos'));
  assert.doesNotMatch(logos, /android:tint/, 'brand logos keep their own colours');
});

test('Lock Screen ring fills the gauge’s own fraction and still speaks as the gauge', () => {
  assert.equal(coins.widgetRingCoins(null), null);
  assert.equal(coins.widgetRingCoins(0), 0);
  assert.equal(coins.widgetRingCoins(0.01), 1, 'a little is never nothing');
  assert.equal(coins.widgetRingCoins(0.5), 6);
  assert.equal(coins.widgetRingCoins(0.99), 11, 'nearly all is never all');
  assert.equal(coins.widgetRingCoins(1.4), 12);
  assert.match(swiftSnapshot, /static let ringCoins = 12/);
  const lock = swiftViews.slice(swiftViews.indexOf('struct WafraLockScreenView'), swiftViews.indexOf('// MARK: - Spending this month'));
  assert.match(lock, /if let fraction = budgetUsed\(snapshot\) \{[\s\S]{0,300}WafraCoinRing\(fraction: fraction\)/);
  assert.match(lock, /\.accessibilityLabel\(strings\.left\)\s+\.accessibilityValue\(percent\)\s+\.wafraAmount\(snapshot\)/);
  const ring = swiftCoins.slice(swiftCoins.indexOf('struct WafraCoinRing'), swiftCoins.indexOf('// MARK: - Today: tap to flip'));
  assert.match(ring, /WafraCoinMath\.filledCoins\(fraction, total: total\)/);
  assert.match(ring, /@Environment\(\\\.widgetRenderingMode\)/);
  assert.match(ring, /coin\.widgetAccentable\(\)/, 'filled coins take the tint');
  assert.match(ring, /- Double\.pi \/ 2/, 'from the top');
});

test('iOS 17 motion is guarded, respects Reduce Motion and redaction, and never runs on its own', () => {
  // Every iOS 17 API sits behind an availability check; the target stays 16.1.
  assert.match(read('targets/widget/expo-target.config.js'), /deploymentTarget: '16\.1'/);
  assert.match(swiftCoins, /if #available\(iOS 17\.0, \*\) \{\s+if let value, !reduceMotion, redaction\.isEmpty \{\s+content\.contentTransition\(\.numericText\(value: value\)\)/);
  assert.match(swiftCoins, /if #available\(iOS 17\.0, \*\) \{\s+let entrance: AnyTransition = reduceMotion \|\| !redaction\.isEmpty\s+\? \.identity/);
  assert.match(swiftCoins, /if #available\(iOS 17\.0, \*\) \{\s+Button\(intent: WafraFlipTodayIntent\(\)\)/);
  assert.match(swiftCoins, /@available\(iOS 17\.0, \*\)\nstruct WafraFlipFaces/);
  assert.match(swiftCoins, /guard !reduceMotion else \{ return \.opacity \}/, 'Reduce Motion crossfades');
  assert.match(swiftCoins, /rotation3DEffect\(\.degrees\(angle\), axis: \(x: 0, y: 1, z: 0\)/);
  assert.equal((swiftCoins.match(/@Environment\(\\\.accessibilityReduceMotion\)/g) || []).length, 3);
  assert.equal((swiftCoins.match(/@Environment\(\\\.redactionReasons\)/g) || []).length, 3);
  // No repeating or continuous animation anywhere in the widget.
  for (const source of [swiftCoins, swiftViews]) {
    assert.doesNotMatch(source, /repeatForever|TimelineView|\.animation\(/);
  }
  // Figures roll their digits; hidden ones ("—") never do.
  assert.match(swiftViews, /\.wafraNumericTransition\(parts == nil \? nil : minor\)/);
  assert.match(swiftViews, /\.wafraNumericTransition\(snapshot\.weekTotalMinor\)/);
  // A new coin enters; the stack is bottom-anchored so the others stay put.
  assert.match(swiftCoins, /WafraCoinDisc\(width: width\)\s+\.offset\(y: -\(shadow \+ CGFloat\(index\) \* edge\)\)\s+\.wafraCoinEntrance\(\)/);
});

test('iOS 17 tap-to-flip: an App Intent toggles the stored face; taps elsewhere still open Wafra', () => {
  assert.match(swiftFlip, /^import AppIntents/m);
  assert.match(swiftFlip, /@available\(iOS 17\.0, \*\)\nstruct WafraFlipTodayIntent: AppIntent \{/);
  assert.match(swiftFlip, /static let isDiscoverable = false/);
  assert.match(swiftFlip, /WafraTodayFace\.toggleStored\(\)\s+WidgetCenter\.shared\.reloadTimelines\(ofKind: WafraTodayFace\.widgetKind\)/);
  assert.match(swiftSnapshot, /static let storageKey = "wafra\.widget\.todayFace"/);
  assert.match(swiftSnapshot, /static let widgetKind = "WafraToday"/);
  assert.match(swiftIndex, /let kind = "WafraToday"/, 'the intent reloads the Today widget’s own kind');
  // Only iOS 17 reads the stored face; earlier systems always show today.
  assert.match(swiftIndex, /if #available\(iOS 17\.0, \*\) \{\s+return WafraTodayFace\.stored\(\)\s+\}\s+return \.today/);
  assert.match(swiftViews, /WafraFlipFaces\(face: entry\.isPlaceholder \? \.today : entry\.todayFace\)/);
  // The week face reuses the snapshot's seven days: no new figures.
  const week = swiftCoins.slice(swiftCoins.indexOf('struct WafraWeekFace'));
  assert.match(week, /WafraWeekBars\(snapshot: snapshot, band: band\)/);
  assert.match(week, /WafraBandFigure\(minor: snapshot\.weekTotalMinor/);
  // The button is spoken; the deep link stays on every widget.
  assert.match(swiftCoins, /\.accessibilityLabel\(face == \.today \? strings\.showLast7Days : strings\.showToday\)/);
  assert.match(swiftSnapshot, /var showLast7Days: String \{ pick\("[^"]+", "[^"]*[؀-ۿ][^"]*"\) \}/);
  assert.equal((swiftViews.match(/\.widgetURL\(WafraShared\.appURL\)/g) || []).length, 4);
  // AppIntents is linked by @bacons/apple-targets for every widget target; listing it again would duplicate it.
  const target = require(path.join(root, 'node_modules/@bacons/apple-targets/build/target.js'));
  assert.ok(target.TARGET_REGISTRY.widget.frameworks.includes('AppIntents'));
  assert.doesNotMatch(read('targets/widget/expo-target.config.js'), /frameworks:/);
});

test('coins are decorative on both platforms and wear only the mirrored CoinColors', () => {
  // iOS: every coin drawing is hidden from VoiceOver.
  for (const name of ['WafraCoinStack', 'WafraCoinRow', 'WafraBillStrip', 'WafraCoinRing']) {
    const start = swiftCoins.indexOf(`struct ${name}`);
    const body = swiftCoins.slice(start, swiftCoins.indexOf('\nstruct ', start + 1) >>> 0 || undefined);
    assert.match(body, /\.accessibilityHidden\(true\)/, `${name} is hidden`);
  }
  // Colours: CoinColors once per platform, as in theme.ts.
  const hex = (value) => value.replace('#', '').toUpperCase();
  for (const [key, swiftName, kotlinName] of [['face', 'face', 'COIN_FACE'], ['side', 'side', 'COIN_SIDE'], ['rim', 'rim', 'COIN_RIM'],
    ['shine', 'shine', 'COIN_SHINE'], ['shadow', 'shadow', 'COIN_SHADOW']]) {
    const want = hex(theme.CoinColors[key]);
    assert.match(swiftCoins, new RegExp(`static let ${swiftName} = Color\\(hex: 0x${want}\\)`), `iOS ${key}`);
    assert.match(graphics, new RegExp(`val ${kotlinName} = 0xFF${want}\\.toInt\\(\\)`), `Android ${key}`);
  }
  assert.doesNotMatch(swiftViews, /0xEDC85E|0xB98F2E/, 'coin colours live in one Swift place');
  assert.doesNotMatch(graphics, /getColor\(/, 'no theme colour resolved at render time');
  // Android: coin images are not important for accessibility; content descriptions are unchanged.
  const today = read(`${res}/layout/wafra_widget_today.xml`);
  const coinsView = today.slice(today.indexOf('android:id="@+id/wafra_today_coins"'));
  assert.match(coinsView.slice(0, coinsView.indexOf('/>')), /importantForAccessibility="no"/);
  assert.doesNotMatch(coinsView.slice(0, coinsView.indexOf('/>')), /android:tint/, 'gold is drawn, not tinted');
  const spending = read(`${res}/layout/wafra_widget_spending.xml`);
  const row = spending.slice(spending.indexOf('android:id="@+id/wafra_spending_coins"'));
  assert.match(row.slice(0, row.indexOf('/>')), /importantForAccessibility="no"/);
  assert.doesNotMatch(row.slice(0, row.indexOf('/>')), /android:tint/, 'category colours are drawn, not tinted');
  assert.doesNotMatch(widgets, /setContentDescription\(R\.id\.wafra_(today_coins|spending_coins|upcoming_strip)/);
  // The band shows between overlapping coins: cut out, never a baked band colour.
  assert.match(graphics, /PorterDuffXfermode\(PorterDuff\.Mode\.CLEAR\)/);
  // Tinted / clear Home Screens: iOS keeps the share bar and skips the stack.
  assert.match(swiftCoins, /if coins > 0, !band\.isAdapted \{/);
  assert.match(swiftViews, /over: fullColor \? over : \.primary,\s+isAdapted: true/);
});
