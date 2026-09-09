'use strict';
// Synthetic identifiers only. Test the shipping ledger, not a separate matcher.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../build/transfer-reconciliation');
const ledger = require('../build/ledger');
const { accountBalanceFils } = require('../build/balances');
const { cardPaymentRows, duePaidFils } = require('../build/cards');
const { summarizeCashOutflow } = require('../build/cash-flow');
const { isValidBackupState } = require('../build/backup-validation');
const { buildImportPlan } = require('../build/import-plan');
const { materializeImportBatch, applyMaterializedImportBatch } = require('../build/ledger-import');
const { createLaunchAlertSession } = require('../build/launch-alert-parser');
const { buildTransferEvidence } = require('../build/transfer-evidence');
const markets = require('../build/markets');
markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
const NOW = Date.parse('2026-09-08T12:00:00Z');
const DAY = 86400000;
const bank = (id, last4, bankName = 'FAB', extra = {}) => ({ id, name: id, kind: 'bank',
  last4, bankName, openingFils: 0, color: '#000', ...extra });
const source = bank('source', '1111');
const target = bank('target', '2222');
const credit = bank('credit', '3333', 'ADCB', { kind: 'card', cardType: 'credit' });
const accounts = [source, target, credit];
const instrument = a => ({ last4: a.last4, kind: a.kind === 'bank' ? 'account' : a.cardType,
  bankIdentity: markets.bankIdentityForName(a.bankName) });
const observation = (a, extra = {}) => ({ id: `observed-${a.id}`, accountId: a.id, type: 'expense',
  title: 'Example shop', category: 'shopping', amountFils: 7300, date: '2026-08-08', ts: NOW - 31 * DAY,
  source: 'sms', smsKey: `observed-source-${a.id}`, captureInstrument: instrument(a), ...extra });
const transfer = (extra = {}) => ({ id: 'transfer', accountId: source.id, type: 'expense',
  title: 'Outgoing transfer', category: 'other', amountFils: 81300, date: '2026-09-08', ts: NOW,
  source: 'sms', smsKey: 'transfer-source', captureInstrument: instrument(source),
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'fab',
    endpointProof: 'explicit-transfer', postingForm: 'transfer-detail', counterparty: instrument(target) }, ...extra });
const state = transactions => ({ hydrated: true, accounts, transactions, bills: [], cardDues: [],
  budgets: [], goals: [], accountHints: {}, merchantOverrides: {}, notSubscriptions: [],
  marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 }, privateMode: true,
  lastScanTs: 0, parserVersion: 38, reviewTray: { pending: [] }, historyImport: null });
const assess = (rows, ac = accounts) => core.reconcileTransfers(rows, ac);
const pending = (rows, ac = accounts) => {
  const r = assess(rows, ac);
  assert.equal(r.internalIds.has('transfer'), false);
  assert.equal(r.knownCardRepayments.has('transfer'), false);
  assert.equal(r.pendingIds.has('transfer'), true);
};
const override = (rows, ownership) => core.applyTransferDecision(rows, accounts, {
  ids: ['transfer'], ownership, now: NOW,
  expectedFingerprints: { transfer: core.transferFingerprint(rows.find(t => t.id === 'transfer')) },
});

test('other bank SMS establishes an owned destination without any matching incoming transfer', () => {
  const rows = [transfer(), observation(target)];
  const before = structuredClone(rows), r = assess(rows);
  assert.equal(r.byId.get('transfer').status, 'confirmed-own');
  assert.equal(r.byId.get('transfer').reason, 'known-account');
  assert.equal(r.byId.get('transfer').counterpartyAccountId, target.id);
  assert.equal(r.byId.get('transfer').counterpartId, undefined);
  assert.equal(r.pendingIds.size, 0);
  assert.equal(r.internalIds.has('transfer'), true);
  assert.deepEqual(core.normalizeTransferLinks(rows, accounts), before);
  assert.equal(rows[0].transferDecision, undefined, 'derived ownership is not a fictional user decision');
  assert.equal(rows[0].transferMatch, undefined, 'no fictional matching transaction');
  assert.equal(accountBalanceFils(state(rows), source.id), -81300);
  assert.equal(accountBalanceFils(state(rows), target.id), -7300, 'no invented credit on destination');
  assert.equal(summarizeCashOutflow(state(rows), '2026-09').totalFils, 0);
});

