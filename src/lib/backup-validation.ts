import type { AppState } from '@/lib/types';
import { isTransferEvidence, isTransferDecision, isTransferMatch } from '@/lib/transfer-reconciliation';
import { ledgerMoneySpec } from '@/lib/ledger-money';

const categoryIds = new Set([
  'groceries', 'dining', 'transport', 'cash-withdrawal', 'utilities', 'telecom',
  'rent', 'shopping', 'health', 'personal-care', 'home-services', 'education',
  'travel', 'entertainment', 'software', 'investing', 'charity', 'government',
  'loan', 'salary', 'business', 'other',
]);
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
const category: Check = (value) => typeof value === 'string' && categoryIds.has(value);
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
  snapshotTs: nonnegative, archived: boolean, renewedFrom: id,
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
    format: (v) => typeof v === 'string' && /^(?:universal|semantic):[a-z-]{1,32}:(?:debit|credit)$/.test(v),
    market: (v) => typeof v === 'string' && /^[A-Z]{2}$/.test(v),
  });
const bestEffortUndoKey: Check = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256;
const transaction: Check = (value) => {
  if (!record(value) || !required(value, {
    id, type: oneOf('expense', 'income'), amountFils: positive, category,
    accountId: id, title: text, date: isoDate,
  }) || !optional(value, {
    originalAmountMinor: positive, originalCurrency: (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v),
    originalMinorUnits: positive, originalExponent: oneOf(0, 2, 3),
    fxRate: finitePositive, fxRateDate: isoDate, fxSource: oneOf('bank', 'reference', 'fallback'),
    note: text, ts: nonnegative, source: oneOf('sms', 'manual'), smsKey: text,
    notificationObservationId: (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    messageObservationId: (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    viaPush: boolean, walletBound: oneOf(true), captureInstrument, cardPaymentSide: oneOf('debit', 'receipt'),
    statementImportId: (v) => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v),
    bestEffort: bestEffortMarker,
    transferEvidence: isTransferEvidence, transferDecision: isTransferDecision, transferMatch: isTransferMatch,
    paymentFlowSide: oneOf('funding', 'receipt'), billIdentity: text,
    paymentInstrumentSource: oneOf('alert', 'user'), cashOutDate: isoDate,
    cashOutAccountId: id, isTransfer: boolean, userEdited: boolean, titleEdited: boolean, raw: text,
  })) return false;
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
  importIdentity: text, yearlyOnISO: isoDate, accountId: id, autoDetected: boolean,
});
const billAlias: Check = (value) => record(value) &&
  required(value, { title: text, category }) &&
  (value.title as string).trim().length >= 2;
const due: Check = (value) => record(value) && required(value, {
  id, accountId: id, totalDueFils: nonnegative, minDueFils: nonnegative,
  paidFils: nonnegative, dueDate: isoDate,
}) && optional(value, { minDueEstimated: boolean, settledAt: isoDate });
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

/** Validate external state before any migration changes process-wide preferences.
 * Missing collections remain compatible with old backups. Dangling account IDs
 * remain valid: deleting/merging legacy accounts can leave historical references.
 */
export function isValidBackupState(value: unknown): value is Partial<Omit<AppState, 'hydrated'>> {
  if (!record(value) || !uniqueRows(value.transactions, transaction)) return false;
  for (const [key, check] of Object.entries({ accounts: account, bills: bill, cardDues: due, goals: goal })) {
    if (value[key] !== undefined && !uniqueRows(value[key], check)) return false;
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
    notSubscriptions: arrayOf(text), lastScanTs: nonnegative, parserVersion: nonnegative,
    hydrationFinalizeVersion: nonnegative,
    transferNormalizationVersion: nonnegative, transferInternalIds: arrayOf(id),
    onboarded: boolean, userName: text, appLock: boolean, pro: boolean, founderPro: boolean,
    privateMode: boolean, captureOptOut: boolean, dailySummary: boolean, trialStartTs: nonnegative,
    bestEffortAutoPost: boolean,
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
