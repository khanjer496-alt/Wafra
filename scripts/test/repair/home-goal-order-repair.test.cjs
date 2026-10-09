'use strict';
// The one-time repair for Homes saved by the earlier goal-first Goals step:
// it runs once per device, repairs only that step's exact output, and never
// retires itself after a failed read or write. Since Home v3 every layout
// saved before it reads as the new default (readStoredHomeWidgets), so such a
// layout needs no repair: the check retires without writing it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

const LAYOUT = 'wafra/ui/home-widgets/v1';
const MARKER = 'wafra/ui/home-widgets/goal-order-repair/v1';
const TOP = ['greeting', 'hero', 'today', 'overview', 'week'];
const plain = (value) => JSON.parse(JSON.stringify(value));

function setup(initial = {}, { failRead = 0, failWrite = 0 } = {}) {
  const store = new Map(Object.entries(initial));
  const writes = [];
  let reads = 0, sets = 0;
  const storage = {
    getItem: async (key) => { if (++reads <= failRead) throw Error('read failed'); return store.has(key) ? store.get(key) : null; },
    setItem: async (key, value) => { if (++sets <= failWrite) throw Error('write failed'); writes.push(key); store.set(key, value); },
  };
  const types = load(path.join(root, 'src/lib/types.ts'));
  const model = load(path.join(root, 'src/lib/home-widget-preferences.ts'));
  const widgets = load(path.join(root, 'src/lib/home-widgets.ts'), {
    '@react-native-async-storage/async-storage': storage,
    '@/lib/home-widget-preferences': model,
  });
  const onboarding = load(path.join(root, 'src/lib/onboarding-e.ts'), {
    '@/lib/types': types,
    '@/lib/splits': load(path.join(root, 'src/lib/splits.ts')),
    '@/lib/home-widget-preferences': model,
    '@/lib/transaction-source': load(path.join(root, 'src/lib/transaction-source.ts')),
  });
  const repair = load(path.join(root, 'src/lib/home-goal-order-repair.ts'), {
    '@react-native-async-storage/async-storage': storage,
    '@/lib/home-widgets': widgets,
    '@/lib/onboarding-e': onboarding,
  });
  const layout = () => store.has(LAYOUT) ? JSON.parse(store.get(LAYOUT)) : null;
  return { repair, store, writes, layout, model };
}

const v3 = (value) => ({ version: 3, ...value });
const REST = ['activity', 'transfers', 'insight', 'assistant', 'capture'];
// The earlier step's goal-first shape, in a v3 layout.
const earlierBills = v3({ order: ['due', 'upcoming', ...TOP, ...REST], hidden: [] });

test('an earlier goal-first Home is repaired once and the check is retired', async () => {
  const h = setup({ [LAYOUT]: JSON.stringify(earlierBills) });
  await h.repair.repairGoalOrderedHomeOnce();
  // Payments are drawn before recent activity (onboarding-e.ts paymentsBeforeActivity).
  assert.deepEqual(h.layout().order, [...TOP, 'due', 'upcoming', ...REST]);
  assert.deepEqual(plain(h.model.splitHomeWidgetLayout(h.layout()).band), ['greeting', 'hero', 'today', 'overview', 'week']);
  assert.equal(h.store.get(MARKER), '1');
  assert.deepEqual(h.writes, [LAYOUT, MARKER], 'layout saved before the check is retired');
  // The person later puts the goal sections first again in Customize Home: never undone.
  h.store.set(LAYOUT, JSON.stringify(earlierBills));
  await h.repair.repairGoalOrderedHomeOnce();
  assert.deepEqual(h.layout(), earlierBills);
});

test('a layout saved before Home v3 is not rewritten: it reads as the new default, and the check retires', async () => {
  const old = { order: ['due', 'upcoming', 'greeting', 'overview', 'today', 'week', 'assistant', 'insight', 'activity', 'capture'], hidden: [] };
  const h = setup({ [LAYOUT]: JSON.stringify(old) });
  await h.repair.repairGoalOrderedHomeOnce();
  assert.deepEqual(h.layout(), old, 'nothing is written over the stored layout');
  assert.deepEqual(h.writes, [MARKER]);
});

