'use strict';
// Home v3 (owner decision, October 2026): "Spent in <Month>" with its trend
// and In · Net, then the transactions; everything else is off by default and
// stays in Customize Home; one "Needs you" pill for what truly needs the
// person. Source-component contract harness (journal-harness.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, walk, text } = require('./journal-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const ids = (tree) => walk(tree).map((node) => node.props?.testID).filter(Boolean);
const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
const ALL = ['greeting', 'hero', 'today', 'overview', 'week', 'activity', 'due', 'upcoming', 'transfers', 'insight', 'assistant', 'capture'];

test('the default Home is the greeting, Spent and the transactions — nothing else', () => {
  const { tree } = harness({ homeWidgets: 'default' });
  const shown = ids(tree);
  for (const id of ['home-section-greeting', 'reference-home-summary', 'home-spending-total', 'home-hero-flow', 'home-widget-activity', 'home-see-all', 'home-customize-link']) {
    assert.ok(shown.includes(id), `${id} is on Home`);
  }
  for (const id of ['home-today', 'home-week', 'journal-summary', 'home-widget-due', 'home-widget-upcoming',
    'home-widget-insight', 'home-widget-assistant', 'journal-import-controls', 'home-widget-transfers', 'home-capture-stopped']) {
    assert.ok(!shown.includes(id), `${id} is off by default`);
  }
  // No repeated day totals under the day labels; each listed day is one quiet label.
  const days = walk(tree).filter((node) => /^home-activity-day-/.test(node.props?.testID ?? ''));
  assert.equal(days.length, 2);
  for (const day of days) assert.equal(walk(day).filter((node) => node.type === 'Money').length, 0);
});

test('the new Home renders fewer elements than the same ledger with every section on', () => {
  const lean = walk(harness({ homeWidgets: 'default' }).tree).length;
  const full = walk(harness({ homeWidgets: { order: [...ALL], hidden: [] } }).tree).length;
  assert.ok(lean < full * 0.7, `default ${lean} elements, every section ${full}`);
});

test('the hero speaks the month, the figure, the trend, In and Net in one label', () => {
  const h = harness({ homeWidgets: 'default' });
  const card = byId(h.tree, 'home-hero-card');
  assert.equal(card.props.accessibilityRole, 'button');
  assert.equal(card.props.accessibilityState.expanded, false);
  assert.match(card.props.accessibilityLabel, /^Spent in September, AED 379\.34\. In AED 0\.00\. Net AED −379\.34$/);
  // Named actions: increment/decrement reach VoiceOver only on an adjustable control, and the card is a button.
  assert.equal(card.props.accessibilityActions.map((action) => action.name).join(), 'previousMonth');
  assert.ok(card.props.accessibilityActions[0].label.startsWith('Show '));
  assert.ok(byId(h.tree, 'home-hero-previous').props.accessibilityLabel.startsWith('Show '), 'a chevron button for last month');
  // Decorative pieces are hidden from assistive tech.
  for (const id of ['home-hero-line', 'home-hero-flow']) assert.equal(byId(h.tree, id).props.accessibilityElementsHidden, true, id);
});

