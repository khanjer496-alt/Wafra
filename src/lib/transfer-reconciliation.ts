import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { bankIdentityForName, ledgerCurrencyCode } from '@/lib/markets';
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
    optional(value, 'counterparty', isInstrument) && optional(value, 'explicitOwn', own => own === true) &&
    optional(value, 'explicitExternal', external => external === true) && !(value.explicitOwn && value.explicitExternal) &&
    optional(value, 'sourceBank', bank => typeof bank === 'string' && bank.length > 0 && bank.length <= 160) &&
    optional(value, 'sourceAccountKey', key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)) &&
    optional(value, 'sourceKindAmbiguous', flag => flag === true) &&
    optional(value, 'counterpartyName', name => typeof name === 'string' && name.trim() === name &&
      name.length >= 2 && name.length <= 80 && /^[\p{L}\p{M} .'&-]+$/u.test(name)) &&
    optional(value, 'endpointProof', proof => proof === 'explicit-transfer') &&
    optional(value, 'postingForm', form => typeof form === 'string' && ['transfer-detail', 'remittance-debit', 'credit-receipt'].includes(form));
}

export function isTransferDecision(value: unknown): value is TransferDecision {
  return record(value) && value.version === 1 && (value.ownership === 'own' || value.ownership === 'external') &&
    clock(value.decidedAt) && optional(value, 'counterpartId', id) &&
    (value.ownership !== 'external' || value.counterpartId === undefined);
}

export function isTransferMatch(value: unknown): value is TransferMatch {
  const signature = (s: unknown) => typeof s === 'string' && /^tr1:[a-f0-9]{64}$/.test(s);
  return record(value) && value.version === 1 && id(value.counterpartId) &&
    typeof value.basis === 'string' && ['reference', 'reciprocal-instruments', 'destination-and-receipt', 'user'].includes(value.basis) &&
    signature(value.signature) && signature(value.counterpartSignature);
}

const evidenceOf = (tx: TransferRow): TransferEvidence | undefined =>
  isTransferEvidence(tx.transferEvidence) ? tx.transferEvidence : undefined;
const decisionOf = (tx: TransferRow): TransferDecision | undefined =>
  isTransferDecision(tx.transferDecision) ? tx.transferDecision : undefined;
const manual = (tx: Transaction): boolean => tx.source !== 'sms' && !tx.smsKey;

/** A holding reference is deliberately NOT an account and proves no ownership. */
export function unassignedTransferAccountId(evidence: TransferEvidence): string {
  const bank = (evidence.sourceBank ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'unknown';
  const key = evidence.sourceAccountKey && /^[a-f0-9]{64}$/.test(evidence.sourceAccountKey) ? evidence.sourceAccountKey : 'unknown';
  return `__unassigned-transfer__:${bank}:${key}`;
}
export const isUnassignedTransferAccount = (accountId: string): boolean =>
  /^__unassigned-transfer__:[a-z0-9-]{1,80}:(?:[a-f0-9]{64}|unknown)$/.test(accountId);

/** Compatibility predicate for persisted masked-source buckets. A hashed
 * bucket remains identifiable for migrations/UI, but no longer proves that it
 * should participate in cash-flow or account routing. */
export const isObservedUnassignedTransferAccount = (accountId: string): boolean =>
  /^__unassigned-transfer__:[a-z0-9-]{1,80}:[a-f0-9]{64}$/.test(accountId);

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
  if (evidenceOf(tx)?.explicitExternal === true) return 'external';
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
    fields(ev, ['version', 'currency', 'attribution', 'reference', 'explicitOwn', 'explicitExternal',
      'sourceBank', 'sourceAccountKey', 'counterpartyName', 'endpointProof', 'postingForm']),
    fields(ev?.counterparty, ['last4', 'kind', 'bankIdentity']),
    fields(row.transferDecision, ['version', 'ownership', 'decidedAt', 'counterpartId']),
    ...(ev?.sourceKindAmbiguous !== undefined ? [fields(ev, ['sourceKindAmbiguous'])] : []),
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
  corroboratingOf: Map<string, string>;
  knownCounterparties: Map<string, Account>;
}

/** Ownership and pairing are different questions. A completed transfer naming
 * an instrument independently observed in other bank SMS does not need a
 * same-amount receipt to establish ownership. Never learn from beneficiary
 * mentions, editable Wallet metadata alone, or our own inferred links. */
function knownTransferCounterparties(
  rows: Map<string, TransferRow>, duplicateIds: Set<string>, accounts: Account[],
  entries: Map<string, Entry>,
): Map<string, Account> {
  const bankCache = new Map<string, string | undefined>();
  const bankKey = (name: string | undefined): string | undefined => {
    if (!name) return undefined;
    if (!bankCache.has(name)) {
      const bank = bankIdentityForName(name);
      bankCache.set(name, bank && !/^(?:unknown|bank|unattributed|none|na|n a|unassigned)$/.test(bank) ? bank : undefined);
    }
    return bankCache.get(name);
  };
  const keyOf = (instrument: Instrument): string | undefined => {
    const bank = bankKey(instrument.bankIdentity);
    return bank && /^\d{4}$/.test(instrument.last4) ? JSON.stringify([bank, instrument.last4]) : undefined;
  };
  const kindOf = (account: Account): Instrument['kind'] => account.kind === 'bank' ? 'account' :
    account.kind === 'card' ? account.cardType ?? 'unknown' : 'unknown';
  // Count all account IDs and candidate identities before checking observations:
  // a duplicate without activity is still a collision, not a reason to pick one.
  const idCounts = new Map<string, number>();
  const byId = new Map<string, Account>();
  const byEndpoint = new Map<string, Account[]>();
  for (const account of accounts) {
    idCounts.set(account.id, (idCounts.get(account.id) ?? 0) + 1);
    byId.set(account.id, account);
    if (account.kind !== 'bank' && account.kind !== 'card') continue;
    const key = keyOf({ last4: account.last4 ?? '', kind: kindOf(account), bankIdentity: account.bankName });
    if (!key) continue;
    const bucket = byEndpoint.get(key) ?? [];
    bucket.push(account); byEndpoint.set(key, bucket);
  }
  // Two distinct source identities suffice to answer "an SMS other than this
  // one" without retaining a second full index of the user's financial history.
  const observations = new Map<string, Set<string>>();
  const sourceOf = (tx: Transaction): string | undefined =>
    typeof tx.smsKey === 'string' && tx.smsKey.length > 0 ? tx.smsKey :
      sourceTime(tx) === undefined ? undefined : `clock:${sourceTime(tx)}`;
  for (const tx of rows.values()) {
    const account = byId.get(tx.accountId), capture = tx.captureInstrument;
    const evidence = evidenceOf(tx), source = sourceOf(tx);
    if (duplicateIds.has(tx.id) || tx.userEdited || manual(tx) || !source || !account ||
        idCounts.get(account.id) !== 1 || !capture || !isInstrument(capture) ||
        capture.kind === 'unknown' || capture.kind !== kindOf(account) ||
        // A bank-side payment can name somebody else's beneficiary card. Only
        // card activity or its own receipt independently establishes ownership.
        (capture.kind === 'credit' && (tx.isTransfer || tx.cardPaymentSide !== undefined) &&
          (tx.cardPaymentSide !== 'receipt' || tx.type !== 'income')) ||
        capture.last4 !== account.last4 || !bankKey(capture.bankIdentity) ||
        bankKey(capture.bankIdentity) !== bankKey(account.bankName) ||
        (tx.transferEvidence !== undefined && !evidence) ||
        (evidence && (evidence.attribution !== 'source' ||
          (evidence.sourceBank && bankKey(evidence.sourceBank) !== bankKey(capture.bankIdentity)))) ||
        !minor(tx.amountFils)) continue;
    const sources = observations.get(account.id) ?? new Set<string>();
    if (sources.size < 2) sources.add(source);
    observations.set(account.id, sources);
  }
  const result = new Map<string, Account>();
  for (const entry of entries.values()) {
    const tx = entry.tx, evidence = evidenceOf(tx), cp = evidence?.counterparty;
    if (tx.userEdited || decisionOf(tx) || !cp || evidence?.endpointProof !== 'explicit-transfer' ||
        evidence.explicitExternal || !evidence.sourceBank || bankKey(evidence.sourceBank) !== entry.bank) continue;
    // Missing issuer information cannot be supplied by a globally unique tail:
    // a recipient at a different bank can have the same last four digits.
    const key = keyOf(cp);
    if (!key) continue;
    const candidates = (byEndpoint.get(key) ?? []).filter(account =>
      cp.kind === 'unknown' || kindOf(account) === 'unknown' || kindOf(account) === cp.kind);
    if (candidates.length !== 1) continue;
    const target = candidates[0];
    if (idCounts.get(target.id) !== 1 || target.id === tx.accountId || kindOf(target) === 'unknown' ||
        ![...(observations.get(target.id) ?? [])].some(source => source !== sourceOf(tx))) continue;
    // A bank debit going TO a known credit card is a repayment. A bank credit
    // coming FROM that card can be a cash advance; never call it repayment.
    if (kindOf(target) === 'credit' && tx.type !== 'expense') continue;
    result.set(tx.id, target);
  }
  return result;
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
  // Resolve an ambiguous "account/card" source kind only when a different
  // independently captured bank-account posting establishes that identity.
  const observedBankAccounts = new Set<string>();
  for (const tx of rows.values()) {
    if (duplicateIds.has(tx.id) || tx.userEdited || (tx.source !== 'sms' && !tx.smsKey)) continue;
    const account = accountById.get(tx.accountId);
    const capture = tx.captureInstrument;
    const key = instrumentKey(capture);
    if (account?.kind === 'bank' && capture?.kind === 'account' && key === accountKeys.get(account.id)) {
      observedBankAccounts.add(key!);
    }
  }
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
    const account = accountById.get(tx.accountId);
    if (duplicateIds.has(tx.id) || !evidence || evidence.attribution !== 'source' ||
      (tx.userEdited && !decisionOf(tx)) || !eligibleAccount(account)) continue;
    const capture = tx.captureInstrument?.kind === 'unknown' && account?.kind === 'bank' &&
      evidence.sourceBank && bankIdentityForName(evidence.sourceBank) === bankIdentityForName(account.bankName) &&
      observedBankAccounts.has(accountKeys.get(account.id) ?? '')
      ? { ...tx.captureInstrument, kind: 'account' as const } : tx.captureInstrument;
    const key = instrumentKey(capture);
    if (!key || key !== accountKeys.get(tx.accountId) || identityCounts.get(key) !== 1) continue;
    const at = sourceTime(tx);
    const money = sourceMoney(tx, evidence);
    if (at === undefined || !money) continue;
    entries.set(tx.id, { tx, at, money, instrument: key,
      counterparty: instrumentKey(evidence.counterparty),
      capture: capture!, counterpartyHint: evidence.counterparty,
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
  const corroboratingOf = complementaryPostingPairs(entries);
  // External user choices may still have a companion bank confirmation, but
  // must never participate in automatic own-account matching.
  for (const [id, entry] of entries) if (transferOwnership(entry.tx) === 'external') entries.delete(id);
  const knownCounterparties = knownTransferCounterparties(rows, duplicateIds, accounts, entries);
  return { rows, duplicateIds, accounts: accountById, entries, fingerprints, instrumentKey, corroboratingOf, knownCounterparties };
}

/** Two narrowly identified issuer formats, not two arbitrary equal payments.
 * Keep both records and derive the secondary role again after every edit. */
function complementaryPostingPairs(entries: Map<string, Entry>): Map<string, string> {
  const buckets = new Map<string, Entry[]>();
  for (const entry of entries.values()) {
    if (entry.bank !== 'fab' || entry.tx.type !== 'expense' || entry.tx.userEdited) continue;
    const form = evidenceOf(entry.tx)?.postingForm;
    if (form !== 'transfer-detail' && form !== 'remittance-debit') continue;
    if (form === 'remittance-debit' && entry.tx.transferDecision) continue;
    const key = JSON.stringify([entry.instrument, entry.tx.accountId, entry.money]);
    const bucket = buckets.get(key) ?? []; bucket.push(entry); buckets.set(key, bucket);
  }
  const result = new Map<string, string>();
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.at - b.at);
    const matches = new Map<string, string[]>();
    for (const entry of bucket) {
      const candidates: string[] = [];
      let scanned = 0;
      for (let i = lowerBound(bucket, entry.at - 90_000); i < bucket.length && bucket[i].at <= entry.at + 90_000; i++) {
        if (++scanned > MAX_EVIDENCE_SCAN) { candidates.length = 0; break; }
        const other = bucket[i];
        if (entry.tx.id === other.tx.id || entry.tx.smsKey === other.tx.smsKey ||
            evidenceOf(entry.tx)?.postingForm === evidenceOf(other.tx)?.postingForm ||
            (entry.reference && other.reference && entry.reference !== other.reference)) continue;
        candidates.push(other.tx.id);
      }
      matches.set(entry.tx.id, candidates);
    }
    for (const entry of bucket) {
      if (evidenceOf(entry.tx)?.postingForm !== 'remittance-debit') continue;
      const candidates = matches.get(entry.tx.id)!;
      if (candidates.length === 1 && matches.get(candidates[0])?.length === 1) result.set(entry.tx.id, candidates[0]);
    }
  }
  return result;
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
  const outgoing = a.tx.type === 'expense' ? a : b;
  const incoming = a.tx.type === 'income' ? a : b;
  if (evidenceOf(outgoing.tx)?.endpointProof === 'explicit-transfer' &&
      outgoing.counterparty === incoming.instrument && incoming.capture.kind === 'account' &&
      evidenceOf(incoming.tx)?.postingForm === 'credit-receipt') return 'destination-and-receipt';
  return undefined;
}

function manualPair(a: TransferRow, b: TransferRow, ctx: Context): boolean {
  const identifiable = (tx: TransferRow) => eligibleAccount(ctx.accounts.get(tx.accountId)) ||
    (isUnassignedTransferAccount(tx.accountId) && !!evidenceOf(tx)?.sourceBank);
  return a.id !== b.id && !ctx.duplicateIds.has(a.id) && !ctx.duplicateIds.has(b.id) &&
    isTransferCandidate(a) && isTransferCandidate(b) && a.type !== b.type && a.accountId !== b.accountId &&
    identifiable(a) && identifiable(b) &&
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

const lowerBound = (entries: readonly { at: number }[], at: number): number => {
  let low = 0; let high = entries.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (entries[middle].at < at) low = middle + 1; else high = middle;
  }
  return low;
};

interface ObservedRow { tx: Transaction; at: number; money: string; bank: string; credit: boolean }
interface OwnedTransferObservation extends ObservedRow {
  identity: string;
  /**
   * Most bank alerts repeat the source account/card instrument explicitly.
   * Some otherwise-strong transfer formats (notably a Liv outgoing transfer
   * paired with a FAB inward remittance) do not. Keep that distinction so the
   * relaxed path below can demand much tighter semantic/time evidence without
   * weakening ordinary transfer matching.
   */
  sourceInstrumentObserved: boolean;
  structuralRole?: 'outgoing' | 'incoming';
}

function observedReceipt(tx: Transaction, ctx: Context): ObservedRow | undefined {
  const account = ctx.accounts.get(tx.accountId);
  const capture = tx.captureInstrument;
  if (ctx.duplicateIds.has(tx.id) || tx.userEdited || tx.transferDecision ||
      (tx.source !== 'sms' && !tx.smsKey) || tx.type !== 'income' || tx.cardPaymentSide !== 'receipt' ||
      account?.kind !== 'card' || account.cardType !== 'credit' || capture?.kind !== 'credit' ||
      capture.last4 !== account.last4 || !capture.bankIdentity || !account.bankName ||
      bankIdentityForName(capture.bankIdentity) !== bankIdentityForName(account.bankName)) return;
  const at = sourceTime(tx);
  const money = sourceMoney(tx, { version: 1, currency: ledgerCurrencyCode(), attribution: 'source' });
  if (at === undefined || !money) return;
  return { tx, at, money, bank: bankIdentityForName(capture.bankIdentity)!, credit: true };
}

/** Enumerate all candidates in a bounded time/money bucket, never pick the
 * nearest greedily. Overflow is ambiguous on BOTH sides of a proposed pair. */
function uniqueObservedPairs(
  rows: ObservedRow[], windowMs: number, accepts: (a: ObservedRow, b: ObservedRow) => boolean,
): Map<string, string> {
  const buckets = new Map<string, ObservedRow[]>();
  for (const row of rows) { const bucket = buckets.get(row.money) ?? []; bucket.push(row); buckets.set(row.money, bucket); }
  const partners = new Map<string, string[]>();
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.at - b.at);
    let left = 0;
    for (const row of bucket) {
      while (left < bucket.length && bucket[left].at < row.at - windowMs) left++;
      const ids: string[] = [];
      let scanned = 0;
      for (let i = left; i < bucket.length && bucket[i].at <= row.at + windowMs; i++) {
        if (++scanned > MAX_EVIDENCE_SCAN) { ids.length = 0; break; }
        const other = bucket[i];
        if (row.tx.id !== other.tx.id && accepts(row, other)) ids.push(other.tx.id);
      }
      partners.set(row.tx.id, ids);
    }
  }
  const pairs = new Map<string, string>();
  for (const [id, candidates] of partners) {
    if (candidates.length === 1 && partners.get(candidates[0])?.length === 1 && partners.get(candidates[0])![0] === id)
      pairs.set(id, candidates[0]);
  }
  return pairs;
}

