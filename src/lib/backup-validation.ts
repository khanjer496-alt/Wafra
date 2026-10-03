import type { AppState, Transaction } from '@/lib/types';
import { isSpending } from '@/lib/ledger';
import { isTransferEvidence, isTransferDecision, isTransferMatch } from '@/lib/transfer-reconciliation';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import { isScopedSubscriptionKey } from '@/lib/subscriptions';
import { isCustomCategoryId } from '@/lib/categories';
import { categoryAssignmentAllowed, isValidCustomCategoryCatalog } from '@/lib/custom-categories';

const categoryIds = new Set([
  'groceries', 'dining', 'transport', 'cash-withdrawal', 'utilities', 'telecom',
  'rent', 'shopping', 'health', 'personal-care', 'home-services', 'education',
  'travel', 'entertainment', 'software', 'investing', 'charity', 'government',
  'loan', 'salary', 'business', 'other',
]);
// The five GoalId values in types.ts, spelled out like the category ids above
// so this validator stays dependency-light; pattern.test.cjs pins the match.
export const BACKUP_GOAL_IDS: readonly string[] = ['salary', 'bills', 'subscriptions', 'spend-less', 'cash-cards'];
type RecordValue = Record<string, unknown>;
type Check = (value: unknown) => boolean;
const record = (value: unknown): value is RecordValue =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text: Check = (value) => typeof value === 'string';
const id: Check = (value) => typeof value === 'string' && value.trim().length > 0;
const boolean: Check = (value) => typeof value === 'boolean';
const integer: Check = (value) => Number.isSafeInteger(value);
const nonnegative: Check = (value) => integer(value) && (value as number) >= 0;
const positive: Check = (value) => integer(value) && (value as number) > 0;
const finitePositive: Check = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const category: Check = (value) => typeof value === 'string' && (categoryIds.has(value) || isCustomCategoryId(value));
const ledgerCurrency: Check = (value) => typeof value === 'string' &&
  value === value.trim().toUpperCase() && ledgerMoneySpec(value) !== null;
const oneOf = (...values: unknown[]): Check => (value) => values.includes(value);
const optional = (row: RecordValue, checks: Record<string, Check>): boolean =>
  Object.entries(checks).every(([key, check]) => row[key] === undefined || check(row[key]));
const required = (row: RecordValue, checks: Record<string, Check>): boolean =>
  Object.entries(checks).every(([key, check]) => check(row[key]));
