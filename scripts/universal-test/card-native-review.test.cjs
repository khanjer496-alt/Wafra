'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs').createLoader();
const { extractUniversalMoney } = load('@/lib/universal-money');
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { alertMarketPack } = load('@/lib/alert-market-packs');
const { planConfirmedUniversalImport } = load('@/lib/universal-import');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { buildImportPlan } = load('@/lib/import-plan');
const { materializeImportBatch, applyMaterializedImportBatch } = load('@/lib/ledger-import');
const { duePaidFils } = load('@/lib/cards');
const markets = load('@/lib/markets');
const undoPolicy = load('@/lib/best-effort-autopost');
const { inspectSourceFreeRefusedAlert, identifySourceFreeReviewAlert } = load('@/lib/auto-import');

// Synthetic equivalents of public statement grammar; all names, values,
// references and dates are fictional. No delivery, ownership or bank-coverage
// ground truth is implied by this customer-published example.
// https://www.reddit.com/r/shortcuts/comments/1nhhshl/ios_shortcuts_to_create_due_date_reminders_from/
const native = minorUnits => ({ currency: 'INR', minorUnits, exponent: 2 });
function reviewed(source, context = {}) {
  const event = inspectUniversalBankEvent(source, context);
  assert.equal(event.decision, 'review');
  assert.equal(event.family, 'statement');
  assert.equal(event.status, 'informational');
  assert.equal(event.amount.value, null);
  return event;
}
const pair = 'Cedar Bank Credit Card XX7642 statement is available. Total of INR 3,276.50 and minimum of INR 180.25 is due by 2026-11-04.';
const generated = 'Statement for your Cedar Bank Credit Card XX7642 of INR 3,276.50 has been generated. Due date: 2026-11-04. Minimum amount due is INR 180.25.';
const payment = 'Your payment of INR 432.10 towards your Credit Card ending 7642 has been received on 29/10/2026.';
const observedAt = Date.parse('2026-10-29T12:00:00Z');
function session(currency = 'INR', country = 'IN', exponent = 2) {
  markets.setActiveMarket(country === 'AE' || country === 'SA' ? country : 'ZZ');
  markets.setLedgerCurrency(currency, exponent);
  return createLaunchAlertSession({ overrides: {}, pinnedCurrency: currency,
    activeMarket: country === 'AE' || country === 'SA' ? country : 'ZZ',
    bestEffort: { enabled: true, country } });
}
function state(currency = 'INR') {
  return { hydrated: true, privateMode: true, ledgerMoney: { schemaVersion: 2, currency, exponent: 2 },
    accounts: [{ id: 'card', name: 'Credit card', kind: 'card', cardType: 'credit', last4: '7642', openingFils: 0, color: '#000' }],
    transactions: [], cardDues: [], budgets: [], bills: [], goals: [], accountHints: {},
    merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 0 };
}
function history(source, reader, id = 'a') {
  return parseHistoricalMessageRecords([JSON.stringify({ v: 1, id: id.repeat(64), text: source,
    receivedAt: new Date(observedAt).toISOString() })], {}, new Date(observedAt), new Set(), reader);
}
function applied(initial, plan) {
  let next = 0;
  return applyMaterializedImportBatch(initial,
    materializeImportBatch(plan.batch, initial, prefix => `${prefix}-${next++}`));
}
function scannedPayment(reader = session(), source = payment) {
  const parsed = reader.parseUnproven(source, '', reader.inspect(source, ''), observedAt);
  assert.equal(parsed?.kind, 'cardPayment');
  return { ...parsed, smsTs: observedAt, channel: 'inbox', sourceEventId: 'f'.repeat(64) };
}
function paymentState() {
  return { ...state(), cardDues: [
    { id: 'due-one', accountId: 'card', totalDueFils: 100000, minDueFils: 10000, paidFils: 0, dueDate: '2026-11-04' },
    { id: 'due-two', accountId: 'card', totalDueFils: 100000, minDueFils: 10000, paidFils: 0, dueDate: '2026-11-20' },
  ] };
}
function allocated(initial) {
  return initial.cardDues.reduce((total, due) => total + duePaidFils(initial, due), 0);
}
function undoReducer() {
  // Execute the actual state-changing Undo branch without React/native
  // dependencies or a shared build. The outer reducer's transfer formatting
  // is outside this contract; card payment allocation uses the returned rows.
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
  const file = path.resolve(__dirname, '../../src/lib/store.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reduceState');
  assert.ok(declaration, 'the production reducer owns best-effort Undo');
  const output = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function('tombstonesForRemoved', `${output}\nreturn reduceState;`)(undoPolicy.tombstonesForRemoved);
}

