import { captureSourceTimeMatches, isValidAndroidSourceKey } from '@/lib/capture-source-identity';
import { sanitizeUniversalReviewEvent } from '@/lib/generic-review-entry';
import { canonicalUniversalSourceKey } from '@/lib/universal-import';
import type { UniversalBankEvent } from '@/lib/universal-types';
import type { AlertFamily, MoneyDirection } from '@/lib/alert-market-pack-types';
import type { DetectedMarket, UniversalAlertReview } from '@/lib/alert-market-detection';
import type { InstitutionGrammarMetadata } from '@/lib/alert-institution-grammars';
import type { UnparsedLaunchAlertReview } from '@/lib/unparsed-launch-alert';
import { sharedAlertShapeHash, validateSharedAlertShape, type SharedAlertShape } from '@/lib/shared-alert-formats';

/**
 * Value-free candidate for anonymous format sharing, built while the alert text
 * was in memory. `shareShape` holds no values and no text; `shareBasis` is the
 * reading the shape was built from, stays on the phone, and is never uploaded.
 */
export interface ReviewShareCandidate {
  shareShape: SharedAlertShape;
  shareHash: string;
  shareBasis: { amountMinor: number; currency: string; direction: 'debit' | 'credit' };
}

/** Re-validate a stored candidate; anything off drops it (never the Review item). */
export const validateReviewShareCandidate = (value: unknown): ReviewShareCandidate | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ReviewShareCandidate>;
  const shape = validateSharedAlertShape(v.shareShape);
  const basis = v.shareBasis as ReviewShareCandidate['shareBasis'] | undefined;
  if (!shape || typeof v.shareHash !== 'string' || v.shareHash !== sharedAlertShapeHash(shape) ||
    !basis || typeof basis !== 'object' || !Number.isSafeInteger(basis.amountMinor) || basis.amountMinor <= 0 ||
    typeof basis.currency !== 'string' || !/^[A-Z]{3}$/.test(basis.currency) ||
    (basis.direction !== 'debit' && basis.direction !== 'credit') ||
    basis.currency !== shape.currency || basis.direction !== shape.direction) return null;
  return { shareShape: shape, shareHash: v.shareHash,
    shareBasis: { amountMinor: basis.amountMinor, currency: basis.currency, direction: basis.direction } };
};

export const REVIEW_ALERT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REVIEW_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const REVIEW_ALERT_CAP = 50;
export const REVIEW_TOMBSTONE_CAP = 1000;
export const REVIEW_TEMPLATE_RULE_CAP = 200;
const APPLE_MESSAGE_ID_RE = /^[0-9a-f]{64}$/;

/** Mirrors WafraLiveCaptureStore.maxApplePayCardOrPassCharacters (UTF-16 units). */
export const MAX_WALLET_CARD_NAME_LENGTH = 80;
const UNSAFE_WALLET_CARD_RE = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;

/**
 * Wallet's "Card or Pass" text exactly as the native sanitizer emits it:
 * non-empty, trimmed, single ASCII spaces, bounded, no unsafe or lone
 * surrogate scalars. Anything else is not a card name this app trusts.
 */
export const usableWalletCardName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_WALLET_CARD_NAME_LENGTH &&
  value === value.replace(/\s+/gu, ' ').trim() && !UNSAFE_WALLET_CARD_RE.test(value) &&
  Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint < 0xd800 || codePoint > 0xdfff;
  });

/** One source-free review identity shared by local capture and history import. */
export const appleMessageReviewIdentity = (
  messageId: string,
): { id: string; sourceKey: string } | null => APPLE_MESSAGE_ID_RE.test(messageId)
  ? {
      id: `apple_message_review_id_${messageId}`,
      sourceKey: `apple_message_review_source_${messageId}`,
    }
  : null;

type ReviewableFamily = Extract<AlertFamily,
  'purchase' | 'transfer' | 'cash-withdrawal' | 'refund' | 'fee' | 'utility' | 'recurring-payment'>;

/**
 * Why a review needs a closer look before adding. A notification replay may be
 * an OS re-delivery; a possible Apple Pay duplicate is a bank alert that
 * nearly matches an already-recorded Wallet purchase. Both only ask.
 */
export type ReviewAttentionReason = 'possible-notification-replay' | 'possible-apple-pay-duplicate';

export interface ReviewAlert {
  attentionReason?: ReviewAttentionReason;
  /** possible-apple-pay-duplicate only: the Wallet row "Already recorded" binds to. */
  walletTransactionId?: string;
  kind?: 'registered';
  id: string;
  sourceKey: string;
  /** Device-keyed fingerprint of the stable alert shape; never raw text. */
  templateKey?: string;
  observedAt: number;
  expiresAt: number;
  channel: 'inbox' | 'delivery' | 'push' | 'shortcut' | 'email' | 'pdf';
  parserVersion: number;
  market: DetectedMarket;
  institution: string;
  grammar: InstitutionGrammarMetadata;
  amount: { currency: string; minorUnits: string; exponent: number };
  direction: Extract<MoneyDirection, 'debit' | 'credit'>;
  family: ReviewableFamily;
  rail: string | null;
  instrument: { kind: 'card' | 'account' | 'wallet'; last4: string | null } | null;
  /** Android app provenance only; never notification text. */
  sourcePackage?: string;
  sourceClass?: 'trusted-bank' | 'play-finance' | 'financial-candidate';
}

export interface UniversalReviewAlert {
  attentionReason?: ReviewAttentionReason;
  /** possible-apple-pay-duplicate only: the Wallet row "Already recorded" binds to. */
  walletTransactionId?: string;
  kind: 'universal';
  id: string;
  sourceKey: string;
  observedAt: number;
  expiresAt: number;
  channel: ReviewAlert['channel'] | 'paste';
  parserVersion: number;
  event: UniversalBankEvent;
  /**
   * A money movement in a currency this ledger cannot hold. Review shows it,
   * promotion refuses it, and it lives in its own bounded lane so it can never
   * occupy Message review space or hold capture back.
   */
  currencyConflict?: true;
  /** Android app provenance only; never notification text. */
  sourcePackage?: string;
  sourceClass?: 'trusted-bank' | 'play-finance' | 'financial-candidate';
  /**
   * iOS Apple Pay reviews only: Wallet's sanitized "Card or Pass" name. On
   * device only; confirming the review remembers this card's account.
   */
  walletCardOrPass?: string;
  /** Optional, value-free format-sharing candidate; see ReviewShareCandidate. */
  shareShape?: ReviewShareCandidate['shareShape'];
  shareHash?: ReviewShareCandidate['shareHash'];
  shareBasis?: ReviewShareCandidate['shareBasis'];
}

