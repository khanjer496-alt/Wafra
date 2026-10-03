'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const model = load(path.join(root, 'src/lib/home-widget-preferences.ts'));
const copy = load(path.join(root, 'src/lib/customize-copy.ts'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const clone = value => JSON.parse(JSON.stringify(value));
const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
function walk(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  return [node, ...walk(node.props?.children), ...walk(node.props?.footer), ...walk(node.props?.bandContent)];
}
const byId = (tree, id) => walk(tree).find(node => node.props.testID === id);
const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);
function harness({ language = 'en', large = false, initial, save } = {}) {
  const slots = [], effects = [], saves = [], events = [];
  let cursor = 0;
  let removal;
  const react = {
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useCallback: fn => fn,
    useEffect(fn) { const index = cursor++; if (!(index in slots)) { slots[index] = true; effects.push(fn); } },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const module = load(path.join(root, 'src/app/home-customize.tsx'), {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { useRouter: () => ({ back: () => { if (removal?.prevent) removal.callback({ data: { action: { type: 'GO_BACK' } } }); else events.push('back'); } }) },
    '@react-navigation/native': {
      useNavigation: () => ({ dispatch: action => events.push(`dispatch:${action.type}`) }),
      usePreventRemove: (prevent, callback) => { removal = { prevent, callback }; },
    },
    'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: x => x, hairlineWidth: 1 } },
    '@/components/settings-band/band-title': { BandTitle: 'BandTitle' },
    '@/components/settings-rows': { SettingsGroupTitle: 'GroupTitle', SettingsIconTile: 'IconTile' },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/ui/band-scaffold': { BandScaffold: 'Scaffold' },
    '@/components/ui/band/e-button': { EButton: 'EButton' },
    '@/components/ui/icon': { Icon: 'Icon' },
    '@/constants/theme': { Fonts: { sansSemi: 'Geist' } },
    '@/hooks/use-band': { useBand: () => ({ band: '#16130F', onBand: '#FFFFFF', text: '#16130F', textSecondary: '#57524A' }) },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => large },
    '@/lib/customize-copy': copy,
    '@/lib/home-widgets': { ...model, loadHomeWidgetPreferences: () => initial ?? Promise.resolve(model.defaultHomeWidgetPreferences()),
      saveHomeWidgetPreferences: async value => { saves.push(clone(value)); await save?.(value, saves.length); } },
    '@/lib/i18n': { t: key => ({ moveUp: 'Move up', moveDown: 'Move down', stillLoading: 'Loading' })[key] ?? key },
  });
  const render = () => { cursor = 0; return module.default(); };
  const mount = async () => { render(); effects.splice(0).forEach(fn => fn()); await tick(); return render(); };
  return { render, mount, saves, events, remove: () => { if (removal?.prevent) removal.callback({ data: { action: { type: 'GO_BACK' } } }); else events.push('back'); } };
}
// The preview lists sections in the order Home draws them: on the band the month line follows Today.
const drawnOrder = (preferences) => { const { band, sheet } = model.splitHomeWidgetLayout(preferences); return clone([...band, ...sheet]); };
function previewIds(tree) { return walk(tree).filter(node => String(node.props.testID ?? '').startsWith('home-customize-preview-') && node.props.testID !== 'home-customize-preview-empty').map(node => node.props.testID.replace('home-customize-preview-', '')); }
for (const language of ['en', 'ar']) test(`all ten sections have visible preview, independent visibility and accessible movement (${language})`, async () => {
  const h = harness({ language, large: true }); const tree = await h.mount();
  assert.equal(model.DEFAULT_HOME_WIDGETS.order.length, 10);
  assert.deepEqual(previewIds(tree), drawnOrder(model.DEFAULT_HOME_WIDGETS));
  assert.deepEqual(previewIds(tree).slice(0, 4), ['greeting', 'today', 'overview', 'week']);
  assert.equal(byId(tree, 'home-customize-fixed'), undefined);
  for (const id of model.DEFAULT_HOME_WIDGETS.order) {
    assert.ok(byId(tree, `home-customize-${id}`));
    const toggle = byId(tree, `home-customize-toggle-${id}`);
    assert.equal(toggle.props.accessibilityRole, 'switch');
    assert.equal(toggle.props['aria-checked'], true);
    assert.equal(toggle.props.accessibilityLabel, copy.customizeCopy(language).widgetTitle[id]);
    const up = byId(tree, `home-customize-up-${id}`);
    const style = flat(up.props.style({ pressed: false }));
    assert.ok(style.width >= 48 && style.height >= 48);
  }
  assert.equal(byId(tree, 'home-customize-up-greeting').props.disabled, true);
  assert.equal(byId(tree, 'home-customize-down-capture').props.disabled, true);
  // The list follows the drawn order, and a step Home cannot draw is disabled.
  const ids = new Set(model.DEFAULT_HOME_WIDGETS.order.map(id => `home-customize-${id}`));
  const listed = walk(tree).filter(node => ids.has(node.props.testID)).map(node => node.props.testID.replace('home-customize-', ''));
  assert.deepEqual(listed, drawnOrder(model.DEFAULT_HOME_WIDGETS));
  assert.equal(byId(tree, 'home-customize-up-overview').props.disabled, true, 'the month line always follows Today on the band');
});
test('initial loading cannot overwrite edits because controls wait for stored preferences', async () => {
  const waiting = deferred(), h = harness({ initial: waiting.promise });
  const mounting = h.mount(); await tick();
  assert.equal(byId(h.render(), 'home-customize-toggle-overview').props.disabled, true);
  waiting.resolve({ order: [...model.DEFAULT_HOME_WIDGETS.order], hidden: ['week'] });
  await mounting;
  assert.equal(byId(h.render(), 'home-customize-toggle-week').props['aria-checked'], false);
});
test('rapid moves use newest order; hiding changes preview and reset restores every section', async () => {
  const h = harness(); let tree = await h.mount();
  const move = byId(tree, 'home-customize-up-capture').props.onPress;
  move(); move(); move(); await tick(); tree = h.render();
  assert.deepEqual(previewIds(tree), drawnOrder(h.saves.at(-1)));
  assert.equal(previewIds(tree).indexOf('capture'), 6);
  assert.equal(h.saves.at(-1).order.indexOf('capture'), 6);
  for (const id of model.DEFAULT_HOME_WIDGETS.order) byId(tree, `home-customize-toggle-${id}`).props.onPress();
  await tick(); tree = h.render();
  assert.ok(byId(tree, 'home-customize-preview-empty'));
  assert.equal(h.saves.at(-1).hidden.length, 10);
  byId(tree, 'home-customize-reset').props.onPress(); await tick();
  assert.deepEqual(previewIds(h.render()), drawnOrder(model.DEFAULT_HOME_WIDGETS));
  assert.deepEqual(h.saves.at(-1), clone(model.DEFAULT_HOME_WIDGETS));
});
test('queued storage writes never race and Done waits for the final layout', async () => {
  const first = deferred(), h = harness({ save: (_value, count) => count === 1 ? first.promise : undefined });
  let tree = await h.mount();
  byId(tree, 'home-customize-toggle-overview').props.onPress();
  byId(tree, 'home-customize-toggle-week').props.onPress();
  await tick(); assert.equal(h.saves.length, 1);
  h.render().props.nav.actions[0].onPress(); await tick(); assert.deepEqual(h.events, []);
  first.resolve(); await tick(); await tick();
  assert.equal(h.saves.length, 2); assert.deepEqual(h.saves.at(-1).hidden, ['overview', 'week']);
  assert.deepEqual(h.events, ['dispatch:GO_BACK']);
});
test('save failure remains visible, does not claim success or close, and retries the latest layout', async () => {
  let fail = true; const h = harness({ save: () => { if (fail) throw new Error('synthetic full storage'); } });
  let tree = await h.mount(); byId(tree, 'home-customize-toggle-week').props.onPress(); await tick();
  tree = h.render(); assert.equal(byId(tree, 'home-customize-save-status').props.accessibilityRole, 'alert');
  assert.equal(text(byId(tree, 'home-customize-save-status')), copy.customizeCopy('en').saveError);
  tree.props.nav.actions[0].onPress(); await tick(); assert.deepEqual(h.events, []);
  fail = false; byId(h.render(), 'home-customize-retry').props.onPress(); await tick();
  tree = h.render(); assert.equal(text(byId(tree, 'home-customize-save-status')), copy.customizeCopy('en').saved);
  assert.deepEqual(h.saves.at(-1).hidden, ['week']);
  tree.props.nav.actions[0].onPress(); await tick(); assert.deepEqual(h.events, ['back']);
});
test('persistent failure offers an explicit exit without pretending the layout saved', async () => {
  const h = harness({ save: () => { throw new Error('synthetic error'); } }); let tree = await h.mount();
  byId(tree, 'home-customize-toggle-today').props.onPress(); await tick(); tree = h.render();
  assert.ok(byId(tree, 'home-customize-retry'));
  byId(tree, 'home-customize-leave-unsaved').props.onPress();
  assert.deepEqual(h.events, ['dispatch:GO_BACK']);
});

test('hardware Back or swipe waits for storage and dispatches the original navigation after success', async () => {
  const wait = deferred(), h = harness({ save: () => wait.promise });
  let tree = await h.mount();
  byId(tree, 'home-customize-toggle-today').props.onPress(); await tick(); h.render();
  h.remove(); await tick(); assert.deepEqual(h.events, []);
  wait.resolve(); await tick();
  assert.deepEqual(h.events, ['dispatch:GO_BACK']);
});
test('failed storage keeps native removal on screen with retry and explicit exit', async () => {
  const wait = deferred(), h = harness({ save: () => wait.promise });
  let tree = await h.mount();
  byId(tree, 'home-customize-toggle-week').props.onPress(); await tick(); h.render();
  h.remove(); await tick(); wait.reject(new Error('synthetic failure')); await tick();
  assert.deepEqual(h.events, []);
  tree = h.render(); assert.ok(byId(tree, 'home-customize-retry'));
  h.remove(); await tick(); assert.deepEqual(h.events, [], 'another hardware Back cannot silently drop failed edits');
  byId(h.render(), 'home-customize-leave-unsaved').props.onPress();
  assert.deepEqual(h.events, ['dispatch:GO_BACK']);
});

test('a new edit re-arms native protection if approved navigation did not remove the screen', async () => {
  let fail = false;
  const h = harness({ save: () => { if (fail) throw new Error('synthetic storage failure'); } });
  let tree = await h.mount();
  tree.props.nav.actions[0].onPress(); await tick();
  assert.deepEqual(h.events, ['back']);
  fail = true;
  byId(h.render(), 'home-customize-toggle-week').props.onPress(); await tick(); h.render();
  h.remove(); await tick();
  assert.deepEqual(h.events, ['back'], 'later failed edits cannot inherit an earlier removal approval');
});
