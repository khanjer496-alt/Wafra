const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-ts.cjs').createLoader();
const file = path.resolve(__dirname, '../../src/lib/private-alert-teaching.ts');
const api = fs.existsSync(file) ? load('@/lib/private-alert-teaching') : {
  privateTeachingChoices: () => ({ money: [], reason: 'missing' }),
  buildPrivateTeachingInput: () => ({ ok: false, reason: 'missing' }),
};
const source = 'Bank alert: Card ending 2468. Ledger item EUR 12.40. Trading party: CEDAR BOOKSHOP. Date: 2026-10-10. Available balance EUR 900.00.';
test('teaching choices expose exact principal and disable balance decoys', () => {
  const choices = api.privateTeachingChoices(source, 'DE');
  assert.equal(choices.money.length, 2);
  assert.equal(choices.money[0].selectable, true);
  assert.equal(choices.money[0].money.minorUnits, '1240');
  assert.equal(choices.money[1].selectable, false);
  assert.equal(choices.money[1].role, 'balance');
});
test('the teaching form cannot silently select an ambiguous currency or truncated source', () => {
  assert.equal(api.privateTeachingChoices(source.replace('EUR 12.40', '$12.40'), 'ZZ').money.some(x => x.selectable && x.money?.minorUnits === '1240'), false);
  assert.equal(api.privateTeachingChoices(source + 'x'.repeat(1001), 'DE').reason, 'too-long');
});
test('confirmation preserves source fields without converting money through floating point', () => {
  const choices = api.privateTeachingChoices(source, 'DE');
  const result = api.buildPrivateTeachingInput({ source, sender: 'TESTBANK', choiceId: choices.money[0]?.id,
    direction: 'debit', merchant: 'CEDAR BOOKSHOP', date: '2026-10-10', country: 'DE', now: Date.parse('2026-10-12T12:00:00Z') });
  assert.equal(result.ok, true);
  assert.equal(result.input.confirmed.amountMinor, '1240');
  assert.equal(result.input.confirmed.currency, 'EUR');
  assert.equal(result.input.source, source);
});
test('unknown amounts, directions and invented optional fields cannot start teaching', () => {
  const choices = api.privateTeachingChoices(source, 'DE');
  const good = { source, sender: '', choiceId: choices.money[0]?.id, direction: 'debit', merchant: '', date: '', country: 'DE', now: 1791806400000 };
  for (const patch of [{ choiceId: 'missing' }, { choiceId: choices.money[1]?.id }, { direction: 'unknown' },
    { merchant: 'INVENTED SHOP' }, { date: '2026-02-30' }]) assert.equal(api.buildPrivateTeachingInput({ ...good, ...patch }).ok, false);
});
