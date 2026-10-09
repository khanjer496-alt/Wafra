'use strict';
// Home v3's pure pieces: the Spent hero's like-for-like trend and its line,
// the over-pace nudge memory, the Needs you priority, the card's tilt, the
// copy's parity, and the stored layout's one-time reset to the new default.
// Fixed clocks only; every figure is added up from real rows here.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const build = path.resolve(__dirname, '../build');
const hero = require(path.join(build, 'home-hero.js'));
const needs = require(path.join(build, 'home-needs-you.js'));
const tilt = require(path.join(build, 'home-tilt.js'));
const copy = require(path.join(build, 'home-copy.js'));
const format = require(path.join(build, 'format.js'));
const insights = require(path.join(build, 'insights.js'));
const widgets = require(path.join(build, 'home-widget-preferences.js'));

let seq = 0;
const row = (date, amountFils, extra = {}) => ({ id: `t${++seq}`, title: 'Shop', amountFils, category: 'groceries', date,
  accountId: 'bank', type: 'expense', source: 'manual', ...extra });
const at = (iso) => new Date(`${iso}T12:00:00`);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('the trend compares this month so far with the same days of last month', () => {
  const rows = [
    row('2026-10-08', 3000), row('2026-10-01', 1000),
    row('2026-09-08', 1500), row('2026-09-01', 1000),
    // After the eighth: not in a like-for-like window, however large.
    row('2026-09-09', 999999), row('2026-09-30', 999999),
    // Income, and a month further back, never count.
    row('2026-09-03', 50000, { type: 'income', category: 'salary' }), row('2026-08-05', 777),
  ];
  const october = hero.projectHeroMonth(rows, '2026-10', at('2026-10-08'));
  assert.equal(october.monthDays, 31);
  assert.equal(october.cumulative.length, 8, 'one point per elapsed day');
  assert.deepEqual(october.cumulative, [1000, 1000, 1000, 1000, 1000, 1000, 1000, 4000]);
  assert.deepEqual(plain(october.trend), { currentFils: 4000, previousFils: 2500, percent: 60, direction: 'up',
    previousKey: '2026-09', days: 8, partial: true });
  // A month that has ended compares whole months.
  const september = hero.projectHeroMonth(rows, '2026-09', at('2026-10-08'));
  assert.equal(september.cumulative.length, 30);
  assert.equal(september.cumulative.at(-1), 1000 + 1500 + 999999 * 2);
  assert.equal(september.trend.partial, false);
  assert.equal(september.trend.previousFils, 777);
  assert.equal(september.trend.previousKey, '2026-08');
});

test('down, the same, and no chip without earlier spending', () => {
  const down = hero.projectHeroMonth([row('2026-10-02', 900), row('2026-09-02', 1000)], '2026-10', at('2026-10-05'));
  assert.equal(down.trend.direction, 'down');
  assert.equal(down.trend.percent, -10);
  const same = hero.projectHeroMonth([row('2026-10-02', 1002), row('2026-09-02', 1000)], '2026-10', at('2026-10-05'));
  assert.equal(same.trend.direction, 'same', 'under half a percent rounds to the same');
  assert.equal(same.trend.percent, 0);
  // Nothing recorded last month: no trend at all, never +100%.
  assert.equal(hero.projectHeroMonth([row('2026-10-02', 500)], '2026-10', at('2026-10-05')).trend, null);
  // Only income last month is not spending to compare against.
  assert.equal(hero.projectHeroMonth([row('2026-10-02', 500), row('2026-09-02', 500, { type: 'income' })],
    '2026-10', at('2026-10-05')).trend, null);
  // A month that has not started has no line and no trend.
  const future = hero.projectHeroMonth([row('2026-10-02', 500)], '2026-11', at('2026-10-05'));
  assert.deepEqual(future.cumulative, []);
  assert.equal(future.trend, null);
});

