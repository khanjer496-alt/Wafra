'use strict';
// The Widgets screen, its previews, the Android pin bridge, the Home hint's
// gating and the copy behind them. Previews must draw the snapshot the real
// widgets get (never a typed-in figure); the pin button exists only on Android
// and only when the launcher supports pinning; the hint appears only after a
// week of automatic capture and never after it was dismissed or Widgets was
// opened.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const build = (name) => require(path.join(__dirname, '../build', `${name}.js`));
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.ios ?? x.default } } });
const { widgetsCopyTables, widgetsCopy } = load(path.join(root, 'src/lib/widgets-copy.ts'));
const preview = load(path.join(root, 'src/lib/widget-preview.ts'));
const logoApi = load(path.join(root, 'src/lib/widget-logo.ts'));
const snapshotApi = load(path.join(root, 'src/lib/widget-snapshot.ts'), { '@/lib/widget-logo': logoApi });
const hint = load(path.join(root, 'src/lib/widgets-hint.ts'), {
  '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => null, setItem: async () => {} } },
});
const ARABIC = /[؀-ۿ]/;

// ── The real ledger → snapshot path (the one Home's widget sync uses) ──────
function realWidgetLedger() {
  const deps = {};
  const lazy = (name, make) => Object.defineProperty(deps, name, { enumerable: true, configurable: true, get() {
    const value = make();
    Object.defineProperty(deps, name, { value, enumerable: true, configurable: true });
    return value;
  } });
  for (const name of ['categories', 'format', 'ledger', 'period', 'splits']) lazy(`@/lib/${name}`, () => build(name));
  lazy('@/lib/home-today', () => load(path.join(root, 'src/lib/home-today.ts'), deps));
  lazy('@/lib/widget-snapshot', () => snapshotApi);
  lazy('@/lib/dashboard-projection', () => load(path.join(root, 'src/lib/dashboard-projection.ts'), {
    '@/lib/accuracy': build('accuracy'), '@/lib/analytics': build('analytics'), '@/lib/cash-flow': build('cash-flow'),
    '@/lib/fx-summary': build('fx-summary'), '@/lib/insights': build('insights'), '@/lib/leaving-soon': build('leaving-soon'),
    '@/lib/ledger': build('ledger'), '@/lib/transfer-activity': build('transfer-activity'), '@/lib/transfer-reconciliation': build('transfer-reconciliation'), '@/lib/period': build('period'), '@/lib/uncategorised': build('uncategorised'),
  }));
  return load(path.join(root, 'src/lib/widget-ledger.ts'), deps);
}

const NOW = new Date(2026, 8, 26, 12, 0, 0); // Saturday 26 September 2026
const tx = (id, title, amountFils, category, date) => ({ id, title, amountFils, category, date, accountId: 'bank', type: 'expense', source: 'sms' });
function ledgerState(overrides = {}) {
  return {
    hydrated: true, onboarded: true, privateMode: false, language: 'en', marketId: 'AE',
    accounts: [{ id: 'bank', kind: 'bank', name: 'Everyday', openingFils: 0 }],
    transactions: [
      tx('t1', 'Careem', 2950, 'transport', '2026-09-26'),
      tx('t2', 'Carrefour', 21485, 'groceries', '2026-09-26'),
      tx('t3', 'Starbucks', 1100, 'dining', '2026-09-25'),
    ],
    budgets: [],
    bills: [{ id: 'b1', title: 'DEWA', category: 'utilities', amountFils: 38000, dueDay: 29, paidMonths: [] }],
    cardDues: [], notSubscriptions: [], cancelledSubscriptions: [], merchantOverrides: {}, billAliases: {},
    transferInternalIds: [], historyImport: null,
    ...overrides,
  };
}
const money = { currency: 'AED', exponent: 2 };

