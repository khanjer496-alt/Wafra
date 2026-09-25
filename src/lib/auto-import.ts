import { aiReviewEventForRefusedAlert } from '@/lib/ai-alert-reader';
import { AppState as RNAppState, Linking, PermissionsAndroid, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import NotificationReader from '../../modules/notification-reader';
import SmsReader, { type InboxSms } from '../../modules/sms-reader';
import type { UniversalAlertReview } from '@/lib/alert-market-detection';
import {
  prepareLaunchReviewAlert,
  prepareReviewAlert,
  prepareUniversalReviewAlert,
  isUniversalReviewAlert,
  REVIEW_ALERT_TTL_MS,
  type ReviewEntry,
  type ReviewAlert,
  type UniversalReviewAlert,
} from '@/lib/alert-review-tray';
import { toISODate } from '@/lib/format';
import { bodyPrint, type CaptureChannel } from '@/lib/dedupe';
import {
  nonPostingReason,
  parseForeignAwaitingRate,
  PARSER_VERSION,
  type NonPostingReason,
  type ParsedSms,
} from '@/lib/sms-parser';
import {
  createLaunchAlertSession,
  hasBankAlertMoneyHint,
  hasGenericBankAlertContext,
  inspectGenericBankEventForReview,
  type LaunchAlertSession,
} from '@/lib/launch-alert-parser';
import { hasUniversalInstitutionSender } from '@/lib/alert-institution-grammars';
import {
  inspectUnparsedLaunchAlert,
  normalizeUnparsedLaunchTemplate,
} from '@/lib/unparsed-launch-alert';
import {
  isBankNotificationCaptureAvailable,
  trustedBankNotificationMarket,
  trustedBankNotificationSender,
} from '@/lib/trusted-bank-notification-packages';
import type { DeclinedSms, ScannedSms } from '@/lib/import-plan';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import { parsedTransactionReviewEvent } from '@/lib/parsed-review-event';
import {
  detectLaunchMarketFromAlert,
  detectLaunchMarketFromSender,
  pinnedLedgerCurrencyCode,
  withMarketPackForParsing,
} from '@/lib/markets';
import { inspectUniversalBankEvent } from '@/lib/universal-parser';
import { dateOrderForCountry, getActiveCountry } from '@/lib/country';
import { bestEffortAutoPostEnabled, decideBestEffortAutoPost } from '@/lib/best-effort-autopost';
import { suggestUniversalCategory } from '@/lib/universal-categorization';
import type { UniversalBankEvent } from '@/lib/universal-types';
import { certifyUniversalTemplate } from '@/lib/universal-template-certification';
import type { ReviewSourceBinding } from '@/lib/review-source-bindings';
import { captureTrace, captureTraceEnabled } from '@/lib/capture-trace';
import { waitForForegroundHistoryIdle } from '@/lib/foreground-history-priority';
import { canCollectLocalSemanticShadow, queueLocalSemanticParserShadow, buildLocalParserSemanticWindow } from '@/lib/local-semantic-shadow';
import { eligibleLocalReviewEvent, localReviewAdvisor } from '@/lib/local-semantic-review';
import { sanitizeUniversalReviewEvent } from '@/lib/generic-review-entry';

const DEFAULT_PAGE_SIZE = 1_000;
const MAX_PAGE_SIZE = 2_000;
const MAX_REVIEW_CANDIDATES = 50;

export interface AndroidNotificationImportDiagnostics {
  attemptedAt: number;
  captured: number;
  autoParsed: number;
  review: number;
  declined: number;
  ignored: number;
  unresolved: number;
  unresolvedTrustedBank: number;
  unresolvedVerifiedFinance: number;
  unresolvedFinancialCandidate: number;
  unresolvedParserMiss: number;
  unresolvedReviewRefusal: number;
  /** Source-free template-certification outcomes from the last native drain. */
  certificationAutomatic: number;
  semanticGeneralized: number;
  certificationReview: number;
  certificationNeverPost: number;
  certificationAdapterRequired: number;
  /** Counts by code-owned certification id only; never message-derived text. */
  certificationTemplates: Record<string, number>;
  /** Market/family buckets only; never merchant, amount, account or source text. */
  semanticGeneralizedFamilies: Record<string, number>;
  acknowledgementPlanned: number;
  acknowledged: number;
}

const FINANCIAL_APP_LABEL_RE = /\b(?:bank|banking|banque|banco|banca|credit\s*union|finance|financial|mobile\s*money|wallet)\b|بنك|مصرف|محفظة|बैंक/iu;
const KNOWN_FINTECH_LABEL_RE = /\b(?:revolut|wise|monzo|n26|paypal|venmo|cash\s*app|cashapp|klarna|stc\s*pay|mada\s*pay)\b/iu;
const NON_FINANCIAL_BANK_LABEL_RE = /\b(?:power\s*bank|blood\s*bank|food\s*bank|question\s*bank|test\s*bank|bank\s*(?:exam|quiz|questions?|dictionary|calculator|monitor|manager|wallpaper)|memory\s*bank)\b/iu;

/**
 * Strong local identity for an unseen Play-installed finance app.
 *
 * This is deliberately based on the installed app's Android label rather than
 * the notification title/body, which any app can author. A known bank sender
 * alias is strongest; otherwise explicit banking/finance wording in the app's
 * own label is enough to let a confident posted parser result auto-import.
 */
const verifiedFinancialAppSender = (appLabel: string): string | null => {
  const label = appLabel.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!label) return null;
  const candidates = [
    label,
    label.replace(/\b(?:mobile|personal|digital|online)\s+(?:banking|bank)\b/giu, '').trim(),
    label.replace(/\b(?:mobile|banking|bank|app)\b/giu, '').trim(),
  ].filter((value, index, all) => value.length >= 2 && all.indexOf(value) === index);
  const registered = candidates.find((candidate) =>
    detectLaunchMarketFromSender(candidate) !== null || hasUniversalInstitutionSender(candidate));
  if (registered) return registered;
  if (NON_FINANCIAL_BANK_LABEL_RE.test(label)) return null;
  return FINANCIAL_APP_LABEL_RE.test(label) || KNOWN_FINTECH_LABEL_RE.test(label) ? label : null;
};

let latestAndroidNotificationImportDiagnostics: AndroidNotificationImportDiagnostics | null = null;

/** Source-free last-drain counters for tester diagnostics. */
export const getAndroidNotificationImportDiagnostics = (): AndroidNotificationImportDiagnostics | null =>
  latestAndroidNotificationImportDiagnostics
    ? { ...latestAndroidNotificationImportDiagnostics }
    : null;
// Cheap superset of currencies the worldwide reviewer can currently ground.
// It avoids running fourteen market packs over ordinary personal SMS, while
// false positives merely reach the review module and are refused there.
/**
 * Parsing is synchronous JavaScript, but phone speeds and message shapes vary
 * too much for one fixed row count. Yield when a slice consumes a frame-sized
 * time budget, with a row-count ceiling for fast clocks/devices. This keeps
 * the exact ordered result while avoiding 40+ timer turns per 1,000 simple
 * alerts on a fast phone.
 *
 * The budget was briefly 1ms with a 2-row ceiling. That made the timer turn,
 * not the parser, the dominant cost: ~50 yields per 100-row page at 40ms each
 * is two seconds of wall clock per page for a few milliseconds of parsing, and
 * a 20,000-message inbox became twenty minutes of sustained low-grade jank.
 * The contract test pins this band (4-12ms, 33-96 rows) and the scheduling
 * test counts the exact yields a 950-row page makes; stay inside both.
 */
const PARSE_TIME_BUDGET_MS = 4;
const MAX_PARSE_SLICE_SIZE = 64;
// A zero-delay timer yields the call stack but immediately competes for the
// next JS turn again. Real-phone profiling on CPH2653 showed mqt_v_js pinned
// at ~100% for roughly 50 seconds during parser migration. Foreground history
// is maintenance work: after each frame-sized slice, leave one frame for
// input/render work before the next. Background history keeps the fast path.
// This is a scheduling window, not a measured phone constant; confirm with
// EXPO_PUBLIC_WAFRA_CAPTURE_TRACE=1 page timings on the target device.
const FOREGROUND_PARSE_YIELD_MS = 16;
// Some Android providers insert one SMS twice. Collapse only byte-identical,
// same-sender, consecutive inbox rows delivered less than one second apart.
const EXACT_PROVIDER_DUPLICATE_MS = 1_000;

interface ParseYieldState {
  startedAt: number;
  parsed: number;
}

