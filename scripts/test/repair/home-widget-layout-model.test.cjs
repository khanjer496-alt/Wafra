'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const model = load(path.join(root, 'src/lib/home-widget-preferences.ts'));
const plain = value => JSON.parse(JSON.stringify(value));
const defaults = ['greeting', 'overview', 'today', 'week', 'due', 'upcoming', 'activity', 'assistant', 'insight', 'capture'];
const top = defaults.slice(0, 4);
const old = ['due', 'upcoming', 'activity', 'assistant', 'insight'];
const pref = (order = defaults, hidden = []) => ({ order: [...order], hidden: [...hidden] });

test('default layout covers every Home section exactly once', () => {
  assert.deepEqual(plain(model.defaultHomeWidgetPreferences()), pref());
  const first = model.defaultHomeWidgetPreferences(); first.order.reverse(); first.hidden.push('week');
  assert.deepEqual(plain(model.defaultHomeWidgetPreferences()), pref());
});
test('legacy order and hidden choices survive migration between the newly configurable sections', () => {
  for (const order of [old, [...old].reverse(), ['assistant', 'due', 'insight', 'activity', 'upcoming']]) {
    const input = pref(order, ['due', 'activity']);
    assert.deepEqual(plain(model.normalizeHomeWidgetPreferences(input)), pref([...top, ...order, 'capture'], input.hidden));
    assert.deepEqual(input, pref(order, ['due', 'activity']), 'migration does not mutate the saved input');
  }
});
test('legacy corruption is repaired without losing known relative positions or hidden flags', () => {
  assert.deepEqual(plain(model.normalizeHomeWidgetPreferences({ order: ['activity', 'activity', 'bogus', 'assistant'], hidden: ['due', 'due', 'bogus'], appearance: 'anything' })),
    pref([...top, 'activity', 'assistant', 'due', 'upcoming', 'insight', 'capture'], ['due']));
});
test('expanded order and hidden choices remain exact; partial expanded layouts append missing sections', () => {
  const input = pref([...defaults].reverse(), ['greeting', 'capture', 'week']);
  assert.deepEqual(plain(model.normalizeHomeWidgetPreferences(input)), input);
  const partial = model.normalizeHomeWidgetPreferences({ order: ['activity', 'today'], hidden: ['greeting'] });
  assert.deepEqual(plain(partial), pref(['activity', 'today', ...defaults.filter(id => !['activity', 'today'].includes(id))], ['greeting']));
});
// Home v2: the band holds the greeting, the Today tiles, the month line (the
// overview: Spent · In · Net) right under them, and the week.
const band4 = ['greeting', 'today', 'overview', 'week'];
test('visible band prefix stops at the first visible ordinary section', () => {
  assert.deepEqual(plain(model.splitHomeWidgetLayout(pref())), { band: band4, sheet: defaults.slice(4) });
  const layout = pref(['week', 'due', 'greeting', 'overview', 'today', ...defaults.filter(id => !['week', 'due', ...top].includes(id))]);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(layout)), { band: ['week'], sheet: layout.order.slice(1) });
  const hiddenBarrier = { ...layout, hidden: ['due'] };
  assert.deepEqual(plain(model.splitHomeWidgetLayout(hiddenBarrier)), { band: ['week', 'greeting', 'today', 'overview'],
    sheet: layout.order.slice(5) });
  // Placed lower by the person, the overview stays where they put it, as its full card on the sheet.
  const lower = pref(['greeting', 'today', 'week', 'due', 'overview', 'upcoming', 'activity', 'assistant', 'insight', 'capture']);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(lower)), { band: ['greeting', 'today', 'week'], sheet: lower.order.slice(3) });
  // Without the Today tiles the month line keeps its own place on the band.
  assert.deepEqual(plain(model.splitHomeWidgetLayout(pref(defaults, ['today']))).band, ['greeting', 'overview', 'week']);
});
test('moving a financial block below an ordinary section moves it onto the sheet', () => {
  const moved = model.moveHomeWidget(pref(), 'week', 1);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(moved)), { band: ['greeting', 'today', 'overview'], sheet: ['due', 'week', 'upcoming', 'activity', 'assistant', 'insight', 'capture'] });
  assert.deepEqual(plain(model.moveHomeWidget(pref(), 'greeting', -1)), pref());
  assert.deepEqual(plain(model.moveHomeWidget(pref(), 'capture', 1)), pref());
});
test('all content can be hidden without inventing a replacement section', () => {
  let input = pref();
  for (const id of defaults) input = model.setHomeWidgetVisible(input, id, false);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(input)), { band: [], sheet: [] });
  assert.equal(new Set(input.hidden).size, 10);
  assert.deepEqual(plain(model.setHomeWidgetVisible(input, 'made-up', false)), plain(input));
  const shown = model.setHomeWidgetVisible(input, 'week', true);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(shown)), { band: ['week'], sheet: [] });
});
test('deterministic permutations preserve the complete visible sequence across band and sheet', () => {
  let seed = 27;
  for (let n = 0; n < 100; n++) {
    const order = [...defaults];
    for (let i = order.length - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) >>> 0; const at = seed % (i + 1); [order[i], order[at]] = [order[at], order[i]]; }
    const hidden = order.filter((_, i) => (n >> i) & 1);
    const { band, sheet } = model.splitHomeWidgetLayout(pref(order, hidden));
    const visible = order.filter(id => !hidden.includes(id));
    // Same sections, each once; only the overview moves, and only within the band.
    assert.deepEqual(plain(sheet), visible.slice(band.length));
    assert.deepEqual(plain(band).sort(), visible.slice(0, band.length).sort());
    assert.ok(band.every(id => band4.includes(id)));
    assert.ok(!sheet.length || !band4.includes(sheet[0]), 'the band takes the whole opening run');
    if (band.includes('today') && band.includes('overview')) assert.equal(band.indexOf('overview'), band.indexOf('today') + 1);
  }
});

