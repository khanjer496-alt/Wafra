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

test('selected period and total remain visible across all Spending views without repeating day progress', () => {
  for (const period of [{mode:'month',key:'2026-09'}, {mode:'range',from:'2026-09-01',to:'2026-09-06'}, {mode:'year',year:2026}, {mode:'all'}]) {
    for (const language of ['en','ar']) {
      const totals = [];
      const periods = [];
      for (const view of ['categories','compare','calendar']) {
        const tree = createHarness({period,language,params:{view}}).render('flow');
        const total = byId(tree, 'spending-total');
        assert.ok(total, `${period.mode} ${view} keeps its total`);
        assert.equal(walk(tree).filter(n=>n.props?.testID==='spending-total').length,1);
        totals.push(total.props.accessibilityLabel);
        periods.push(text(byId(tree,'spending-period')));
        assert.equal(byId(tree,'spending-pace'),undefined);
        if(view==='calendar') assert.ok(byId(tree,'spending-calendar'),'all filter modes have daily details');
      }
      assert.equal(new Set(totals).size,1,'switching views preserves the financial headline');
      assert.equal(new Set(periods).size,1,'switching views preserves visible date context');
    }
  }
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