function yieldToUi(): Promise<void> {
  if (RNAppState?.currentState !== 'active') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return waitForForegroundHistoryIdle(FOREGROUND_PARSE_YIELD_MS);
}

const createParseYieldState = (): ParseYieldState => ({ startedAt: Date.now(), parsed: 0 });

function parseYieldDue(state: ParseYieldState, hasMore: boolean): boolean {
  state.parsed += 1;
  if (!hasMore) return false;
  // With a headless execution lease there is no visible frame to render.
  // Reduce timer/bridge turns off-screen, but immediately restore the 4ms
  // interactive budget when the user returns. Parsing and order do not change.
  const background = RNAppState?.currentState === 'background';
  const withinCount = state.parsed < (background ? MAX_PARSE_SLICE_SIZE * 4 : MAX_PARSE_SLICE_SIZE);
  const withinTime = Date.now() - state.startedAt < (background ? PARSE_TIME_BUDGET_MS * 4 : PARSE_TIME_BUDGET_MS);
  return !withinCount || !withinTime;
}

function resetParseYieldState(state: ParseYieldState): void {
  state.startedAt = Date.now();
  state.parsed = 0;
}

export function isSmsScanningAvailable(): boolean {
  return Platform.OS === 'android' && SmsReader != null;
}

/** Android's explicit Notification access plus Wafra's local admission choice. */
export function hasBankNotificationAccess(): boolean {
  if (Platform.OS !== 'android' || !NotificationReader) return false;
  try {
    return isBankNotificationCaptureAvailable(NotificationReader.isAvailable?.() === true) &&
      NotificationReader.isEnabled?.() === true;
  } catch {
    return false;
  }
}

/** Android's system-level Notification access, independent of Wafra's local admission lease. */
export function hasBankNotificationSystemAccess(): boolean {
  if (Platform.OS !== 'android' || !NotificationReader) return false;
  try {
    return isBankNotificationCaptureAvailable(NotificationReader.isAvailable?.() === true) &&
      NotificationReader.hasSystemAccess?.() === true;
  } catch {
    return false;
  }
}

/** Open Android's Notification access screen. The user must approve this system permission. */
export async function openBankNotificationAccessSettings(): Promise<boolean> {
  if (Platform.OS !== 'android' || !NotificationReader ||
    !isBankNotificationCaptureAvailable(NotificationReader.isAvailable?.() === true)) return false;
  try {
    return NotificationReader.openSettings?.() === true;
  } catch {
    return false;
  }
}

/** Older binaries remain usable; only new modules emit this source-free hint. */
export function subscribeInboxChanges(listener: () => void): () => void {
  if (!isSmsScanningAvailable()) return () => {};
  const subscription = SmsReader?.addListener?.('onInboxChanged', listener);
  return () => subscription?.remove();
}

export async function hasSmsPermission(): Promise<boolean> {
  if (!isSmsScanningAvailable()) return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
}

/**
 * READ_SMS is enough for catch-up after Wafra opens; RECEIVE_SMS is what lets
 * Android deliver the real-time SMS_RECEIVED edge while Wafra is backgrounded.
 * Keep the two facts separate so diagnostics/UI cannot call catch-up access
 * "live capture ready" when the delivery permission is actually missing.
 */
export async function hasSmsDeliveryPermission(): Promise<boolean> {
  if (!isSmsScanningAvailable()) return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
}

export async function requestSmsPermission(): Promise<boolean> {
  if (!isSmsScanningAvailable()) return false;
  if (await hasSmsPermission()) return true;
  // Automatic ledger import reads the Android system inbox. RECEIVE_SMS is a
  // separate, optional capability used only by the instant-banner toggle and
  // is requested at that point—not bundled into first-run tracking consent.
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** Open Wafra's Android app-details page, including restricted-access controls. */
export async function openSmsPermissionSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Linking.openSettings();
}

/** Stable native error boundary; never inspect or expose platform error text. */
export function isSmsInboxAccessError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && (
      (error as { code?: unknown }).code === 'ERR_SMS_INBOX_ACCESS' ||
      (error as { code?: unknown }).code === 'ERR_SMS_HISTORY_UNAVAILABLE'
    );
}

export async function requestSmsDeliveryPermission(): Promise<boolean> {
  if (!isSmsScanningAvailable()) return false;
  const permission = PermissionsAndroid.PERMISSIONS.RECEIVE_SMS;
  if (await hasSmsDeliveryPermission()) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

export type { CaptureChannel } from '@/lib/dedupe';

export type { ScannedSms, DeclinedSms, ImportPlan } from '@/lib/import-plan';
export { buildImportPlan } from '@/lib/import-plan';

export interface InboxScanCursor {
  beforeDateMs: number;
  beforeId: number;
}

export interface ScanInboxOptions {
  /** Read the bank-app queue without requiring or advancing the SMS inbox. */
  notificationOnly?: boolean;
  /** Packages explicitly learned after the user confirmed a review candidate. */
  learnedNotificationPackages?: readonly string[];
  /** Resume strictly before this lossless Android provider date/id pair. */
  cursor?: InboxScanCursor | null;
  /** Omit for the existing complete scan; history import uses one page. */
  maxInboxPages?: number;
  /**
   * Android provider rows per page. Ordinary capture stays at 1,000; the
   * resumable first-history owner may use a larger bounded page to reduce
   * expensive encrypted-ledger checkpoints without changing cursor safety.
   */
  pageSize?: number;
  /** Exact old source hashes currently retained by the authoritative ledger/tray. */
  legacyReviewSourceKeys?: readonly string[];
  /**
   * Bound bank-app queue work for short headless Android wakes. Foreground
   * drains omit this and keep the existing "read every retained row" behavior.
   */
  maxNotificationRows?: number;
  /**
   * False only for the event-driven SMS headless wake. Ordinary foreground
   * scans keep draining both local sources exactly as before.
   */
  includeNotificationQueue?: boolean;
  /**
   * Parser-version history repair only. Skip rows that cannot possibly produce
   * a ledger result before invoking the expensive regional/worldwide grammar.
   * Routine live capture keeps its broader review behavior unchanged.
   */
  historyRepair?: boolean;
}

export interface ScanResult {
  parsed: ScannedSms[];
  /**
   * Sanitized global alerts that the launch parser refused but the worldwide
   * inspector can ground strongly enough for review. These never enter
   * `parsed`, so this scanner cannot auto-import them.
   */
  reviewCandidates: ReviewEntry[];
  /** Transient, source-attested identity migrations; never a persisted payload. */
  reviewSourceBindings?: ReviewSourceBinding[];
  /**
   * Body-free identities of non-posting alerts and proven provider duplicates.
   *
   * A non-posting message yields no ParsedSms and used to end here: the `if (p)`
   * below dropped it, and with it the only proof left anywhere that the alert
   * an older parser had booked as a real expense says the money never moved.
   * `raw` on the stored row cannot substitute — retention is recent, and the
   * user this was written for has 59 such rows and no bodies. So the timestamp
   * (and nothing else) is carried to buildImportPlan, which uses it to retire
   * the row. See DeclinedSms in import-plan.ts for the guards on that.
   */
  declined: DeclinedSms[];
  /** Timestamp of the newest message seen, for incremental scans. */
  newestTs: number;
  /** Rows yielded specifically by Android's SMS inbox provider. */
  inboxScannedCount: number;
  /** The inbox provider reached a real end-of-history page. */
  inboxHistoryComplete: boolean;
  /** Cursor for the next bounded page, null only at the real history end. */
  nextCursor: InboxScanCursor | null;
  scannedCount: number;
  /** Strong launch-pack evidence observed while parsing this scan. */
  detectedLaunchMarket: 'AE' | 'SA' | null;
  /** Retire native notification rows only after ledger/review durability. */
  commit: () => Promise<void>;
  /** Queue ACK requires a flush even when every candidate deduplicated. */
  requiresDurableCommit?: boolean;
}

const NOOP_SCAN_COMMIT = async () => {};

/** Best-effort locale region. Routing treats it only as supporting evidence. */
function deviceRegionHint(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? null;
  } catch {
    return null;
  }
}

const DATABASE_KEY_NAME = 'wafra.database.key.v1';
const REVIEW_IDENTITY_DOMAIN = 'wafra.alert-review-identity.v1';
const REVIEW_TEMPLATE_DOMAIN = 'wafra.alert-review-template.v1';

class ReviewIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewIdentityError';
  }
}

type ExpoDigest = {
  CryptoDigestAlgorithm: { SHA256: unknown };
  digestStringAsync(algorithm: unknown, data: string): Promise<string>;
};

