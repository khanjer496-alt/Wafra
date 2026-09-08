import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { bankIdentityForName } from '@/lib/markets';
import { currencyMinorUnits } from '@/lib/currency-metadata';
import type { Account, Transaction } from '@/lib/types';
import type {
  TransferAssessment, TransferDecision, TransferDecisionRequest, TransferEvidence,
  TransferMatch, TransferReconciliationResult, TransferReviewGroup,
} from '@/lib/transfer-reconciliation-types';

export type {
  TransferAssessment, TransferDecision, TransferDecisionRequest, TransferEvidence,
  TransferMatch, TransferReconciliationResult, TransferReviewGroup,
} from '@/lib/transfer-reconciliation-types';

type TransferRow = Transaction & {
  transferEvidence?: TransferEvidence;
  transferDecision?: TransferDecision;
  transferMatch?: TransferMatch;
};
type Instrument = NonNullable<TransferEvidence['counterparty']>;
type Ownership = 'own' | 'external' | 'unknown' | null;
type Basis = TransferMatch['basis'];
const WINDOW_MS = 3 * 86_400_000;
// Evidence collisions must fail closed, without scanning a repeated-amount
// bucket quadratically. This bounds *work*, not an arbitrary winning subset.
const MAX_EVIDENCE_SCAN = 64;
const STRUCTURAL = /^(?:(?:outgoing|incoming|bank|own account|own|self|savings|telegraphic) transfer|(?:inward|outward) remittance)$/i;
const OWN_TITLE = /^(?:own(?: account)?|self|savings) transfer$/i;
const NON_TRANSFER_TITLE = /\b(?:salary|payroll|cash\s*back|cashback|refund|reversal|card repayment|credit card payment)\b/i;
const CARD_SETTLEMENT_TITLE = /(?:\bcard\b.*\b(?:payment|settlement)\b|\b(?:payment|settlement)\b.*\bcard\b)/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
const clock = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
const minor = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const currency = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z]{3}$/.test(value) && currencyMinorUnits(value) !== null;
const optional = (object: Record<string, unknown>, key: string, validate: (value: unknown) => boolean): boolean =>
  object[key] === undefined || validate(object[key]);

function isInstrument(value: unknown): value is Instrument {
  return record(value) && typeof value.last4 === 'string' && /^\d{4}$/.test(value.last4) &&
    typeof value.kind === 'string' && ['account', 'credit', 'debit', 'unknown'].includes(value.kind) &&
    optional(value, 'bankIdentity', bank => typeof bank === 'string' && bank.trim().length > 0 && bank.length <= 160);
}

/** Strict readers are also shared by backup validation; malformed metadata is never evidence. */
export function isTransferEvidence(value: unknown): value is TransferEvidence {
  return record(value) && value.version === 1 && currency(value.currency) &&
    (value.attribution === 'source' || value.attribution === 'fallback') &&
    optional(value, 'reference', ref => typeof ref === 'string' && ref.length <= 96) &&
    optional(value, 'counterparty', isInstrument) && optional(value, 'explicitOwn', own => own === true);
}

export function isTransferDecision(value: unknown): value is TransferDecision {
  return record(value) && value.version === 1 && (value.ownership === 'own' || value.ownership === 'external') &&
    clock(value.decidedAt) && optional(value, 'counterpartId', id) &&
    (value.ownership !== 'external' || value.counterpartId === undefined);
}

export function isTransferMatch(value: unknown): value is TransferMatch {
  const signature = (s: unknown) => typeof s === 'string' && /^tr1:[a-f0-9]{64}$/.test(s);
  return record(value) && value.version === 1 && id(value.counterpartId) &&
    typeof value.basis === 'string' && ['reference', 'reciprocal-instruments', 'user'].includes(value.basis) &&
    signature(value.signature) && signature(value.counterpartSignature);
}

const evidenceOf = (tx: TransferRow): TransferEvidence | undefined =>
  isTransferEvidence(tx.transferEvidence) ? tx.transferEvidence : undefined;
const decisionOf = (tx: TransferRow): TransferDecision | undefined =>
  isTransferDecision(tx.transferDecision) ? tx.transferDecision : undefined;
const manual = (tx: Transaction): boolean => tx.source !== 'sms' && !tx.smsKey;