test('native total-of and minimum-of due clause retains two statement facts', () => {
  const event = reviewed(pair);
  assert.deepEqual(event.statementTotal.value, native('327650'));
  assert.deepEqual(event.minimumDue.value, native('18025'));
  for (const field of [event.statementTotal, event.minimumDue]) {
    assert.equal(field.evidence, 'explicit');
    assert.match(pair.slice(field.spans[0].start, field.spans[0].end), /^INR /);
  }
});
test('native generated-card-of amount is a statement total, not a movement', () => {
  const event = reviewed(generated);
  assert.deepEqual(event.statementTotal.value, native('327650'));
  assert.deepEqual(event.minimumDue.value, native('18025'));
});
test('Min.due retains the quoted native minimum without a schedule estimate', () => {
  const event = reviewed('Cedar Bank Credit Card XX7642 statement. Total due INR 3,276.50 Min.due INR 180.25. Due date: 2026-11-04.');
  assert.deepEqual(event.statementTotal.value, native('327650'));
  assert.deepEqual(event.minimumDue.value, native('18025'));
});
test('a cardless labelled bill preserves native fields without taking its year as card identity', () => {
  const event = reviewed('Your CedarCard bill for September 2026 is generated. Total due INR 3,276.50. Minimum due INR 180.25.');
  assert.deepEqual(event.statementTotal.value, native('327650'));
  assert.deepEqual(event.minimumDue.value, native('18025'));
  assert.equal(event.instrument.value, null);
  assert.equal(event.dueDate.value, null);
});
test('two-digit or missing deadline years remain unresolved in native Review', () => {
  for (const deadline of ['04-Nov-26', '04-Nov']) {
    const event = reviewed(pair.replace('2026-11-04', deadline));
    assert.deepEqual(event.statementTotal.value, native('327650'));
    assert.equal(event.dueDate.value, null);
  }
});
test('shared Rs symbol remains ambiguous without a routed source alias', () => {
  const event = reviewed(pair.replaceAll('INR ', 'Rs. '));
  for (const field of [event.statementTotal, event.minimumDue]) {
    assert.equal(field.evidence, 'ambiguous');
    assert.equal(field.value, null);
    assert.ok(field.alternatives.some(value => value.currency === 'INR'));
    assert.ok(field.alternatives.some(value => value.currency === 'LKR'));
  }
});
test('documented Indian routing resolves Rs without a ledger-currency guess', () => {
  const event = reviewed(pair.replaceAll('INR ', 'Rs. '), {
    market: 'IN', currencyAliases: alertMarketPack('IN').currencyAliases,
  });
  assert.deepEqual(event.statementTotal.value, native('327650'));
  assert.deepEqual(event.minimumDue.value, native('18025'));
});
test('cashback total-of and minimum-of cannot replace labelled statement figures', () => {
  const source = 'Credit Card XX7642 statement. Total of INR 52.80 cashback was earned. Minimum of INR 5.00 rewards were earned. Total due INR 3,276.50. Minimum due INR 180.25.';
  const event = reviewed(source);
  assert.deepEqual(event.statementTotal.value, native('327650'));
  assert.deepEqual(event.minimumDue.value, native('18025'));
});
test('generated statement grammar cannot promote a service fee to total debt', () => {
  const event = reviewed(generated.replace('INR 3,276.50 has', 'INR 5.00 service fee has'));
  assert.equal(event.statementTotal.value, null);
  assert.deepEqual(event.minimumDue.value, native('18025'));
});
test('generated amount with another card or a BIN-only identity remains unassigned', () => {
  for (const source of [
    'Credit Card XX4321. ' + generated,
    'Credit Card 4321********7642. ' + generated.replace('XX7642', 'XX4321'),
    generated.replace('XX7642', 'starting with 864275'),
  ]) assert.equal(reviewed(source).statementTotal.value, null);
});
test('a paired clause with conflicting native currencies cannot manufacture one debt', () => {
  const result = extractUniversalMoney(pair.replace('minimum of INR', 'minimum of USD'));
  assert.equal(result.statementTotal.value, null);
  assert.equal(result.minimumDue.value, null);
});
test('multiple explicit statement pairs remain ambiguous instead of first-total wins', () => {
  const event = reviewed(pair + ' ' + pair.replace('3,276.50', '2,145.60').replace('180.25', '105.70'));
  assert.equal(event.statementTotal.evidence, 'ambiguous');
  assert.equal(event.statementTotal.value, null);
  assert.equal(event.minimumDue.evidence, 'ambiguous');
});
test('arbitrary gift/prepaid card product names do not earn generated debt roles', () => {
  for (const product of ['GiftCard', 'PrepaidCard']) {
    assert.equal(reviewed(generated.replace('Cedar Bank Credit Card', product)).statementTotal.value, null);
  }
});
test('native statement facts cannot become spending or an automatic card settlement', () => {
  const event = reviewed(pair);
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'INR', activeMarket: 'ZZ',
    bestEffort: { enabled: true, country: 'IN' } });
  const parsed = session.parseUnproven(pair, 'UNLISTED-BANK', session.inspect(pair, 'UNLISTED-BANK'),
    Date.parse('2026-10-29T12:00:00Z'));
  assert.equal(parsed, null);
  const plan = planConfirmedUniversalImport({ hydrated: true, accounts: [], transactions: [], cardDues: [] }, event, {
    confirmed: true, postingStatus: 'posted', amount: native('327650'), direction: 'debit',
    accountId: 'fictional-card', title: 'Card statement', category: 'other', date: '2026-11-04',
    sourceKey: 'fictional_statement_source', observedAt: Date.parse('2026-10-29T12:00:00Z'),
  });
  assert.equal(plan.outcome, 'refused');
  assert.equal(plan.reason, 'unsupported-event');
});

