// Shared alert shapes (src/lib/shared-alert-formats.ts).
// In-memory TS loader (no shared build dir). Run: node --test scripts/test/shared-alert-formats.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('../universal-test/load-ts.cjs');

const load = createLoader();
const L = load('@/lib/learned-alert-formats');
const S = load('@/lib/shared-alert-formats');
const NOW = Date.parse('2026-09-25T10:00:00Z');

const learn = (source, sender, confirmed, context = {}) => {
  const r = L.learnFromConfirmation({ source, sender, confirmed, context, now: NOW });
  assert.equal(r.ok, true, `learning refused: ${r.reason} for ${source}`);
  return r.template;
};
const inr = (amountMinor, extra = {}) => ({ amountMinor, currency: 'INR', exponent: 2, direction: 'debit', ...extra });

const TAUPE = 'Taupe Bank: Rs 450.00 debited from A/c XX1234 on 03-09-2026 at SWIGGY BANGALORE. Avl Bal Rs 9,550.00.';
const taupe = () => learn(TAUPE, 'TAUPEB', inr(45000, { merchant: 'SWIGGY BANGALORE', date: '2026-09-03' }), { country: 'IN' });
const shared = (template = taupe()) => {
  const r = S.toSharedAlertShape(template);
  assert.equal(r.ok, true, `sharing refused: ${r.reason}`);
  return { hash: r.hash, shape: r.shape };
};
const clone = (value) => JSON.parse(JSON.stringify(value));

test('round trip: learn, share, validate, then post a second message of the same format', () => {
  const format = shared();
  assert.deepEqual(S.validateSharedAlertShape(clone(format.shape)), format.shape);
  assert.equal(S.sharedAlertShapeHash(format.shape), format.hash);
  const hit = S.matchSharedAlertShape(
    'Taupe Bank: Rs 1,299.50 debited from A/c XX9876 on 14-09-2026 at AMAZON PAY INDIA. Avl Bal Rs 100.00.',
    'taupeb', [format], { now: NOW });
  assert.equal(hit.kind, 'post');
  assert.equal(hit.hash, format.hash);
  assert.equal(hit.fields.amountMinor, 129950);
  assert.equal(hit.fields.direction, 'debit');
  assert.equal(hit.fields.date, '2026-09-14');
  assert.equal(hit.fields.merchant, 'AMAZON PAY INDIA');
});

test('a shape that contradicts the message direction gives none', () => {
  const format = shared();
  const flipped = { ...format.shape, direction: 'credit' };
  const bad = { hash: S.sharedAlertShapeHash(flipped), shape: flipped };
  const hit = S.matchSharedAlertShape(
    'Taupe Bank: Rs 800.00 debited from A/c XX1234 on 04-09-2026 at ZOMATO. Avl Bal Rs 700.00.', 'TAUPEB', [bad], { now: NOW });
  assert.equal(hit.kind, 'none');
});

test('pending or declined wording is never posted', () => {
  const format = shared();
  for (const text of [
    'Taupe Bank: Rs 450.00 debit is pending from A/c XX1234 on 03-09-2026 at SWIGGY BANGALORE. Avl Bal Rs 9,550.00.',
    'Taupe Bank: Rs 450.00 debited from A/c XX1234 on 03-09-2026 at SWIGGY BANGALORE declined. Avl Bal Rs 9,550.00.',
  ]) {
    assert.notEqual(S.matchSharedAlertShape(text, 'TAUPEB', [format], { now: NOW }).kind, 'post');
  }
});

test('AE/SA senders refuse sharing and matching', () => {
  const template = { ...taupe(), sender: 'ADCB', key: 's:ADCB' };
  assert.deepEqual(S.toSharedAlertShape(template), { ok: false, reason: 'launch-market' });
  const format = shared();
  const hit = S.matchSharedAlertShape(TAUPE, 'TAUPEB', [format], { now: NOW, routedMarket: 'AE' });
  assert.equal(hit.kind, 'none');
  assert.equal(S.matchSharedAlertShape(TAUPE, 'TAUPEB', [format], { now: NOW, launchRoute: true }).kind, 'none');
  assert.equal(S.matchSharedAlertShape(TAUPE, 'ADCB', [{ ...format, shape: { ...format.shape, sender: 'ADCB' } }], { now: NOW }).kind, 'none');
});

test('missing, phone-like and e-mail senders refuse', () => {
  const t = taupe();
  assert.equal(S.toSharedAlertShape({ ...t, sender: null }).reason, 'no-sender');
  assert.equal(S.toSharedAlertShape({ ...t, sender: '+91 98765 43210' }).reason, 'phone-like-sender');
  assert.equal(S.toSharedAlertShape({ ...t, sender: 'a@b.co' }).reason, 'email-sender');
  assert.equal(S.toSharedAlertShape({ ...t, blocked: true }).reason, 'blocked');
  assert.equal(S.toSharedAlertShape({ ...t, tokens: t.tokens.filter((x) => x.k !== 'AMT') }).reason, 'no-amount');
});

test('literals: unflagged words share; digits, links and long tokens refuse', () => {
  const t = taupe();
  const withLiteral = (v) => ({ ...t, tokens: [{ k: 'L', v }, ...t.tokens] });
  assert.equal(S.toSharedAlertShape(withLiteral('dear priya')).ok, true);
  for (const v of ['ref 1234', 'mail me@x.co', 'visit http://x.co', 'go www.bank.in', 'a'.repeat(24)]) {
    assert.equal(S.toSharedAlertShape(withLiteral(v)).reason, 'unsafe-literal', v);
  }
});