export function isTransferCandidate(tx: Transaction): boolean {
  const row = tx as TransferRow;
  if ((tx.type !== 'income' && tx.type !== 'expense') || typeof tx.title !== 'string') return false;
  // The person's choice remains authoritative after a parser/category edit,
  // and must stay reachable so they can undo it from the same review surface.
  if (decisionOf(row)) return true;
  if (tx.cardPaymentSide !== undefined || tx.paymentFlowSide !== undefined ||
    tx.category === 'salary' || (tx.category === 'business' && !STRUCTURAL.test(tx.title.trim())) ||
    NON_TRANSFER_TITLE.test(tx.title) ||
    CARD_SETTLEMENT_TITLE.test(tx.title)) return false;
  if (manual(tx)) return tx.isTransfer === true || decisionOf(row) !== undefined;
  return evidenceOf(row) !== undefined || decisionOf(row) !== undefined || STRUCTURAL.test(tx.title.trim());
}

/** Row-local ownership only. Persisted links require the ledger-aware reconciler. */
export function transferOwnership(tx: Transaction): Ownership {
  if (!isTransferCandidate(tx)) return null;
  const decision = decisionOf(tx);
  if (decision) return decision.ownership;
  if ((manual(tx) && tx.isTransfer === true) || evidenceOf(tx)?.explicitOwn === true ||
    (tx.isTransfer === true && OWN_TITLE.test(tx.title.trim()))) return 'own';
  return 'unknown';
}

const hash = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)));
// Explicitly project scalars so malformed restored metadata (including cycles)
// cannot crash a fingerprint or smuggle untracked fields into the signature.
const scalar = (value: unknown): string | number | boolean | null =>
  typeof value === 'string' || typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) ? value : null;
const fields = (value: unknown, keys: string[]): unknown[] | null =>
  record(value) ? keys.map(key => scalar(value[key])) : null;

export function transferFingerprint(tx: Transaction): string {
  const row = tx as TransferRow;
  const ev = record(row.transferEvidence) ? row.transferEvidence : undefined;
  return `tr1:${hash(JSON.stringify([
    fields(tx, ['id', 'type', 'amountFils', 'originalAmountMinor', 'originalCurrency', 'fxSource', 'fxRate',
      'fxRateDate', 'category', 'accountId', 'title', 'note', 'date', 'ts', 'source', 'smsKey',
      'isTransfer', 'userEdited', 'titleEdited', 'cardPaymentSide', 'paymentFlowSide', 'cashOutAccountId',
      'cashOutDate', 'paymentInstrumentSource', 'billIdentity']),
    fields(tx.captureInstrument, ['last4', 'kind', 'bankIdentity']),
    fields(ev, ['version', 'currency', 'attribution', 'reference', 'explicitOwn']),
    fields(ev?.counterparty, ['last4', 'kind', 'bankIdentity']),
    fields(row.transferDecision, ['version', 'ownership', 'decidedAt', 'counterpartId']),
  ]))}`;
}

function normalizedReference(value: string | undefined): string | undefined {
  if (!value || !/^[A-Za-z0-9\s/-]+$/.test(value)) return undefined;
  const ref = value.replace(/[\s/-]/g, '').toUpperCase();
  if (ref.length < 8 || ref.length > 64 || !/\d/.test(ref) || /^(.{1,4})\1+$/.test(ref) ||
    /^(?:0+|X+|NA|NONE|NULL|UNKNOWN|NOTAVAILABLE|REFERENCE|TRANSFER|PAYMENT|REF\d{1,4})$/.test(ref) ||
    /^(?:0123456789|1234567890|12345678|87654321|9876543210)$/.test(ref)) return undefined;
  if (/^\d+$/.test(ref)) {
    // Common compact dates and timestamps are clocks, not transaction references.
    if (/^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:\d{6})?$/.test(ref) ||
      /^(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])(?:19|20)\d{2}$/.test(ref) ||
      /^(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:19|20)\d{2}$/.test(ref)) return undefined;
  }
  return ref;
}

function sourceTime(tx: Transaction): number | undefined {
  if (tx.ts !== undefined) return clock(tx.ts) ? tx.ts : undefined;
  const match = typeof tx.smsKey === 'string' ? /^s(\d{10,16})-/.exec(tx.smsKey) : null;
  const value = match ? Number(match[1]) : undefined;
  return clock(value) ? value : undefined;
}

