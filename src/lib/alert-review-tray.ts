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

export interface ReviewAlert {
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
  kind: 'universal';
  id: string;
  sourceKey: string;
  observedAt: number;
  expiresAt: number;
  channel: ReviewAlert['channel'] | 'paste';
  parserVersion: number;
  event: UniversalBankEvent;
  /** Android app provenance only; never notification text. */
  sourcePackage?: string;
  sourceClass?: 'trusted-bank' | 'play-finance' | 'financial-candidate';
}

export type ReviewEntry = ReviewAlert | UniversalReviewAlert;
export const isUniversalReviewAlert = (item: ReviewEntry): item is UniversalReviewAlert =>
  item.kind === 'universal';

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
  outcome: 'added' | 'dismissed' | 'duplicate';
}

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

export const pruneAlertReviewTray = (
  state: AlertReviewTrayState,
  now: number,
): AlertReviewTrayState => ({
  schemaVersion: 1,
  pending: state.pending
    .filter((item) => item.expiresAt > now)
    .sort((a, b) => a.observedAt - b.observedAt)
    .slice(-REVIEW_ALERT_CAP),
  tombstones: state.tombstones.filter((item) => item.expiresAt > now).slice(-REVIEW_TOMBSTONE_CAP),
  templateRules: [...state.templateRules]
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-REVIEW_TEMPLATE_RULE_CAP),
});

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
  if (state.tombstones.some((entry) => canonicalUniversalSourceKey(entry.sourceKey) === sourceKey) ||
    state.pending.some((entry) => canonicalUniversalSourceKey(entry.sourceKey, entry.observedAt) === sourceKey)) {
    return { state, outcome: 'duplicate' };
  }
  return {
    outcome: 'admitted',
    state: pruneAlertReviewTray({ ...state, pending: [...state.pending, item] }, now),
  };
};

export const resolveReviewAlert = (
  current: AlertReviewTrayState,
  id: string,
  outcome: ReviewTombstone['outcome'],
  now: number,
): AlertReviewTrayState => {
  const state = pruneAlertReviewTray(current, now);
  const item = state.pending.find((entry) => entry.id === id);
  if (!item) return state;
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
  return { ...item, ...sourceMeta, expiresAt: common.expiresAt };
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
    item.expiresAt <= item.resolvedAt + REVIEW_TOMBSTONE_TTL_MS && ['added', 'dismissed', 'duplicate'].includes(item.outcome))
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
