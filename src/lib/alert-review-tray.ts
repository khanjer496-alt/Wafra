import { captureSourceTimeMatches, isValidAndroidSourceKey } from '@/lib/capture-source-identity';
import { sanitizeUniversalReviewEvent } from '@/lib/generic-review-entry';
import { canonicalUniversalSourceKey } from '@/lib/universal-import';
import type { UniversalBankEvent } from '@/lib/universal-types';
import type { AlertFamily, MoneyDirection } from '@/lib/alert-market-pack-types';
import type { DetectedMarket, UniversalAlertReview } from '@/lib/alert-market-detection';
import type { InstitutionGrammarMetadata } from '@/lib/alert-institution-grammars';
import type { UnparsedLaunchAlertReview } from '@/lib/unparsed-launch-alert';

export const REVIEW_ALERT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REVIEW_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const REVIEW_ALERT_CAP = 50;
export const REVIEW_TOMBSTONE_CAP = 1000;
export const REVIEW_TEMPLATE_RULE_CAP = 200;
const APPLE_MESSAGE_ID_RE = /^[0-9a-f]{64}$/;

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
/**
 * Three independent lanes of up to fifty: foreign-currency money reviews,
 * iOS notification/Wallet reviews, and the Message/relay/history lane.
 */
type ReviewLane = 'currency' | 'protected' | 'legacy';
const reviewLane = (item: ReviewEntry): ReviewLane =>
  isCurrencyConflictReview(item) ? 'currency'
    : isProtectedIosCaptureReview(item) ? 'protected' : 'legacy';

export interface UniversalReviewAdmissionInput {
  id: string;
  sourceKey: string;
  observedAt: number;
  channel: ReviewAlert['channel'] | 'paste';
  parserVersion?: number;
  event: UniversalBankEvent;
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
  return { kind: 'universal', id: input.id, sourceKey: input.sourceKey,
    observedAt: input.observedAt, expiresAt, channel: input.channel,
    parserVersion: parserVersion!, event };
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
   * foreign-currency lane. All three are counted on the Review screen.
   */
  outcome: 'added' | 'dismissed' | 'duplicate' | 'expired' | 'evicted' | 'currency-evicted';
}

const TOMBSTONE_OUTCOMES: readonly ReviewTombstone['outcome'][] = [
  'added', 'dismissed', 'duplicate', 'expired', 'evicted', 'currency-evicted',
];
/** Outcomes a user or promotion decision may record; loss outcomes are system-only. */
export type ReviewResolutionOutcome = Extract<ReviewTombstone['outcome'], 'added' | 'dismissed' | 'duplicate'>;
const isResolutionOutcome = (outcome: ReviewTombstone['outcome']): outcome is ReviewResolutionOutcome =>
  outcome === 'added' || outcome === 'dismissed' || outcome === 'duplicate';

/**
 * Keep at most REVIEW_TOMBSTONE_CAP tombstones. User/promotion resolutions
 * are dedupe barriers that stop a dismissed or posted alert from returning,
 * so they are kept ahead of loss records (expired/evicted), which only feed
 * the Review counts. Within each class the newest survive.
 */
const capTombstones = (tombstones: ReviewTombstone[]): ReviewTombstone[] => {
  if (tombstones.length <= REVIEW_TOMBSTONE_CAP) return tombstones;
  const resolutions = tombstones.filter((item) => isResolutionOutcome(item.outcome))
    .slice(-REVIEW_TOMBSTONE_CAP);
  const room = REVIEW_TOMBSTONE_CAP - resolutions.length;
  const losses = room > 0
    ? tombstones.filter((item) => !isResolutionOutcome(item.outcome)).slice(-room) : [];
  const kept = new Set([...resolutions, ...losses]);
  return tombstones.filter((item) => kept.has(item));
};

export interface AlertReviewTrayState {
  schemaVersion: 1;
  pending: ReviewEntry[];
  tombstones: ReviewTombstone[];
  templateRules: ReviewTemplateRule[];
}

export interface ReviewAdmissionInput {
  id: string;
  sourceKey: string;
  observedAt: number;
  channel: ReviewAlert['channel'];
  inspection: UniversalAlertReview;
}

