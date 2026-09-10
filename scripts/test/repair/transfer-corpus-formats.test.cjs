'use strict';
// Synthetic values preserve observed bank grammar; no private SMS is committed.
const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../build/launch-alert-parser');
const { buildImportPlan } = require('../build/import-plan');
const { materializeImportBatch, applyMaterializedImportBatch } = require('../build/ledger-import');
const core = require('../build/transfer-reconciliation');
const ledger = require('../build/ledger');
const { accountBalanceFils } = require('../build/balances');
const { cardPaymentRows } = require('../build/cards');
const { summarizeCashOutflow } = require('../build/cash-flow');
const markets = require('../build/markets');
const NOW = Date.parse('2026-09-08T12:00:00Z');
const bank = (id, last4, bankName, extra = {}) => ({ id, name: `${bankName} Account`, last4, bankName,
  kind: 'bank', color: '#000', openingFils: 0, ...extra });
const accounts = [bank('unrelated-card', '6666', 'Emirates NBD', { kind: 'card', cardType: 'credit' }),
  bank('fab-source', '1111', 'FAB'), bank('fab-destination', '2222', 'FAB'),
  bank('adcb-card', '3333', 'ADCB', { kind: 'card', cardType: 'credit' })];
const base = () => ({ hydrated: true, privateMode: true, marketId: 'AE',
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 }, accounts: structuredClone(accounts),
  transactions: [], budgets: [], cardDues: [], goals: [], bills: [], accountHints: {},
  merchantOverrides: {}, notSubscriptions: [], parserVersion: 0, lastScanTs: 0 });
function parse(messages) {
  markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
  const session = parser.createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' });
  return messages.map(([sender, body, offset = 0], i) => {
    const p = session.parse(body, sender, session.inspect(body, sender));
    assert.ok(p, `synthetic grammar ${i} must be parsed`);
    return { ...p, sender, smsTs: NOW + offset, date: p.date ?? '2026-09-08', channel: 'inbox', sourceEventId: `a${900000 + i}` };
  });
}
let seq = 0;
const apply = (state, parsed) => applyMaterializedImportBatch(state,
  materializeImportBatch(buildImportPlan(parsed, state, NOW + 86_400_000, new Date(NOW)).batch, state, prefix => `${prefix}-${++seq}`));
const detail = (amount = '713.00', target = '3333') => `Dear Customer, your funds transfer request of AED ${amount} to IBAN/Account/Card XXXX${target} has been processed successfully from your account/card XXXX1111 on 08/09/2026 16:00`;
const summary = (amount = '713.00') => `Outward Remittance\nDebit\nAccount XXXX1111\nAED ${amount}\nDate 08/09/2026\nBalance AED 9021.00`;
const credited = (amount = '813.00', target = '2222') => `An amount of AED ${amount} has been credited to your FAB account XXXX${target} on 08/09/2026. Your balance is AED 9813.00`;
const ownDetail = 'Dear Customer, your funds transfer request of AED 813.00 from account XXXX1111 to account XXXX2222 has been processed on 08/09/2026 16:00. For more information please call 600525500.';

test('the transfer evidence upgrade invalidates already scanned version-37 histories', () => {
  assert.ok(require('../build/sms-parser').PARSER_VERSION > 37);
});

