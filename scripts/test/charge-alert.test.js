/**
 * The iOS per-charge banner, checked the way the Android one is: one-sided.
 *
 * A missing banner costs the user nothing — the row is in the encrypted inbox
 * before this code is even reached, and the ledger gets it on the next
 * foreground. A WRONG banner, announcing a charge that never happened or
 * quoting a figure the bank never sent, is the thing worth failing a build
 * over. So most of what follows is refusals.
 *
 * instant-alert.test.js does the same job for InstantAlert.kt and has to
 * extract the Kotlin's regexes to do it, because that code re-reads the SMS
 * text with patterns of its own. Nothing like that is needed here: these rows
 * were parsed by the real parser on the Worker, so every rule is a property of
 * a structured field and this suite can simply call the shipping function.
 */
const alert = require('./build/charge-alert');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

const NOW = Date.parse('2026-08-06T14:00:00Z');

/** A relay row as the Worker seals it: parsed, raw text already discarded. */
function row(over = {}) {
  return {
    kind: 'transaction',
    type: 'expense',
    amountFils: 4250,
    currency: 'AED',
    merchant: 'CARREFOUR',
    date: '2026-08-06',
    dueDay: null,
    minDueFils: null,
    card: { last4: '1234', kind: 'credit' },
    reference: null,
    transferHint: false,
    snapshotFils: null,
    snapshotKind: null,
    categoryGuess: 'groceries',
    categoryDeliberate: true,
    captureSource: 'shortcut',
    smsTs: NOW - 60_000,
    ...over,
  };
}

const announce = (r) => alert.isAnnounceable(r, NOW);

/* ── What may never be announced ─────────────────────────────────────── */
//
// Each of these is the structured form of a refusal the Kotlin spends a regex
// on. It is the same judgement reached from better evidence.

ok('a completed purchase is announced', announce(row()));

// "Your July statement of AED 20,918 is due on 27/07" charges nothing. The
// Kotlin keeps these out by requiring a completed verb; here they are simply
// not `kind: 'transaction'`.
ok('a statement is not a charge', !announce(row({ kind: 'cardStatement', amountFils: 2091800 })));
ok('a bill due is not a charge', !announce(row({ kind: 'billDue' })));

// A card settlement moves money between the user's own accounts. The daily
// summary excludes the same rows; a banner that disagreed with the summary of
// the same day would be worse than no banner at all.
ok('a card payment is not a charge', !announce(row({ kind: 'cardPayment' })));
ok('an own-account transfer leg is not a charge', !announce(row({ transferHint: true })));

// A figure that is not a figure — the structured cousin of the Kotlin
// refusing a masked balance like "AED ····1985.47".
ok('a zero amount is not announced', !announce(row({ amountFils: 0 })));
ok('a negative amount is not announced', !announce(row({ amountFils: -100 })));
ok('a fractional amount is not announced', !announce(row({ amountFils: 12.5 })));
ok('NaN is not announced', !announce(row({ amountFils: NaN })));

// Statement imports are dozens of rows at once, most of them weeks old.
// Announcing them tells the user they just spent their way through a quarter.
ok('an emailed statement row is not announced', !announce(row({ captureSource: 'email' })));
ok('a PDF statement row is not announced', !announce(row({ captureSource: 'pdf' })));
ok('a CSV statement row is not announced', !announce(row({ captureSource: 'csv' })));
// A setup probe never carries a capture source, so the capture test cannot
// post a banner for a transaction that was never real.
ok('a row with no capture source is not announced', !announce(row({ captureSource: undefined })));

// A wake can arrive long after the charge: the phone was off, or iOS withheld
// background refresh. "AED 42.50 · CARREFOUR" as fresh news about yesterday
// afternoon is a different claim from the true one.
ok(
  'a charge just inside the window is announced',
  announce(row({ smsTs: NOW - alert.ALERT_MAX_AGE_MS + 1000 })),
);
ok('a stale charge is not announced', !announce(row({ smsTs: NOW - alert.ALERT_MAX_AGE_MS - 1000 })));
ok('a charge stamped next week is not announced', !announce(row({ smsTs: NOW + 7 * 86400000 })));
ok(
  'a slightly fast clock is tolerated',
  announce(row({ smsTs: NOW + alert.ALERT_MAX_SKEW_MS - 1000 })),
);
ok('a missing timestamp is not announced', !announce(row({ smsTs: undefined })));