export interface ReviewAdmissionResult {
  state: AlertReviewTrayState;
  outcome: 'admitted' | 'duplicate' | 'refused';
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
    const expiresAt = item.expiresAt + REVIEW_TOMBSTONE_TTL_MS;
    if (known.has(sourceKey) || !validTimestamp(item.expiresAt) || !validTimestamp(expiresAt) ||
      expiresAt <= now) continue;
    known.add(sourceKey);
    added.push({ sourceKey, resolvedAt: item.expiresAt, expiresAt, outcome: 'expired' });
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

/**
 * Keep the newest fifty legacy reviews, but when the lane overflows, evict
 * informational entries (oldest first) before any possible money movement.
 * Input is sorted oldest first. Returns the kept entries and the evicted
 * possible money movements; informational evictions stay silent.
 */
const trimLegacyLane = (legacy: ReviewEntry[]): { kept: ReviewEntry[]; lostMoney: ReviewEntry[] } => {
  let overflow = legacy.length - REVIEW_ALERT_CAP;
  if (overflow <= 0) return { kept: legacy, lostMoney: [] };
  const evicted = new Set<ReviewEntry>();
  for (const item of legacy) {
    if (overflow === 0) break;
    if (!isMoneyMovementReview(item)) { evicted.add(item); overflow -= 1; }
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
  const legacy = trimLegacyLane(fresh.filter(item => reviewLane(item) === 'legacy'));
  const known = new Set([...(state.tombstones ?? []), ...expired]
    .map((item) => canonicalUniversalSourceKey(item.sourceKey)));
  const evicted = [
    ...evictionTombstones(known, legacy.lostMoney, 'evicted', now),
    ...evictionTombstones(known, currencyLost, 'currency-evicted', now),
  ];
  return {
  schemaVersion: 1,
  pending: [...notifications, ...currencyKept, ...legacy.kept].sort((a, b) => a.observedAt - b.observedAt),
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

/** Merge an already sanitized capture item through the same dedupe/retention policy. */
export const admitPreparedReviewAlert = (
  current: AlertReviewTrayState,
  input: ReviewEntry,
  now: number,
): ReviewAdmissionResult => {
  const state = pruneAlertReviewTray(current, now);
  const item = normalizeReviewEntry(input, now);
  if (!item) return { state, outcome: 'refused', reason: 'unsafe-review-candidate' };
  if (item.expiresAt <= now) {
    return { state, outcome: 'refused', reason: 'expired-review-candidate' };
  }
  if (state.pending.some((entry) => entry.id === item.id &&
    (entry.sourceKey !== item.sourceKey || entry.observedAt !== item.observedAt))) {
    return { state, outcome: 'refused', reason: 'review-identity-conflict' };
  }
  const sourceKey = canonicalUniversalSourceKey(item.sourceKey, item.observedAt);
  // A Message-lane eviction is a loss record, not a decision: a later re-read
  // of the same alert (for example a repeated History import) recovers it and
  // retires that loss record, so the Review count reflects only current losses.
  const recovered = (entry: ReviewTombstone): boolean => entry.outcome === 'evicted' &&
    canonicalUniversalSourceKey(entry.sourceKey) === sourceKey;
  if (state.tombstones.some((entry) => !recovered(entry) &&
    canonicalUniversalSourceKey(entry.sourceKey) === sourceKey) ||
    state.pending.some((entry) => canonicalUniversalSourceKey(entry.sourceKey, entry.observedAt) === sourceKey)) {
    return { state, outcome: 'duplicate' };
  }
  // This local notification caller withholds ACK on refusal. Other capture
  // callers still use the legacy newest-fifty policy and cannot yet apply
  // backpressure, so do not silently change their admission contract here.
  // Foreign-currency reviews use their own evicting lane and never refuse.
  if (reviewLane(item) === 'protected' &&
    state.pending.filter((entry) => reviewLane(entry) === 'protected').length >= REVIEW_ALERT_CAP) {
    return { state, outcome: 'refused', reason: 'review-capacity' };
  }
  return {
    outcome: 'admitted',
    state: pruneAlertReviewTray({ ...state, pending: [...state.pending, item],
      tombstones: state.tombstones.filter((entry) => !recovered(entry)) }, now),
  };
};

/**
 * Admit a batch under the same dedupe, identity and lane rules as
 * admitPreparedReviewAlert, but prune once. A History import can stage
 * thousands of candidates; per-item pruning over a full tombstone list would
 * block the JS thread. Lane trimming runs once over the whole batch, so it
 * never evicts more possible money movements than item-by-item admission.
 */
export const admitPreparedReviewAlerts = (
  current: AlertReviewTrayState,
  inputs: readonly ReviewEntry[],
  now: number,
): { state: AlertReviewTrayState; outcomes: ReviewAdmissionResult['outcome'][] } => {
  const state = pruneAlertReviewTray(current, now);
  const blocked = new Set<string>();
  const evictedKeys = new Set<string>();
  for (const entry of state.tombstones) {
    const key = canonicalUniversalSourceKey(entry.sourceKey);
    if (entry.outcome === 'evicted') evictedKeys.add(key);
    else blocked.add(key);
  }
  const pendingKeys = new Set(state.pending.map((entry) =>
    canonicalUniversalSourceKey(entry.sourceKey, entry.observedAt)));
  const pendingById = new Map(state.pending.map((entry) => [entry.id, entry]));
  let protectedCount = state.pending.filter((entry) => reviewLane(entry) === 'protected').length;
  const added: ReviewEntry[] = [];
  const recoveredKeys = new Set<string>();
  const outcomes: ReviewAdmissionResult['outcome'][] = [];
  for (const input of inputs) {
    const item = normalizeReviewEntry(input, now);
    if (!item || item.expiresAt <= now) { outcomes.push('refused'); continue; }
    const existing = pendingById.get(item.id);
    if (existing && (existing.sourceKey !== item.sourceKey || existing.observedAt !== item.observedAt)) {
      outcomes.push('refused');
      continue;
    }
    const key = canonicalUniversalSourceKey(item.sourceKey, item.observedAt);
    if (blocked.has(key) || pendingKeys.has(key)) { outcomes.push('duplicate'); continue; }
    const lane = reviewLane(item);
    if (lane === 'protected' && protectedCount >= REVIEW_ALERT_CAP) { outcomes.push('refused'); continue; }
    if (lane === 'protected') protectedCount += 1;
    if (evictedKeys.has(key)) recoveredKeys.add(key);
    pendingKeys.add(key);
    pendingById.set(item.id, item);
    added.push(item);
    outcomes.push('admitted');
  }
  if (added.length === 0) return { state, outcomes };
  return {
    outcomes,
    state: pruneAlertReviewTray({
      ...state,
      pending: [...state.pending, ...added],
      tombstones: state.tombstones.filter((entry) => !(entry.outcome === 'evicted' &&
        recoveredKeys.has(canonicalUniversalSourceKey(entry.sourceKey)))),
    }, now),
  };
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
  outcome: Extract<ReviewTombstone['outcome'], 'expired' | 'evicted' | 'currency-evicted'>,
): number => (tray?.tombstones ?? []).filter((item) => item.outcome === outcome &&
  item.resolvedAt <= now && now - item.resolvedAt < REVIEW_ALERT_TTL_MS).length;

/** Reviews that expired unresolved during the last review window. */
export const recentlyExpiredReviewCount = (
  tray: Pick<AlertReviewTrayState, 'tombstones'> | null | undefined,
  now: number,
): number => recentlyLostReviewCount(tray, now, 'expired');

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
 * lane admits by evicting, informational entries first. A possible money
 * movement whose admission would evict another money movement (or itself) is
 * returned as `deferred` so its record stays queued. Informational reviews
 * never wait: they keep the evicting policy and cannot block capture.
 * Foreign-currency reviews never wait either: their own lane evicts its
 * oldest entry with a counted tombstone. Duplicates and refusals pass through
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
    const result = admitPreparedReviewAlert(state, item, now);
    if (lane === 'legacy' && result.outcome === 'admitted' && isMoneyMovementReview(item)) {
      const kept = new Set(result.state.pending.map((entry) => entry.id));
      const losesMoneyMovement = !kept.has(item.id) || state.pending.some((entry) =>
        reviewLane(entry) === 'legacy' && isMoneyMovementReview(entry) && !kept.has(entry.id));
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
  return { ...item, ...sourceMeta, ...attention, ...conflict, expiresAt: common.expiresAt };
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