function observedCardRepayments(ctx: Context, pending: Set<string>, secondary: Set<string>): Map<string, string> {
  const rows: ObservedRow[] = [];
  const receipts: ObservedRow[] = [];
  for (const entry of ctx.entries.values()) {
    if (!pending.has(entry.tx.id) || secondary.has(entry.tx.id) || entry.tx.type !== 'expense' ||
        entry.tx.transferDecision || entry.tx.userEdited || evidenceOf(entry.tx)?.endpointProof !== 'explicit-transfer') continue;
    rows.push({ tx: entry.tx, at: entry.at, money: entry.money, bank: entry.bank, credit: false });
  }
  for (const tx of ctx.rows.values()) {
    const receipt = observedReceipt(tx, ctx);
    if (receipt) { rows.push(receipt); receipts.push(receipt); }
  }
  const pairs = uniqueObservedPairs(rows, 86_400_000, (a, b) => {
    const debit = a.credit ? b : a, receipt = a.credit ? a : b;
    if (a.credit === b.credit || debit.tx.type !== 'expense' || debit.tx.accountId === receipt.tx.accountId) return false;
    const cp = evidenceOf(debit.tx)?.counterparty;
    return !!cp && (cp.kind === 'unknown' || cp.kind === 'credit') && cp.last4 === receipt.tx.captureInstrument?.last4 &&
      (!cp.bankIdentity || bankIdentityForName(cp.bankIdentity) === receipt.bank);
  });
  const confirmed = new Map([...pairs].filter(([id]) => ctx.rows.get(id)?.type === 'expense'));

  // Some banks (notably Liv) report an outward transfer without exposing the
  // beneficiary/card identity. If an independently identified OWNED credit
  // card reports an explicit repayment receipt for the exact amount within a
  // few minutes, that receipt supplies the missing endpoint evidence. Keep
  // this deliberately narrow: no named/partial counterparty, different banks,
  // one unique debit, one unique receipt, and a five-minute window.
  const implicitRows: ObservedRow[] = [...receipts];
  for (const tx of ctx.rows.values()) {
    if (!pending.has(tx.id) || secondary.has(tx.id) || confirmed.has(tx.id) || tx.type !== 'expense' ||
        tx.transferDecision || tx.userEdited || (tx.source !== 'sms' && !tx.smsKey)) continue;
    const ev = evidenceOf(tx);
    if (!ev?.sourceBank || ev.explicitExternal || ev.counterparty !== undefined || ev.counterpartyName !== undefined) continue;
    const at = sourceTime(tx), money = sourceMoney(tx, ev), bank = bankIdentityForName(ev.sourceBank);
    if (at === undefined || !money || !bank) continue;
    implicitRows.push({ tx, at, money, bank, credit: false });
  }
  const implicitPairs = uniqueObservedPairs(implicitRows, 5 * 60_000, (a, b) => {
    const debit = a.credit ? b : a, receipt = a.credit ? a : b;
    return a.credit !== b.credit && debit.tx.type === 'expense' &&
      debit.tx.accountId !== receipt.tx.accountId && debit.bank !== receipt.bank;
  });
  for (const [id, counterpartId] of implicitPairs) {
    if (ctx.rows.get(id)?.type === 'expense' && !confirmed.has(id)) confirmed.set(id, counterpartId);
  }
  return confirmed;
}

