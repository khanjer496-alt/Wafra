/**
 * The durable ledger side of an automatic capture.
 *
 * Parsing and planning live in import-plan.ts. This module owns the other
 * half of the same use case: materialising stable ids and applying that plan
 * to one ledger snapshot. StoreProvider and the corpus audit both call this
 * exact code, so an end-to-end accounting test cannot drift behind a copied
 * approximation of the reducer.
 */
import {
  mergeDuplicateAccounts,
  repairCardPaymentAccounts,
  repairDuplicateStatements,
} from '@/lib/accounts';
import { mergeImportedBills } from '@/lib/bills';
import { mergeImportedCardDues } from '@/lib/cards';
import { reconcileCaptureDuplicates } from '@/lib/dedupe';
import { applyHealUpdates } from '@/lib/heal';
import { ImportMoneyError } from '@/lib/import-plan';
import {
  isLedgerMoneySpec,
  ledgerMoneyMatchesCurrentMetadata,
  migrateLegacyLedgerMoney,
} from '@/lib/ledger-money';
import { reconcilePaymentFlows } from '@/lib/payment-flow';
import {
  isTransferCandidate,
  normalizeTransferLinks,
  reconcileTransfers,
  reconciliationInternalIds,
  TRANSFER_NORMALIZATION_VERSION,
} from '@/lib/transfer-reconciliation';
import { PARSER_BACKFILL_VERSION } from '@/lib/sms-parser';
import type {
  Account,
  AppState,
  Bill,
  CardDue,
  ImportBatchInput,
  Transaction,
  TxHealUpdate,
} from '@/lib/types';

export interface MaterializedImportBatch {
  importMoney?: ImportBatchInput['importMoney'];
  transactions: Transaction[];
  newAccounts: Account[];
  newHints: Record<string, string>;
  newDues: CardDue[];
  newBills: Bill[];
  snapshots: ImportBatchInput['snapshots'];
  bankNames: Record<string, string>;
  cardTypes: NonNullable<ImportBatchInput['cardTypes']>;
  confirmedLedgerCurrency?: string;
  parserRereadComplete: boolean;
  historyImport: ImportBatchInput['historyImport'];
  lastScanTs: number;
  updates: TxHealUpdate[];
}

const resolveAccountRef = (ref: string, accounts: Account[]): string =>
  /^\d+$/.test(ref) && Number(ref) < accounts.length ? accounts[Number(ref)].id : ref;

export const materializeImportBatch = (
  input: ImportBatchInput,
  state: Pick<AppState, 'privateMode'>,
  createId: (prefix: 'acc' | 'tx' | 'due' | 'bill') => string,
): MaterializedImportBatch => {
  const newAccounts = input.newAccounts.map((account) => ({
    ...account,
    id: createId('acc'),
  }));
  const resolve = (ref: string): string => resolveAccountRef(ref, newAccounts);
  const mapRefs = <T>(values: Record<string, T> | undefined): Record<string, T> =>
    Object.fromEntries(Object.entries(values ?? {}).map(([ref, value]) => [resolve(ref), value]));

  return {
    ...(input.importMoney ? { importMoney: input.importMoney } : {}),
    transactions: input.transactions.map((transaction) => ({
      ...transaction,
      raw: state.privateMode ? undefined : transaction.raw,
      accountId: resolve(transaction.accountId),
      id: createId('tx'),
    })),
    newAccounts,
    newHints: Object.fromEntries(
      Object.entries(input.newHints).map(([last4, ref]) => [last4, resolve(ref)]),
    ),
    newDues: input.newDues.map((due) => ({
      ...due,
      accountId: resolve(due.accountId),
      id: createId('due'),
    })),
    newBills: (input.newBills ?? []).map((bill) => ({
      ...bill,
      paidMonths: [],
      id: createId('bill'),
    })),
    snapshots: mapRefs(input.snapshots),
    bankNames: mapRefs(input.bankNames),
    cardTypes: mapRefs(input.cardTypes),
    confirmedLedgerCurrency: input.confirmedLedgerCurrency,
    parserRereadComplete: input.parserRereadComplete === true,
    historyImport: input.historyImport,
    lastScanTs: input.lastScanTs,
    updates: (input.updates ?? []).map((update) => ({
      ...update,
      accountId: update.accountId ? resolve(update.accountId) : undefined,
    })),
  };
};