test('ownership uses the whole history in any input order, even if the identifying SMS arrives later', () => {
  const rows = [transfer(), observation(target, { ts: NOW + 30 * DAY, date: '2026-10-08' })];
  for (const input of [rows, [...rows].reverse()]) assert.equal(assess(input).internalIds.has('transfer'), true);
  const next = transfer({ id: 'next-transfer', smsKey: 'next-source', amountFils: 91700, ts: NOW + 60 * DAY });
  const r = assess([...rows, next]);
  assert.equal(r.internalIds.has('next-transfer'), true, 'ownership applies to later different-amount transfers');
});

test('Wallet metadata or a beneficiary mention alone never establishes ownership', () => {
  pending([transfer()]);
  pending([transfer(), transfer({ id: 'beneficiary-mention', smsKey: 'other-source' })]);
  pending([transfer(), observation(target, { source: 'manual', smsKey: undefined })]);
});

test('matching amounts and time with no endpoint identity remain unclassified', () => {
  const tx = transfer(); delete tx.transferEvidence.counterparty;
  pending([tx, observation(target, { type: 'income', amountFils: 81300, ts: NOW })]);
});

test('independent capture must agree with bank, kind and account routing and must not be edited or fallback', () => {
  for (const patch of [
    { userEdited: true }, { captureInstrument: undefined }, { accountId: source.id },
    { captureInstrument: { ...instrument(target), bankIdentity: 'ADCB' } },
    { captureInstrument: { ...instrument(target), last4: '9999' } },
    { captureInstrument: { ...instrument(target), kind: 'unknown' } },
    { captureInstrument: { ...instrument(target), kind: 'credit' } },
    { transferEvidence: { version: 1, currency: 'AED', attribution: 'fallback' } },
    { transferEvidence: { version: 99, currency: 'AED', attribution: 'source' } },
    { transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'ADCB' } },
    { smsKey: 'transfer-source' }, { smsKey: undefined, ts: undefined }, { amountFils: 0 },
  ]) pending([transfer(), observation(target, patch)]);
});

test('duplicate transaction IDs cannot establish account ownership', () => {
  pending([transfer(), observation(target), observation(target)]);
});

test('missing issuer, incompatible kind, short masks and wrong bank cannot resolve from a unique global tail', () => {
  for (const cp of [
    { last4: '2222', kind: 'account' }, { ...instrument(target), bankIdentity: 'ADCB' },
    { ...instrument(target), kind: 'credit' }, { ...instrument(target), last4: '22' },
    { ...instrument(target), last4: '22XX22' }, { ...instrument(target), last4: '9999' },
  ]) {
    const tx = transfer(); tx.transferEvidence.counterparty = cp;
    pending([tx, observation(target)]);
  }
});

test('source contradictions, fallback, missing endpoint proof, and edited transfers cannot auto-classify', () => {
  for (const mutate of [
    t => { t.userEdited = true; }, t => { t.transferEvidence.attribution = 'fallback'; },
    t => { t.transferEvidence.sourceBank = 'ADCB'; }, t => { delete t.transferEvidence.endpointProof; },
    t => { t.captureInstrument.bankIdentity = 'ADCB'; }, t => { t.captureInstrument.last4 = '9999'; },
    t => { t.accountId = target.id; },
  ]) { const tx = transfer(); mutate(tx); pending([tx, observation(target)]); }
});

test('duplicate bank identities and unknown-kind collisions stay unresolved, including unused accounts', () => {
  for (const duplicate of [
    { ...target, id: 'duplicate' }, { ...target },
    { ...target, id: 'unknown-card', kind: 'card', cardType: undefined },
  ]) pending([transfer(), observation(target)], [...accounts, duplicate]);
  const unknown = transfer(); unknown.transferEvidence.counterparty.kind = 'unknown';
  pending([unknown, observation(target)], [...accounts, { ...target, id: 'debit', kind: 'card', cardType: 'debit' }]);
});

