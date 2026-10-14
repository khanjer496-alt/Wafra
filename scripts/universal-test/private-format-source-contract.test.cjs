const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./load-ts.cjs').createLoader();
const runtimeModule = load('@/lib/private-alert-format-runtime');
const core = load('@/lib/private-alert-formats');
const contract = load('@/lib/ai-alert-source-contract');
const prepare = contract.preparePrivateFormatSourceReview ?? (() => null);
const now = Date.parse('2026-10-12T12:00:00Z');
const first = 'Ledger item GBP 46.80 at CEDAR BAKERY. Date: 2026-10-10.';
const second = first.replace('46.80', '73.25').replace('2026-10-10', '2026-10-11');
async function issued() {
  let secret = null;
  const runtime = runtimeModule.createPrivateAlertFormatRuntime({
    isNative: () => true, readSecret: async () => secret,
    writeSecret: async value => { secret = value; }, removeSecret: async () => { secret = null; },
    randomBytes: async () => new Uint8Array(32).fill(29),
  });
  runtime.activate(core.emptyPrivateAlertFormatStore());
  const draft = await runtime.prepare({ source: first, sender: 'UNLISTED',
    confirmed: { amountMinor: 4680, currency: 'GBP', exponent: 2, direction: 'debit', merchant: 'CEDAR BAKERY', date: '2026-10-10' },
    context: { country: 'GB', dateOrder: 'DMY' }, now });
  assert.equal(draft.ok, true);
  const validated = await runtime.validate(draft.template, second, 'UNLISTED', { now, country: 'GB', dateOrder: 'DMY' });
  assert.equal(validated.ok, true);
  runtime.activate({ version: 1, templates: [validated.template] });
  const match = await runtime.read(second, 'UNLISTED', now, { country: 'GB', dateOrder: 'DMY' });
  assert.ok(match);
  return { runtime, match };
}
test('a genuine validated local format supplies bank context without opening the model gate', async () => {
  assert.equal(contract.prepareAiSourceReview(second, { sender: 'UNLISTED', observedAt: now, dateOrder: 'DMY' }), null);
  const { match } = await issued();
  const prepared = prepare(second, { sender: 'UNLISTED', observedAt: now, dateOrder: 'DMY' }, match);
  assert.ok(prepared, 'trusted format context needs its own guarded source preparation');
  const event = contract.applyAiSourceReview(prepared, { amountId: 'none', family: 'unknown', merchantQuote: '', dateQuote: '' });
  assert.equal(event.decision, 'review');
  assert.equal(event.amount.value.minorUnits, '7325');
});
test('clones, other sources/senders/times, expired generation and hostile flags cannot supply format context', async () => {
  const { runtime, match } = await issued();
  const context = { sender: 'UNLISTED', observedAt: now, dateOrder: 'DMY' };
  assert.equal(prepare(second, context, { ...match }), null);
  assert.equal(prepare(second, { ...context, sender: 'OTHER' }, match), null);
  assert.equal(prepare(second, { ...context, observedAt: now + 1 }, match), null);
  assert.equal(prepare(second + ' Payment failed.', context, match), null);
  assert.equal(contract.prepareAiSourceReview(second, { ...context, trustedBankContext: true }), null);
  runtime.invalidate();
  assert.equal(prepare(second, context, match), null);
});

for (const label of ['Customer full name', 'Customer legal name', 'User name', 'Account holder full name',
  'الاسم الكامل للعميل', 'الاسم القانوني للعميل', 'Dear']) test(`explicit owner clause is never a learned or model payee: ${label}`, () => {
  const source = `Bank alert: Card ending 2468. Ledger item EUR 12.40. ${label}: SAMPLE OWNER. Date: 2026-10-10.`;
  const created = core.createPrivateAlertFormat({ source, sender: 'TEST', context: { country: 'DE', dateOrder: 'DMY' }, now,
    confirmed: { amountMinor: '1240', currency: 'EUR', exponent: 2, direction: 'debit', merchant: 'SAMPLE OWNER' } }, new Uint8Array(32).fill(37));
  assert.equal(created.ok, false);
  const prepared = contract.prepareAiSourceReview(source, { sender: 'TEST', observedAt: now, dateOrder: 'DMY' });
  assert.ok(prepared);
  assert.equal(contract.applyAiSourceReview(prepared, { amountId: 'm0', family: 'purchase', merchantQuote: 'SAMPLE OWNER', dateQuote: '' }), null);
});

test('a greeting excludes only the owner prefix and preserves the transaction that follows', () => {
  const source = 'Dear SAMPLE OWNER, Your card ending 2468 was charged EUR 12.40 at CEDAR BOOKSHOP on 2026-10-10.';
  const created = core.createPrivateAlertFormat({ source, sender: 'TEST', context: { country: 'DE', dateOrder: 'DMY' }, now,
    confirmed: { amountMinor: '1240', currency: 'EUR', exponent: 2, direction: 'debit', merchant: 'CEDAR BOOKSHOP', date: '2026-10-10' } }, new Uint8Array(32).fill(37));
  assert.equal(created.ok, true);
  const prepared = contract.prepareAiSourceReview(source, { sender: 'TEST', observedAt: now, dateOrder: 'DMY' });
  assert.ok(prepared);
  assert.ok(contract.applyAiSourceReview(prepared, { amountId: 'm0', family: 'purchase', merchantQuote: 'CEDAR BOOKSHOP', dateQuote: '2026-10-10' }));
  assert.equal(contract.applyAiSourceReview(prepared, { amountId: 'm0', family: 'purchase', merchantQuote: 'SAMPLE OWNER', dateQuote: '' }), null);
});