test('every transaction row is one tap target that opens its detail sheet', () => {
  const h = harness({ homeWidgets: 'default' });
  const list = byId(h.tree, 'home-widget-activity');
  assert.equal(walk(list).filter((node) => node.props?.testID === 'transaction-merchant-link').length, 0,
    'no separate merchant-name target on Home');
  const rows = walk(list).filter((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'button'
    && /, (minus|plus) /.test(node.props.accessibilityLabel ?? ''));
  assert.equal(rows.length, 4);
  rows[0].props.onPress();
  assert.ok(h.events.some(([kind, value]) => kind === 'state' && value?.id === 'careem'), 'the row opens the transaction sheet');
  byId(h.tree, 'home-see-all').props.onPress();
  assert.deepEqual(h.events.at(-1), ['route', '/transactions']);
  // The shared row keeps its merchant link by default elsewhere.
  const row = fs.readFileSync(path.join(root, 'src/components/transaction-row.tsx'), 'utf8');
  assert.match(row, /merchantLinks = true/);
});

test('Needs you: nothing, or only the highest-priority need, with a way there and a dismiss', () => {
  assert.equal(byId(harness({ homeWidgets: 'default' }).tree, 'home-needs-you'), undefined, 'nothing needs the person: no pill');
  // Android without Pro: tracking is paused, and outranks an overdue card.
  const overdue = [{ id: 'card-due', title: 'Sky', kind: 'card', dueId: 'due-1', dateISO: '2026-09-01', daysLeft: -3,
    amountFils: 500000, overdue: true, urgent: false }];
  const paused = harness({ homeWidgets: 'default', pro: false, upcoming: overdue });
  const pill = byId(paused.tree, 'home-needs-you');
  assert.ok(pill);
  const open = byId(paused.tree, 'home-needs-you-open');
  assert.equal(open.props.accessibilityRole, 'button');
  assert.equal(open.props.accessibilityLabel, 'Tracking is paused');
  open.props.onPress();
  assert.deepEqual(paused.events.at(-1), ['route', '/pro']);
  assert.equal(byId(paused.tree, 'home-needs-you-dismiss').props.accessibilityLabel, 'Dismiss');
  const scaffold = walk(paused.tree).find((node) => node.type === 'BandScaffold');
  assert.ok(scaffold.props.floatingClearance >= 60, 'the sheet clears the pill');
  // With tracking running, the overdue card payment is the need; it opens that payment.
  const card = harness({ homeWidgets: 'default', upcoming: overdue, cardDues: [{ id: 'due-1' }] });
  assert.equal(byId(card.tree, 'home-needs-you-open').props.accessibilityLabel, 'Sky payment overdue');
  byId(card.tree, 'home-needs-you-open').props.onPress();
  assert.equal(JSON.stringify(card.events.at(-1)), JSON.stringify(['state', { id: 'due-1' }]));
  // One short visible line at every text size; the full sentence is what it speaks.
  const line = walk(byId(card.tree, 'home-needs-you-open')).find((node) => node.props?.numberOfLines !== undefined);
  assert.equal(line.props.numberOfLines, 1);
  assert.ok(line.props.maxFontSizeMultiplier <= 1.2);
  assert.equal(text(line).trim(), 'Card payment overdue');
  const pillStyle = Object.assign({}, ...[walk(byId(card.tree, 'home-needs-you'))[1].props.style].flat(Infinity).filter(Boolean));
  assert.equal(pillStyle.height, 44, 'a fixed one-line pill');
  // A deliberate opt-out of capture is not nagged about.
  assert.equal(byId(harness({ homeWidgets: 'default', optOut: true }).tree, 'home-needs-you'), undefined);
});

test('Capture shows by itself while tracking needs the person, and not once it is running', () => {
  const ids = (tree) => walk(tree).map((node) => node.props?.testID).filter(Boolean);
  assert.ok(!ids(harness({ homeWidgets: 'default' }).tree).includes('journal-import-controls'), 'running: off as saved');
  const off = harness({ homeWidgets: 'default', needsPermission: true });
  const drawn = ids(off.tree);
  assert.ok(drawn.includes('home-section-capture'), 'tracking off: Capture is drawn');
  assert.ok(drawn.indexOf('home-section-capture') > drawn.indexOf('home-widget-activity'), 'at its saved place, after the transactions');
  assert.ok(ids(harness({ homeWidgets: 'default', pro: false }).tree).includes('home-section-capture'),
    'paused (Android without Pro): drawn too');
  // A deliberate opt-out is not a need.
  assert.ok(!ids(harness({ homeWidgets: 'default', optOut: true }).tree).includes('journal-import-controls'));
});

test('Home: a quiet line for transfers the Needs you pill does not name; no heading over an empty list', () => {
  const home = fs.readFileSync(path.join(root, 'src/screens/journal-home-screen.tsx'), 'utf8');
  assert.match(home, /const quietTransfers = !homeWidgetVisible\(drawnWidgets, 'transfers'\) && pendingTransfers\s*&& pendingTransfers\.count > 0 && pendingTransfers\.questions === 0/);
  assert.match(home, /footer=\{quietTransfers\}/);
  assert.match(home, /testID="home-transfers-waiting"[\s\S]{0,200}accessibilityLabel=\{homeWords\.transfersToAnswer\(pendingTransfers\.count\)\}/);
  const recent = fs.readFileSync(path.join(root, 'src/components/home/home-recent.tsx'), 'utf8');
  assert.match(recent, /if \(count === 0 && !empty && !footer\) return null;/);
  // Last month's side says which month had nothing, not "this month".
  const heroSource = fs.readFileSync(path.join(root, 'src/components/home/home-hero.tsx'), 'utf8');
  assert.match(heroSource, /empty=\{front \? words\.noSpendingYet : words\.noSpendingIn\(month\.name\)\}/);
  // The early return sits after every hook.
  assert.ok(recent.indexOf('return null;') > recent.lastIndexOf('useMemo('));
});

test('Needs you floats above the tab bar normally, and sits inline at the top of the sheet with large text or a short window', () => {
  const overdue = [{ id: 'card-due', title: 'Sky', kind: 'card', dueId: 'due-1', dateISO: '2026-09-01', daysLeft: -3,
    amountFils: 500000, overdue: true, urgent: false }];
  const placement = (options) => {
    // iOS: no floating Add button, so the end padding is the pill's alone.
    const { tree } = harness({ homeWidgets: 'default', platform: 'ios', upcoming: overdue, ...options });
    const scaffold = walk(tree).find((node) => node.type === 'BandScaffold');
    const inSheet = walk(scaffold.props.children).find((node) => node.props?.testID === 'home-needs-you');
    const pill = byId(tree, 'home-needs-you');
    const style = Object.assign({}, ...[pill.props.style].flat(Infinity).filter(Boolean));
    const sheet = walk(scaffold.props.children[1]);
    return { inSheet: !!inSheet, style, clearance: scaffold.props.floatingClearance,
      beforeList: sheet.findIndex((node) => node.props?.testID === 'home-needs-you') < sheet.findIndex((node) => node.props?.testID === 'home-widget-activity'),
      label: byId(tree, 'home-needs-you-open').props.accessibilityLabel, dismiss: !!byId(tree, 'home-needs-you-dismiss') };
  };
  const floating = placement({});
  assert.equal(floating.inSheet, false, 'normal size: outside the scroll content');
  assert.equal(floating.style.position, 'absolute');
  assert.ok(floating.clearance >= 56, 'the sheet pads its end so the last rows scroll clear');
  for (const options of [{ largeText: true }, { fontScale: 1.2 }, { height: 699 }]) {
    const inline = placement(options);
    assert.equal(inline.inSheet, true, `${JSON.stringify(options)}: in the sheet`);
    assert.ok(inline.beforeList, 'above Transactions');
    assert.notEqual(inline.style.position, 'absolute');
    assert.equal(inline.style.alignSelf, 'stretch', 'full width');
    assert.equal(inline.clearance, 0, 'no floating clearance is added for it');
    assert.equal(inline.label, 'Sky payment overdue', 'the same need and spoken label');
    assert.ok(inline.dismiss, 'the same dismiss');
  }
  assert.equal(placement({ height: 700, fontScale: 1.19 }).inSheet, false, 'the thresholds: 700pt and 1.2x');
});

test('a limit over this month is the last need, and opens the limits', () => {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const h = harness({ homeWidgets: 'default', budgets: [{ category: 'shopping', limitFils: 100 }] });
  // The harness ledger is dated September 2026; a limit counts only in the running month.
  const pill = byId(h.tree, 'home-needs-you-open');
  if (key === '2026-09') {
    assert.equal(pill.props.accessibilityLabel, '1 limit over');
  } else {
    assert.equal(pill, undefined, 'last month\'s spending does not put this month over');
  }
});

test('Arabic: every Home v3 word is Arabic and the layout mirrors through logical edges', () => {
  const h = harness({ homeWidgets: 'default', language: 'ar', pro: false });
  const words = text(h.tree);
  assert.match(words, /الإنفاق في سبتمبر/);
  assert.match(words, /المعاملات/);
  assert.equal(byId(h.tree, 'home-needs-you-open').props.accessibilityLabel, 'التتبع متوقف مؤقتًا');
  for (const file of ['home-hero', 'home-recent', 'needs-you-pill', 'home-sparkline']) {
    const source = fs.readFileSync(path.join(root, `src/components/home/${file}.tsx`), 'utf8');
    assert.doesNotMatch(source, /\b(left|right|marginLeft|marginRight|paddingLeft|paddingRight): /, `${file} uses start/end`);
    assert.doesNotMatch(source, /#[0-9A-Fa-f]{3,8}\b['"]/, `${file} has no hard-coded colour`);
  }
});

test('larger text stacks In and Net and keeps the hero figure on its own fitted line', () => {
  const h = harness({ homeWidgets: 'default', largeText: true });
  const flow = byId(h.tree, 'home-hero-flow');
  const flat = Object.assign({}, ...[flow.props.style].flat(Infinity).filter(Boolean));
  assert.equal(flat.flexDirection, 'column');
  assert.equal(byId(h.tree, 'home-spending-total').type !== undefined, true);
});

test('Home motion follows the coin rules: one native clock per group, no JS timers, gated on the reveal', () => {
  for (const file of ['home-hero', 'home-recent', 'needs-you-pill', 'home-sparkline']) {
    const source = fs.readFileSync(path.join(root, `src/components/home/${file}.tsx`), 'utf8');
    assert.doesNotMatch(source, /Animated\.(delay|sequence|stagger)\b|setTimeout|setInterval/, `${file}: no JS-timer staggers`);
    assert.doesNotMatch(source, /useNativeDriver: false/, `${file}: native driver only`);
  }
  const hero = fs.readFileSync(path.join(root, 'src/components/home/home-hero.tsx'), 'utf8');
  assert.match(hero, /useCoinClock\(\)/);
  assert.match(hero, /useCoinRun\(clock, reveal\.run, live\)/);
  assert.match(hero, /rotateY/);
  assert.match(hero, /perspective/);
  const recent = fs.readFileSync(path.join(root, 'src/components/home/home-recent.tsx'), 'utf8');
  assert.match(recent, /settledThisSession/);
  const tilt = fs.readFileSync(path.join(root, 'src/hooks/use-device-tilt.ts'), 'utf8');
  assert.match(tilt, /requireOptionalNativeModule/);
  assert.match(tilt, /Platform\.OS === 'web'/);
  assert.match(tilt, /reducedMotion/);
  const screen = fs.readFileSync(path.join(root, 'src/screens/journal-home-screen.tsx'), 'utf8');
  assert.match(screen, /hold=\{!revealReady\}/);
});