test('a first scan preserves a cardless money event before it has discovered any accounts', () => {
  const state = { ...base(), accounts: [] };
  const fee = { kind: 'transaction', type: 'expense', merchant: 'Bank fee', amountFils: 1375,
    currency: 'AED', categoryGuess: 'other', categoryDeliberate: true, transferHint: false, card: null,
    date: '2026-09-08', smsTs: NOW, sender: 'FAB', channel: 'inbox', sourceEventId: 'a900555',
    snapshotFils: 8900, snapshotKind: 'balance', raw: 'Your account was debited AED 13.75 as service charge. Balance AED 89.00.' };
  const plan = buildImportPlan([fee], state, NOW);
  assert.equal(plan.txCount, 1, 'never advance the watermark after dropping parsed money');
  assert.equal(plan.newAccountCount, 0, 'unidentified is not a fictional bank account');
  assert.deepEqual(plan.batch.snapshots, {}, 'unidentified alerts never assert a bank balance');
  const first = apply(state, [fee]);
  assert.equal(first.transactions[0].accountId, ledger.UNASSIGNED_TRANSACTION_ACCOUNT_ID);
  assert.equal(ledger.isSpending(first.transactions[0], ledger.liveAccountIds(first.accounts)), true);
  assert.equal(summarizeCashOutflow(first, { mode: 'all' }).totalFils, 0, 'funding source is still unknown');
  const withAccount = { ...first, accounts: structuredClone(accounts) };
  assert.deepEqual(apply(withAccount, [fee]).transactions, first.transactions,
    'finding a later unrelated card cannot make the same event duplicate or change its attribution');
});

test('discovering two banks with the same account tail never emits a competing global hint', () => {
  const parsed = parse([['FAB', credited()], ['Liv',
    'AED 927.00 has been credited to account XXXX2222. Current balance is AED 1559.70.', 300000]]);
  const empty = { ...base(), accounts: [] };
  const first = apply(empty, parsed);
  assert.equal(first.accounts.length, 2);
  assert.equal(first.accountHints['2222'], undefined);
  assert.ok(Object.keys(first.accountHints).some(key => key.includes('FAB')));
  assert.ok(Object.keys(first.accountHints).some(key => key.includes('Liv')));
  assert.deepEqual(apply(first, parsed), first, 'the complete persisted state is repeatable');
});

test('one explicit FAB destination and independently observed receiving account link automatically', () => {
  const state = apply(base(), parse([['FAB', ownDetail], ['FAB', credited(), 240000]]));
  const result = core.reconcileTransfers(state.transactions, state.accounts);
  assert.equal(result.internalIds.size, 2);
  assert.equal(result.pendingIds.size, 0);
  assert.equal(state.transactions.every(t => t.transferMatch?.basis === 'destination-and-receipt'), true);
  assert.equal(accountBalanceFils(state, 'fab-source'), -81300);
  assert.equal(accountBalanceFils(state, 'fab-destination'), 81300);
  assert.equal(summarizeCashOutflow(state, { mode: 'all' }).totalFils, 0);
});

test('a bank debit, its remittance confirmation and the other bank card receipt are one repayment', () => {
  const parsed = parse([['FAB', detail()], ['FAB', summary(), 20000],
    ['ADCBAlert', 'Your payment of AED 713 against Credit Card no. XXX3333 was received at 04:00 PM on 08/09/2026. Thank you.', 7000]]);
  const state = apply(base(), parsed);
  const result = core.reconcileTransfers(state.transactions, state.accounts);
  assert.equal(state.transactions.length, 3, 'all source observations remain saved');
  assert.equal(result.corroboratingIds.size, 1);
  assert.equal(result.cardRepaymentPairs.size, 1);
  assert.equal(result.pendingIds.size, 0);
  assert.equal(accountBalanceFils(state, 'fab-source'), -71300, 'source posting once');
  assert.equal(accountBalanceFils(state, 'adcb-card'), 71300, 'receipt on actual card once');
  assert.equal(cardPaymentRows(state).length, 1);
  assert.equal(cardPaymentRows(state)[0].cashOutAccountId, 'fab-source');
  const out = summarizeCashOutflow(state, { mode: 'all' });
  assert.equal(out.cardPaymentsFils, 71300); assert.equal(out.totalFils, 71300);
  const exclusions = ledger.internalTransferIds(state.transactions, state.accounts);
  assert.equal(state.transactions.filter(t => ledger.countsInTotals(t, undefined, exclusions)).length, 0);
  const again = apply(state, parsed);
  assert.deepEqual(again.transactions, state.transactions, 'reread is idempotent');
});