export type ReviewEntry = ReviewAlert | UniversalReviewAlert;
/** Distinct native receipt namespaces share the non-evicting iOS quota. */
export const isIosNotificationReview = (item: Pick<ReviewEntry, 'channel' | 'sourceKey'>): boolean =>
  item.channel === 'push' && /^local_review_source_[a-f0-9]{32}$/.test(item.sourceKey);
export const isIosApplePayReview = (item: Pick<ReviewEntry, 'channel' | 'sourceKey'>): boolean =>
  item.channel === 'push' && /^apple_pay_review_source_[a-f0-9]{32}$/.test(item.sourceKey);
export const isProtectedIosCaptureReview = (item: Pick<ReviewEntry, 'channel' | 'sourceKey'>): boolean =>
  isIosNotificationReview(item) || isIosApplePayReview(item);
export const isUniversalReviewAlert = (item: ReviewEntry): item is UniversalReviewAlert =>
  item.kind === 'universal';
export const isCurrencyConflictReview = (item: ReviewEntry): boolean =>
  isUniversalReviewAlert(item) && item.currencyConflict === true;
/** A bank alert withheld as a possible duplicate of an already-posted Apple Pay row. */
export const isWalletDuplicateReview = (item: ReviewEntry): boolean =>
  (item as { attentionReason?: unknown }).attentionReason === 'possible-apple-pay-duplicate';
/**
 * Four independent lanes of up to fifty: foreign-currency money reviews,
 * iOS notification/Wallet reviews, possible Apple Pay duplicates, and the
 * Message/relay/history lane. Possible duplicates have their own lane (CEO
 * d81a0462) so a Message lane full of money can never defer them into a
 * second posting next to the Apple Pay row.
 */
type ReviewLane = 'currency' | 'protected' | 'wallet-duplicate' | 'legacy';
const reviewLane = (item: ReviewEntry): ReviewLane =>
  isCurrencyConflictReview(item) ? 'currency'
    : isProtectedIosCaptureReview(item) ? 'protected'
      : isWalletDuplicateReview(item) ? 'wallet-duplicate' : 'legacy';

export interface UniversalReviewAdmissionInput {
  id: string;
  sourceKey: string;
  observedAt: number;
  channel: ReviewAlert['channel'] | 'paste';
  parserVersion?: number;
  event: UniversalBankEvent;
  shareShape?: unknown;
  shareHash?: unknown;
  shareBasis?: unknown;
}

export const prepareUniversalReviewAlert = (
  input: UniversalReviewAdmissionInput,
): UniversalReviewAlert | null => {
  if (!input || !opaqueKey(input.id) || !reviewSourceKey(input.sourceKey) ||
    !validTimestamp(input.observedAt) || !captureSourceTimeMatches(input.sourceKey, input.observedAt) || !UNIVERSAL_REVIEW_CHANNELS.includes(input.channel)) return null;
  const event = sanitizeUniversalReviewEvent(input.event);
  const parserVersion = input.parserVersion ?? event?.version;
  if (!event || !Number.isSafeInteger(parserVersion) || parserVersion! < 1) return null;
  const expiresAt = input.observedAt + REVIEW_ALERT_TTL_MS;
  if (!validTimestamp(expiresAt)) return null;
  const share = input.shareShape === undefined ? null : validateReviewShareCandidate(input);
  return { kind: 'universal', id: input.id, sourceKey: input.sourceKey,
    observedAt: input.observedAt, expiresAt, channel: input.channel,
    parserVersion: parserVersion!, event, ...(share ? share : {}) };
};

export interface ReviewTemplateRule {
  templateKey: string;
  market: ReviewAlert['market'];
  institution: string;
  direction: ReviewAlert['direction'];
  family: ReviewAlert['family'];
  type: 'expense' | 'income';
  title: string;
  category: string;
  accountId: string;
  betweenOwnAccounts: boolean;
  confirmations: number;
  updatedAt: number;
}

export interface ReviewTombstone {
  sourceKey: string;
  resolvedAt: number;
  expiresAt: number;
  /**
   * `expired` records an unresolved review that aged out before the user saw
   * it. `evicted` records a possible money movement the full Message lane
   * could not keep; `currency-evicted` records the same for the bounded
   * foreign-currency lane. `duplicate-posted` records a possible Apple Pay
   * duplicate that was posted because even its own lane was full. All of
   * these are counted on the Review screen.
   */
  outcome: 'added' | 'dismissed' | 'duplicate' | 'expired' | 'evicted' | 'currency-evicted' | 'duplicate-posted';
}

const TOMBSTONE_OUTCOMES: readonly ReviewTombstone['outcome'][] = [
  'added', 'dismissed', 'duplicate', 'expired', 'evicted', 'currency-evicted', 'duplicate-posted',
];
/** Outcomes a user or promotion decision may record; loss outcomes are system-only. */
export type ReviewResolutionOutcome = Extract<ReviewTombstone['outcome'], 'added' | 'dismissed' | 'duplicate'>;
const isResolutionOutcome = (outcome: ReviewTombstone['outcome']): outcome is ReviewResolutionOutcome =>
  outcome === 'added' || outcome === 'dismissed' || outcome === 'duplicate';

/**
 * Keep at most REVIEW_TOMBSTONE_CAP tombstones. User/promotion resolutions
 * are dedupe barriers that stop a dismissed or posted alert from returning,
 * so they are kept first. 'expired' is also a barrier (an expired source is a
 * settled, counted-once loss that must never be staged again), so it ranks
 * next. Eviction records (evicted/currency-evicted) only feed the Review
 * counts and are trimmed first. Within each tier the newest survive.
 */
const capTombstones = (tombstones: ReviewTombstone[]): ReviewTombstone[] => {
  if (tombstones.length <= REVIEW_TOMBSTONE_CAP) return tombstones;
  const resolutions = tombstones.filter((item) => isResolutionOutcome(item.outcome))
    .slice(-REVIEW_TOMBSTONE_CAP);
  const expiredRoom = REVIEW_TOMBSTONE_CAP - resolutions.length;
  const expired = expiredRoom > 0
    ? tombstones.filter((item) => item.outcome === 'expired').slice(-expiredRoom) : [];
  const room = expiredRoom - expired.length;
  const losses = room > 0
    ? tombstones.filter((item) => !isResolutionOutcome(item.outcome) && item.outcome !== 'expired').slice(-room) : [];
  const kept = new Set([...resolutions, ...expired, ...losses]);
  return tombstones.filter((item) => kept.has(item));
};

export interface AlertReviewTrayState {
  schemaVersion: 1;
  pending: ReviewEntry[];
  tombstones: ReviewTombstone[];
  templateRules: ReviewTemplateRule[];
}

/** Consent turned off: no item keeps a sharing candidate. Returns the same tray when nothing changes. */
export const stripReviewShareCandidates = (tray: AlertReviewTrayState): AlertReviewTrayState => {
  if (!tray.pending.some((item) => isUniversalReviewAlert(item) &&
    (item.shareShape || item.shareHash || item.shareBasis))) return tray;
  return { ...tray, pending: tray.pending.map((item) => {
    if (!isUniversalReviewAlert(item)) return item;
    const { shareShape: _shape, shareHash: _hash, shareBasis: _basis, ...rest } = item;
    return rest;
  }) };
};