for (const [currency, country, sender, exponent] of [
  ['USD', 'US', 'CHASE', 2], ['GBP', 'GB', 'BARCLAYS', 2],
  ['EUR', 'DE', 'SPARKASSE', 2], ['JOD', 'JO', 'ARABBANK', 3],
]) test(`${country} unverified statements reach source-free typed Review through the shared capture seam`, () => {
  const reader = session(currency, country, exponent);
  const total = exponent === 3 ? '3,276.500' : '3,276.50';
  const minimum = exponent === 3 ? '180.250' : '180.25';
  const source = `Your Credit Card XX7642 statement is available. Total due ${currency} ${total}. Minimum due ${currency} ${minimum}. Due date: 2026-11-04.`;
  const inspection = reader.inspect(source, sender);
  assert.equal(reader.parse(source, sender, inspection, undefined, observedAt), null);
  assert.equal(reader.parseUnproven(source, sender, inspection, observedAt), null);
  const refusal = inspectSourceFreeRefusedAlert({ source, sender, observedAt, channel: 'inbox',
    session: reader, existingInspection: inspection });
  assert.equal(refusal.kind, 'review');
  const item = identifySourceFreeReviewAlert(refusal.candidate,
    { id: 'statement_review_id_0001', sourceKey: 'statement_review_source_0001' });
  assert.equal(item.kind, 'universal');
  assert.equal(item.event.family, 'statement');
  assert.deepEqual(item.event.statementTotal.value,
    { currency, exponent, minorUnits: exponent === 3 ? '3276500' : '327650' });
  assert.deepEqual(item.event.minimumDue.value,
    { currency, exponent, minorUnits: exponent === 3 ? '180250' : '18025' });
  assert.equal(item.event.dueDate.value, '2026-11-04');
  assert.equal(item.event.instrument.value.last4, '7642');
  assert.equal(JSON.stringify(item).includes(source), false);
});