function sourceMoney(tx: Transaction, evidence: TransferEvidence): string | undefined {
  if (!minor(tx.amountFils)) return undefined;
  if (tx.originalCurrency !== undefined || tx.originalAmountMinor !== undefined) {
    if (!currency(tx.originalCurrency) || !minor(tx.originalAmountMinor) || tx.originalCurrency !== evidence.currency) return undefined;
    return `${tx.originalCurrency}:${tx.originalAmountMinor}`;
  }
  if (tx.fxSource !== undefined || tx.fxRate !== undefined || tx.fxRateDate !== undefined) return undefined;
  return `${evidence.currency}:${tx.amountFils}`;
}

const eligibleAccount = (account: Account | undefined): account is Account => !!account &&
  (account.kind === 'bank' || (account.kind === 'card' && account.cardType === 'debit'));

interface Entry {
  tx: TransferRow;
  at: number;
  money: string;
  instrument: string;
  counterparty?: string;
  capture: Instrument;
  counterpartyHint?: Instrument;
  counterpartyBank?: string;
  bank: string;
  reference?: string;
  referenceUnique: boolean;
  referenceReused: boolean;
}

interface Context {
  rows: Map<string, TransferRow>;
  duplicateIds: Set<string>;
  accounts: Map<string, Account>;
  entries: Map<string, Entry>;
  fingerprints: Map<string, string>;
  instrumentKey: (value: unknown) => string | undefined;
}