export interface ReviewAdmissionInput {
  id: string;
  sourceKey: string;
  observedAt: number;
  channel: ReviewAlert['channel'];
  inspection: UniversalAlertReview;
}

export interface ReviewAdmissionResult {
  state: AlertReviewTrayState;
  outcome: 'admitted' | 'duplicate' | 'refused' | 'deferred' | 'expired';
  reason?: string;
}

export interface LaunchReviewAdmissionInput {
  id: string;
  sourceKey: string;
  observedAt: number;
  channel: ReviewAlert['channel'];
  review: UnparsedLaunchAlertReview;
}

export const emptyAlertReviewTray = (): AlertReviewTrayState => ({
  schemaVersion: 1,
  pending: [],
  tombstones: [],
  templateRules: [],
});

const opaqueKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
// Provider keys can be shorter than an opaque review id. Keep their reserved
// namespace strict; this exception never applies to ids or template keys.
const reviewSourceKey = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  if (value.startsWith('android_message_review_source_')) return isValidAndroidSourceKey(value);
  if (value.startsWith('ha')) {
    return isValidAndroidSourceKey(value) || /^h[a-f0-9]{64}$/.test(value);
  }
  return opaqueKey(value);
};
const validTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 &&
  Number.isFinite(new Date(value).getTime());
const androidPackage = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 3 && value.length <= 255 &&
  /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(value);
const notificationSourceClass = (value: unknown): value is NonNullable<ReviewEntry['sourceClass']> =>
  value === 'trusted-bank' || value === 'play-finance' || value === 'financial-candidate';
const UNIVERSAL_REVIEW_CHANNELS: readonly UniversalReviewAlert['channel'][] = [
  'inbox', 'delivery', 'push', 'shortcut', 'email', 'pdf', 'paste',
];
const positiveMinorUnits = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,39}$/.test(value);
const reviewableFamily = (family: AlertFamily): family is ReviewableFamily => [
  'purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment',
].includes(family);

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows show a visible expiry countdown during their final week. */
export const REVIEW_EXPIRY_WARNING_DAYS = 7;

/**
 * Expiry is a loss of reviewable money evidence. Record it as a source-free
 * tombstone (dated at the item's own expiry, so repeated hydration of the same
 * unsaved tray cannot count it twice) instead of letting it vanish silently.
 */
const expiryTombstones = (
  state: AlertReviewTrayState,
  now: number,
): ReviewTombstone[] => {
  const known = new Set((state.tombstones ?? []).map((item) => canonicalUniversalSourceKey(item.sourceKey)));
  const added: ReviewTombstone[] = [];
  for (const item of state.pending) {
    if (item.expiresAt > now) continue;
    const sourceKey = canonicalUniversalSourceKey(item.sourceKey, item.observedAt);
    // An item that expired so long ago that its natural tombstone window has
    // also lapsed is still a loss that must be counted exactly once: date the
    // tombstone at discovery so the disclosure shows it and re-reads are blocked.
    const lapsed = validTimestamp(item.expiresAt) && item.expiresAt + REVIEW_TOMBSTONE_TTL_MS <= now;
    const resolvedAt = lapsed ? now : item.expiresAt;
    const expiresAt = (lapsed ? now : item.expiresAt) + REVIEW_TOMBSTONE_TTL_MS;
    if (known.has(sourceKey) || !validTimestamp(item.expiresAt) || !validTimestamp(resolvedAt) ||
      !validTimestamp(expiresAt) || expiresAt <= now) continue;
    known.add(sourceKey);
    added.push({ sourceKey, resolvedAt, expiresAt, outcome: 'expired' });
  }
  return added.sort((a, b) => a.resolvedAt - b.resolvedAt);
};

const MONEY_MOVEMENT_FAMILIES: readonly string[] = [
  'purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment', 'unknown',
];

/**
 * Whether a review could still become a ledger transaction. Registered
 * reviews are admitted only for money-moving families. A universal review
 * uses the same test as the Review screen's "ordinary posting": balance,
 * statement, bill, card-payment and non-posted events are informational.
 */
export const isMoneyMovementReview = (item: ReviewEntry): boolean => {
  if (!isUniversalReviewAlert(item)) return true;
  const event = item.event as Partial<UniversalBankEvent> | undefined;
  return !!event && MONEY_MOVEMENT_FAMILIES.includes(event.family as string) &&
    (event.status === 'posted' || event.status === 'unknown');
};

/** Retention is not posting eligibility. Exact repayment evidence stays informational. */
export const requiresReviewRetention = (item: ReviewEntry): boolean => {
  if (isMoneyMovementReview(item)) return true;
  if (!isUniversalReviewAlert(item)) return false;
  const event = sanitizeUniversalReviewEvent(item.event);
  return event?.family === 'card-payment' && event.amount.evidence === 'explicit' &&
    event.amount.value !== null && positiveMinorUnits(event.amount.value.minorUnits) &&
    event.amount.alternatives.length === 0;
};

export interface ReviewSourceReceipt {
  sourceKey: string;
  outcome: 'pending' | 'resolved' | 'deferred' | 'expired' | 'refused';
}
/** The canonical identity a receipt, claim or tombstone uses for one review source. */
export const reviewSourceKeyOf = (item: Pick<ReviewEntry, 'sourceKey' | 'observedAt'>): string =>
  canonicalUniversalSourceKey(item.sourceKey, item.observedAt);
/**
 * A source is settled when Review holds it (pending), the user decided it
 * (resolved), or its 30-day payload expired. Expiry is a terminal, disclosed
 * loss counted once through its tombstone: it is never posted or re-staged,
 * and it must not freeze a cursor. 'evicted'/'currency-evicted', deferred and
 * refused stay held because capacity can still free.
 */
export const reviewReceiptSettled = (outcome: ReviewSourceReceipt['outcome'] | undefined): boolean =>
  outcome === 'pending' || outcome === 'resolved' || outcome === 'expired';
/**
 * Whether a caller that holds a whole PAGE or cursor behind its sources (the
 * Android first history import, a manual Import scan, the live inbox cursor,
 * iOS History) may move past this source. A settled source may. So may a
 * 'refused' one: the tray will never admit it (it failed Review validation,
 * or its review id already belongs to another source), so holding the page
 * cannot retain it and would freeze every later message behind it, as a
 * single balance SMS did on Android RC 396. Only a missing receipt or a
 * capacity deferral holds the page. Per-record holds (Wallet and relay ACKs)
 * keep using reviewReceiptSettled: they withhold one record, not a page.
 */
