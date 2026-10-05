'use strict';
// Onboarding motion for Watch, Goals and Reminders (2026-10-05): the Watch
// coin stack beside a set limit, the Goals Home preview, and the Reminders
// pin strip. The real gate and steps run in the journey harness (Animated as
// the final frame); pure rules load from source with inert UI boundaries.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { gate, profile } = require('../ios-journey/onboarding-extreme-navigation.test.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/** Every node, hidden ones included (the harness's byTestID only sees what assistive tech sees). */
const walk = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const all = (h) => walk(h.tree);
const find = (h, id) => all(h).find((node) => node.props?.testID === id);
/** Values built inside the loaded modules' realm, compared by shape. */
const plain = (value) => JSON.parse(JSON.stringify(value));
const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
/** An Animated value held by the harness's final-frame Animated (interpolate returns the value itself). */
const valueOf = (animated) => animated && typeof animated === 'object' && 'value' in animated ? animated.value : animated;
const opacity = (node) => valueOf(flat(node.props.style).opacity);
const translateY = (node) => valueOf((flat(node.props.style).transform ?? []).find((step) => 'translateY' in step)?.translateY);
const hidden = (node) => node.props.importantForAccessibility === 'no-hide-descendants' && node.props.accessibilityElementsHidden === true;

/** A component file for its pure exports: every import an inert boundary unless given. */
function pure(file, given = {}) {
  const source = read(file);
  const inert = new Proxy(function inert() { return null; }, { get: (_t, key) => key === '__esModule' ? true : inert });
  const deps = {};
  for (const [, name] of source.matchAll(/from '([^']+)'/g)) deps[name] = inert;
  deps['react-native'] = { StyleSheet: { create: (styles) => styles, hairlineWidth: 1 }, View: inert, Pressable: inert,
    Animated: { View: inert }, Platform: { OS: 'ios' } };
  deps['react/jsx-runtime'] = { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' };
  deps.react = { __esModule: true, default: {}, useState: (v) => [v, () => {}] };
  return load(path.join(root, file), { ...deps, ...given });
}

const currencyMetadata = load(path.join(root, 'src/lib/currency-metadata.ts'));
const ledgerMoney = load(path.join(root, 'src/lib/ledger-money.ts'), { '@/lib/currency-metadata': currencyMetadata });
const prefs = load(path.join(root, 'src/lib/home-widget-preferences.ts'));
const types = load(path.join(root, 'src/lib/types.ts'));
const e = load(path.join(root, 'src/lib/onboarding-e.ts'), {
  '@/lib/home-widget-preferences': prefs, '@/lib/types': types,
  '@/lib/splits': load(path.join(root, 'src/lib/splits.ts')),
  '@/lib/transaction-source': load(path.join(root, 'src/lib/transaction-source.ts')),
});
const watch = pure('src/components/onboarding/e-watch.tsx', { '@/lib/ledger-money': ledgerMoney });
const goals = pure('src/components/onboarding/e-goals.tsx', {
  '@/lib/home-widget-preferences': prefs, '@/lib/onboarding-e': e, '@/lib/types': types,
});
const reminders = pure('src/components/onboarding/e-reminders.tsx');
const aed = ledgerMoney.ledgerMoneySpec('AED');
const jpy = ledgerMoney.ledgerMoneySpec('JPY');
/** What the journey harness's Home preference read returns (a legacy layout, normalized). */
const HARNESS_HOME = { order: ['due', 'assistant', 'insight', 'activity', 'upcoming'], hidden: [] };

/* ── Watch ──────────────────────────────────────────────────────────── */

test('Watch: a set limit raises a full 10-coin stack under the limit line, hidden from assistive tech', async () => {
  const h = await gate({ profile: profile('tracking') });
  assert.equal(find(h, 'onboarding-watch-dining-coins'), undefined, 'no limit, no coins');
  await h.tap('onboarding-watch-dining');
  assert.equal(find(h, 'onboarding-watch-dining-coins'), undefined, 'an open row alone draws nothing');
  await h.tap('onboarding-watch-limit-quick-1');
  const coins = find(h, 'onboarding-watch-dining-coins');
  assert.ok(coins, 'the stack appears with the limit');
  assert.ok(hidden(coins), 'decorative: hidden from assistive tech');
  assert.equal(flat(coins.props.style).pointerEvents, 'none');
  assert.equal(h.byTestID('onboarding-watch-dining-coins'), undefined, 'never reachable by a screen reader');
  // The limit line, in the within-limit colour (nothing is spent yet).
  const line = find(h, 'onboarding-watch-dining-coins-line');
  assert.ok(line, 'the limit line sits over the stack');
  const theme = load(path.join(root, 'src/constants/theme.ts'), {
    '@/global.css': {}, 'react-native': { Platform: { select: (values) => values.ios ?? values.default } },
  });
  assert.equal(flat(line.props.style).backgroundColor, theme.bandPalette('settings', 'light').limitOk);
  // Reduce Motion (the harness default): every coin is gold at once.
  const slots = all(h).filter((node) => /^onboarding-watch-dining-coins-stack-coin-\d+$/.test(node.props?.testID ?? ''));
  assert.equal(slots.length, 10, 'ten coins, as in the Limit sheet');
  assert.equal(slots.filter((slot) => opacity(slot) === 1).length, 10, 'nothing spent: the stack is full');
  assert.equal(watch.WATCH_COINS, 10);
  // Only the row with a limit draws one.
  assert.equal(find(h, 'onboarding-watch-groceries-coins'), undefined);
  // Spoken labels are unchanged: the row still speaks its exact limit.
  assert.equal(h.byTestID('onboarding-watch-dining').props.accessibilityLabel, 'Dining, AED 500');
  // Closed, the row writes the figure beside the coins.
  await h.tap('onboarding-watch-dining');
  assert.ok(find(h, 'onboarding-watch-dining-coins'), 'the stack stays with the closed row');
  // (The harness writes money as its minor units.)
  assert.ok(h.text().includes('50000'), 'the written figure is beside it');
});

test('Watch: changing the amount keeps the full stack; removing the limit removes it', async () => {
  const h = await gate({ profile: profile('tracking') });
  await h.tap('onboarding-watch-dining');
  await h.tap('onboarding-watch-limit-quick-1');
  await h.tap('onboarding-watch-limit-raise');
  const slots = all(h).filter((node) => /^onboarding-watch-dining-coins-stack-coin-\d+$/.test(node.props?.testID ?? ''));
  assert.equal(slots.filter((slot) => opacity(slot) === 1).length, 10, 'a new figure re-settles the same full stack');
  await h.tap('onboarding-watch-dining-remove');
  assert.equal(find(h, 'onboarding-watch-dining-coins'), undefined, 'Reduce Motion: removed with the limit at once');
  assert.equal(h.byTestID('onboarding-watch-dining').props.accessibilityLabel, `Dining, ${h.eWords.watchNoLimit}`);
});

test('Watch: with motion, a removed limit drains in place before the stack leaves', async () => {
  const h = await gate({ profile: profile('tracking'), reducedMotion: false });
  await h.tap('onboarding-watch-dining');
  await h.tap('onboarding-watch-limit-quick-0');
  assert.ok(find(h, 'onboarding-watch-dining-coins'));
  await h.tap('onboarding-watch-dining-remove');
  const coins = find(h, 'onboarding-watch-dining-coins');
  assert.ok(coins, 'still drawn while the coins lift away');
  assert.ok(hidden(coins));
  assert.ok(find(h, 'onboarding-watch-dining-coins-stack'), 'the stack drains rather than vanishing');
  const source = read('src/components/onboarding/e-watch.tsx');
  assert.match(source, /filled=\{set \? WATCH_COINS : 0\}/, 'removal empties the stack (CoinStack lifts the coins off)');
  assert.match(source, /leave\.start\(\(\{ finished \}\) => \{ if \(finished\) setKept\(false\); \}\);\s*return \(\) => leave\.stop\(\);/,
    'the drain timer stops on unmount');
});

test('Watch: ± steps follow the quick amounts\' scale; the figure saved is the one shown', async () => {
  const { watchStep } = watch;
  assert.equal(watchStep(0, aed, 1), 5000, '0 + is 50');
  assert.equal(watchStep(25000, aed, 1), 5000);
  assert.equal(watchStep(50000, aed, 1), 10000, 'from the 500 quick amount the step is 100');
  assert.equal(watchStep(50000, aed, -1), 5000, '500 − is 450');
  assert.equal(watchStep(200000, aed, 1), 25000, 'from 2,000 the step is 250');
  assert.equal(watchStep(200000, aed, -1), 10000, '2,000 − is 1,900');
  assert.equal(watchStep(0, jpy, 1), ledgerMoney.typicalMinorAmount(jpy, 50), 'scaled to the currency like the quick amounts');
  for (const reference of e.WATCH_QUICK_REFERENCES) {
    const quick = ledgerMoney.typicalMinorAmount(aed, reference);
    assert.equal(quick % watchStep(quick, aed, 1), 0, `${reference} is a whole number of its steps`);
  }
  const h = await gate({ profile: profile('tracking') });
  await h.tap('onboarding-watch-dining');
  await h.tap('onboarding-watch-limit-raise');
  assert.equal(h.byTestID('onboarding-watch-limit-input').props.value, '50', 'the first step is still 50');
  await h.tap('onboarding-watch-limit-quick-1');
  assert.equal(h.byTestID('onboarding-watch-limit-raise').props.accessibilityLabel, 'Raise by AED 100');
  assert.equal(h.byTestID('onboarding-watch-limit-lower').props.accessibilityLabel, 'Lower by AED 50');
  await h.tap('onboarding-watch-limit-raise');
  assert.equal(h.byTestID('onboarding-watch-limit-input').props.value, '600');
  await h.tap('onboarding-watch-limit-lower');
  await h.tap('onboarding-watch-limit-lower');
  assert.equal(h.byTestID('onboarding-watch-limit-input').props.value, '450');
  await h.tap('onboarding-watch-continue');
  assert.deepEqual(h.state.budgets, [{ category: 'dining', limitFils: 45000 }], 'saved exactly as shown');
});

test('Watch: Choose currency is the band\'s own secondary button, not a sheet card on the band', () => {
  const source = read('src/components/onboarding/e-watch.tsx');
  assert.match(source, /const bandSecondary = useMemo\(\(\) => \(\{ \.\.\.band, card: band\.tile, rule: band\.onBand, text: band\.onBand \}\), \[band\]\);/);
  assert.match(source, /<EButton palette=\{bandSecondary\} variant="secondary" label=\{words\.chooseCurrency\}/);
  assert.match(source, /testID="onboarding-watch-currency"/);
});

/* ── Goals ──────────────────────────────────────────────────────────── */

test('Goals: the Home preview follows homeOrderForGoals, live, and is hidden from assistive tech', async () => {
  const h = await gate({ profile: profile('focus') });
  const preview = find(h, 'onboarding-goals-home');
  assert.ok(preview, 'the mini Home is drawn');
  assert.ok(hidden(preview));
  assert.equal(h.byTestID('onboarding-goals-home'), undefined);
  const shownOrder = () => {
    const rows = all(h).filter((node) => /^onboarding-goals-home-(?!overview$|rows$)[a-z]+$/.test(node.props?.testID ?? ''));
    return rows.map((row) => [row.props.testID.slice('onboarding-goals-home-'.length), translateY(row)])
      .sort((a, b) => a[1] - b[1]).map(([id]) => id);
  };
  const expected = (picked) => plain(goals.homePreviewOrder(picked, prefs.normalizeHomeWidgetPreferences(HARNESS_HOME)));
  assert.deepEqual(shownOrder(), expected([]), 'no goals: the saved order');
  assert.deepEqual(shownOrder().slice(0, 3), ['due', 'assistant', 'insight']);
  await h.tap('onboarding-goal-spend-less');
  assert.deepEqual(shownOrder(), expected(['spend-less']));
  assert.deepEqual(shownOrder().slice(0, 3), ['insight', 'due', 'assistant'], 'spend less brings the insight up');
  await h.tap('onboarding-goal-bills');
  assert.deepEqual(shownOrder(), expected(['bills', 'spend-less']));
  assert.deepEqual(shownOrder().slice(0, 3), ['due', 'upcoming', 'insight'], 'bills put payments first');
  await h.tap('onboarding-goal-spend-less');
  assert.deepEqual(shownOrder(), expected(['bills']), 'unpicking moves it back');
  // The preview and the saved order agree: Continue writes the same sheet order.
  await h.tap('onboarding-goals-continue');
  const saved = h.events.filter((event) => event[0] === 'saveHomeWidgets').at(-1)[1];
  assert.deepEqual(plain(prefs.splitHomeWidgetLayout(saved).sheet), expected(['bills']));
  // The totals row stays on top and shows no money.
  assert.equal(goals.HOME_PREVIEW_SECTIONS, 3);
  const source = read('src/components/onboarding/e-goals.tsx');
  assert.doesNotMatch(source, /CoinStack|CoinDisc|CoinToken|GoalJar|formatMinorUnits|formatMoney/, 'goals draw no money');
  // Onboarding text never caps its scale or truncates, the preview's labels included.
  for (const file of ['e-goals', 'e-watch', 'e-reminders', 'e-choice-row']) {
    assert.doesNotMatch(read(`src/components/onboarding/${file}.tsx`), /numberOfLines|maxFontSizeMultiplier|adjustsFontSizeToFit|minimumFontScale/, file);
  }
});

test('Goals: the preview pitch follows its tallest laid-out row, so a wrapped label never clips', async () => {
  assert.equal(goals.previewPitch(1, []), 28);
  assert.equal(goals.previewPitch(1.4, []), Math.ceil(28 * 1.4), 'scaled before rows report their height');
  assert.equal(goals.previewPitch(1.4, [20, 44]), 50, 'a two-line label pushes every place down');
  assert.equal(goals.previewPitch(1, [20, 22]), 28);
  const h = await gate({ profile: profile('focus') });
  const rowsHeight = () => flat(find(h, 'onboarding-goals-home-rows').props.style).height;
  assert.equal(rowsHeight(), 28 * (goals.HOME_PREVIEW_SECTIONS + 1));
  find(h, 'onboarding-goals-home-insight').props.onLayout({ nativeEvent: { layout: { height: 44 } } });
  await h.flush();
  assert.equal(rowsHeight(), 50 * (goals.HOME_PREVIEW_SECTIONS + 1), 'the measured row sets the pitch');
  const source = read('src/components/onboarding/e-goals.tsx');
  assert.doesNotMatch(source, /minHeight: pitch/, 'a row is never forced to the pitch it then measures');
});

test('Goals: promoted sections are the ones the picks name; the headline has its own line', () => {
  assert.deepEqual(plain([...goals.promotedHomeSections(['bills'])].sort()), ['due', 'upcoming']);
  assert.equal(goals.promotedHomeSections([]).size, 0);
  assert.deepEqual(plain(goals.homePreviewOrder([], prefs.DEFAULT_HOME_WIDGETS)),
    plain(prefs.splitHomeWidgetLayout(prefs.DEFAULT_HOME_WIDGETS).sheet), 'no goals leave Home as it is');
  const source = read('src/components/onboarding/e-goals.tsx');
  // The pattern no longer shares the headline's row, so "What should Wafra do?" wraps as a sentence.
  assert.match(source, /<EHeadline palette=\{band\} size=\{42\}>\{words\.goalsTitle\}<\/EHeadline>\s*<View style=\{\[styles\.pictures/);
  assert.match(source, /testID="onboarding-goals-pattern" accessible accessibilityRole="image" accessibilityLabel=\{bandWords\.pattern\}/);
});

test('Goals: a picked row is washed and its check pops; labels and roles unchanged', async () => {
  const h = await gate({ profile: profile('focus') });
  await h.tap('onboarding-goal-bills');
  const row = h.byTestID('onboarding-goal-bills').props;
  assert.equal(row.accessibilityRole, 'checkbox');
  assert.equal(row.accessibilityLabel, h.eWords.goals.bills);
  assert.equal(row.accessibilityState.checked, true);
  assert.equal(opacity(find(h, 'onboarding-goal-bills-wash')), 1, 'Reduce Motion: the picked wash is in place');
  assert.equal(opacity(find(h, 'onboarding-goal-salary-wash')), 0, 'an unpicked row has none');
  await h.tap('onboarding-goal-bills');
  assert.equal(opacity(find(h, 'onboarding-goal-bills-wash')), 0, 'unpicking clears it');
});

/* ── Reminders ──────────────────────────────────────────────────────── */

test('Reminders: pins only for what Wafra sends, on the days it sends them', () => {
  const pins = reminders.reminderPins(false);
  assert.deepEqual(plain(pins.map(({ kind, day }) => `${kind}${day}`)), ['cards-3', 'bills-1', 'bills0', 'cards0']);
  assert.ok(pins.every((pin) => pin.kind === 'bills' || pin.kind === 'cards'));
  const withDaily = reminders.reminderPins(true);
  // The summary is sent only on an evening with spending (syncDailySummary cancels it otherwise):
  // one example evening, on the due day, never a pin under every day.
  assert.deepEqual(plain(withDaily.filter((pin) => pin.kind === 'daily').map((pin) => pin.day)), [0]);
  assert.match(read('src/lib/notifications.ts'), /buildDailySummary/);
  // The days match the scheduler: bills -1/0, cards -3/0 (src/lib/reminders.ts).
  const scheduler = read('src/lib/reminders.ts');
  assert.match(scheduler, /\[-1, t\('tomorrow'\)\], \[0, todayWord\]/);
  assert.match(scheduler, /\[-3, tf\('inDaysPhrase', \{ days: 3 \}\)\],\s*\[0, todayWord\]/);
  const code = read('src/components/onboarding/e-reminders.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /recap|trial/i, 'no monthly recap or trial pin');
});

test('Reminders: the strip is hidden from assistive tech and the summary pins follow the switch', async () => {
  const h = await gate({ profile: profile('alerts') });
  const strip = find(h, 'onboarding-remind-timeline');
  assert.ok(strip);
  assert.ok(hidden(strip));
  assert.equal(flat(strip.props.style).pointerEvents, 'none');
  assert.equal(h.byTestID('onboarding-remind-timeline'), undefined);
  const pin = (key) => find(h, `onboarding-remind-pin-${key}`);
  for (const key of ['cards-3', 'bills-1', 'bills0', 'cards0']) assert.equal(opacity(pin(key)), 1, `${key}: in place under Reduce Motion`);
  for (const day of [-3, -2, -1]) assert.equal(pin(`daily${day}`), undefined, 'no summary pin under every day');
  const daily = () => opacity(pin('daily0'));
  const toggle = h.byTestID('onboarding-remind-daily-switch').props;
  const on = toggle.value;
  assert.equal(daily(), on ? 1 : 0, 'the example summary pin matches the switch');
  toggle.onValueChange(!on); await h.flush();
  assert.equal(daily(), on ? 0 : 1, 'and follows it');
  toggle.onValueChange(on); await h.flush();
  assert.equal(daily(), on ? 1 : 0);
  // Spoken labels unchanged.
  const words = h.eWords;
  assert.equal(h.byTestID('onboarding-remind-bills').props.accessibilityLabel, `${words.remindBillsTitle}. ${words.remindBillsWhen}`);
  assert.equal(h.byTestID('onboarding-remind-cards').props.accessibilityLabel, `${words.remindCardsTitle}. ${words.remindCardsWhen}`);
  assert.equal(h.byTestID('onboarding-remind-daily-switch').props.accessibilityLabel, `${words.remindDailyTitle}. ${words.remindDailyWhen}`);
});

test('Reminders: pins on one day stand apart, their stems in front of the due-day badge', () => {
  const source = read('src/components/onboarding/e-reminders.tsx');
  const gap = Number(source.match(/const SAME_DAY_GAP = (\d+);/)?.[1]);
  const pin = Number(source.match(/const PIN = (\d+);/)?.[1]);
  const badge = Number(source.match(/const MARK_ROW = (\d+);/)?.[1]);
  // Two pins side by side: each stem sits (pin + gap) / 2 from the day's centre; the badge reaches badge / 2.
  assert.ok((pin + gap) / 2 - 1 > badge / 2 + 4, 'both stems clear the calendar badge with room');
  assert.match(source, /above: \{[^}]*zIndex: 1/, 'stems draw in front of the day mark');
  assert.match(source, /gap: SAME_DAY_GAP/);
});

test('Watch: at the accessibility sizes names wrap whole (no coins beside them) and quick amounts wrap', () => {
  const source = read('src/components/onboarding/e-watch.tsx');
  assert.match(source, /\{largeText \? null : <WatchCoins /, 'the header gives the name the row at large text');
  assert.match(source, /\[styles\.quick, largeText && styles\.quickWide,/);
  assert.match(source, /quickWide: \{ flexBasis: 'auto'/, 'each quick amount takes its own width, then wraps');
  assert.match(source, /quickRow: \{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 \}/);
});

test('Reminders: before the screen-reader answer nothing starts, and no pin is shown half-way', async () => {
  const h = await gate({ profile: profile('alerts'), reducedMotion: false, motionReady: false });
  for (const key of ['cards-3', 'bills-1', 'bills0', 'cards0']) {
    assert.equal(opacity(find(h, `onboarding-remind-pin-${key}`)), 0, `${key}: waits to drop in`);
  }
});

test('Reminders: the Daily summary card and switch use band tokens, the same way in light and dark', async () => {
  for (const scheme of ['light', 'dark']) {
    const h = await gate({ profile: profile('alerts'), scheme });
    const theme = load(path.join(root, 'src/constants/theme.ts'), {
      '@/global.css': {}, 'react-native': { Platform: { select: (values) => values.ios ?? values.default } },
    });
    const band = theme.bandPalette('bills', scheme);
    const card = flat(h.byTestID('onboarding-remind-daily').props.style);
    assert.equal(card.backgroundColor, band.tile, `${scheme}: the band's own tone, not the inverting primary fill`);
    const toggle = h.byTestID('onboarding-remind-daily-switch').props;
    assert.deepEqual(plain(toggle.trackColor), { true: band.onBand, false: band.bandMark });
    assert.equal(toggle.thumbColor, band.band);
    assert.equal(toggle.activeThumbColor, band.band, `${scheme}: react-native-web's on knob too, not its default teal`);
  }
});