const isoDate: Check = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
// `payCardDue` records the moment a statement was marked paid
// (`new Date().toISOString()`); readers use only its date part. Older builds and
// the seed write the bare date, so both shapes restore.
const isoTimestamp: Check = (value) => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  isoDate(value.slice(0, 10)) && Number.isFinite(new Date(value).getTime());
const isoDateOrTimestamp: Check = (value) => isoDate(value) || isoTimestamp(value);
const month: Check = (value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const arrayOf = (check: Check): Check => (value) => Array.isArray(value) && value.every(check);
const uniqueRows = (value: unknown, check: Check): boolean => {
  if (!Array.isArray(value) || !value.every(check)) return false;
  const ids = value.map((row) => (row as RecordValue).id);
  return new Set(ids).size === ids.length;
};
const account: Check = (value) => record(value) && required(value, {
  id, name: text, kind: oneOf('bank', 'card', 'cash'), openingFils: integer, color: text,
}) && optional(value, {
  last4: text, bankName: text, cardType: oneOf('credit', 'debit'), snapshotFils: integer,
  snapshotKind: oneOf('balance', 'limit', 'outstanding'), creditLimitFils: nonnegative,
  snapshotTs: nonnegative, manualSnapshotTs: nonnegative, archived: boolean, renewedFrom: id,
});
const captureInstrument: Check = (value) => record(value) && required(value, {
  last4: (tail) => typeof tail === 'string' && /^\d{4}$/.test(tail),
  kind: oneOf('credit', 'debit', 'account', 'unknown'),
}) && optional(value, { bankIdentity: id });
// Code-owned identifiers only (e.g. `universal:purchase:debit`), never text.
const bestEffortMarker: Check = (value) => record(value) &&
  Object.keys(value).every((key) => key === 'v' || key === 'format' || key === 'market') &&
  required(value, {
    v: oneOf(1),
    format: (v) => typeof v === 'string' && /^(?:universal|semantic|ai):[a-z-]{1,32}:(?:debit|credit)$/.test(v),
    market: (v) => typeof v === 'string' && /^[A-Z]{2}$/.test(v),
  });
const bestEffortUndoKey: Check = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256;
const billPayment: Check = (value) => record(value) &&
  Object.keys(value).every((key) => key === 'billId' || key === 'month') &&
  required(value, { billId: id, month });
const statementOccurrences: Check = (value) => Array.isArray(value) && value.length <= 64 &&
  value.every((claim) => record(claim) && Object.keys(claim).every((key) => ['importId', 'rowIndex', 'date', 'amountFils', 'type', 'title'].includes(key)) &&
    typeof claim.importId === 'string' && /^[a-f0-9]{32}$/.test(claim.importId) &&
    integer(claim.rowIndex) && (claim.rowIndex as number) >= 0 && (claim.rowIndex as number) < 200 &&
    ((claim.date === undefined && claim.amountFils === undefined && claim.type === undefined && claim.title === undefined) ||
      (isoDate(claim.date) && positive(claim.amountFils) && oneOf('income', 'expense')(claim.type) &&
        (claim.title === undefined || (typeof claim.title === 'string' && claim.title.trim().length > 0 && claim.title.length <= 180))))) &&
  new Set(value.map((claim) => `${claim.importId}:${claim.rowIndex}`)).size === value.length;
const transaction: Check = (value) => {
  if (!record(value) || !required(value, {
    id, type: oneOf('expense', 'income'), amountFils: positive, category,
    accountId: id, title: text, date: isoDate,
  }) || !optional(value, {
    originalAmountMinor: positive, originalCurrency: (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v),
    originalMinorUnits: positive, originalExponent: oneOf(0, 2, 3),
    fxRate: finitePositive, fxRateDate: isoDate, fxSource: oneOf('bank', 'reference', 'fallback'),
    note: text, ts: nonnegative, textClock: nonnegative, source: oneOf('sms', 'manual'), smsKey: text,
    notificationObservationId: (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    messageObservationId: (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    captureEventIdentity: (v) => typeof v === 'string' && /^e1:[0-9a-f]{16}:(?:[0-9a-f]{16}|-)$/.test(v),
    viaPush: boolean, walletBound: oneOf(true), captureInstrument, cardPaymentSide: oneOf('debit', 'receipt'),
    statementImportId: (v) => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v),
    statementRowIndex: (v) => integer(v) && (v as number) >= 0 && (v as number) < 200,
    statementOccurrences,
    statementBank: (v) => typeof v === 'string' && v.length <= 240 && /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u.test(v),
    bestEffort: bestEffortMarker,
    transferEvidence: isTransferEvidence, transferDecision: isTransferDecision, transferMatch: isTransferMatch,
    paymentFlowSide: oneOf('funding', 'receipt'), billIdentity: text, billPayment,
    paymentInstrumentSource: oneOf('alert', 'user'), cashOutDate: isoDate,
    cashOutAccountId: id, isTransfer: boolean, userEdited: boolean, titleEdited: boolean, raw: text,
  })) return false;
  if (value.statementRowIndex !== undefined && (value.statementImportId === undefined ||
    (value.captureSource !== 'pdf' && value.captureSource !== 'csv'))) return false;
  if (value.statementBank !== undefined &&
    (value.captureSource !== 'pdf' && value.captureSource !== 'csv')) return false;
  if (value.billPayment !== undefined &&
    (value.source !== 'manual' || !isSpending(value as unknown as Transaction))) return false;
  // Exponent-correct originals travel as a pair and must agree with the
  // legacy two-decimal figure when both are present.
  if ((value.originalMinorUnits === undefined) !== (value.originalExponent === undefined)) return false;
  if (value.originalMinorUnits !== undefined && value.originalAmountMinor !== undefined &&
    (value.originalMinorUnits as number) * 100 !==
      (value.originalAmountMinor as number) * 10 ** (value.originalExponent as number)) return false;
  if (value.splits !== undefined) {
    if (!Array.isArray(value.splits) || value.splits.length < 2) return false;
    let sum = 0;
    for (const split of value.splits) {
      if (!record(split) || !required(split, { category, amountFils: positive }) ||
        !optional(split, { note: text })) return false;
      sum += split.amountFils as number;
      if (!Number.isSafeInteger(sum)) return false;
    }
    if (sum !== value.amountFils) return false;
  }
  return true;
};
const bill: Check = (value) => record(value) && required(value, {
  id, title: text, category, amountFils: nonnegative,
  dueDay: (v) => integer(v) && (v as number) >= 1 && (v as number) <= 31,
  paidMonths: arrayOf(month),
}) && optional(value, {
  importIdentity: text, yearlyOnISO: isoDate, statedDueDate: isoDate, noticeObservedAt: nonnegative,
  accountId: id, autoDetected: boolean,
}) && (value.statedDueDate === undefined ||
  (value.autoDetected === true && Number((value.statedDueDate as string).slice(8)) === value.dueDay));
const billAlias: Check = (value) => record(value) &&
  required(value, { title: text, category }) &&
  (value.title as string).trim().length >= 2;
const due: Check = (value) => record(value) && required(value, {
  id, accountId: id, totalDueFils: nonnegative, minDueFils: nonnegative,
  paidFils: nonnegative, dueDate: isoDate,
}) && optional(value, { minDueEstimated: boolean, settledAt: isoDateOrTimestamp, settledByTransactionId: id });
const statementCoverageEntry: Check = (value) => record(value) && required(value, {
  id, sourceKey: id, label: text, startDate: isoDate, endDate: isoDate, importedAt: nonnegative,
  format: oneOf('pdf', 'csv'),
}) && (value.startDate as string) <= (value.endDate as string);
const goal: Check = (value) => record(value) && required(value, {
  id, title: text, emoji: text, targetFils: positive, savedFils: nonnegative,
});
const onboardingProfile: Check = (value) => record(value) && required(value, {
  v: oneOf(1),
  stage: oneOf('welcome', 'focus', 'tracking', 'alerts', 'intention', 'preview', 'privacy', 'capture', 'complete'),
  focus: oneOf(null, 'spending', 'bills', 'cashflow', 'overview'),
  tracking: oneOf(null, 'none', 'bank-apps', 'spreadsheet', 'finance-app'),
  startedAt: nonnegative,
}) && optional(value, {
  intention: oneOf(null, 'control', 'spend-intentionally', 'stay-ahead', 'build-buffer'),
  alerts: oneOf(null, 'sms', 'notifications', 'neither', 'unsure'),
  // Any well-formed region code, not just the ones this build can illustrate:
  // a ledger written by a newer build that knows more countries must still
  // restore, and an unknown code already falls back to neutral bank glyphs.
  country: (value) => value === null || (typeof value === 'string' && /^[A-Z]{2}$/.test(value)),
  statementStepDone: boolean,
});
const dictionary = (check: Check): Check => (value) => record(value) &&
  Object.entries(value).every(([key, item]) =>
    !['__proto__', 'prototype', 'constructor'].includes(key) && check(item));

const subscriptionCancellations: Check = value => record(value) &&
  Object.entries(value).every(([key, item]) =>
    !['__proto__', 'prototype', 'constructor'].includes(key) &&
    (isoDate(item) || (item === null && isScopedSubscriptionKey(key))));

/** Validate external state before any migration changes process-wide preferences.
 * Missing collections remain compatible with old backups. Dangling account IDs
 * remain valid: deleting/merging legacy accounts can leave historical references.
 */
export function isValidBackupState(value: unknown): value is Partial<Omit<AppState, 'hydrated'>> {
  if (!record(value) || !uniqueRows(value.transactions, transaction)) return false;
  const catalog = value.customCategories ?? [];
  if (!isValidCustomCategoryCatalog(catalog)) return false;
  // Existing builtin refund classifications remain compatible. Every custom
  // reference must be registered and agree with the owning money direction.
  const reference = (id: unknown, type: unknown): boolean =>
    typeof id !== 'string' || !id.startsWith('custom:') || categoryAssignmentAllowed(id, type, catalog);
  for (const row of value.transactions as RecordValue[]) {
    if (!reference(row.category, row.type)) return false;
    for (const split of (row.splits ?? []) as RecordValue[]) if (!reference(split.category, row.type)) return false;
  }
  for (const group of ['bills', 'budgets'] as const) {
    if (!Array.isArray(value[group])) continue;
    for (const row of value[group] as RecordValue[]) if (record(row) && !reference(row.category, 'expense')) return false;
  }
  if (record(value.merchantOverrides)) for (const [key, id] of Object.entries(value.merchantOverrides)) {
    const type = key.startsWith('income:') || (typeof id === 'string' && id.startsWith('custom:income:') && !key.startsWith('expense:'))
      ? 'income' : 'expense';
    if (!reference(id, type)) return false;
  }
  if (record(value.billAliases)) for (const alias of Object.values(value.billAliases)) {
    if (record(alias) && !reference(alias.category, 'expense')) return false;
  }
  if (record(value.reviewTray) && Array.isArray(value.reviewTray.templateRules)) {
    for (const rule of value.reviewTray.templateRules) if (record(rule) && !reference(rule.category, rule.type)) return false;
  }

  for (const [key, check] of Object.entries({ accounts: account, bills: bill, cardDues: due, goals: goal })) {
    if (value[key] !== undefined && !uniqueRows(value[key], check)) return false;
  }
  const billsById = new Map(((value.bills ?? []) as RecordValue[]).map((row) => [row.id, row]));
  const transactionsById = new Map((value.transactions as RecordValue[]).map(row => [row.id, row]));
  for (const statement of (value.cardDues ?? []) as RecordValue[]) {
    if (statement.settledByTransactionId === undefined) continue;
    const receipt = transactionsById.get(statement.settledByTransactionId);
    if (!statement.settledAt || !receipt || receipt.source !== 'manual' ||
        receipt.type !== 'income' || receipt.isTransfer !== true || receipt.accountId !== statement.accountId) return false;
  }
  const billClaims = new Set<string>();
  for (const row of value.transactions as RecordValue[]) {
    if (row.billPayment === undefined) continue;
    const link = row.billPayment as RecordValue;
    const linkedBill = billsById.get(link.billId);
    const key = JSON.stringify([link.billId, link.month]);
    if (!linkedBill || !(linkedBill.paidMonths as unknown[]).includes(link.month) || billClaims.has(key)) return false;
    billClaims.add(key);
  }
  if (value.budgets !== undefined) {
    if (!arrayOf((v) => record(v) && required(v, { category, limitFils: positive }))(value.budgets)) return false;
    const categories = (value.budgets as RecordValue[]).map((v) => v.category);
    if (new Set(categories).size !== categories.length) return false;
  }
  return optional(value, {
    merchantOverrides: dictionary(category), billAliases: dictionary(billAlias), accountHints: dictionary(id),
    statementCoverage: arrayOf(statementCoverageEntry),
    trustedNotificationPackages: arrayOf((v) => typeof v === 'string' && v.length <= 255 &&
      /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(v)),
    notSubscriptions: arrayOf(text), cancelledSubscriptions: subscriptionCancellations,
    lastScanTs: nonnegative, parserVersion: nonnegative,
    recentRereadParserVersion: nonnegative,
    hydrationFinalizeVersion: nonnegative, bnplCategoryRepairVersion: nonnegative,
    transferNormalizationVersion: nonnegative, transferInternalIds: arrayOf(id),
    onboarded: boolean, userName: text, appLock: boolean, pro: boolean, founderPro: boolean,
    privateMode: boolean, captureOptOut: boolean, dailySummary: boolean, trialStartTs: nonnegative,
    bestEffortAutoPost: boolean,
    // What the person asked Wafra to do: short code ids, never text or money.
    // Ids a newer build added are accepted here and dropped by the restore's
    // sanitizer, so a newer backup still restores on this build.
    wafraGoals: (v) => Array.isArray(v) && v.length <= 16 &&
      v.every((goal) => typeof goal === 'string' && /^[a-z][a-z-]{0,31}$/.test(goal)),
    bestEffortUndone: (v) => Array.isArray(v) && v.length <= 2000 && v.every(bestEffortUndoKey),
    androidCaptureSources: (v) => record(v) && required(v, { sms: boolean, notifications: boolean }),
    monthStartDay: (v) => integer(v) && (v as number) >= 1 && (v as number) <= 28,
    marketId: text, country: (v) => v === '' || (typeof v === 'string' && /^[A-Z]{2}$/.test(v)), language: oneOf('en', 'ar', ''), languagePreference: oneOf('system', 'en', 'ar'),
    knownBanks: arrayOf(text),
    themePreference: oneOf('system', 'light', 'dark'),
    onboardingCurrencyEvidence: (v) => v === null || ledgerCurrency(v),
    onboardingProfile: (v) => v === null || onboardingProfile(v),
    onboardingPlan: (v) => v === null || (record(v) && required(v, {
      goalIds: arrayOf(oneOf('emergency', 'travel', 'home')),
      budgetId: oneOf('essentials', 'balanced', 'flexible'),
    })),
  });
}
