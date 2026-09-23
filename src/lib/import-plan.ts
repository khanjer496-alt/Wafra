import { canonicalCaptureSourceKey, isUnboundAndroidSourceKey, isUsableCaptureSourceIdentity } from '@/lib/capture-source-identity';
import { cardAccountName, colorForHint, estimatedMinimumFils } from '@/lib/cards';
import {
  bankBrandForName,
  bankFromSender,
  bankIdentityForName,
  bankFromName,
  getActiveMarket,
  withMarketPackForParsing,
} from '@/lib/markets';
import { singleKnownBank } from '@/lib/known-banks';
import {
  bodyPrint,
  compatibleCaptureInstrument,
  duplicateGuard,
  mergeCaptureInstrument,
  type DuplicateCandidate,
} from '@/lib/dedupe';
import { readBillAlias } from '@/lib/bill-alias';
import { toISODate } from '@/lib/format';
import { canApplySourceDateCorrection, healPatch } from '@/lib/heal';
import { buildTransferEvidence } from '@/lib/transfer-evidence';
import { isUnassignedTransferAccount, unassignedTransferAccountId } from '@/lib/transfer-reconciliation';
import type { TransferEvidence } from '@/lib/transfer-reconciliation-types';
import { UNASSIGNED_INCOME_ACCOUNT_ID, UNASSIGNED_TRANSACTION_ACCOUNT_ID } from '@/lib/ledger';
import {
  ledgerMoneyMatchesCurrentMetadata,
  ledgerMoneySpec,
  migrateLegacyLedgerMoney,
} from '@/lib/ledger-money';
import {
  extractOutgoingTransferParties,
  isNonPostingMessage,
  overrideFitsDirection,
  STRUCTURAL_TITLES,
  type NonPostingReason,
  type ParsedSms,
} from '@/lib/sms-parser';
import type { CaptureChannel } from '@/lib/dedupe';
import type { Account, AppState, Bill, CaptureInstrument, CaptureSource, CardDue, ImportBatchInput, Transaction, TxHealUpdate } from '@/lib/types';


/**
 * Turning scanned messages into an importable batch.
 *
 * Split out of auto-import.ts for one reason: that file imports react-native
 * and so cannot be transpiled by the test harness. This is the code that
 * decides whether a message the user already has counts as new — the code
 * whose failure mode is the ledger quietly gaining a second copy of a charge
 * — and it had no test at all. dedupe.ts was carved out for exactly this
 * reason and did not go far enough: the fingerprints were tested, the
 * decision that uses them was not.
 *
 * Nothing here touches a native module.
 */

export type ScannedSms = Omit<ParsedSms, 'raw'> & {
  /** Present only when parsing happened locally; relay rows discard the body. */
  raw?: string;
  /** Bounded bank facts retained before native history discards the body. */
  transferEvidence?: TransferEvidence;
  smsTs?: number;
  sender?: string;
  channel?: CaptureChannel;
  /** Structured settlement side survives server raw-body discard on iOS. */
  cardPaymentSide?: 'debit' | 'receipt';
  /** Relay-only origin. It must never be inferred from the wake itself. */
  captureSource?: CaptureSource;
  /**
   * Server-bound proof of the exact Shortcut branch and setup generation.
   * Only a marker for this receiving device's current generation may prove
   * automation; manual Shortcut runs intentionally carry no marker.
   */
  captureAutomation?: {
    kind: 'message';
    sourceDeviceId: string;
    generation: string;
  };
  /** Launch pack that produced this body-free relay row. */
  market?: 'AE' | 'SA';
  /**
   * Opaque, locally generated identity for one provider-backed message.
   *
   * The iOS Shortcut hashes the Message GUID before Wafra sees it; Android
   * prefixes the stable inbox row id. Keeping either value in smsKey makes a
   * repeated history import exactly idempotent without persisting the body.
   */
  sourceEventId?: string;
  /** iOS queue observation receipt; independent of exact bank-event identity. */
  notificationObservationId?: string;
};

/**
 * A message the scan affirmatively suppressed from ordinary importing.
 *
 * Only identity metadata travels. Most rows are tested against the parser's
 * own `nonPostingReason`; Android can also prove that two consecutive provider
 * rows have byte-identical sender/body evidence. The body is then dropped, so
 * nothing that is not already a fingerprint leaves the scanner.
 *
 * This exists because the evidence for deleting a declined row is at SCAN
 * time and used to be thrown away. `parseSms` returns null for a decline, so
 * the message vanished from `parsed` and the planner never learned that the
 * inbox still holds, at that exact millisecond, an alert saying the money
 * never moved. The ledger migration in accounts.ts can only use a row's
 * STORED `raw`, and raw retention is recent: one real user has 59 decline
 * rows worth AED 89,897 and not one of them carries a body. The inbox does.
 */
export interface DeclinedSms {
  /** The SMS/notification timestamp, the same one `smsKey` is built from. */
  smsTs: number;
  sender?: string;
  channel?: CaptureChannel;
  /**
   * Closed evidence class; optional for older relay/history callers.
   * `exact-provider-duplicate` means Android stored one byte-identical alert
   * twice; it is carried here so older ledgers can retire that exact row id.
   */
  reason?: NonPostingReason | 'exact-provider-duplicate';
  /** Opaque iOS history identity or stable Android provider-row identity. */
  sourceEventId?: string;
  /** Native live-queue UUID, used only for a source-free durable qualification receipt. */
  localRecordId?: string;
}

export interface ImportPlan {
  batch: ImportBatchInput;
  txCount: number;
  newAccountCount: number;
  dueCount: number;
  /** Already-imported rows the parser now reads better (renamed/recategorized). */
  healedCount: number;
  /** Decline candidates that actually admitted a guarded remove update. */
  declineReconciledCount: number;
  /** Exact local queue identities whose decline candidates admitted removal. */
  declineReconciledIds: string[];
  /** One-to-one local queue identity to the exact admitted removed ledger row. */
  declineReconciliations: {
    localRecordId: string;
    removedTransactionId: string;
  }[];
  billDues: ScannedSms[];
}

/** Source-free failure: callers must not acknowledge a batch that was refused. */
export class ImportMoneyError extends Error {
  constructor() {
    super('Bank alert money does not match ledger currency');
    this.name = 'ImportMoneyError';
  }
}



/**
 * Nothing to import, and nothing learned.
 *
 * lastScanTs stays at 0 on purpose. Advancing the watermark here would mark
 * messages as read that were never actually compared against anything, and
 * a message is only ever offered once.
 */
function emptyPlan(): ImportPlan {
  return {
    batch: {
      transactions: [],
      newAccounts: [],
      newHints: {},
      newDues: [],
      newBills: [],
      snapshots: {},
      bankNames: {},
      cardTypes: {},
      lastScanTs: 0,
      updates: [],
    },
    txCount: 0,
    newAccountCount: 0,
    dueCount: 0,
    healedCount: 0,
    declineReconciledCount: 0,
    declineReconciledIds: [],
    declineReconciliations: [],
    billDues: [],
  };
}

/**
 * Currency proof for deferred onboarding plans must come from the alert, not
 * the device locale or active parser fallback. A local-currency amount has no
 * `originalCurrency`; a foreign-only charge does, so it cannot silently pin
 * AED/SAR from the current pack.
 */
function confirmedLedgerCurrency(rows: readonly ScannedSms[]): string | undefined {
  const observed = new Set<string>();
  for (const row of rows) {
    if (!ledgerMoneySpec(row.currency)) continue;
    if (row.originalCurrency && row.originalCurrency !== row.currency) continue;
    observed.add(row.currency);
  }
  return observed.size === 1 ? [...observed][0] : undefined;
}

interface SourceIdentityIndex {
  readonly priorBySmsKey: ReadonlyMap<string, Transaction>;
  readonly collidingPriorsBySmsKey: ReadonlyMap<string, readonly Transaction[]>;
}

// History checkpoints preserve the transaction array when no money changed.
// Reuse its source index across those pages instead of validating and indexing
// every retained row again. Healing, edits, restore and new rows replace the
// array, so they cannot reuse stale identities. Weak keys let retired ledger
// snapshots and their indexes be collected together.
const sourceIdentityIndexes = new WeakMap<readonly Transaction[], SourceIdentityIndex>();

// Date repair needs stricter uniqueness than ordinary healing, including
// collisions with manual rows. Pay for this extra index only for date evidence.
const sourceDateCounts = new WeakMap<readonly Transaction[], ReadonlyMap<string, number>>();
function sourceDateCount(transactions: readonly Transaction[], key: string): number {
  let counts = sourceDateCounts.get(transactions);
  if (!counts) {
    const next = new Map<string, number>();
    for (const tx of transactions) {
      const source = tx.smsKey ? canonicalCaptureSourceKey(tx.smsKey, tx.ts) : '';
      if (/^h[a-f0-9]{64}$/.test(source)) next.set(source, (next.get(source) ?? 0) + 1);
    }
    counts = next;
    sourceDateCounts.set(transactions, counts);
  }
  return counts.get(key) ?? 0;
}

function sourceIdentityIndex(transactions: readonly Transaction[]): SourceIdentityIndex {
  const cached = sourceIdentityIndexes.get(transactions);
  if (cached) return cached;
  const priorBySmsKey = new Map<string, Transaction>();
  // Preserve input order in collision buckets: exact healing chooses the first
  // compatible collision, while direct source lookup retains the last row.
  const collidingPriorsBySmsKey = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!isUsableCaptureSourceIdentity(t.smsKey, t.ts)) continue;
    if (t.smsKey && t.source === 'sms') {
      const sourceKey = canonicalCaptureSourceKey(t.smsKey, t.ts);
      if (isUnboundAndroidSourceKey(sourceKey)) continue;
      const prior = priorBySmsKey.get(sourceKey);
      if (prior) {
        const rows = collidingPriorsBySmsKey.get(sourceKey);
        if (rows) rows.push(t);
        else collidingPriorsBySmsKey.set(sourceKey, [prior, t]);
      }
      priorBySmsKey.set(sourceKey, t);
    }
  }
  const index: SourceIdentityIndex = { priorBySmsKey, collidingPriorsBySmsKey };
  sourceIdentityIndexes.set(transactions, index);
  return index;
}

/**
 * Turns parsed messages into a single importable batch:
 * maps card hints to accounts (auto-creating unseen cards), skips duplicates,
 * converts card payments to transfers, and statements to card dues.
 */
