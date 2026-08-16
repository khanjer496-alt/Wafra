#!/usr/bin/env node
/**
 * Privacy-safe end-to-end audit for an owner-supplied SMS corpus + Wafra backup.
 *
 * Raw messages, senders, merchant titles, account names and transaction ids
 * are never printed or written. The script reports aggregate counts and money
 * only. Run `bash scripts/test/build.sh` first.
 */
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const root = path.resolve(__dirname, '..');
const fromBuild = (name) => require(path.join(root, 'scripts/test/build', name));
const loadLedgerHydration = require('./lib/load-ledger-hydration');
const {
  mergeDuplicateAccounts,
  removeDeclinedTransactions,
  repairCardPaymentAccounts,
  repairDuplicateStatements,
} = fromBuild('accounts.js');
const { buildImportPlan } = fromBuild('import-plan.js');
const { materializeImportBatch, applyMaterializedImportBatch } = fromBuild('ledger-import.js');
const { summarizeCashOutflow } = fromBuild('cash-flow.js');
const { summarizeMonth } = fromBuild('insights.js');
const { internalTransferIds, liveAccountIds } = fromBuild('ledger.js');
const { mergeImportedCardDues } = fromBuild('cards.js');
const { setMonthStartDay } = fromBuild('format.js');
const { setActiveMarket, setLedgerCurrency } = fromBuild('markets.js');
const { createLaunchAlertSession } = fromBuild('launch-alert-parser.js');
const { nonPostingReason, PARSER_VERSION } = fromBuild('sms-parser.js');

const [corpusPath, backupPath] = process.argv.slice(2);
if (!corpusPath || !backupPath) {
  console.error('Usage: node scripts/audit-accounting-corpus.js <corpus.json> <backup.json>');
  process.exit(2);
}

const readJson = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));
const corpus = readJson(corpusPath);
const backup = readJson(backupPath);
if (corpus?.schema !== 'wafra-sms-corpus-v1' || !Array.isArray(corpus.messages)) {
  throw new Error('Unsupported SMS corpus');
}
if (backup?.app !== 'wafra' || backup?.version !== 1 || !backup.data) {
  throw new Error('Unsupported Wafra backup');
}

const { migratePersistedState, finalizeHydrationTransactions } = loadLedgerHydration(root);
const migrated = migratePersistedState(structuredClone(backup.data));
const hydratedBase = {
  ...migrated,
  hydrated: true,
  privateMode: Boolean(migrated.privateMode),
  captureOptOut: Boolean(migrated.captureOptOut),
  reviewTray: migrated.reviewTray ?? { schemaVersion: 1, pending: [], tombstones: [] },
};
setMonthStartDay(hydratedBase.monthStartDay || 1);
setLedgerCurrency(null);
setActiveMarket(hydratedBase.marketId || 'AE');
const accountsMerged = mergeDuplicateAccounts(hydratedBase);
const paymentsRepaired = repairDuplicateStatements(repairCardPaymentAccounts(accountsMerged));
const declinesRemoved = removeDeclinedTransactions(paymentsRepaired);
const state = {
  ...declinesRemoved,
  transactions: finalizeHydrationTransactions(
    declinesRemoved.transactions,
    hydratedBase.transactions,
  ),
  cardDues: mergeImportedCardDues(
    [],
    declinesRemoved.cardDues,
    declinesRemoved.accounts,
  ),
};

const parsed = [];
const declined = [];
const launchSession = createLaunchAlertSession({
  overrides: state.merchantOverrides,
  pinnedCurrency: state.marketId === 'SA' ? 'SAR' : 'AED',
  activeMarket: state.marketId,
});
let newestTs = 0;
let refused = 0;
let semanticAutoRows = 0;
const semanticMeanings = {};
for (const [messageIndex, message] of corpus.messages.entries()) {
  const body = typeof message.body === 'string' ? message.body : '';
  const sender = typeof message.sender === 'string' ? message.sender : '';
  const smsTs = Number(message.receivedAtMs);
  if (!body || !Number.isFinite(smsTs)) continue;
  newestTs = Math.max(newestTs, smsTs);
  const inspection = launchSession.inspect(body, sender);
  const interpretation = launchSession.interpret(body, sender, inspection);
  if (!interpretation) {
    const reason = nonPostingReason(body);
    if (reason) {
      declined.push({
        smsTs,
        sender,
        channel: 'inbox',
        reason,
        sourceEventId: `audit${messageIndex}`,
      });
    }
    else refused += 1;
    continue;
  }
  const result = interpretation.parsed;
  if (interpretation.origin === 'semantic') {
    semanticAutoRows += 1;
    semanticMeanings[interpretation.meaning] =
      (semanticMeanings[interpretation.meaning] ?? 0) + 1;
  }
  parsed.push({
    ...result,
    date: result.date ?? new Date(smsTs).toISOString().slice(0, 10),
    smsTs,
    sender,
    channel: 'inbox',
    sourceEventId: `audit${messageIndex}`,
  });
}
setLedgerCurrency(null);
setActiveMarket(state.marketId || 'AE');