test('the snapshot the Widgets screen previews is the one built from the ledger, figures unchanged', () => {
  const { widgetSnapshotForLedger } = realWidgetLedger();
  const snapshot = widgetSnapshotForLedger({ state: ledgerState(), now: NOW, moneySpec: money, language: 'en' });
  assert.equal(snapshot.todayMinor, 2950 + 21485, 'today is the sum of today’s spending');
  assert.equal(snapshot.todayCount, 2);
  assert.equal(snapshot.last7Minor.length, 7);
  assert.equal(snapshot.last7Minor[5], 1100, 'yesterday is the day before today');
  assert.equal(snapshot.leftInBudgetsMinor, null, 'no budgets, no budget line');
  assert.deepEqual(snapshot.bills.map((bill) => [bill.title, bill.amountMinor, bill.dueISO, bill.estimated]),
    [['DEWA', 38000, '2026-09-29', true]], 'a bill is a projection, so it is estimated');
  assert.equal(snapshot.hidden, false);
  assert.equal(snapshot.amountsSensitive, true, 'the Lock Screen and StandBy still redact');
});

test('no snapshot is previewed when the app writes none (private mode, not onboarded, not loaded)', () => {
  const { widgetSnapshotForLedger } = realWidgetLedger();
  for (const patch of [{ privateMode: true }, { onboarded: false }, { hydrated: false }]) {
    assert.equal(widgetSnapshotForLedger({ state: ledgerState(patch), now: NOW, moneySpec: money, language: 'en' }), null, JSON.stringify(patch));
  }
});