test('a layout arranged by hand and a fresh install are left alone', async () => {
  // Ask Wafra is never promoted by a goal, so this cannot be the earlier step's output.
  const custom = v3({ order: ['due', 'assistant', ...TOP, 'upcoming', 'activity', 'transfers', 'insight', 'capture'], hidden: ['insight'] });
  const h = setup({ [LAYOUT]: JSON.stringify(custom) });
  await h.repair.repairGoalOrderedHomeOnce();
  assert.deepEqual(h.layout(), custom);
  assert.deepEqual(h.writes, [MARKER]);

  const fresh = setup();
  await fresh.repair.repairGoalOrderedHomeOnce();
  assert.equal(fresh.layout(), null, 'no layout is written where none was saved');
  assert.deepEqual(fresh.writes, [MARKER]);
});

test('a failed read or write leaves the check for the next launch', async () => {
  const unread = setup({ [LAYOUT]: JSON.stringify(earlierBills) }, { failRead: 1 });
  await unread.repair.repairGoalOrderedHomeOnce();
  assert.equal(unread.store.has(MARKER), false);
  assert.deepEqual(unread.layout(), earlierBills);
  await unread.repair.repairGoalOrderedHomeOnce();
  assert.equal(unread.store.get(MARKER), '1');
  assert.deepEqual(unread.layout().order.slice(0, 5), TOP);

  const unwritten = setup({ [LAYOUT]: JSON.stringify(earlierBills) }, { failWrite: 1 });
  await unwritten.repair.repairGoalOrderedHomeOnce();
  assert.equal(unwritten.store.has(MARKER), false, 'a layout that was not saved is not marked done');
  await unwritten.repair.repairGoalOrderedHomeOnce();
  assert.equal(unwritten.store.get(MARKER), '1');
  assert.deepEqual(unwritten.layout().order.slice(0, 5), TOP);
});

test('a stacked order from going Back in the Goals step is repaired too', async () => {
  const stacked = v3({ order: ['activity', 'insight', 'due', 'upcoming', ...TOP, 'transfers', 'assistant', 'capture'], hidden: ['insight'] });
  const h = setup({ [LAYOUT]: JSON.stringify(stacked) });
  await h.repair.repairGoalOrderedHomeOnce();
  assert.deepEqual(h.layout(), v3({ order: [...TOP, 'due', 'upcoming', 'activity', 'insight', 'transfers', 'assistant', 'capture'], hidden: ['insight'] }));
  assert.equal(h.store.get(MARKER), '1');
});

test('a load that no longer needs repair leaves the check for the next launch', async () => {
  // The raw read shows the earlier order, but the serialized load (a read
  // failure's defaults, or a layout saved meanwhile) does not: not marked.
  const h = setup({ [LAYOUT]: JSON.stringify(earlierBills) }, { failRead: 0 });
  let reads = 0;
  const realGet = h.store.get.bind(h.store);
  h.store.get = (key) => key === LAYOUT && ++reads >= 2 ? JSON.stringify(v3({ order: [...TOP], hidden: [] })) : realGet(key);
  await h.repair.repairGoalOrderedHomeOnce();
  assert.equal(h.store.has(MARKER), false);
  assert.deepEqual(h.writes, []);
});

test('overlapping calls run the check once', async () => {
  const h = setup({ [LAYOUT]: JSON.stringify(earlierBills) });
  await Promise.all([h.repair.repairGoalOrderedHomeOnce(), h.repair.repairGoalOrderedHomeOnce()]);
  assert.deepEqual(h.writes, [LAYOUT, MARKER]);
});

test('Home runs the repair after hydration for onboarded people with goals', () => {
  const source = require('node:fs').readFileSync(path.join(root, 'src/screens/journal-home-screen.tsx'), 'utf8');
  assert.match(source, /const choseGoals = \(state\.wafraGoals\?\.length \?\? 0\) > 0;/);
  assert.match(source, /if \(!state\.hydrated \|\| !state\.onboarded \|\| !choseGoals\) return;\s*void repairGoalOrderedHomeOnce\(\);/);
});
