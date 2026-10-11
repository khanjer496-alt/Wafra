'use strict';
// Home's coin motion from real figures: a coin per payment today, a column per
// day of the daily average, money in against spending as two stacks, and a
// brief arrival for a capture that lands at the top of Recent transactions.
// Every drawing is decoration hidden from assistive tech; the written figures
// and spoken labels stay exactly as they were. Synthetic ledger only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
const hidden = (node) => node.props.importantForAccessibility === 'no-hide-descendants' && node.props.accessibilityElementsHidden === true;
// The harness shows Reduce Motion: a gold coin at full opacity, an empty place not at all.
const gold = (stack, prefix) => walk(stack)
  .filter((node) => new RegExp(`^${prefix}-coin-\\d+$`).test(node.props?.testID ?? ''))
  .map((node) => [node.props.style].flat(2).find((style) => style && style.opacity)?.opacity?.value === 1);
const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const home = (options = {}) => createHarness({ platform: 'ios', ...options }).render('home');
const summary = () => createHarness().deps['@/components/reference-home-summary'];
const expense = (id, date, amountFils, category = 'dining') =>
  ({ id, title: id, amountFils, category, date, type: 'expense', accountId: 'enbd', source: 'sms' });

test('pure counts: today never draws more coins than payments, and caps at six', () => {
  const { todayCoinCount, averageColumnCoins, flowStackCoins } = summary();
  assert.deepEqual([...[0, 1, 2, 5, 6, 7, 40, -1, NaN].map(todayCoinCount)], [0, 1, 2, 5, 6, 6, 6, 0, 0]);
  // The biggest day fills its column; any spending shows a coin; none shows none.
  assert.deepEqual([...averageColumnCoins([0, 0, 62000, 48000, 42000, 204000])], [0, 0, 2, 1, 1, 5]);
  assert.deepEqual([...averageColumnCoins([0, 0])], [0, 0]);
  assert.deepEqual([...averageColumnCoins([1, 1000])], [1, 5], 'a little money is never drawn as none');
  // In and Spent against the larger; the gap is the net.
  assert.deepEqual({ ...flowStackCoins(178_400, 1_558_734) }, { income: 1, spent: 6 });
  assert.deepEqual({ ...flowStackCoins(830_000, 536_000) }, { income: 6, spent: 4 });
  assert.deepEqual({ ...flowStackCoins(0, 50_000) }, { income: 0, spent: 6 }, 'no money in is an empty stack');
  assert.equal(flowStackCoins(0, 0), null, 'nothing moved, nothing drawn');
  assert.deepEqual({ ...flowStackCoins(-5, 100) }, { income: 0, spent: 6 });
});

test('home-today: averageDays are exactly the days and amounts the daily average divides', () => {
  const today = load(path.join(root, 'src/lib/home-today.ts'));
  const rows = [
    expense('a', '2026-09-03', 1000), expense('b', '2026-09-03', 500), expense('rent', '2026-09-02', 90000, 'rent'),
    expense('c', '2026-09-05', 2500), expense('future', '2026-09-08', 7000), expense('old', '2026-08-31', 4000),
  ];
  const run = (window) => today.summarizeHomeToday({
    transactions: rows, budgets: [], now: new Date(2026, 8, 5, 10), isSpending: (tx) => tx.type === 'expense',
    inBudgetPeriod: () => false, budgetPeriodStartISO: null, budgetPeriodEndISO: null,
    allocations: (tx) => [{ category: tx.category, amountFils: tx.amountFils }],
    isFixedCommitment: (category) => category === 'rent', averageWindow: window,
  });
  const current = run({ startISO: '2026-09-01', endISO: '2026-09-30' });
  assert.deepEqual([...current.averageDays], [0, 0, 1500, 0, 2500], 'one entry per elapsed day; rent and later days left out');
  assert.equal(current.averageDays.length, current.average.days);
  assert.equal(current.average.fils, Math.floor(current.averageDays.reduce((a, b) => a + b, 0) / current.average.days));
  const past = run({ startISO: '2026-08-01', endISO: '2026-08-31' });
  assert.equal(past.averageDays.length, 31);
  assert.equal(past.averageDays[30], 4000);
  assert.equal(run(null).averageDays, null);
  assert.equal(run({ startISO: '2026-10-01', endISO: '2026-10-31' }).averageDays, null, 'a period not started has none');
});