/**
 * A source-account observation that is strong enough to say "this is one of
 * the user's accounts", even when the bank never exposes four trailing
 * digits. The masked-account id is bank-scoped and SHA-256 derived by
 * transfer-evidence.ts; it is not a beneficiary or a guessed Wallet account.
 */
function ownedTransferObservation(tx: TransferRow, ctx: Context): OwnedTransferObservation | undefined {
  if (ctx.duplicateIds.has(tx.id) || tx.userEdited || tx.transferDecision ||
      (tx.source !== 'sms' && !tx.smsKey)) return;
  const ev = evidenceOf(tx);
  if (!ev?.sourceBank || ev.explicitExternal || ev.counterpartyName) return;
  const at = sourceTime(tx), money = sourceMoney(tx, ev), bank = bankIdentityForName(ev.sourceBank);
  if (at === undefined || !money || !bank) return;
  const structuralRole: OwnedTransferObservation['structuralRole'] =
    tx.type === 'expense' && /^(?:outgoing transfer|outward remittance|telegraphic transfer)$/i.test(tx.title.trim())
      ? 'outgoing'
      : tx.type === 'income' && /^(?:incoming transfer|inward remittance)$/i.test(tx.title.trim())
        ? 'incoming'
        : undefined;

  if (isUnassignedTransferAccount(tx.accountId)) {
    if (!ev.sourceAccountKey || !/^[a-f0-9]{64}$/.test(ev.sourceAccountKey)) return;
    return { tx, at, money, bank, credit: false, identity: `mask:${bank}:${ev.sourceAccountKey}`,
      sourceInstrumentObserved: true, ...(structuralRole ? { structuralRole } : {}) };
  }

  const account = ctx.accounts.get(tx.accountId);
  const capture = tx.captureInstrument;
  if (!eligibleAccount(account) || !account.bankName) return;
  const accountBank = bankIdentityForName(account.bankName);
  if (!accountBank || accountBank !== bank) return;

  if (isInstrument(capture) && capture.kind !== 'credit' && capture.bankIdentity &&
      capture.last4 === account.last4 && bankIdentityForName(capture.bankIdentity) === bank) {
    return { tx, at, money, bank, credit: false, identity: `account:${account.id}`,
      sourceInstrumentObserved: true, ...(structuralRole ? { structuralRole } : {}) };
  }

  // Some banks omit the source account digits from a completed transfer SMS.
  // Account routing + issuer identity alone is not enough for a generic credit
  // or debit. Admit only exact structural transfer/remittance language here;
  // the pair matcher below then requires the complementary role and a <=90s
  // clock match before it can become automatic ownership evidence.
  if (account.kind !== 'bank' || !structuralRole) return;
  return { tx, at, money, bank, credit: false, identity: `account:${account.id}`,
    sourceInstrumentObserved: false, structuralRole };
}