function context(transactions: Transaction[], accounts: Account[]): Context {
  const bankCache = new Map<string, string | undefined>();
  const normalizeBank = (name: string): string | undefined => {
    if (!bankCache.has(name)) {
      const normalized = bankIdentityForName(name);
      bankCache.set(name, normalized && !/^(?:unknown|bank|unattributed|none|na|n a|unassigned)$/.test(normalized)
        ? normalized : undefined);
    }
    return bankCache.get(name);
  };
  const instrumentKey = (value: unknown): string | undefined => {
    if (!isInstrument(value) || value.kind === 'unknown' || value.kind === 'credit' || !value.bankIdentity) return undefined;
    const bank = normalizeBank(value.bankIdentity);
    return bank ? JSON.stringify([bank, value.kind, value.last4]) : undefined;
  };
  const accountById = new Map<string, Account>();
  const duplicateAccounts = new Set<string>();
  const accountKeys = new Map<string, string>();
  const identityCounts = new Map<string, number>();
  for (const account of accounts) {
    if (!id(account.id)) continue;
    if (accountById.has(account.id)) duplicateAccounts.add(account.id);
    accountById.set(account.id, account);
    if (!eligibleAccount(account)) continue;
    const key = instrumentKey({ last4: account.last4, kind: account.kind === 'bank' ? 'account' : 'debit', bankIdentity: account.bankName });
    if (!key) continue;
    accountKeys.set(account.id, key);
    identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  for (const duplicate of duplicateAccounts) accountById.delete(duplicate);
  const rows = new Map<string, TransferRow>();
  const duplicateIds = new Set<string>();
  for (const tx of transactions) {
    if (rows.has(tx.id)) duplicateIds.add(tx.id);
    rows.set(tx.id, tx);
  }
  const entries = new Map<string, Entry>();
  const fingerprints = new Map<string, string>();
  const referenceCounts = new Map<string, number>();
  for (const tx of rows.values()) {
    const evidence = evidenceOf(tx);
    // An observed reused reference stays reused when another row is reviewed
    // or reclassified. Count before semantic eligibility: later identifying a
    // salary or payment flow, or downgrading routing to fallback, does not
    // change the reference and issuer retained from the source alert.
    if (evidence && isInstrument(tx.captureInstrument) && tx.captureInstrument.bankIdentity) {
      const bank = normalizeBank(tx.captureInstrument.bankIdentity);
      const reference = normalizedReference(evidence.reference);
      if (bank && reference) {
        const scope = JSON.stringify([bank, reference]);
        referenceCounts.set(scope, (referenceCounts.get(scope) ?? 0) + 1);
      }
    }
    if (!isTransferCandidate(tx) || !id(tx.id)) continue;
    fingerprints.set(tx.id, transferFingerprint(tx));
    const own = transferOwnership(tx);
    const account = accountById.get(tx.accountId);
    if (duplicateIds.has(tx.id) || !evidence || evidence.attribution !== 'source' || own === 'external' ||
      (tx.userEdited && !decisionOf(tx)) || !eligibleAccount(account)) continue;
    const key = instrumentKey(tx.captureInstrument);
    if (!key || key !== accountKeys.get(tx.accountId) || identityCounts.get(key) !== 1) continue;
    const at = sourceTime(tx);
    const money = sourceMoney(tx, evidence);
    if (at === undefined || !money) continue;
    entries.set(tx.id, { tx, at, money, instrument: key,
      counterparty: instrumentKey(evidence.counterparty),
      capture: tx.captureInstrument!, counterpartyHint: evidence.counterparty,
      counterpartyBank: evidence.counterparty?.bankIdentity ? normalizeBank(evidence.counterparty.bankIdentity) : undefined,
      bank: normalizeBank(tx.captureInstrument!.bankIdentity!)!, reference: normalizedReference(evidence.reference),
      referenceUnique: false, referenceReused: false });
  }
  // Banks sometimes repeat an account or batch reference on many payments.
  // Check its entire issuer scope before partitioning by amount/date; otherwise
  // two unrelated 100 and 50 payments each appear falsely unique in a bucket.
  const referenceKey = (entry: Entry): string => JSON.stringify([entry.bank, entry.reference]);
  for (const entry of entries.values()) {
    if (!entry.reference) continue;
    const count = referenceCounts.get(referenceKey(entry))!;
    entry.referenceUnique = count === 2;
    entry.referenceReused = count > 2;
  }
  return { rows, duplicateIds, accounts: accountById, entries, fingerprints, instrumentKey };
}

function automaticBasis(a: Entry, b: Entry): Exclude<Basis, 'user'> | undefined {
  if (a.tx.type === b.tx.type || a.tx.accountId === b.tx.accountId || a.instrument === b.instrument ||
    a.money !== b.money || Math.abs(a.at - b.at) > WINDOW_MS) return undefined;
  if (a.bank === b.bank && a.reference && b.reference && a.reference !== b.reference) return undefined;
  // Counterparty evidence that explicitly contradicts a proposed partner wins
  // over a matching reference; a reference is not an excuse to ignore identity.
  const contradicts = (source: Entry, other: Entry): boolean => !!source.counterpartyHint && (
    source.counterpartyHint.last4 !== other.capture.last4 ||
    (source.counterpartyHint.kind !== 'unknown' && source.counterpartyHint.kind !== other.capture.kind) ||
    (source.counterpartyBank !== undefined && source.counterpartyBank !== other.bank));
  if (contradicts(a, b) || contradicts(b, a)) return undefined;
  if (a.referenceUnique && b.referenceUnique && a.bank === b.bank && a.reference && a.reference === b.reference) return 'reference';
  if (a.counterparty === b.instrument && b.counterparty === a.instrument) return 'reciprocal-instruments';
  return undefined;
}

function manualPair(a: TransferRow, b: TransferRow, ctx: Context): boolean {
  return a.id !== b.id && !ctx.duplicateIds.has(a.id) && !ctx.duplicateIds.has(b.id) &&
    isTransferCandidate(a) && isTransferCandidate(b) && a.type !== b.type && a.accountId !== b.accountId &&
    eligibleAccount(ctx.accounts.get(a.accountId)) && eligibleAccount(ctx.accounts.get(b.accountId)) &&
    minor(a.amountFils) && minor(b.amountFils);
}

function currentStoredPair(a: TransferRow, ctx: Context): boolean {
  const link = a.transferMatch;
  if (!isTransferMatch(link)) return false;
  const b = ctx.rows.get(link.counterpartId);
  const reverse = b?.transferMatch;
  if (!b || !isTransferMatch(reverse) || reverse.counterpartId !== a.id || reverse.basis !== link.basis ||
    link.signature !== ctx.fingerprints.get(a.id) || link.counterpartSignature !== ctx.fingerprints.get(b.id) ||
    reverse.signature !== ctx.fingerprints.get(b.id) || reverse.counterpartSignature !== ctx.fingerprints.get(a.id)) return false;
  if (link.basis === 'user') {
    const da = decisionOf(a); const db = decisionOf(b);
    return manualPair(a, b, ctx) && da?.ownership === 'own' && db?.ownership === 'own' &&
      da.counterpartId === b.id && db.counterpartId === a.id;
  }
  const ea = ctx.entries.get(a.id); const eb = ctx.entries.get(b.id);
  return !!ea && !!eb && automaticBasis(ea, eb) === link.basis;
}

const lowerBound = (entries: Entry[], at: number): number => {
  let low = 0; let high = entries.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (entries[middle].at < at) low = middle + 1; else high = middle;
  }
  return low;
};