export const reviewReceiptReleasesPage = (outcome: ReviewSourceReceipt['outcome'] | undefined): boolean =>
  reviewReceiptSettled(outcome) || outcome === 'refused';
export interface ReviewStageReceipt {
  admitted: number;
  durable: Promise<void>;
  /** Read only AFTER durable; recomputed on current state, never a provisional insert count. */
  retention?: () => ReviewSourceReceipt[];
  /** Positive canonical claims in this receipt's written snapshot AND current generation. */
  retainedSourceKeys?: () => string[];
}

export const reviewRetentionReceipts = (
  tray: AlertReviewTrayState, inputs: readonly ReviewEntry[], now: number,
): ReviewSourceReceipt[] => inputs.map((input) => {
  const sourceKey = canonicalUniversalSourceKey(input.sourceKey, input.observedAt);
  const item = normalizeReviewEntry(input, now);
  if (!item) return { sourceKey, outcome: 'refused' };
  const decision = tray.tombstones.find(entry => entry.expiresAt > now &&
    canonicalUniversalSourceKey(entry.sourceKey) === sourceKey && isResolutionOutcome(entry.outcome));
  if (decision) return { sourceKey, outcome: 'resolved' };
  if (item.expiresAt <= now || tray.tombstones.some(entry => entry.expiresAt > now &&
    canonicalUniversalSourceKey(entry.sourceKey) === sourceKey && entry.outcome === 'expired')) {
    return { sourceKey, outcome: 'expired' };
  }
  const pending = tray.pending.find(entry => entry.expiresAt > now &&
    canonicalUniversalSourceKey(entry.sourceKey, entry.observedAt) === sourceKey);
  if (pending) return { sourceKey, outcome: 'pending' };
  // The same review id already holds a DIFFERENT source: admission refuses it,
  // so the receipt says so instead of implying that waiting could retain it.
  const collision = tray.pending.some(entry => entry.id === item.id &&
    canonicalUniversalSourceKey(entry.sourceKey, entry.observedAt) !== sourceKey);
  return { sourceKey, outcome: collision ? 'refused' : 'deferred' };
});

export const reviewClaimSourceKeys = (tray: AlertReviewTrayState, now: number): string[] => [
  ...tray.pending.filter(item => item.expiresAt > now).map(item => canonicalUniversalSourceKey(item.sourceKey, item.observedAt)),
  ...tray.tombstones.filter(item => item.expiresAt > now && (isResolutionOutcome(item.outcome) || item.outcome === 'expired'))
    .map(item => canonicalUniversalSourceKey(item.sourceKey)),
];

/** Missing/old receipts cannot authorize disposal of retention-required source. */
export const settleReviewStage = async (
  inputs: readonly ReviewEntry[], receipt: ReviewStageReceipt,
): Promise<ReviewSourceReceipt[]> => {
  await receipt.durable;
  if (!receipt.retention) {
    return inputs.map(item => ({ sourceKey: canonicalUniversalSourceKey(item.sourceKey, item.observedAt),
      outcome: 'deferred' as const }));
  }
  return receipt.retention();
};

/**
 * Keep the newest fifty legacy reviews, but when the lane overflows, evict
 * informational entries (oldest first) before any possible money movement.
 * Input is sorted oldest first. Returns the kept entries and the evicted
 * retention-required evidence; other informational evictions stay silent.
 */
const trimLegacyLane = (legacy: ReviewEntry[]): { kept: ReviewEntry[]; lostMoney: ReviewEntry[] } => {
  let overflow = legacy.length - REVIEW_ALERT_CAP;
  if (overflow <= 0) return { kept: legacy, lostMoney: [] };
  const evicted = new Set<ReviewEntry>();
  for (const item of legacy) {
    if (overflow === 0) break;
    if (!requiresReviewRetention(item)) { evicted.add(item); overflow -= 1; }
  }
  const lostMoney: ReviewEntry[] = [];
  for (const item of legacy) {
    if (overflow === 0) break;
    if (!evicted.has(item)) { evicted.add(item); lostMoney.push(item); overflow -= 1; }
  }
  return { kept: legacy.filter((item) => !evicted.has(item)), lostMoney };
};

/**
 * Eviction of a possible money movement is a loss of reviewable evidence,
 * like expiry. Record a source-free tombstone once per source: a hydration
 * that re-evicts the same unsaved item finds its tombstone (or recreates the
 * identical one) and cannot count it twice.
 */
const evictionTombstones = (
  known: Set<string>,
  lost: readonly ReviewEntry[],
  outcome: 'evicted' | 'currency-evicted',
  now: number,
): ReviewTombstone[] => {
  const added: ReviewTombstone[] = [];
  const expiresAt = now + REVIEW_TOMBSTONE_TTL_MS;
  if (!validTimestamp(now) || !validTimestamp(expiresAt)) return added;
  for (const item of lost) {
    const sourceKey = canonicalUniversalSourceKey(item.sourceKey, item.observedAt);
    if (known.has(sourceKey)) continue;
    known.add(sourceKey);
    added.push({ sourceKey, resolvedAt: now, expiresAt, outcome });
  }
  return added;
};

export const pruneAlertReviewTray = (
  state: AlertReviewTrayState,
  now: number,
): AlertReviewTrayState => {
  const expired = expiryTombstones(state, now);
  const fresh = state.pending.filter(item => item.expiresAt > now).sort((a, b) => a.observedAt - b.observedAt);
  // Keep up to fifty protected notification/Wallet reviews alongside the legacy
  // newest-fifty lane. SMS/relay/history admission must not evict an already
  // acknowledged notification, nor start refusing their own records without
  // a retry path. Canonical writes never exceed fifty notification entries.
  const notifications = fresh.filter(item => reviewLane(item) === 'protected').slice(0, REVIEW_ALERT_CAP);
  // Foreign-currency money reviews can never be posted here. Keep the newest
  // fifty in their own lane; each older one leaves a counted tombstone.
  const currency = fresh.filter(item => reviewLane(item) === 'currency');
  const currencyLost = currency.slice(0, Math.max(0, currency.length - REVIEW_ALERT_CAP));
  const currencyKept = currency.slice(currencyLost.length);
  // Possible Apple Pay duplicates: the newest fifty in their own lane; each
  // older one (only from older saved state) leaves a counted tombstone.
  const walletDuplicates = fresh.filter(item => reviewLane(item) === 'wallet-duplicate');
  const walletDuplicatesLost = walletDuplicates.slice(0, Math.max(0, walletDuplicates.length - REVIEW_ALERT_CAP));
  const walletDuplicatesKept = walletDuplicates.slice(walletDuplicatesLost.length);
  const legacy = trimLegacyLane(fresh.filter(item => reviewLane(item) === 'legacy'));
  const known = new Set([...(state.tombstones ?? []), ...expired]
    .map((item) => canonicalUniversalSourceKey(item.sourceKey)));
  const evicted = [
    ...evictionTombstones(known, legacy.lostMoney, 'evicted', now),
    ...evictionTombstones(known, currencyLost, 'currency-evicted', now),
    ...evictionTombstones(known, walletDuplicatesLost, 'evicted', now),
  ];
  return {
  schemaVersion: 1,
  pending: [...notifications, ...currencyKept, ...walletDuplicatesKept, ...legacy.kept].sort((a, b) => a.observedAt - b.observedAt),
  tombstones: capTombstones([...(state.tombstones ?? []), ...expired, ...evicted]
    .filter((item) => item.expiresAt > now)),
  templateRules: [...state.templateRules]
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-REVIEW_TEMPLATE_RULE_CAP),
  };
};