/**
 * Two independently observed owned source accounts, opposite directions,
 * exact money, and mutually unique clocks within five minutes are sufficient
 * to derive an internal move. This is deliberately narrower than the review
 * suggestion path: named recipients are excluded, same-account observations
 * are excluded, and any explicit endpoint contradiction wins.
 *
 * This closes the common masked-account pattern where Liv says only
 * "your account 095XXX11XXX01" and FAB separately reports the matching inward
 * remittance. Neither alert alone proves the destination's ownership; together
 * they do without forcing the user through hundreds of review rows.
 */
function observedOwnedTransferPairs(
  ctx: Context,
  pending: Set<string>,
  secondary: Set<string>,
  cardPairs: Map<string, string>,
): Map<string, string> {
  const pairedReceipts = new Set(cardPairs.values());
  const rows: OwnedTransferObservation[] = [];
  for (const tx of ctx.rows.values()) {
    if (!pending.has(tx.id) || secondary.has(tx.id) || cardPairs.has(tx.id) || pairedReceipts.has(tx.id)) continue;
    const observed = ownedTransferObservation(tx, ctx);
    if (observed) rows.push(observed);
  }
  return uniqueObservedPairs(rows, 5 * 60_000, (a, b) => {
    const left = a as OwnedTransferObservation, right = b as OwnedTransferObservation;
    if (left.tx.type === right.tx.type || left.identity === right.identity) return false;
    if (!left.sourceInstrumentObserved || !right.sourceInstrumentObserved) {
      if (left.structuralRole === undefined || right.structuralRole === undefined ||
          left.structuralRole === right.structuralRole || Math.abs(left.at - right.at) > 90_000) return false;
    }
    const contradicts = (source: OwnedTransferObservation, target: OwnedTransferObservation): boolean => {
      const cp = evidenceOf(source.tx)?.counterparty;
      const targetCapture = target.tx.captureInstrument;
      if (!cp) return false;
      if (cp.bankIdentity !== undefined && bankIdentityForName(cp.bankIdentity) !== target.bank) return true;
      if (targetCapture !== undefined && cp.last4 !== targetCapture.last4) return true;
      if (cp.kind === 'credit') return true;
      return false;
    };
    return !contradicts(left, right) && !contradicts(right, left);
  });
}

