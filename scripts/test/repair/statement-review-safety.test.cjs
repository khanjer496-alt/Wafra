// Public regressions preserve the reported bank wording with synthetic card/amount values.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const builtRequire = require('node:module').createRequire(path.join(root, 'scripts/test/build/auto-import.js'));
const current = new Map();
// Execute the changed extraction and capture seams from source, with the
// established compiled dependencies. No shared build mutation during audits.
function source(name) {
  const file = path.join(root, 'src/lib', `${name}.ts`);
  const deps = { 'react-native': builtRequire('./stub-react-native'),
    'expo-crypto': builtRequire('./stub-expo-crypto'), 'expo-secure-store': builtRequire('./stub-secure-store'),
    '../../modules/notification-reader': builtRequire('./notification-reader'),
    '../../modules/sms-reader': builtRequire('./sms-reader') };
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (Object.hasOwn(deps, match[1])) continue;
    const dep = match[1].startsWith('@/lib/') ? match[1].slice('@/lib/'.length) : null;
    Object.defineProperty(deps, match[1], { enumerable: true, get: () =>
      dep ? current.get(dep) ?? require(path.join(root, 'scripts/test/build', dep)) : builtRequire(match[1]) });
  }
  const result = load(file, deps);
  current.set(name, result);
  return result;
}
source('universal-money');
const { inspectUniversalBankEvent } = source('universal-parser');
const { createLaunchAlertSession } = source('launch-alert-parser');
const parsedReview = source('parsed-review-event');
source('auto-import');
const { preflightLocalMessageRecord, parseLocalMessageRecord } = source('local-message-record');
const { planConfirmedUniversalImport } = require('../build/universal-import.js');
const { setActiveMarket, setLedgerCurrency } = require('../build/markets.js');
setActiveMarket('AE');
setLedgerCurrency('AED', 2);

// Reported statement and receipt; mutations below are explicitly safety
// probes of those fixtures, not claimed additional bank formats.
const statement = 'Cr.Card XXX9426 Billing alert: Total due to avoid fin. charges: AED9249.64. Due date Sep 30 2026; Pay min. AED462.48 by due date to avoid AED241.50 late fees.';
const receipt = 'Your payment of AED 9251 against Credit Card no. XXX9426 was received at 12:10 PM on 30/09/2026. Thank you.';
const now = new Date('2026-09-30T09:00:00.000Z');
const state = { hydrated: true, marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  transactions: [], accounts: [{ id: 'card', kind: 'card', last4: '9426', cardType: 'credit' }] };
function confirm(event, minorUnits) {
  return planConfirmedUniversalImport(state, event, { confirmed: true, postingStatus: 'posted',
    amount: { currency: 'AED', exponent: 2, minorUnits }, direction: 'debit', accountId: 'card',
    title: 'Card payment', category: 'other', date: '2026-09-30',
    sourceKey: 'apple_notification_review_source_20000000000040008000000000000001', observedAt: +now });
}
function notification(text) {
  const serialized = JSON.stringify({ v: 1, id: '20000000-0000-4000-8000-000000000001',
    text, sender: 'Wafra Notification', source: 'notification', observedAt: now.toISOString() });
  const preflight = preflightLocalMessageRecord(serialized, now);
  return parseLocalMessageRecord(serialized, now, preflight.market, createLaunchAlertSession({ overrides: {} }));
}
function assertStatement(event, total) {
  assert.equal(event.family, 'statement');
  assert.equal(event.status, 'informational');
  assert.equal(event.direction, 'none');
  assert.equal(event.amount.value, null);
  assert.equal(event.amount.alternatives.length, 0);
  assert.equal(event.statementTotal.value?.minorUnits ?? null, total);
  assert.equal(event.minimumDue.value?.minorUnits, '46248');
  assert.equal(event.dueDate.value, '2026-09-30');
  assert.equal(event.instrument.value.last4, '9426');
  for (const amount of ['924964', '46248', '24150']) {
    assert.equal(confirm(event, amount).reason, 'unsupported-event');
  }
}