function reconcile(ctx: Context): TransferReconciliationResult {
  const byId = new Map<string, TransferAssessment>();
  const internalIds = new Set<string>();
  const pendingIds = new Set<string>();
  const userLinked = new Set<string>();
  const stale = new Set<string>();
  for (const tx of ctx.rows.values()) {
    const ownership = transferOwnership(tx);
    if (ownership === null || !id(tx.id)) continue;
    if (ctx.duplicateIds.has(tx.id)) {
      byId.set(tx.id, { id: tx.id, status: 'ambiguous', reason: 'multiple-candidates', candidateIds: [] });
      pendingIds.add(tx.id);
      continue;
    }
    if (ownership === 'external') {
      byId.set(tx.id, { id: tx.id, status: 'confirmed-external', reason: 'user', candidateIds: [] });
      continue;
    }
    if (ownership === 'own') {
      internalIds.add(tx.id);
      byId.set(tx.id, { id: tx.id, status: 'counterpart-missing', reason: 'missing-counterpart', candidateIds: [] });
    } else {
      pendingIds.add(tx.id);
      byId.set(tx.id, { id: tx.id, status: 'ownership-unknown',
        reason: eligibleAccount(ctx.accounts.get(tx.accountId)) ? 'missing-evidence' : 'account-unresolved', candidateIds: [] });
    }
    if (tx.transferMatch !== undefined) {
      if (currentStoredPair(tx, ctx)) {
        if (tx.transferMatch.basis === 'user') {
          userLinked.add(tx.id);
          byId.set(tx.id, { id: tx.id, status: 'confirmed-own', reason: 'user',
            counterpartId: tx.transferMatch.counterpartId, candidateIds: [] });
        }
      } else {
        stale.add(tx.id);
        if (isTransferMatch(tx.transferMatch)) stale.add(tx.transferMatch.counterpartId);
      }
    }
  }
  const indexes = new Map<string, Entry[]>();
  const keys = (entry: Entry, opposite = false): string[] => {
    const direction = opposite ? (entry.tx.type === 'income' ? 'expense' : 'income') : entry.tx.type;
    const result: string[] = [];
    if (entry.referenceUnique && entry.reference) result.push(JSON.stringify(['ref', entry.bank, entry.money, entry.reference, direction]));
    if (entry.counterparty) result.push(JSON.stringify(['instruments', entry.money,
      ...[entry.instrument, entry.counterparty].sort(), direction]));
    return result;
  };
  for (const entry of ctx.entries.values()) {
    if (stale.has(entry.tx.id) || userLinked.has(entry.tx.id)) continue;
    for (const key of keys(entry)) {
      const bucket = indexes.get(key);
      if (bucket) bucket.push(entry); else indexes.set(key, [entry]);
    }
  }
  for (const bucket of indexes.values()) bucket.sort((a, b) => a.at - b.at || a.tx.id.localeCompare(b.tx.id));
  const candidates = new Map<string, Map<string, Exclude<Basis, 'user'>>>();
  const overflow = new Set<string>();
  for (const entry of ctx.entries.values()) {
    if (stale.has(entry.tx.id) || userLinked.has(entry.tx.id)) continue;
    const possible = new Map<string, Exclude<Basis, 'user'>>();
    for (const key of keys(entry, true)) {
      const bucket = indexes.get(key);
      if (!bucket) continue;
      const start = lowerBound(bucket, entry.at - WINDOW_MS);
      let scanned = 0;
      for (let i = start; i < bucket.length && bucket[i].at <= entry.at + WINDOW_MS; i += 1) {
        if (++scanned > MAX_EVIDENCE_SCAN) { overflow.add(entry.tx.id); break; }
        const candidate = bucket[i];
        const basis = automaticBasis(entry, candidate);
        if (basis) possible.set(candidate.tx.id, basis);
      }
    }
    candidates.set(entry.tx.id, possible);
  }
  for (const [txId, possible] of candidates) {
    const own = internalIds.has(txId);
    const ids = [...possible.keys()].sort();
    const only = ids.length === 1 ? ids[0] : undefined;
    const reverse = only ? candidates.get(only) : undefined;
    if (!overflow.has(txId) && only && reverse?.size === 1 && reverse.has(txId) && !overflow.has(only)) {
      internalIds.add(txId); pendingIds.delete(txId);
      byId.set(txId, { id: txId, status: 'confirmed-own', reason: possible.get(only)!,
        counterpartId: only, candidateIds: [] });
    } else if (!own && (ids.length > 0 || overflow.has(txId) || ctx.entries.get(txId)?.referenceReused)) {
      byId.set(txId, { id: txId, status: 'ambiguous', reason: 'multiple-candidates', candidateIds: ids });
    }
  }
  const groups = new Map<string, TransferReviewGroup>();
  for (const txId of pendingIds) {
    const tx = ctx.rows.get(txId)!;
    const assessment = byId.get(txId)!;
    const ev = evidenceOf(tx);
    const cp = ev?.counterparty;
    const strong = ev?.attribution === 'source' ? ctx.instrumentKey(cp) : undefined;
    const key = JSON.stringify([tx.accountId, tx.type, assessment.status, assessment.reason, strong ?? null]);
    const existing = groups.get(key);
    if (existing) existing.transactionIds.push(txId);
    else groups.set(key, { id: `transfer-group:${hash(key)}`, transactionIds: [txId], accountId: tx.accountId,
      direction: tx.type, status: assessment.status, ...(strong && cp ? { counterparty: { ...cp } } : {}),
      bulkEligible: strong !== undefined && assessment.status !== 'ambiguous' });
  }
  const orderedGroups = [...groups.values()];
  for (const group of orderedGroups) group.transactionIds.sort();
  orderedGroups.sort((a, b) => a.id.localeCompare(b.id));
  return { byId, internalIds, pendingIds, groups: orderedGroups };
}