test('Today: a coin per payment today beside the written figure, hidden from assistive tech', () => {
  const tree = home();
  const tile = byId(tree, 'home-today-total');
  const stack = byId(tile, 'home-today-coins');
  assert.ok(stack, 'the coins sit in the Today tile');
  assert.ok(hidden(stack));
  // Harness: utilities, entertainment and other spending on 6 September.
  assert.deepEqual(gold(stack, 'home-today-coins'), [true, true, true]);
  // It stands on the tile's own bottom end, beside the payment count, not up on the figure's line.
  const parent = walk(tile).find((node) => [node.props?.children].flat(Infinity).includes(stack));
  assert.equal(parent, tile.props.children, 'a direct child of the tile, not of the figure');
  const place = flat(stack.props.style);
  assert.deepEqual([place.position, place.end, place.bottom], ['absolute', 14, 10]);
  assert.equal(tile.props.accessibilityLabel, 'Today, AED 2,040. 3 payments');
  assert.match(text(tile), /2,040/);
});

test('Today: no payments draws no coins; many payments stop at six; Larger Text draws none', () => {
  const quiet = home({ state: { transactions: [expense('x', '2026-09-03', 1000)] } });
  assert.ok(byId(quiet, 'home-today-total'));
  assert.equal(byId(quiet, 'home-today-coins'), undefined);
  const busy = home({ state: { transactions: Array.from({ length: 9 }, (_, i) => expense(`t${i}`, '2026-09-06', 100 + i)) } });
  assert.equal(gold(byId(busy, 'home-today-coins'), 'home-today-coins').length, 6);
  assert.match(byId(busy, 'home-today-total').props.accessibilityLabel, /9 payments/);
  assert.equal(byId(home({ largeText: true }), 'home-today-coins'), undefined);
});

test('Daily average without a budget: a coin column per day it divides by, from the same figures', () => {
  const tree = home({ state: { budgets: [] } });
  const tile = byId(tree, 'home-left-to-spend');
  assert.equal(tile.props.accessibilityLabel, 'Daily average, AED 593.33. over 6 days, excluding rent and fixed costs');
  const row = byId(tile, 'home-average-columns');
  assert.ok(row);
  assert.ok(hidden(row));
  assert.equal(flat(row.props.style).flexDirection, 'row', 'oldest at the start; mirrors under right-to-left');
  const days = walk(row).filter((node) => /^home-average-columns-day-\d+$/.test(node.props?.testID ?? ''));
  assert.deepEqual(days.map((node) => node.props.testID), [0, 1, 2, 3, 4, 5].map((i) => `home-average-columns-day-${i}`));
  // 1–6 September: salary, rent (fixed), dining 620, transport 480, shopping 420, then 2,040 today.
  const { CoinColors } = createHarness().deps['@/constants/theme'];
  const coinsOf = (column) => {
    const parts = column.props.children.flat(2).filter(Boolean);
    const face = flat(parts.at(-1).props.style).backgroundColor;
    const lines = walk(column).filter((node) => flat(node.props?.style).opacity === 0.45).length;
    return face === CoinColors.face ? lines + 1 : 0;
  };
  assert.deepEqual(days.map(coinsOf), [0, 0, 2, 1, 1, 5]);
  // Reduce Motion: every column already stands in place.
  for (const column of days) {
    const rise = flat(column.props.style).transform[0].translateY;
    assert.equal(rise.value, 1);
  }
  // A budget, the set-a-budget offer, or Larger Text keep the tile as it was.
  assert.equal(byId(home(), 'home-average-columns'), undefined);
  assert.equal(byId(home({ empty: true }), 'home-average-columns'), undefined);
  assert.equal(byId(home({ largeText: true, state: { budgets: [] } }), 'home-average-columns'), undefined);
});