function suggestObservedPairs(ctx: Context, pending: Set<string>, internal: Set<string>, secondary: Set<string>,
  cardPairs: Map<string, string>, byId: Map<string, TransferAssessment>): void {
  const pairedReceipts = new Set(cardPairs.values());
  const rows: ObservedRow[] = [];
  for (const tx of ctx.rows.values()) {
    if (ctx.duplicateIds.has(tx.id) || tx.userEdited || tx.transferDecision || secondary.has(tx.id) ||
        internal.has(tx.id) || pairedReceipts.has(tx.id) || cardPairs.has(tx.id)) continue;
    const receipt = observedReceipt(tx, ctx);
    if (receipt) { rows.push(receipt); continue; }
    const ev = evidenceOf(tx);
    if (!pending.has(tx.id) || !ev?.sourceBank || ev.explicitExternal || (tx.source !== 'sms' && !tx.smsKey)) continue;
    const at = sourceTime(tx), money = sourceMoney(tx, ev), bank = bankIdentityForName(ev.sourceBank);
    if (at === undefined || !money || !bank) continue;
    // Known bank provenance is not account ownership. This branch produces a
    // suggestion only, including masked/unassigned source accounts.
    rows.push({ tx, at, money, bank, credit: false });
  }
  const pairs = uniqueObservedPairs(rows, 86_400_000, (a, b) => {
    if (a.tx.type === b.tx.type || a.tx.accountId === b.tx.accountId || a.bank === b.bank || (a.credit && b.credit)) return false;
    const contradicts = (source: ObservedRow, target: ObservedRow): boolean => {
      const cp = evidenceOf(source.tx)?.counterparty;
      return !!cp && ((cp.bankIdentity !== undefined && bankIdentityForName(cp.bankIdentity) !== target.bank) ||
        (target.tx.captureInstrument !== undefined && cp.last4 !== target.tx.captureInstrument.last4) ||
        (cp.kind === 'credit' && !target.credit) || (cp.kind === 'account' && target.credit));
    };
    return !contradicts(a, b) && !contradicts(b, a);
  });
  const observed = new Map(rows.map(row => [row.tx.id, row]));
  for (const [id, otherId] of pairs) {
    if (!pending.has(id) || byId.get(id)?.status === 'ambiguous') continue;
    const row = observed.get(id)!, other = observed.get(otherId)!;
    const maxDelay = evidenceOf(row.tx)?.counterpartyName || evidenceOf(other.tx)?.counterpartyName ? 90 * 60_000 : 30 * 60_000;
    if (Math.abs(row.at - other.at) > maxDelay) continue;
    byId.set(id, { id, status: other.credit ? 'likely-card-repayment' : 'likely-own',
      reason: 'amount-time', counterpartId: otherId, candidateIds: [otherId] });
  }
}