test('editors list and move sections in drawn order, one visible step at a time', () => {
  const drawn = (p) => plain(model.drawnHomeWidgetOrder(p));
  assert.deepEqual(drawn(pref()), [...band4, ...defaults.slice(4)]);
  // On the band the month line always follows Today: it has no step up.
  assert.equal(model.moveHomeWidgetDrawn(pref(), 'overview', -1), null);
  assert.equal(model.moveHomeWidgetDrawn(pref(), 'greeting', -1), null);
  assert.equal(model.moveHomeWidgetDrawn(pref(), 'capture', 1), null);
  // Down: the overview leaves the band after the first payments section; others keep their drawn places.
  const overviewDown = model.moveHomeWidgetDrawn(pref(), 'overview', 1);
  assert.deepEqual(drawn(overviewDown), ['greeting', 'today', 'week', 'due', 'overview', ...defaults.slice(5)]);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(overviewDown)).band, ['greeting', 'today', 'week']);
  // Within the band, the week can climb above Today and its month line.
  assert.deepEqual(drawn(model.moveHomeWidgetDrawn(pref(), 'week', -1)), ['greeting', 'week', 'today', 'overview', ...defaults.slice(4)]);
  // The week leaving the band lands after the first ordinary section.
  const weekDown = model.moveHomeWidgetDrawn(pref(), 'week', 1);
  assert.deepEqual(drawn(weekDown), ['greeting', 'today', 'overview', 'due', 'week', ...defaults.slice(5)]);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(weekDown)).band, ['greeting', 'today', 'overview']);
  // And back up again restores the band.
  assert.deepEqual(drawn(model.moveHomeWidgetDrawn(weekDown, 'week', -1)).slice(0, 4), band4);
  // A sheet section climbs one drawn step per press; at the band's edge it ends the run there.
  let climbing = pref();
  const steps = [];
  for (let i = 0; i < 2; i++) { climbing = model.moveHomeWidgetDrawn(climbing, 'activity', -1); steps.push(drawn(climbing).indexOf('activity')); }
  assert.deepEqual(steps, [5, 4]);
  assert.deepEqual(drawn(climbing), [...band4, 'activity', 'due', 'upcoming', 'assistant', 'insight', 'capture']);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(climbing)).band, band4, 'the band is untouched');
  const across = model.moveHomeWidgetDrawn(climbing, 'activity', -1);
  assert.deepEqual(drawn(across).slice(0, 5), ['greeting', 'today', 'overview', 'activity', 'week']);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(across)).band, ['greeting', 'today', 'overview']);
  // Every move keeps all ten sections, each once, and hidden flags.
  const hidden = pref(defaults, ['insight']);
  for (const id of defaults) for (const dir of [-1, 1]) {
    const next = model.moveHomeWidgetDrawn(hidden, id, dir);
    if (!next) continue;
    assert.deepEqual([...next.order].sort(), [...defaults].sort());
    assert.deepEqual(plain(next.hidden), ['insight']);
  }
});