test('iOS source-free capture preserves account/card source routing and repayment evidence', () => {
  const { buildTransferEvidence } = require('../build/transfer-evidence');
  const parsed = parse([['FAB', detail()], ['FAB', summary(), 20000],
    ['ADCBAlert', 'Your payment of AED 713 against Credit Card no. XXX3333 was received at 04:00 PM on 08/09/2026. Thank you.', 7000]]);
  const compact = parsed.map(p => {
    const { raw, sender, ...kept } = p;
    return { ...kept, bankHint: markets.bankFromSender(sender).name,
      transferEvidence: buildTransferEvidence(p, true) };
  });
  assert.equal(compact[0].transferEvidence.sourceKindAmbiguous, true);
  assert.equal(Object.hasOwn(compact[0], 'raw'), false);
  const state = apply(base(), compact);
  const result = core.reconcileTransfers(state.transactions, state.accounts);
  assert.equal(state.accounts.length, base().accounts.length, 'no phantom source credit card');
  assert.equal(result.cardRepaymentPairs.size, 1);
  assert.equal(result.corroboratingIds.size, 1);
  assert.equal(result.pendingIds.size, 0);
  assert.equal(summarizeCashOutflow(state, { mode: 'all' }).totalFils, 71300);
  assert.deepEqual(apply(state, compact), state);
});

test('Liv partly masked accounts never borrow the unrelated first credit card or fabricate four digits', () => {
  const messages = [['Liv', 'AED 813.00 has been deducted from your account 095-XXX11XXX-01 for issuance of Telegraphic Transfer.'],
    ['FAB', credited(), 15000]];
  const state = apply(base(), parse(messages));
  const liv = state.transactions.find(t => t.type === 'expense');
  assert.ok(core.isUnassignedTransferAccount(liv.accountId));
  assert.equal(liv.captureInstrument, undefined);
  assert.equal(liv.transferEvidence.sourceBank, 'liv');
  assert.match(liv.transferEvidence.sourceAccountKey, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(liv).includes('095-XXX'), false);
  assert.equal(state.accounts.length, 4, 'a holding reference creates no fictional account');
  const result = core.reconcileTransfers(state.transactions, state.accounts);
  assert.equal(result.internalIds.size, 2, 'two independently owned account observations may reconcile without fabricating an account');
  assert.equal(result.byId.get(liv.id).status, 'confirmed-own');
  assert.equal(result.byId.get(liv.id).reason, 'amount-time');
});

test('an existing fallback transfer is repaired through exact source identity without changing money or user edits', () => {
  const parsed = parse([['Liv', 'AED 813.00 has been deducted from your account 095XXX11XXX01 for issuance of Telegraphic Transfer.']]);
  const old = { id: 'old', accountId: 'unrelated-card', type: 'expense', amountFils: 81300,
    date: '2026-09-08', ts: NOW, smsKey: `ha900000t${NOW}`, source: 'sms', category: 'other', title: 'Telegraphic transfer', isTransfer: true };
  const state = apply({ ...base(), transactions: [old] }, parsed);
  assert.equal(state.transactions.length, 1); assert.equal(state.transactions[0].id, 'old');
  assert.equal(state.transactions[0].amountFils, 81300);
  assert.ok(core.isUnassignedTransferAccount(state.transactions[0].accountId));
  const user = { ...old, userEdited: true };
  assert.deepEqual(apply({ ...base(), transactions: [user] }, parsed).transactions, [user]);
});

