'use strict';
// Fictional regression layouts exercise the real two-confirmation runtime and
// source-owned Review contract; they are not received-message coverage proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./load-ts.cjs');
const NOW = Date.parse('2026-10-12T12:00:00Z');
const FIRST = 'Bank alert: Card ending 1234. Ledger item GBP 12.34 at TESCO. Date: 03/04/2026.';
const SECOND = FIRST.replace('1234', '5678').replace('12.34', '20.50').replace('TESCO', 'ASDA').replace('03/04', '05/04');
const THIRD = FIRST.replace('1234', '2468').replace('12.34', '29.95').replace('TESCO', 'LIDL').replace('03/04', '07/04');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function fixture({ country = 'US', currency = 'GBP', sender = 'BARCLAYS' } = {}) {
  const load = createLoader();
  load('@/lib/markets').setActiveMarket('ZZ'); load('@/lib/markets').setLedgerCurrency(currency, 2);
  load('@/lib/country').setActiveCountry(country);
  const teaching = load('@/lib/private-alert-teaching');
  const module = load('@/lib/private-alert-format-runtime');
  let secret = null, hold = false, reads = 0, sourceScopes = 0;
  const gate = deferred();
  const originalScope = teaching.privateAlertSourceDateContext;
  teaching.privateAlertSourceDateContext = (...args) => { sourceScopes++; return originalScope(...args); };
  const runtime = module.createPrivateAlertFormatRuntime({ isNative: () => true,
    async readSecret() { reads++; if (hold) await gate.promise; return secret; },
    async writeSecret(value) { secret = value; }, async removeSecret() { secret = null; },
    async randomBytes() { return new Uint8Array(32).fill(37); } });
  runtime.activate({ version: 1, templates: [] });
  const input = (source, merchant, date, options = {}) => teaching.buildPrivateTeachingInput({ source, sender,
    choiceId: options.choiceId ?? 'money-0', direction: 'debit', merchant, date, country, now: NOW });
  const review = (source, match, options = {}) => load('@/lib/private-alert-format-review').privateAlertFormatReviewEvent(
    source, sender, NOW, match, { country, ...options });
  return { load, teaching, module, runtime, input, review, country, sender, gate,
    holdKey(value) { hold = value; }, counts: () => ({ reads, sourceScopes }) };
}

async function teach(h, first = FIRST, second = SECOND, firstDate = '2026-04-03', secondDate = '2026-04-05', options = {}) {
  const input = h.input(first, 'TESCO', firstDate);
  assert.equal(input.ok, true, input.reason);
  // Model older callers still supplying their selected country's date order.
  if (options.inputDateOrder) input.input.context.dateOrder = options.inputDateOrder;
  const created = await h.runtime.prepareFromInput(() => input.input);
  assert.equal(created.ok, true, created.reason);
  const validated = await h.runtime.validateFromSample(created.template, () => ({ source: second, sender: h.sender }),
    { country: h.country, dateOrder: options.validationDateOrder ?? h.load('@/lib/country').dateOrderForCountry(h.country), now: NOW });
  assert.equal(validated.ok, true, validated.reason);
  assert.equal(validated.fields.date, secondDate);
  const formats = { version: 1, templates: [validated.template] }; h.runtime.activate(formats);
  return { created, validated, formats };
}

test('US-selected Barclays GBP teaching, validation, capture/History matching and Review use one issuer-owned day-first convention', async () => {
  const h = fixture();
  const initial = h.input(FIRST, 'TESCO', '2026-04-03'); assert.equal(initial.ok, true);
  assert.equal(initial.input.context.country, 'US'); assert.equal(initial.input.context.dateOrder, 'DMY');
  const { validated } = await teach(h, FIRST, SECOND, '2026-04-03', '2026-04-05', { inputDateOrder: 'MDY', validationDateOrder: 'MDY' });
  assert.equal(validated.template.dateOrder, 'DMY');
  for (const options of [{ country: 'US' }, { country: 'US', dateOrder: 'MDY' }, { country: 'DE' }]) {
    const match = await h.runtime.session(options).read(THIRD, h.sender, NOW);
    assert.ok(match); assert.equal(match.fields.date, '2026-04-07'); assert.equal(match.fields.amountMinor, 2995);
    const event = h.review(THIRD, match, options);
    assert.ok(event); assert.equal(event.decision, 'review'); assert.equal(event.status, 'unknown');
    assert.equal(event.direction, 'debit'); assert.equal(event.transactionDate.value, '2026-04-07');
    assert.equal(event.amount.value.minorUnits, '2995'); assert.ok(event.issues.includes('learned-format'));
    assert.ok(!JSON.stringify(event).includes(THIRD));
  }
});