test('unverified History statements remain typed Review and cannot create an unmarked debt', () => {
  const result = history(pair, session());
  assert.equal(result.acceptedCount, 0);
  assert.equal(result.reviewCandidates.length, 1);
  const item = result.reviewCandidates[0];
  assert.equal(item.kind, 'universal');
  assert.equal(item.event.family, 'statement');
  assert.deepEqual(item.event.statementTotal.value, native('327650'));
  assert.deepEqual(item.event.minimumDue.value, native('18025'));
  assert.equal(item.event.dueDate.value, '2026-11-04');
  assert.equal(item.event.instrument.value.last4, '7642');
  assert.equal(item.channel, 'shortcut');
  assert.equal(item.sourceKey, `apple_message_review_source_${'a'.repeat(64)}`);
  assert.equal(JSON.stringify(result).includes(pair), false);
  const initial = state(), plan = buildImportPlan(result.parsed, initial, result.newestTs, new Date(observedAt));
  assert.equal(plan.dueCount, 0);
  assert.equal(plan.txCount, 0);
  assert.equal(plan.newAccountCount, 0);
  assert.deepEqual(plan.batch.snapshots, {});
  assert.deepEqual(applied(initial, plan).cardDues, []);
});
test('unverified History repayments retain settlement facts in Review without reducing a balance', () => {
  const result = history(payment, session());
  assert.equal(result.acceptedCount, 0);
  assert.equal(result.reviewCandidates.length, 1);
  const item = result.reviewCandidates[0];
  assert.equal(item.kind, 'universal');
  assert.equal(item.event.family, 'card-payment');
  assert.equal(item.event.status, 'posted');
  assert.deepEqual(item.event.amount.value, native('43210'));
  assert.equal(item.event.instrument.value.last4, '7642');
  assert.equal(item.event.transactionDate.value, '2026-10-29');
  assert.equal(JSON.stringify(result).includes(payment), false);
  const initial = paymentState(), plan = buildImportPlan(result.parsed, initial, result.newestTs, new Date(observedAt));
  const imported = applied(initial, plan);
  assert.equal(plan.txCount, 0);
  assert.equal(plan.newAccountCount, 0);
  assert.deepEqual(plan.batch.cardTypes, {});
  assert.equal(allocated(imported), 0);
});
for (const [country, currency] of [['AE', 'AED'], ['SA', 'SAR']]) {
  test(`${currency} verified senderless History keeps statements and repayments importable`, () => {
    const reader = session(currency, country), initial = state(currency);
    const statement = history(`Your Credit Card XX7642 statement is available. Total due ${currency} 3,276.50. Minimum due ${currency} 180.25. Due date: 04/11/2026.`, reader);
    assert.equal(statement.acceptedCount, 1);
    assert.equal(statement.parsed[0].kind, 'cardStatement');
    assert.equal(statement.parsed[0].bestEffort, undefined);
    assert.equal(statement.reviewCandidates.length, 0);
    const duePlan = buildImportPlan(statement.parsed, initial, observedAt, new Date(observedAt));
    assert.equal(duePlan.dueCount, 1);
    assert.equal(duePlan.batch.newDues[0].totalDueFils, 327650);
    const withDue = applied(initial, duePlan);
    const receipt = history(`Thank you for your payment of ${currency} 432.10 towards your Credit Card ending 7642 on 29/10/2026.`, reader, 'b');
    assert.equal(receipt.acceptedCount, 1);
    assert.equal(receipt.parsed[0].kind, 'cardPayment');
    assert.equal(receipt.parsed[0].bestEffort, undefined);
    const receiptPlan = buildImportPlan(receipt.parsed, withDue, observedAt, new Date(observedAt));
    assert.equal(receiptPlan.txCount, 1);
    assert.equal(receiptPlan.batch.transactions[0].isTransfer, true);
    assert.equal(allocated(applied(withDue, receiptPlan)), 43210);
  });
}
test('accepted best-effort card payments retain the visible marker through the real planner and ledger', () => {
  const scanned = scannedPayment(), initial = paymentState();
  const plan = buildImportPlan([scanned], initial, observedAt, new Date(observedAt));
  assert.equal(plan.txCount, 1);
  assert.deepEqual(plan.batch.transactions[0].bestEffort, scanned.bestEffort);
  assert.equal(plan.batch.transactions[0].isTransfer, true);
  assert.equal(plan.batch.transactions[0].cardPaymentSide, 'receipt');
  assert.equal(plan.batch.transactions[0].accountId, 'card');
  const imported = applied(initial, plan);
  assert.deepEqual(imported.transactions[0].bestEffort, scanned.bestEffort);
  assert.equal(allocated(imported), 43210, 'one payment is counted once across overlapping statements');
  assert.equal(buildImportPlan([scanned], imported, observedAt).txCount, 0);
});
test('actual best-effort Undo removes a settlement and prevents its exact source replay', () => {
  const scanned = scannedPayment(), initial = paymentState();
  const imported = applied(initial, buildImportPlan([scanned], initial, observedAt, new Date(observedAt)));
  const row = imported.transactions[0];
  assert.deepEqual(row.bestEffort, scanned.bestEffort);
  const undone = undoReducer()(imported, { type: 'resolveBestEffort', id: row.id, outcome: 'undo' });
  assert.equal(undone.transactions.length, 0);
  assert.ok(undone.bestEffortUndone.includes(row.smsKey));
  assert.equal(undone.bestEffortUndone.includes(`t${observedAt}:INR43210`), false);
  assert.equal(allocated(undone), 0);
  assert.equal(buildImportPlan([scanned], undone, observedAt).txCount, 0);
  assert.equal(buildImportPlan([{ ...scanned, sourceEventId: 'e'.repeat(64) }], undone, observedAt).txCount, 1);
  const distinct = { ...scanned, sourceEventId: 'd'.repeat(64), amountFils: 40000 };
  assert.equal(buildImportPlan([distinct], undone, observedAt).txCount, 1);
});

