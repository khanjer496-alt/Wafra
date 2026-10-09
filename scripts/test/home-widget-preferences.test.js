const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_HOME_WIDGETS,
  HOME_WIDGETS_LAYOUT_VERSION,
  defaultHomeWidgetPreferences,
  homeWidgetVisible,
  moveHomeWidget,
  normalizeHomeWidgetPreferences,
  readStoredHomeWidgets,
  setHomeWidgetVisible,
  splitHomeWidgetLayout,
  storedHomeWidgets,
} = require('./build/home-widget-preferences');

const V3_ORDER = ['greeting', 'hero', 'today', 'overview', 'week', 'activity', 'due', 'upcoming', 'transfers', 'insight', 'assistant', 'capture'];
const V3_HIDDEN = ['today', 'overview', 'week', 'due', 'upcoming', 'transfers', 'insight', 'assistant', 'capture'];

{
  const first = defaultHomeWidgetPreferences();
  const second = defaultHomeWidgetPreferences();
  first.order.reverse();
  first.hidden.push('activity');
  assert.deepEqual(second, DEFAULT_HOME_WIDGETS, 'default preferences must never share mutable arrays');
}

{
  // Unknown and repeated ids are dropped; a missing section returns once at
  // the end, switched off when the default switches it off.
  const repaired = normalizeHomeWidgetPreferences({
    order: ['activity', 'activity', 'made-up', 'assistant'],
    hidden: ['due', 'due', 'unknown'],
  });
  assert.deepEqual(repaired.order, ['activity', 'assistant', ...V3_ORDER.filter((id) => id !== 'activity' && id !== 'assistant')]);
  assert.deepEqual(repaired.hidden, ['due', ...V3_HIDDEN.filter((id) => id !== 'due' && id !== 'assistant')]);
}

{
  const repaired = normalizeHomeWidgetPreferences(null);
  assert.deepEqual(repaired, DEFAULT_HOME_WIDGETS);
  repaired.hidden.push('activity');
  assert.ok(!DEFAULT_HOME_WIDGETS.hidden.includes('activity'), 'normalization fallback must not expose the global default arrays');
}

{
  const start = defaultHomeWidgetPreferences();
  const moved = moveHomeWidget(start, 'upcoming', -1);
  assert.deepEqual(moved.order.slice(6, 8), ['upcoming', 'due']);
  assert.deepEqual(start.order.slice(6, 8), ['due', 'upcoming'], 'reordering must be immutable');
  assert.deepEqual(moveHomeWidget(start, 'greeting', -1), start, 'moving past the first item is a no-op');
  assert.deepEqual(moveHomeWidget(start, 'capture', 1), start, 'moving past the last item is a no-op');
}

{
  // Home v3 (owner decision, October 2026): Spent, then the transactions.
  // Every other section stays in the order and in Customize Home, switched off.
  const defaults = defaultHomeWidgetPreferences();
  assert.deepEqual(defaults.order, V3_ORDER, 'the default still lists the entire Home');
  assert.deepEqual(defaults.hidden, V3_HIDDEN, 'only the greeting, the Spent hero and the transactions show');
  assert.deepEqual(splitHomeWidgetLayout(defaults), { band: ['greeting', 'hero'], sheet: ['activity'] });
  // Existing people get the new default once: any layout saved before v3.
  for (const saved of [
    { order: ['assistant', 'insight', 'due', 'activity', 'upcoming'], hidden: [] },
    { order: ['greeting', 'overview', 'today', 'week', 'due', 'upcoming', 'activity', 'assistant', 'insight', 'capture'], hidden: ['week'] },
  ]) {
    assert.deepEqual(readStoredHomeWidgets(saved), defaults, 'a layout saved before Home v3 reads as the new default');
  }
  const mine = { version: HOME_WIDGETS_LAYOUT_VERSION, order: [...V3_ORDER].reverse(), hidden: ['hero'] };
  assert.deepEqual(readStoredHomeWidgets(mine), { order: mine.order, hidden: ['hero'] }, 'a v3 layout keeps every choice');
  assert.equal(storedHomeWidgets(defaults).version, HOME_WIDGETS_LAYOUT_VERSION, 'saves carry the version that wrote them');
}

{
  const start = defaultHomeWidgetPreferences();
  const shown = setHomeWidgetVisible(start, 'assistant', true);
  assert.equal(homeWidgetVisible(shown, 'assistant'), true, 'a section switched off by default can be switched on');
  const hidden = setHomeWidgetVisible(shown, 'assistant', false);
  const hiddenTwice = setHomeWidgetVisible(hidden, 'assistant', false);
  assert.equal(homeWidgetVisible(hiddenTwice, 'assistant'), false);
  assert.equal(hiddenTwice.hidden.filter((id) => id === 'assistant').length, 1, 'hide must stay idempotent');
}

{
  const customize = fs.readFileSync(path.resolve(__dirname, '../../src/app/home-customize.tsx'), 'utf8');
  const home = fs.readFileSync(path.resolve(__dirname, '../../src/screens/journal-home-screen.tsx'), 'utf8');
  assert.match(customize, /useLargeTextLayout\(\)/, 'Customize Home must reflow for accessibility text sizes');
  assert.match(customize, /width: 48, height: 48/, 'reorder controls must retain platform touch floors');
  assert.match(home, /splitHomeWidgetLayout/, 'Home follows the same visible section order as the editor');
  assert.deepEqual(splitHomeWidgetLayout({ order: [...DEFAULT_HOME_WIDGETS.order], hidden: [...DEFAULT_HOME_WIDGETS.order] }), { band: [], sheet: [] }, 'all content can be hidden; toolbar and Customize stay outside');
}

console.log('✓ Home widget preferences, ordering and accessibility hardening');