test('month lengths: the earlier window never runs past its own month', () => {
  const rows = [row('2026-02-28', 2800), row('2026-03-01', 100), row('2026-03-31', 3100), row('2026-02-01', 100)];
  for (const day of ['2026-03-29', '2026-03-30', '2026-03-31']) {
    const march = hero.projectHeroMonth(rows, '2026-03', at(day));
    assert.equal(march.trend.previousFils, 2900, `${day}: all of February, never into March`);
    assert.equal(march.trend.days, Number(day.slice(8)));
  }
  // Thirtieth of a 30-day month against a 31-day month: the first 30 days only.
  const april = hero.projectHeroMonth([row('2026-04-30', 100), row('2026-03-30', 100), row('2026-03-31', 5000)], '2026-04', at('2026-04-30'));
  assert.equal(april.trend.previousFils, 5100, 'a finished April compares the whole of March');
  const midApril = hero.projectHeroMonth([row('2026-04-15', 100), row('2026-03-15', 100), row('2026-03-16', 5000)], '2026-04', at('2026-04-15'));
  assert.equal(midApril.trend.previousFils, 100);
  // Leap February against January.
  const leap = hero.projectHeroMonth([row('2028-02-29', 100), row('2028-01-29', 100), row('2028-01-30', 900)], '2028-02', at('2028-02-29'));
  assert.equal(leap.monthDays, 29);
  assert.equal(leap.trend.previousFils, 1000, 'the last day of February closes it: all of January');
});

test('salary-day months follow the same money-month windows as Spending', () => {
  format.setMonthStartDay(25);
  try {
    const rows = [row('2026-10-08', 400), row('2026-09-25', 600), row('2026-09-24', 99999),
      row('2026-09-07', 300), row('2026-08-25', 700), row('2026-09-08', 99999)];
    const key = format.monthKey(at('2026-10-08'));
    assert.equal(key, '2026-09', 'the money month running on 8 October started on 25 September');
    const month = hero.projectHeroMonth(rows, key, at('2026-10-08'));
    assert.equal(month.cumulative.length, 14, '25 Sep to 8 Oct');
    assert.equal(month.cumulative.at(-1), 1000);
    assert.equal(month.trend.previousFils, 1000, '25 Aug to 7 Sep');
    assert.equal(month.trend.percent, 0);
  } finally {
    format.setMonthStartDay(1);
  }
});

test('the line ends where the shared month summary ends, by the same spending rule', () => {
  const rows = [row('2026-10-03', 1200), row('2026-10-03', 300, { accountId: 'closed' }), row('2026-10-05', 800),
    row('2026-10-04', 5000, { type: 'income' }), row('2026-10-06', 4000, { category: 'transfer', transfer: true })];
  const live = new Set(['bank']);
  const month = hero.projectHeroMonth(rows, '2026-10', at('2026-10-06'), live, new Set());
  const summary = insights.summarizeMonth(rows, { mode: 'month', key: '2026-10' }, live, new Set());
  assert.equal(month.cumulative.at(-1), summary.expenseFils);
});

test('a row dated later this month counts on today, so Spent, the line and the trend agree', () => {
  const rows = [row('2026-09-02', 1000), row('2026-10-02', 600), row('2026-10-20', 400)];
  const live = new Set(['bank']);
  const month = hero.projectHeroMonth(rows, '2026-10', at('2026-10-06'), live, new Set());
  const summary = insights.summarizeMonth(rows, { mode: 'month', key: '2026-10' }, live, new Set());
  assert.equal(month.cumulative.length, 6, 'the line still ends today');
  assert.equal(month.cumulative.at(-1), 1000);
  assert.equal(month.cumulative.at(-1), summary.expenseFils, 'the big Spent figure');
  assert.equal(month.trend.currentFils, summary.expenseFils, 'the chip compares the same figure');
  assert.equal(month.trend.previousFils, 1000);
  assert.equal(month.trend.direction, 'same');
});