function dollarPayment(last4, id, bank = 'Chase', side = 'receipt') {
  const received = 1791806400000;
  const reader = session('USD', 'US');
  const sender = bank === 'Chase' ? 'CHASE' : 'CAPITALONE';
  const source = `${bank}: We received your payment of USD 75.00 to your credit card ending ${last4} on 2026-10-12.`;
  const parsed = reader.parseUnproven(source, sender, reader.inspect(source, sender), received);
  assert.equal(parsed?.kind, 'cardPayment');
  return { ...parsed, cardPaymentSide: side, bankHint: bank, sender, channel: 'inbox', smsTs: received,
    ...(id ? { sourceEventId: id.repeat(64) } : {}) };
}
function dollarState() {
  return { ...state('USD'), accounts: [
    { id: 'chase-one', name: 'Card one', kind: 'card', cardType: 'credit', last4: '1234', bankName: 'Chase', openingFils: 0, color: '#000' },
    { id: 'chase-two', name: 'Card two', kind: 'card', cardType: 'credit', last4: '5678', bankName: 'Chase', openingFils: 0, color: '#000' },
  ] };
}
function receiptLedger(source, currency = 'USD', country = 'US', sender = 'CHASE') {
  const when = 1791806400000, reader = session(currency, country);
  const parsed = reader.parseUnproven(source, sender, reader.inspect(source, sender), when);
  const due = { id: 'credit-due', accountId: 'chase-one', totalDueFils: 100000, minDueFils: 10000,
    paidFils: 0, dueDate: '2026-11-04' };
  const initial = { ...dollarState(), ledgerMoney: { schemaVersion: 2, currency, exponent: 2 },
    accounts: [...dollarState().accounts,
      { id: 'debit-one', name: 'Debit card', kind: 'card', cardType: 'debit', last4: '1234', bankName: 'Chase', openingFils: 0, color: '#000' }],
    cardDues: [due] };
  const scanned = parsed ? [{ ...parsed, smsTs: when, sender, channel: 'inbox', sourceEventId: 'a77' }] : [];
  const plan = buildImportPlan(scanned, initial, when, new Date(when));
  const imported = applied(initial, plan);
  return { parsed, plan, imported, paid: duePaidFils(imported, due), reader };
}
for (const kind of ['debit', 'prepaid', 'gift']) test(`a ${kind}-only tail cannot settle an unnamed credit card`, () => {
  const source = `Your ${kind} card ending 1234. Your payment of USD 75.00 towards your Credit Card has been received on 2026-10-12.`;
  const result = receiptLedger(source);
  assert.equal(result.plan.txCount, 0);
  assert.equal(result.paid, 0, 'the USD1000 credit debt must remain entirely unpaid');
  assert.equal(result.parsed, null);
  const review = inspectSourceFreeRefusedAlert({ source, sender: 'CHASE', observedAt: 1791806400000,
    channel: 'inbox', session: result.reader });
  assert.equal(review.kind, 'review');
});
test('a same-tail debit/credit collision cannot manufacture the paid credit identity', () => {
  const result = receiptLedger('Your debit card ending 1234. Your payment of USD 75.00 towards your Credit Card ending 1234 has been received on 2026-10-12.');
  assert.equal(result.parsed, null);
  assert.equal(result.plan.txCount, 0);
  assert.equal(result.paid, 0);
});
test('a credit-card tail in unrelated statement prose cannot name an unnumbered repayment target', () => {
  const result = receiptLedger('Your Credit Card ending 1234 statement is available. Your payment of USD 75.00 towards your Credit Card has been received on 2026-10-12.');
  assert.equal(result.parsed, null);
  assert.equal(result.paid, 0);
});
test('numbered paid-credit receipts and standalone credit-card headers still reduce the correct debt', () => {
  for (const source of [
    'Your payment of USD 75.00 towards your Credit Card ending 1234 has been received on 2026-10-12.',
    'Your Credit Card ending 1234. Your payment of USD 75.00 towards your Credit Card has been received on 2026-10-12.',
    'Payment of USD 75.00 has been received towards your Credit Card ending 1234 on 2026-10-12.',
    'Your payment of USD 75.00 towards your Credit Card 4567********1234 has been received on 2026-10-12.',
  ]) {
    const result = receiptLedger(source);
    assert.equal(result.parsed?.kind, 'cardPayment');
    assert.deepEqual(result.parsed.card, { last4: '1234', kind: 'credit' });
    assert.equal(result.plan.txCount, 1);
    assert.equal(result.paid, 7500);
    assert.equal(result.imported.transactions[0].accountId, 'chase-one');
  }
});
test('a rupee abbreviation stays in the paid-credit clause without lending a debit tail', () => {
  const reader = session();
  for (const unit of ['Rs.', 'Rs. ']) {
    const source = `Payment of ${unit}750.00 has been received towards your HDFC Bank Credit Card ending 7642 on 2026-10-12. Thank you.`;
    const parsed = reader.parseUnproven(source, 'VM-HDFCBK', reader.inspect(source, 'VM-HDFCBK'), 1791806400000);
    assert.equal(parsed?.kind, 'cardPayment');
    assert.equal(parsed.amountFils, 75000);
    assert.deepEqual(parsed.card, { last4: '7642', kind: 'credit' });
    const initial = paymentState();
    const plan = buildImportPlan([{ ...parsed, smsTs: 1791806400000, channel: 'inbox', sender: 'VM-HDFCBK', sourceEventId: 'a77' }], initial, 1791806400000);
    const imported = applied(initial, plan);
    assert.equal(plan.txCount, 1);
    assert.equal(allocated(imported), 75000);
    const bad = source.replace('Credit Card ending 7642', 'Credit Card').replace('Payment of', 'Your debit card ending 7642. Payment of');
    assert.equal(reader.parseUnproven(bad, 'VM-HDFCBK', reader.inspect(bad, 'VM-HDFCBK'), 1791806400000), null);
  }
});
test('a debit-funded exact template pays its named credit card, never its funding account tail', () => {
  const source = 'Bancolombia: Pagaste COP 75,00 en la tarjeta de credito *1234 desde la cuenta *5678, el 12/10/2026 12:00.';
  const result = receiptLedger(source, 'COP', 'CO', 'Bancolombia');
  assert.equal(result.parsed?.kind, 'cardPayment');
  assert.equal(result.parsed.card.last4, '1234');
  assert.equal(result.parsed.cardPaymentSide, 'debit');
  assert.equal(result.paid, 7500);
});
function removedPayment(scanned = dollarPayment('1234', 'a')) {
  const initial = dollarState();
  const imported = applied(initial, buildImportPlan([scanned], initial, scanned.smsTs, new Date(scanned.smsTs)));
  assert.equal(imported.transactions.length, 1);
  return { ...imported, transactions: [],
    bestEffortUndone: undoPolicy.tombstonesForRemoved(undefined, imported.transactions, 'USD') };
}
test('Undo of one USD75 payment never consumes a different card or exact message at the same time', () => {
  const first = dollarPayment('1234', 'a'), undone = removedPayment(first);
  assert.equal(buildImportPlan([first], undone, first.smsTs).txCount, 0);
  assert.equal(buildImportPlan([dollarPayment('5678', 'b')], undone, first.smsTs).txCount, 1);
  assert.equal(buildImportPlan([dollarPayment('1234', 'b')], undone, first.smsTs).txCount, 1);
  assert.equal(buildImportPlan([{ ...dollarPayment('5678', 'c'), amountFils: 7600 }], undone, first.smsTs).txCount, 1);
});
test('weak-source payment Undo is scoped to the persisted card, bank and settlement leg', () => {
  const first = dollarPayment('1234', 'a'), undone = removedPayment(first);
  const weak = dollarPayment('1234');
  assert.equal(buildImportPlan([weak], undone, first.smsTs).txCount, 0);
  assert.equal(buildImportPlan([dollarPayment('5678')], undone, first.smsTs).txCount, 1);
  assert.equal(buildImportPlan([dollarPayment('1234', null, 'Capital One')], undone, first.smsTs).txCount, 1);
  assert.equal(buildImportPlan([dollarPayment('1234', null, 'Chase', 'debit')], undone, first.smsTs).txCount, 1);
  assert.equal(buildImportPlan([{ ...weak, amountFils: 7600 }], undone, first.smsTs).txCount, 1);
  assert.equal(undone.bestEffortUndone.some(key => key.startsWith('p')), true);
  assert.equal(undone.bestEffortUndone.includes(`t${first.smsTs}:USD7500`), false);
});
test('legacy generic observation tombstones cannot identify a card payment', () => {
  const weak = dollarPayment('5678');
  const initial = { ...dollarState(), bestEffortUndone: [`t${weak.smsTs}:USD7500`, `s${weak.smsTs}-7500`] };
  assert.equal(buildImportPlan([weak], initial, weak.smsTs).txCount, 1);
});
test('a weak payment with missing instrument, bank or leg cannot write an unsafe generic Undo key', () => {
  const weak = dollarPayment('1234');
  const imported = applied(dollarState(), buildImportPlan([weak], dollarState(), weak.smsTs, new Date(weak.smsTs)));
  const row = imported.transactions[0];
  for (const missing of [
    { ...row, captureInstrument: undefined },
    { ...row, captureInstrument: { last4: '1234', kind: 'credit' } },
    { ...row, cardPaymentSide: undefined },
  ]) {
    const keys = undoPolicy.bestEffortUndoKeys(missing, 'USD');
    assert.deepEqual(keys, []);
    assert.equal(undoPolicy.tombstonesForRemoved(undefined, [missing], 'USD'), undefined);
  }
});

