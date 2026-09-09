#!/usr/bin/env node
'use strict';
// Read-only replay of an owner-supplied personal export through shipping code.
// Never runs against application storage. Private debugging output is opt-in;
// the printed report contains aggregates and assertions, not message bodies.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const root = path.resolve(__dirname, '..');
const build = name => require(path.join(root, 'scripts/test/build', name));
const { createLaunchAlertSession } = build('launch-alert-parser');
const { nonPostingReason, PARSER_VERSION } = build('sms-parser');
const { buildImportPlan } = build('import-plan');
const { materializeImportBatch, applyMaterializedImportBatch } = build('ledger-import');
const { setActiveMarket, setLedgerCurrency } = build('markets');
const { setMonthStartDay, toISODate } = build('format');
const { isValidBackupState } = build('backup-validation');
const core = build('transfer-reconciliation');
const ledger = build('ledger');
const { cardPaymentRows, mergeImportedCardDues } = build('cards');
const { summarizeCashOutflow } = build('cash-flow');
const { mergeDuplicateAccounts, removeDeclinedTransactions, repairCardPaymentAccounts, repairDuplicateStatements } = build('accounts');
const { migratePersistedState, finalizeHydrationTransactions } = require('./lib/load-ledger-hydration')(root);
const [input, output, privateDir] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/audit-transfer-corpus.cjs <personal-review.json> <report.json> [private-debug-directory]');
  process.exit(2);
}
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const bytes = fs.readFileSync(input), corpus = JSON.parse(bytes);
if (corpus.schema !== 'wafra-personal-review-v1' || corpus.sms?.scope !== 'all-received' ||
    !Array.isArray(corpus.sms.messages) || corpus.backup?.app !== 'wafra' || !isValidBackupState(corpus.backup.data)) {
  throw new Error('Unsupported or invalid personal export');
}
const original = corpus.backup.data, messages = corpus.sms.messages;
const market = original.marketId || 'AE', money = original.ledgerMoney;
setActiveMarket(market); setLedgerCurrency(money.currency, money.exponent); setMonthStartDay(original.monthStartDay || 1);
const restore = value => {
  const migrated = { ...migratePersistedState(structuredClone(value)), hydrated: true };
  const repaired = removeDeclinedTransactions(repairDuplicateStatements(repairCardPaymentAccounts(mergeDuplicateAccounts(migrated))));
  return { ...repaired, transactions: core.normalizeTransferLinks(finalizeHydrationTransactions(repaired.transactions, migrated.transactions), repaired.accounts),
    cardDues: mergeImportedCardDues([], repaired.cardDues, repaired.accounts) };
};
const state = restore(original), now = new Date(corpus.exportedAt);
let sequence = 0;
const tally = (items, key) => items.reduce((out, x) => { const k = key(x); out[k] = (out[k] || 0) + 1; return out; }, {});
const atMessage = new Map(), atTransaction = new Map();
for (const message of messages) atMessage.set(message.receivedAtMs, [...atMessage.get(message.receivedAtMs) || [], message]);
for (const tx of original.transactions) atTransaction.set(tx.ts, [...atTransaction.get(tx.ts) || [], tx]);
let recoveredProviderIds = 0, syntheticAuditIds = 0;
const sourceId = (message, index) => {
  const rows = atTransaction.get(message.receivedAtMs) || [];
  const match = rows.length === 1 && atMessage.get(message.receivedAtMs).length === 1
    ? /^h(a\d+)t(\d+)$/.exec(rows[0].smsKey || '') : null;
  // Restore an identifier only when the supplied ledger retained it at this
  // unique source clock. New observations use explicitly audit-only identities.
  if (match && Number(match[2]) === message.receivedAtMs) { recoveredProviderIds++; return match[1]; }
  syntheticAuditIds++;
  return `audit-${index}-${hash(`${message.sender}\0${message.receivedAtMs}\0${message.body}`).slice(0, 16)}`;
};
const session = createLaunchAlertSession({ overrides: state.merchantOverrides, pinnedCurrency: money.currency, activeMarket: market });
const parsed = [], declined = [], failures = [], checks = [];
const check = (name, valid, details) => { checks.push({ name, passed: Boolean(valid), ...(details === undefined ? {} : { details }) }); if (!valid) failures.push(name); };
let rejected = 0, newestTs = 0;
const parseStart = performance.now();
for (const [index, message] of messages.entries()) {
  if (typeof message.body !== 'string' || typeof message.sender !== 'string' || !Number.isSafeInteger(message.receivedAtMs)) {
    throw new Error(`Invalid input message at index ${index}`);
  }
  const smsTs = message.receivedAtMs, id = sourceId(message, index);
  newestTs = Math.max(newestTs, smsTs);
  const inspection = session.inspect(message.body, message.sender);
  const result = session.parse(message.body, message.sender, inspection);
  if (result) parsed.push({ ...result, raw: message.body, sender: message.sender, smsTs,
    date: result.date ?? toISODate(new Date(smsTs)), channel: 'inbox', sourceEventId: id });
  else {
    const reason = nonPostingReason(message.body);
    if (reason) declined.push({ smsTs, sender: message.sender, channel: 'inbox', reason, sourceEventId: id });
    else rejected++;
  }
}
const parseMs = Math.round(performance.now() - parseStart);
console.error(JSON.stringify({ stage: 'parsed', messages: messages.length, parsed: parsed.length, nonPosting: declined.length, refused: rejected, parseMs }));
const stats = [];
function replay(before, label, data = parsed) {
  const start = performance.now();
  const plan = buildImportPlan(data, before, newestTs, now, declined);
  plan.batch.parserRereadComplete = true;
  const batch = materializeImportBatch(plan.batch, before, prefix => `audit-${prefix}-${++sequence}`);
  const after = applyMaterializedImportBatch(before, batch);
  const stat = { label, parsed: data.length, added: batch.transactions.length, updates: batch.updates.length,
    addedAccounts: batch.newAccounts.length, transactions: after.transactions.length, accounts: after.accounts.length,
    addedRoles: tally(batch.transactions, t => [t.type, t.category, t.captureInstrument?.kind || 'unidentified', t.cardPaymentSide || t.paymentFlowSide || 'ordinary'].join(':')),
    ms: Math.round(performance.now() - start) };
  stats.push(stat); console.error(JSON.stringify({ stage: 'replayed', ...stat }));
  return { state: after, batch };
}
const first = replay(state, 'existing-ledger-upgrade');
const second = replay(first.state, 'same-messages-again');
const restored = restore(JSON.parse(JSON.stringify(second.state)));
const third = replay(restored, 'after-json-restore');
const fourth = replay(third.state, 'after-restore-again');
function changedFields(a, b) {
  const before = new Map(a.transactions.map(t => [t.id, t])), fields = {};
  for (const t of b.transactions) { const p = before.get(t.id); if (!p) continue;
    for (const k of new Set([...Object.keys(t), ...Object.keys(p)])) if (!isDeepStrictEqual(p[k], t[k])) fields[k] = (fields[k] || 0) + 1;
  }
  const stateFields = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (isDeepStrictEqual(a[key], b[key])) continue;
    const old = a[key], current = b[key];
    if (Array.isArray(old) && Array.isArray(current)) {
      const byId = new Map(old.filter(x => x && typeof x === 'object' && x.id).map(x => [x.id, x]));
      const changes = {};
      for (const item of current) {
        const previous = byId.get(item?.id);
        if (!previous) continue;
        for (const field of new Set([...Object.keys(previous), ...Object.keys(item)]))
          if (!isDeepStrictEqual(previous[field], item[field])) changes[field] = (changes[field] || 0) + 1;
      }
      stateFields[key] = { beforeCount: old.length, afterCount: current.length, fields: changes };
    } else if (old && current && typeof old === 'object' && typeof current === 'object') {
      stateFields[key] = { changedKeys: [...new Set([...Object.keys(old), ...Object.keys(current)])]
        .filter(field => !isDeepStrictEqual(old[field], current[field])).length };
    } else stateFields[key] = { beforeType: typeof old, afterType: typeof current };
  }
  return { transactionFields: fields, stateFields };
}
// A funding observation may be proposed and then absorbed into its existing
// bill receipt by the shipping reducer. Verify durable rows, not batch intents.
check('second-import-adds-no-durable-transactions', second.state.transactions.length === first.state.transactions.length);
check('second-import-is-identical', isDeepStrictEqual(second.state, first.state), changedFields(first.state, second.state));
check('restore-import-adds-no-durable-transactions', third.state.transactions.length === restored.transactions.length);
check('restore-repeat-is-identical', isDeepStrictEqual(fourth.state, third.state), changedFields(third.state, fourth.state));
check('money-spec-preserved', isDeepStrictEqual(first.state.ledgerMoney, original.ledgerMoney));
check('backup-valid-after-repair', isValidBackupState(first.state));
const originalById = new Map(original.transactions.map(t => [t.id, t]));
const afterById = new Map(first.state.transactions.map(t => [t.id, t]));
const moneyChanges = first.state.transactions.filter(t => originalById.has(t.id) && originalById.get(t.id).amountFils !== t.amountFils).length;
const decisionsDrift = original.transactions.filter(t => t.transferDecision && !isDeepStrictEqual(t.transferDecision, afterById.get(t.id)?.transferDecision)).length;
check('existing-amounts-not-rewritten', moneyChanges === 0, moneyChanges);
check('saved-ownership-decisions-preserved', decisionsDrift === 0, decisionsDrift);
const protectedFields = ['title','category','type','amountFils','date','note','accountId','isTransfer','cardPaymentSide','paymentFlowSide','splits','transferDecision'];
const drift = (before, after) => {
  const byId = new Map(after.transactions.map(t => [t.id,t]));
  return before.transactions.filter(t => t.userEdited && (!byId.has(t.id) || protectedFields.some(k => !isDeepStrictEqual(t[k],byId.get(t.id)[k])))).length;
};
check('actual-user-edits-preserved', drift(original, first.state) === 0);
// The supplied snapshot may contain zero manual edits. Exercise protection
// explicitly on cloned real rows without claiming the owner made these edits.
const protectedState = structuredClone(first.state);
const probeIds = new Set(protectedState.transactions.filter(t => t.transferEvidence).slice(0, 12).map(t => t.id));
protectedState.transactions = protectedState.transactions.map(t => probeIds.has(t.id)
  ? { ...t, userEdited: true, title: 'Audit-only user correction', note: 'Synthetic edit protection probe', amountFils: t.amountFils + 11,
    transferDecision: { version: 1, ownership: 'external', decidedAt: newestTs } } : t);