const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function persistence(storage) {
  return load(path.join(root, 'src/lib/home-widgets.ts'), {
    '@react-native-async-storage/async-storage': storage,
    '@/lib/home-widget-preferences': model,
  });
}
test('writes serialize in request order; Home receives only successfully saved layouts', async () => {
  const first = defer(), second = defer(), calls = [], delivered = []; let stored = null;
  const api = persistence({ getItem: async () => stored, setItem: async (_key, json) => {
    calls.push(JSON.parse(json)); await (calls.length === 1 ? first.promise : second.promise); stored = json;
  } });
  api.subscribeHomeWidgetPreferences(value => delivered.push(plain(value)));
  const a = pref(defaults, ['week']), b = pref([...defaults].reverse(), ['today']);
  const writeA = api.saveHomeWidgetPreferences(a), writeB = api.saveHomeWidgetPreferences(b);
  await tick(); assert.equal(calls.length, 1); assert.deepEqual(delivered, []);
  first.resolve(); await writeA; await tick(); assert.equal(calls.length, 2);
  let loaded = false; const reading = api.loadHomeWidgetPreferences().then(value => { loaded = true; return value; });
  await tick(); assert.equal(loaded, false, 'load waits for the newest queued write');
  second.resolve(); await writeB;
  assert.deepEqual(plain(await reading), b); assert.deepEqual(JSON.parse(stored), b);
  assert.deepEqual(delivered, [a, b]);
});
test('an older read cannot overwrite a save that completed while it was waiting', async () => {
  const reading = defer(); const latest = pref([...defaults].reverse(), ['capture']);
  const api = persistence({ getItem: () => reading.promise, setItem: async () => {} });
  const oldLoad = api.loadHomeWidgetPreferences(); await tick();
  await api.saveHomeWidgetPreferences(latest);
  reading.resolve(JSON.stringify(pref(old, ['assistant'])));
  assert.deepEqual(plain(await oldLoad), latest);
});
test('failed writes reject without publishing success; later retry and reset still work', async () => {
  let fail = true; const events = [];
  const api = persistence({ getItem: async () => JSON.stringify(pref()), setItem: async () => { if (fail) throw Error('disk unavailable'); } });
  api.subscribeHomeWidgetPreferences(value => events.push(plain(value)));
  const wanted = pref(defaults, ['overview']);
  await assert.rejects(api.saveHomeWidgetPreferences(wanted), /disk unavailable/);
  assert.deepEqual(events, []);
  fail = false; await api.saveHomeWidgetPreferences(wanted); await api.resetHomeWidgetPreferences();
  assert.deepEqual(events, [wanted, pref()]); assert.deepEqual(plain(await api.loadHomeWidgetPreferences()), pref());
});
test('listeners and callers receive independent copies, and unsubscribe stops events', async () => {
  const api = persistence({ getItem: async () => null, setItem: async () => {} });
  api.subscribeHomeWidgetPreferences(value => { value.order.length = 0; throw Error('view failure'); });
  const events = []; const unsubscribe = api.subscribeHomeWidgetPreferences(value => events.push(plain(value)));
  await api.saveHomeWidgetPreferences(pref()); assert.deepEqual(events, [pref()]);
  const loaded = await api.loadHomeWidgetPreferences(); loaded.hidden.push('today');
  assert.deepEqual(plain(await api.loadHomeWidgetPreferences()), pref());
  unsubscribe(); await api.saveHomeWidgetPreferences(pref(defaults, ['capture'])); assert.equal(events.length, 1);
});
test('a failed read does not cache a default or write over a recoverable stored layout', async () => {
  let reads = 0, writes = 0; const stored = pref([...old].reverse(), ['due']);
  const api = persistence({ getItem: async () => { if (++reads === 1) throw Error('temporary read error'); return JSON.stringify(stored); }, setItem: async () => { writes++; } });
  assert.deepEqual(plain(await api.loadHomeWidgetPreferences()), pref());
  assert.deepEqual(plain(await api.loadHomeWidgetPreferences()), pref([...top, ...stored.order, 'capture'], ['due']));
  assert.equal(writes, 0);
});
