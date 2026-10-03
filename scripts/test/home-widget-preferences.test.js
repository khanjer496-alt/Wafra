const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_HOME_WIDGETS,
  defaultHomeWidgetPreferences,
  homeWidgetVisible,
  moveHomeWidget,
  normalizeHomeWidgetPreferences,
  setHomeWidgetVisible,
  splitHomeWidgetLayout,
} = require('./build/home-widget-preferences');

{
  const first = defaultHomeWidgetPreferences();
  const second = defaultHomeWidgetPreferences();
  first.order.reverse();
  first.hidden.push('assistant');
  assert.deepEqual(second, DEFAULT_HOME_WIDGETS, 'default preferences must never share mutable arrays');
}

{
  const repaired = normalizeHomeWidgetPreferences({
    order: ['activity', 'activity', 'made-up', 'assistant'],
    hidden: ['due', 'due', 'unknown'],
  });
  assert.deepEqual(repaired.order, ['greeting', 'overview', 'today', 'week', 'activity', 'assistant', 'due', 'upcoming', 'insight', 'capture']);
  assert.deepEqual(repaired.hidden, ['due']);
}

{
  const repaired = normalizeHomeWidgetPreferences(null);
  assert.deepEqual(repaired, DEFAULT_HOME_WIDGETS);
  repaired.hidden.push('assistant');
  assert.equal(DEFAULT_HOME_WIDGETS.hidden.length, 0, 'normalization fallback must not expose the global default arrays');
}

{
  const start = defaultHomeWidgetPreferences();
  const moved = moveHomeWidget(start, 'upcoming', -1);
  assert.deepEqual(moved.order.slice(4, 6), ['upcoming', 'due']);
  assert.deepEqual(start.order.slice(4, 6), ['due', 'upcoming'], 'reordering must be immutable');
  assert.deepEqual(moveHomeWidget(start, 'greeting', -1), start, 'moving past the first item is a no-op');
  assert.deepEqual(moveHomeWidget(start, 'capture', 1), start, 'moving past the last item is a no-op');
}

{
  const defaults = defaultHomeWidgetPreferences();
  assert.ok(defaults.order.indexOf('due') < defaults.order.indexOf('assistant'), 'unconfigured Home must prioritize due payments');
  assert.deepEqual(defaults.order, ['greeting', 'overview', 'today', 'week', 'due', 'upcoming', 'activity', 'assistant', 'insight', 'capture'], 'the default includes the entire Home');
  for (const saved of [
    { order: ['assistant', 'insight', 'due', 'activity', 'upcoming'], hidden: [] },
    { order: ['upcoming', 'activity', 'assistant', 'due', 'insight'], hidden: ['upcoming', 'due'] },
  ]) {
    assert.deepEqual(normalizeHomeWidgetPreferences(saved), { order: ['greeting', 'overview', 'today', 'week', ...saved.order, 'capture'], hidden: saved.hidden }, 'legacy choices stay intact between newly configurable content');
  }
}

{
  const start = defaultHomeWidgetPreferences();
  const hidden = setHomeWidgetVisible(start, 'assistant', false);
  const hiddenTwice = setHomeWidgetVisible(hidden, 'assistant', false);
  assert.equal(homeWidgetVisible(hiddenTwice, 'assistant'), false);
  assert.equal(hiddenTwice.hidden.filter((id) => id === 'assistant').length, 1, 'hide must stay idempotent');
  const visible = setHomeWidgetVisible(hiddenTwice, 'assistant', true);
  assert.equal(homeWidgetVisible(visible, 'assistant'), true);
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
