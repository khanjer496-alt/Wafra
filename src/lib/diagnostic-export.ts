/** Explicit, user-owned diagnostic export. No I/O, uploads, credentials or mutations. */
import { normalizeAlertReviewTray } from '@/lib/alert-review-tray';
import { categorySupportsType } from '@/lib/categories';
import { canonicalCaptureSourceKey } from '@/lib/capture-source-identity';
import { getMonthStartDay, monthKey } from '@/lib/format';
import { createLaunchAlertSession } from '@/lib/launch-alert-parser';
import { countsInTotals, internalTransferIds, isIncome, isUnassignedIncome, liveAccountIds } from '@/lib/ledger';
import { nonPostingReason, PARSER_VERSION } from '@/lib/sms-parser';
import { isTransferDecision, isTransferEvidence, isTransferMatch, reconcileTransfers } from '@/lib/transfer-reconciliation';
import type { AppState, Transaction } from '@/lib/types';

export interface DiagnosticBuild { version: string; build: string; platform: string }
export interface DiagnosticOptions {
  includeRetainedMessages: boolean;
  shouldContinue?: () => boolean;
  onProgress?: (processed: number, total: number) => void;
  logoFor: (title: string) => { id: string | null; reason: string };
}
type JsonRow = Record<string, unknown>;

// Allowlist scalar fields; unknown state properties and nested objects never
// escape simply because they were added by a future SDK, restore or connector.
function fields(value: object, names: string): JsonRow {
  const input = value as Record<string, unknown>;
  return Object.fromEntries(names.split(' ').filter(name => {
    const item = input[name];
    return item === null || typeof item === 'string' || typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item));
  }).map(name => [name, input[name]]));
}
const dictionary = (input: Record<string, string>) => Object.fromEntries(Object.entries(input ?? {})
  .filter(([key, value]) => !['__proto__', 'constructor', 'prototype'].includes(key) && typeof value === 'string'));
const ACCOUNT_FIELDS = 'id name kind openingFils color last4 bankName cardType snapshotFils snapshotKind snapshotTs creditLimitFils archived renewedFrom';
const TX_FIELDS = 'id type amountFils originalAmountMinor originalCurrency fxRate fxRateDate fxSource category accountId title note date ts source smsKey viaPush cardPaymentSide paymentFlowSide billIdentity paymentInstrumentSource cashOutDate cashOutAccountId isTransfer userEdited titleEdited';

