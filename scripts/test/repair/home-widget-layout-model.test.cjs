'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const model = load(path.join(root, 'src/lib/home-widget-preferences.ts'));
const plain = value => JSON.parse(JSON.stringify(value));
// Home v3 (owner decision, October 2026): every section stays in the order;
// only the greeting, the Spent hero and the transactions are switched on.
const all = ['greeting', 'hero', 'today', 'overview', 'week', 'activity', 'due', 'upcoming', 'transfers', 'insight', 'assistant', 'capture'];
const offByDefault = ['today', 'overview', 'week', 'due', 'upcoming', 'transfers', 'insight', 'assistant', 'capture'];
const VERSION = model.HOME_WIDGETS_LAYOUT_VERSION;
const pref = (order = all, hidden = []) => ({ order: [...order], hidden: [...hidden] });
const stored = (value) => ({ version: VERSION, ...value });
// The opening run as the band draws it: the month line (overview) right after Today.
const band5 = ['greeting', 'hero', 'today', 'overview', 'week'];

test('default layout covers every Home section exactly once, with only Spent and the transactions on', () => {
  assert.deepEqual(plain(model.defaultHomeWidgetPreferences()), pref(all, offByDefault));
  const first = model.defaultHomeWidgetPreferences(); first.order.reverse(); first.hidden.push('activity');
  assert.deepEqual(plain(model.defaultHomeWidgetPreferences()), pref(all, offByDefault));
  assert.deepEqual(plain(model.splitHomeWidgetLayout(model.defaultHomeWidgetPreferences())), { band: ['greeting', 'hero'], sheet: ['activity'] });
});
test('layouts saved before v3 read as the new default once; v3 layouts keep their choices', () => {
  const old = ['due', 'upcoming', 'activity', 'assistant', 'insight'];
  for (const value of [pref(old, ['due', 'activity']), pref(['greeting', 'overview', 'today', 'week', 'due', 'upcoming', 'activity', 'assistant', 'insight', 'capture']),
    { order: old, hidden: [], version: 2 }, null, 'x', []]) {
    assert.deepEqual(plain(model.readStoredHomeWidgets(value)), pref(all, offByDefault));
  }
  const mine = stored(pref([...all].reverse(), ['greeting', 'capture', 'week']));
  assert.deepEqual(plain(model.readStoredHomeWidgets(mine)), pref(mine.order, mine.hidden));
  const input = stored(pref(all, []));
  model.readStoredHomeWidgets(input);
  assert.deepEqual(input, stored(pref(all, [])), 'reading does not mutate the saved input');
  assert.deepEqual(plain(model.storedHomeWidgets(pref(all, ['hero']))), stored(pref(all, ['hero'])));
});
test('corruption is repaired without losing known relative positions or hidden flags', () => {
  assert.deepEqual(plain(model.normalizeHomeWidgetPreferences({ order: ['activity', 'activity', 'bogus', 'assistant'], hidden: ['due', 'due', 'bogus'], appearance: 'anything' })),
    pref(['activity', 'assistant', ...all.filter(id => id !== 'activity' && id !== 'assistant')],
      ['due', ...offByDefault.filter(id => id !== 'due' && id !== 'assistant')]));
});
test('order and hidden choices remain exact; a partial layout gets the missing sections back, off when the default has them off', () => {
  const input = pref([...all].reverse(), ['greeting', 'capture', 'week']);
  assert.deepEqual(plain(model.normalizeHomeWidgetPreferences(input)), input);
  const partial = model.normalizeHomeWidgetPreferences({ order: ['activity', 'today'], hidden: ['greeting'] });
  assert.deepEqual(plain(partial), pref(['activity', 'today', ...all.filter(id => !['activity', 'today'].includes(id))],
    ['greeting', ...offByDefault.filter(id => id !== 'today')]));
});
test('visible band prefix stops at the first visible ordinary section', () => {
  assert.deepEqual(plain(model.splitHomeWidgetLayout(pref())), { band: band5, sheet: all.slice(5) });
  const layout = pref(['week', 'due', 'greeting', 'hero', 'overview', 'today', ...all.filter(id => !['week', 'due', ...band5].includes(id))]);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(layout)), { band: ['week'], sheet: layout.order.slice(1) });
  const hiddenBarrier = { ...layout, hidden: ['due'] };
  assert.deepEqual(plain(model.splitHomeWidgetLayout(hiddenBarrier)), { band: ['week', 'greeting', 'hero', 'today', 'overview'],
    sheet: layout.order.slice(6) });
  // Placed lower by the person, the overview stays where they put it, as its full card on the sheet.
  const lower = pref(['greeting', 'hero', 'today', 'week', 'due', 'overview', 'upcoming', 'activity', 'transfers', 'assistant', 'insight', 'capture']);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(lower)), { band: ['greeting', 'hero', 'today', 'week'], sheet: lower.order.slice(4) });
  // Without the Today tiles the month line keeps its own place on the band.
  assert.deepEqual(plain(model.splitHomeWidgetLayout(pref(all, ['today']))).band, ['greeting', 'hero', 'overview', 'week']);
});
test('moving a financial block below an ordinary section moves it onto the sheet', () => {
  const moved = model.moveHomeWidget(pref(), 'week', 1);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(moved)), { band: ['greeting', 'hero', 'today', 'overview'],
    sheet: ['activity', 'week', ...all.slice(6)] });
  assert.deepEqual(plain(model.moveHomeWidget(pref(), 'greeting', -1)), pref());
  assert.deepEqual(plain(model.moveHomeWidget(pref(), 'capture', 1)), pref());
});
test('all content can be hidden without inventing a replacement section', () => {
  let input = pref();
  for (const id of all) input = model.setHomeWidgetVisible(input, id, false);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(input)), { band: [], sheet: [] });
  assert.equal(new Set(input.hidden).size, all.length);
  assert.deepEqual(plain(model.setHomeWidgetVisible(input, 'made-up', false)), plain(input));
  const shown = model.setHomeWidgetVisible(input, 'week', true);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(shown)), { band: ['week'], sheet: [] });
});
test('deterministic permutations preserve the complete visible sequence across band and sheet', () => {
  let seed = 27;
  for (let n = 0; n < 100; n++) {
    const order = [...all];
    for (let i = order.length - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) >>> 0; const at = seed % (i + 1); [order[i], order[at]] = [order[at], order[i]]; }
    const hidden = order.filter((_, i) => (n >> i) & 1);
    const { band, sheet } = model.splitHomeWidgetLayout(pref(order, hidden));
    const visible = order.filter(id => !hidden.includes(id));
    // Same sections, each once; only the overview moves, and only within the band.
    assert.deepEqual(plain(sheet), visible.slice(band.length));
    assert.deepEqual(plain(band).sort(), visible.slice(0, band.length).sort());
    assert.ok(band.every(id => band5.includes(id)));
    assert.ok(!sheet.length || !band5.includes(sheet[0]), 'the band takes the whole opening run');
    if (band.includes('today') && band.includes('overview')) assert.equal(band.indexOf('overview'), band.indexOf('today') + 1);
  }
});