test('a word flagged as a possible name refuses the shape unless it is banking boilerplate', () => {
  const t = taupe();
  const named = learn('Dear Customer, Rs 450.00 debited from A/c XX1234 by Naser Khanjar on 03-09-2026. Avl Bal Rs 9,550.00.',
    'TAUPEB', inr(45000, { date: '2026-09-03' }), { country: 'IN' });
  assert.ok(named.tokens.some((x) => x.k === 'L' && x.m === 1 && /naser/i.test(x.v)), 'the learner flags the name');
  assert.equal(S.toSharedAlertShape(named).reason, 'possible-name');
  const flaggedBoilerplate = { ...t, tokens: [{ k: 'L', v: 'debited', m: 1 }, ...t.tokens] };
  assert.equal(S.toSharedAlertShape(flaggedBoilerplate).ok, true);
});

test('without a sender only one unambiguous shape may prefill, never post', () => {
  const format = shared();
  const text = 'Taupe Bank: Rs 1,299.50 debited from A/c XX9876 on 14-09-2026 at AMAZON PAY INDIA. Avl Bal Rs 100.00.';
  for (const sender of ['', null, undefined]) {
    const hit = S.matchSharedAlertShape(text, sender, [format], { now: NOW });
    assert.equal(hit.kind, 'prefill', String(sender));
    assert.equal(hit.fields.amountMinor, 129950);
  }
  const twin = { ...format.shape, sender: 'OTHERBK' };
  const both = [format, { hash: S.sharedAlertShapeHash(twin), shape: twin }];
  assert.equal(S.matchSharedAlertShape(text, '', both, { now: NOW }).kind, 'none', 'two banks claim the layout');
  assert.equal(S.matchSharedAlertShape(text, '', [format], { now: NOW, routedMarket: 'SA' }).kind, 'none');
});

test('oversized templates refuse', () => {
  const t = taupe();
  const words = Array.from({ length: 125 }, () => ({ k: 'L', v: `${'w'.repeat(19)} ${'x'.repeat(19)} ${'y'.repeat(19)}` }));
  assert.deepEqual(S.toSharedAlertShape({ ...t, tokens: [...words, ...t.tokens] }), { ok: false, reason: 'too-large' });
});

test('validator is strict: unknown keys, bad currency, non-public alias, bad tokens, oversize', () => {
  const { shape } = shared();
  assert.ok(S.validateSharedAlertShape(clone(shape)));
  const bad = (patch) => S.validateSharedAlertShape({ ...clone(shape), ...patch });
  assert.equal(bad({ extra: 1 }), null);
  assert.equal(bad({ v: 2 }), null);
  assert.equal(bad({ currency: 'XXX' }), null);
  assert.equal(bad({ currency: 'inr' }), null);
  assert.equal(bad({ direction: 'none' }), null);
  assert.equal(bad({ dateOrder: 'DDMM' }), null);
  assert.equal(bad({ advisory: 'yes' }), null);
  assert.equal(bad({ aliases: { 'SWIGGY': 'INR' } }), null);
  assert.equal(bad({ aliases: { 'rs': 'USD' } }), null);
  assert.equal(bad({ sender: 'taupeb' }), null);
  assert.equal(bad({ sender: '9876543210' }), null);
  assert.equal(bad({ sender: 'ADCB' }), null);
  assert.equal(bad({ tokens: [] }), null);
  assert.equal(bad({ tokens: [{ k: 'AMT', x: 1 }] }), null);
  assert.equal(bad({ tokens: [{ k: 'AMT' }, { k: 'AMT' }] }), null);
  assert.equal(bad({ tokens: [{ k: 'ZZZ' }] }), null);
  assert.equal(bad({ tokens: [{ k: 'AMT' }, { k: 'L', v: 'has 1 digit' }] }), null);
  assert.equal(bad({ tokens: [{ k: 'AMT' }, { k: 'BAL', iso: 'nope' }] }), null);
  assert.equal(bad({ tokens: [{ k: 'AMT' }, ...Array.from({ length: 160 }, () => ({ k: 'L', v: 'x' }))] }), null);
  assert.equal(bad({ tokens: [{ k: 'AMT' }, ...Array.from({ length: 125 }, () => ({ k: 'L', v: `${'w'.repeat(19)} ${'x'.repeat(19)} ${'y'.repeat(19)}` }))] }), null);
  assert.equal(S.validateSharedAlertShape(null), null);
  assert.equal(S.validateSharedAlertShape([]), null);
});

test('list validation drops hash mismatches, bad shapes and duplicates, and honours the cap', () => {
  const a = shared();
  const other = { ...clone(a.shape), direction: 'credit' };
  const b = { hash: S.sharedAlertShapeHash(other), shape: other };
  const list = [a, { hash: 'f'.repeat(64), shape: b.shape }, { hash: b.hash, shape: { ...b.shape, extra: 1 } }, a, b, 'junk', null];
  assert.deepEqual(S.validateSharedAlertFormatList(list).map((x) => x.hash), [a.hash, b.hash]);
  assert.equal(S.validateSharedAlertFormatList(list, 1).length, 1);
  assert.equal(S.validateSharedAlertFormatList({}), null);
});

test('hash is stable across key order and changes with content', () => {
  const { shape, hash } = shared();
  const reordered = {};
  for (const key of Object.keys(shape).reverse()) reordered[key] = shape[key];
  reordered.tokens = shape.tokens.map((t) => Object.fromEntries(Object.entries(t).reverse()));
  assert.equal(S.sharedAlertShapeHash(reordered), hash);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(S.sharedAlertShapeHash({ ...shape, direction: 'credit' }), hash);
});
