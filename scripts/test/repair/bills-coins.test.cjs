'use strict';
// Bills' motion: the timeline's logos drop onto their dates and pop when
// tapped, a price rise nudges up once, and a recorded payment is stamped
// Paid. All of it is decoration beside written figures: these tests pin the
// drawing to the real payments and keep every spoken label as it was.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
const hidden = (node) => node.props.accessibilityElementsHidden === true &&
  node.props.importantForAccessibility === 'no-hide-descendants';
const item = (id, dateISO, extra = {}) => ({ id, title: id, dateISO, category: 'entertainment',
  amountFils: 1234, estimated: false, paid: false, kind: 'subscription', daysLeft: 0, ...extra });
const items = [item('Netflix', '2026-09-20'), item('Spotify', '2026-09-15', { estimated: true }),
  item('Paid', '2026-09-16', { paid: true }), item('Beyond window', '2026-10-20')];

function timeline(options = {}, input = items) {
  const h = createHarness(options);
  const palette = h.deps['@/constants/theme'].bandPalette('bills', options.theme ?? 'light');
  const tree = h.deps['@/components/bills/bills-timeline'].BillsTimeline({ items: input, todayISO: '2026-09-15', palette });
  return { h, tree, palette };
}

test('a logo is drawn for every payment in the window, decorative and out of the accessibility tree', () => {
  const { tree } = timeline();
  const logos = walk(tree).filter((node) => String(node.props?.testID ?? '').startsWith('bills-timeline-logo-'));
  // Sized from the real payments: only the two unpaid ones inside 30 days, in date order.
  assert.deepEqual(logos.map((node) => node.props.testID), ['bills-timeline-logo-Spotify', 'bills-timeline-logo-Netflix']);
  for (const logo of logos) {
    assert.ok(hidden(logo), 'the drawing is hidden; its pin speaks');
    const tap = walk(logo).find((node) => node.type === 'Pressable');
    assert.equal(tap.props.accessible, false);
    assert.equal(tap.props.focusable, false);
    assert.equal(tap.props.importantForAccessibility, 'no');
    assert.equal(tap.props.accessibilityLabel, undefined, 'no second spoken label');
  }
  // Under Reduce Motion (the harness) every logo is already on its date and undimmed.
  for (const key of ['Spotify', 'Netflix']) assert.equal(byId(tree, `bills-timeline-paint-${key}`).props.style[1].opacity.value, 1);
  assert.equal(byId(tree, 'bills-timeline-lifted'), undefined, 'nothing lifted until a tap');
});

test('the spoken labels and figures are unchanged by the drawing', () => {
  const { h, tree } = timeline();
  const { shortDate } = h.format;
  assert.equal(tree.props.accessible, false);
  assert.equal(tree.props.accessibilityLabel, 'Next 30 days: Spotify today About AED 12.34, Netflix in 5 days AED 12.34');
  assert.deepEqual(walk(tree).filter((node) => String(node.props?.testID ?? '').startsWith('bills-timeline-payment-'))
    .map((node) => node.props.accessibilityLabel),
  [`Spotify. ${shortDate('2026-09-15')}. today. About AED 12.34`, `Netflix. ${shortDate('2026-09-20')}. in 5 days. AED 12.34`]);
});

test('tapping a logo toggles it; the lifted one shows its date and amount (visual only), the rest dim', () => {
  const first = timeline();
  byId(first.tree, 'bills-timeline-tap-Netflix').props.onPress();
  const [, index, update] = first.h.events.find((event) => event[0] === 'state');
  assert.equal(typeof update, 'function');
  assert.equal(update(null), 'Netflix');
  assert.equal(update('Netflix'), null, 'a second tap puts it back');
  assert.equal(update('Spotify'), 'Netflix', 'another logo switches');

  const { tree, palette } = timeline({ states: { [index]: 'Netflix' } });
  const lifted = byId(tree, 'bills-timeline-lifted');
  assert.ok(hidden(lifted), 'the label repeats what the pin already speaks');
  assert.match(text(lifted), /Netflix · 20 Sept? · AED 12\.34/);
  const chip = walk(lifted).find((node) => node.props?.style?.[1]?.backgroundColor);
  assert.equal(chip.props.style[1].backgroundColor, palette.selected);
  // Paint only: the others dim, the lifted one does not; dates keep full strength.
  assert.equal(byId(tree, 'bills-timeline-paint-Netflix').props.style[1].opacity.value, 1);
  const dimmed = byId(tree, 'bills-timeline-paint-Spotify').props.style[1].opacity.value;
  assert.ok(dimmed > 0 && dimmed < 1);
  assert.equal(byId(tree, 'bills-payment-due-Spotify').props.style[1].opacity, undefined);
  // The spoken strip is the same with or without a selection.
  assert.equal(tree.props.accessibilityLabel, first.tree.props.accessibilityLabel);
});

test('with nothing lifted, the same line quietly names the next payment, so a tap never moves the agenda', () => {
  const { tree } = timeline();
  assert.equal(byId(tree, 'bills-timeline-lifted'), undefined);
  const next = byId(tree, 'bills-timeline-next');
  assert.ok(next && hidden(next), 'visual only: every pin already speaks its payment');
  // Spotify (today, estimated) is the soonest unpaid payment in the window.
  assert.match(text(next), /^Spotify · .+ · About AED 12\.34$/);
});

test('Arabic keeps the same drawing and spoken order', () => {
  const { tree } = timeline({ language: 'ar', largeText: true });
  const logos = walk(tree).filter((node) => String(node.props?.testID ?? '').startsWith('bills-timeline-logo-'));
  assert.equal(logos.length, 2);
  assert.match(tree.props.accessibilityLabel, /حوالي/);
});