test('named Wio recipients remain distinct and a name is not treated as proof of self ownership', () => {
  const state = apply(base(), parse([['WIO', 'Your local transfer of AED 813.00 to Example Person from your account number 90XXXX7777 was processed. Available balance is AED 91.00.'],
    ['FAB', credited(), 240000], ['WIO', 'Your local transfer of AED 919.00 to Other Person from your account number 90XXXX7777 was processed. Available balance is AED 91.00.', 400000]]));
  const result = core.reconcileTransfers(state.transactions, state.accounts);
  assert.equal(result.internalIds.size, 0);
  const named = state.transactions.filter(t => t.transferEvidence?.counterpartyName);
  assert.deepEqual(named.map(t => t.transferEvidence.counterpartyName).sort(), ['Example Person', 'Other Person']);
  assert.equal(result.byId.get(named.find(t => t.amountFils === 81300).id).status, 'likely-own');
  assert.equal(result.byId.get(named.find(t => t.amountFils === 91900).id).status, 'ownership-unknown');
});

test('duplicate amounts, conflicting destinations, different currencies and edited rows cannot auto-link', () => {
  const parsed = parse([['FAB', ownDetail], ['FAB', credited(), 2000], ['FAB', credited(), 120000]]);
  const duplicate = apply(base(), parsed);
  const duplicatedResult = core.reconcileTransfers(duplicate.transactions, duplicate.accounts);
  assert.equal(duplicatedResult.internalIds.size, 1, 'explicit destination ownership is independent of ambiguous receipt pairing');
  assert.equal(duplicatedResult.pendingIds.size, 2, 'neither competing incoming credit is silently linked');
  assert.ok([...duplicatedResult.byId.values()].every(a => !a.counterpartId));
  assert.ok(duplicate.transactions.every(t => !t.transferMatch));
  const valid = apply(base(), parsed.slice(0, 2));
  for (const mutate of [
    t => t.type === 'expense' ? { ...t, userEdited: true } : t,
    t => t.type === 'expense' ? { ...t, transferEvidence: { ...t.transferEvidence, counterparty: { last4: '9999', kind: 'account', bankIdentity: 'fab' } } } : t,
    t => t.type === 'expense' ? { ...t, originalCurrency: 'USD', originalAmountMinor: 81300, transferEvidence: { ...t.transferEvidence, currency: 'USD' } } : t,
  ]) {
    const rows = valid.transactions.map(t => { const { transferMatch, ...row } = t; return mutate(row); });
    const result = core.reconcileTransfers(rows, valid.accounts);
    assert.ok([...result.byId.values()].every(a => !a.counterpartId), 'contradictory money or identities cannot be paired');
    const outgoing = rows.find(t => t.type === 'expense');
    assert.equal(result.internalIds.has(outgoing.id), outgoing.originalCurrency === 'USD',
      'FX changes do not erase known account ownership; edited or contradictory endpoints remain unresolved');
  }
});

test('same-amount card purchases are never repayments; external user classification wins', () => {
  const parsed = parse([['FAB', detail()], ['FAB', summary(), 20000],
    ['ADCBAlert', 'Credit Card XX3333 was used for AED713.00 on 08/09/2026 16:00:00 at EXAMPLE SHOP, Dubai-AE. Available limit AED 3000.00', 5000]]);
  const state = apply(base(), parsed);
  const result = core.reconcileTransfers(state.transactions, state.accounts);
  assert.equal(result.cardRepaymentPairs.size, 0);
  const primary = state.transactions.find(t => t.transferEvidence?.postingForm === 'transfer-detail');
  const external = core.applyTransferDecision(state.transactions, state.accounts, { ids: [primary.id], ownership: 'external', now: NOW,
    expectedFingerprints: { [primary.id]: core.transferFingerprint(primary) } });
  assert.equal(core.transferOwnership(external.find(t => t.id === primary.id)), 'external');
  assert.equal(core.reconcileTransfers(external, state.accounts).internalIds.has(primary.id), false);
  const after = { ...state, transactions: external };
  assert.equal(core.reconcileTransfers(external, state.accounts).corroboratingIds.size, 1);
  assert.equal(summarizeCashOutflow(after, { mode: 'all' }).accountOutflowFils, 71300,
    'an external classification must not reactivate its duplicate bank confirmation');
});
