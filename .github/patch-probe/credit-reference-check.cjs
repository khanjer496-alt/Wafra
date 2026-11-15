'use strict';
const fs = require('node:fs'), crypto = require('node:crypto'), vm = require('node:vm');
const load = require(process.cwd() + '/scripts/universal-test/load-ts.cjs').createLoader();
const sms = load('@/lib/sms-parser'), launch = load('@/lib/launch-alert-parser');
const history = load('@/lib/historical-import'), capture = load('@/lib/auto-import');
const tray = load('@/lib/alert-review-tray'), importer = load('@/lib/universal-import');
const meta = JSON.parse(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'));
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js', 'utf8'), sandbox);
const sender = 'ENBD', observedAt = Date.parse('2026-11-14T10:00:00Z');
const cases = require(process.cwd() + '/scripts/test/repair/credit-settlement-review-probes.json').filter(r => r.id.startsWith('owned-credit-reference:')).map(r => [r.id, r.body]);
const money = p => p ? { kind: p.kind, type: p.type, amountFils: p.amountFils, currency: p.currency } : null;
const review = event => event ? { status: event.status, direction: event.direction, amount: event.amount.value ?? null,
  issues: event.issues, confirmable: tray.isMoneyMovementReview({ kind: 'universal', event }),
  forced: importer.planConfirmedUniversalImport({ hydrated: true }, { ...event, status: 'posted' }, { confirmed: true, postingStatus: 'posted' }) } : null;
const rows = cases.map(([id, body]) => {
  load('@/lib/country').setActiveCountry('AE'); load('@/lib/markets').setActiveMarket('AE'); load('@/lib/markets').setLedgerCurrency('AED', 2);
  const session = launch.createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED', bestEffort: { enabled: true, country: 'AE' } });
  const source = sms.parseSms(body, {}, { sender });
  const parsed = session.parse(body, sender, session.inspect(body, sender), undefined, observedAt);
  const pair = sms.completedDebitBesideCredit(body, { sender });
  const supplementary = launch.inspectSupplementaryReversal(body, sender);
  const decision = capture.inspectSourceFreeRefusedAlert({ source: body, sender, observedAt, channel: 'inbox', session, acceptedExpense: parsed });
  const records = history.parseHistoricalMessageRecords([JSON.stringify({ v: 1, id: crypto.createHash('sha256').update(id).digest('hex'), text: body, sender, receivedAt: new Date(observedAt).toISOString() })], {}, new Date(observedAt), new Set(), session);
  const native = JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body, sender, observedAt,
    context: { v: 1, country: 'AE', parserMarket: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 }, sourceHash: meta.sourceHash } })));
  return { id, body, sender, source: money(source), session: money(parsed), pair, supplementary: review(supplementary), native,
    capture: { kind: decision.kind, review: decision.kind === 'review' && decision.candidate.kind === 'universal' ? review(decision.candidate.event) : null },
    history: { parsed: records.parsed.map(money), reviews: records.reviewCandidates.map(x => x.kind === 'universal' ? review(x.event) : { kind: x.kind }) } };
});
const assert = require('node:assert/strict');
for (const row of rows) {
  for (const p of [row.source, row.session, ...row.history.parsed]) { assert.equal(p.type, 'expense'); assert.equal(p.amountFils, 25000); }
  assert.equal(row.history.parsed.length, 1); assert.equal(row.history.reviews.length, 1);
  assert.equal(row.native.route, 'parsed'); assert.equal(row.native.notification.direction, 'debit'); assert.equal(row.native.notification.amount.minorUnits, '25000');
  for (const n of [row.supplementary, row.capture.review, ...row.history.reviews]) {
    assert.equal(n.status, 'informational'); assert.equal(n.direction, 'none'); assert.equal(n.amount.currency, 'AED'); assert.equal(n.amount.minorUnits, '4000');
    assert.equal(n.confirmable, false); assert.equal(n.forced.outcome, 'refused');
  }
}
assert.equal(rows.length, 4);
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/note-comma-results.json', JSON.stringify({ shippingHead: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim(), probeSide: process.env.GITHUB_SHA, meta, rows }, (_, v) => typeof v === 'bigint' ? String(v) : v, 2));
console.log(JSON.stringify(rows.map(r => ({ id: r.id, source: r.source, session: r.session, note: r.supplementary, history: r.history }))));