test('the opposite US/UK convention also completes the actual two-sample process', async () => {
  const h = fixture({ country: 'GB', currency: 'USD', sender: 'CHASE' });
  const first = FIRST.replace('GBP', 'USD'), second = SECOND.replace('GBP', 'USD'), third = THIRD.replace('GBP', 'USD');
  const { validated } = await teach(h, first, second, '2026-03-04', '2026-05-04', { inputDateOrder: 'DMY', validationDateOrder: 'DMY' });
  assert.equal(validated.template.dateOrder, 'MDY');
  const match = await h.runtime.session({ country: 'GB', dateOrder: 'DMY' }).read(third, 'CHASE', NOW);
  assert.ok(match); assert.equal(match.fields.date, '2026-07-04');
  const event = h.review(third, match, { dateOrder: 'DMY' });
  assert.ok(event); assert.equal(event.transactionDate.value, '2026-07-04');
});

test('a user-confirmed date contradicting the qualified issuer refuses preparation', async () => {
  const h = fixture(); const input = h.input(FIRST, 'TESCO', '2026-03-04'); assert.equal(input.ok, true);
  const result = await h.runtime.prepare(input.input);
  assert.equal(result.ok, false); assert.equal(result.reason, 'confirmed-field-not-grounded');
});

test('body-bank mentions do not manufacture a qualified issuer or override an explicit unqualified context', async () => {
  const h = fixture({ sender: '' });
  const first = FIRST.replace('TESCO', 'BARCLAYS'), second = SECOND.replace('ASDA', 'BARCLAYS'), third = THIRD.replace('LIDL', 'BARCLAYS');
  assert.equal(h.teaching.privateAlertSourceDateContext(first, '', { country: 'US' }).dateOrder, 'MDY');
  assert.equal(h.teaching.privateAlertSourceDateContext(first, '', { country: 'US', dateOrder: 'DMY' }).dateOrder, 'DMY');
  const built = h.input(first, 'BARCLAYS', '2026-03-04'); assert.equal(built.ok, true);
  const created = await h.runtime.prepare(built.input); assert.equal(created.ok, true, created.reason);
  const validated = await h.runtime.validate(created.template, second, '', { country: 'US', now: NOW });
  assert.equal(validated.ok, true, validated.reason); h.runtime.activate({ version: 1, templates: [validated.template] });
  const match = await h.runtime.session({ country: 'US' }).read(third, '', NOW);
  assert.ok(match); assert.equal(match.fields.date, '2026-07-04');
  assert.equal((await h.runtime.session({ country: 'US', dateOrder: 'DMY' }).read(third, '', NOW)), null);
  assert.equal(h.review(third, match).transactionDate.value, '2026-07-04');
});

test('foreign principal and home-currency balance retain the user convention through preparation and Review', async () => {
  const h = fixture({ currency: 'EUR' });
  const foreign = text => text.replace('GBP', 'EUR').replace('Ledger item', 'Your card was charged') + ' Available balance GBP 900.00.';
  const first = foreign(FIRST), second = foreign(SECOND), third = foreign(THIRD);
  assert.equal(h.teaching.privateAlertSourceDateContext(first, 'BARCLAYS', { country: 'US' }).dateOrder, 'MDY');
  assert.equal(h.teaching.privateAlertSourceDateContext(first, 'BARCLAYS', { country: 'US', dateOrder: 'DMY' }).dateOrder, 'DMY');
  const { validated } = await teach(h, first, second, '2026-03-04', '2026-05-04');
  assert.equal(validated.template.dateOrder, 'MDY');
  const match = await h.runtime.session({ country: 'US' }).read(third, 'BARCLAYS', NOW);
  assert.ok(match); assert.equal(match.fields.date, '2026-07-04');
  const event = h.review(third, match); assert.ok(event); assert.equal(event.transactionDate.value, '2026-07-04');
  assert.equal(event.amount.value.currency, 'EUR'); assert.equal(event.amount.value.minorUnits, '2995');
  assert.equal(event.balance.value.currency, 'GBP');
});

test('shared dollars and balances cannot circularly corroborate an issuer convention or create an eligible amount', async () => {
  const h = fixture({ country: 'GB', currency: 'USD', sender: 'CHASE' });
  const source = FIRST.replace('GBP 12.34', '$12.34');
  assert.equal(h.teaching.privateAlertSourceDateContext(source, 'CHASE', { country: 'GB' }).dateOrder, 'DMY');
  const input = h.input(source, 'TESCO', '2026-04-03'); assert.equal(input.ok, false); assert.equal(input.reason, 'choose-amount');
  const balance = 'Bank alert: Card ending 1234. Available balance USD 12.34. Date: 03/04/2026.';
  assert.equal(h.teaching.privateAlertSourceDateContext(balance, 'CHASE', { country: 'GB' }).dateOrder, 'DMY');
  assert.equal(h.input(balance, '', '2026-04-03').ok, false);
});

