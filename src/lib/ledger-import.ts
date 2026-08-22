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
import { reconcilePaymentFlows } from '@/lib/payment-flow';
import { PARSER_VERSION } from '@/lib/sms-parser';
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
  transactions: Transaction[];
  newAccounts: Account[];
  newHints: Record<string, string>;
  newDues: CardDue[];
  newBills: Bill[];
  snapshots: ImportBatchInput['snapshots'];
  bankNames: Record<string, string>;
  cardTypes: NonNullable<ImportBatchInput['cardTypes']>;
  confirmedLedgerCurrency?: 'AED' | 'SAR';
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

export const applyMaterializedImportBatch = (
  state: AppState,
  batch: MaterializedImportBatch,
): AppState => {
  const accounts = [...state.accounts, ...batch.newAccounts].map((account) => {
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
  });
  const dues = mergeImportedCardDues(state.cardDues, batch.newDues, accounts);
  const bills = mergeImportedBills(state.bills, batch.newBills);
  const existing = applyHealUpdates(state.transactions, batch.updates);
  const merged = repairCardPaymentAccounts(mergeDuplicateAccounts({
    ...state,
    onboardingCurrencyEvidence:
      batch.confirmedLedgerCurrency ?? state.onboardingCurrencyEvidence,
    transactions: [...batch.transactions, ...existing],
    accounts,
    accountHints: { ...state.accountHints, ...batch.newHints },
    cardDues: dues,
    bills,
    lastScanTs: Math.max(state.lastScanTs, batch.lastScanTs),
    historyImport: batch.historyImport ?? state.historyImport,
    // Parser version is proof of a completed full-history reread, not merely
    // proof that one new alert was imported. This distinction matters when a
    // backup is restored while an incremental capture is already in flight.
    parserVersion: batch.parserRereadComplete ? PARSER_VERSION : state.parserVersion,
  }));
  const repaired = repairDuplicateStatements(merged);

  return {
    ...repaired,
    cardDues:
      repaired === merged
        ? merged.cardDues
        : mergeImportedCardDues([], repaired.cardDues, repaired.accounts),
    transactions: sortTransactions(
      reconcilePaymentFlows(reconcileCaptureDuplicates(merged.transactions)),
    ),
  };
};