export const prepareReviewAlert = (input: ReviewAdmissionInput): ReviewAlert | null => {
  const { route, review } = input.inspection;
  if (route.decision !== 'single' || !route.market || route.market === 'AE' || route.market === 'SA') {
    return null;
  }
  if (!review || review.decision !== 'review' || review.status !== 'posted' ||
    review.primaryCandidateIndex === null || !reviewableFamily(review.family) ||
    (review.direction !== 'debit' && review.direction !== 'credit') ||
    review.institution.decision !== 'identified' || !review.institution.institution) {
    return null;
  }
  const institutionCandidate = review.institution.candidates.find(
    (candidate) => candidate.institution === review.institution.institution,
  );
  // Body mentions are useful routing evidence, but the bank may be a payee or
  // beneficiary. Initial global review therefore requires an exact issuer
  // sender match. Verification status is carried for audit and never imports.
  if (!institutionCandidate?.evidence.includes('sender')) return null;
  const candidate = review.draft.candidates[review.primaryCandidateIndex];
  if (!candidate?.currency || candidate.minorUnits === null || candidate.exponent === null ||
    !positiveMinorUnits(candidate.minorUnits)) {
    return null;
  }
  if (!opaqueKey(input.id) || !reviewSourceKey(input.sourceKey) || !Number.isSafeInteger(input.observedAt)) {
    return null;
  }
  return {
    id: input.id,
    sourceKey: input.sourceKey,
    observedAt: input.observedAt,
    expiresAt: input.observedAt + REVIEW_ALERT_TTL_MS,
    channel: input.channel,
    parserVersion: review.draft.parserVersion,
    market: route.market,
    institution: review.institution.institution,
    grammar: institutionCandidate.grammar,
    amount: {
      currency: candidate.currency,
      minorUnits: candidate.minorUnits,
      exponent: candidate.exponent,
    },
    direction: review.direction,
    family: review.family,
    rail: review.rail,
    instrument: review.eventEvidence.instrument,
  };
};

/** Prepare a sanitized UAE/Saudi parser miss for explicit user review. */
export const prepareLaunchReviewAlert = (
  input: LaunchReviewAdmissionInput,
): ReviewAlert | null => {
  const { review } = input;
  if (!opaqueKey(input.id) || !reviewSourceKey(input.sourceKey) ||
    !Number.isSafeInteger(input.observedAt) || input.observedAt < 0 ||
    (review.market !== 'AE' && review.market !== 'SA') ||
    !/^[a-z0-9-]{2,80}$/.test(review.institution) ||
    review.grammar.channel !== 'bank-alert' || review.grammar.status !== 'experimental' ||
    review.grammar.provenance !== 'launch-registry' ||
    !/^[a-z0-9-]{2,100}$/.test(review.grammar.id) ||
    !Number.isSafeInteger(review.grammar.version) || review.grammar.version < 1 ||
    !Number.isSafeInteger(review.parserVersion) || review.parserVersion < 1 ||
    (review.direction !== 'debit' && review.direction !== 'credit') ||
    !reviewableFamily(review.family) ||
    review.amount.currency !== (review.market === 'AE' ? 'AED' : 'SAR') ||
    review.amount.exponent !== 2 || !positiveMinorUnits(review.amount.minorUnits) ||
    (review.rail !== null &&
      (typeof review.rail !== 'string' || !/^[a-z0-9-]{1,40}$/.test(review.rail))) ||
    (review.instrument !== null && (
      !['card', 'account', 'wallet'].includes(review.instrument.kind) ||
      (review.instrument.last4 !== null && !/^\d{4}$/.test(review.instrument.last4))
    ))) {
    return null;
  }
  return {
    id: input.id,
    sourceKey: input.sourceKey,
    observedAt: input.observedAt,
    expiresAt: input.observedAt + REVIEW_ALERT_TTL_MS,
    channel: input.channel,
    parserVersion: review.parserVersion,
    market: review.market,
    institution: review.institution,
    grammar: review.grammar,
    amount: review.amount,
    direction: review.direction,
    family: review.family,
    rail: review.rail,
    instrument: review.instrument,
  };
};

/** Admit only sanitized, posted, unambiguous financial evidence. */
export const admitReviewAlert = (
  current: AlertReviewTrayState,
  input: ReviewAdmissionInput,
): ReviewAdmissionResult => {
  const state = pruneAlertReviewTray(current, input.observedAt);
  const item = prepareReviewAlert(input);
  if (!item) return { state, outcome: 'refused', reason: 'unsafe-review-candidate' };
  return admitPreparedReviewAlert(state, item, input.observedAt);
};

/**
 * How a full Message/relay/history lane admits new evidence.
 * - 'bounded' (default): the existing policy. The new item is admitted and the
 *   lane is trimmed to its cap, informational entries first, then the oldest,
 *   each counted as a visible 'evicted'/'currency-evicted' loss.
 * - 'hold-source': strict retention. Acknowledged retention-required evidence is
 *   never replaced; the new item is 'deferred' instead. Only a caller that keeps
 *   its source queued until a later retry (withheld ACK, held cursor, held
 *   session, thrown hold) may pass it; otherwise a deferral would lose the item.
 */
export type ReviewAdmissionMode = 'bounded' | 'hold-source';

/** Merge an already sanitized capture item through the same dedupe/retention policy. */
export const admitPreparedReviewAlert = (
  current: AlertReviewTrayState, input: ReviewEntry, now: number, mode: ReviewAdmissionMode = 'bounded',
): ReviewAdmissionResult => {
  const result = admitPreparedReviewAlerts(current, [input], now, mode);
  return { state: result.state, outcome: result.outcomes[0],
    ...(result.outcomes[0] === 'deferred' ? { reason: 'review-capacity' } : {}) };
};