test('sparkline points start on the baseline and spread over the whole month', () => {
  const points = hero.sparklinePoints([0, 100, 100, 400], 30, 300, 30, 0);
  assert.equal(points.length, 5);
  assert.deepEqual(points[0], { x: 0, y: 30 });
  assert.deepEqual(points.at(-1), { x: 40, y: 0 }, 'four days of thirty, at the top (the month so far)');
  assert.equal(points[2].y, 22.5);
  const flat = hero.sparklinePoints([0, 0], 31, 310, 30, 0);
  assert.ok(flat.every((point) => point.y === 30), 'nothing spent is a flat line on the baseline');
  assert.deepEqual(hero.sparklinePoints([], 31, 310, 30), []);
  assert.deepEqual(hero.sparklinePoints([5], 0, 310, 30), []);
  assert.equal(hero.sparklinePath([{ x: 0, y: 30 }, { x: 10.04, y: 2.26 }]), 'M0,30 L10,2.3');
  // Under last month's pace, the line ends below the top: the box is last month's same days.
  assert.equal(hero.sparklinePoints([0, 100, 100, 400], 30, 300, 30, 0, 800).at(-1).y, 15);
  assert.equal(hero.sparklinePoints([0, 100, 100, 400], 30, 300, 30, 0, 200).at(-1).y, 0, 'over the pace, the month is the top');
});

test('the over-pace nudge fires on the crossing, once a day, never on a first look', () => {
  const day = '2026-10-08';
  let step = hero.nextPaceMemory(null, '2026-10', 'over', day);
  assert.equal(step.nudge, false, 'a first observation only records');
  step = hero.nextPaceMemory({ month: '2026-10', state: 'within', nudgedOn: null }, '2026-10', 'over', day);
  assert.equal(step.nudge, true);
  assert.deepEqual(step.memory, { month: '2026-10', state: 'over', nudgedOn: day });
  // Back under and over again the same day: no second nudge.
  let memory = hero.nextPaceMemory(step.memory, '2026-10', 'within', day).memory;
  assert.equal(memory.nudgedOn, day);
  assert.equal(hero.nextPaceMemory(memory, '2026-10', 'over', day).nudge, false);
  // The next day it may nudge again.
  memory = hero.nextPaceMemory(memory, '2026-10', 'within', '2026-10-09').memory;
  assert.equal(hero.nextPaceMemory(memory, '2026-10', 'over', '2026-10-09').nudge, true);
  // A new month starts over: its first look never nudges.
  assert.equal(hero.nextPaceMemory({ month: '2026-09', state: 'within', nudgedOn: null }, '2026-10', 'over', day).nudge, false);
  // No comparison: nothing changes.
  const kept = { month: '2026-10', state: 'within', nudgedOn: null };
  assert.equal(hero.nextPaceMemory(kept, '2026-10', null, day).memory, kept);
  // An unchanged observation keeps the same object (no storage write).
  assert.equal(hero.nextPaceMemory(kept, '2026-10', 'within', day).memory, kept);
  assert.equal(hero.paceState(null), null);
  assert.equal(hero.paceState({ currentFils: 5, previousFils: 5 }), 'within');
  assert.equal(hero.paceState({ currentFils: 6, previousFils: 5 }), 'over');
  assert.deepEqual(hero.readPaceMemory({ month: '2026-10', state: 'over', nudgedOn: 'x' }), { month: '2026-10', state: 'over', nudgedOn: null });
  assert.equal(hero.readPaceMemory({ month: 'nope', state: 'over' }), null);
  assert.equal(hero.readPaceMemory(null), null);
});