test('Home hands the widgets the same inputs through the shared helpers', () => {
  const home = read('src/screens/journal-home-screen.tsx');
  assert.match(home, /upcoming: widgetUpcomingInput\(payments\)/);
  assert.match(home, /return widgetMonthToday\(\{/);
  assert.match(home, /if \(state\.privateMode\) \{ clearWidgetSnapshot\(\); return; \}/, 'private mode still clears the widgets');
  assert.match(home, /hideAmounts: false/);
});

// ── Pure preview rules mirror the native widgets ───────────────────────────
function fixtureSnapshot(patch = {}) {
  return {
    version: 1, generatedAt: NOW.getTime(), language: 'en', todayISO: '2026-09-26', currency: 'AED', exponent: 2,
    amountsSensitive: true, hidden: false, todayMinor: 2400, todayCount: 3,
    last7Minor: [0, 1000, 500, null, 2000, 0, 2400], leftInBudgetsMinor: 36000, perDayMinor: 1200, budgetsOver: 0,
    bills: [
      { title: 'Rent', amountMinor: 450000, estimated: true, dueISO: '2026-09-25' },
      { title: 'DEWA', amountMinor: 38000, estimated: true, dueISO: '2026-09-27' },
      { title: '•••• 1234', amountMinor: 120050, estimated: false, dueISO: '2026-09-26' },
      { title: 'du', amountMinor: 30000, estimated: true, dueISO: '2026-10-05' },
      { title: 'Netflix', amountMinor: 4500, estimated: true, dueISO: '2026-10-06' },
    ],
    ...patch,
  };
}

test('amounts print as the widgets print them: CUR 1,234.56, exponent digits, Latin digits, dash when hidden', () => {
  const s = fixtureSnapshot();
  assert.equal(preview.widgetMoneyText(123456789, s), 'AED 1,234,567.89');
  assert.equal(preview.widgetMoneyText(5, s), 'AED 0.05');
  assert.equal(preview.widgetMoneyText(-4000, s), 'AED -40.00');
  assert.equal(preview.widgetMoneyText(1234, { ...s, currency: 'JPY', exponent: 0 }), 'JPY 1,234');
  assert.equal(preview.widgetMoneyText(1234, { ...s, currency: 'KWD', exponent: 3 }), 'KWD 1.234');
  assert.equal(preview.widgetMoneyText(null, s), '—');
  assert.equal(preview.widgetMoneyText(2400, { ...s, hidden: true }), '—');
});

test('Coming up lists bills from today on, at most three, with the native due words and tiles', () => {
  const s = fixtureSnapshot();
  const words = widgetsCopy('en');
  const bills = preview.widgetUpcomingBills(s);
  assert.deepEqual(bills.map((b) => b.title), ['DEWA', '•••• 1234', 'du'], 'past bills drop, three at most');
  assert.equal(preview.widgetDueLabel('2026-09-26', s.todayISO, words), 'Today');
  assert.equal(preview.widgetDueLabel('2026-09-27', s.todayISO, words), 'Tomorrow');
  assert.equal(preview.widgetDueLabel('2026-09-29', s.todayISO, words), 'Tuesday');
  assert.equal(preview.widgetDueLabel('2026-10-05', s.todayISO, words), 'Mon 5 Oct', 'a weekday never means next week');
  assert.equal(preview.widgetDueLabel('2026-10-05', s.todayISO, widgetsCopy('ar')), 'الاثنين 5 أكتوبر');
  assert.equal(preview.widgetInitial('DEWA'), 'D');
  assert.equal(preview.widgetInitial('•••• 1234'), null, 'a masked card gets the calendar glyph, not a digit');
  assert.equal(preview.widgetInitial('كهرباء'), 'ك');
  assert.equal(preview.widgetBillAmount(bills[0], s), '≈ AED 380.00');
  assert.equal(preview.widgetBillAmount(bills[1], s), 'AED 1,200.50', 'a card statement is exact');
  assert.equal(preview.widgetBillAmount(bills[0], { ...s, hidden: true }), '—');
});

test('Today’s line: left or over budgets when set, otherwise the payment count, with correct plurals', () => {
  const en = widgetsCopy('en');
  const ar = widgetsCopy('ar');
  assert.equal(preview.widgetTodayLine(fixtureSnapshot(), en), 'AED 360.00 left in budgets');
  assert.equal(preview.widgetTodayLine(fixtureSnapshot({ leftInBudgetsMinor: -4000 }), en), 'AED 40.00 over budgets');
  assert.equal(preview.widgetTodayLine(fixtureSnapshot({ leftInBudgetsMinor: null }), en), '3 payments');
  assert.equal(preview.widgetTodayLine(fixtureSnapshot({ leftInBudgetsMinor: null, todayCount: 1 }), en), '1 payment');
  assert.equal(preview.widgetTodayLine(fixtureSnapshot({ hidden: true }), en), '3 payments', 'no budget line when amounts are hidden');
  assert.deepEqual([0, 1, 2, 3, 10, 11].map((n) => ar.widgetPayments(n)),
    ['لا دفعات بعد', 'دفعة واحدة', 'دفعتان', '3 دفعات', '10 دفعات', '11 دفعة']);
  assert.equal(preview.widgetTodayLine(fixtureSnapshot(), ar), 'المتبقي في الميزانيات AED 360.00');
});

test('week bars are relative to the week’s largest day and never draw a hidden figure', () => {
  assert.deepEqual(preview.widgetWeekShares(fixtureSnapshot()), [0, 1000 / 2400, 500 / 2400, 0, 2000 / 2400, 0, 1]);
  assert.deepEqual(preview.widgetWeekShares(fixtureSnapshot({ hidden: true })), [0, 0, 0, 0, 0, 0, 0]);
});

// ── The screen ─────────────────────────────────────────────────────────────
const walk = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const strings = (node) => !node ? [] : typeof node === 'string' ? [node] : typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(strings) : strings(node.props?.children);

async function screen({ platform = 'ios', pinnable = false, pinResult = true, language = 'en', state = ledgerState(), realLedger = false, scheme = 'light', snapshotOverride } = {}) {
  const slots = [], effects = [], events = [];
  let cursor = 0;
  const slot = (create) => slots[cursor++] ?? (slots[cursor - 1] = create());
  const react = {
    useRef: (value) => slot(() => ({ current: value })),
    useState(value) { const s = slot(() => ({ value: typeof value === 'function' ? value() : value })); return [s.value, (x) => { s.value = typeof x === 'function' ? x(s.value) : x; }]; },
    useMemo(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.deps = deps; s.value = fn(); } return s.value; },
    useEffect(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.deps = deps; effects.push(() => { s.cleanup?.(); s.cleanup = fn(); }); } },
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props ?? {}) : ({ type, props: props ?? {} });
  const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const native = { Platform: { OS: platform }, StyleSheet: { create: (x) => x, hairlineWidth: 1 }, View: 'View' };
  const snapshots = [];
  const ledger = realLedger ? realWidgetLedger() : null;
  const previews = load(path.join(root, 'src/components/widgets/widget-previews.tsx'), {
    react, 'react/jsx-runtime': runtime, 'react-native': native,
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/ui/icon': { Icon: 'Icon' },
    '@/constants/theme': theme, '@/lib/widget-preview': preview,
    'expo-image': { Image: 'Image' }, '@/lib/widget-logo': logoApi,
    '@/components/ui/merchant-logo-assets': { merchantLogoFor: title => { const id = logoApi.widgetLogoIdFor(title); return id ? { id, source: 1 } : null; } },
  });
  const component = load(path.join(root, 'src/app/widgets.tsx'), {
    react, 'react/jsx-runtime': runtime, 'react-native': native,
    'expo-router': { useRouter: () => ({ back: () => events.push(['back']), canGoBack: () => true, replace: (to) => events.push(['replace', to]) }) },
    '@/components/capture/sheet-link-row': { SheetSectionTitle: (p) => jsx('SectionTitle', p) },
    '@/components/settings-band/band-title': { BandTitle: (p) => jsx('BandTitle', p) },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/ui/band-scaffold': { BandScaffold: (p) => jsx('Scaffold', { ...p, children: [p.bandContent, p.children] }) },
    '@/components/ui/band/e-button': { EButton: 'Button' },
    '@/components/widgets/widget-previews': previews,
    '@/components/widgets/widget-history': { WidgetHistory: 'WidgetHistory' },
    '@/hooks/use-band': { useBand: (id) => theme.BandPalettes[scheme][id], useBandScheme: () => scheme },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/constants/theme': theme,
    '@/lib/ledger-money': { ledgerMoneySpec: (currency) => ({ currency, exponent: 2 }) },
    '@/lib/markets': { marketCurrencyCode: () => 'AED' },
    '@/lib/store': { useStore: () => ({ state }) },
    '@/lib/widget-ledger': { widgetSnapshotForLedger: (input) => {
      const value = ledger ? ledger.widgetSnapshotForLedger(input) : fixtureSnapshot({ language: input.language, ...snapshotOverride });
      snapshots.push(value);
      return value;
    } },
    '@/lib/widgets-hint': { markWidgetsHintDone: async (done) => { events.push(['hint', done]); } },
    '@/lib/widgets-copy': { widgetsCopy },
    '../../modules/wafra-widgets': {
      canPinWidgets: () => pinnable,
      pinWidget: async (kind) => { events.push(['pin', kind]); return pinResult; },
    },
  }, { Date: class extends Date { constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); } static now() { return NOW.getTime(); } } }).default;
  let tree;
  const render = () => { cursor = 0; tree = component(); for (const effect of effects.splice(0)) effect(); };
  const flush = async () => { for (let i = 0; i < 3; i++) { await new Promise((r) => setImmediate(r)); render(); } };
  render(); await flush();
  const find = (testID) => walk(tree).find((node) => node.props?.testID === testID);
  return { events, snapshots, flush, find, tree: () => tree, text: (node = tree) => strings(node).join(' '),
    buttons: () => walk(tree).filter((node) => node.type === 'Button') };
}