export const assertDiagnosticContinues = (shouldContinue: () => boolean): void => {
  if (!shouldContinue()) throw new Error('diagnostic_cancelled');
};
export const diagnosticYield = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** All recorded periods, including hidden accounts; not a restorable backup. */
export async function buildDiagnosticExport(state: AppState, build: DiagnosticBuild,
  options: DiagnosticOptions, now = Date.now()) {
  if (!state.hydrated) throw new Error('diagnostic_not_hydrated');
  if (options.includeRetainedMessages && state.privateMode) throw new Error('diagnostic_private_mode');
  const active = options.shouldContinue ?? (() => true);
  assertDiagnosticContinues(active);
  await diagnosticYield();
  assertDiagnosticContinues(active);
  const live = liveAccountIds(state.accounts);
  const internal = internalTransferIds(state.transactions, state.accounts);
  const transfers = reconcileTransfers(state.transactions, state.accounts);
  const accounts = new Map(state.accounts.map(account => [account.id, account]));
  const sourceCounts = new Map<string, number>();
  for (const tx of state.transactions) if (tx.smsKey) {
    const key = canonicalCaptureSourceKey(tx.smsKey, tx.ts);
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  const transactions: JsonRow[] = [];
  const merchantMap = new Map<string, { title: string; count: number; categories: Set<string>;
    logo: { id: string | null; reason: string } }>();
  const monthly = new Map<string, { incomeMinor: number; spendingMinor: number; excluded: number }>();
  const issues: Record<string, number> = {};
  const session = createLaunchAlertSession({ overrides: state.merchantOverrides,
    pinnedCurrency: state.ledgerMoney?.currency ?? null, activeMarket: state.marketId });
  let retainedMessages = 0; let omittedSecurityMessages = 0; let slice = Date.now();
  for (let index = 0; index < state.transactions.length; index++) {
    assertDiagnosticContinues(active);
    const tx = state.transactions[index];
    const row = fields(tx, TX_FIELDS);
    if (tx.captureInstrument) row.captureInstrument = fields(tx.captureInstrument, 'last4 kind bankIdentity');
    if (isTransferEvidence(tx.transferEvidence)) {
      row.transferEvidence = fields(tx.transferEvidence, 'version currency attribution reference explicitOwn');
      if (tx.transferEvidence.counterparty) (row.transferEvidence as JsonRow).counterparty =
        fields(tx.transferEvidence.counterparty, 'last4 kind bankIdentity');
    }
    if (isTransferDecision(tx.transferDecision)) row.transferDecision = fields(tx.transferDecision, 'version ownership decidedAt counterpartId');
    if (isTransferMatch(tx.transferMatch)) row.transferMatch = fields(tx.transferMatch, 'version counterpartId basis');
    if (tx.splits) row.splits = tx.splits.map(part => fields(part, 'category amountFils note'));
    const flags: string[] = [];
    const unassigned = isUnassignedIncome(tx);
    const account = accounts.get(tx.accountId);
    const counted = countsInTotals(tx, live, internal);
    if (unassigned) flags.push('account-needs-review');
    else if (!account) flags.push('missing-account');
    else if (account.archived) flags.push('hidden-account');
    if (transfers.pendingIds.has(tx.id)) flags.push('transfer-ownership-pending');
    else if (!counted && (tx.isTransfer || internal.has(tx.id))) flags.push('transfer-excluded');
    if (!Number.isSafeInteger(tx.amountFils) || tx.amountFils <= 0) flags.push('invalid-amount');
    if (!categorySupportsType(tx.category, tx.type)) flags.push('category-direction-conflict');
    if (tx.smsKey && (sourceCounts.get(canonicalCaptureSourceKey(tx.smsKey, tx.ts)) ?? 0) > 1) flags.push('repeated-source-identity');
    if (tx.splits && tx.splits.reduce((sum, part) => sum + part.amountFils, 0) !== tx.amountFils) flags.push('split-total-mismatch');
    const key = tx.title.trim().toLowerCase();
    let merchant = merchantMap.get(key);
    if (!merchant) {
      merchant = { title: tx.title, count: 0, categories: new Set(), logo: options.logoFor(tx.title) };
      merchantMap.set(key, merchant);
    }
    merchant.count++; merchant.categories.add(tx.category);
    // Use each exact displayed title, not another same-normalized row's logo.
    const logo = options.logoFor(tx.title);
    if (!logo.id) flags.push('no-confirmed-logo');
    let reparse: JsonRow | null = null;
    if (tx.raw) {
      if (nonPostingReason(tx.raw) === 'security-challenge') omittedSecurityMessages++;
      else {
        // Original issuer is not retained by ordinary ledger rows. Report that
        // missing evidence rather than inventing a sender from the chosen bank.
        const p = session.parse(tx.raw, '', session.inspect(tx.raw, ''));
        reparse = p ? fields(p, 'kind type amountFils currency merchant categoryGuess categoryDeliberate transferHint date') : { outcome: 'not-parsed' };
        reparse.senderAvailable = false;
        if (!p) flags.push('current-parser-refuses-retained-text');
        if (p && (p.type !== tx.type || p.amountFils !== tx.amountFils || p.categoryGuess !== tx.category)) flags.push('current-parser-disagrees');
        if (p && p.merchant !== tx.title) flags.push('current-parser-name-differs');
        if (options.includeRetainedMessages) { row.raw = tx.raw; retainedMessages++; }
      }
    }
    for (const flag of flags) issues[flag] = (issues[flag] ?? 0) + 1;
    row.diagnostic = { countedInTotals: counted, flags, logo, reparse,
      userCorrectionProtected: tx.userEdited === true };
    transactions.push(row);
    const month = monthKey(tx.date);
    const totals = monthly.get(month) ?? { incomeMinor: 0, spendingMinor: 0, excluded: 0 };
    if (counted && Number.isSafeInteger(tx.amountFils)) {
      const field = isIncome(tx, live, internal) ? 'incomeMinor' : 'spendingMinor';
      totals[field] += tx.amountFils;
      if (!Number.isSafeInteger(totals[field])) throw new Error('diagnostic_money_overflow');
    } else totals.excluded++;
    monthly.set(month, totals);
    if (index % 64 === 63 || Date.now() - slice >= 8) {
      options.onProgress?.(index + 1, state.transactions.length);
      await diagnosticYield(); slice = Date.now();
    }
  }
  assertDiagnosticContinues(active);
  options.onProgress?.(state.transactions.length, state.transactions.length);
  return {
    schema: 'wafra-diagnostics-v1', exportedAt: new Date(now).toISOString(),
    build: { ...fields(build, 'version build platform'), parserVersion: PARSER_VERSION, storedParserVersion: state.parserVersion ?? null },
    delivery: { mode: 'manual', uploadedByWafra: false, destinationChosenByUser: true },
    notice: 'Sensitive financial data, not a restore backup. Includes all recorded periods and hidden accounts. No automatic corrections are made by this report.',
    coverage: { allRecordedTransactions: true, transactionCount: transactions.length,
      retainedMessagesIncluded: retainedMessages, securityMessagesOmitted: omittedSecurityMessages,
      originalMessagesNotRetained: state.transactions.filter(tx => !tx.raw).length,
      phoneInboxIncluded: false, deletedOrUnavailableMessagesRecoverable: false },
    preferences: fields(state, 'marketId language monthStartDay privateMode captureOptOut lastScanTs'),
    effectiveMonthStartDay: getMonthStartDay(),
    ledgerMoney: state.ledgerMoney ? fields(state.ledgerMoney, 'schemaVersion currency exponent') : null,
    historyImport: state.historyImport ? {
      ...fields(state.historyImport, 'status scanned found startedAt updatedAt error'),
      cursor: state.historyImport.cursor ? fields(state.historyImport.cursor, 'beforeDateMs beforeId') : null,
    } : null,
    accounts: state.accounts.map(account => fields(account, ACCOUNT_FIELDS)), transactions,
    budgets: state.budgets.map(row => fields(row, 'category limitFils')),
    bills: state.bills.map(row => ({ ...fields(row, 'id title category importIdentity amountFils dueDay yearlyOnISO accountId autoDetected'), paidMonths: row.paidMonths.filter(v => typeof v === 'string') })),
    cardDues: state.cardDues.map(row => fields(row, 'id accountId totalDueFils minDueFils minDueEstimated paidFils dueDate settledAt')),
    goals: state.goals.map(row => fields(row, 'id title emoji targetFils savedFils')),
    merchantOverrides: dictionary(state.merchantOverrides), accountHints: dictionary(state.accountHints),
    notSubscriptions: (state.notSubscriptions ?? []).filter(v => typeof v === 'string'),
    reviewTray: normalizeAlertReviewTray(state.reviewTray, now),
    reviewCoverage: 'Validated current review entries; expired or malformed entries excluded by the normal privacy retention policy.',
    merchants: [...merchantMap.values()].map(item => ({ ...item, categories: [...item.categories] })),
    monthlyTotals: [...monthly.entries()].map(([month, values]) => ({ month, ...values, netMinor: values.incomeMinor - values.spendingMinor })),
    issues,
  };
}

/** Bound serialization turns for large ledgers. The last join is unavoidable;
 * fail rather than claim a partial file when export size exceeds the limit. */
export async function serializeDiagnosticExport(report: Record<string, unknown>, active: () => boolean = () => true): Promise<string> {
  const parts: string[] = []; let length = 0;
  const encoder = new TextEncoder();
  const count = (text: string) => {
    length += encoder.encode(text).byteLength;
    if (length > 64 * 1024 * 1024) throw new Error('diagnostic_too_large');
  };
  for (const [key, value] of Object.entries(report)) {
    assertDiagnosticContinues(active);
    const encoded: string[] = [];
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        const item = JSON.stringify(value[index]);
        count(item + ',');
        encoded.push(item);
        if (index % 64 === 63) { await diagnosticYield(); assertDiagnosticContinues(active); }
      }
    }
    const prefix = JSON.stringify(key) + ':';
    count(prefix + '[],');
    const scalar = Array.isArray(value) ? null : JSON.stringify(value);
    if (scalar) count(scalar);
    parts.push(prefix + (Array.isArray(value) ? '[' + encoded.join(',') + ']' : scalar));
    await diagnosticYield();
  }
  assertDiagnosticContinues(active);
  return '{' + parts.join(',') + '}';
}

export type DiagnosticTransaction = Pick<Transaction, 'id' | 'type' | 'amountFils' | 'category' | 'accountId'>;