const sha256 = (data: string): Promise<string> => {
  // The test harness intentionally stubs only Crypto's random-byte surface.
  // Cast at this private seam while production calls Expo SDK 55's documented
  // digestStringAsync/CryptoDigestAlgorithm pair directly.
  const digest = Crypto as unknown as ExpoDigest;
  return digest.digestStringAsync(digest.CryptoDigestAlgorithm.SHA256, data);
};

/**
 * Stable, device-bound identity for one Android capture.
 *
 * The SQLCipher database key is already random, THIS_DEVICE_ONLY, and deleted
 * by the ledger's cryptographic erase. A domain-separated derivative keys this
 * local fingerprint, so a copied tombstone cannot be tested against guessed
 * bank messages offline. No second key or erase path is introduced.
 */
export async function reviewCaptureIdentity(
  source: string,
  sender: string,
  observedAt: number,
  channel: CaptureChannel,
  databaseKey: string,
  digestString: (data: string) => Promise<string> = sha256,
): Promise<{ id: string; sourceKey: string; templateKey: string } | null> {
  if (!/^[0-9a-f]{64}$/i.test(databaseKey)) return null;
  const material = [
    channel,
    String(observedAt),
    bodyPrint(sender.normalize('NFKC')),
    bodyPrint(source.normalize('NFKC')),
  ].join('\u0000');
  const identityKey = await digestString(`${REVIEW_IDENTITY_DOMAIN}\u0000${databaseKey}`);
  const digest = await digestString(`${identityKey}\u0000${material}`);
  const template = normalizeUnparsedLaunchTemplate(source);
  const templateIdentityKey = await digestString(`${REVIEW_TEMPLATE_DOMAIN}\u0000${databaseKey}`);
  const templateDigest = await digestString([
    templateIdentityKey,
    bodyPrint(sender.normalize('NFKC')),
    template,
  ].join('\u0000'));
  if (!/^[0-9a-f]{64}$/i.test(digest) || !/^[0-9a-f]{64}$/i.test(templateDigest)) return null;
  return {
    sourceKey: `arc1_${digest}`,
    id: `ari1_${digest}`,
    templateKey: `art1_${templateDigest}`,
  };
}

/**
 * Reuse only the two key derivations within ONE inbox scan. All source and
 * template fingerprints still run independently and remain byte-identical.
 * Nothing is cached at module scope, so a later scan/erase cannot reuse keys.
 * The cache admits exactly two constant inputs, never SMS bodies or senders.
 */
export function createReviewIdentitySession(databaseKey: string) {
  const permitted = new Set([
    `${REVIEW_IDENTITY_DOMAIN}\u0000${databaseKey}`,
    `${REVIEW_TEMPLATE_DOMAIN}\u0000${databaseKey}`,
  ]);
  const derivations = new Map<string, Promise<string>>();
  const digestString = (data: string): Promise<string> => {
    if (!permitted.has(data)) return sha256(data);
    const cached = derivations.get(data);
    if (cached) return cached;
    const pending = sha256(data);
    derivations.set(data, pending);
    // Do not poison a scan's retry after a transient native-crypto failure.
    void pending.catch(() => {
      if (derivations.get(data) === pending) derivations.delete(data);
    });
    return pending;
  };
  return (source: string, sender: string, observedAt: number, channel: CaptureChannel) =>
    reviewCaptureIdentity(source, sender, observedAt, channel, databaseKey, digestString);
}

type KeyedReviewIdentity = NonNullable<Awaited<ReturnType<typeof reviewCaptureIdentity>>>;
const ANDROID_PROVIDER_ID_RE = /^a(?:0|[1-9]\d{0,39})$/;

async function bindProviderReviewIdentity(
  legacy: KeyedReviewIdentity,
  sourceEventId?: string,
): Promise<KeyedReviewIdentity> {
  if (!sourceEventId || !ANDROID_PROVIDER_ID_RE.test(sourceEventId)) return legacy;
  const providerDigest = await sha256([
    REVIEW_IDENTITY_DOMAIN, 'provider', legacy.id, sourceEventId,
  ].join('\u0000'));
  if (!/^[0-9a-f]{64}$/i.test(providerDigest)) throw new ReviewIdentityError('Encrypted review identity is invalid');
  return {
    ...legacy,
    id: `ari1_${providerDigest}`,
    sourceKey: `android_message_review_source_${sourceEventId}`,
  };
}

export type SourceFreeReviewCandidate =
  | Omit<ReviewAlert, 'id' | 'sourceKey' | 'templateKey'>
  | Omit<UniversalReviewAlert, 'id' | 'sourceKey'>;

export interface SourceFreeReviewIdentity {
  id: string;
  sourceKey: string;
  templateKey?: string;
}

export type SourceFreeRefusedAlertDecision =
  | { kind: 'declined'; reason: NonPostingReason }
  | { kind: 'review'; candidate: SourceFreeReviewCandidate }
  | { kind: 'ignored'; reason: 'promotion' | 'non-financial' | 'unrecognized' };

// An unresolved encrypted push row remains in the native queue on purpose so
// a future parser can recover it. Retrying the same parser miss on every tab
// foreground is different: it burns CPU without adding evidence. Keep only the
// opaque native id for this JS process, and clear the set whenever the parser
// context changes. A process restart or app/parser update naturally retries.
const unresolvedNotificationIdsThisSession = new Set<string>();
let unresolvedNotificationSessionKey = '';

const isPromotionalBankPush = (source: string): boolean =>
  /\b(?:get|earn|save|enjoy|redeem)\b.{0,100}\b(?:cashback|discount|offers?|off)\b/i.test(source) &&
  !/\b(?:has been used|was used|spent|charged|debited|credited|paid|completed|posted)\b/i.test(source);

// A regional transaction parser can legitimately refuse a non-posting bank
// fact that still belongs in Review (balance/limit/statement/bill). Those
// bounded shapes keep the universal informational fallback. A bare amount plus
// status/reference prose has no additional market/role evidence and is the
// expensive repeated miss we leave encrypted for a future parser instead.
const KNOWN_BANK_UNIVERSAL_INFO_HINT =
  /\b(?:available|current|remaining)\s+(?:balance|limit)|\b(?:credit\s+limit|statement|minimum\s+(?:amount\s+)?due|total\s+(?:amount\s+)?due|amount\s+due|bill\s+due|payment\s+due)\b|رصيد|حد\s+ائتمان|كشف|مستحق/iu;

/**
 * A parsed notification from an unconfirmed Android package is strong enough
 * to show the user a bounded Review proposal, but never strong enough to write
 * money automatically. Reconstruct only structured parser facts; no raw source
 * text or sender survives this boundary.
 */
export function parsedFinancialCandidateReview(
  parsed: Omit<ParsedSms, 'raw'>,
  observedAt: number,
): SourceFreeReviewCandidate | null {
  const event = parsedTransactionReviewEvent(parsed);
  if (!event) return null;
  const prepared = prepareUniversalReviewAlert({
    id: 'capture_probe_id_0001',
    sourceKey: 'capture_probe_key_001',
    observedAt,
    channel: 'push',
    event,
  });
  if (!prepared) return null;
  const { id: _id, sourceKey: _sourceKey, ...candidate } = prepared;
  return candidate;
}

/**
 * Preserve grounded money from a trusted/verified bank notification even when
 * neither parser can prove enough semantics for automatic posting.
 *
 * Unknown direction/status/family are valid Universal Review states: the UI
 * asks the user instead of silently inventing a transaction. This is the safe
 * terminal path for terse OEM/bank-app push formats such as a bare amount plus
 * reference text. Previously those rows stayed encrypted in the native queue
 * forever and diagnostics reported unresolvedParserMiss=1.
 */
function universalEventReviewCandidate(
  event: UniversalBankEvent,
  observedAt: number,
  channel: CaptureChannel = 'push',
): SourceFreeReviewCandidate | null {
  const prepared = prepareUniversalReviewAlert({
    id: 'capture_probe_id_0001',
    sourceKey: 'capture_probe_key_001',
    observedAt,
    channel,
    event,
  });
  if (!prepared) return null;
  const { id: _id, sourceKey: _sourceKey, ...candidate } = prepared;
  return candidate;
}

const AUTOMATIC_UNIVERSAL_FAMILIES = new Set<UniversalBankEvent['family']>([
  'purchase', 'refund', 'cash-withdrawal', 'fee', 'utility', 'recurring-payment', 'transfer',
]);