test('Needs you shows only the highest-priority need, skipping dismissed ones', () => {
  const base = { tracking: null, overdueCard: null, transferQuestions: 0, limitsOver: 0, dismissed: new Set() };
  assert.equal(needs.pickNeed(base), null, 'nothing needs the person: no pill');
  const all = { ...base, tracking: 'paused', overdueCard: { id: 'd1', title: 'Sky', amountFils: 100, daysLate: 2 },
    transferQuestions: 3, limitsOver: 1 };
  assert.equal(needs.pickNeed(all).kind, 'tracking');
  assert.equal(needs.pickNeed({ ...all, tracking: null }).kind, 'card');
  assert.equal(needs.pickNeed({ ...all, tracking: null, overdueCard: null }).kind, 'transfers');
  assert.equal(needs.pickNeed({ ...all, tracking: null, overdueCard: null, transferQuestions: 0 }).kind, 'limit');
  assert.equal(needs.pickNeed({ ...all, dismissed: new Set(['tracking:paused', 'card:d1']) }).kind, 'transfers');
  // A different tracking problem is a new need, even after the pause was dismissed.
  assert.equal(needs.pickNeed({ ...all, tracking: 'stopped', dismissed: new Set(['tracking:paused']) }).key, 'tracking:stopped');
  assert.deepEqual(plain(needs.pickNeed({ ...base, transferQuestions: 2.7 })), { kind: 'transfers', key: 'transfers', count: 2 });
  const items = [
    { id: 'b', kind: 'bill', overdue: true, daysLeft: -9, title: 'DEWA', amountFils: 1 },
    { id: 'c1', kind: 'card', overdue: true, daysLeft: -1, dueId: 'due1', title: 'Sky', amountFils: 5 },
    { id: 'c2', kind: 'card', overdue: true, daysLeft: -4, dueId: 'due2', title: 'Plat', displayLabel: 'Platinum', amountFils: 7 },
    { id: 'c3', kind: 'card', overdue: false, daysLeft: 2, dueId: 'due3', title: 'Soon', amountFils: 9 },
  ];
  assert.deepEqual(needs.earliestOverdueCard(items), { id: 'due2', title: 'Platinum', amountFils: 7, daysLate: 4 });
  // Inline at the top of the sheet with large text, a 1.2x text scale, or a window under 700pt.
  assert.equal(needs.needsYouInline({ largeText: false, fontScale: 1, height: 844 }), false);
  assert.equal(needs.needsYouInline({ largeText: true, fontScale: 1, height: 844 }), true);
  assert.equal(needs.needsYouInline({ largeText: false, fontScale: 1.2, height: 844 }), true);
  assert.equal(needs.needsYouInline({ largeText: false, fontScale: 1.19, height: 700 }), false);
  assert.equal(needs.needsYouInline({ largeText: false, fontScale: 1, height: 699 }), true);
  assert.equal(needs.earliestOverdueCard(items.slice(0, 1)), null, 'a late bill is not a card payment');
  // Session dismissals publish a new set to subscribers.
  const before = needs.dismissedNeeds();
  let heard = 0;
  const stop = needs.subscribeDismissedNeeds(() => { heard += 1; });
  needs.dismissNeed('limit');
  needs.dismissNeed('limit');
  stop();
  assert.equal(heard, 1);
  assert.notEqual(needs.dismissedNeeds(), before);
  assert.ok(needs.dismissedNeeds().has('limit'));
});

test('the tilt follows movement from the resting hold, at most four degrees, mirrored right to left', () => {
  let state = tilt.tiltStep(null, 0.8, 0.1, false);
  assert.deepEqual(state, { restBeta: 0.8, restGamma: 0.1, x: 0, y: 0 }, 'the first reading is the resting pose');
  for (let i = 0; i < 40; i += 1) state = tilt.tiltStep(state, 0.8, 0.6, false);
  assert.ok(state.y > 0 && state.y <= tilt.TILT_MAX_DEG);
  assert.ok(Math.abs(state.x) < 0.01);
  let rtl = tilt.tiltStep(null, 0.8, 0.1, true);
  for (let i = 0; i < 40; i += 1) rtl = tilt.tiltStep(rtl, 0.8, 0.6, true);
  assert.ok(Math.abs(rtl.y + state.y) < 1e-9, 'right to left leans the other way');
  // Held still at the new angle, the card settles back towards flat.
  let settled = state;
  for (let i = 0; i < 400; i += 1) settled = tilt.tiltStep(settled, 0.8, 0.6, false);
  assert.ok(Math.abs(settled.y) < 0.2);
  for (let i = 0; i < 30; i += 1) state = tilt.tiltStep(state, 4, -4, false);
  assert.ok(Math.abs(state.x) <= tilt.TILT_MAX_DEG && Math.abs(state.y) <= tilt.TILT_MAX_DEG);
  assert.equal(tilt.tiltStep(state, Number.NaN, 0, false), state, 'a reading without numbers changes nothing');
});