test('previews draw the snapshot’s own figures in the widgets’ bands', async () => {
  const s = await screen({ realLedger: true });
  const snapshot = s.snapshots.at(-1);
  const today = s.find('widgets-preview-today');
  assert.equal(today.props.style[1].backgroundColor, theme.BandPalettes.light.home.band, 'Today wears the ink band');
  const upcoming = s.find('widgets-preview-upcoming');
  assert.equal(upcoming.props.style[1].backgroundColor, theme.BandPalettes.light.bills.band, 'Coming up wears the ochre band');
  assert.equal(s.text(s.find('widgets-preview-today-amount')).replace(/\u200E/g, '').replace(/\s+/g, ' ').trim(), 'AED 244.35');
  assert.equal(preview.widgetMoneyText(snapshot.todayMinor, snapshot), 'AED 244.35');
  assert.equal(s.text(s.find('widgets-preview-today-line')), '2 payments');
  const upcomingText = s.text(upcoming);
  assert.match(upcomingText, /DEWA/);
  assert.match(upcomingText, /Tuesday/);
  assert.match(upcomingText, /≈ AED 380\.00/);
  // Every figure on the screen is one the snapshot carries.
  const figures = s.text().match(/\d[\d,]*\.\d{2}/g) ?? [];
  const allowed = new Set([snapshot.todayMinor, preview.widgetWeekTotal(snapshot), ...snapshot.bills.map((b) => b.amountMinor)]
    .map((minor) => preview.widgetNumber(minor, 2)));
  for (const figure of figures) assert.ok(allowed.has(figure), `${figure} comes from the snapshot`);
  assert.ok(today.props.accessibilityLabel.includes('AED 244.35'), 'the preview speaks its figure');
});