/**
 * Convert one source-grounded worldwide event into the same structured row the
 * legacy launch parser emits. This is intentionally stricter than Review:
 * unknown direction/status, ambiguous money and statement/bill facts remain
 * review-only. Transfer rows are allowed only after template certification and
 * retain transferHint so uncertain ownership is excluded from exact totals.
 * Currency comes from ISO metadata, never a country default.
 */
function parsedUniversalPosting(
  event: UniversalBankEvent,
  source: string,
  overrides: Record<string, import('@/lib/types').CategoryId>,
  market?: string | null,
): ParsedSms | null {
  if (event.decision !== 'review' || event.status !== 'posted' ||
      (event.direction !== 'debit' && event.direction !== 'credit') ||
      !AUTOMATIC_UNIVERSAL_FAMILIES.has(event.family) ||
      event.amount.evidence !== 'explicit' || !event.amount.value) return null;

  if ((event.family === 'refund' && event.direction !== 'credit') ||
      (event.family !== 'refund' && event.family !== 'transfer' && event.direction !== 'debit')) return null;

  const spec = ledgerMoneySpec(event.amount.value.currency);
  if (!spec || spec.exponent !== event.amount.value.exponent ||
      !/^[1-9]\d{0,39}$/.test(event.amount.value.minorUnits)) return null;
  let minor: bigint;
  try { minor = BigInt(event.amount.value.minorUnits); } catch { return null; }
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  const type = event.direction === 'credit' ? 'income' : 'expense';
  const suggestion = event.family === 'transfer'
    ? { category: 'other' as import('@/lib/types').CategoryId, merchant: '', needsReview: false }
    : suggestUniversalCategory(event, {
        type,
        overrides,
        market: market ?? undefined,
      });
  const explicitMerchant = event.merchant.evidence === 'explicit'
    ? event.merchant.value?.trim() ?? ''
    : '';
  const fallbackTitle = event.family === 'refund' ? 'Refund'
    : event.family === 'cash-withdrawal' ? 'ATM withdrawal'
      : event.family === 'fee' ? 'Bank fee'
        : event.family === 'utility' ? 'Utility payment'
          : event.family === 'recurring-payment' ? 'Recurring payment'
            : event.family === 'transfer'
              ? event.direction === 'credit' ? 'Incoming transfer' : 'Outgoing transfer'
            : 'Card purchase';
  // Transfer ownership is a separate reconciliation question. Preserve a
  // structural title so the ledger keeps this row in the unresolved-transfer
  // bucket until it can prove own vs external; a recipient name must not turn a
  // transfer into ordinary spending merely because merchant extraction found it.
  const merchant = event.family === 'transfer'
    ? fallbackTitle
    : suggestion.merchant || explicitMerchant || fallbackTitle;
  const instrument = event.instrument.evidence === 'explicit' ? event.instrument.value : null;
  const card = instrument?.last4
    ? {
        last4: instrument.last4,
        kind: instrument.kind === 'account' ? 'account' as const : 'unknown' as const,
      }
    : null;
  return {
    kind: 'transaction',
    type,
    amountFils: Number(minor),
    currency: spec.currency,
    merchant,
    date: event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null,
    dueDay: null,
    minDueFils: null,
    card,
    reference: null,
    transferHint: event.family === 'transfer',
    snapshotFils: null,
    snapshotKind: null,
    categoryGuess: suggestion.category,
    categoryDeliberate: !suggestion.needsReview,
    raw: source,
  };
}

/**
 * One source-free refusal policy shared by Android inbox capture and iOS local
 * capture. Source and sender are consumed only while inspecting; neither can
 * appear in the returned decision.
 */
export function inspectSourceFreeRefusedAlert(input: {
  source: string;
  sender: string;
  observedAt: number;
  channel: CaptureChannel;
  session: Pick<LaunchAlertSession, 'inspect'>;
  existingInspection?: UniversalAlertReview | null;
  /** Known launch-bank package identity makes worldwide fallback unnecessary. */
  skipUniversalFallback?: boolean;
}): SourceFreeRefusedAlertDecision {
  const reason = nonPostingReason(input.source);
  if (reason) return { kind: 'declined', reason };
  // A generic amount detector can read "Get AED 50 cashback on your next
  // purchase" as a posted purchase. The launch parser already refused it;
  // never turn a bank-app offer into an actionable spending review.
  if (input.channel === 'push' && isPromotionalBankPush(input.source)) {
    return { kind: 'ignored', reason: 'promotion' };
  }
  if (!hasBankAlertMoneyHint(input.source) &&
    !hasGenericBankAlertContext(input.source, input.sender)) {
    return { kind: 'ignored', reason: 'non-financial' };
  }

  // A launch-bank purchase in a currency the offline table cannot price
  // (NGN, ISK, UZS ...) waits in Review in its own currency until a dated
  // rate converts it at promotion. It is never dropped, even when the
  // worldwide fallback below is skipped or cannot read the template.
  const launchMarket = detectLaunchMarketFromAlert(input.source, input.sender);
  const awaitingRate = launchMarket
    ? withMarketPackForParsing(launchMarket, () => parseForeignAwaitingRate(input.source, undefined, {
        sender: input.sender, observedAt: input.observedAt,
      }))
    : null;
  if (awaitingRate) {
    const { raw: _raw, ...facts } = awaitingRate;
    const candidate = parsedFinancialCandidateReview(facts, input.observedAt);
    if (candidate) return { kind: 'review', candidate: { ...candidate, channel: input.channel } };
  }

  const inspection = input.existingInspection ?? input.session.inspect(input.source, input.sender);
  const prepared = inspection
    ? prepareReviewAlert({
        id: 'capture_probe_id_0001',
        sourceKey: 'capture_probe_key_001',
        observedAt: input.observedAt,
        channel: input.channel,
        inspection,
      })
    : null;
  // A globally routed or ambiguous result has already been judged by the
  // global inspector. The launch fallback is only for alerts with no route.
  const launchReview = inspection === null
    ? inspectUnparsedLaunchAlert(input.source, input.sender)
    : null;
  const reviewPrepared = prepared ?? (launchReview?.outcome === 'review'
    ? prepareLaunchReviewAlert({
        id: 'capture_probe_id_0001',
        sourceKey: 'capture_probe_key_001',
        observedAt: input.observedAt,
        channel: input.channel,
        review: launchReview.review,
      })
    : null);
  if (!reviewPrepared) {
    // A curated UAE/Saudi Android package already established the market. If
    // the mature regional parser and its launch-review fallback both refused
    // the alert, running the eight-language generic parser cannot improve
    // issuer routing and can be very expensive on rich OEM notification text.
    // Leave the encrypted row unresolved for a future parser instead.
    if (input.skipUniversalFallback) return { kind: 'ignored', reason: 'unrecognized' };
    const event = inspectGenericBankEventForReview(input.source, input.sender);
    const universal = event ? prepareUniversalReviewAlert({
      id: 'capture_probe_id_0001',
      sourceKey: 'capture_probe_key_001',
      observedAt: input.observedAt,
      channel: input.channel,
      event,
    }) : null;
    if (!universal) return { kind: 'ignored', reason: 'unrecognized' };
    const { id: _id, sourceKey: _sourceKey, ...candidate } = universal;
    return { kind: 'review', candidate };
  }
  const {
    id: _id,
    sourceKey: _sourceKey,
    templateKey: _templateKey,
    ...candidate
  } = reviewPrepared;
  return { kind: 'review', candidate };
}

/** Attach an opaque identity only after review admission has removed source. */
export function identifySourceFreeReviewAlert(
  candidate: SourceFreeReviewCandidate,
  identity: SourceFreeReviewIdentity,
): ReviewEntry | null {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(identity.id) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(identity.sourceKey) ||
    (identity.templateKey !== undefined &&
      !/^[A-Za-z0-9_-]{16,128}$/.test(identity.templateKey))) {
    return null;
  }
  if ('kind' in candidate && candidate.kind === 'universal') {
    return { ...candidate, id: identity.id, sourceKey: identity.sourceKey };
  }
  return { ...candidate, ...identity };
}

export const shouldReviewParsedIncome = (parsedAlert: ParsedSms): boolean =>
  parsedAlert.type === 'income' && !parsedAlert.transferHint &&
  parsedAlert.categoryGuess === 'other' && !parsedAlert.categoryDeliberate;

/**
 * Reads the inbox from `sinceMs` to now in pages (full history when sinceMs = 0)
 * and parses every message. onProgress fires per page for UI feedback.
 */
