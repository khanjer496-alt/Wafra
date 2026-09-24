'use strict';
// A Capture v3 live row staged without Apple's GUID carries a queue UUID and
// its receipt time. It must stay open to the ledger's same-event rule so the
// History import copy of the same Message (SHA-256(GUID) and the Message's
// real date, seconds earlier) is one transaction, while two genuine purchases
// of the same amount minutes apart stay two. Synthetic bank grammar only.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const NOW = Date.parse('2026-07-12T12:00:00Z');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
const subjects = new Set(['local-message-record', 'historical-import', 'import-plan', 'ledger-import']);
const cache = new Map();
function current(name) {
  if (cache.has(name)) return cache.get(name);
  if (!subjects.has(name)) return require(path.join(build, name + '.js'));
  const file = path.join(root, 'src/lib', name + '.ts');
  const deps = {};
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
    if (!(match[1] in deps)) deps[match[1]] = current(match[1].slice(6));
  }
  const result = load(file, deps, { Date: Clock });
  cache.set(name, result);
  return result;
}
const markets = require(path.join(build, 'markets.js'));
markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
const { parseLocalMessageRecord } = current('local-message-record');
const { parseHistoricalMessageRecords } = current('historical-import');
const { createLaunchAlertSession } = require(path.join(build, 'launch-alert-parser.js'));
const session = () => createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' });

const alert = amount => `Dear Customer, your ADIB Covered Card ending with 4417 has been used for AED ${amount} at CARREFOUR MALL OF THE EMIRATES, DUBAI on 12/07/2026. Your available limit is AED 8,240.00.`;
const sha = value => createHash('sha256').update(value).digest('hex');

const liveRow = (text, observedAt, id = 'A1B2C3D4-0000-4000-8000-000000000001') => {
  const outcome = parseLocalMessageRecord(JSON.stringify({
    v: 1, id, text, sender: 'Wafra Automation', source: 'message', observedAt,
  }), new Clock(), 'AE', session());
  assert.equal(outcome.kind, 'parsed');
  return outcome.row;
};
const historyRows = messages => {
  const result = parseHistoricalMessageRecords(messages.map(([guid, text, receivedAt]) => JSON.stringify({
    v: 1, id: sha(guid), text, receivedAt,
  })), {}, new Clock(), new Set(), session());
  assert.equal(result.parsed.length, messages.length);
  return result.parsed;
};
const base = () => ({ hydrated: true, privateMode: true, marketId: 'AE',
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, billAliases: {}, notSubscriptions: [], lastScanTs: 0,
  parserVersion: 49 });
let serial = 0;
const apply = (parsed, state) => {
  const plan = current('import-plan').buildImportPlan(parsed, state, 0, new Clock(), []);
  const ledger = current('ledger-import');
  return ledger.applyMaterializedImportBatch(state,
    ledger.materializeImportBatch(plan.batch, state, prefix => `${prefix}-${++serial}`));
};

test('a GUID-less live row has no history identity and a non-history source key', () => {
  const row = liveRow(alert('250.00'), '2026-07-12T10:30:05.000Z');
  assert.equal(row.sourceEventId, undefined);
  const state = apply([row], base());
  assert.equal(state.transactions.length, 1);
  assert.equal(state.transactions[0].smsKey?.startsWith('h'), false);
  // A GUID-derived live row keeps its exact Apple identity.
  const guidRow = parseLocalMessageRecord(JSON.stringify({
    v: 1, id: sha('guid-x'), text: alert('250.00'), sender: 'ADIB', source: 'message',
    observedAt: '2026-07-12T10:30:05.000Z',
  }), new Clock(), 'AE', session()).row;
  assert.equal(guidRow.sourceEventId, sha('guid-x'));
});

test('live UUID row then History import of the same Message is one transaction', () => {
  const live = apply([liveRow(alert('250.00'), '2026-07-12T10:30:05.000Z')], base());
  assert.equal(live.transactions.length, 1);
  const after = apply(historyRows([['guid-one', alert('250.00'), '2026-07-12T10:30:00.000Z']]), live);
  assert.equal(after.transactions.length, 1, 'the History copy of a live Message must not post twice');
});

test('History import first, then the live UUID copy of the same Message is one transaction', () => {
  const history = apply(historyRows([['guid-one', alert('250.00'), '2026-07-12T10:30:00.000Z']]), base());
  const after = apply([liveRow(alert('250.00'), '2026-07-12T10:30:04.000Z')], history);
  assert.equal(after.transactions.length, 1);
});

test('two genuine same-amount purchases minutes apart stay two', () => {
  const live = apply([liveRow(alert('250.00'), '2026-07-12T10:30:05.000Z')], base());
  const second = apply([liveRow(alert('250.00'), '2026-07-12T10:36:05.000Z',
    'A1B2C3D4-0000-4000-8000-000000000002')], live);
  assert.equal(second.transactions.length, 2);
  // History later imports both Messages: still two, never four.
  const after = apply(historyRows([
    ['guid-one', alert('250.00'), '2026-07-12T10:30:00.000Z'],
    ['guid-two', alert('250.00'), '2026-07-12T10:36:00.000Z'],
  ]), second);
  assert.equal(after.transactions.length, 2);
});