// Store arrays are immutable snapshots. Retain only their last paired result;
// replacing transactions OR accounts (including restore/erase) invalidates it.
let previous: { transactions: Transaction[]; accounts: Account[]; result: TransferReconciliationResult } | undefined;
function memoizedReconcile(transactions: Transaction[], accounts: Account[], ctx?: Context): TransferReconciliationResult {
  if (previous?.transactions === transactions && previous.accounts === accounts) return previous.result;
  const result = reconcile(ctx ?? context(transactions, accounts));
  previous = { transactions, accounts, result };
  return result;
}

export function reconcileTransfers(transactions: Transaction[], accounts: Account[]): TransferReconciliationResult {
  return memoizedReconcile(transactions, accounts);
}

/** Never changes amounts, routing, type, IDs or legacy transfer flags. */
export function normalizeTransferLinks(transactions: Transaction[], accounts: Account[]): Transaction[] {
  const ctx = context(transactions, accounts);
  const result = memoizedReconcile(transactions, accounts, ctx);
  let changed = false;
  const next = transactions.map((transaction): Transaction => {
    const tx = transaction as TransferRow;
    const assessment = result.byId.get(tx.id);
    const counterpart = assessment?.counterpartId ? ctx.rows.get(assessment.counterpartId) : undefined;
    const decision = decisionOf(tx);
    let nextDecision = decision;
    if (decision?.counterpartId && (!counterpart || assessment?.reason !== 'user')) {
      const { counterpartId: _removed, ...unlinked } = decision;
      nextDecision = unlinked;
    }
    let match: TransferMatch | undefined;
    if (counterpart && assessment?.status === 'confirmed-own' &&
      (assessment.reason === 'user' || assessment.reason === 'reference' || assessment.reason === 'reciprocal-instruments')) {
      match = { version: 1, counterpartId: counterpart.id, basis: assessment.reason,
        signature: ctx.fingerprints.get(tx.id)!, counterpartSignature: ctx.fingerprints.get(counterpart.id)! };
    }
    const sameDecision = nextDecision === tx.transferDecision || (isTransferDecision(tx.transferDecision) && !!nextDecision &&
      nextDecision.ownership === tx.transferDecision.ownership && nextDecision.decidedAt === tx.transferDecision.decidedAt &&
      nextDecision.counterpartId === tx.transferDecision.counterpartId);
    const sameMatch = match === tx.transferMatch || (isTransferMatch(tx.transferMatch) && !!match &&
      match.counterpartId === tx.transferMatch.counterpartId && match.basis === tx.transferMatch.basis &&
      match.signature === tx.transferMatch.signature && match.counterpartSignature === tx.transferMatch.counterpartSignature);
    if (sameDecision && sameMatch) return transaction;
    changed = true;
    const { transferMatch: _oldMatch, transferDecision: _oldDecision, ...kept } = tx;
    return { ...kept, ...(nextDecision ? { transferDecision: nextDecision } : {}), ...(match ? { transferMatch: match } : {}) };
  });
  return changed ? next : transactions;
}