/** Bounded lanes; available subsets survive while remaining source must be retried. */
export const admitPreparedReviewAlerts = (
  current: AlertReviewTrayState, inputs: readonly ReviewEntry[], now: number,
  mode: ReviewAdmissionMode = 'bounded',
): { state: AlertReviewTrayState; outcomes: ReviewAdmissionResult['outcome'][] } => {
  const state = pruneAlertReviewTray(current, now);
  const working = [...state.pending];
  const recoveredKeys = new Set<string>();
  const expiredInputs: ReviewEntry[] = [];
  const outcomes: ReviewAdmissionResult['outcome'][] = [];
  const keys: string[] = [];
  const decisions = new Map(state.tombstones.map(entry =>
    [canonicalUniversalSourceKey(entry.sourceKey), entry.outcome]));
  const pendingKey = (entry: ReviewEntry) => canonicalUniversalSourceKey(entry.sourceKey, entry.observedAt);
  // O(1) replay check: a bounded batch can grow `working` to thousands before its single prune.
  const workingKeys = new Set(working.map(pendingKey));
  const workingById = new Map(working.map(entry => [entry.id, entry]));
  const laneCounts = new Map<string, number>();
  for (const entry of working) laneCounts.set(reviewLane(entry), (laneCounts.get(reviewLane(entry)) ?? 0) + 1);
  for (const input of inputs) {
    const key = canonicalUniversalSourceKey(input.sourceKey, input.observedAt);
    keys.push(key);
    const item = normalizeReviewEntry(input, now);
    if (!item) { outcomes.push('refused'); continue; }
    const existing = workingById.get(item.id);
    if (existing && (existing.sourceKey !== item.sourceKey || existing.observedAt !== item.observedAt)) {
      outcomes.push('refused'); continue;
    }
    const decision = decisions.get(key);
    if (decision && isResolutionOutcome(decision)) { outcomes.push('duplicate'); continue; }
    if (item.expiresAt <= now || decision === 'expired') {
      if (!decision) expiredInputs.push(item);
      outcomes.push('expired'); continue;
    }
    if (workingKeys.has(key)) { outcomes.push('duplicate'); continue; }
    const lane = reviewLane(item);
    if ((laneCounts.get(lane) ?? 0) >= REVIEW_ALERT_CAP && (lane === 'protected' || mode === 'hold-source')) {
      const occupants = working.filter(entry => reviewLane(entry) === lane);
      // A source-holding caller never replaces acknowledged evidence with a new
      // observation. Bounded callers keep the existing trim-and-count policy.
      const disposable = occupants.filter(entry => !requiresReviewRetention(entry))
        .sort((a, b) => a.observedAt - b.observedAt)[0];
      if (lane === 'protected' || !disposable ||
          (!requiresReviewRetention(item) && item.observedAt <= disposable.observedAt)) {
        outcomes.push('deferred'); continue;
      }
      working.splice(working.indexOf(disposable), 1);
      workingKeys.delete(pendingKey(disposable));
      workingById.delete(disposable.id);
      laneCounts.set(lane, (laneCounts.get(lane) ?? 1) - 1);
    }
    working.push(item);
    workingKeys.add(key);
    workingById.set(item.id, item);
    laneCounts.set(lane, (laneCounts.get(lane) ?? 0) + 1);
    recoveredKeys.add(key);
    outcomes.push('admitted');
  }
  const next = pruneAlertReviewTray({ ...state, pending: [...working, ...expiredInputs],
    tombstones: state.tombstones.filter(entry => !(
      (entry.outcome === 'evicted' || entry.outcome === 'currency-evicted') &&
      recoveredKeys.has(canonicalUniversalSourceKey(entry.sourceKey)))) }, now);
  if (mode === 'bounded') return { state: next, outcomes };
  const retained = new Set(next.pending.map(pendingKey));
  return { state: next, outcomes: outcomes.map((outcome, index) =>
    outcome === 'admitted' && !retained.has(keys[index]) ? 'deferred' : outcome) };
};

/** Whole days left before a pending review expires, only inside its final week. */
export const reviewExpiresInDays = (
  item: Pick<ReviewEntry, 'expiresAt'>,
  now: number,
): number | null => {
  const remaining = item.expiresAt - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const days = Math.ceil(remaining / DAY_MS);
  return days <= REVIEW_EXPIRY_WARNING_DAYS ? days : null;
};

/** Reviews lost for `outcome` (expiry or eviction) during the last review window. */
export const recentlyLostReviewCount = (
  tray: Pick<AlertReviewTrayState, 'tombstones'> | null | undefined,
  now: number,
  outcome: Extract<ReviewTombstone['outcome'], 'expired' | 'evicted' | 'currency-evicted' | 'duplicate-posted'>,
): number => (tray?.tombstones ?? []).filter((item) => item.outcome === outcome &&
  item.resolvedAt <= now && now - item.resolvedAt < REVIEW_ALERT_TTL_MS).length;

/** Reviews that expired unresolved during the last review window. */
export const recentlyExpiredReviewCount = (
  tray: Pick<AlertReviewTrayState, 'tombstones'> | null | undefined,
  now: number,
): number => recentlyLostReviewCount(tray, now, 'expired');

/**
 * Residual of the possible-duplicate lane (CEO d81a0462): when even that lane
 * is full and the caller cannot hold its source, the bank row is posted. Keep a
 * source-free, counted record of each such posting (once per source) so the
 * Review screen shows how many possible duplicates were posted. Never silent.
 */
export const recordPossibleDuplicatesPosted = (
  tray: AlertReviewTrayState,
  sourceKeys: readonly string[],
  now: number,
): AlertReviewTrayState => {
  const expiresAt = now + REVIEW_TOMBSTONE_TTL_MS;
  if (sourceKeys.length === 0 || !validTimestamp(now) || !validTimestamp(expiresAt)) return tray;
  const known = new Set(tray.tombstones.filter(item => item.outcome === 'duplicate-posted')
    .map(item => canonicalUniversalSourceKey(item.sourceKey)));
  const added: ReviewTombstone[] = [];
  for (const raw of sourceKeys) {
    const sourceKey = canonicalUniversalSourceKey(raw);
    if (!sourceKey || known.has(sourceKey)) continue;
    known.add(sourceKey);
    added.push({ sourceKey, resolvedAt: now, expiresAt, outcome: 'duplicate-posted' });
  }
  return added.length === 0 ? tray : { ...tray, tombstones: capTombstones([...tray.tombstones, ...added]) };
};

export interface ReviewTrayCapacity {
  /** iOS notification + Apple Pay lane; refusing admission keeps the native record. */
  protectedFull: boolean;
  /** Message/relay/history lane. */
  legacyFull: boolean;
}

export const reviewTrayCapacity = (
  tray: Pick<AlertReviewTrayState, 'pending'> | null | undefined,
  now: number,
): ReviewTrayCapacity => {
  const fresh = (tray?.pending ?? []).filter((item) => item.expiresAt > now);
  return {
    protectedFull: fresh.filter((item) => reviewLane(item) === 'protected').length >= REVIEW_ALERT_CAP,
    legacyFull: fresh.filter((item) => reviewLane(item) === 'legacy').length >= REVIEW_ALERT_CAP,
  };
};