test('dark scheme previews use the deepened bands', async () => {
  const s = await screen({ scheme: 'dark' });
  assert.equal(s.find('widgets-preview-today').props.style[1].backgroundColor, theme.BandPalettes.dark.home.band);
  assert.equal(s.find('widgets-preview-upcoming').props.style[1].backgroundColor, theme.BandPalettes.dark.bills.band);
});

test('with no snapshot (private mode) the previews show the widgets’ own update state and say why', async () => {
  const s = await screen({ realLedger: true, state: ledgerState({ privateMode: true }) });
  assert.match(s.text(s.find('widgets-preview-today')), /Open Wafra to update/);
  assert.match(s.text(s.find('widgets-preview-upcoming')), /Open Wafra to update/);
  assert.ok(s.find('widgets-private-note'));
  assert.equal((s.text().match(/\d[\d,]*\.\d{2}/g) ?? []).length, 0, 'no figure at all');
});

test('iOS: three honest steps, the Lock Screen note, and no add button', async () => {
  const s = await screen({ platform: 'ios', pinnable: true });
  assert.equal(s.buttons().length, 0, 'Apple provides no API to add a widget');
  assert.ok(s.find('widgets-lock-note'));
  const steps = widgetsCopy('en').steps('ios');
  assert.equal(steps.length, 3);
  assert.match(steps[0], /Touch and hold/);
  assert.match(steps[1], /Edit.*Add Widget/);
  assert.match(steps[2], /Search for Wafra/);
  for (const step of steps) assert.ok(s.text(s.find('widgets-how-to')).includes(step));
  assert.deepEqual(s.events, [['hint', 'opened']], 'opening Widgets retires the Home hint');
});

test('Android with a pinning launcher: one add button per widget, each pins its own provider', async () => {
  const s = await screen({ platform: 'android', pinnable: true });
  assert.deepEqual(s.buttons().map((b) => b.props.testID), ['widgets-pin-today', 'widgets-pin-upcoming']);
  assert.equal(s.find('widgets-how-to'), undefined, 'the launcher’s own dialog replaces the manual steps');
  assert.equal(s.find('widgets-lock-note'), undefined, 'StandBy and the Lock Screen are iPhone words');
  s.find('widgets-pin-upcoming').props.onPress();
  await s.flush();
  assert.deepEqual(s.events.filter((e) => e[0] === 'pin'), [['pin', 'upcoming']]);
  s.find('widgets-pin-today').props.onPress();
  await s.flush();
  assert.deepEqual(s.events.filter((e) => e[0] === 'pin'), [['pin', 'upcoming'], ['pin', 'today']]);
});