test('Android weak bank-notification repayments retain typed Review while provider SMS stays automatic', async () => {
  const captureLoad = require('./load-ts.cjs').createLoader();
  captureLoad('react-native').Platform.OS = 'android';
  const crypto = captureLoad('expo-crypto');
  crypto.CryptoDigestAlgorithm = { SHA256: 'sha256' };
  crypto.digestStringAsync = async (_algorithm, text) => require('node:crypto').createHash('sha256').update(text).digest('hex');
  captureLoad('expo-secure-store').__keychain.items.set('wafra.database.key.v1', 'a5'.repeat(32));
  const receiptTime = 1791806400000;
  const source = 'Barclays: We received your payment of GBP 75.00 to your credit card ending 1234 on 2026-10-12.';
  let smsRows = [], deliveries = [], pushes = [{ id: 'weak-card-payment-push-0001', pkg: 'com.barclays.android.barclaysmobilebanking',
    appLabel: 'Barclays', title: 'Barclays', text: source, ts: receiptTime, sourceClass: 'trusted-bank' }];
  const acks = [];
  const native = {
    SmsReader: { async getInboxSms(_since, beforeDate, beforeId) {
      return smsRows.filter(row => row.date < beforeDate || (row.date === beforeDate && row.id < beforeId));
    }, async getReceived() { return deliveries; } },
    NotificationReader: { isAvailable: () => true, isEnabled: () => true,
      async getCaptured() { return pushes; }, async ackCaptured(ids) { acks.push(...ids); return true; } },
  };
  captureLoad('expo-modules-core').requireOptionalNativeModule = name => native[name] ?? null;
  const captureMarkets = captureLoad('@/lib/markets');
  captureMarkets.setActiveMarket('ZZ'); captureMarkets.setLedgerCurrency('GBP', 2);
  captureLoad('@/lib/country').setActiveCountry('GB');
  captureLoad('@/lib/best-effort-autopost').setBestEffortAutoPostEnabled(true);
  const { scanInbox } = captureLoad('@/lib/auto-import');
  const notification = await scanInbox(0, {}, undefined, 'en-GB', { notificationOnly: true });
  assert.deepEqual(notification.parsed, []);
  assert.equal(notification.reviewCandidates.length, 1);
  const item = notification.reviewCandidates[0];
  assert.equal(item.kind, 'universal');
  assert.equal(item.event.family, 'card-payment');
  assert.equal(item.event.status, 'posted');
  assert.equal(item.event.direction, 'credit');
  assert.deepEqual(item.event.amount.value, { currency: 'GBP', minorUnits: '7500', exponent: 2 });
  assert.equal(item.event.transactionDate.value, '2026-10-12');
  assert.deepEqual(item.event.instrument.value, { kind: 'card', last4: '1234' });
  assert.equal(item.sourcePackage, 'com.barclays.android.barclaysmobilebanking');
  assert.equal(JSON.stringify(item).includes(source), false);
  assert.deepEqual(acks, [], 'the queue waits for durable Review');
  await notification.commit();
  assert.deepEqual(acks, ['weak-card-payment-push-0001']);
  pushes = []; smsRows = [{ id: 77, address: 'BARCLAYS', body: source, date: receiptTime }];
  const sms = await scanInbox(0, {}, undefined, 'en-GB');
  assert.equal(sms.parsed.length, 1);
  assert.equal(sms.parsed[0].kind, 'cardPayment');
  assert.ok(sms.parsed[0].bestEffort);
  assert.equal(sms.parsed[0].sourceEventId, 'a77');
  assert.equal(sms.reviewCandidates.length, 0);
  smsRows = []; deliveries = [{ address: 'BARCLAYS', body: source, date: receiptTime }];
  const delivery = await scanInbox(0, {}, undefined, 'en-GB');
  assert.deepEqual(delivery.parsed, []);
  assert.equal(delivery.reviewCandidates.length, 1);
  const delivered = delivery.reviewCandidates[0];
  assert.equal(delivered.kind, 'universal');
  assert.equal(delivered.channel, 'delivery');
  assert.equal(delivered.event.family, 'card-payment');
  assert.equal(delivered.event.direction, 'credit');
  assert.deepEqual(delivered.event.amount.value, { currency: 'GBP', minorUnits: '7500', exponent: 2 });
  assert.equal(delivered.event.transactionDate.value, '2026-10-12');
  assert.deepEqual(delivered.event.instrument.value, { kind: 'card', last4: '1234' });
});