/* ── One banner per sync, never a burst ──────────────────────────────── */

eq('nothing to say returns null', alert.buildChargeAlert([], NOW, 'en'), null);
eq(
  'a sync of only refused rows returns null',
  alert.buildChargeAlert([row({ kind: 'billDue' }), row({ captureSource: 'pdf' })], NOW, 'en'),
  null,
);

{
  const one = alert.buildChargeAlert([row()], NOW, 'en');
  eq('a single charge speaks for one row', one.count, 1);
  eq('a single charge names the merchant and the exact figure', one.title, 'AED 42.50 · CARREFOUR');
  // The category is the part Android cannot have: deciding it needs the real
  // parser, and a broadcast receiver has no engine to run one.
  eq('a single charge names the card and the category', one.body, 'Credit Card •1234 · Groceries');
}

{
  const plain = alert.buildChargeAlert([row({ merchant: '   ' })], NOW, 'en');
  eq('an unnamed merchant falls back to the amount alone', plain.title, 'AED 42.50 spent');
}

{
  // `other` means two opposite things — a deliberate "money moved but was not
  // spent", and an untouched fall-through. Printing the fall-through would
  // dress a shrug up as a finding.
  const vague = alert.buildChargeAlert(
    [row({ categoryGuess: 'other', categoryDeliberate: false })],
    NOW,
    'en',
  );
  eq('an undecided category is not printed', vague.body, 'Credit Card •1234');
  const noCard = alert.buildChargeAlert(
    [row({ card: null, categoryGuess: 'other', categoryDeliberate: false })],
    NOW,
    'en',
  );
  eq('a row with neither card nor category has an empty body', noCard.body, '');
}

{
  const credit = alert.buildChargeAlert(
    [row({ type: 'income', merchant: 'ADCB REFUND', categoryGuess: 'other', categoryDeliberate: true })],
    NOW,
    'en',
  );
  eq('money arriving says so', credit.title, 'AED 42.50 received · ADCB REFUND');
}

{
  // Four charges in one wake. Android never produces this shape, because its
  // trigger is one message; posting four notifications in the same second is
  // how an app gets muted, and a muted Wafra loses the payment reminders too.
  const many = alert.buildChargeAlert(
    [
      row({ amountFils: 4250, merchant: 'CARREFOUR', smsTs: NOW - 300_000 }),
      row({ amountFils: 240000, merchant: 'EMIRATES', smsTs: NOW - 200_000 }),
      row({ amountFils: 1500, merchant: 'CAREEM', smsTs: NOW - 100_000 }),
    ],
    NOW,
    'en',
  );
  eq('several charges are one banner', typeof many.title, 'string');
  eq('the grouped banner speaks for every charge', many.count, 3);
  eq('the grouped total and count are the spending', many.title, 'AED 2,458 spent · 3 charges');
  // Largest first: a banner on a lock screen gets four seconds and the
  // AED 2,400 row is the one worth them.
  eq(
    'the grouped body names each charge, largest first',
    many.body,
    'AED 2,400 — EMIRATES\nAED 42.50 — CARREFOUR\nAED 15 — CAREEM',
  );
}

{
  // A grouped line holds itself to the same naming rule as a single banner:
  // `other` from an untouched fall-through is a shrug, and "AED 42.50 — Other"
  // dresses it up as a finding. Not reachable through the relay validator
  // today, which is exactly when a rule quietly stops being enforced.
  const vague = alert.buildChargeAlert(
    [
      row({ amountFils: 30000, merchant: 'NOON' }),
      row({ amountFils: 4250, merchant: '', categoryGuess: 'other', categoryDeliberate: false }),
    ],
    NOW,
    'en',
  );
  ok('a nameless grouped row is the amount alone', vague.body.endsWith('AED 42.50 spent'), vague.body);
  const byCategory = alert.buildChargeAlert(
    [
      row({ amountFils: 30000, merchant: 'NOON' }),
      row({ amountFils: 4250, merchant: '', categoryGuess: 'dining', categoryDeliberate: true }),
    ],
    NOW,
    'en',
  );
  ok('a decided category may stand in for a missing merchant',
    byCategory.body.endsWith('AED 42.50 — Dining'), byCategory.body);
}

