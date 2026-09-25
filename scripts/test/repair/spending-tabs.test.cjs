'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const { periodDayProgress } = load(path.join(root, 'src/lib/period-pace.ts'));
const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);

test('Spending tabs are Categories, Compare and Calendar; old view links still open the same content', () => {
  const calendar = createHarness({ params: { view: 'activity' } }).render('flow');
  assert.ok(byId(calendar, 'spending-activity'), 'view=activity opens Calendar');
  assert.ok(byId(calendar, 'spending-calendar'));
  const selected = walk(calendar).find((node) => node.props?.accessibilityRole === 'tab' && node.props.accessibilityState?.selected);
  assert.equal(selected.props.accessibilityLabel, 'Calendar');

  const compare = createHarness({ params: { view: 'trends' } }).render('flow');
  const trends = byId(compare, 'spending-trends');
  assert.ok(trends, 'view=trends opens Compare');
  // The comparison leads; six-month history and merchants stay reachable below.
  const ids = walk(trends).map((node) => node.props?.testID).filter(Boolean);
  assert.equal(ids[0], 'spending-trends');
  assert.equal(ids[1], 'spending-compare');
  assert.ok(ids.some((id) => String(id).startsWith('cashflow-month-')), 'six-month history kept inside Compare');
  assert.ok(byId(compare, 'spending-ask-wafra'), 'Explain stays in Compare');

  for (const view of ['calendar', 'compare', 'categories']) {
    const tree = createHarness({ params: { view } }).render('flow');
    const tab = walk(tree).find((node) => node.props?.accessibilityRole === 'tab' && node.props.accessibilityState?.selected);
    assert.equal(tab.props.accessibilityLabel.toLowerCase(), view);
  }
  const unknown = createHarness({ params: { view: 'nonsense' } }).render('flow');
  assert.ok(byId(unknown, 'spending-categories'));
});

test('Categories shows "day X of Y" only for the running month', () => {
  const current = createHarness().render('flow');
  assert.equal(text(byId(current, 'spending-pace')), 'day 6 of 30');
  const past = createHarness({ period: { mode: 'month', key: '2026-08' } }).render('flow');
  assert.equal(byId(past, 'spending-pace'), undefined);
  const arabic = createHarness({ language: 'ar' }).render('flow');
  assert.match(text(byId(arabic, 'spending-pace')), /اليوم 6 من 30/);
});

test('periodDayProgress counts inside the money month, salary-day starts included', () => {
  assert.deepEqual({ ...periodDayProgress('2026-09-01', '2026-09-30', '2026-09-01') }, { day: 1, of: 30 });
  assert.deepEqual({ ...periodDayProgress('2026-09-01', '2026-09-30', '2026-09-30') }, { day: 30, of: 30 });
  // A 25th-to-24th salary month crossing a year end and a leap February.
  assert.deepEqual({ ...periodDayProgress('2026-12-25', '2027-01-24', '2027-01-01') }, { day: 8, of: 31 });
  assert.deepEqual({ ...periodDayProgress('2028-02-25', '2028-03-24', '2028-03-01') }, { day: 6, of: 29 });
  assert.equal(periodDayProgress('2026-09-01', '2026-09-30', '2026-08-31'), null);
  assert.equal(periodDayProgress('2026-09-01', '2026-09-30', '2026-10-01'), null);
  assert.equal(periodDayProgress('2026-09-30', '2026-09-01', '2026-09-15'), null);
  assert.equal(periodDayProgress('bad', '2026-09-30', '2026-09-15'), null);
});
