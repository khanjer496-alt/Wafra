'use strict';
// The iOS live-capture route: when the Shortcut hands over a sender that names
// no bank (a phone number, a contact label, or nothing usable), the one bank
// the body names supplies the bank hint, exactly as the history route does.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const subjects = new Set(['sms-parser', 'bank-alert-interpreter', 'launch-alert-parser', 'local-message-record']);
const cache = new Map();
function current(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(root, 'src/lib', name + '.ts');
  const deps = {};
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
    const dep = match[1].slice(6);
    deps[match[1]] = subjects.has(dep) ? current(dep) : require(path.join(build, dep + '.js'));
  }
  const result = load(file, deps);
  cache.set(name, result);
  return result;
}
const markets = require(path.join(build, 'markets.js'));
markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
const { parseLocalMessageRecord } = current('local-message-record');
const { createLaunchAlertSession } = current('launch-alert-parser');
const adib = 'Dear Customer, your ADIB Covered Card ending with 4417 has been used for AED 250.00 at CARREFOUR MALL OF THE EMIRATES, DUBAI on 12/07/2026. Your available limit is AED 8,240.00.';
const parse = (text, sender) =>
  parseLocalMessageRecord(JSON.stringify({ v: 1, id: 'a'.repeat(64), text, sender, source: 'message', observedAt: '2026-07-12T10:30:00.000Z' }),
    new Date('2026-07-12T12:00:00Z'), 'AE', createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' }));

test('a sender that names no bank falls back to the one bank the body names', () => {
  const outcome = parse(adib, '+971501234567');
  assert.equal(outcome.kind, 'parsed');
  assert.equal(outcome.row.bankHint, 'ADIB');
});

test('a recognised sender still outranks the bank named in the body', () => {
  const outcome = parse(adib, 'ENBD');
  assert.equal(outcome.kind, 'parsed');
  assert.equal(outcome.row.bankHint, 'Emirates NBD');
});

test("another bank's ATM in the body does not displace the claimed bank", () => {
  const outcome = parse('AED 250.00 was spent on your ADIB Card ending 4417 at FAB ATM AL WAHDA MALL on 12/07/26. Available Balance: AED 8,240.00', '+971501234567');
  assert.equal(outcome.kind, 'parsed');
  assert.equal(outcome.row.bankHint, 'ADIB');
});

test('a body that names only another bank yields no bank hint', () => {
  const outcome = parse('AED 500.00 has been withdrawn from your Account XXX1234 at FAB ATM AL WAHDA MALL on 12/07/2026. Available Balance AED 2,900.00', '+971501234567');
  assert.equal(outcome.kind, 'parsed');
  assert.equal(outcome.row.bankHint, undefined);
});
