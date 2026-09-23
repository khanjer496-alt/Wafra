'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const file = path.join(root, 'src/lib/local-message-record.ts');
const dependencies = {};
for (const match of fs.readFileSync(file, 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
  dependencies[match[1]] = require(path.join(build, match[1].slice(6) + '.js'));
}
const { parseLocalMessageRecord } = load(file, dependencies);
const { createLaunchAlertSession } = require(path.join(build, 'launch-alert-parser.js'));
const { buildImportPlan } = require(path.join(build, 'import-plan.js'));
const { applyHealUpdates } = require(path.join(build, 'heal.js'));
const markets = require(path.join(build, 'markets.js'));
markets.setActiveMarket('AE');
markets.setLedgerCurrency('AED', 2);

const eventId = 'a'.repeat(64);
const observedAt = '2026-09-18T10:30:00.000Z';
const now = new Date('2026-09-19T12:00:00.000Z');
const text = 'Your card transaction was declined for AED 22.00.';
const parse = (id = eventId) => parseLocalMessageRecord(JSON.stringify({
  v: 1, id, text, sender: 'ENBD', source: 'message', observedAt,
}), now, 'AE', createLaunchAlertSession({ overrides: {} }));
const transaction = (patch = {}) => ({
  id: 'unrelated', type: 'expense', amountFils: 2200, category: 'other',
  accountId: 'bank', title: 'Synthetic purchase', date: '2026-09-18',
  ts: Date.parse(observedAt), source: 'sms', smsKey: 'h' + 'b'.repeat(64),
  ...patch,
});
const state = transactions => ({ hydrated: true, accounts: [], transactions,
  budgets: [], bills: [], goals: [], cardDues: [], accountHints: {},
  merchantOverrides: {}, lastScanTs: 0, parserVersion: 0,
});
const plan = transactions => {
  const outcome = parse();
  assert.equal(outcome.kind, 'declined');
  return buildImportPlan([], state(transactions), 0, now, [outcome.row]);
};

test('a local Message decline preserves only its validated exact source identity', () => {
  const outcome = parse();
  assert.equal(outcome.kind, 'declined');
  assert.equal(outcome.row.sourceEventId, eventId);
  assert.equal(outcome.row.smsTs, Date.parse(observedAt));
  assert.equal(Object.hasOwn(outcome.row, 'raw'), false);
  assert.equal(Object.hasOwn(outcome.row, 'sender'), false);
  assert.equal(JSON.stringify(outcome).includes(text), false);
});

test('an unrelated purchase at the same whole-second timestamp survives a local decline', () => {
  const original = transaction();
  const result = plan([original]);
  assert.equal(result.batch.updates.length, 0);
  assert.deepEqual(applyHealUpdates([original], result.batch.updates), [original]);
});

test('an exact Message decline removes only its prior misparse and preserves user edits', () => {
  const unrelated = transaction();
  const exact = transaction({ id: 'old-misparse', smsKey: 'h' + eventId });
  const result = plan([unrelated, exact]);
  assert.equal(result.batch.updates.length, 1);
  assert.equal(result.batch.updates[0].id, exact.id);
  assert.equal(result.batch.updates[0].remove, true);
  assert.deepEqual(applyHealUpdates([unrelated, exact], result.batch.updates), [unrelated]);
  assert.equal(plan([unrelated, { ...exact, userEdited: true }]).batch.updates.length, 0);
});

test('UUID automation compatibility is unchanged and malformed hash identities are rejected', () => {
  const uuid = parse('55555555-5555-4555-8555-555555555555');
  assert.equal(uuid.kind, 'declined');
  assert.equal(Object.hasOwn(uuid.row, 'sourceEventId'), false);
  for (const id of ['a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'A'.repeat(64)]) {
    assert.equal(parse(id).kind, 'invalid');
  }
});