test('explicit typed identity distinguishes bank and card endpoints and bank aliases remain usable', () => {
  const aliased = transfer(); aliased.transferEvidence.counterparty.bankIdentity = 'First Abu Dhabi Bank';
  assert.equal(assess([aliased, observation(target)]).internalIds.has('transfer'), true);
  assert.equal(assess([transfer(), observation(target)], [...accounts,
    { ...target, id: 'debit', kind: 'card', cardType: 'debit' }]).internalIds.has('transfer'), true);
  assert.equal(assess([transfer(), observation(target)], accounts.map(a => ({ ...a, archived: true }))).internalIds.has('transfer'), true);
});

test('incoming transfer from an independently known own bank account needs no outgoing receipt', () => {
  const tx = transfer({ type: 'income', title: 'Incoming transfer' });
  tx.transferEvidence.postingForm = 'credit-receipt';
  const r = assess([tx, observation(target)]);
  assert.equal(r.internalIds.has(tx.id), true); assert.equal(r.pendingIds.size, 0);
});

test('external user decision wins, survives restore, and undo recomputes rather than persisting a guess', () => {
  const rows = [transfer(), observation(target)];
  const external = override(rows, 'external');
  const decoded = JSON.parse(JSON.stringify(state(external)));
  assert.equal(isValidBackupState(decoded), true);
  assert.equal(assess(decoded.transactions).internalIds.has('transfer'), false);
  assert.equal(assess(decoded.transactions).byId.get('transfer').status, 'confirmed-external');
  assert.equal(ledger.isSpending(decoded.transactions[0]), true);
  const undone = override(decoded.transactions, null);
  assert.equal(assess(undone).internalIds.has('transfer'), true);
  assert.equal(undone[0].transferDecision, undefined);
});

test('literal third-party wording overrides account resemblance', () => {
  const tx = transfer(); tx.transferEvidence.explicitExternal = true;
  const r = assess([tx, observation(target)]);
  assert.equal(r.internalIds.has('transfer'), false);
  assert.equal(r.byId.get('transfer').status, 'confirmed-external');
});

test('deleting or correcting the independent observation immediately invalidates learned ownership', () => {
  const rows = core.normalizeTransferLinks([transfer(), observation(target)], accounts);
  assert.equal(assess(rows).internalIds.has('transfer'), true);
  pending(rows.filter(t => t.id === 'transfer'));
  pending(rows.map(t => t.id === 'transfer' ? t : { ...t, userEdited: true }));
  pending(rows, accounts.map(a => a.id === target.id ? { ...a, last4: '9999' } : a));
});

test('known credit-card destination is a repayment without inventing a receipt or settling a statement', () => {
  const tx = transfer(); tx.transferEvidence.counterparty = instrument(credit);
  const s = state([tx, observation(credit)]), r = assess(s.transactions);
  assert.equal(r.byId.get('transfer').status, 'card-repayment');
  assert.equal(r.byId.get('transfer').reason, 'known-card');
  assert.equal(r.knownCardRepayments.get('transfer'), credit.id);
  assert.equal(r.cardRepaymentPairs.size, 0); assert.equal(r.pendingIds.size, 0);
  assert.equal(r.internalIds.has('transfer'), false, 'repayment is cash out, not a move between bank balances');
  assert.deepEqual(cardPaymentRows(s).map(t => t.id), ['transfer']);
  const cash = summarizeCashOutflow(s, '2026-09');
  assert.equal(cash.totalFils, 81300); assert.equal(cash.cardPaymentsFils, 81300); assert.equal(cash.accountOutflowFils, 0);
  assert.equal(accountBalanceFils(s, credit.id), -7300, 'no imaginary card credit');
  const due = { id: 'due', accountId: credit.id, totalDueFils: 81300, minDueFils: 1000, paidFils: 0, dueDate: '2026-09-10' };
  assert.equal(duePaidFils({ ...s, cardDues: [due] }, due), 0, 'receipt or explicit user payment is still required to settle');
  const external = { ...s, transactions: override(s.transactions, 'external') };
  assert.equal(cardPaymentRows(external).length, 0);
  assert.equal(summarizeCashOutflow(external, '2026-09').accountOutflowFils, 81300);
});