const sortTransactions = (transactions: Transaction[]): Transaction[] =>
  [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/** Keep the reconciliation memo valid when finalization has not changed order. */
const sortTransactionsIfNeeded = (transactions: Transaction[]): Transaction[] => {
  for (let index = 1; index < transactions.length; index += 1) {
    if (transactions[index - 1].date < transactions[index].date) return sortTransactions(transactions);
  }
  return transactions;
};

/**
 * The persisted ledger is already newest-first. A live capture normally adds
 * one row, so sorting all 10k+ historical rows again is needless foreground
 * work. Preserve the same stable ordering as `sortTransactions`: fresh rows
 * win ties because the old implementation prepended them before stable sort.
 */
const mergeSortedTransactions = (
  incoming: readonly Transaction[],
  existing: readonly Transaction[],
): Transaction[] => {
  if (incoming.length === 0) return existing as Transaction[];
  if (existing.length === 0) return sortTransactions([...incoming]);
  const fresh = sortTransactions([...incoming]);
  const merged: Transaction[] = [];
  let freshIndex = 0;
  let existingIndex = 0;
  while (freshIndex < fresh.length && existingIndex < existing.length) {
    if (fresh[freshIndex].date >= existing[existingIndex].date) {
      merged.push(fresh[freshIndex++]);
    } else {
      merged.push(existing[existingIndex++]);
    }
  }
  while (freshIndex < fresh.length) merged.push(fresh[freshIndex++]);
  while (existingIndex < existing.length) merged.push(existing[existingIndex++]);
  return merged;
};

/**
 * A normal purchase cannot change any previously reconciled transfer/payment
 * relationship. The import planner has already deduped the incoming source
 * identity against the authoritative ledger, and hydration has already run the
 * capture/payment cleanup once. In that very common case, rerunning every
 * whole-ledger repair after one live SMS/push row only blocks Hermes while
 * producing the same transfer receipt.
 *
 * Stay deliberately conservative: account identity changes, parser healing,
 * payment-flow/card-payment roles, or anything transfer-shaped still take the
 * canonical full path below.
 */
const canUseIncrementalCaptureFastPath = (
  state: AppState,
  batch: MaterializedImportBatch,
): boolean =>
  (state.hydrationFinalizeVersion ?? 0) >= 1 &&
  state.transferNormalizationVersion === TRANSFER_NORMALIZATION_VERSION &&
  Array.isArray(state.transferInternalIds) &&
  batch.updates.length === 0 &&
  batch.newAccounts.length === 0 &&
  Object.keys(batch.bankNames).length === 0 &&
  Object.keys(batch.cardTypes).length === 0 &&
  batch.transactions.every((transaction) =>
    !isTransferCandidate(transaction) &&
    transaction.isTransfer !== true &&
    transaction.transferMatch === undefined &&
    transaction.transferDecision === undefined &&
    transaction.transferEvidence === undefined &&
    transaction.paymentFlowSide === undefined &&
    transaction.cardPaymentSide === undefined
  );

type MoneyBearingImport = Pick<ImportBatchInput,
  'importMoney' | 'transactions' | 'newAccounts' | 'newDues' | 'newBills' | 'snapshots' | 'updates'>;

const changesImportMoney = (batch: MoneyBearingImport): boolean =>
  batch.transactions.length > 0 || batch.newDues.length > 0 ||
    (batch.newBills?.length ?? 0) > 0 || Object.keys(batch.snapshots).length > 0 ||
    (batch.updates?.length ?? 0) > 0 || batch.newAccounts.some((account) =>
      account.openingFils !== 0 || (account.snapshotFils ?? 0) !== 0 ||
      (account.creditLimitFils ?? 0) !== 0);

/** A preview is not authority to write into a restored or reconfigured ledger. */
export const assertImportBatchMoney = (
  state: AppState,
  batch: MoneyBearingImport,
): void => {
  // Cursor-only commits must remain possible without manufacturing a currency.
  if (!changesImportMoney(batch)) return;
  const money = batch.importMoney;
  const current = migrateLegacyLedgerMoney(state);
  if (!isLedgerMoneySpec(money) || !ledgerMoneyMatchesCurrentMetadata(money) ||
    (current && (current.currency !== money.currency || current.exponent !== money.exponent))) {
    throw new ImportMoneyError();
  }
};

const isMetadataOnlyImportBatch = (batch: MaterializedImportBatch): boolean =>
  batch.transactions.length === 0 &&
  batch.newAccounts.length === 0 &&
  Object.keys(batch.newHints).length === 0 &&
  batch.newDues.length === 0 &&
  batch.newBills.length === 0 &&
  Object.keys(batch.snapshots).length === 0 &&
  Object.keys(batch.bankNames).length === 0 &&
  Object.keys(batch.cardTypes).length === 0 &&
  batch.updates.length === 0;

/** Preserve immutable collection identity when an import learned no new facts. */
const reuseUnchangedRows = <T>(prior: T[], next: T[]): T[] =>
  prior.length === next.length && next.every((row, index) => row === prior[index]) ? prior : next;

export const applyMaterializedImportBatch = (
  state: AppState,
  batch: MaterializedImportBatch,
): AppState => {
  assertImportBatchMoney(state, batch);
  // An empty final provider page is still the boundary that must replace the
  // provisional history receipt with canonical reconciliation of every row.
  const finishingHistory = batch.parserRereadComplete || batch.historyImport?.status === 'complete';
  // A history page containing only already-known rows still has useful cursor
  // and parser progress, but it does not justify running every account,
  // duplicate, payment, and transfer reconciliation over the complete ledger.
  // Preserve the collection references so persistence can write metadata only.
  if (isMetadataOnlyImportBatch(batch) && !finishingHistory) {
    return {
      ...state,
      onboardingCurrencyEvidence:
        batch.confirmedLedgerCurrency ?? state.onboardingCurrencyEvidence,
      lastScanTs: Math.max(state.lastScanTs, batch.lastScanTs),
      historyImport: batch.historyImport ?? state.historyImport,
      parserVersion: batch.parserRereadComplete ? PARSER_BACKFILL_VERSION : state.parserVersion,
    };
  }
  const accounts = reuseUnchangedRows(state.accounts, [...state.accounts, ...batch.newAccounts].map((account) => {
    const snapshot = batch.snapshots[account.id];
    const bankName = !account.bankName ? batch.bankNames[account.id] : undefined;
    const learnedType = batch.cardTypes[account.id];
    let next = account;
    if (snapshot && snapshot.ts > (account.snapshotTs ?? 0)) {
      next = {
        ...next,
        snapshotFils: snapshot.fils,
        snapshotKind: snapshot.kind,
        snapshotTs: snapshot.ts,
      };
    }
    if (bankName) next = { ...next, bankName };
    if (
      learnedType &&
      (learnedType === 'credit' || next.cardType === undefined) &&
      next.cardType !== learnedType
    ) {
      next = { ...next, kind: 'card', cardType: learnedType };
    }
    if (learnedType === 'credit' && next.snapshotKind === 'balance') {
      next = { ...next, snapshotKind: 'limit' };
    }
    return next;
  }));
  const dues = reuseUnchangedRows(state.cardDues, mergeImportedCardDues(state.cardDues, batch.newDues, accounts));
  const bills = reuseUnchangedRows(state.bills, mergeImportedBills(state.bills, batch.newBills));
  const healed = applyHealUpdates(state.transactions, batch.updates);
  // Only an admitted exact-source date repair can invalidate existing order.
  // Ordinary history pages retain the linear merge without a full sort.
  const hasDateCorrection = batch.updates.some((patch) => patch.sourceDateCorrection !== undefined);
  const priorDates = hasDateCorrection ? new Map(state.transactions.map((row) => [row.id, row.date])) : undefined;
  const changedDate = priorDates !== undefined && healed.some((row) => row.date !== priorDates.get(row.id));
  const existing = changedDate ? sortTransactions(healed) : healed;
  const historyStillRunning = batch.historyImport?.status === 'running' && !batch.parserRereadComplete;
  const incrementalFastPath = !historyStillRunning && !finishingHistory && canUseIncrementalCaptureFastPath(state, batch);
  const pageState: AppState = {
    ...state,
    ...(batch.importMoney && !state.ledgerMoney && changesImportMoney(batch)
      ? { ledgerMoney: batch.importMoney } : {}),
    onboardingCurrencyEvidence:
      batch.confirmedLedgerCurrency ?? state.onboardingCurrencyEvidence,
    // `existing` is newest-first, including after a source-proven date repair.
    // Merge incoming history/live rows linearly instead of
    // re-sorting the entire 10k+ ledger on every history checkpoint.
    transactions: mergeSortedTransactions(batch.transactions, existing),
    accounts,
    accountHints: Object.keys(batch.newHints).length ? { ...state.accountHints, ...batch.newHints } : state.accountHints,
    cardDues: dues,
    bills,
    lastScanTs: Math.max(state.lastScanTs, batch.lastScanTs),
    historyImport: batch.historyImport ?? state.historyImport,
    // Parser version is proof of a completed full-history reread, not merely
    // proof that one new alert was imported. This distinction matters when a
    // backup is restored while an incremental capture is already in flight.
    parserVersion: batch.parserRereadComplete ? PARSER_BACKFILL_VERSION : state.parserVersion,
  };

  // First-history import can contain tens of thousands of messages. Running
  // every whole-ledger repair after EACH page made the foreground cost scale as
  // pages × ledger size: duplicate repair, payment-flow reconciliation and
  // capture dedupe all re-walked the same 10k+ rows before the next page could
  // begin. The planner has already deduped this page against the authoritative
  // source identities, so intermediate pages only need to append their durable
  // facts. The final page still runs the exact canonical reconciliation below
  // once over the complete history.
  if (historyStillRunning) {
    return {
      ...pageState,
      transferNormalizationVersion: undefined,
      transferInternalIds: state.transferInternalIds ?? [],
    };
  }

  // The prior transfer receipt is still exact when the only new rows are
  // ordinary non-transfer activity. This is the hot path for a live card SMS:
  // render/persist the new row immediately instead of walking the complete
  // ledger through duplicate, payment-flow and transfer reconciliation first.
  if (incrementalFastPath) {
    return {
      ...pageState,
      transferNormalizationVersion: TRANSFER_NORMALIZATION_VERSION,
      transferInternalIds: state.transferInternalIds,
    };
  }

  const merged = repairCardPaymentAccounts(mergeDuplicateAccounts(pageState));
  const repaired = repairDuplicateStatements(merged);
  const retained = reconcilePaymentFlows(reconcileCaptureDuplicates(merged.transactions));
  // Reconcile the rows this import actually STORES. Reconciling `retained`
  // instead classified against the pre-normalization graph, where a row with
  // explicit own-ownership may still seed the absorption step it is excluded
  // from once `normalizeTransferLinks` has written its match — so an ordinary
  // payment sharing an amount and a day with a genuine own-account pair could
  // be persisted as an internal transfer and vanish from every total.
  const transactions = sortTransactionsIfNeeded(
    normalizeTransferLinks(retained, repaired.accounts),
  );
  const transferReconciliation = reconcileTransfers(transactions, repaired.accounts);

  return {
    ...repaired,
    cardDues:
      repaired === merged
        ? merged.cardDues
        : mergeImportedCardDues([], repaired.cardDues, repaired.accounts),
    transactions,
    transferNormalizationVersion: TRANSFER_NORMALIZATION_VERSION,
    transferInternalIds: [...reconciliationInternalIds(transferReconciliation)],
  };
};