test('Android: an unsupported launcher gets the manual steps and no button; a refused request falls back too', async () => {
  const unsupported = await screen({ platform: 'android', pinnable: false });
  assert.equal(unsupported.buttons().length, 0);
  assert.ok(unsupported.find('widgets-how-to'));
  assert.ok(unsupported.text(unsupported.find('widgets-how-to')).includes(widgetsCopy('en').steps('android')[1]));

  const refused = await screen({ platform: 'android', pinnable: true, pinResult: false });
  refused.find('widgets-pin-today').props.onPress();
  await refused.flush();
  assert.ok(refused.find('widgets-pin-failed'));
  assert.ok(refused.find('widgets-how-to'));
});

test('Arabic screen reads Arabic', async () => {
  const s = await screen({ language: 'ar', platform: 'android', pinnable: false });
  assert.match(s.text(s.find('widgets-how-to')), /الشاشة الرئيسية/);
  assert.equal(s.find('widgets-title')?.props.title, 'الأدوات');
});

// ── Native bridge ──────────────────────────────────────────────────────────
test('the JS bridge returns false wherever pinning is not available', async () => {
  const bridge = (os, nativeModule) => load(path.join(root, 'modules/wafra-widgets/index.ts'), {
    'react-native': { Platform: { OS: os } },
    'expo-modules-core': { requireOptionalNativeModule: () => nativeModule },
  });
  const old = bridge('android', { setSnapshot() {}, clearSnapshot() {} });
  assert.equal(old.canPinWidgets(), false, 'an older binary has no pin functions');
  assert.equal(await old.pinWidget('today'), false);
  const ios = bridge('ios', { setSnapshot() {}, clearSnapshot() {}, canPinWidgets: () => true, pinWidget: async () => true });
  assert.equal(ios.canPinWidgets(), false, 'iOS never pins');
  assert.equal(await ios.pinWidget('today'), false);
  const none = bridge('android', null);
  assert.equal(none.canPinWidgets(), false);
  const throwing = bridge('android', { canPinWidgets: () => { throw new Error('x'); }, pinWidget: async () => { throw new Error('x'); } });
  assert.equal(throwing.canPinWidgets(), false);
  assert.equal(await throwing.pinWidget('upcoming'), false);
  const calls = [];
  const android = bridge('android', { canPinWidgets: () => true, pinWidget: async (kind) => { calls.push(kind); return true; } });
  assert.equal(android.canPinWidgets(), true);
  assert.equal(await android.pinWidget('upcoming'), true);
  assert.deepEqual(calls, ['upcoming']);
});

test('Kotlin pins exactly the two providers, only where the launcher supports it', () => {
  const kotlin = read('modules/wafra-widgets/android/src/main/java/expo/modules/wafrawidgets/WafraWidgetsModule.kt');
  assert.match(kotlin, /Function\("canPinWidgets"\)/);
  assert.match(kotlin, /AsyncFunction\("pinWidget"\) \{ kind: String ->/);
  assert.match(kotlin, /"today" -> TodayWidgetProvider::class\.java/);
  assert.match(kotlin, /"upcoming" -> UpcomingWidgetProvider::class\.java/);
  assert.match(kotlin, /else -> return@AsyncFunction false/);
  assert.match(kotlin, /isRequestPinAppWidgetSupported/);
  assert.match(kotlin, /Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.O\) return@AsyncFunction false/);
  assert.match(kotlin, /requestPinAppWidget\(ComponentName\(context, provider\), null, null\)/);
});

// ── Home hint gating ───────────────────────────────────────────────────────
const eligible = (patch = {}) => hint.widgetsHintEligible({
  hydrated: true, onboarded: true, captureSetUp: true, captureStopped: false, firstDays: false,
  oldestCaptureISO: '2026-09-19', todayISO: '2026-09-26', platformHasWidgets: true, done: null, ...patch,
});

test('the hint needs seven days of captured history', () => {
  assert.equal(eligible(), true, 'exactly seven days');
  assert.equal(eligible({ oldestCaptureISO: '2026-09-20' }), false, 'six days is not a week');
  assert.equal(eligible({ oldestCaptureISO: '2026-08-01' }), true);
  assert.equal(eligible({ oldestCaptureISO: null }), false, 'no automatic capture yet');
  assert.equal(eligible({ oldestCaptureISO: 'garbage' }), false);
  assert.equal(eligible({ oldestCaptureISO: '2026-09-30' }), false, 'a future-dated row is not history');
  assert.equal(hint.daysBetweenISO('2026-02-27', '2026-03-06'), 7, 'across a month end');
});

