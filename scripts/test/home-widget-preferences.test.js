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
  assert.deepEqual(repaired.order, ['activity', 'assistant', 'due', 'insight', 'upcoming']);
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
  const moved = moveHomeWidget(start, 'assistant', -1);
  assert.deepEqual(moved.order.slice(0, 2), ['assistant', 'due']);
  assert.deepEqual(start.order.slice(0, 2), ['due', 'assistant'], 'reordering must be immutable');
  assert.deepEqual(moveHomeWidget(start, 'due', -1), start, 'moving past the first item is a no-op');
  assert.deepEqual(moveHomeWidget(start, 'upcoming', 1), start, 'moving past the last item is a no-op');
}

{
  const defaults = defaultHomeWidgetPreferences();
  assert.ok(defaults.order.indexOf('due') < defaults.order.indexOf('assistant'), 'unconfigured Home must prioritize due payments');
  for (const saved of [
    { order: ['assistant', 'insight', 'due', 'activity', 'upcoming'], hidden: [] },
    { order: ['upcoming', 'activity', 'assistant', 'due', 'insight'], hidden: ['assistant', 'due'] },
  ]) {
    assert.deepEqual(normalizeHomeWidgetPreferences(saved), saved, 'saved order and hidden widgets must not be migrated to the new default');
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
  const home = fs.readFileSync(path.resolve(__dirname, '../../src/screens/ledger-home-screen.tsx'), 'utf8');
  assert.match(customize, /useLargeTextLayout\(\)/, 'Customize Home must reflow for accessibility text sizes');
  assert.match(customize, /width: 48, height: 48/, 'reorder controls must retain platform touch floors');
  assert.match(home, /MoneyOverview|<Hero/, 'the money overview must remain outside customizable widget ordering');
  assert.match(home, /capture|Capture/i, 'automatic capture must remain a fixed Home surface');
}

console.log('✓ Home widget preferences, ordering and accessibility hardening');