const protectedAfter = replay(protectedState, 'in-memory-user-edit-probe');
check('injected-user-edits-preserved', drift(protectedState, protectedAfter.state) === 0, { probes: probeIds.size, drift: drift(protectedState, protectedAfter.state) });
// Ownership decisions are narrower than userEdited. Exercise the real atomic
// resolver on cloned corpus rows, including a reciprocal own-account link.
let decisionState = structuredClone(first.state);
const decisionCandidates = [...core.reconcileTransfers(decisionState.transactions, decisionState.accounts).pendingIds].slice(0, 6);
for (const [index, id] of decisionCandidates.entries()) {
  const row = decisionState.transactions.find(t => t.id === id);
  decisionState = { ...decisionState, transactions: core.applyTransferDecision(decisionState.transactions, decisionState.accounts, {
    ids: [id], ownership: index % 2 ? 'own' : 'external', now: newestTs,
    expectedFingerprints: { [id]: core.transferFingerprint(row) },
  }) };
}
const likely = [...core.reconcileTransfers(decisionState.transactions, decisionState.accounts).byId.values()]
  .find(a => a.status === 'likely-own' && a.counterpartId);
if (likely) {
  const selected = decisionState.transactions.filter(t => t.id === likely.id || t.id === likely.counterpartId);
  decisionState = { ...decisionState, transactions: core.applyTransferDecision(decisionState.transactions, decisionState.accounts, {
    ids: [likely.id], ownership: 'own', counterpartId: likely.counterpartId, now: newestTs,
    expectedFingerprints: Object.fromEntries(selected.map(t => [t.id, core.transferFingerprint(t)])),
  }) };
}
const decisionsBefore = new Map(decisionState.transactions.filter(t => t.transferDecision).map(t => [t.id, t.transferDecision]));
const decisionAfter = replay(restore(JSON.parse(JSON.stringify(decisionState))), 'in-memory-ownership-decision-probe');
const decisionsAfter = new Map(decisionAfter.state.transactions.map(t => [t.id, t.transferDecision]));
const decisionProbeDrift = [...decisionsBefore].filter(([id, decision]) => !isDeepStrictEqual(decision, decisionsAfter.get(id))).length;
check('injected-ownership-decisions-survive-restore-and-reread', decisionProbeDrift === 0,
  { probes: decisionsBefore.size, linkedPair: Boolean(likely), drift: decisionProbeDrift });