test('competing issuers suppress a numeric date instead of falling back to country', async () => {
  const h = fixture();
  const source = 'CHASE Bank. ' + FIRST;
  const scoped = h.teaching.privateAlertSourceDateContext(source, 'BARCLAYS', { country: 'US', dateOrder: 'MDY' });
  assert.equal(scoped.country, null); assert.equal(scoped.dateOrder, null);
  const input = h.input(source, 'TESCO', '2026-03-04'); assert.equal(input.ok, true);
  const created = await h.runtime.prepare(input.input); assert.equal(created.ok, false); assert.equal(created.reason, 'confirmed-field-not-grounded');
  const { created: good } = await teach(h);
  // A variable counterparty can introduce a competing institution without
  // changing the remembered layout. The sealed order must not reopen it.
  const changed = THIRD.replace('LIDL', 'CHASE Bank');
  assert.equal(h.teaching.privateAlertSourceDateContext(changed, 'BARCLAYS', { country: 'US' }).issuerConflict, true);
  const hit = await h.runtime.session({ country: 'US', dateOrder: 'MDY' }).read(changed, 'BARCLAYS', NOW);
  assert.equal(hit, null); assert.equal(h.review(changed, hit), null);
  const checked = await h.runtime.validate(good.template, SECOND.replace('ASDA', 'CHASE Bank'), 'BARCLAYS', { country: 'US', now: NOW });
  assert.equal(checked.ok, false);
});

test('an independently explicit ISO date remains usable through a conflicting issuer layout', async () => {
  const h = fixture();
  const first = FIRST.replace('03/04/2026', '2026-04-03');
  const second = SECOND.replace('05/04/2026', '2026-04-05');
  const third = THIRD.replace('07/04/2026', '2026-04-07').replace('LIDL', 'CHASE Bank');
  await teach(h, first, second);
  const hit = await h.runtime.session({ country: 'US' }).read(third, 'BARCLAYS', NOW);
  assert.ok(hit); assert.equal(hit.fields.date, '2026-04-07');
  const event = h.review(third, hit); assert.ok(event); assert.equal(event.transactionDate.value, '2026-04-07');
});

test('the narrow calendar fix does not add Jordan JD aliases to the private teaching schema', () => {
  const h = fixture({ currency: 'JOD', sender: 'ARABBANK' });
  const source = FIRST.replace('GBP 12.34', 'JD 12.345');
  assert.equal(h.teaching.privateAlertSourceDateContext(source, 'ARABBANK', { country: 'US' }).dateOrder, 'DMY');
  assert.ok(!h.teaching.privateTeachingChoices(source, 'US', 'ARABBANK').money.some(choice => choice.selectable));
  const input = h.input(source, 'TESCO', '2026-04-03'); assert.equal(input.ok, false); assert.equal(input.reason, 'choose-amount');
});

for (const suffix of [' Your OTP is 123456.', ' Payment failed.', ' Payment scheduled tomorrow.', ' Payment pending.',
  ' Statement total GBP 12.34.', ' Minimum due GBP 12.34.']) {
  test(`qualified calendar conventions cannot reopen a whole-source control: ${suffix}`, async () => {
    const h = fixture(); await teach(h);
    const source = THIRD + suffix;
    const match = await h.runtime.session({ country: 'US' }).read(source, 'BARCLAYS', NOW);
    assert.equal(match, null); assert.equal(h.review(source, match), null);
  });
}

test('wrong sender, mature launch routes, copied matches and retired generations cannot issue Review facts', async () => {
  const h = fixture(); const { formats } = await teach(h);
  assert.equal(await h.runtime.session({ country: 'US' }).read(THIRD, 'UNKNOWN-BANK', NOW), null);
  assert.equal(await h.runtime.session({ country: 'US', routedMarket: 'AE' }).read(THIRD, 'BARCLAYS', NOW), null);
  assert.equal(await h.runtime.session({ country: 'US', launchRoute: true }).read(THIRD, 'BARCLAYS', NOW), null);
  const match = await h.runtime.session({ country: 'US' }).read(THIRD, 'BARCLAYS', NOW); assert.ok(match);
  assert.equal(h.review(THIRD, { ...match }), null); assert.equal(h.review(THIRD, match, { country: 'SA' }), null);
  const matureInput = h.input(FIRST, 'TESCO', '2026-04-03'); matureInput.input.sender = 'ADCB';
  assert.equal((await h.runtime.prepare(matureInput.input)).ok, false);
  h.runtime.activate(formats); assert.equal(h.review(THIRD, match), null);
});

test('per-source calendar resolution occurs only after secure IO and is skipped when a deferred read retires', async () => {
  const h = fixture(); const { formats } = await teach(h); h.holdKey(true);
  const prior = h.counts(); let getters = 0;
  const session = h.runtime.session({ country: 'US', dateOrder: 'MDY' });
  const pending = session.readFromSource(() => { getters++; return { source: THIRD, sender: 'BARCLAYS', observedAt: NOW }; });
  await tick(); assert.ok(h.counts().reads > prior.reads); assert.equal(getters, 0); assert.equal(h.counts().sourceScopes, prior.sourceScopes);
  h.runtime.activate(formats); h.gate.resolve(); assert.equal(await pending, null);
  assert.equal(getters, 0); assert.equal(h.counts().sourceScopes, prior.sourceScopes);
});