test('Daily average columns read the same order in Arabic, mirrored by the layout', () => {
  const tree = home({ language: 'ar', state: { budgets: [] } });
  const row = byId(tree, 'home-average-columns');
  assert.ok(row);
  assert.equal(flat(row.props.style).flexDirection, 'row');
  const styles = walk(row).map((node) => flat(node.props?.style));
  assert.equal(styles.some((style) => 'left' in style || 'right' in style), false, 'logical start/end only');
});

test('Month line: Spent and In each carry their coin stack beside their own label, scaled to the larger', () => {
  const tree = home();
  const line = byId(tree, 'journal-summary');
  const spentCell = byId(line, 'home-spending-total');
  const inCell = byId(line, 'home-income-summary');
  // Each stack sits inside its own figure's cell, next to the label it already has: the name is written once.
  const spent = byId(spentCell, 'home-flow-coins-spent');
  const income = byId(inCell, 'home-flow-coins-in');
  assert.ok(spent && income);
  assert.equal(byId(line, 'home-flow-coins'), undefined, 'no separate, separately labelled pair');
  assert.equal((text(line).match(/Spent/g) || []).length, 1, 'Spent is written once');
  assert.equal((text(line).match(/\bIn\b/g) || []).length, 1, 'In is written once');
  // Decorative: hidden from assistive tech; the cells speak as before.
  const wrapper = walk(spentCell).find((node) => node.props?.importantForAccessibility === 'no-hide-descendants');
  assert.ok(wrapper && hidden(wrapper));
  // Harness: AED 8,300 in, AED 5,360 spent: In fills its 6 coins, Spent 4.
  assert.equal(gold(income, 'home-flow-coins-in').filter(Boolean).length, 6);
  assert.equal(gold(spent, 'home-flow-coins-spent').filter(Boolean).length, 4);
  assert.equal(byId(line, 'home-net-summary').props.accessibilityLabel, 'Net, AED +2,940');
  assert.equal(walk(byId(line, 'home-net-summary')).some((node) => /home-flow-coins/.test(node.props?.testID ?? '')), false,
    'Net has no stack: it is the difference between the two');
  assert.equal(spentCell.props.accessibilityLabel, 'Spending, AED 5,360. View spending breakdown');
  assert.equal(inCell.props.accessibilityLabel, 'Income, AED 8,300');
  assert.match(text(line), /5,360/);
  // No money in: its stack is empty places; spending fills the other.
  const spentOnly = byId(home({ state: { transactions: [expense('x', '2026-09-03', 1000)] } }), 'journal-summary');
  assert.equal(gold(byId(spentOnly, 'home-flow-coins-in'), 'home-flow-coins-in').filter(Boolean).length, 0);
  assert.equal(gold(byId(spentOnly, 'home-flow-coins-in'), 'home-flow-coins-in').length, 6);
  assert.equal(gold(byId(spentOnly, 'home-flow-coins-spent'), 'home-flow-coins-spent').filter(Boolean).length, 6);
  // Nothing moved, or Larger Text: no stacks.
  assert.equal(byId(home({ empty: true }), 'home-flow-coins-spent'), undefined);
  assert.equal(byId(byId(home({ largeText: true }), 'journal-summary') ?? {}, 'home-flow-coins-spent'), undefined);
});