test('a later card receipt replaces the cash-out debit once and preserves the original posting dates', () => {
  const tx = transfer(); tx.transferEvidence.counterparty = instrument(credit);
  const receipt = observation(credit, { id: 'receipt', smsKey: 'receipt-source', type: 'income', title: 'Card payment',
    category: 'other', cardPaymentSide: 'receipt', isTransfer: true, amountFils: 81300, date: '2026-09-09', ts: NOW + DAY });
  const s = state([tx, observation(credit), receipt]), r = assess(s.transactions);
  assert.equal(r.cardRepaymentPairs.get('transfer'), 'receipt');
  const payments = cardPaymentRows(s);
  assert.deepEqual(payments.map(t => t.id), ['receipt']);
  assert.equal(payments[0].cashOutDate, '2026-09-08');
  assert.equal(payments[0].cashOutAccountId, source.id);
  assert.equal(summarizeCashOutflow(s, '2026-09').totalFils, 81300);
});

test('an incoming transfer from a known credit card is not misclassified as a repayment', () => {
  const tx = transfer({ type: 'income', title: 'Incoming transfer' });
  tx.transferEvidence.counterparty = instrument(credit);
  pending([tx, observation(credit)]);
});

test('a beneficiary card named only by an outgoing payment is not learned as owned', () => {
  for (const patch of [{ cardPaymentSide: 'debit' }, { isTransfer: true },
    { cardPaymentSide: 'receipt', type: 'expense' }]) {
    const tx = transfer(); tx.transferEvidence.counterparty = instrument(credit);
    pending([tx, observation(credit, patch)]);
  }
});

test('salary, business, refunds, cashback and purchase semantics remain outside ownership inference', () => {
  for (const patch of [{ category: 'salary', title: 'Salary' }, { category: 'business', title: 'Business payout' },
    { title: 'Cashback credit' }, { title: 'Purchase refund' }, { paymentFlowSide: 'funding' }]) {
    const tx = transfer(patch); assert.equal(assess([tx, observation(target)]).byId.has(tx.id), false);
  }
});

test('real import and compact iOS evidence both learn account ownership and remain idempotent', () => {
  const parser = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' });
  const messages = [
    'Dear Customer, your funds transfer request of AED 813.00 from account XXXX1111 to account XXXX2222 has been processed on 08/09/2026 16:00.',
    'An amount of AED 927.00 has been credited to your FAB account XXXX2222 on 08/08/2026. Your balance is AED 9813.00',
  ];
  const parsed = messages.map((body, i) => ({ ...parser.parse(body, 'FAB'), raw: body, sender: 'FAB',
    smsTs: NOW - i * 31 * DAY, channel: 'inbox', sourceEventId: `known-own-${i}` }));
  assert.ok(parsed.every(p => p.kind === 'transaction'));
  const compact = parsed.map(p => { const { raw, sender, ...rest } = p;
    return { ...rest, bankHint: 'FAB', transferEvidence: buildTransferEvidence(p, true) }; });
  for (const input of [parsed, compact]) {
    let seq = 0;
    const apply = s => applyMaterializedImportBatch(s, materializeImportBatch(
      buildImportPlan(input, s, NOW, new Date(NOW)).batch, s, prefix => `${prefix}-${seq++}`));
    const first = apply({ ...state([]), accounts: [] });
    const outgoing = first.transactions.find(t => t.type === 'expense');
    const r = assess(first.transactions, first.accounts);
    assert.equal(r.byId.get(outgoing.id).reason, 'known-account');
    assert.equal(outgoing.transferMatch, undefined);
    assert.equal(outgoing.raw, undefined);
    assert.equal(isValidBackupState(first), true);
    assert.deepEqual(apply(first), first);
    assert.equal(assess(JSON.parse(JSON.stringify(first.transactions)), first.accounts).internalIds.has(outgoing.id), true);
  }
});

test('parser version rechecks histories scanned before cross-message ownership inference', () => {
  assert.ok(require('../build/sms-parser').PARSER_VERSION > 38);
});

test('12,000 transfers reuse independently observed ownership without quadratic history scans', () => {
  const rows = [observation(target), ...Array.from({ length: 12000 }, (_, i) => transfer({
    id: `transfer-${i}`, smsKey: `source-${i}`, amountFils: 10000 + i,
  }))];
  const start = performance.now(), r = assess(rows);
  assert.equal(r.internalIds.size, 12000); assert.equal(r.pendingIds.size, 0);
  assert.ok(performance.now() - start < 5000);
});