test('the hint never shows once dismissed or once Widgets was opened, nor while the mark loads', () => {
  assert.equal(eligible({ done: 'dismissed' }), false);
  assert.equal(eligible({ done: 'opened' }), false);
  assert.equal(eligible({ done: undefined }), false, 'hidden until the stored mark is read: no flash');
});

test('the hint stays out of onboarding, the first days and a stopped or absent capture', () => {
  assert.equal(eligible({ onboarded: false }), false, 'onboarding');
  assert.equal(eligible({ hydrated: false }), false);
  assert.equal(eligible({ firstDays: true }), false, 'first-week progress, history import or fill-the-past');
  assert.equal(eligible({ captureStopped: true }), false, 'capture stopped');
  assert.equal(eligible({ captureSetUp: false }), false, 'capture off or not set up');
  assert.equal(eligible({ platformHasWidgets: false }), false, 'web has no widgets');
});

test('only automatic captures count as captured history', () => {
  const rows = [
    { date: '2026-09-25', live: true }, { date: '2026-01-01', live: false }, { date: '2026-09-10', live: true },
  ];
  assert.equal(hint.oldestLiveCaptureISO(rows, (row) => row.live), '2026-09-10', 'a statement row from January does not count');
  assert.equal(hint.oldestLiveCaptureISO([], () => true), null);
});

test('marking done persists, tells a mounted Home at once, and a broken store never nags', async () => {
  const stored = new Map();
  const api = load(path.join(root, 'src/lib/widgets-hint.ts'), { '@react-native-async-storage/async-storage': { __esModule: true, default: {
    getItem: async (key) => stored.get(key) ?? null, setItem: async (key, value) => { stored.set(key, value); },
  } } });
  assert.equal(await api.loadWidgetsHintDone(), null);
  const told = [];
  const stop = api.subscribeWidgetsHintDone((done) => told.push(done));
  await api.markWidgetsHintDone('opened', 1_000);
  stop();
  await api.markWidgetsHintDone('dismissed', 2_000);
  assert.deepEqual(told, ['opened']);
  assert.equal(await api.loadWidgetsHintDone(), 'dismissed');
  const broken = load(path.join(root, 'src/lib/widgets-hint.ts'), { '@react-native-async-storage/async-storage': { __esModule: true, default: {
    getItem: async () => { throw new Error('io'); }, setItem: async () => { throw new Error('io'); },
  } } });
  assert.equal(await broken.loadWidgetsHintDone(), 'dismissed');
  await broken.markWidgetsHintDone('opened');
});

test('Home places one hint, fed Home’s own capture and first-days state', () => {
  const home = read('src/screens/journal-home-screen.tsx');
  assert.match(home, /<WidgetsHint hydrated=\{state\.hydrated\} onboarded=\{state\.onboarded\} captureSetUp=\{captureSetUp\}\s+captureStopped=\{captureStopped\} firstDays=\{moneyPicture !== null \|\| history !== null \|\| offerPast\}/);
  assert.equal((home.match(/<WidgetsHint /g) ?? []).length, 1);
  const component = read('src/components/widgets/widgets-hint.tsx');
  assert.match(component, /router\.push\('\/widgets'\)/);
  assert.match(component, /markWidgetsHintDone\('dismissed'\)/);
  assert.match(component, /isLiveCapture/);
});