/** Home with hooks that persist across renders and effects that run after each, like React. */
function homeProbe(options = {}) {
  const h = createHarness({ platform: 'ios', ...options });
  let state = h.state;
  let period = { mode: 'month', key: '2026-09' };
  let cursor = 0;
  const slots = [];
  const effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory, dependencies) => {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].dependencies, dependencies)) slots[i] = { value: factory(), dependencies };
    return slots[i].value;
  };
  const effect = (work, dependencies) => {
    const i = cursor++;
    if (slots[i] && same(slots[i].dependencies, dependencies)) return;
    const previous = slots[i];
    const slot = slots[i] = { dependencies };
    effects.push(() => { previous?.cleanup?.(); slot.cleanup = work(); });
  };
  Object.assign(h.deps.react, {
    useMemo: memo, useCallback: (fn, dependencies) => memo(() => fn, dependencies),
    useRef: (initial) => memo(() => ({ current: initial }), []),
    useState: (initial) => {
      const cell = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
    useEffect: effect, startTransition: (work) => work(),
  });
  h.deps['@react-navigation/native'] = { useIsFocused: () => true, useFocusEffect: () => {} };
  const store = h.deps['@/lib/store'].useStore();
  h.deps['@/lib/store'] = { useStore: () => ({ ...store, state, getStateSnapshot: () => state }) };
  h.deps['@/lib/period-context'] = { usePeriod: () => ({ period, setPeriod() {} }) };
  // Recent transactions from the probe's own ledger and period, newest first.
  const projection = h.deps['@/lib/dashboard-projection'].projectDashboard;
  h.deps['@/lib/dashboard-projection'] = { projectDashboard: (request) => ({ ...projection(request),
    activityRows: request.state.transactions.filter((tx) => tx.date.slice(0, 7) === request.period.key)
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4) }) };
  const jsx = (type, props, key) => ({ type, props, key });
  h.deps['react/jsx-runtime'] = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const Component = load(path.join(root, 'src/screens/journal-home-screen.tsx'), h.deps).default;
  return {
    deps: h.deps,
    get state() { return state; },
    set state(next) { state = next; },
    set period(next) { period = next; },
    render() {
      cursor = 0;
      const tree = Component();
      while (effects.length) effects.shift()();
      return tree;
    },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
// Home v3 hands its rows to HomeRecent (src/components/home/home-recent.tsx) with the row that
// arrived and the screen's ArrivingRow; that component wraps only that row (home-v3.test.cjs).
const recent = (tree) => walk(tree).find((node) => node.type?.name === 'HomeRecent');
const arrived = (tree) => { const list = recent(tree); const id = list?.props.arrivedRowId;
  return id && list.props.rows.some((row) => row.id === id) ? [id] : []; };
const shownRows = (tree) => recent(tree)?.props.rows.map((row) => row.id) ?? [];
/** A live capture (a bank text) the phone just received, or one from `ageMs` ago. */
const capture = (id, date, amountFils, ageMs = 0) => ({ ...expense(id, date, amountFils), ts: Date.now() - ageMs });

test('a live capture landing at the top of Recent transactions arrives; first paint never does', () => {
  const p = homeProbe();
  const first = p.render();
  assert.ok(shownRows(first).length > 0, 'the rows are drawn');
  assert.deepEqual(arrived(first), [], 'first paint');
  assert.deepEqual(arrived(p.render()), [], 'a re-render with the same rows');
  p.state = { ...p.state, transactions: [capture('new-capture', '2026-09-06', 1850), ...p.state.transactions] };
  const landed = p.render();
  assert.deepEqual(arrived(landed), ['new-capture']);
  assert.equal(recent(landed).props.Arriving.name, 'ArrivingRow', 'the arriving row carries the arrival from the screen');
  assert.ok(shownRows(landed).includes('new-capture'));
  assert.deepEqual(arrived(p.render()), ['new-capture'], 'the same mount keeps it until another arrives');
  p.state = { ...p.state, transactions: [capture('second', '2026-09-06', 400), ...p.state.transactions] };
  assert.deepEqual(arrived(p.render()), ['second'], 'a newer capture takes over');
  p.dispose();
});

test('rows that reach the top without being captured now are not arrivals', () => {
  const p = homeProbe();
  p.render();
  const none = (tree, label) => assert.deepEqual(arrived(tree), [], label);
  // Typed by hand, or imported from a statement, even dated today.
  p.state = { ...p.state, transactions: [{ ...capture('typed', '2026-09-06', 500), source: 'manual' }, ...p.state.transactions] };
  none(p.render(), 'an entry typed by hand');
  p.state = { ...p.state, transactions: [{ ...capture('statement', '2026-09-06', 500), captureSource: 'pdf' }, ...p.state.transactions] };
  none(p.render(), 'a statement import');
  // An older capture whose date is edited to the newest.
  p.state = { ...p.state, transactions: [capture('edited', '2026-09-06', 700, 3 * 86_400_000), ...p.state.transactions] };
  none(p.render(), 'a date edit brings an old capture to the top');
  // Older captures never painted, revealed when the top rows are deleted or an import is undone.
  const older = Array.from({ length: 6 }, (_, i) => capture(`older-${i}`, '2026-09-01', 300 + i, 2 * 86_400_000));
  p.state = { ...p.state, transactions: [...p.state.transactions, ...older] };
  none(p.render());
  p.state = { ...p.state, transactions: older };
  const revealed = p.render();
  assert.ok(shownRows(revealed).includes('older-0'), 'unpainted rows now on top');
  none(revealed, 'deleting the top rows');
  // A capture without its own clock cannot be told apart from an old one.
  p.state = { ...p.state, transactions: [{ ...expense('no-clock', '2026-09-06', 900) }, ...p.state.transactions] };
  none(p.render(), 'no capture clock');
  p.dispose();
});

test('a period change or the ledger loading is not an arrival', () => {
  const p = homeProbe({ state: { hydrated: false } });
  p.render();
  p.state = { ...p.state, hydrated: true, transactions: [capture('loaded', '2026-09-06', 990), ...p.state.transactions] };
  assert.deepEqual(arrived(p.render()), [], 'rows that appear as the ledger loads');
  p.period = { mode: 'month', key: '2026-08' };
  assert.deepEqual(arrived(p.render()), [], 'another period');
  p.period = { mode: 'month', key: '2026-09' };
  p.state = { ...p.state, transactions: [capture('while-away', '2026-09-06', 990), ...p.state.transactions] };
  assert.deepEqual(arrived(p.render()), [], 'a period change and a new row together');
  p.dispose();
});

test('arrivedActivityRow and rememberActivity keep ids only, for one period', () => {
  const { arrivedActivityRow, rememberActivity } = load(path.join(root, 'src/screens/journal-home-screen.tsx'), createHarness().deps);
  const mounted = Date.now() - 1000;
  const fresh = capture('fresh', '2026-09-06', 100);
  let shown = rememberActivity(null, 'p', [expense('a', '2026-09-05', 1)], null);
  assert.deepEqual([...shown.ids], ['a']);
  shown = rememberActivity(shown, 'p', [expense('b', '2026-09-05', 1)], null);
  assert.deepEqual([...shown.ids].sort(), ['a', 'b'], 'every id painted for the period is kept');
  assert.equal(rememberActivity(shown, '', [], null), null);
  assert.deepEqual([...rememberActivity(shown, 'q', [expense('c', '2026-09-05', 1)], null).ids], ['c'], 'a new period starts afresh');
  assert.equal(arrivedActivityRow(null, 'p', fresh, mounted), null, 'first paint');
  assert.equal(arrivedActivityRow(shown, 'p', fresh, null), null, 'before mount is recorded');
  assert.equal(arrivedActivityRow(shown, 'p', fresh, mounted), 'fresh');
  assert.equal(arrivedActivityRow(shown, 'q', fresh, mounted), null, 'another period');
  assert.equal(arrivedActivityRow({ ...shown, arrived: 'fresh' }, 'p', expense('a', '2026-09-05', 1), mounted), 'fresh');
  for (const value of shown.ids) assert.equal(typeof value, 'string');
});

/** The arrival wrapper on its own: each call a fresh mount, its effect run by hand. */
function arrivalRow() {
  const h = createHarness({ platform: 'ios' });
  const effects = [];
  h.deps.react.useEffect = (work) => { effects.push(work); };
  const { ArrivingRow } = load(path.join(root, 'src/screens/journal-home-screen.tsx'), h.deps);
  const mount = (props) => {
    const tree = ArrivingRow(props);
    const cleanup = effects.splice(0).map((work) => work()).find((value) => typeof value === 'function');
    return { tree, cleanup };
  };
  return { mount, deps: h.deps };
}
const paints = (tree) => {
  const coin = walk(tree).find((node) => node !== tree && hidden(node));
  return { row: flat(tree.props.style).opacity.value, coin: flat(coin.props.style).opacity.value, coinNode: coin };
};

test('the arriving row: Reduce Motion shows it in place, motion waits for ready, runs on one native clock, and an interruption lands', () => {
  const { mount, deps } = arrivalRow();
  const motion = deps['@/hooks/use-reduced-motion'];
  const Animated = deps['react-native'].Animated;
  // One linear clock on the native driver; nothing JS-timed (delay, sequence) or per-coin.
  const timings = [];
  const jsTimed = [];
  Animated.timing = (value, config) => ({ start() { timings.push({ value, config }); }, stop() {} });
  for (const name of ['spring', 'delay', 'sequence', 'parallel', 'stagger']) {
    Animated[name] = () => { jsTimed.push(name); return { start() {}, stop() {} }; };
  }
  const windows = [];
  const interpolate = Animated.Value.prototype.interpolate;
  Animated.Value.prototype.interpolate = function (config) { windows.push({ from: this, config }); return interpolate.call(this, config); };
  // Reduce Motion (the harness default): the row in place and the coin already gone; nothing runs.
  const still = mount({ children: 'row' }).tree;
  assert.equal(still.props.testID, 'home-activity-arrival');
  assert.deepEqual([paints(still).row, paints(still).coin], [1, 2]);
  assert.ok(hidden(paints(still).coinNode), 'the coin is hidden from assistive tech');
  assert.deepEqual(timings, []);
  // Before the screen-reader answer: held out of view, nothing starts.
  motion.useMotionPreference = () => ({ ready: false, reducedMotion: false });
  const waiting = mount({ children: 'row' }).tree;
  assert.deepEqual([paints(waiting).row, paints(waiting).coin], [0, 0]);
  assert.deepEqual(timings, []);
  // Ready: the slide and the coin drop are windows of one clock that runs once, on the UI thread.
  motion.useMotionPreference = () => ({ ready: true, reducedMotion: false });
  windows.length = 0;
  const moving = mount({ children: 'row' });
  assert.equal(timings.length, 1, 'one animation for the whole arrival');
  assert.deepEqual(jsTimed, [], 'no JS timers between steps');
  const [{ value: clock, config }] = timings;
  assert.equal(config.useNativeDriver, true);
  assert.equal(config.easing(0.37), 0.37, 'the clock is linear time; each window carries its own spring');
  assert.equal(config.toValue - clock.value, config.duration);
  const tracks = windows.filter((window) => window.from === clock).map((window) => window.config);
  assert.equal(tracks.length, 2, 'the row and its coin each read the clock');
  for (const track of tracks) {
    assert.equal(track.extrapolate, 'clamp');
    assert.ok(track.inputRange.every((at, i) => i === 0 || at > track.inputRange[i - 1]));
    assert.ok(track.inputRange.at(-1) <= config.toValue);
    assert.equal(track.outputRange.at(-1), 0, 'every window ends at rest on its target');
  }
  const [row, coin] = tracks;
  assert.equal(row.inputRange[0], clock.value, 'the row slides at once');
  assert.equal(row.outputRange[0], -1);
  assert.equal(coin.inputRange[0], clock.value + 45, 'the coin drops a stagger later');
  assert.equal(coin.outputRange[0], -2);
  assert.ok(Math.max(...coin.outputRange) > -1, 'it lands (1) before it fades (2)');
  moving.cleanup();
  assert.equal(clock.value, config.toValue, 'interrupted, the clock lands at the end: the row in place, the coin gone');
  Animated.Value.prototype.interpolate = interpolate;
});

test('both tiles keep the currency on the figure\'s line at phone widths', () => {
  // A daily average of AED 3,117.46 beside a small Today, no budget.
  const transactions = [expense('big', '2026-09-03', 1_861_183), expense('coffee', '2026-09-06', 9293)];
  const inline = (tree, id) => {
    const tile = byId(tree, id);
    const row = walk(tile).find((node) => flat(node.props?.style).direction === 'ltr' && flat(node.props?.style).flexWrap === 'wrap');
    return flat(row.props.style).flexDirection;
  };
  for (const width of [360, 375, 390, 430]) {
    const tree = home({ width, state: { budgets: [], transactions } });
    assert.match(text(byId(tree, 'home-left-to-spend')), /3,117\.46/);
    assert.equal(inline(tree, 'home-today-total'), 'row', `Today at ${width}pt`);
    assert.equal(inline(tree, 'home-left-to-spend'), 'row', `Daily average at ${width}pt`);
  }
  // Larger Text still gives the currency its own line.
  const large = home({ largeText: true, state: { budgets: [], transactions } });
  assert.equal(inline(large, 'home-left-to-spend'), 'column');
});