export async function scanInbox(
  sinceMs: number,
  overrides: Record<string, import('@/lib/types').CategoryId>,
  onProgress?: (scanned: number, found: number) => void,
  regionHint: string | null = deviceRegionHint(),
  options: ScanInboxOptions = {},
): Promise<ScanResult> {
  if (Platform.OS !== 'android' || (!options.notificationOnly && !SmsReader)) {
    return {
      parsed: [], reviewCandidates: [], declined: [], newestTs: sinceMs,
      inboxScannedCount: 0, inboxHistoryComplete: false, scannedCount: 0,
      nextCursor: null,
      detectedLaunchMarket: null,
      commit: NOOP_SCAN_COMMIT,
    };
  }

  const tracing = captureTraceEnabled();
  const traceStarted = tracing ? Date.now() : 0;
  captureTrace('inbox:start');
  const parsed: (ParsedSms & {
    smsTs: number;
    sender: string;
    channel: CaptureChannel;
    sourceEventId?: string;
  })[] = [];
  const reviewCandidates: ReviewEntry[] = [];
  const reviewSourceBindings: ReviewSourceBinding[] = [];
  const requestedLegacySources = new Set((options.legacyReviewSourceKeys ?? [])
    .filter((value) => /^arc1_[0-9a-f]{64}$/.test(value)));
  const bindingPairs = new Set<string>();
  const noteSourceBinding = (
    legacy: KeyedReviewIdentity,
    identity: KeyedReviewIdentity,
    observedAt: number,
  ) => {
    if (!requestedLegacySources.has(legacy.sourceKey) || identity.sourceKey === legacy.sourceKey) return;
    const pair = `${legacy.sourceKey}\u0000${identity.sourceKey}`;
    if (bindingPairs.has(pair)) return;
    bindingPairs.add(pair);
    reviewSourceBindings.push({
      legacyId: legacy.id, legacySourceKey: legacy.sourceKey,
      id: identity.id, sourceKey: identity.sourceKey, observedAt,
    });
  };
  const reviewSourceKeys = new Set<string>();
  const reviewDiscoveredAt = Date.now();
  let databaseKeyPromise: Promise<string | null> | null = null;
  const databaseKey = (): Promise<string | null> => {
    databaseKeyPromise ??= SecureStore.getItemAsync(DATABASE_KEY_NAME);
    return databaseKeyPromise;
  };
  // Create lazily: a normal parsed/ignored message never requests key access.
  let identitySession: ReturnType<typeof createReviewIdentitySession> | null = null;
  const identifyCapture = async (
    source: string, sender: string, observedAt: number, channel: CaptureChannel,
  ) => {
    const key = await databaseKey();
    if (!key) throw new ReviewIdentityError('Encrypted review identity is unavailable');
    identitySession ??= createReviewIdentitySession(key);
    return identitySession(source, sender, observedAt, channel);
  };
  const declined: DeclinedSms[] = [];
  const notificationIds = new Set<string>();
  let notificationImportStats: AndroidNotificationImportDiagnostics | null = null;
  const launchSession = createLaunchAlertSession({ overrides, regionHint });
  const inspectWorldwide = launchSession.inspect;
  const parseLaunchAlert = launchSession.parse;
  /**
   * Called only where the launch parser returned null. Declines keep their
   * existing healing fingerprint and stop there. Every other refusal may be
   * inspected, but only `prepareReviewAlert` can emit a source-free candidate;
   * OTPs, offers, balances, failed/future activity and ambiguous money vanish.
   */
  const inspectRefused = async (
    body: string,
    ts: number,
    sender: string,
    channel: CaptureChannel,
    existingInspection: UniversalAlertReview | null = null,
    sourceEventId?: string,
    pushSource?: {
      packageName: string;
      sourceClass: 'trusted-bank' | 'play-finance' | 'financial-candidate';
    },
    parsedFallback?: SourceFreeReviewCandidate | null,
    skipUniversalFallback = false,
    /** Only for alerts NO parser read (`!p`); never for a parsed row under review. */
    aiEligible = false,
  ): Promise<SourceFreeRefusedAlertDecision> => {
    let decision = inspectSourceFreeRefusedAlert({
      source: body,
      sender,
      observedAt: ts,
      channel,
      session: launchSession,
      existingInspection,
      skipUniversalFallback,
    });
    if (decision.kind === 'ignored' && decision.reason === 'unrecognized' && parsedFallback) {
      decision = { kind: 'review', candidate: parsedFallback };
    }
    // AI reading (ai-alert-reader.ts): only for an alert every proven path and
    // the refusal pipeline left unrecognised, only when the person downloaded
    // the model, never for AE/SA senders. It can only add a Review item with
    // suggested fields; with no model it resolves null and nothing changes.
    if (aiEligible && !parsedFallback && !skipUniversalFallback &&
      decision.kind === 'ignored' && decision.reason === 'unrecognized') {
      const aiEvent = await aiReviewEventForRefusedAlert(body, sender, ts);
      let aiCandidate: SourceFreeReviewCandidate | null = null;
      try { aiCandidate = aiEvent ? universalEventReviewCandidate(aiEvent, ts, channel) : null; } catch { aiCandidate = null; }
      if (aiCandidate) decision = { kind: 'review', candidate: aiCandidate };
    }
    if (decision.kind === 'declined') {
      declined.push({
        smsTs: ts,
        sender,
        channel,
        reason: decision.reason,
        sourceEventId,
      });
      return decision;
    }
    if (decision.kind === 'ignored') return decision;
    const legacyIdentity = await identifyCapture(body, sender, ts, channel);
    if (!legacyIdentity) throw new ReviewIdentityError('Encrypted review identity is invalid');
    // Keep exact old/new tuples only when the ledger requested that old hash.
    const identity = await bindProviderReviewIdentity(legacyIdentity, sourceEventId);
    noteSourceBinding(legacyIdentity, identity, ts);
    const identified = identifySourceFreeReviewAlert(decision.candidate, identity);
    if (!identified) throw new ReviewIdentityError('Encrypted review identity is invalid');
    const universal = isUniversalReviewAlert(identified);
    const sourceIdentity = universal
      ? { id: identity.id, sourceKey: identity.sourceKey }
      : identity;
    const reviewPrepared = {
      ...identified,
      ...sourceIdentity,
      ...(pushSource && channel === 'push' ? {
        sourcePackage: pushSource.packageName,
        sourceClass: pushSource.sourceClass,
      } : {}),
      // Discovery is now even when this full scan finds an old Message.
      // Keep event time and its stable identity; only review retention moves.
      expiresAt: Math.max(identified.expiresAt, reviewDiscoveredAt + REVIEW_ALERT_TTL_MS),
    };
    if (reviewSourceKeys.has(sourceIdentity.sourceKey)) return decision;
    reviewSourceKeys.add(sourceIdentity.sourceKey);
    if (isUniversalReviewAlert(reviewPrepared) && eligibleLocalReviewEvent(reviewPrepared.event)) {
      // The persisted tray intentionally has no source/spans. Reinspect while
      // source is in hand, and bind only an exact match to this review entry.
      const inspected = inspectGenericBankEventForReview(body, sender);
      if (inspected && eligibleLocalReviewEvent(inspected) &&
          JSON.stringify(sanitizeUniversalReviewEvent(inspected)) === JSON.stringify(reviewPrepared.event)) {
        const window = buildLocalParserSemanticWindow(body, inspected);
        if (window) void localReviewAdvisor.enqueue(reviewPrepared, inspected, window);
      }
    }

    // Keep the explicit encrypted-identity merge visible to the repository's
    // static safety contract even though the shared helper validated it too.
    if (universal) reviewCandidates.push(reviewPrepared);
    else reviewCandidates.push({ ...reviewPrepared, ...identity });
    // Inbox, delivery and push are collected in different phases. Keep the
    // newest bounded set by event time—not whichever channel happened to run
    // first—so a full inbox cannot crowd out a fresh bank-app alert.
    reviewCandidates.sort((a, b) => a.observedAt - b.observedAt);
    if (reviewCandidates.length > MAX_REVIEW_CANDIDATES) {
      reviewCandidates.splice(0, reviewCandidates.length - MAX_REVIEW_CANDIDATES);
    }
    return decision;
  };
  /** Bodies already taken from the inbox, so the delivery buffer cannot re-add them. */
  const inboxBodies = new Set<string>();
  let newestTs = sinceMs;
  let beforeDateMs = options.cursor?.beforeDateMs ?? Date.now() + 60_000;
  let beforeId = options.cursor?.beforeId ?? Number.MAX_SAFE_INTEGER;
  let inboxScannedCount = 0;
  let inboxHistoryComplete = false;
  let nextCursor: InboxScanCursor | null = null;
  let scannedCount = 0;
  let previousInboxSms: InboxSms | null = null;
  let pagesRead = 0;
  const maxInboxPages = options.maxInboxPages === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.floor(options.maxInboxPages));
  // Two is the minimum safe bounded page because resumable pagination keeps
  // one row of overlap at a process boundary for exact-provider dedupe.
  const pageSize = options.pageSize === undefined
    ? DEFAULT_PAGE_SIZE
    : Math.max(2, Math.min(Math.floor(options.pageSize), MAX_PAGE_SIZE));

  // A bank can send push alerts without any SMS. Keep SMS history/cursor work
  // separate so declining READ_SMS does not prevent the user's explicitly
  // granted notification listener from draining its encrypted queue.
  const smsReader = options.notificationOnly ? null : SmsReader;
  for (;;) {
    if (!smsReader) break;
    const readStarted = tracing ? Date.now() : 0;
    const batch: InboxSms[] = await smsReader.getInboxSms(
      sinceMs,
      beforeDateMs,
      beforeId,
      pageSize,
    );
    captureTrace('page:read', batch.length, tracing ? Date.now() - readStarted : 0, pagesRead + 1);
    if (batch.length === 0) {
      inboxHistoryComplete = true;
      nextCursor = null;
      break;
    }
    pagesRead += 1;
    inboxScannedCount += batch.length;
    scannedCount += batch.length;
    const pageYield = createParseYieldState();
    const pageStarted = tracing ? Date.now() : 0;
    let traceCheckpoint = pageStarted;
    for (let i = 0; i < batch.length; i++) {
      if (tracing && (i === 0 || Date.now() - traceCheckpoint >= 1000)) {
        traceCheckpoint = Date.now();
        captureTrace('page:progress', i, traceCheckpoint - pageStarted, pagesRead);
      }
      const sms = batch[i];
      const sourceEventId = `a${sms.id}`;
      if (sms.date > newestTs) newestTs = sms.date;
      inboxBodies.add(bodyPrint(sms.body));
      const previous = previousInboxSms;
      previousInboxSms = sms;
      if (
        previous &&
        previous.id === sms.id + 1 &&
        previous.date >= sms.date &&
        previous.date - sms.date <= EXACT_PROVIDER_DUPLICATE_MS &&
        previous.address === sms.address &&
        previous.body === sms.body
      ) {
        declined.push({
          smsTs: sms.date,
          sender: sms.address,
          channel: 'inbox',
          reason: 'exact-provider-duplicate',
          sourceEventId,
        });
        if (parseYieldDue(pageYield, i + 1 < batch.length)) {
          await yieldToUi();
          resetParseYieldState(pageYield);
        }
        continue;
      }
      const launchSenderMarket = detectLaunchMarketFromSender(sms.address);
      if (options.historyRepair) {
        // Every production parser path requires explicit money evidence before
        // it can materialize a transaction/card payment. Unknown senders also
        // need bank-alert context; this drops personal conversations carrying
        // prices/currency without weakening global bank support.
        if (!hasBankAlertMoneyHint(sms.body) ||
            (launchSenderMarket === null && !hasGenericBankAlertContext(sms.body, sms.address))) {
          if (parseYieldDue(pageYield, i + 1 < batch.length)) {
            await yieldToUi();
            resetParseYieldState(pageYield);
          }
          continue;
        }
      }
      // The sender ID is the ONLY thing that says which bank sent a message —
      // no UAE bank but HSBC names itself in the body — so it is passed INTO
      // the parser, not merely recorded on the row. Three rules need it and
      // cannot be answered from the text: a Sharia-compliant issuer's
      // "Covered Card" is a credit card, a Liv Goal or a Wio Saving Space is
      // the bank's own savings pot rather than a shop, and money moving to the
      // bank's own brand name is moving inside your own bank.
      const worldwide = inspectWorldwide(sms.body, sms.address);
      // Global SMS sender IDs stay review-first. Sender strings are useful
      // issuer evidence, but unlike an Android package identity they are not a
      // device-installed trust anchor. UAE/Saudi retain their mature automatic
      // parser; other markets use the sanitized worldwide Review path below.
      // Other senders stay review-first unless the one unproven-format policy
      // (best-effort-autopost.ts) proves a completed movement; such a row is
      // marked "Auto-added — check". It never runs for AE/SA senders/routes.
      const p = launchSenderMarket
        ? parseLaunchAlert(sms.body, sms.address, worldwide, launchSenderMarket, sms.date)
        : launchSession.parseUnproven(sms.body, sms.address, worldwide, sms.date);
      // Local-AI shadow evaluation over SMS history: the deterministic
      // universal fact is built only for money-bearing bodies and its redacted
      // window is queued for later scoring, so the scan never waits on the
      // encoder. It can never replace `p`, review, money, status or direction.
      // The parser-version repair pass at startup is excluded on purpose.
      if (!options.historyRepair && canCollectLocalSemanticShadow() && (p || hasBankAlertMoneyHint(sms.body))) {
        const shadowInspection = inspectGenericBankEventForReview(sms.body, sms.address);
        if (shadowInspection) queueLocalSemanticParserShadow(sms.body, shadowInspection);
      }
      const reviewDecision = p && shouldReviewParsedIncome(p)
        ? await inspectRefused(
            sms.body, sms.date, sms.address, 'inbox', worldwide, sourceEventId,
          )
        : null;
      const reviewed = reviewDecision?.kind === 'review';
      if (p && !reviewed) {
        // A parser improvement can turn an old review into a normal parsed
        // row. Attest its old identity before planning, but do no extra source
        // hashing on the ordinary path when there are no old hashes to join.
        if (requestedLegacySources.size > 0) {
          const legacy = await identifyCapture(sms.body, sms.address, sms.date, 'inbox');
          if (!legacy) throw new ReviewIdentityError('Encrypted review identity is invalid');
          if (requestedLegacySources.has(legacy.sourceKey)) {
            noteSourceBinding(legacy, await bindProviderReviewIdentity(legacy, sourceEventId), sms.date);
          }
        }
        parsed.push({
          ...p,
          date: p.kind === 'cardStatement' ? p.date : p.date ?? toISODate(new Date(sms.date)),
          smsTs: sms.date,
          sender: sms.address,
          channel: 'inbox',
          sourceEventId,
        });
      } else if (!p) {
        await inspectRefused(
          sms.body,
          sms.date,
          sms.address,
          'inbox',
          worldwide,
          sourceEventId,
          undefined,
          undefined,
          false,
          true,
        );
      }
      // The native inbox query is already asynchronous; the expensive part is
      // the regex grammar above after the 1,000 bodies cross the bridge. A
      // timer turn lets React Native present pending frames and input events.
      if (parseYieldDue(pageYield, i + 1 < batch.length)) {
        await yieldToUi();
        resetParseYieldState(pageYield);
      }
    }
    captureTrace('page:done', batch.length, tracing ? Date.now() - pageStarted : 0, pagesRead);
    onProgress?.(scannedCount, parsed.length);
    const nextBeforeDateMs = batch[batch.length - 1].date;
    const nextBeforeId = batch[batch.length - 1].id;
    if (nextBeforeDateMs === beforeDateMs && nextBeforeId === beforeId) {
      throw new Error('SMS inbox pagination did not advance');
    }
    if (batch.length < pageSize) {
      inboxHistoryComplete = true;
      nextCursor = null;
      break;
    }
    if (pagesRead >= maxInboxPages) {
      // Repeat the last row on the next page by placing its cursor at the row
      // immediately before it. That one-row overlap preserves the adjacency
      // needed to detect a byte-identical OEM provider duplicate split across
      // a process boundary, without persisting raw SMS or a message hash.
      const overlapBoundary = batch[batch.length - 2];
      nextCursor = {
        beforeDateMs: overlapBoundary.date,
        beforeId: overlapBoundary.id,
      };
      break;
    }
    if (RNAppState?.currentState === 'active') {
      await waitForForegroundHistoryIdle(FOREGROUND_PARSE_YIELD_MS);
    }
    beforeDateMs = nextBeforeDateMs;
    beforeId = nextBeforeId;
  }

  // Alerts the delivery receiver caught as they arrived. Usually the inbox
  // query above already found them; this covers the case where a message
  // never reached the SMS provider, and is the hook a live alert hangs off.
  // Duplicates collapse on the date/amount/title fingerprint in the plan.
  if (inboxHistoryComplete && SmsReader?.getReceived) {
    try {
      const received = await SmsReader.getReceived(sinceMs);
      const deliveryYield = createParseYieldState();
      for (let i = 0; i < received.length; i++) {
        const sms = received[i];
        scannedCount += 1;
        if (sms.date > newestTs) newestTs = sms.date;
        // The inbox pass above almost always found this same message. Its
        // copy carries the provider's timestamp and this one carries the
        // carrier's, which differ by seconds — enough for the fingerprint
        // built from that timestamp to call them two different charges. The
        // body is the one thing both copies agree on exactly.
        if (!inboxBodies.has(bodyPrint(sms.body))) {
          const worldwide = inspectWorldwide(sms.body, sms.address);
          const launchSenderMarket = detectLaunchMarketFromSender(sms.address);
          const p = launchSenderMarket
            ? parseLaunchAlert(sms.body, sms.address, worldwide, launchSenderMarket, sms.date)
            : launchSession.parseUnproven(sms.body, sms.address, worldwide, sms.date);
          const reviewDecision = p && shouldReviewParsedIncome(p)
            ? await inspectRefused(sms.body, sms.date, sms.address, 'delivery', worldwide)
            : null;
          const reviewed = reviewDecision?.kind === 'review';
          if (p && !reviewed) {
            parsed.push({
              ...p,
              date: p.kind === 'cardStatement' ? p.date : p.date ?? toISODate(new Date(sms.date)),
              smsTs: sms.date,
              sender: sms.address,
              channel: 'delivery',
            });
          } else if (!p) {
            await inspectRefused(sms.body, sms.date, sms.address, 'delivery', worldwide, undefined, undefined, undefined, false, true);
          }
        }
        if (parseYieldDue(deliveryYield, i + 1 < received.length)) {
          await yieldToUi();
          resetParseYieldState(deliveryYield);
        }
      }
      onProgress?.(scannedCount, parsed.length);
    } catch (error) {
      if (error instanceof ReviewIdentityError) throw error;
      // Capture buffer is best-effort; the inbox results stand on their own.
    }
  }

  // Bank-app push notifications captured by the notification listener (banks
  // are shifting from SMS to push). Same parser, same dedupe fingerprints.
  const notificationReader = NotificationReader;
  if (options.includeNotificationQueue !== false &&
    (inboxHistoryComplete || options.notificationOnly) && notificationReader &&
    isBankNotificationCaptureAvailable(notificationReader?.isAvailable?.() === true) &&
    notificationReader?.isEnabled?.()) {
    try {
      // This queue has its own explicit acknowledgement. Always read every
      // retained row: using the ledger watermark here could strand an older
      // unacknowledged notification forever after a newer SMS advances it.
      const retained = await notificationReader.getCaptured(0);
      const notificationLimit = options.maxNotificationRows === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Math.floor(options.maxNotificationRows));
      const learnedPackages = new Set(options.learnedNotificationPackages ?? []);
      const notificationSessionKey = [
        PARSER_VERSION,
        pinnedLedgerCurrencyCode() ?? 'un-pinned',
        [...learnedPackages].sort().join(','),
      ].join('|');
      if (notificationSessionKey !== unresolvedNotificationSessionKey) {
        unresolvedNotificationSessionKey = notificationSessionKey;
        unresolvedNotificationIdsThisSession.clear();
      }
      const captured = retained
        .filter((row) => !unresolvedNotificationIdsThisSession.has(row.id))
        .slice(0, notificationLimit);
      notificationImportStats = {
        attemptedAt: Date.now(),
        captured: captured.length,
        autoParsed: 0,
        review: 0,
        declined: 0,
        ignored: 0,
        unresolved: 0,
        unresolvedTrustedBank: 0,
        unresolvedVerifiedFinance: 0,
        unresolvedFinancialCandidate: 0,
        unresolvedParserMiss: 0,
        unresolvedReviewRefusal: 0,
        certificationAutomatic: 0,
        semanticGeneralized: 0,
        certificationReview: 0,
        certificationNeverPost: 0,
        certificationAdapterRequired: 0,
        certificationTemplates: {},
        semanticGeneralizedFamilies: {},
        acknowledgementPlanned: 0,
        acknowledged: 0,
      };
      const notificationYield = createParseYieldState();
      for (let i = 0; i < captured.length; i++) {
        const n = captured[i];
        if (typeof n.id !== 'string' || !/^[A-Za-z0-9-]{16,128}$/.test(n.id)) continue;
        const trustedMarket = trustedBankNotificationMarket(n.pkg);
        const knownLaunchBank = trustedMarket === 'AE' || trustedMarket === 'SA';
        const nativeSourceClass = n.sourceClass;
        if (nativeSourceClass !== 'trusted-bank' && nativeSourceClass !== 'play-finance' &&
            nativeSourceClass !== 'financial-candidate') continue;
        scannedCount += 1;
        if (n.ts > newestTs) newestTs = n.ts;
        const source = `${n.title} ${n.text}`.trim();
        const skipKnownLaunchUniversal =
          knownLaunchBank && !KNOWN_BANK_UNIVERSAL_INFO_HINT.test(source);
        // Unknown Play apps enter native capture only after financial-context and
        // money gates. Before forcing a first-transaction Review, also verify the
        // INSTALLED app's own Android label. A recognized bank alias or explicit
        // banking/finance identity is stronger than notification copy and can
        // establish issuer trust. It still cannot authorize money by itself:
        // worldwide automatic import additionally requires a certified template.
        // Truly ambiguous apps remain review-first.
        const verifiedSender = nativeSourceClass === 'financial-candidate'
          ? verifiedFinancialAppSender(n.appLabel ?? '')
          : null;
        const sourceClass = nativeSourceClass === 'financial-candidate' && verifiedSender
          ? 'play-finance' as const
          : nativeSourceClass;
        const learned = sourceClass === 'financial-candidate' && learnedPackages.has(n.pkg);
        const autoAuthorized = sourceClass === 'trusted-bank' || sourceClass === 'play-finance' || learned;
        // Green semantic generalization needs independently verified installed-
        // app identity. A user-learned package may still use an exact Gold
        // certified template, but cannot generalize beyond what was confirmed.
        const semanticGeneralizationAuthorized = sourceClass === 'trusted-bank' ||
          (sourceClass === 'play-finance' && !!verifiedSender && hasUniversalInstitutionSender(verifiedSender));
        const sender = trustedBankNotificationSender(n.pkg) ?? verifiedSender ??
          (learned ? `${n.pkg} ${n.title}` : '');
        if (isPromotionalBankPush(source)) {
          if (notificationImportStats) notificationImportStats.ignored += 1;
          notificationIds.add(n.id);
          if (parseYieldDue(notificationYield, i + 1 < captured.length)) {
            await yieldToUi();
            resetParseYieldState(notificationYield);
          }
          continue;
        }
        // Curated UAE/Saudi package identity already establishes the launch
        // market. Do not pre-run worldwide routing before the regional parser.
        const worldwide = knownLaunchBank ? null : inspectWorldwide(source, sender);
        // Every admitted financial candidate reaches the parser. UAE/Saudi keep
        // their mature regional grammar as a fast path. A curated, locally
        // verified Play-finance, or previously confirmed package from any other
        // country may then use the universal structured parser in native ISO
        // currency. Gold certified templates auto-import directly; a strongly
        // verified installed app may also use the stricter Green semantic path.
        // Anything incomplete/ambiguous remains Review-first.
        const launchParsed = trustedMarket === 'AE' || trustedMarket === 'SA'
          ? parseLaunchAlert(source, sender, worldwide, trustedMarket, n.ts)
          : parseLaunchAlert(source, sender, worldwide, undefined, n.ts);
        const routedMarket = trustedMarket ??
          (worldwide?.route.decision === 'single' ? worldwide.route.market : null);
        const globalMarket = routedMarket && routedMarket !== 'AE' && routedMarket !== 'SA'
          ? routedMarket
          : null;
        // Keep the full inspected fact for source-free certification metrics,
        // even when it is deliberately non-reviewable (pending/failed/etc.).
        // Review candidates still require event.decision === 'review'.
        const universalInspection = !launchParsed && autoAuthorized
          ? globalMarket
            ? inspectUniversalBankEvent(source, {
              sender,
              market: globalMarket,
              // A routed institution prints its own country's dates.
              dateOrder: dateOrderForCountry(globalMarket) ?? undefined,
            })
            : inspectGenericBankEventForReview(source, sender)
          : null;
        // Local-AI shadow evaluation is deliberately outside import authority.
        // For launch-parser successes, build the same source-grounded universal
        // fact only for aggregate agreement metrics; its result can never
        // replace `launchParsed`, certification, money, status or direction.
        if (canCollectLocalSemanticShadow()) {
          const semanticShadowInspection = universalInspection ?? (
            launchParsed && autoAuthorized ? inspectGenericBankEventForReview(source, sender) : null
          );
          if (semanticShadowInspection) queueLocalSemanticParserShadow(source, semanticShadowInspection);
        }
        const universalEvent = universalInspection?.decision === 'review'
          ? universalInspection
          : null;
        const certification = universalInspection && globalMarket
          ? certifyUniversalTemplate({
              market: globalMarket,
              institution: worldwide?.review?.institution.institution ?? null,
              source,
              event: universalInspection,
              rail: worldwide?.review?.rail ?? null,
              allowSemanticGeneralization: semanticGeneralizationAuthorized,
            })
          : null;
        if (notificationImportStats && certification) {
          if (certification.decision === 'automatic') {
            notificationImportStats.certificationAutomatic += 1;
            if (certification.templateId) {
              notificationImportStats.certificationTemplates[certification.templateId] =
                (notificationImportStats.certificationTemplates[certification.templateId] ?? 0) + 1;
            }
          }
          else if (certification.decision === 'semantic-generalized') {
            notificationImportStats.semanticGeneralized += 1;
            if (globalMarket && universalInspection) {
              const bucket = `${globalMarket}:${universalInspection.family}`;
              notificationImportStats.semanticGeneralizedFamilies[bucket] =
                (notificationImportStats.semanticGeneralizedFamilies[bucket] ?? 0) + 1;
            }
          }
          else if (certification.decision === 'never-post') notificationImportStats.certificationNeverPost += 1;
          else if (certification.decision === 'adapter-required') notificationImportStats.certificationAdapterRequired += 1;
          else notificationImportStats.certificationReview += 1;
        }
        // Green semantic generalization is an UNPROVEN format: it posts only
        // through the same best-effort policy (and setting) as every other
        // unproven alert, and carries the "Auto-added — check" marker. The
        // ledger-currency gate below still refuses any foreign row here.
        const semanticDecision = certification?.decision === 'semantic-generalized' && universalEvent
          ? decideBestEffortAutoPost({
              source,
              event: universalEvent,
              enabled: bestEffortAutoPostEnabled(),
              country: getActiveCountry(),
              routedMarket: globalMarket,
              launchSenderMarket: null,
              ledgerCurrency: null,
              ledgerExponent: null,
              observedAt: n.ts,
              formatPrefix: 'semantic',
            })
          : null;
        const universalPosting = universalEvent &&
          (certification?.decision === 'automatic' || semanticDecision?.outcome === 'post')
          ? parsedUniversalPosting(universalEvent, source, overrides, routedMarket)
          : null;
        const universalParsed = universalPosting && semanticDecision?.outcome === 'post'
          ? { ...universalPosting, bestEffort: semanticDecision.marker }
          : universalPosting;
        const parsedCurrencies = new Set(parsed.map((row) => row.currency));
        const batchCurrency = parsedCurrencies.size === 1 ? [...parsedCurrencies][0] : null;
        const requiredCurrency = pinnedLedgerCurrencyCode() ?? batchCurrency;
        // A certified template is a PROVEN format: the universal reading of
        // the same alert is not "best effort" and must not carry the marker.
        const launchCandidate = launchParsed?.bestEffort && certification?.decision === 'automatic'
          ? (({ bestEffort: _marker, ...proven }) => proven)(launchParsed)
          : launchParsed;
        const parsedCandidate = launchCandidate ?? universalParsed;
        // Parser success is not admission to the ledger. A trusted bank-app
        // package may auto-post globally, but only in the ledger's established
        // currency (or the single currency already established by this batch).
        // Apply that rule to BOTH parser paths: launchParsed used to bypass it
        // entirely, so a BNP EUR push could enter an otherwise-AED scan.
        const p = parsedCandidate && (!requiredCurrency || parsedCandidate.currency === requiredCurrency)
          ? parsedCandidate
          : null;
        const pushSource = { packageName: n.pkg, sourceClass } as const;
        const parsedCandidateFallback = p && !autoAuthorized
          ? parsedFinancialCandidateReview(p, n.ts)
          : null;
        const universalCandidateFallback = !p && universalEvent
          ? universalEventReviewCandidate(universalEvent, n.ts)
          : null;
        const reviewFallback = parsedCandidateFallback ?? universalCandidateFallback;
        let refusal: SourceFreeRefusedAlertDecision | null = p && (shouldReviewParsedIncome(p) || !autoAuthorized)
          ? await inspectRefused(
              source, n.ts, sender, 'push', worldwide, undefined, pushSource,
              reviewFallback, skipKnownLaunchUniversal,
            )
          : null;
        const reviewed = refusal?.kind === 'review';
        let handled = false;
        if (p && autoAuthorized && !reviewed) {
          parsed.push({
            ...p,
            date: p.kind === 'cardStatement' ? p.date : p.date ?? toISODate(new Date(n.ts)),
            smsTs: n.ts,
            sender,
            channel: 'push',
          });
          if (notificationImportStats) notificationImportStats.autoParsed += 1;
          handled = true;
        } else if (!p) {
          refusal = await inspectRefused(
            source,
            n.ts,
            sender,
            'push',
            worldwide,
            undefined,
            pushSource,
            reviewFallback,
            skipKnownLaunchUniversal,
            true,
          );
        }
        if (refusal?.kind === 'review') {
          if (notificationImportStats) notificationImportStats.review += 1;
          handled = true;
        } else if (refusal?.kind === 'declined') {
          if (notificationImportStats) notificationImportStats.declined += 1;
          handled = true;
        } else if (refusal?.kind === 'ignored' && refusal.reason !== 'unrecognized') {
          if (notificationImportStats) notificationImportStats.ignored += 1;
          handled = true;
        }
        if (!handled && notificationImportStats) {
          notificationImportStats.unresolved += 1;
          if (sourceClass === 'trusted-bank') notificationImportStats.unresolvedTrustedBank += 1;
          else if (sourceClass === 'play-finance') notificationImportStats.unresolvedVerifiedFinance += 1;
          else notificationImportStats.unresolvedFinancialCandidate += 1;
          if (!p) notificationImportStats.unresolvedParserMiss += 1;
          else notificationImportStats.unresolvedReviewRefusal += 1;
          unresolvedNotificationIdsThisSession.add(n.id);
        }
        // Claim the row only when Wafra has a durable/safe outcome. An
        // unresolved money-bearing bank notification used to be ACKed here even
        // though neither the ledger nor Review contained it, making the evidence
        // vanish and leaving diagnostics at queued=0. Keep unrecognized rows in
        // the encrypted queue so parser fixes/diagnostics can retry them.
        if (handled) notificationIds.add(n.id);
        if (parseYieldDue(notificationYield, i + 1 < captured.length)) {
          await yieldToUi();
          resetParseYieldState(notificationYield);
        }
      }
      if (notificationImportStats) {
        notificationImportStats.acknowledgementPlanned = notificationIds.size;
        latestAndroidNotificationImportDiagnostics = { ...notificationImportStats };
      }
      onProgress?.(scannedCount, parsed.length);
    } catch (error) {
      if (error instanceof ReviewIdentityError) throw error;
      // Listener data is best-effort; SMS results stand on their own.
    }
  }

  // Oldest-first so account auto-creation sees the earliest occurrence first.
  parsed.sort((a, b) => a.smsTs - b.smsTs);
  reviewCandidates.sort((a, b) => a.observedAt - b.observedAt);
  captureTrace('inbox:done', scannedCount, tracing ? Date.now() - traceStarted : 0, pagesRead);
  return {
    parsed,
    reviewCandidates,
    reviewSourceBindings,
    declined,
    newestTs,
    inboxScannedCount,
    inboxHistoryComplete,
    nextCursor,
    scannedCount,
    detectedLaunchMarket: launchSession.detectedMarket(),
    requiresDurableCommit: notificationIds.size > 0,
    commit: notificationIds.size > 0 && notificationReader
      ? async () => {
          const acknowledged = await notificationReader.ackCaptured([...notificationIds]);
          if (!acknowledged) throw new Error('Notification capture acknowledgement failed');
          if (notificationImportStats &&
              latestAndroidNotificationImportDiagnostics?.attemptedAt === notificationImportStats.attemptedAt) {
            latestAndroidNotificationImportDiagnostics = {
              ...latestAndroidNotificationImportDiagnostics,
              acknowledged: notificationIds.size,
            };
          }
        }
      : NOOP_SCAN_COMMIT,
  };
}