test('Home copy has the same keys in English and Arabic, and no English in Arabic', () => {
  const { en, ar } = copy.HOME_COPY;
  const shape = (value) => Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, typeof entry === 'function' ? `fn${entry.length}` : typeof entry === 'object' ? shape(entry) : typeof entry]));
  assert.deepEqual(shape(ar), shape(en));
  const strings = [ar.spentIn('أكتوبر'), ar.versusSameDays('سبتمبر'), ar.spokenTrend('up', 12, 'سبتمبر', true),
    ar.spokenTrend('same', 0, 'سبتمبر', false), ar.transfersToAnswer(1), ar.transfersToAnswer(2), ar.transfersToAnswer(5),
    ar.transfersToAnswer(12), ar.limitsOver(3), ar.cardOverdue('سكاي'), ...Object.values(ar).filter((v) => typeof v === 'string'),
    ...Object.values(ar.needHint), ...Object.values(ar.needShort)];
  for (const value of strings) assert.doesNotMatch(value, /[A-Za-z]/, value);
  assert.equal(en.spokenTrend('up', 12, 'September', true), 'up 12% versus the same days of September');
  assert.equal(en.spokenTrend('down', -8, 'September', false), 'down 8% versus September');
  // One term for unanswered transfers, as Transfers and Transactions say it.
  assert.equal(en.transfersToAnswer(1), '1 transfer needs an answer');
  assert.equal(en.transfersToAnswer(2656), '2656 transfers need an answer');
  assert.equal(ar.transfersToAnswer(12), '12 تحويلًا بانتظار إجابتك');
  assert.equal(copy.homeCopy('ar'), ar);
  assert.equal(copy.homeCopy('fr'), en);
});

test('a layout saved before Home v3 reads as the new default; v3 layouts keep every choice', () => {
  const fresh = widgets.defaultHomeWidgetPreferences();
  const visible = fresh.order.filter((id) => !fresh.hidden.includes(id));
  assert.deepEqual(visible, ['greeting', 'hero', 'activity'], 'spend, then transactions');
  assert.deepEqual(plain(widgets.splitHomeWidgetLayout(fresh)), { band: ['greeting', 'hero'], sheet: ['activity'] });
  // Earlier layouts: the full v2 order, a five-section v1 order, garbage.
  for (const old of [
    { order: ['greeting', 'overview', 'today', 'week', 'due', 'upcoming', 'activity', 'assistant', 'insight', 'capture'], hidden: [] },
    { order: ['due', 'upcoming', 'activity', 'assistant', 'insight'], hidden: ['due'] },
    { order: 'nope' }, null, [], 'x',
  ]) assert.deepEqual(plain(widgets.readStoredHomeWidgets(old)), plain(fresh));
  const mine = { version: widgets.HOME_WIDGETS_LAYOUT_VERSION, order: [...fresh.order].reverse(), hidden: ['hero'] };
  assert.deepEqual(plain(widgets.readStoredHomeWidgets(mine)), { order: mine.order, hidden: ['hero'] });
  assert.deepEqual(plain(widgets.storedHomeWidgets({ order: ['activity'], hidden: [] })).version, widgets.HOME_WIDGETS_LAYOUT_VERSION);
  // A section missing from a saved layout comes back switched off when the default has it off.
  const partial = widgets.normalizeHomeWidgetPreferences({ order: ['activity', 'hero'], hidden: [] });
  assert.deepEqual(partial.order.slice(0, 2), ['activity', 'hero']);
  assert.ok(partial.hidden.includes('due') && partial.hidden.includes('capture') && !partial.hidden.includes('greeting'));
});