/**
 * Backpressure for a caller that can leave its source queued. A full legacy
 * lane may replace disposable informational entries first. Required evidence
 * whose admission cannot preserve all acknowledged required payloads is
 * returned as `deferred` so its record stays queued. Informational reviews
 * may be deferred as well; they cannot evict retained exact-money evidence.
 * Foreign-currency reviews use the same bounded admission contract. Duplicates and refusals pass through
 * with their existing acknowledgement semantics. Protected iOS reviews refuse
 * at capacity inside admission.
 */
export const partitionReviewsByCapacity = <T extends ReviewEntry>(
  current: AlertReviewTrayState,
  items: readonly T[],
  now: number,
): { admit: T[]; deferred: T[] } => {
  let state = pruneAlertReviewTray(current, now);
  const admit: T[] = [];
  const deferred: T[] = [];
  for (const item of items) {
    const lane = reviewLane(item);
    if (lane === 'protected') {
      admit.push(item);
      continue;
    }
    const result = admitPreparedReviewAlert(state, item, now, 'hold-source');
    // Only recoverable money evidence waits at its source for Review space. An
    // informational review that cannot displace kept money is staged and simply
    // not admitted, so it never holds a native record or an inbox cursor.
    if (result.outcome === 'deferred') {
      if (requiresReviewRetention(item)) deferred.push(item); else admit.push(item);
      continue;
    }
    if (lane === 'legacy' && result.outcome === 'admitted' && requiresReviewRetention(item)) {
      const kept = new Set(result.state.pending.map((entry) => entry.id));
      const losesMoneyMovement = !kept.has(item.id) || state.pending.some((entry) =>
        reviewLane(entry) === 'legacy' && requiresReviewRetention(entry) && !kept.has(entry.id));
      if (losesMoneyMovement) {
        deferred.push(item);
        continue;
      }
    }
    state = result.state;
    admit.push(item);
  }
  return { admit, deferred };
};

/**
 * Source-free, in-memory drain facts for the Review screen. Deferred records
 * stay in the native queue; this is presentation state, never acknowledgement
 * or durability evidence.
 */
export interface ReviewCaptureBacklog {
  /** Native records waiting for Review space (notification, Message, Apple Pay). */
  waiting: number;
  /**
   * Non-money Message/notification records (declines, statements, bill
   * reminders) skipped because they use another currency. Conflicting money
   * rows go to Review as durable items and are never counted here.
   */
  currencyConflicts: number;
}

const EMPTY_BACKLOG: ReviewCaptureBacklog = { waiting: 0, currencyConflicts: 0 };
let reviewBacklog: ReviewCaptureBacklog = EMPTY_BACKLOG;
const reviewBacklogListeners = new Set<() => void>();

export const reviewCaptureBacklog = {
  get: (): ReviewCaptureBacklog => reviewBacklog,
  subscribe: (listener: () => void): (() => void) => {
    reviewBacklogListeners.add(listener);
    return () => { reviewBacklogListeners.delete(listener); };
  },
  publish: (next: { waiting: number; currencyConflicts?: number }): void => {
    const waiting = Number.isSafeInteger(next.waiting) && next.waiting > 0 ? next.waiting : 0;
    const added = Number.isSafeInteger(next.currencyConflicts) && next.currencyConflicts! > 0
      ? next.currencyConflicts! : 0;
    const currencyConflicts = Math.min(Number.MAX_SAFE_INTEGER, reviewBacklog.currencyConflicts + added);
    if (waiting === reviewBacklog.waiting && currencyConflicts === reviewBacklog.currencyConflicts) return;
    reviewBacklog = { waiting, currencyConflicts };
    for (const listener of [...reviewBacklogListeners]) listener();
  },
  reset: (): void => {
    reviewBacklog = EMPTY_BACKLOG;
    for (const listener of [...reviewBacklogListeners]) listener();
  },
};

export const resolveReviewAlert = (
  current: AlertReviewTrayState,
  id: string,
  outcome: ReviewResolutionOutcome,
  now: number,
): AlertReviewTrayState => {
  const state = pruneAlertReviewTray(current, now);
  const item = state.pending.find((entry) => entry.id === id);
  // Loss outcomes are recorded only by pruning; never let a caller inflate them.
  if (!item || !isResolutionOutcome(outcome)) return state;
  return pruneAlertReviewTray({
    ...state,
    pending: state.pending.filter((entry) => entry.id !== id),
    tombstones: [...state.tombstones, {
      sourceKey: canonicalUniversalSourceKey(item.sourceKey, item.observedAt),
      resolvedAt: now,
      expiresAt: now + REVIEW_TOMBSTONE_TTL_MS,
      outcome,
    }],
  }, now);
};

const markets: readonly ReviewAlert['market'][] = [
  'AE', 'SA', 'US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'IN', 'QA', 'KW', 'BH', 'OM', 'EG', 'JO',
  'CA', 'AU', 'BR', 'MX', 'SG', 'CO', 'PE',
];
const channels: readonly ReviewAlert['channel'][] = [
  'inbox', 'delivery', 'push', 'shortcut', 'email', 'pdf',
];
const families: readonly ReviewableFamily[] = [
  'purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment',
];