function reconcile(ctx: Context): TransferReconciliationResult {
  const byId = new Map<string, TransferAssessment>();
  const internalIds = new Set<string>();
  // All unresolved candidates are assessed for automatic evidence, but only
  // rows with a credible own-account possibility are put in the user's review
  // queue. A generic bank transfer with no link to another owned account is a
  // cash-flow movement, not 1 of thousands of meaningless review chores.
  const unresolvedIds = new Set<string>();
  const pendingIds = new Set<string>();
  const userLinked = new Set<string>();
  const stale = new Set<string>();
  const corroboratingOf = ctx.corroboratingOf;
  const corroboratingIds = new Set(corroboratingOf.keys());
  const knownCardRepayments = new Map<string, string>();
  for (const tx of ctx.rows.values()) {
    const ownership = transferOwnership(tx);
    if (ownership === null || !id(tx.id)) continue;
    if (corroboratingIds.has(tx.id)) {
      byId.set(tx.id, { id: tx.id, status: 'corroborating-alert', reason: 'bank-confirmation',
        counterpartId: corroboratingOf.get(tx.id), candidateIds: [] });
      continue;
    }
    if (ctx.duplicateIds.has(tx.id)) {
      byId.set(tx.id, { id: tx.id, status: 'ambiguous', reason: 'multiple-candidates', candidateIds: [] });
      pendingIds.add(tx.id);
      continue;
    }
    if (ownership === 'external') {
      byId.set(tx.id, { id: tx.id, status: 'confirmed-external', reason: decisionOf(tx) ? 'user' : 'explicit-external', candidateIds: [] });
      continue;
    }
    const known = ctx.knownCounterparties.get(tx.id);
    if (known?.kind === 'card' && known.cardType === 'credit') {
      knownCardRepayments.set(tx.id, known.id);
      byId.set(tx.id, { id: tx.id, status: 'card-repayment', reason: 'known-card',
        counterpartyAccountId: known.id, candidateIds: [] });
    } else if (known) {
      internalIds.add(tx.id);
      byId.set(tx.id, { id: tx.id, status: 'confirmed-own', reason: 'known-account',
        counterpartyAccountId: known.id, candidateIds: [] });
    } else if (ownership === 'own') {
      internalIds.add(tx.id);
      byId.set(tx.id, { id: tx.id, status: 'counterpart-missing', reason: 'missing-counterpart', candidateIds: [] });
    } else {
      unresolvedIds.add(tx.id);
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

  // If one bank alert already states that a movement is between the user's own
  // accounts, use that as the ownership proof for a unique matching opposite
  // posting on another independently known account. This is much stronger than
  // guessing from amount/time alone: one side is already explicit-own, both
  // accounts are in the user's ledger, the amount/currency signature matches,
  // and the timestamps must be within five minutes. Ambiguity leaves every row
  // untouched and reviewable by stronger evidence later.
  {
    const ownRows: TransferRow[] = [];
    const unresolvedRows: TransferRow[] = [];
    const movementTime = (tx: Transaction): number | undefined => {
      const exact = sourceTime(tx);
      if (exact !== undefined) return exact;
      const day = typeof tx.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tx.date)
        ? Date.parse(`${tx.date}T12:00:00Z`) : NaN;
      return Number.isFinite(day) ? day : undefined;
    };
    const moneyKey = (tx: Transaction) => JSON.stringify([
      tx.amountFils,
      tx.originalCurrency ?? null,
      tx.originalAmountMinor ?? null,
    ]);
    for (const tx of ctx.rows.values()) {
      if (!minor(tx.amountFils) || movementTime(tx) === undefined ||
          !eligibleAccount(ctx.accounts.get(tx.accountId))) continue;
      // Only row-local explicit ownership may seed this automatic absorption.
      // A user-linked own transfer already has an authoritative counterpart and
      // must never be reused to "prove" a third row just because amount/time
      // happen to match.
      const rowLocalOwn = !decisionOf(tx) && (
        evidenceOf(tx)?.explicitOwn === true ||
        (manual(tx) && tx.isTransfer === true) ||
        (tx.isTransfer === true && OWN_TITLE.test(tx.title.trim()))
      );
      if (internalIds.has(tx.id) && rowLocalOwn && !isTransferMatch(tx.transferMatch)) ownRows.push(tx);
      else if (unresolvedIds.has(tx.id)) unresolvedRows.push(tx);
    }
    interface AbsorptionBucket {
      timed: { tx: TransferRow; at: number }[];
      byDate: Map<string, TransferRow[]>;
      untimedByDate: Map<string, TransferRow[]>;
    }
    const unresolvedBuckets = new Map<string, AbsorptionBucket>();
    for (const tx of unresolvedRows) {
      const key = JSON.stringify([moneyKey(tx), tx.type]);
      const bucket: AbsorptionBucket = unresolvedBuckets.get(key) ?? {
        timed: [], byDate: new Map(), untimedByDate: new Map(),
      };
      const sameDate = bucket.byDate.get(tx.date) ?? [];
      sameDate.push(tx); bucket.byDate.set(tx.date, sameDate);
      const exact = sourceTime(tx);
      if (exact !== undefined) bucket.timed.push({ tx, at: exact });
      else {
        const untimed = bucket.untimedByDate.get(tx.date) ?? [];
        untimed.push(tx); bucket.untimedByDate.set(tx.date, untimed);
      }
      unresolvedBuckets.set(key, bucket);
    }
    for (const bucket of unresolvedBuckets.values()) bucket.timed.sort((a, b) => a.at - b.at);
    const possible = new Map<string, string[]>();
    const reverseCount = new Map<string, number>();
    for (const own of ownRows) {
      const opposite = own.type === 'income' ? 'expense' : 'income';
      const bucket = unresolvedBuckets.get(JSON.stringify([moneyKey(own), opposite]));
      const exact = sourceTime(own);
      let candidates: TransferRow[] = [];
      // Index the same eligibility rule instead of scanning all historical
      // repeats of this amount. Two exact clocks use the five-minute window,
      // even across posting dates. If either clock is missing, require the
      // original equal-date fallback. Include every candidate in both cases:
      // mutual uniqueness below must still see all collisions.
      if (bucket && exact === undefined) candidates = bucket.byDate.get(own.date) ?? [];
      else if (bucket && exact !== undefined) {
        candidates = [...bucket.untimedByDate.get(own.date) ?? []];
        const first = lowerBound(bucket.timed, exact - 5 * 60_000);
        for (let index = first; index < bucket.timed.length && bucket.timed[index].at <= exact + 5 * 60_000; index++) {
          candidates.push(bucket.timed[index].tx);
        }
      }
      candidates = candidates.filter(other => other.accountId !== own.accountId);
      possible.set(own.id, candidates.map(row => row.id));
      for (const candidate of candidates) reverseCount.set(candidate.id, (reverseCount.get(candidate.id) ?? 0) + 1);
    }
    for (const own of ownRows) {
      const candidates = possible.get(own.id) ?? [];
      if (candidates.length !== 1 || reverseCount.get(candidates[0]) !== 1) continue;
      const counterpartId = candidates[0];
      const counterpart = ctx.rows.get(counterpartId);
      if (!counterpart) continue;
      internalIds.add(counterpartId);
      unresolvedIds.delete(counterpartId);
      pendingIds.delete(counterpartId);
      byId.set(own.id, { id: own.id, status: 'confirmed-own', reason: 'explicit-ownership',
        counterpartId, candidateIds: [] });
      byId.set(counterpartId, { id: counterpartId, status: 'confirmed-own', reason: 'explicit-ownership',
        counterpartId: own.id, candidateIds: [] });
    }
  }
  const indexes = new Map<string, Entry[]>();
  const keys = (entry: Entry, opposite = false): string[] => {
    const direction = opposite ? (entry.tx.type === 'income' ? 'expense' : 'income') : entry.tx.type;
    const result: string[] = [];
    if (entry.referenceUnique && entry.reference) result.push(JSON.stringify(['ref', entry.bank, entry.money, entry.reference, direction]));
    if (entry.counterparty) result.push(JSON.stringify(['instruments', entry.money,
      ...[entry.instrument, entry.counterparty].sort(), direction]));
    // Index both directions of a stated destination. The credit need not
    // repeat the outgoing bank's account number to corroborate receipt.
    if (!opposite) {
      result.push(JSON.stringify(['arrived', entry.money, entry.instrument, direction]));
      if (entry.counterparty && evidenceOf(entry.tx)?.endpointProof === 'explicit-transfer')
        result.push(JSON.stringify(['addressed', entry.money, entry.counterparty, direction]));
    } else {
      result.push(JSON.stringify(['addressed', entry.money, entry.instrument, direction]));
      if (entry.counterparty && evidenceOf(entry.tx)?.endpointProof === 'explicit-transfer')
        result.push(JSON.stringify(['arrived', entry.money, entry.counterparty, direction]));
    }
    return result;
  };
  for (const entry of ctx.entries.values()) {
    if (stale.has(entry.tx.id) || userLinked.has(entry.tx.id) || corroboratingIds.has(entry.tx.id) || knownCardRepayments.has(entry.tx.id)) continue;
    for (const key of keys(entry)) {
      const bucket = indexes.get(key);
      if (bucket) bucket.push(entry); else indexes.set(key, [entry]);
    }
  }
  for (const bucket of indexes.values()) bucket.sort((a, b) => a.at - b.at || a.tx.id.localeCompare(b.tx.id));
  const candidates = new Map<string, Map<string, Exclude<Basis, 'user'>>>();
  const overflow = new Set<string>();
  for (const entry of ctx.entries.values()) {
    if (stale.has(entry.tx.id) || userLinked.has(entry.tx.id) || corroboratingIds.has(entry.tx.id) || knownCardRepayments.has(entry.tx.id)) continue;
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
      unresolvedIds.delete(txId);
      byId.set(txId, { id: txId, status: 'confirmed-own', reason: possible.get(only)!,
        counterpartId: only, candidateIds: [] });
    } else if (!own && (ids.length > 0 || overflow.has(txId) || ctx.entries.get(txId)?.referenceReused)) {
      pendingIds.add(txId);
      byId.set(txId, { id: txId, status: 'ambiguous', reason: 'multiple-candidates', candidateIds: ids });
    }
  }
  const cardRepaymentPairs = observedCardRepayments(ctx, new Set([...unresolvedIds, ...knownCardRepayments.keys()]), corroboratingIds);
  for (const [debitId, receiptId] of cardRepaymentPairs) {
    unresolvedIds.delete(debitId);
    pendingIds.delete(debitId);
    byId.set(debitId, { id: debitId, status: 'card-repayment', reason: 'credit-card-receipt', counterpartId: receiptId, candidateIds: [] });
  }
  const observedOwnPairs = observedOwnedTransferPairs(ctx, unresolvedIds, corroboratingIds, cardRepaymentPairs);
  for (const [txId, counterpartId] of observedOwnPairs) {
    if (!unresolvedIds.has(txId) || !unresolvedIds.has(counterpartId)) continue;
    internalIds.add(txId); internalIds.add(counterpartId);
    unresolvedIds.delete(txId); unresolvedIds.delete(counterpartId);
    pendingIds.delete(txId); pendingIds.delete(counterpartId);
    byId.set(txId, { id: txId, status: 'confirmed-own', reason: 'amount-time', counterpartId, candidateIds: [] });
    byId.set(counterpartId, { id: counterpartId, status: 'confirmed-own', reason: 'amount-time', counterpartId: txId, candidateIds: [] });
  }
  suggestObservedPairs(ctx, unresolvedIds, internalIds, corroboratingIds, cardRepaymentPairs, byId);
  // Suggestions are deliberately non-destructive: they are the small subset
  // worth asking the user about. Everything else unresolved defaults to normal
  // cash-flow treatment and remains editable from the transaction itself.
  for (const txId of unresolvedIds) {
    const status = byId.get(txId)?.status;
    if (status === 'likely-own' || status === 'likely-card-repayment') pendingIds.add(txId);
  }
  const groups = new Map<string, TransferReviewGroup>();
  for (const txId of pendingIds) {
    const tx = ctx.rows.get(txId)!;
    const assessment = byId.get(txId)!;
    const ev = evidenceOf(tx);
    const cp = ev?.counterparty;
    const strong = ev?.attribution === 'source' ? ctx.instrumentKey(cp) : undefined;
    const key = JSON.stringify([tx.accountId, tx.type, assessment.status, assessment.reason, strong ?? null, ev?.counterpartyName ?? null]);
    const existing = groups.get(key);
    if (existing) existing.transactionIds.push(txId);
    else groups.set(key, { id: `transfer-group:${hash(key)}`, transactionIds: [txId], accountId: tx.accountId,
      direction: tx.type, status: assessment.status, ...(strong && cp ? { counterparty: { ...cp } } : {}),
      ...(ev?.counterpartyName ? { counterpartyName: ev.counterpartyName } : {}),
      bulkEligible: strong !== undefined && assessment.status !== 'ambiguous' && !assessment.status.startsWith('likely-') });
  }
  const orderedGroups = [...groups.values()];
  for (const group of orderedGroups) group.transactionIds.sort();
  orderedGroups.sort((a, b) => a.id.localeCompare(b.id));
  return { byId, internalIds, pendingIds, groups: orderedGroups, corroboratingIds, corroboratingOf, cardRepaymentPairs, knownCardRepayments };
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
      (assessment.reason === 'user' || assessment.reason === 'reference' || assessment.reason === 'reciprocal-instruments' || assessment.reason === 'destination-and-receipt')) {
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