test('editors list and move sections in drawn order, one visible step at a time', () => {
  const drawn = (p) => plain(model.drawnHomeWidgetOrder(p));
  assert.deepEqual(drawn(pref()), all);
  // On the band the month line always follows Today: it has no step up.
  assert.equal(model.moveHomeWidgetDrawn(pref(), 'overview', -1), null);
  assert.equal(model.moveHomeWidgetDrawn(pref(), 'greeting', -1), null);
  assert.equal(model.moveHomeWidgetDrawn(pref(), 'capture', 1), null);
  // Down: the overview leaves the band after the first sheet section; others keep their drawn places.
  const overviewDown = model.moveHomeWidgetDrawn(pref(), 'overview', 1);
  assert.deepEqual(drawn(overviewDown), ['greeting', 'hero', 'today', 'week', 'activity', 'overview', ...all.slice(6)]);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(overviewDown)).band, ['greeting', 'hero', 'today', 'week']);
  // Within the band, the week can climb above Today and its month line.
  assert.deepEqual(drawn(model.moveHomeWidgetDrawn(pref(), 'week', -1)), ['greeting', 'hero', 'week', 'today', 'overview', ...all.slice(5)]);
  // The week leaving the band lands after the first ordinary section.
  const weekDown = model.moveHomeWidgetDrawn(pref(), 'week', 1);
  assert.deepEqual(drawn(weekDown), ['greeting', 'hero', 'today', 'overview', 'activity', 'week', ...all.slice(6)]);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(weekDown)).band, ['greeting', 'hero', 'today', 'overview']);
  // And back up again restores the band.
  assert.deepEqual(drawn(model.moveHomeWidgetDrawn(weekDown, 'week', -1)).slice(0, 5), band5);
  // A sheet section climbs one drawn step per press; at the band's edge it ends the run there.
  let climbing = pref();
  const steps = [];
  for (let i = 0; i < 2; i++) { climbing = model.moveHomeWidgetDrawn(climbing, 'due', -1); steps.push(drawn(climbing).indexOf('due')); }
  assert.equal(steps[0], 5);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(model.moveHomeWidgetDrawn(pref(), 'due', -1))).band, band5, 'the band is untouched');
  const across = model.moveHomeWidgetDrawn(pref(), 'activity', -1);
  assert.deepEqual(drawn(across).slice(0, 6), ['greeting', 'hero', 'today', 'overview', 'activity', 'week']);
  assert.deepEqual(plain(model.splitHomeWidgetLayout(across)).band, ['greeting', 'hero', 'today', 'overview']);
  // Every move keeps all twelve sections, each once, and hidden flags.
  const hidden = pref(all, ['insight']);
  for (const id of all) for (const dir of [-1, 1]) {
    const next = model.moveHomeWidgetDrawn(hidden, id, dir);
    if (!next) continue;
    assert.deepEqual([...next.order].sort(), [...all].sort());
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
  const first = defer(), second = defer(), calls = [], delivered = []; let saved = null;
  const api = persistence({ getItem: async () => saved, setItem: async (_key, json) => {
    calls.push(JSON.parse(json)); await (calls.length === 1 ? first.promise : second.promise); saved = json;
  } });
  api.subscribeHomeWidgetPreferences(value => delivered.push(plain(value)));
  const a = pref(all, ['week']), b = pref([...all].reverse(), ['today']);
  const writeA = api.saveHomeWidgetPreferences(a), writeB = api.saveHomeWidgetPreferences(b);
  await tick(); assert.equal(calls.length, 1); assert.deepEqual(delivered, []);
  first.resolve(); await writeA; await tick(); assert.equal(calls.length, 2);
  let loaded = false; const reading = api.loadHomeWidgetPreferences().then(value => { loaded = true; return value; });
  await tick(); assert.equal(loaded, false, 'load waits for the newest queued write');
  second.resolve(); await writeB;
  assert.deepEqual(plain(await reading), b); assert.deepEqual(JSON.parse(saved), stored(b), 'storage keeps the version that wrote it');
  assert.deepEqual(delivered, [a, b]);
});
test('an older read cannot overwrite a save that completed while it was waiting', async () => {
  const reading = defer(); const latest = pref([...all].reverse(), ['capture']);
  const api = persistence({ getItem: () => reading.promise, setItem: async () => {} });
  const oldLoad = api.loadHomeWidgetPreferences(); await tick();
  await api.saveHomeWidgetPreferences(latest);
  reading.resolve(JSON.stringify(stored(pref(all, ['assistant']))));
  assert.deepEqual(plain(await oldLoad), latest);
});
test('failed writes reject without publishing success; later retry and reset still work', async () => {
  let fail = true; const events = [];
  const api = persistence({ getItem: async () => JSON.stringify(stored(pref())), setItem: async () => { if (fail) throw Error('disk unavailable'); } });
  api.subscribeHomeWidgetPreferences(value => events.push(plain(value)));
  const wanted = pref(all, ['overview']);
  await assert.rejects(api.saveHomeWidgetPreferences(wanted), /disk unavailable/);
  assert.deepEqual(events, []);
  fail = false; await api.saveHomeWidgetPreferences(wanted); await api.resetHomeWidgetPreferences();
  const defaults = pref(all, offByDefault);
  assert.deepEqual(events, [wanted, defaults]); assert.deepEqual(plain(await api.loadHomeWidgetPreferences()), defaults);
});
test('listeners and callers receive independent copies, and unsubscribe stops events', async () => {
  const api = persistence({ getItem: async () => null, setItem: async () => {} });
  api.subscribeHomeWidgetPreferences(value => { value.order.length = 0; throw Error('view failure'); });
  const events = []; const unsubscribe = api.subscribeHomeWidgetPreferences(value => events.push(plain(value)));
  await api.saveHomeWidgetPreferences(pref()); assert.deepEqual(events, [pref()]);
  const loaded = await api.loadHomeWidgetPreferences(); loaded.hidden.push('today');
  assert.deepEqual(plain(await api.loadHomeWidgetPreferences()), pref());
  unsubscribe(); await api.saveHomeWidgetPreferences(pref(all, ['capture'])); assert.equal(events.length, 1);
});
test('a failed read does not cache a default or write over a recoverable stored layout', async () => {
  let reads = 0, writes = 0; const saved = stored(pref([...all].reverse(), ['due']));
  const api = persistence({ getItem: async () => { if (++reads === 1) throw Error('temporary read error'); return JSON.stringify(saved); }, setItem: async () => { writes++; } });
  assert.deepEqual(plain(await api.loadHomeWidgetPreferences()), pref(all, offByDefault));
  assert.deepEqual(plain(await api.loadHomeWidgetPreferences()), pref(saved.order, saved.hidden));
  assert.equal(writes, 0);
});
test('a layout saved before v3 loads as the new default without being written back', async () => {
  let writes = 0;
  const api = persistence({ getItem: async () => JSON.stringify(pref(['due', 'upcoming', 'activity', 'assistant', 'insight'], [])), setItem: async () => { writes++; } });
  assert.deepEqual(plain(await api.loadHomeWidgetPreferences()), pref(all, offByDefault));
  assert.deepEqual(plain(api.peekHomeWidgetPreferences()), pref(all, offByDefault), 'the first render after launch already has it');
  assert.equal(writes, 0, 'nothing is written until the person saves a layout');
});