const auditNow = new Date(corpus.exportedAt ?? Date.now());
const plan = buildImportPlan(parsed, state, newestTs, auditNow, declined);
let nextId = 0;
const materialized = materializeImportBatch(
  plan.batch,
  state,
  (prefix) => `audit-${prefix}-${++nextId}`,
);
const finalState = applyMaterializedImportBatch(state, materialized);
const replay = buildImportPlan(parsed, finalState, newestTs, auditNow, declined);
const replayMaterialized = materializeImportBatch(
  replay.batch,
  finalState,
  (prefix) => `audit-replay-${prefix}-${++nextId}`,
);
const replayState = applyMaterializedImportBatch(finalState, replayMaterialized);
const replayChangesState = !isDeepStrictEqual(replayState, finalState);
const thirdReplay = buildImportPlan(parsed, replayState, newestTs, auditNow, declined);
const thirdMaterialized = materializeImportBatch(
  thirdReplay.batch,
  replayState,
  (prefix) => `audit-third-${prefix}-${++nextId}`,
);
const thirdState = applyMaterializedImportBatch(replayState, thirdMaterialized);
const thirdReplayChangesState = !isDeepStrictEqual(thirdState, replayState);
const replayChangedFields = Object.keys(finalState).filter(
  (field) => !isDeepStrictEqual(finalState[field], replayState[field]),
);
const replayTxBefore = new Map(finalState.transactions.map((row) => [row.id, row]));
const replayTransactionChangedFields = {};
const replayTypeTransitions = {};
const replayCategoryTransitions = {};
const replayChangedRoleCounts = {};
let replayChangedTransactions = 0;
for (const row of replayState.transactions) {
  const prior = replayTxBefore.get(row.id);
  if (!prior || isDeepStrictEqual(prior, row)) continue;
  replayChangedTransactions += 1;
  if (prior.type !== row.type) {
    const transition = `${prior.type}->${row.type}`;
    replayTypeTransitions[transition] = (replayTypeTransitions[transition] ?? 0) + 1;
  }
  if (prior.category !== row.category) {
    const transition = `${prior.category}->${row.category}`;
    replayCategoryTransitions[transition] = (replayCategoryTransitions[transition] ?? 0) + 1;
  }
  const role = prior.cardPaymentSide ?? prior.paymentFlowSide ?? row.cardPaymentSide ??
    row.paymentFlowSide ?? 'ordinary';
  replayChangedRoleCounts[role] = (replayChangedRoleCounts[role] ?? 0) + 1;
  for (const field of new Set([...Object.keys(prior), ...Object.keys(row)])) {
    if (isDeepStrictEqual(prior[field], row[field])) continue;
    replayTransactionChangedFields[field] = (replayTransactionChangedFields[field] ?? 0) + 1;
  }
}

const hardFailures = [];
const accountIds = new Set(finalState.accounts.map((account) => account.id));
const smsKeys = new Set();
let duplicateSmsKeys = 0;
for (const transaction of finalState.transactions) {
  if (!Number.isSafeInteger(transaction.amountFils) || transaction.amountFils <= 0) {
    hardFailures.push('unsafe-transaction-money');
  }
  if (!accountIds.has(transaction.accountId)) hardFailures.push('missing-transaction-account');
  if (!transaction.smsKey || transaction.source !== 'sms') continue;
  if (smsKeys.has(transaction.smsKey)) duplicateSmsKeys += 1;
  smsKeys.add(transaction.smsKey);
}
if (duplicateSmsKeys) hardFailures.push('duplicate-sms-key');
for (const due of finalState.cardDues) {
  if (!accountIds.has(due.accountId)) hardFailures.push('missing-card-due-account');
}
if (new Set(finalState.accounts.map((row) => row.id)).size !== finalState.accounts.length) {
  hardFailures.push('duplicate-account-id');
}
if (new Set(finalState.transactions.map((row) => row.id)).size !== finalState.transactions.length) {
  hardFailures.push('duplicate-transaction-id');
}
if (new Set(finalState.bills.map((row) => row.id)).size !== finalState.bills.length) {
  hardFailures.push('duplicate-bill-id');
}

const editedBefore = new Map(
  state.transactions.filter((row) => row.userEdited).map((row) => [row.id, row]),
);
let editedDrift = 0;
for (const row of finalState.transactions) {
  const prior = editedBefore.get(row.id);
  if (!prior) continue;
  const fields = [
    'title', 'category', 'type', 'amountFils', 'date', 'note', 'accountId',
    'isTransfer', 'cardPaymentSide', 'paymentFlowSide', 'cashOutDate',
    'cashOutAccountId',
  ];
  if (fields.some((field) => prior[field] !== row[field])) editedDrift += 1;
}
if (editedDrift) hardFailures.push('user-edited-ledger-drift');