const normalizeReviewEntry = (value: unknown, now: number): ReviewEntry | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const common = value as ReviewEntry;
  const attention = common.channel === 'push' && common.attentionReason === 'possible-notification-replay'
    ? { attentionReason: 'possible-notification-replay' as const }
    : common.attentionReason === 'possible-apple-pay-duplicate'
      ? {
          attentionReason: 'possible-apple-pay-duplicate' as const,
          ...(typeof common.walletTransactionId === 'string' &&
            /^[A-Za-z0-9_.:-]{1,128}$/.test(common.walletTransactionId)
            ? { walletTransactionId: common.walletTransactionId } : {}),
        } : {};
  if (!opaqueKey(common.id) || !reviewSourceKey(common.sourceKey) ||
  !validTimestamp(common.observedAt) || !captureSourceTimeMatches(common.sourceKey, common.observedAt) || !validTimestamp(common.expiresAt) ||
  common.expiresAt <= common.observedAt || common.expiresAt > now + REVIEW_ALERT_TTL_MS) return null;
  if (common.kind === 'universal') {
  const item = prepareUniversalReviewAlert(common);
  if (!item) return null;
  const sourceMeta = common.channel === 'push' && androidPackage(common.sourcePackage) &&
    notificationSourceClass(common.sourceClass)
    ? { sourcePackage: common.sourcePackage, sourceClass: common.sourceClass }
    : {};
  const conflict = (common as UniversalReviewAlert).currencyConflict === true
    ? { currencyConflict: true as const } : {};
  const walletCard = (common as UniversalReviewAlert).walletCardOrPass;
  const card = isIosApplePayReview(common) && usableWalletCardName(walletCard)
    ? { walletCardOrPass: walletCard } : {};
  return { ...item, ...sourceMeta, ...attention, ...conflict, ...card, expiresAt: common.expiresAt };
  }
  const item = value as ReviewAlert;
  const instrument = item?.instrument;
  const grammar = item?.grammar;
  const launchMarket = item?.market === 'AE' || item?.market === 'SA';
  const launchMoneyValid = !launchMarket || (
    item.amount?.currency === (item.market === 'AE' ? 'AED' : 'SAR') &&
    item.amount?.exponent === 2 && grammar?.provenance === 'launch-registry'
  );
  const valid = !!item && (item.kind === undefined || item.kind === 'registered') && opaqueKey(item.id) && reviewSourceKey(item.sourceKey) &&
  (item.templateKey === undefined || opaqueKey(item.templateKey)) &&
  Number.isSafeInteger(item.observedAt) && Number.isSafeInteger(item.expiresAt) &&
  channels.includes(item.channel) && Number.isSafeInteger(item.parserVersion) && item.parserVersion > 0 &&
  markets.includes(item.market) &&
  typeof item.institution === 'string' && item.institution.length <= 96 &&
  !!grammar && typeof grammar.id === 'string' && /^[a-z0-9-]{3,128}$/.test(grammar.id) && Number.isSafeInteger(grammar.version) &&
  grammar.version > 0 && grammar.channel === 'bank-alert' &&
  ['experimental', 'verified'].includes(grammar.status) &&
  ['synthetic-seed', 'consented-redacted', 'public-template', 'launch-registry'].includes(grammar.provenance) &&
  !!item.amount && positiveMinorUnits(item.amount.minorUnits) &&
  /^[A-Z]{3}$/.test(item.amount.currency) &&
  Number.isInteger(item.amount.exponent) && item.amount.exponent >= 0 && item.amount.exponent <= 4 &&
  launchMoneyValid &&
  (item.direction === 'debit' || item.direction === 'credit') &&
  families.includes(item.family) &&
  (item.rail === null || (typeof item.rail === 'string' && item.rail.length <= 64)) &&
  (instrument === null || (!!instrument && ['card', 'account', 'wallet'].includes(instrument.kind) &&
    (instrument.last4 === null || (typeof instrument.last4 === 'string' && /^\d{4}$/.test(instrument.last4)))));

  if (!valid) return null;
  const sourceMeta = item.channel === 'push' && androidPackage(item.sourcePackage) &&
    notificationSourceClass(item.sourceClass)
    ? { sourcePackage: item.sourcePackage, sourceClass: item.sourceClass }
    : {};
  return {
    ...(item.kind === 'registered' ? { kind: 'registered' as const } : {}),
    id: item.id, sourceKey: item.sourceKey,
    ...(item.templateKey ? { templateKey: item.templateKey } : {}),
    observedAt: item.observedAt, expiresAt: item.expiresAt, channel: item.channel,
    parserVersion: item.parserVersion, market: item.market, institution: item.institution,
    grammar: { id: grammar!.id, version: grammar!.version, channel: grammar!.channel,
      status: grammar!.status, provenance: grammar!.provenance },
    amount: { currency: item.amount.currency, minorUnits: item.amount.minorUnits,
      exponent: item.amount.exponent },
    direction: item.direction, family: item.family, rail: item.rail,
    instrument: instrument ? { kind: instrument.kind, last4: instrument.last4 } : null,
    ...sourceMeta,
    ...attention,
  };
};

/** Runtime guard for hydration. Unknown/legacy shapes fail closed to empty. */
export const normalizeAlertReviewTray = (value: unknown, now: number): AlertReviewTrayState => {
  if (!value || typeof value !== 'object') return emptyAlertReviewTray();
  const candidate = value as Partial<AlertReviewTrayState>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.pending) ||
    !Array.isArray(candidate.tombstones)) return emptyAlertReviewTray();
  const safePending: ReviewEntry[] = [];
  const pendingIds = new Set<string>();
  const pendingSources = new Set<string>();
  for (const value of candidate.pending) {
    const item = normalizeReviewEntry(value, now);
    if (!item) continue;
    const source = canonicalUniversalSourceKey(item.sourceKey, item.observedAt);
    if (pendingIds.has(item.id) || pendingSources.has(source)) continue;
    pendingIds.add(item.id);
    pendingSources.add(source);
    safePending.push(item);
  }
  const safeTombstones = candidate.tombstones.filter((item): item is ReviewTombstone =>
    !!item && reviewSourceKey(item.sourceKey) && validTimestamp(item.resolvedAt) &&
    validTimestamp(item.expiresAt) && item.expiresAt > item.resolvedAt &&
    item.expiresAt <= item.resolvedAt + REVIEW_TOMBSTONE_TTL_MS && TOMBSTONE_OUTCOMES.includes(item.outcome))
    .map((item) => ({ sourceKey: item.sourceKey, resolvedAt: item.resolvedAt,
      expiresAt: item.expiresAt, outcome: item.outcome }));
  const safeTemplateRules = (Array.isArray(candidate.templateRules) ? candidate.templateRules : [])
    .filter((item): item is ReviewTemplateRule => !!item && opaqueKey(item.templateKey) &&
      markets.includes(item.market) && typeof item.institution === 'string' &&
      item.institution.length > 0 && item.institution.length <= 96 &&
      (item.direction === 'debit' || item.direction === 'credit') && families.includes(item.family) &&
      (item.type === 'expense' || item.type === 'income') && typeof item.title === 'string' &&
      item.title.length > 0 && item.title.length <= 80 && !/[\u0000-\u001F\u007F]/u.test(item.title) &&
      typeof item.category === 'string' &&
      item.category.length > 0 && item.category.length <= 64 && typeof item.accountId === 'string' &&
      item.accountId.length > 0 && item.accountId.length <= 128 &&
      typeof item.betweenOwnAccounts === 'boolean' && Number.isSafeInteger(item.confirmations) &&
      item.confirmations > 0 && Number.isSafeInteger(item.updatedAt))
    .map((item) => ({ templateKey: item.templateKey, market: item.market,
      institution: item.institution, direction: item.direction, family: item.family,
      type: item.type, title: item.title, category: item.category, accountId: item.accountId,
      betweenOwnAccounts: item.betweenOwnAccounts, confirmations: item.confirmations,
      updatedAt: item.updatedAt }));
  const resolvedSources = new Set(safeTombstones
    .filter((item) => item.expiresAt > now)
    .map((item) => canonicalUniversalSourceKey(item.sourceKey)));
  return pruneAlertReviewTray({
    schemaVersion: 1,
    pending: safePending.filter((item) => !resolvedSources.has(canonicalUniversalSourceKey(item.sourceKey, item.observedAt))),
    tombstones: safeTombstones,
    templateRules: safeTemplateRules,
  }, now);
};