{
  const capped = alert.buildChargeAlert(
    Array.from({ length: 8 }, (_, i) =>
      row({ amountFils: (8 - i) * 1000, merchant: `SHOP${i}`, smsTs: NOW - i * 1000 }),
    ),
    NOW,
    'en',
  );
  eq('a long list collapses the tail', capped.body.split('\n').length, alert.ALERT_ROWS + 1);
  ok('the collapsed tail is counted', capped.body.endsWith('+3 more'), capped.body);
}

{
  // A refund landing in the same wake as two purchases. Netting it against
  // them would print a total matching nothing the user could check.
  const mixed = alert.buildChargeAlert(
    [
      row({ amountFils: 10000, merchant: 'SPINNEYS' }),
      row({ amountFils: 30000, merchant: 'NOON' }),
      row({ amountFils: 5000, merchant: 'AMAZON REFUND', type: 'income' }),
    ],
    NOW,
    'en',
  );
  eq('a refund is not netted off the headline', mixed.title, 'AED 400 spent · 2 charges');
  ok('the refund still gets its own line', mixed.body.includes('+AED 50 — AMAZON REFUND'), mixed.body);
  eq('the banner still speaks for all three rows', mixed.count, 3);
}

{
  const onlyIn = alert.buildChargeAlert(
    [
      row({ amountFils: 900000, merchant: 'SALARY', type: 'income' }),
      row({ amountFils: 5000, merchant: 'REFUND', type: 'income' }),
    ],
    NOW,
    'en',
  );
  eq('a wake of only credits leads with what arrived', onlyIn.title, 'AED 9,050 received · 2 payments');
}

/* ── The currency is the row's, not the app's ────────────────────────── */
//
// formatAED prefixes whatever market pack is active, and "active" is module
// state set during hydrate — which a headless wake can run before. A Saudi
// user's SAR 42.50 purchase announced as "AED 42.50" is the right number under
// the wrong name, which is a false claim about how much money left.

{
  const sar = alert.buildChargeAlert([row({ currency: 'SAR' })], NOW, 'en');
  eq('a single charge is priced in its own currency', sar.title, 'SAR 42.50 · CARREFOUR');
  const sarGroup = alert.buildChargeAlert(
    [row({ currency: 'SAR', amountFils: 10000 }), row({ currency: 'SAR', amountFils: 30000 })],
    NOW,
    'en',
  );
  eq('a grouped total is priced in its own currency', sarGroup.title, 'SAR 400 spent · 2 charges');
}

{
  // Only reachable by changing market with a backlog in flight, but adding SAR
  // to AED produces a figure that is not an amount of anything.
  const mixed = alert.buildChargeAlert(
    [
      row({ currency: 'AED', amountFils: 30000, merchant: 'NOON' }),
      row({ currency: 'SAR', amountFils: 20000, merchant: 'JARIR' }),
    ],
    NOW,
    'en',
  );
  eq('currencies are never added together', mixed.title, 'AED 300 spent · 1 charge');
  ok('the other currency keeps its own line', mixed.body.includes('SAR 200 — JARIR'), mixed.body);
}

/* ── Arabic ──────────────────────────────────────────────────────────── */
//
// The language is passed in rather than read from i18n's module state, because
// this runs in a headless task that can execute before hydrate has set it. An
// Arabic user would otherwise get English banners at exactly the moments they
// never opened the app.

{
  const ar = alert.buildChargeAlert([row()], NOW, 'ar');
  ok('the Arabic banner is Arabic', /بطاقة/.test(ar.body), ar.body);
  const arPlain = alert.buildChargeAlert([row({ merchant: '' })], NOW, 'ar');
  ok('the Arabic fallback title is Arabic', /صُرف/.test(arPlain.title), arPlain.title);
  const arGroup = alert.buildChargeAlert(
    [row({ amountFils: 1000 }), row({ amountFils: 2000, smsTs: NOW - 2000 })],
    NOW,
    'ar',
  );
  ok('the Arabic grouped title is Arabic', /صُرف/.test(arGroup.title), arGroup.title);
}

/* ── Nothing derived from a bank message is anywhere but the strings ─── */
//
// The module composes text and returns it. There is no fetch, no storage, no
// analytics call anywhere in it — the banner is built on the phone, shown on
// the phone, and that is the whole of its travel.
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../src/lib/charge-alert.ts'),
    'utf8',
  );
  ok('the banner builder reaches no network', !/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(src));
  ok('the banner builder writes nowhere', !/setItem|AsyncStorage|SecureStore/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