export function buildImportPlan(
  parsed: ScannedSms[],
  state: AppState,
  newestTs: number,
  today: Date = new Date(),
  /**
   * Messages this same scan read and the parser refused as declines. Optional
   * and last on purpose: `today` predates it and several callers pass it
   * positionally, and the two capture pipes that cannot supply declines (the
   * relay, which never sees a body, and the onboarding scan, which runs
   * against an empty ledger) are correct with the default.
   */
  declined: DeclinedSms[] = [],
): ImportPlan {
  // Source-free iOS history cannot recover a lost issuer from the sender
  // later. Resolve banks in the batch's proven money system, just as Android
  // does after detecting its inbox market. Do not change device preferences.
  const currency = parsed[0]?.currency;
  const market = currency === 'AED' ? 'AE' : currency === 'SAR' ? 'SA' : undefined;
  if (state.hydrated && market && market !== getActiveMarket().id &&
      parsed.every((row) => row.currency === currency)) {
    const plan = withMarketPackForParsing(market, () =>
      buildImportPlanInMarket(parsed, state, newestTs, today, declined));
    if (!plan) throw new ImportMoneyError();
    return plan;
  }
  return buildImportPlanInMarket(parsed, state, newestTs, today, declined);
}

function buildImportPlanInMarket(
  parsed: ScannedSms[],
  state: AppState,
  newestTs: number,
  today: Date,
  declined: DeclinedSms[],
): ImportPlan {
  // An unhydrated store is not an empty ledger, it is an unknown one — and
  // every duplicate check below is a lookup against `state.transactions`.
  //
  // A user pulled to refresh while AsyncStorage was still loading and the
  // screen was showing zeros. Nothing matched anything, so the whole inbox
  // imported as new; hydration then landed and restored the rows that were
  // already there, on top of the copies just made. Their entire history
  // doubled. The auto-import on Home waits for hydration; pull-to-refresh did
  // not, and neither did the manual importer, so the guard belongs here where
  // every caller has to pass through it.
  if (!state.hydrated) return emptyPlan();

  // An empty incremental read must not rebuild every full-history identity
  // index just to persist its watermark. There are no monetary decisions here.
  if (parsed.length === 0 && declined.length === 0) {
    const plan = emptyPlan();
    plan.batch.lastScanTs = newestTs;
    return plan;
  }

  // An Android provider ID without its original timestamp is not portable
  // identity. Refuse the whole input before money, snapshots or cursor effects.
  if ([...parsed, ...declined].some((row) => row.sourceEventId &&
    !isUsableCaptureSourceIdentity(`h${row.sourceEventId}`, row.smsTs))) {
    throw new Error('Native message identity requires a valid original timestamp');
  }
  const sourceIdentityMatchable = (row: Transaction): boolean =>
    isUsableCaptureSourceIdentity(row.smsKey, row.ts);
  let matchableTransactionsCache: Transaction[] | null = null;
  const matchableTransactions = (): Transaction[] => {
    matchableTransactionsCache ??= state.transactions.filter(sourceIdentityMatchable);
    return matchableTransactionsCache;
  };

  // Currency survives transport as a parser fact. Validate it before account
  // resolution, snapshots, dedupe or healing can change the ledger. Empty
  // ledgers require one explicit launch currency; a mixed batch proves none.
  const storedMoney = migrateLegacyLedgerMoney(state);
  const currencies = new Set(parsed.map((row) => row.currency));
  const singleCurrency = currencies.size === 1 ? [...currencies][0] : undefined;
  const importMoney = storedMoney ?? (singleCurrency ? ledgerMoneySpec(singleCurrency) : null);
  const acceptsImportedMoney = importMoney !== null && ledgerMoneyMatchesCurrentMetadata(importMoney);
  const validMoney = (row: ScannedSms): boolean => acceptsImportedMoney && row.currency === importMoney!.currency &&
    Number.isSafeInteger(row.amountFils) && row.amountFils > 0 &&
    (row.minDueFils == null || (Number.isSafeInteger(row.minDueFils) && row.minDueFils >= 0)) &&
    (row.snapshotFils == null || Number.isSafeInteger(row.snapshotFils));
  if (parsed.some((row) => !validMoney(row))) throw new ImportMoneyError();

  // A full-history scan surfaces statements from years back; only dues still
  // near their pay-by date are live obligations worth tracking.
  const staleDueCutoff = toISODate(new Date(today.getTime() - 45 * 86400000));
  // Three fingerprints, because the same transaction can reach us through
  // three capture channels. See dedupe.ts for why one is not enough.
  const protectedEditedPushConsumed = new Set<string>();
  const protectedReplacementCandidates: DuplicateCandidate[] = [];
  // The generalized duplicate guard builds several complete-ledger indexes
  // (title/time, exact source, cross-channel, statement overlap, card-payment
  // sides). A parser backfill whose exact provider identity already exists does
  // not need any of them. Keep the heavy structure lazy so the common history
  // repair path can heal exact rows without duplicating a 10k+ ledger into
  // temporary Maps on every durable page.
  let guardCache: ReturnType<typeof duplicateGuard> | null = null;
  const guard = (): ReturnType<typeof duplicateGuard> => {
    if (!guardCache) {
      guardCache = duplicateGuard(matchableTransactions(), true);
      for (const id of protectedEditedPushConsumed) guardCache.consume(id);
      for (const candidate of protectedReplacementCandidates) guardCache.add(candidate);
    }
    return guardCache;
  };
  const captureInstrumentOf = (p: ScannedSms): CaptureInstrument | undefined => {
    if (!p.card) return undefined;
    const bank = (p.bankHint ? bankFromName(p.bankHint) : null) ?? bankFromSender(p.sender);
    return {
      last4: p.card.last4,
      kind: p.card.kind,
      ...(bank ? { bankIdentity: bankIdentityForName(bank.name) } : {}),
    };
  };
  let protectedEditedPushIndex: Map<string, Transaction[]> | null = null;
  const editedPushKey = (date: string, amountFils: number, type: Transaction['type']) =>
    `${date}|${amountFils}|${type}`;
  const protectedEditedPushFor = (p: ScannedSms, date: string): Transaction | undefined => {
    if (p.channel === 'push' || !Number.isFinite(p.smsTs)) return undefined;
    if (!protectedEditedPushIndex) {
      const index = new Map<string, Transaction[]>();
      for (const row of state.transactions) {
        if (row.source !== 'sms' || row.viaPush !== true || row.userEdited !== true || !Number.isFinite(row.ts)) continue;
        const key = editedPushKey(row.date, row.amountFils, row.type);
        const rows = index.get(key);
        if (rows) rows.push(row);
        else index.set(key, [row]);
      }
      protectedEditedPushIndex = index;
    }
    const incomingInstrument = captureInstrumentOf(p);
    let best: Transaction | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const row of protectedEditedPushIndex.get(editedPushKey(date, p.amountFils, p.type)) ?? []) {
      if (protectedEditedPushConsumed.has(row.id)) continue;
      if (!compatibleCaptureInstrument(row.captureInstrument, incomingInstrument)) continue;
      const distance = Math.abs(row.ts! - p.smsTs!);
      if (distance > 120_000 || distance >= bestDistance) continue;
      best = row;
      bestDistance = distance;
    }
    return best;
  };
  // Existing SMS rows by fingerprint, for rescan healing: a message that
  // dedupes but now parses BETTER upgrades its old row instead of being lost.
  const { priorBySmsKey, collidingPriorsBySmsKey } = sourceIdentityIndex(state.transactions);
  let priorByIdCache: Map<string, Transaction> | null = null;
  const priorById = (): Map<string, Transaction> => {
    if (priorByIdCache) return priorByIdCache;
    const result = new Map<string, Transaction>();
    for (const t of state.transactions) result.set(t.id, t);
    priorByIdCache = result;
    return result;
  };
  let transferRepairCandidatesCache: Map<string, Transaction[]> | null = null;
  const transferRepairKey = (accountId: string, type: Transaction['type'], amountFils: number, date: string) =>
    `${accountId}|${type}|${amountFils}|${date}`;
  // Statement healing must still consider legacy SMS rows that predate
  // portable source identity, but index them once instead of filtering the
  // entire ledger for every incoming statement row.
  const transferRepairCandidates = (): Map<string, Transaction[]> => {
    if (transferRepairCandidatesCache) return transferRepairCandidatesCache;
    const result = new Map<string, Transaction[]>();
    for (const t of state.transactions) {
      if (t.source !== 'sms' || t.userEdited || t.transferDecision || t.splits) continue;
      const key = transferRepairKey(t.accountId, t.type, t.amountFils, t.date);
      const rows = result.get(key);
      if (rows) rows.push(t);
      else result.set(key, [t]);
    }
    transferRepairCandidatesCache = result;
    return result;
  };
  const compatiblePrior = (key: string, p: ScannedSms): Transaction | undefined => {
    const candidates = collidingPriorsBySmsKey.get(key);
    if (candidates) {
      return candidates.find((t) => key.startsWith('h') ||
        compatibleCaptureInstrument(t.captureInstrument, captureInstrumentOf(p)));
    }
    const prior = priorBySmsKey.get(key);
    if (!prior) return undefined;
    return key.startsWith('h') ||
      compatibleCaptureInstrument(prior.captureInstrument, captureInstrumentOf(p))
      ? prior
      : undefined;
  };
  /**
   * Stable identity for a local SMS across parser money corrections.
   *
   * The legacy key is `s{provider timestamp}-{parsed amount}`. That made a
   * parser-version reread unsafe: correcting an amount (or updating an
   * offline FX fallback) changed the key, so the same retained Message was
   * appended beside its old row. The provider timestamp is the only stable
   * identity older Android rows retained. Use it only when it is unique on
   * both sides, belongs to a local SMS capture, is date-plausible, and retained
   * source text proves identity for any changed amount or direction. Historical Shortcut timestamps
   * are rounded and therefore stay on their GUID-derived `h...` identity.
   */
  const rowTimestamp = (t: Transaction): number | undefined => {
    if (Number.isFinite(t.ts)) return t.ts;
    const match = t.smsKey?.match(/^s(\d+)-/);
    return match ? Number(match[1]) : undefined;
  };
  let rowsByTimestampCache: Map<number, Transaction[]> | null = null;
  // Relay/PDF/CSV rows deliberately carry no raw source text, so they cannot
  // use Android timestamp recovery. Skip building this full-ledger index for
  // statement imports.
  const hasLocalSourceEvidence = parsed.some((row) => row.raw !== undefined);
  const rowsByTimestamp = (): Map<number, Transaction[]> => {
    if (rowsByTimestampCache) return rowsByTimestampCache;
    const result = new Map<number, Transaction[]>();
    if (hasLocalSourceEvidence) {
      for (const t of state.transactions) {
        if (!sourceIdentityMatchable(t) || t.source !== 'sms') continue;
        const ts = rowTimestamp(t);
        if (ts === undefined) continue;
        const bucket = result.get(ts);
        if (bucket) bucket.push(t);
        else result.set(ts, [t]);
      }
    }
    rowsByTimestampCache = result;
    return result;
  };
  const parsedTimestampCounts = new Map<number, number>();
  const androidTimestampCounts = new Map<number, number>();
  for (const p of parsed) {
    if (p.channel !== 'push' && Number.isFinite(p.smsTs) &&
        (!p.sourceEventId || /^a\d+$/.test(p.sourceEventId))) {
      androidTimestampCounts.set(p.smsTs!, (androidTimestampCounts.get(p.smsTs!) ?? 0) + 1);
    }
    if (p.sourceEventId || p.channel === 'push' || !Number.isFinite(p.smsTs)) continue;
    parsedTimestampCounts.set(p.smsTs!, (parsedTimestampCounts.get(p.smsTs!) ?? 0) + 1);
  }
  const stableLocalPrior = (p: ScannedSms): Transaction | undefined => {
    if (p.sourceEventId || p.channel === 'push' || !Number.isFinite(p.smsTs)) return undefined;
    if (parsedTimestampCounts.get(p.smsTs!) !== 1) return undefined;
    const rows = rowsByTimestamp().get(p.smsTs!);
    if (!rows || rows.length !== 1) return undefined;
    const prior = rows[0];
    if (!compatibleCaptureInstrument(prior.captureInstrument, captureInstrumentOf(p))) return undefined;
    const sameBody = p.raw !== undefined && prior.raw !== undefined &&
      bodyPrint(p.raw) === bodyPrint(prior.raw);
    if (p.raw !== undefined && prior.raw !== undefined && !sameBody) return undefined;
    // A clock cannot turn a purchase into a refund or establish its amount.
    // Only retained source evidence can justify a legacy direction/amount correction.
    if ((prior.type !== p.type || prior.amountFils !== p.amountFils) && !sameBody) return undefined;
    const messageDate = Date.parse(`${p.date ?? toISODate(new Date(p.smsTs!))}T12:00:00Z`);
    if (!Number.isFinite(messageDate) || Math.abs(messageDate - p.smsTs!) > 7 * 86400000) {
      return undefined;
    }
    return prior;
  };
  /** A statement can heal one old parser-owned transfer, never arbitrary spend. */
  const statementTransferPrior = (p: ScannedSms, accountId: string): Transaction | undefined => {
    const evidence = p.transferEvidence;
    if (!p.transferHint || evidence?.statement !== true || evidence.attribution !== 'source' || !p.date) return undefined;
    const normalizedRef = (value: unknown): string | undefined => typeof value === 'string'
      ? value.replace(/[\s/-]/g, '').toUpperCase() || undefined
      : undefined;
    const incomingRef = normalizedRef(evidence.reference);
    const candidates = (transferRepairCandidates().get(
      transferRepairKey(accountId, p.type, p.amountFils, p.date),
    ) ?? []).filter((candidate) => {
      const priorRef = normalizedRef(candidate.transferEvidence?.reference);
      const sameReference = !!incomingRef && !!priorRef && incomingRef === priorRef;
      const structurallyTransferLike = candidate.isTransfer === true || STRUCTURAL_TITLES.has(candidate.title.trim()) ||
        /^(?:(?:bank|outgoing|incoming|own account|self|internal) transfer|(?:outward|inward) remittance)$/i.test(candidate.title.trim());
      return sameReference || structurallyTransferLike;
    });
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  const updates: TxHealUpdate[] = [];
  const healFromReparse = (
    smsKey: string | undefined,
    p: ScannedSms,
    resolvedAccountId?: string,
    cardPaymentSide?: 'debit' | 'receipt',
    stablePrior?: Transaction,
  ) => {
    const prior = stablePrior ?? (smsKey ? compatiblePrior(smsKey, p) : undefined);
    // A hand-entered row may explain one bank alert for duplicate prevention,
    // but it is never parser-owned. Do not attach parser roles or move it to a
    // guessed account during a later inbox re-read.
    if (!prior || prior.source !== 'sms' || prior.userEdited) return;
    // Older rows predate structured settlement sides. Pass the side resolved
    // from either the parser field or the Android-only raw fallback so a
    // reparse can make persisted one-to-one settlement reconciliation work.
    const patch = healPatch(
      prior,
      cardPaymentSide ? { ...p, cardPaymentSide } : p,
    );
    const accountChanged =
      resolvedAccountId !== undefined && resolvedAccountId !== prior.accountId;
    const instrumentProven =
      resolvedAccountId !== undefined &&
      p.paymentFlowSide === 'receipt' &&
      p.card != null &&
      prior.paymentInstrumentSource !== 'alert';
    const captureInstrument = mergeCaptureInstrument(captureInstrumentOf(p), prior.captureInstrument);
    const captureChanged = captureInstrument !== undefined &&
      JSON.stringify(captureInstrument) !== JSON.stringify(prior.captureInstrument);
    const transferEvidence = buildTransferEvidence(p, resolvedAccountId !== undefined);
    const transferChanged = transferEvidence !== undefined &&
      JSON.stringify(transferEvidence) !== JSON.stringify(prior.transferEvidence);
    const clearTransferEvidence = prior.transferEvidence !== undefined && transferEvidence === undefined;
    if (patch || accountChanged || instrumentProven || captureChanged || transferChanged || clearTransferEvidence) {
      updates.push({
        ...(patch ?? { id: prior.id }),
        ...(accountChanged ? { accountId: resolvedAccountId } : {}),
        ...(instrumentProven ? { paymentInstrumentSource: 'alert' as const } : {}),
        ...(captureChanged ? { captureInstrument } : {}),
        ...(transferChanged ? { transferEvidence } : {}),
        ...(clearTransferEvidence ? { clearTransferEvidence: true as const } : {}),
      });
    }
  };
  const promoteMatchedHistory = (
    matchedId: string,
    smsKey: string,
    p: ScannedSms,
    resolvedAccountId?: string,
    cardPaymentSide?: 'debit' | 'receipt',
  ) => {
    const prior = priorById().get(matchedId);
    if (!prior) return;
    // A hand-entered row may explain one bank alert, but the history importer
    // must not rewrite the user's category/direction or attach an SMS identity
    // to a row whose source remains manual.
    if (prior.source !== 'sms') return;
    // The existing row is still indexed by its legacy s-key, so looking it up
    // through the incoming h-key cannot heal it. Build one combined update;
    // the reducer intentionally keeps only the last patch for a row id.
    const patch = prior.userEdited
      ? null
      : healPatch(prior, cardPaymentSide ? { ...p, cardPaymentSide } : p);
    const accountChanged =
      !prior.userEdited &&
      resolvedAccountId !== undefined &&
      resolvedAccountId !== prior.accountId;
    const identityChanged =
      prior.smsKey !== smsKey || prior.ts !== p.smsTs || prior.viaPush === true;
    const instrumentProven =
      !prior.userEdited &&
      resolvedAccountId !== undefined &&
      p.paymentFlowSide === 'receipt' &&
      p.card != null &&
      prior.paymentInstrumentSource !== 'alert';
    const transferEvidence = !prior.userEdited
      ? buildTransferEvidence(p, resolvedAccountId !== undefined) : undefined;
    const transferChanged = transferEvidence !== undefined &&
      JSON.stringify(transferEvidence) !== JSON.stringify(prior.transferEvidence);
    const clearTransferEvidence = !prior.userEdited && prior.transferEvidence !== undefined && transferEvidence === undefined;
    if (!patch && !accountChanged && !identityChanged && !instrumentProven && !transferChanged && !clearTransferEvidence) return;
    updates.push({
      ...(patch ?? { id: matchedId }),
      ...(accountChanged ? { accountId: resolvedAccountId } : {}),
      ...(instrumentProven ? { paymentInstrumentSource: 'alert' as const } : {}),
      ...(transferChanged ? { transferEvidence } : {}),
      ...(clearTransferEvidence ? { clearTransferEvidence: true as const } : {}),
      smsKey,
      ts: p.smsTs,
      viaPush: false,
      ...(p.card ? { captureInstrument: mergeCaptureInstrument(
            captureInstrumentOf(p), prior.captureInstrument) } : {}),
    });
  };
  const smsKeyOf = (p: ScannedSms): string | undefined =>
    p.sourceEventId
      ? canonicalCaptureSourceKey(`h${p.sourceEventId}`, p.smsTs)
      : p.smsTs !== undefined
        ? `s${p.smsTs}-${p.amountFils}`
        : undefined;
  /** Only the reproduced legacy beneficiary-as-source error can cross an
   * instrument mismatch. Provider identity and ordinary dedupe stay strict. */
  const legacyTransferSourcePrior = (p: ScannedSms): Transaction | undefined => {
    if (!p.sourceEventId || !/^a\d+$/.test(p.sourceEventId) || p.channel === 'push' ||
        !Number.isFinite(p.smsTs) || !p.raw || !p.card || p.type !== 'expense' || !p.transferHint) return;
    if (androidTimestampCounts.get(p.smsTs!) !== 1) return;
    const rows = rowsByTimestamp().get(p.smsTs!);
    if (rows?.length !== 1) return;
    const prior = rows[0];
    if (prior.source !== 'sms' || prior.viaPush || prior.smsKey !== `s${p.smsTs}-${p.amountFils}` ||
        (!prior.captureInstrument && !prior.userEdited)) return;
    if (!prior.userEdited && (prior.type !== p.type || prior.amountFils !== p.amountFils || !prior.isTransfer)) return;
    const parties = extractOutgoingTransferParties(p.raw);
    if (!parties?.source || !parties.destination || parties.source.last4 === parties.destination.last4 ||
        p.card.last4 !== parties.source.last4 ||
        (prior.captureInstrument && prior.captureInstrument.last4 !== parties.destination.last4)) return;
    if (prior.raw !== undefined && bodyPrint(prior.raw) !== bodyPrint(p.raw)) return;
    // The old parser got the party wrong, not permission to cross issuers or
    // contradictory instrument kinds that the alerts explicitly established.
    if (prior.captureInstrument && !compatibleCaptureInstrument(
      { ...prior.captureInstrument, last4: parties.source.last4 }, captureInstrumentOf(p),
    )) return;
    // Pre-metadata edited rows have no instrument facts to contradict this
    // exact, unique SMS identity. Its immutable s-key still records the
    // original amount even if the user changed amount, direction or title.
    // Only promote identity: the caller preserves every user-facing field.
    const messageDate = Date.parse(`${p.date ?? toISODate(new Date(p.smsTs!))}T12:00:00Z`);
    if (!Number.isFinite(messageDate) || Math.abs(messageDate - p.smsTs!) > 7 * 86400000) return;
    return prior;
  };
  // Newest bank-quoted balance/limit per account — even from messages whose
  // transaction is already imported (rescans refresh the figures).
  const snapshots: ImportBatchInput['snapshots'] = {};
  const hints: Record<string, string> = { ...state.accountHints };
  const newAccounts: Omit<Account, 'id'>[] = [];
  const newHints: Record<string, string> = {};
  const transactions: Omit<Transaction, 'id'>[] = [];
  const newDues: Omit<CardDue, 'id'>[] = [];
  const newBills: Omit<Bill, 'id' | 'paidMonths'>[] = [];
  const billDues: ScannedSms[] = [];
  const fallbackAccountId = state.accounts[0]?.id ?? '';
  const existingAccountById = new Map(state.accounts.map((account) => [account.id, account] as const));
  const accountCandidates: Array<{ ref: string; account: Pick<Account, 'kind' | 'cardType' | 'last4' | 'bankName' | 'name'> }> =
    state.accounts.map((account) => ({ ref: account.id, account }));

  // Bank identity per account, learned from SMS sender IDs (existing accounts
  // that predate this get theirs backfilled).
  const bankNames: Record<string, string> = {};
  const cardTypes: NonNullable<ImportBatchInput['cardTypes']> = {};
  type ResolvedCardKind = 'credit' | 'debit' | 'account' | 'unknown';
  interface AccountResolution {
    accountId: string;
    /** False when multiple compatible accounts made attribution unsafe. */
    confident: boolean;
  }
  // The user's sole known bank: names a card nothing else could, and yields
  // to explicit evidence (see matchesCard and the backfill below).
  const soleKnownBankName = singleKnownBank(state.knownBanks)?.name;
  const hintKey = (bankName: string | undefined, last4: string, kind: string) =>
    `${bankName ?? '?'}|${kind}|${last4}`;
  const unassignedCardRef = (
    bankName: string | undefined,
    last4: string,
    kind: ResolvedCardKind,
  ): string =>
    `__unassigned-card__:${bankName ? bankIdentityForName(bankName) : 'unknown'}:${kind}:${last4}`;
  const accountAtRef = (
    ref: string,
  ): Pick<Account, 'kind' | 'cardType' | 'last4' | 'bankName' | 'name'> | undefined => {
    if (/^\d+$/.test(ref)) return newAccounts[Number(ref)];
    return existingAccountById.get(ref);
  };
  const effectiveCardType = (
    ref: string,
    account: Pick<Account, 'cardType'> | undefined = accountAtRef(ref),
  ): Account['cardType'] => cardTypes[ref] ?? account?.cardType;
  const matchesCard = (
    ref: string,
    account: Pick<Account, 'kind' | 'cardType' | 'last4' | 'bankName'> | undefined,
    last4: string,
    kind: ResolvedCardKind,
    bankName: string | undefined,
  ): boolean => {
    if (!account || account.last4 !== last4) return false;
    if (kind === 'account') {
      if (account.kind !== 'bank') return false;
    } else {
      if (account.kind !== 'card') return false;
      const effectiveType = effectiveCardType(ref, account);
      if (kind !== 'unknown' && effectiveType !== undefined && effectiveType !== kind) {
        return false;
      }
    }
    // A missing bank can be learned from this sender. A different known bank
    // cannot: last four digits are not globally unique. The one exception is
    // a label that came from the user's "Which banks text you?" answer when
    // exactly one bank is known: that is a default, not evidence, so an alert
    // that names another bank for the same card corrects it instead of
    // minting a second account.
    return (
      !bankName ||
      !account.bankName ||
      account.bankName === soleKnownBankName ||
      bankIdentityForName(account.bankName) === bankIdentityForName(bankName)
    );
  };
  const isGeneratedUnknownHolding = (
    ref: string,
    account: Pick<Account, 'kind' | 'cardType' | 'last4' | 'bankName' | 'name'>,
    last4: string,
  ): boolean => {
    if (account.kind !== 'card' || effectiveCardType(ref, account) !== undefined) return false;
    const suffixes = [`Card •${last4}`, `بطاقة •${last4}`];
    const prefixes = account.bankName
      ? [account.bankName, bankBrandForName(account.bankName)?.name].filter(
          (name): name is string => Boolean(name),
        )
      : [];
    return [
      ...suffixes,
      ...prefixes.flatMap((prefix) => suffixes.map((suffix) => `${prefix} ${suffix}`)),
    ].includes(account.name.trim());
  };
  const resolveAccount = (
    p: ScannedSms,
    ambiguousFallbackAccountId?: string,
    refuseAmbiguous = false,
    createMissing = true,
  ): AccountResolution => {
    if (!p.card) {
      const evidence = buildTransferEvidence(p, false);
      // A bank-authenticated masked source is still a real source account even
      // when the message is an own-account transfer. Keep that durable account
      // identity (and its quoted balance) while the transaction itself remains
      // transfer/non-spending. The hash is persisted only as a scoped hint; it
      // is never shown to the user.
      if (evidence?.sourceAccountKey && evidence.sourceBank) {
        const sourceHint = `source-account|${evidence.sourceBank}|${evidence.sourceAccountKey}`;
        const hinted = hints[sourceHint];
        const hintedAccount = hinted ? accountAtRef(hinted) : undefined;
        if (hinted && hintedAccount?.kind === 'bank' && hintedAccount.bankName &&
            bankIdentityForName(hintedAccount.bankName) === evidence.sourceBank) {
          return { accountId: hinted, confident: true };
        }
        if (createMissing) {
          const bank = (p.bankHint ? bankFromName(p.bankHint) : null) ??
            bankFromName(evidence.sourceBank) ?? bankFromSender(p.sender);
          const bankName = bank?.name ?? evidence.sourceBank;
          const idx = newAccounts.length;
          newAccounts.push({
            name: `${bankName} Account`,
            kind: 'bank',
            bankName,
            openingFils: 0,
            color: bank?.color ?? colorForHint(evidence.sourceAccountKey.slice(-4)),
          });
          const ref = String(idx);
          accountCandidates.push({ ref, account: newAccounts[idx] });
          hints[sourceHint] = ref;
          newHints[sourceHint] = ref;
          bankNames[ref] = bankName;
          return { accountId: ref, confident: true };
        }
      }
      // A Liv/HSBC/YAP source without four readable terminal digits must not
      // inherit the first saved card. The bank/mask-scoped holding remains
      // explicitly unassigned and never enters the user's Accounts list.
      if (evidence) {
        const priorAccount = ambiguousFallbackAccountId ? accountAtRef(ambiguousFallbackAccountId) : undefined;
        const sameBank = evidence.sourceBank && priorAccount?.bankName &&
          bankIdentityForName(evidence.sourceBank) === bankIdentityForName(priorAccount.bankName);
        // A less specific reread cannot undo an existing compatible bank-side
        // assignment. Repair the demonstrated unrelated-card/issuer fallback,
        // not every older account that this masked alert cannot identify.
        const bankSide = priorAccount?.kind === 'bank' ||
          (priorAccount?.kind === 'card' && priorAccount.cardType === 'debit');
        if (sameBank && bankSide && ambiguousFallbackAccountId) {
          return { accountId: ambiguousFallbackAccountId, confident: false };
        }
        return { accountId: unassignedTransferAccountId(evidence), confident: false };
      }
      // On an empty first scan the old empty-string fallback silently dropped
      // parsed fees, receipts and salaries. Keep a stable unresolved reference
      // until real source evidence or the user identifies an account.
      const priorAccount = ambiguousFallbackAccountId ? accountAtRef(ambiguousFallbackAccountId) : undefined;
      const issuer = (p.bankHint ? bankFromName(p.bankHint) : null) ?? bankFromSender(p.sender);
      // A sender identifies an issuer, not one of the user's cards. Preserve
      // user choices and compatible old assignments; repair only a provable
      // cross-bank fallback. New unidentified events get no invented account.
      const wrongIssuer = issuer && priorAccount?.bankName &&
        bankIdentityForName(issuer.name) !== bankIdentityForName(priorAccount.bankName);
      return { accountId: ambiguousFallbackAccountId && (!createMissing || !wrongIssuer)
        ? ambiguousFallbackAccountId : UNASSIGNED_TRANSACTION_ACCOUNT_ID, confident: false };
    }
    const { last4 } = p.card;
    // The parser owns card-kind evidence, including Arabic forms such as
    // Mada. Reinterpreting its structured result from English-only raw-text
    // heuristics silently downgraded explicit Arabic debit cards to unknown.
    const kind = p.card.kind as ResolvedCardKind;
    const transferParties = kind === 'unknown' && p.raw ? extractOutgoingTransferParties(p.raw) : null;
    const sourceKindAmbiguous = (transferParties?.sourceKindAmbiguous === true &&
      transferParties.source?.last4 === last4) || (p.raw === undefined && kind === 'unknown' &&
      buildTransferEvidence(p, false)?.sourceKindAmbiguous === true);
    // A message that spells out its issuer ("Emirates NBD Credit Card Mini
    // Stmt for Card ending 8575") is STATING the bank; a sender ID only
    // suggests one. That distinction is the only thing that can separate two
    // real cards sharing their last four digits at different banks — one user
    // holds a Liv card and an ENBD card both ending 8575, and payments were
    // settling against the wrong one.
    const bank = (p.bankHint ? bankFromName(p.bankHint) : null) ?? bankFromSender(p.sender);
    const scoped = hintKey(bank?.name, last4, kind);
    const noteType = (ref: string) => {
      if (kind === 'account' || kind === 'unknown') return;
      const known = effectiveCardType(ref);
      // A statement or payment's explicit credit evidence is stronger than a
      // purchase alert whose missing type made the parser fall back to debit.
      // Existing cards already carrying this exact type need no reducer patch.
      // Re-emitting unchanged metadata on every normal purchase disabled the
      // incremental-capture fast path and forced a whole-ledger reconciliation
      // for one new row. Keep provisional same-batch refs explicit because
      // later rows in this plan may still upgrade them.
      const existingRef = !/^\d+$/.test(ref);
      if (!existingRef || (kind === 'credit' ? known !== 'credit' : known === undefined)) {
        cardTypes[ref] = kind;
      }
      if (kind === 'credit' && snapshots[ref]?.kind === 'balance') {
        snapshots[ref] = { ...snapshots[ref], kind: 'limit' };
      }
    };
    const resolved = (ref: string, confident = true): AccountResolution => {
      if (confident) {
        hints[scoped] = ref;
        newHints[scoped] = ref;
      }
      // Bank identity is learned only from an unambiguous attribution. A
      // reused legacy holding is deliberately non-confident; stamping the SMS
      // sender onto it would make later resolver passes treat that guess as
      // established identity.
      if (bank && confident) {
        const account = accountAtRef(ref);
        const existingRef = !/^\d+$/.test(ref);
        // Learning a missing issuer is a real mutation. Re-stating the issuer
        // already persisted on this exact account is not.
        if (!existingRef || !account?.bankName || account.bankName === soleKnownBankName) {
          bankNames[ref] ??= bank.name;
        }
      }
      noteType(ref);
      return { accountId: ref, confident };
    };
    const compatible = accountCandidates.filter(({ ref, account }) =>
      matchesCard(ref, account, last4, kind, bank?.name) ||
      (sourceKindAmbiguous && matchesCard(ref, account, last4, 'account', bank?.name)));
    // Explicit type evidence may safely choose the sole account already known
    // to have that type. Untyped candidates remain upgradeable only when no
    // typed account exists.
    const typedCompatible =
      kind === 'credit' || kind === 'debit'
        ? compatible.filter(({ ref, account }) => effectiveCardType(ref, account) === kind)
        : [];
    const eligible = typedCompatible.length > 0 ? typedCompatible : compatible;
    // A legacy last4-only hint cannot distinguish two real same-bank cards.
    // Every hint, including a scoped one, is accepted only when it names the
    // sole compatible account in current state plus this batch.
    const hintKeys = kind === 'unknown' ? [scoped] : [scoped, last4];
    for (const key of hintKeys) {
      const ref = hints[key];
      if (!ref || !matchesCard(ref, accountAtRef(ref), last4, kind, bank?.name)) continue;
      if (eligible.length === 1 && eligible[0].ref === ref) return resolved(ref);
    }
    const existing = eligible.length === 1 ? eligible[0] : undefined;
    if (existing) {
      hints[last4] = existing.ref;
      newHints[last4] = existing.ref;
      return resolved(existing.ref);
    }
    // A reparse of an existing row may learn the PAN while still finding two
    // real compatible cards. Preserve its current account rather than moving
    // it to an arbitrary hinted row or minting a third account solely for a
    // deduped message.
    if (eligible.length > 1 && ambiguousFallbackAccountId !== undefined) {
      return { accountId: ambiguousFallbackAccountId, confident: false };
    }
    if (kind === 'unknown' && eligible.length > 1) {
      const holdings = eligible.filter(({ ref, account }) =>
        isGeneratedUnknownHolding(ref, account, last4));
      if (holdings.length > 0) {
        // Old builds could already have produced several generic buckets.
        // Reuse one stable bucket so every later alert cannot mint another;
        // this is routing, not proof that the legacy rows are one real card.
        const holding = [...holdings].sort((a, b) => a.ref.localeCompare(b.ref))[0];
        return resolved(holding.ref, false);
      }
    }
    if (eligible.length > 1 && refuseAmbiguous) {
      return { accountId: '', confident: false };
    }
    // Explicit evidence still cannot identify one of two real cards that
    // share bank, type and suffix. Preserve a money event against a stable,
    // deliberately non-account ref instead of either guessing a real card or
    // dropping the event while the scan watermark advances. The ref includes
    // only parser-proven identity, is never added to Accounts, and deliberately
    // bypasses resolved() so no hint, bank-name, card-type, or snapshot
    // backfill can turn this staging bucket into an asserted attribution.
    // Statements opt into refuseAmbiguous above because an unattached due is
    // not a ledger event; transactions and card payments must be lossless.
    if ((kind !== 'unknown' || sourceKindAmbiguous) && eligible.length > 1) {
      return {
        accountId: unassignedCardRef(bank?.name, last4, kind),
        confident: false,
      };
    }
    // A protected existing row keeps the user's account assignment. Resolve
    // known instruments above so genuine snapshots can still update them,
    // but do not mint an account that no new or healed row will use.
    if (!createMissing) {
      return { accountId: ambiguousFallbackAccountId ?? fallbackAccountId, confident: false };
    }
    // Auto-create; reference by index until the store assigns real ids.
    // When neither sender nor body named the bank, the user's own answer to
    // "Which banks text you?" does, provided it is exactly one bank.
    const label = bank ?? singleKnownBank(state.knownBanks);
    const idx = newAccounts.length;
    newAccounts.push({
      name: label
        ? `${label.name} ${cardAccountName(last4, kind)}`
        : cardAccountName(last4, kind),
      kind: kind === 'credit' || kind === 'debit' || kind === 'unknown' ? 'card' : 'bank',
      cardType: kind === 'credit' ? 'credit' : kind === 'debit' ? 'debit' : undefined,
      last4,
      bankName: label?.name,
      openingFils: 0,
      color: label?.color ?? colorForHint(last4),
    });
    const ref = String(idx);
    accountCandidates.push({ ref, account: newAccounts[idx] });
    const confident = eligible.length === 0;
    if (confident) {
      hints[last4] = ref;
      newHints[last4] = ref;
    }
    return resolved(ref, confident);
  };

  const noteSnapshot = (accountRef: string, p: ScannedSms) => {
    if (p.snapshotFils === null || !p.snapshotKind || p.smsTs === undefined || !accountRef) return;
    const knownType = cardTypes[accountRef] ?? accountAtRef(accountRef)?.cardType;
    // When a credit-card purchase omitted the word "credit", the parser saw a
    // debit card and called "Avl Bal" a cash balance. Once account resolution
    // knows the instrument is credit, that figure is available headroom.
    const kind = knownType === 'credit' && p.snapshotKind === 'balance' ? 'limit' : p.snapshotKind;
    const cur = snapshots[accountRef];
    if (!cur || p.smsTs > cur.ts) {
      snapshots[accountRef] = { fils: p.snapshotFils, kind, ts: p.smsTs };
    }
  };

  const cardPaymentSideOf = (p: ScannedSms): 'debit' | 'receipt' | undefined => {
    if (p.cardPaymentSide) return p.cardPaymentSide;
    if (p.kind !== 'cardPayment' || !p.raw) return undefined;
    if (
      /payment\s+instructions?|(?:debited|deducted)\b[\s\S]*towards?\s+(?:the\s+)?(?:payment|settlement|repayment)/i.test(
        p.raw,
      )
    ) return 'debit';
    if (
      /(?:payment|amount)\b[\s\S]*(?:received|credited)|received\s+payment|has\s+been\s+paid|thank you for (?:your )?payment/i.test(
        p.raw,
      )
    ) return 'receipt';
    return undefined;
  };

  // The user's own category rules, re-applied to rows this device did not
  // parse.
  //
  // On Android the rule is honoured inside the parser: scanInbox passes
  // `state.merchantOverrides` to parseSms, and guessCategory returns the
  // user's answer with `deliberate: true`. On iOS the parse happens in the
  // Cloudflare Worker, which calls parseSms with no overrides at all — and it
  // must stay that way. Shipping the user's category vocabulary to the relay
  // would put "talabat → groceries" on a server whose entire design is that it
  // holds nothing about the user and keeps nothing after acknowledgement.
  //
  // So the rule is applied here instead, on arrival. Without it, the entry
  // sheet's "just future" was a permanent no-op on iOS: recategorise Talabat
  // to Groceries and every later Talabat charge still landed in Dining, with
  // the user redoing the same correction forever.
  //
  // The discriminator is `raw`. A locally-parsed row always carries the source
  // text (`ParsedSms.raw` is required, and parseSms always fills it); a relay
  // row cannot, because the Worker discards Message Content before sealing —
  // `ParsedRelayRow` is typed `raw?: never` for exactly that reason. Skipping
  // rows that have it is what keeps Android from being run through a second,
  // redundant lookup on a merchant name the parser has already resolved.
  //
  // Rows already in the ledger are not this function's business: an override
  // reaches an existing row only through the two paths below that both refuse
  // to touch `userEdited`, which is what the sheet's "just future" means.
  const overrides = state.merchantOverrides ?? {};
  const billAliases = state.billAliases ?? {};
  const applyMerchantOverride = (p: ScannedSms): ScannedSms => {
    // Bank bill-pay nicknames are not merchant identities. They are learned by
    // the billIdentity-scoped alias pass below; a global merchant override here
    // could turn a Fishbasket utility nickname and a real Fishbasket purchase
    // into the same category.
    if (p.paymentFlowSide === 'receipt') return p;
    if (p.raw !== undefined) return p;
    const hit = overrides[p.merchant.trim().toLowerCase()];
    if (!hit || hit === p.categoryGuess) return p;
    // The SAME direction check `categoryOf` makes, because this is the same
    // decision taken on the other platform. Without it a Talabat refund
    // arriving over the relay was filed `dining` — a category the entry sheet
    // will not draw for a credit, so the row's real category is invisible to
    // the person who opens it. `overrideFitsDirection` states why.
    if (!overrideFitsDirection(hit, p.type)) return p;
    // `categoryDeliberate` is what the parser sets on an override hit, and it
    // is load-bearing in both directions: it keeps the row out of the
    // low-confidence accuracy report, and it is the flag heal.ts requires
    // before a rescan may correct a stored category that is not `other`.
    //
    // `categoryPinned` is the narrower fact — this category is the USER's, not
    // ours — and heal.ts needs it to know not to treat the row as one the
    // parser learned to read. Set here for the same reason `categoryOf` sets
    // it on the Android path: it is the same pin, applied a step later.
    return { ...p, categoryGuess: hit, categoryDeliberate: true, categoryPinned: true };
  };
  const applyBillAlias = (p: ScannedSms): ScannedSms => {
    if (p.paymentFlowSide !== 'receipt' || !p.billIdentity) return p;
    const alias = readBillAlias(billAliases, p.merchant, p.billIdentity);
    if (!alias) return p;
    // A bill-specific human correction outranks a merchant-wide guess. The
    // payment remains the same event: amount/date/account evidence is untouched.
    return {
      ...p,
      merchant: alias.title,
      categoryGuess: alias.category,
      categoryDeliberate: true,
      categoryPinned: true,
    };
  };

  // Prefer the fuller SMS when a notification and SMS for one event are in
  // the same scan. Processing a slightly-earlier push first used to leave the
  // guard with no persisted id to supersede, so both rows were appended.
  const ordered = [
    ...parsed.filter((p) => p.channel !== 'push'),
    ...parsed.filter((p) => p.channel === 'push'),
  ].map(applyMerchantOverride).map(applyBillAlias);

  for (const p of ordered) {
    const date = p.date ?? toISODate(new Date());
    if (p.kind === 'billDue') {
      // Same stale-misread sweep the cardStatement branch does below, and it
      // was missing here — so a reminder the old parser had booked as a real
      // expense stayed in the ledger forever after the parser learned to read
      // it. healPatch cannot help: it rewrites a row, it cannot delete one,
      // and there is no patch that turns an expense into "this never
      // happened". The user who reported it carried twelve AED 775.81 e&
      // charges for bills that were only ever due.
      const staleKey = smsKeyOf(p);
      const misread = (staleKey ? priorBySmsKey.get(staleKey) : undefined) ?? stableLocalPrior(p);
      if (misread && !misread.isTransfer && !misread.userEdited && !misread.transferDecision) {
        updates.push({ id: misread.id, remove: true });
      }
      // A full Android reread and a multi-year iOS history search must not
      // silently resurrect a utility account the user left years ago as a new
      // recurring bill. Only a current reminder becomes a live obligation.
      const historicalBillDate = p.date ?? (
        Number.isFinite(p.smsTs) ? toISODate(new Date(p.smsTs!)) : null
      );
      const staleOrUndatedBill = !historicalBillDate || historicalBillDate < staleDueCutoff;
      if (
        p.merchant !== 'Bill payment' &&
        !staleOrUndatedBill
      ) billDues.push(p);
      continue;
    }
    if (p.kind === 'cardStatement') {
      // A due reminder previously mis-imported as a fake expense gets
      // dropped now that the parser recognizes what it is.
      const staleKey = smsKeyOf(p);
      const misread = (staleKey ? priorBySmsKey.get(staleKey) : undefined) ?? stableLocalPrior(p);
      if (misread && !misread.isTransfer && !misread.userEdited && !misread.transferDecision) {
        updates.push({ id: misread.id, remove: true });
      }
      if (!p.date) continue;
      if (p.date < staleDueCutoff) continue;
      const statementBank = (p.bankHint ? bankFromName(p.bankHint) : null) ?? bankFromSender(p.sender);
      const bankOnlyCandidates = !p.card && statementBank
        ? accountCandidates.filter(
            ({ ref, account }) =>
              account.kind === 'card' &&
              effectiveCardType(ref, account) === 'credit' &&
              account.bankName !== undefined &&
              bankIdentityForName(account.bankName) ===
                bankIdentityForName(statementBank.name),
          )
        : [];
      // A statement without a PAN is useful only when its authenticated sender
      // identifies exactly one credit card. Otherwise keep it staged rather
      // than inventing a card or turning the quoted due into a transaction.
      if (!p.card && bankOnlyCandidates.length !== 1) continue;
      const bankOnlyAccountId = bankOnlyCandidates[0]?.ref;
      const matchingDues = state.cardDues.filter(
        (due) =>
          due.dueDate === p.date &&
          due.totalDueFils === p.amountFils &&
          (p.card
            ? matchesCard(
                due.accountId,
                accountAtRef(due.accountId),
                p.card.last4,
                p.card.kind as ResolvedCardKind,
                statementBank?.name,
              )
            : due.accountId === bankOnlyAccountId),
      );
      const dueAccounts = [...new Set(matchingDues.map((due) => due.accountId))];
      // Two matching obligations are already ambiguous; another reminder is
      // not evidence for choosing one or inventing a third card.
      if (dueAccounts.length > 1) continue;
      const accountId = p.card
        ? resolveAccount(p, dueAccounts[0], true).accountId
        : bankOnlyAccountId ?? '';
      if (!accountId) continue;
      noteSnapshot(accountId, p);
      const existingDue = matchingDues.find((due) => due.accountId === accountId);
      const improvesMinimum =
        existingDue !== undefined &&
        p.minDueFils !== null &&
        (existingDue.minDueEstimated === true || existingDue.minDueFils !== p.minDueFils);
      const removesWrongMarketEstimate =
        existingDue !== undefined &&
        p.currency === 'SAR' &&
        p.minDueFils === null &&
        existingDue.minDueEstimated === true &&
        existingDue.minDueFils !== 0;
      const removesContradictoryMinimum =
        existingDue !== undefined &&
        p.minDueFils === null &&
        existingDue.minDueFils > existingDue.totalDueFils;
      // A parser-version rescan of an identical obligation is idempotent. A
      // newly authoritative minimum, or removing the old UAE-only 5% fallback
      // from a Saudi due, is the reason to re-offer it to the reducer's
      // monotonic due merge.
      // v47 could retain a contradictory minimum above this exact statement's
      // total. Re-offer the corrected unknown minimum so the merge can repair
      // it without resetting payment evidence or weakening a valid minimum.
      // A statement date the stored row lacks is new evidence about the same
      // obligation, and without re-offering it a card imported before the
      // parser could read one never gains it. The deadline-derived fallback
      // only rescues cards whose cycle happens to match the approximation, so
      // every other already-affected user had no repair path at all. Idempotent:
      // once the row carries the date, this stops matching.
      const addsStatementDate =
        existingDue !== undefined &&
        p.statementDate !== undefined &&
        existingDue.statementDate !== p.statementDate;
      if (
        existingDue && !improvesMinimum && !removesWrongMarketEstimate &&
        !removesContradictoryMinimum && !addsStatementDate
      ) continue;
      // The parser reaches this branch only with statement structure and
      // forces card.kind=credit. That is authoritative evidence which upgrades
      // a debit fallback; rejecting it is what stranded real statements.
      newDues.push({
        accountId,
        totalDueFils: p.amountFils,
        // 5% is a common UAE card minimum, but it is not this card's minimum
        // unless the bank said so. A Saudi statement gets no UAE-derived
        // placeholder at all. Both remain flagged so nothing quotes an
        // unstated value back as the bank's figure.
        minDueFils:
          p.minDueFils ?? (p.currency === 'AED' ? estimatedMinimumFils(p.amountFils) : 0),
        minDueEstimated: p.minDueFils === null ? true : undefined,
        dueDate: p.date,
        // What the bank said it closed this statement on, when it said so. The
        // allocator reads it to keep the previous cycle's payment off this
        // statement; see `computePaymentAllocations`.
        ...(p.statementDate ? { statementDate: p.statementDate } : {}),
        paidFils: 0,
      });
      continue;
    }
    if (p.kind === 'cardPayment') {
      const smsKey = smsKeyOf(p);
      const exactPrior = smsKey ? compatiblePrior(smsKey, p) : undefined;
      if (exactPrior) {
        // Admit a date-only correction before account discovery or snapshots;
        // new issuer evidence must not create an unused account as a side effect.
        // A re-import may change this one date only when the parser reproduced
        // the known template error from the exact original Apple Message.
        // Keep this separate from fuzzy healing and from account/role repairs.
        const proof = p.dateRepairFrom && p.date && p.sourceEventId &&
          /^[a-f0-9]{64}$/.test(p.sourceEventId) && p.smsTs !== undefined && exactPrior.captureInstrument
          ? { from: p.dateRepairFrom, to: p.date, sourceKey: `h${p.sourceEventId}`,
              observedAt: p.smsTs, amountFils: p.amountFils, accountId: exactPrior.accountId,
              instrument: { last4: exactPrior.captureInstrument.last4, kind: exactPrior.captureInstrument.kind,
                ...(exactPrior.captureInstrument.bankIdentity ? { bankIdentity: exactPrior.captureInstrument.bankIdentity } : {}) } }
          : undefined;
        if (proof && sourceDateCount(state.transactions, proof.sourceKey) === 1 &&
            p.cardPaymentSide === 'receipt' && exactPrior.captureInstrument && p.card &&
            compatibleCaptureInstrument(exactPrior.captureInstrument, captureInstrumentOf(p)) &&
            canApplySourceDateCorrection(exactPrior, proof)) {
          updates.push({ id: exactPrior.id, sourceDateCorrection: proof });
          continue;
        }
      }
      const stablePrior = exactPrior ?? stableLocalPrior(p);
      const prior = stablePrior;
      const resolution = resolveAccount(p, prior?.accountId);
      const { accountId } = resolution;
      if (!accountId) continue;
      if (resolution.confident) noteSnapshot(accountId, p);
      const cardPaymentSide = cardPaymentSideOf(p);
      if (exactPrior) {
        // Exact retained-message identity is already one-to-one. Do not build
        // the generalized duplicate/cross-channel indexes just to rediscover
        // the same row during a parser backfill.
        healFromReparse(
          smsKey,
          p,
          resolution.confident ? accountId : undefined,
          cardPaymentSide,
          exactPrior,
        );
        continue;
      }
      if (!exactPrior && stablePrior) {
        healFromReparse(
          undefined,
          p,
          resolution.confident ? accountId : undefined,
          cardPaymentSide,
          stablePrior,
        );
        continue;
      }
      // A card payment lands as income into the card account.
      const candidate = {
        date, amountFils: p.amountFils, title: p.merchant,
        type: 'income' as const, smsKey, ts: p.smsTs, channel: p.channel, raw: p.raw,
        captureSource: p.captureSource,
        accountId, eventKind: 'cardPayment' as const, cardPaymentSide,
        captureInstrument: captureInstrumentOf(p),
      };
      const duplicate = guard();
      if (duplicate.has(candidate)) {
        const matchedId = duplicate.takeMatchedId();
        const matchedPrior = matchedId ? priorById().get(matchedId) : undefined;
        const matchedOppositeSettlementSide =
          matchedPrior?.cardPaymentSide !== undefined &&
          cardPaymentSide !== undefined &&
          matchedPrior.cardPaymentSide !== cardPaymentSide;
        if (p.sourceEventId && matchedId && !matchedOppositeSettlementSide) {
          // Preserve the one-to-one live/history pairing in the actual batch.
          // Otherwise h1 is discarded here, h2 reaches the reducer alone and
          // fuzzy reconciliation folds h2 into the still-live row as well.
          promoteMatchedHistory(
            matchedId,
            smsKey!,
            p,
            resolution.confident ? accountId : undefined,
            cardPaymentSide,
          );
          duplicate.consumeCapture(matchedId);
        }
        // A row imported as a plain expense before this message was
        // recognized as a card payment becomes a transfer now.
        healFromReparse(
          smsKey,
          p,
          resolution.confident ? accountId : undefined,
          cardPaymentSide,
        );
        continue;
      }
      duplicate.add(candidate);
      transactions.push({
        type: 'income', // money arriving INTO the card account
        amountFils: p.amountFils,
        category: 'other',
        accountId,
        title: p.merchant,
        date,
        ts: p.smsTs,
        source: 'sms',
        smsKey,
        captureSource: p.captureSource,
        cardPaymentSide,
        isTransfer: true,
        captureInstrument: captureInstrumentOf(p),
      });
      continue;
    }
    // Plain transaction. transferHint = the bank-side leg of a card payment /
    // own-account transfer: keep it for balances, exclude it from spending.
    const smsKey = smsKeyOf(p);
    const exactPrior = smsKey ? compatiblePrior(smsKey, p) : undefined;
    const sourceCorrectionPrior = exactPrior ? undefined : legacyTransferSourcePrior(p);
    const stablePrior = exactPrior ?? stableLocalPrior(p) ?? sourceCorrectionPrior;
    const prior = stablePrior;
    const captureCandidate = {
      date, amountFils: p.amountFils, title: p.merchant,
      type: p.type, smsKey, ts: p.smsTs, channel: p.channel, raw: p.raw,
      captureSource: p.captureSource,
      eventKind: 'transaction' as const,
      captureInstrument: captureInstrumentOf(p),
    };
    const protectedEditedPush = exactPrior ? undefined : protectedEditedPushFor(p, date);
    if (protectedEditedPush && smsKey) {
      protectedEditedPushConsumed.add(protectedEditedPush.id);
      protectedReplacementCandidates.push(captureCandidate);
      // This is deliberately the rare escape hatch that may instantiate the
      // generalized matcher: preserving a user-edited push needs its consumed
      // state reflected immediately so a second genuine SMS cannot reuse it.
      const duplicate = guard();
      duplicate.consume(protectedEditedPush.id);
      duplicate.add(captureCandidate);
      if (p.sourceEventId) {
        promoteMatchedHistory(protectedEditedPush.id, smsKey, p);
      }
      continue;
    }
    if (sourceCorrectionPrior?.userEdited && smsKey) {
      // Promote technical identity only. Resolving a new account first would
      // create an unused account even though the user's assignment is kept.
      promoteMatchedHistory(sourceCorrectionPrior.id, smsKey, p);
      const duplicate = guard();
      duplicate.consume(sourceCorrectionPrior.id);
      duplicate.add(captureCandidate);
      continue;
    }
    // Cross-channel supersession has to run before account resolution because
    // a protected push row may already be the one durable event. Resolving the
    // fuller SMS first can mint an unused account even though the SMS is then
    // deduped against that user-edited push. Exact retained-message identities
    // skip this entirely and stay on the lightweight history fast path.
    if (!exactPrior) {
      const duplicate = guard();
      const protectedSupersededId = duplicate.supersedes(captureCandidate);
      if (protectedSupersededId && priorById().get(protectedSupersededId)?.userEdited) {
        duplicate.consume(protectedSupersededId);
        if (p.sourceEventId && smsKey) {
          promoteMatchedHistory(protectedSupersededId, smsKey, p);
        }
        duplicate.add(captureCandidate);
        continue;
      }
    }
    // A proven business receipt without a readable instrument is money in,
    // not permission to attach it to the first (possibly hidden) bank account.
    // Preserve old explicit/user assignments. Only the reproduced partial-mask
    // format can repair an existing fallback through exact source identity.
    const partialAccount = p.raw?.match(/\baccount\s+(?:no\.?|number)?\s*[:#]?\s*([0-9xX*]{4,40})(?![0-9xX*])/i)?.[1];
    const provenPartialMask = !!partialAccount && /[x*][0-9]{1,3}$/i.test(partialAccount);
    const unassignedIncome = !p.card && p.type === 'income' && p.categoryGuess === 'business' &&
      p.categoryDeliberate && !p.transferHint && !prior?.userEdited && !prior?.captureInstrument &&
      (!prior || provenPartialMask || prior.accountId === UNASSIGNED_INCOME_ACCOUNT_ID);
    const resolution = unassignedIncome
      ? { accountId: UNASSIGNED_INCOME_ACCOUNT_ID, confident: false }
      : resolveAccount(p, prior?.accountId, false, !prior?.userEdited);
    const { accountId } = resolution;
    if (!accountId) continue;
    if (resolution.confident) noteSnapshot(accountId, p);
    const healedAccountId = resolution.confident || unassignedIncome ||
      (!prior?.userEdited && !prior?.captureInstrument && accountId === UNASSIGNED_TRANSACTION_ACCOUNT_ID) ||
      (!prior?.userEdited && isUnassignedTransferAccount(accountId)) ? accountId : undefined;
    if (exactPrior) {
      healFromReparse(smsKey, p, healedAccountId, undefined, exactPrior);
      continue;
    }
    const duplicate = guard();
    const statementPrior = !exactPrior && !stablePrior && resolution.confident
      ? statementTransferPrior(p, accountId)
      : undefined;
    if (statementPrior) {
      healFromReparse(undefined, p, accountId, undefined, statementPrior);
      duplicate.consume(statementPrior.id);
      duplicate.add({ ...captureCandidate, accountId });
      continue;
    }
    const accountForMatchedPrior = (matched: Transaction | undefined) =>
      (unassignedIncome || accountId === UNASSIGNED_TRANSACTION_ACCOUNT_ID) &&
        (matched?.captureInstrument || matched?.userEdited)
        ? undefined : healedAccountId;
    if (sourceCorrectionPrior && smsKey) {
      promoteMatchedHistory(sourceCorrectionPrior.id, smsKey, p, healedAccountId);
      duplicate.consume(sourceCorrectionPrior.id);
      duplicate.add({ ...captureCandidate, accountId });
      continue;
    }
    if (!exactPrior && stablePrior) {
      healFromReparse(
        undefined,
        p,
        healedAccountId,
        undefined,
        stablePrior,
      );
      continue;
    }
    const candidate = { ...captureCandidate, accountId };
    if (duplicate.has(candidate)) {
      const matchedId = duplicate.takeMatchedId();
      const matchedPrior = matchedId ? priorById().get(matchedId) : undefined;
      if (p.sourceEventId && matchedId) {
        // Promote the matched live capture to the exact retained-Message key.
        // The next distinct history GUID can then survive reducer hydration.
        promoteMatchedHistory(
          matchedId,
          smsKey!,
          p,
          accountForMatchedPrior(matchedPrior),
        );
        // One stored row is indexed by both title and capture channel. A
        // history match consumes it in both places or h2 can reuse the push
        // index after h1 consumed the title index.
        duplicate.consume(matchedId);
      } else {
        // An older notification row can match this authoritative SMS through
        // the duplicate index while having a different timestamp/s-key. Heal
        // the row we actually matched so newly learned accounting roles reach
        // existing ledgers instead of only clean imports.
        healFromReparse(
          smsKey,
          p,
          accountForMatchedPrior(matchedPrior),
          undefined,
          matchedPrior,
        );
      }
      continue;
    }
    // The same charge already in the ledger from a bank-app notification.
    // The SMS is the better read, so it rewrites that row rather than
    // becoming a second one.
    const supersededId = duplicate.supersedes(candidate);
    if (supersededId) {
      if (!priorById().get(supersededId)?.userEdited) {
        const transferEvidence = buildTransferEvidence(p, resolution.confident);
        updates.push({
          id: supersededId,
          title: p.merchant,
          category: p.categoryGuess,
          type: p.type,
          ...(accountForMatchedPrior(priorById().get(supersededId)) ? { accountId } : {}),
          ts: p.smsTs,
          smsKey,
          viaPush: false,
          ...(p.card ? { captureInstrument: mergeCaptureInstrument(
            captureInstrumentOf(p), priorById().get(supersededId)?.captureInstrument) } : {}),
          isTransfer: p.transferHint,
          ...(transferEvidence ? { transferEvidence } : {}),
          ...(priorById().get(supersededId)?.transferEvidence && !transferEvidence
            ? { clearTransferEvidence: true as const } : {}),
          paymentFlowSide: p.paymentFlowSide,
          billIdentity: p.billIdentity,
          paymentInstrumentSource:
            resolution.confident && p.paymentFlowSide === 'receipt' && p.card
              ? 'alert'
              : undefined,
        });
      }
      // One notification is one charge. Two AED 25 SMS a minute apart used to
      // supersede the SAME push row twice; the store keys patches by id and
      // keeps the last, so the first message's charge was never written at
      // all — AED 25 of spending gone, with no duplicate to hint at it.
      duplicate.consume(supersededId);
      duplicate.add(candidate);
      continue;
    }
    duplicate.add(candidate);
    // Low-confidence rows keep their source text so the user can report
    // unrecognized bank formats from Settings → Improve accuracy.
    // Structurally-understood rows (ATM, VAT, transfers...) stay out.
    // `categoryDeliberate` is the difference between "other" as an answer and
    // "other" as a shrug. Brokerages and crypto on-ramps are mapped to other on
    // purpose; without this the report asked the user to send in formats the
    // parser reads perfectly, which is most of what a 177-entry export was.
    const lowConfidence =
      !p.transferHint &&
      p.type === 'expense' &&
      (p.merchant === 'Card purchase' ||
        (p.categoryGuess === 'other' &&
          !p.categoryDeliberate &&
          !STRUCTURAL_TITLES.has(p.merchant)));
    transactions.push({
      type: p.type,
      amountFils: p.amountFils,
      originalAmountMinor: p.originalAmountMinor,
      originalCurrency: p.originalCurrency,
      fxRate: p.fxRate,
      fxSource: p.fxSource,
      category: p.categoryGuess,
      accountId,
      title: p.merchant,
      date,
      ts: p.smsTs,
      source: 'sms',
      captureInstrument: captureInstrumentOf(p),
      smsKey,
      viaPush: p.channel === 'push' || undefined,
      ...(p.channel === 'push' && p.captureSource === undefined && p.sourceEventId === undefined &&
        typeof p.notificationObservationId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.notificationObservationId)
        ? { notificationObservationId: p.notificationObservationId } : {}),
      captureSource: p.captureSource,
      isTransfer: p.transferHint || undefined,
      transferEvidence: buildTransferEvidence(p, resolution.confident),
      paymentFlowSide: p.paymentFlowSide,
      billIdentity: p.billIdentity,
      paymentInstrumentSource:
        resolution.confident && p.paymentFlowSide === 'receipt' && p.card
          ? 'alert'
          : undefined,
      // Relay/email/PDF ingestion deliberately discards the source body
      // before this device sees the structured row. Keep a diagnostic excerpt
      // only on Android's local parser path, where one actually exists.
      raw: lowConfidence ? p.raw?.slice(0, 300) : undefined,
    });
  }

  // ── Rows an older parser imported from a DECLINE ────────────────────────
  //
  // A declined transaction moved no money, so the row is not a mislabelled
  // expense — it is an event that never happened, and healing (which only ever
  // adds information to a row) has no way to take it back. The two branches
  // above already do exactly this for a bill reminder that was booked as a
  // real expense; a decline is the same shape of mistake with no `p` to hang
  // it off, because a suppressed message parses to null.
  //
  // The join is the SMS timestamp alone — a decline has no parsed amount, so
  // the `s{ts}-{amount}` smsKey cannot be reconstructed from it. Five things
  // stand between that and deleting a row some OTHER message produced:
  //
  //  1. The timestamp is exact, to the millisecond, and it is the phone's own
  //     record of when the message arrived. Two different messages landing on
  //     the same millisecond is the only way a wrong row can be reached at all.
  //  2. A timestamp this scan re-read into something the parser still
  //     understands is off limits. On the full re-read a version bump forces,
  //     `parsed` is the whole inbox, so any live transaction sitting on that
  //     millisecond takes its own timestamp out of play.
  //  3. Exactly one stored row may sit on the timestamp. Two rows cannot both
  //     have come from one decline and nothing here can say which did.
  //  4. The row's own date must be near the message. A stale or reused
  //     timestamp from another era is the only realistic collision, and this
  //     rejects it outright; a week is far wider than the drift between an
  //     alert's stated date and when the bank sent it.
  //  5. If the row kept its source text, that text must itself read as a
  //     decline. This is the guard that protects the class of row the ledger
  //     migration was built around: two genuine purchases whose stored body
  //     carries a masked figure (`THB ····9260.00`) the parser refuses on
  //     purpose. They no longer parse, but they do not read as refusals, and
  //     nothing may delete them.
  //
  // Plus the guards the sweep above uses: never a transfer, never a row the
  // user has edited, never a split (its parts are their own rows), and never a
  // row this device did not import from a message.
  let declineReconciledCount = 0;
  const declineReconciledIds: string[] = [];
  const declineReconciliations: ImportPlan['declineReconciliations'] = [];
  if (declined.length > 0) {
    // Same derivation dedupe.ts uses: prefer the stored timestamp, fall back to
    // the one inside `s{ts}-{amount}` for rows that predate the `ts` column.
    const rowTs = (t: Transaction): number | undefined => {
      if (Number.isFinite(t.ts)) return t.ts;
      const m = t.smsKey?.match(/^s(\d+)-/);
      return m ? Number(m[1]) : undefined;
    };
    const parsedTs = new Set<number>();
    for (const p of parsed) if (p.smsTs !== undefined) parsedTs.add(p.smsTs);
    const rowsByTs = new Map<number, Transaction[]>();
    for (const t of matchableTransactions()) {
      const ts = rowTs(t);
      if (ts === undefined) continue;
      const bucket = rowsByTs.get(ts);
      if (bucket) bucket.push(t);
      else rowsByTs.set(ts, [t]);
    }
    const NEAR_MS = 7 * 86400000;
    const swept = new Set<string>();
    for (const d of declined) {
      if (d.reason === 'exact-provider-duplicate') {
        if (!d.sourceEventId) continue;
        const row = priorBySmsKey.get(canonicalCaptureSourceKey(`h${d.sourceEventId}`, d.smsTs));
        if (!row || swept.has(row.id)) continue;
        // The scanner already proved byte-identical body, sender, adjacent
        // provider ids and sub-second delivery. Preserve anything user-owned.
        if (row.source !== 'sms' || row.userEdited || row.transferDecision || row.splits) continue;
        swept.add(row.id);
        updates.push({ id: row.id, remove: true });
        declineReconciledCount += 1;
        if (d.localRecordId) {
          declineReconciledIds.push(d.localRecordId);
          declineReconciliations.push({
            localRecordId: d.localRecordId,
            removedTransactionId: row.id,
          });
        }
        continue;
      }
      if (d.sourceEventId) {
        // Historical Shortcut timestamps are commonly rounded to a second,
        // so timestamp equality is not identity. Only a row imported from the
        // exact same GUID-derived Message may be swept as a prior misparse.
        const row = priorBySmsKey.get(canonicalCaptureSourceKey(`h${d.sourceEventId}`, d.smsTs));
        if (!row || swept.has(row.id)) continue;
        if (row.source !== 'sms') continue;
        if (row.userEdited || row.transferDecision || row.isTransfer || row.splits) continue;
        if (row.raw !== undefined && !isNonPostingMessage(row.raw)) continue;
        swept.add(row.id);
        updates.push({ id: row.id, remove: true });
        declineReconciledCount += 1;
        if (d.localRecordId) {
          declineReconciledIds.push(d.localRecordId);
          declineReconciliations.push({
            localRecordId: d.localRecordId,
            removedTransactionId: row.id,
          });
        }
        continue;
      }
      if (!Number.isFinite(d.smsTs) || parsedTs.has(d.smsTs)) continue;
      const rows = rowsByTs.get(d.smsTs);
      if (!rows || rows.length !== 1) continue;
      const row = rows[0];
      if (swept.has(row.id)) continue;
      if (row.source !== 'sms') continue;
      if (row.userEdited || row.transferDecision || row.isTransfer || row.splits) continue;
      if (Math.abs(Date.parse(`${row.date}T12:00:00Z`) - d.smsTs) > NEAR_MS) continue;
      if (row.raw !== undefined && !isNonPostingMessage(row.raw)) continue;
      swept.add(row.id);
      updates.push({ id: row.id, remove: true });
      declineReconciledCount += 1;
      if (d.localRecordId) {
        declineReconciledIds.push(d.localRecordId);
        declineReconciliations.push({
          localRecordId: d.localRecordId,
          removedTransactionId: row.id,
        });
      }
    }
  }

  // A balance may have been noted while the card kind was still unknown and
  // authoritative credit evidence may have arrived later in the same batch.
  for (const [ref, type] of Object.entries(cardTypes)) {
    if (type === 'credit' && snapshots[ref]?.kind === 'balance') {
      snapshots[ref] = { ...snapshots[ref], kind: 'limit' };
    }
  }

  // A long history can contain many reminders from the same merchant. The
  // most recent one is the current amount/due day; filing the first
  // (chronologically oldest) reminder quietly created stale recurring bills.
  const billImportIdentity = (due: ScannedSms): string | null => {
    // A generic transaction/invoice reference changes each billing cycle. It
    // is dedupe evidence for one alert, never the identity of the obligation;
    // treating it as such creates a second monthly reminder every month.
    return due.billIdentity ?? null;
  };
  const latestUnidentifiedCycle = billDues.reduce((latest, due) => {
    if (billImportIdentity(due)) return latest;
    const merchant = due.merchant.trim().toLowerCase();
    const cycle = due.date?.slice(0, 7) ?? '';
    if (cycle > (latest.get(merchant) ?? '')) latest.set(merchant, cycle);
    return latest;
  }, new Map<string, string>());
  const latestBillDues = [...billDues.reduce((latest, due) => {
    // Keep separately referenced accounts distinct when the bank supplies an
    // account/reference identity, while still collapsing monthly repeats.
    const merchant = due.merchant.trim().toLowerCase();
    const identity = billImportIdentity(due);
    const cycle = due.date?.slice(0, 7) ?? '';
    // With no account identity, retain distinct obligations from the newest
    // provider cycle (amount/day are the only structured facts available),
    // but never resurrect the same provider's previous month beside it.
    if (!identity && cycle !== latestUnidentifiedCycle.get(merchant)) return latest;
    const key = identity
      ? `${merchant}|${identity}`
      : `${merchant}|unidentified|${due.amountFils}|${due.dueDay ?? due.date?.slice(8) ?? ''}`;
    const prior = latest.get(key);
    const dueTime = due.smsTs ?? Date.parse(`${due.date ?? '1970-01-01'}T00:00:00Z`);
    const priorTime = prior?.smsTs ?? Date.parse(`${prior?.date ?? '1970-01-01'}T00:00:00Z`);
    if (!prior || dueTime >= priorTime) latest.set(key, due);
    return latest;
  }, new Map<string, ScannedSms>()).values()];

  for (const due of latestBillDues) {
    const dueDay = due.dueDay ?? (due.date ? Number(due.date.slice(8)) : 0);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) continue;
    const importIdentity = billImportIdentity(due);
    newBills.push({
      title: due.merchant,
      category: due.categoryGuess,
      amountFils: due.amountFils,
      dueDay,
      autoDetected: true,
      ...(importIdentity ? { importIdentity } : {}),
    });
  }

  // A tail shared by different accounts cannot be a new global routing hint.
  // Keep issuer/kind-scoped hints, and leave an older stored hint untouched:
  // its resolver still has to prove a unique compatible account. Without this
  // check the first scan and its replay alternated the same tail between banks.
  const tailCounts = new Map<string, number>();
  for (const { account } of accountCandidates) {
    if (account.last4) tailCounts.set(account.last4, (tailCounts.get(account.last4) ?? 0) + 1);
  }
  for (const key of Object.keys(newHints)) {
    if (/^\d{4}$/.test(key) && (tailCounts.get(key) ?? 0) > 1) delete newHints[key];
  }

  return {
    batch: {
      transactions,
      newAccounts,
      newHints,
      newDues,
      newBills,
      snapshots,
      bankNames,
      cardTypes,
      confirmedLedgerCurrency: confirmedLedgerCurrency(parsed),
      importMoney: importMoney ?? undefined,
      lastScanTs: newestTs,
      updates,
    },
    txCount: transactions.length,
    newAccountCount: newAccounts.length,
    dueCount: newDues.length,
    healedCount: updates.length,
    declineReconciledCount,
    declineReconciledIds,
    declineReconciliations,
    billDues: latestBillDues,
  };
}

/** Track one reviewed reminder without importing or acknowledging its siblings. */
export function buildTrackedBillBatch(
  reminder: ScannedSms,
  state: AppState,
  today: Date = new Date(),
): ImportBatchInput | null {
  if (reminder.kind !== 'billDue') return null;
  const plan = buildImportPlan([reminder], state, state.lastScanTs, today);
  const bill = plan.batch.newBills?.[0];
  if (!bill) return null;
  return {
    ...emptyPlan().batch,
    importMoney: plan.batch.importMoney,
    confirmedLedgerCurrency: plan.batch.confirmedLedgerCurrency,
    newBills: [bill],
    lastScanTs: state.lastScanTs,
  };
}