/* ── Subscriptions: the price rise nudge ─────────────────────────────── */

const spotifyUp = { title: 'Spotify', category: 'entertainment', lastAmountFils: 1199, avgAmountFils: 1199, monthlyEquivalentFils: 1199,
  priorTypicalFils: 1099, cadence: 'monthly', status: 'active', group: 'subscription', nextExpectedISO: '2026-09-18',
  lastChargedISO: '2026-08-18', chargeCount: 6, paymentHistory: false, priceIncreased: true };
const netflix = { ...spotifyUp, title: 'Netflix', lastAmountFils: 1549, avgAmountFils: 1549, monthlyEquivalentFils: 1549,
  priorTypicalFils: 1549, nextExpectedISO: '2026-09-12', lastChargedISO: '2026-08-12', priceIncreased: false };

function billsWith(detected, options = {}) {
  const h = createHarness({ platform: 'ios', ...options });
  const real = h.deps['@/lib/subscriptions'];
  h.deps['@/lib/subscriptions'] = { ...real, detectSubscriptions: () => detected,
    peekSubscriptionDetection: () => detected,
    activeSubscriptions: (s) => s.filter((x) => x.status === 'active'),
    stoppedSubscriptions: (s) => s.filter((x) => x.status === 'stopped'),
    trueSubscriptions: (s) => s.filter((x) => x.group === 'subscription') };
  return h;
}

test('a price rise keeps its words and gains a still up arrow', () => {
  const tree = billsWith([netflix, spotifyUp]).render('bills');
  const note = byId(tree, 'bills-price-up-nudge-sub-spotify');
  assert.ok(note, 'the note sits with its arrow');
  assert.match(text(byId(note, 'bills-price-up-sub-spotify')), /^· was AED 10.99 · Price went up$/);
  const arrow = walk(note).find((node) => node.props && hidden(node));
  assert.ok(arrow && walk(arrow).some((node) => node.type === 'svg'), 'the arrow is decoration');
  // The timeline is the screen's one moving part: the note itself never moves.
  assert.ok(!walk(note).some((node) => node.props?.style && JSON.stringify(node.props.style).includes('translateY')));
  assert.equal(byId(tree, 'bills-price-up-nudge-sub-netflix'), undefined, 'no arrow without a rise');
});

/* ── A bill recorded as paid ──────────────────────────────────────────── */

const fs = require('node:fs');
const path = require('node:path');
const billsSource = fs.readFileSync(path.resolve(__dirname, '../../../src/app/(tabs)/bills.tsx'), 'utf8');

function confirmPaid(language) {
  const h = createHarness({ language, states: { 4: { id: 'dewa', dueISO: '2026-09-08' } } });
  const tree = h.render('bills');
  assert.equal(byId(tree, 'bills-paid-stamp'), undefined);
  const label = language === 'ar' ? 'تسجيل كمدفوعة' : 'Record as paid';
  walk(tree).find((node) => node.props?.accessibilityLabel === label).props.onPress();
  const confirmation = h.events.find((event) => event[0] === 'state' && typeof event[2]?.onConfirm === 'function')[2];
  const before = h.events.length;
  confirmation.onConfirm();
  return h.events.slice(before);
}

test('recording a bill as paid books it first, then asks for the stamp only once the store shows it paid', () => {
  const after = confirmPaid();
  const booked = after.findIndex((event) => event[0] === 'markBillPaid' && event[1] === 'dewa');
  const asked = after.findIndex((event) => event[0] === 'state' && event[2]?.billId === 'dewa');
  assert.ok(booked >= 0 && asked > booked, 'the payment is never held back by the stamp');
  assert.deepEqual({ ...after[asked][2] }, { billId: 'dewa', month: '2026-09', title: 'DEWA' });
  assert.equal(after.some((event) => event[0] === 'state' && event[2]?.id === 'dewa-2026-09'), false,
    'nothing is stamped before the store answers');
  // The store can refuse (already paid, a captured payment landed, a changed
  // amount): the stamp is drawn only when the bill's month reads as paid.
  assert.match(billsSource, /b\.id === stampAsked\.billId && b\.paidMonths\.includes\(stampAsked\.month\)[\s\S]{0,40}\n\s*if \(booked\) setPaidStamp\(/);
});

function stampTree(language) {
  // The paid stamp's state sits just before the request for it.
  const after = confirmPaid(language);
  const [, index] = after.find((event) => event[0] === 'state' && event[2]?.billId === 'dewa');
  return byId(createHarness({ language, states: { [index - 1]: { id: 'dewa-2026-09', title: 'DEWA' } } }).render('bills'),
    'bills-paid-stamp');
}

test('the stamp is drawn, hidden from assistive tech and said once the same way on both platforms', () => {
  const stamp = stampTree();
  assert.ok(stamp);
  assert.ok(hidden(stamp), 'the drawing itself says nothing');
  assert.equal(stamp.props.accessibilityLiveRegion, undefined);
  assert.match(text(stamp), /Paid[\s\S]*DEWA/);
  assert.match(billsSource, /AccessibilityInfo\.announceForAccessibility\(`\$\{title\}: \$\{paid\}`\)/);
  // Still under Reduce Motion: full size, upright, opaque.
  const motion = stamp.props.style[2];
  assert.equal(motion.opacity.value, 1);
  assert.equal(motion.transform[0].scale.value, 1);
});

test('the Arabic stamp uses the existing Paid copy', () => {
  assert.match(text(stampTree('ar')), /مدفوع[\s\S]*DEWA/);
});