test('the reported ADCB statement stays an obligation in universal Review', () => {
  assertStatement(inspectUniversalBankEvent(statement), '924964');
});
for (const total of ['XXXX', '9,24.64', '9249.641']) {
  test(`an unreadable total (${total}) never promotes the minimum or late fee`, () => {
    assertStatement(inspectUniversalBankEvent(statement.replace('9249.64', total)), null);
  });
}
test('iOS notification keeps statement Review fields and cannot confirm spending', () => {
  for (const text of [statement, statement.replace('9249.64', 'XXXX')]) {
    const outcome = notification(text);
    assert.equal(outcome.kind, 'review');
    assertStatement(outcome.item.event, text === statement ? '924964' : null);
    assert.ok(!JSON.stringify(outcome).includes('Billing alert'), 'raw source must not leave capture');
  }
});
test('an unknown total label in the observed card billing heading cannot expose its other amounts as spending', () => {
  const event = inspectUniversalBankEvent(statement.replace('Total due to avoid fin. charges', 'Unrecognized total label'));
  assertStatement(event, null);
});
test('the exact card payment receipt stays settlement-only through notification Review', () => {
  const outcome = notification(receipt);
  assert.equal(outcome.kind, 'review');
  assert.equal(outcome.item.event.family, 'card-payment');
  assert.equal(confirm(outcome.item.event, '925100').reason, 'unsupported-event');
});
test('already parsed obligation facts survive an independent generic-review miss', () => {
  const { parseSms } = require('../build/sms-parser.js');
  const actualImport = current.get('auto-import');
  // Explicit boundary fault: a newly supported main-parser format may still
  // be unknown to generic Review. It must not erase already-proven facts.
  current.set('auto-import', { ...actualImport,
    inspectSourceFreeRefusedAlert: () => ({ kind: 'ignored', reason: 'unrecognized' }) });
  const local = source('local-message-record');
  current.set('auto-import', actualImport);
  for (const [text, family] of [[statement, 'statement'], [receipt, 'card-payment']]) {
    const parsed = parseSms(text);
    const event = parsedReview.parsedObligationReviewEvent(parsed);
    assert.equal(event.family, family);
    assert.equal(confirm(event, String(parsed.amountFils)).reason, 'unsupported-event');
    // Spacing mutation gives the senderless record an explicit AED route so
    // the real main-parser branch runs, independent of generic Review.
    const serialized = JSON.stringify({ v: 1, id: '20000000-0000-4000-8000-000000000001',
      text: text.replace(/AED(?=\d)/g, 'AED '), sender: 'Wafra Notification', source: 'notification', observedAt: now.toISOString() });
    const preflight = local.preflightLocalMessageRecord(serialized, now);
    assert.equal(preflight.market, 'AE');
    const outcome = local.parseLocalMessageRecord(serialized, now, preflight.market,
      { inspect: () => null, parse: () => parsed });
    assert.equal(outcome.kind, 'review');
    assert.equal(outcome.item.event.family, family);
    if (family === 'statement') assertStatement(event, '924964');
  }
});
test('card-payment Review direction follows settlement side, never the parser expense placeholder', () => {
  const parsed = require('../build/sms-parser.js').parseSms(receipt);
  assert.equal(parsed.type, 'expense');
  assert.equal(parsedReview.parsedObligationReviewEvent(parsed).direction, 'credit');
  assert.equal(parsedReview.parsedObligationReviewEvent({ ...parsed, cardPaymentSide: 'debit' }).direction, 'debit');
  assert.equal(parsedReview.parsedObligationReviewEvent({ ...parsed, cardPaymentSide: undefined }).direction, 'unknown');
});
test('unconfirmed Android packages preserve proven obligations in source-free Review', () => {
  const { parseSms } = require('../build/sms-parser.js');
  const { parsedFinancialCandidateReview } = current.get('auto-import');
  for (const [text, family] of [[statement, 'statement'], [receipt, 'card-payment']]) {
    const candidate = parsedFinancialCandidateReview(parseSms(text), +now);
    assert.ok(candidate);
    assert.equal(candidate.event.family, family);
    assert.equal(confirm(candidate.event, '924964').reason, 'unsupported-event');
    assert.ok(!JSON.stringify(candidate).includes(text));
  }
});
test('a purchase with a statement footer and the actual payment receipt keep their own families', () => {
  // Existing parser regression: the statement deadline is merely a footer.
  const purchase = 'Credit Card Purchase\nCard No XXXX4711\nAED 16.00\nMawgif DUBAI ARE\n03/07/26 15:51\nAvl Bal AED 9693.97\nJuly statement due on 27/07/2026';
  const event = inspectUniversalBankEvent(purchase);
  assert.notEqual(event.family, 'statement');
  assert.equal(event.amount.value?.minorUnits, '1600');
  assert.equal(inspectUniversalBankEvent(receipt).family, 'card-payment');
});