/** Validate the complete request first; either every requested decision applies or none do. */
export function applyTransferDecision(
  transactions: Transaction[], accounts: Account[], request: TransferDecisionRequest,
): Transaction[] {
  if (!record(request) || !Array.isArray(request.ids) || request.ids.length === 0 ||
    request.ids.some(value => !id(value)) || new Set(request.ids).size !== request.ids.length ||
    !['own', 'external', null].includes(request.ownership) || !clock(request.now) || !record(request.expectedFingerprints) ||
    (request.counterpartId !== undefined && (!id(request.counterpartId) || request.ownership !== 'own' || request.ids.length !== 1))) {
    throw new Error('Invalid transfer decision');
  }
  const ctx = context(transactions, accounts);
  const targets = new Set(request.ids);
  if (request.counterpartId) targets.add(request.counterpartId);
  for (const target of targets) {
    const tx = ctx.rows.get(target);
    if (!tx || ctx.duplicateIds.has(target) || !isTransferCandidate(tx) ||
      request.expectedFingerprints[target] !== transferFingerprint(tx)) throw new Error('Transfer review changed; open it again');
  }
  const assessment = reconcile(ctx);
  if (request.ids.length > 1) {
    // The visible group is not an authorization boundary: enforce the same
    // current, sourced counterparty identity when the atomic write is applied.
    // Build one set rather than repeatedly scanning a large group's rows.
    const group = assessment.groups.find(candidate => candidate.bulkEligible &&
      candidate.transactionIds.some(target => targets.has(target)));
    const members = new Set(group?.transactionIds ?? []);
    if (request.ids.some(target => !members.has(target))) {
      throw new Error('Bulk transfer review requires one current known-counterparty group');
    }
  }
  if (request.counterpartId) {
    const a = ctx.rows.get(request.ids[0])!; const b = ctx.rows.get(request.counterpartId)!;
    if (!manualPair(a, b, ctx)) throw new Error('These entries cannot be linked as a transfer');
    for (const [tx, other] of [[a, b], [b, a]]) {
      const existingPartner = assessment.byId.get(tx.id)?.counterpartId ?? decisionOf(tx)?.counterpartId;
      if ((existingPartner && existingPartner !== other.id) || transferOwnership(tx) === 'external') {
        throw new Error('Resolve the existing transfer decision before linking another entry');
      }
    }
  }
  // Preserve decisions on the other side, but detach all links affected by this
  // change in the same returned snapshot. No partner can be silently stolen.
  const detached = transactions.map((transaction): TransferRow => {
    const tx = transaction as TransferRow;
    const decision = decisionOf(tx);
    const touches = targets.has(tx.id) || (isTransferMatch(tx.transferMatch) && targets.has(tx.transferMatch.counterpartId)) ||
      (decision?.counterpartId !== undefined && targets.has(decision.counterpartId));
    if (!touches) return tx;
    const { transferMatch: _match, transferDecision: _decision, ...kept } = tx;
    let nextDecision: TransferDecision | undefined;
    if (targets.has(tx.id)) {
      if (request.ownership !== null) nextDecision = { version: 1, ownership: request.ownership, decidedAt: request.now,
        ...(request.counterpartId ? { counterpartId: tx.id === request.ids[0] ? request.counterpartId : request.ids[0] } : {}) };
    } else if (decision) {
      const { counterpartId: _partner, ...ownDecision } = decision;
      nextDecision = ownDecision;
    }
    return { ...kept, ...(nextDecision ? { transferDecision: nextDecision } : {}) };
  });
  if (request.counterpartId) {
    const rows = new Map(detached.map(tx => [tx.id, tx]));
    const a = rows.get(request.ids[0])!; const b = rows.get(request.counterpartId)!;
    const aSignature = transferFingerprint(a); const bSignature = transferFingerprint(b);
    a.transferMatch = { version: 1, counterpartId: b.id, basis: 'user', signature: aSignature, counterpartSignature: bSignature };
    b.transferMatch = { version: 1, counterpartId: a.id, basis: 'user', signature: bSignature, counterpartSignature: aSignature };
    return detached;
  }
  // Deliberately do not immediately re-pair an undone link. The next assessment
  // may still explain independent evidence, while the user's decision is gone.
  return detached;
}