// ── Route and entry points ─────────────────────────────────────────────────
test('the Widgets route exists and both entry points reach it', () => {
  assert.ok(fs.existsSync(path.join(root, 'src/app/widgets.tsx')));
  assert.match(read('src/app/widgets.tsx'), /export default function WidgetsScreen/);
  const settings = read('src/app/settings.tsx');
  assert.match(settings, /Platform\.OS !== 'web' && linkRow\(\s*widgetWords\.settingsTitle,[\s\S]{0,160}router\.push\('\/widgets'\),\s*\{ icon: 'home', testID: 'settings-widgets' \}/);
  // In the personalisation group, beside Customize Home.
  const preferences = settings.slice(settings.indexOf("t('settingsPreferencesHeader')"), settings.indexOf('settings-region'));
  assert.ok(preferences.includes('widgetWords.settingsTitle'));
  assert.match(read('src/components/app-root-layout.tsx'), /<Stack\.Screen name="widgets"/);
});

// ── Copy ───────────────────────────────────────────────────────────────────
test('English and Arabic widget copy carry the same keys, kinds and arity', () => {
  const { en, ar } = widgetsCopyTables;
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof ar[key], typeof en[key], key);
    if (typeof en[key] === 'function') assert.equal(ar[key].length, en[key].length, `${key} arity`);
    if (Array.isArray(en[key])) assert.equal(ar[key].length, en[key].length, `${key} length`);
  }
  assert.equal(widgetsCopy('ar'), ar);
  assert.equal(widgetsCopy('fr'), en);
});

test('every Arabic string is Arabic and every English string is not', () => {
  const { en, ar } = widgetsCopyTables;
  const sample = (value) => typeof value === 'function'
    ? [].concat(value.length === 2 ? [value('ios', 'today'), value('android', 'upcoming')] : [value('ios'), value('android'), value(3), value('AED 1.00')])
    : [].concat(value);
  for (const key of Object.keys(en)) {
    for (const text of sample(en[key]).flat()) assert.ok(typeof text === 'string' && !ARABIC.test(text), `${key} en: ${text}`);
    for (const text of sample(ar[key]).flat()) {
      const numeric = /^[\d ×]+$/.test(text);
      assert.ok(ARABIC.test(text) || numeric, `${key} ar: ${text}`);
    }
  }
});

test('the small Today widget shows an exact complete seven-day total without an unlabeled graph', () => {
  const snapshot = fixtureSnapshot({ last7Minor: [1, 2, 3, 4, 5, 6, 7] });
  assert.equal(preview.widgetWeekTotal(snapshot), 28);
  assert.equal(preview.widgetMoneyText(preview.widgetWeekTotal(snapshot), snapshot), 'AED 0.28');
  assert.equal(preview.widgetWeekTotal({ ...snapshot, hidden: true }), null);
  assert.equal(preview.widgetWeekTotal({ ...snapshot, last7Minor: [1, 2] }), null);
  assert.equal(preview.widgetWeekTotal({ ...snapshot, last7Minor: [1, 2, 3, null, 5, 6, 7] }), null);
  assert.equal(preview.widgetWeekTotal({ ...snapshot, last7Minor: [Number.MAX_SAFE_INTEGER, 1, 0, 0, 0, 0, 0] }), null);
  const source = read('src/components/widgets/widget-previews.tsx');
  assert.doesNotMatch(source, /WeekBars|styles\.bars/);
  assert.match(source, /widgetLast7Total/);
  assert.match(source, /Image source=\{row\.logo\.source\}/);
});


test('subscription preview logos match native allowlisted snapshot identities with old-snapshot fallback', async () => {
  const bill = { title: 'Netflix', amountMinor: 3900, estimated: true, dueISO: '2026-09-27' };
  const withLogo = await screen({ snapshotOverride: { bills: [{ ...bill, logoId: 'netflix' }] } });
  assert.equal(walk(withLogo.find('widgets-preview-upcoming')).filter(n => n.type === 'Image').length, 1);
  for (const logoId of [undefined, 'unknown', '../netflix']) {
    const withoutLogo = await screen({ snapshotOverride: { bills: [{ ...bill, logoId }] } });
    assert.equal(walk(withoutLogo.find('widgets-preview-upcoming')).filter(n => n.type === 'Image').length, 0);
    assert.ok(withoutLogo.text(withoutLogo.find('widgets-preview-upcoming')).includes('Netflix'));
  }
});