const freshBase = { ...structuredClone(state), transactions: [], accounts: [], accountHints: {}, cardDues: [], bills: [], lastScanTs: 0 };
const fresh = replay(freshBase, 'fresh-ledger');
const freshAgain = replay(fresh.state, 'fresh-ledger-repeat');
check('fresh-repeat-adds-no-durable-transactions', freshAgain.state.transactions.length === fresh.state.transactions.length);
check('fresh-repeat-is-identical', isDeepStrictEqual(fresh.state, freshAgain.state), changedFields(fresh.state, freshAgain.state));
function summary(value) {
  const reconciliation = core.reconcileTransfers(value.transactions, value.accounts);
  const live = ledger.liveAccountIds(value.accounts), excluded = ledger.internalTransferIds(value.transactions, value.accounts);
  const statuses = tally([...reconciliation.byId.values()], x => x.status);
  const sum = fn => value.transactions.reduce((n,t) => n + (fn(t) ? t.amountFils : 0),0);
  const amounts = { incomeFils: sum(t => ledger.isIncome(t,live,excluded)), spendingFils: sum(t => ledger.isSpending(t,live,excluded)) };
  const cash = summarizeCashOutflow(value,{mode:'all'},{live,internal:excluded});
  return { transactions: value.transactions.length, accounts: value.accounts.length, statuses, pending: reconciliation.pendingIds.size,
    linkedOwnPairs: [...reconciliation.byId.values()].filter(x => x.status==='confirmed-own').length / 2,
    corroboratingAlerts: reconciliation.corroboratingIds.size, provedCardRepayments: reconciliation.cardRepaymentPairs.size,
    unassignedTransfers: value.transactions.filter(t => core.isUnassignedTransferAccount(t.accountId)).length,
    cardPaymentRows: cardPaymentRows(value).length, ...amounts, cashOutFils: cash.totalFils, cardCashOutFils: cash.cardPaymentsFils };
}
for (const value of [first.state, third.state, fresh.state]) {
  check('unique-transaction-identifiers', new Set(value.transactions.map(t=>t.id)).size===value.transactions.length);
  const keys=value.transactions.filter(t=>t.smsKey).map(t=>t.smsKey);
  check('unique-source-identifiers',new Set(keys).size===keys.length);
  check('safe-positive-money',value.transactions.every(t=>Number.isSafeInteger(t.amountFils)&&t.amountFils>0));
}
const report = { schema: 'wafra-transfer-corpus-replay-v1', sourceSHA256: hash(bytes), parserVersion: PARSER_VERSION,
  messages: messages.length, parsed: parsed.length, nonPosting: declined.length, refused: rejected, parseMs,
  identity: { recoveredProviderIds, syntheticAuditIds, note: 'Provider IDs reused only from supplied ledger at unique message clocks. Other observations use stable audit-only IDs, not invented Android IDs.' },
  stats, states: { originalUnderNewRules: summary(state), repaired: summary(first.state), afterRestore: summary(third.state), fresh: summary(fresh.state) },
  moneyChanges, decisionsDrift, checks, failed: [...new Set(failures)] };
fs.writeFileSync(output, JSON.stringify(report,null,2)+'\n',{mode:0o600});
if (privateDir) {
  fs.mkdirSync(privateDir,{recursive:true,mode:0o700});
  for (const [name,value] of Object.entries({first:first.state,second:second.state,restored,third:third.state,fresh:fresh.state,freshAgain:freshAgain.state,parsed}))
    fs.writeFileSync(path.join(privateDir,`${name}.json`),JSON.stringify(value),{mode:0o600});
}
console.log(JSON.stringify(report,null,2));
process.exitCode = failures.length ? 1 : 0;