const replayChanges =
  replay.txCount + replay.newAccountCount + replay.dueCount + replay.healedCount +
  (replay.batch.newBills?.length ?? 0);
if (replayChangesState) hardFailures.push('non-idempotent-second-replay');

const live = liveAccountIds(finalState.accounts);
const internal = internalTransferIds(finalState.transactions, finalState.accounts);
const monthKeys = [...new Set(finalState.transactions.map((row) => row.date.slice(0, 7)))]
  .filter((key) => /^\d{4}-\d{2}$/.test(key))
  .sort();
let cashOutPartitionFailures = 0;
const recentMonths = [];
for (const key of monthKeys) {
  const period = { mode: 'month', key };
  const cashOut = summarizeCashOutflow(finalState, period, { live, internal });
  if (cashOut.totalFils !== cashOut.cardPaymentsFils + cashOut.accountOutflowFils) {
    cashOutPartitionFailures += 1;
  }
  if (key >= '2026-01') {
    const summary = summarizeMonth(finalState.transactions, period, live, internal);
    recentMonths.push({
      month: key,
      incomeFils: summary.incomeFils,
      spendingFils: summary.expenseFils,
      cashOutFils: cashOut.totalFils,
      cardPaymentsFils: cashOut.cardPaymentsFils,
    });
  }
}
if (cashOutPartitionFailures) hardFailures.push('cash-out-partition-mismatch');

const counts = (rows, field) => rows.reduce((result, row) => {
  const key = row[field] ?? 'unknown';
  result[key] = (result[key] ?? 0) + 1;
  return result;
}, {});
const report = {
  schema: 'wafra-accounting-corpus-audit-v1',
  parserVersion: PARSER_VERSION,
  source: {
    messages: corpus.messages.length,
    parsed: parsed.length,
    declined: declined.length,
    refused,
    semanticAutoRows,
    semanticMeanings,
  },
  import: {
    existingTransactions: state.transactions.length,
    addedTransactions: materialized.transactions.length,
    healedTransactions: materialized.updates.length,
    addedAccounts: materialized.newAccounts.length,
    addedBills: materialized.newBills.length,
    addedCardDues: materialized.newDues.length,
    finalTransactions: finalState.transactions.length,
    finalAccounts: finalState.accounts.length,
    finalBills: finalState.bills.length,
    finalCardDues: finalState.cardDues.length,
    secondReplay: {
      transactions: replay.txCount,
      accounts: replay.newAccountCount,
      cardDues: replay.dueCount,
      bills: replay.batch.newBills?.length ?? 0,
      heals: replay.healedCount,
      accountKinds: counts(replay.batch.newAccounts, 'kind'),
      transactionDirections: counts(replay.batch.transactions, 'type'),
      transactionCategories: counts(replay.batch.transactions, 'category'),
      effectiveCounts: {
        transactions: replayState.transactions.length - finalState.transactions.length,
        accounts: replayState.accounts.length - finalState.accounts.length,
        cardDues: replayState.cardDues.length - finalState.cardDues.length,
        bills: replayState.bills.length - finalState.bills.length,
      },
    },
  },
  accounting: {
    directions: counts(finalState.transactions, 'type'),
    categories: counts(finalState.transactions, 'category'),
    internalTransferRows: internal.size,
    linkedFundingRows: finalState.transactions.filter(
      (row) => row.paymentFlowSide === 'funding',
    ).length,
    linkedReceiptRows: finalState.transactions.filter(
      (row) => row.paymentFlowSide === 'receipt',
    ).length,
    talabatIncomeRows: finalState.transactions.filter(
      (row) => row.type === 'income' && row.title === 'Talabat sales',
    ).length,
    duplicateSmsKeys,
    editedRowsChecked: editedBefore.size,
    editedDrift,
    secondReplayProposedChanges: replayChanges,
    secondReplayChangedLedger: replayChangesState,
    secondReplayChangedFields: replayChangedFields,
    secondReplayChangedTransactions: replayChangedTransactions,
    secondReplayTransactionChangedFields: replayTransactionChangedFields,
    secondReplayTypeTransitions: replayTypeTransitions,
    secondReplayCategoryTransitions: replayCategoryTransitions,
    secondReplayChangedRoleCounts: replayChangedRoleCounts,
    thirdReplayChangedLedger: thirdReplayChangesState,
    thirdReplayProposedChanges:
      thirdReplay.txCount + thirdReplay.newAccountCount + thirdReplay.dueCount +
      thirdReplay.healedCount + (thirdReplay.batch.newBills?.length ?? 0),
    recentMonths,
  },
  hardFailures: [...new Set(hardFailures)],
};

console.log(JSON.stringify(report, null, 2));
if (report.hardFailures.length) process.exit(1);
