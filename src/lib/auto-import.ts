import { Linking, PermissionsAndroid, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import NotificationReader from '../../modules/notification-reader';
import SmsReader, { type InboxSms } from '../../modules/sms-reader';
import type { UniversalAlertReview } from '@/lib/alert-market-detection';
import {
  prepareLaunchReviewAlert,
  prepareReviewAlert,
  type ReviewAlert,
} from '@/lib/alert-review-tray';
import { toISODate } from '@/lib/format';
import { bodyPrint, type CaptureChannel } from '@/lib/dedupe';
import { nonPostingReason, type ParsedSms } from '@/lib/sms-parser';
import { createLaunchAlertSession, hasBankAlertMoneyHint } from '@/lib/launch-alert-parser';
import {
  inspectUnparsedLaunchAlert,
  normalizeUnparsedLaunchTemplate,
} from '@/lib/unparsed-launch-alert';
import {
  trustedBankNotificationMarket,
  trustedBankNotificationSender,
} from '@/lib/trusted-bank-notification-packages';
import type { DeclinedSms, ScannedSms } from '@/lib/import-plan';

const PAGE_SIZE = 1000;
const MAX_REVIEW_CANDIDATES = 50;
// Cheap superset of currencies the worldwide reviewer can currently ground.
// It avoids running fourteen market packs over ordinary personal SMS, while
// false positives merely reach the review module and are refused there.
/**
 * Parsing is synchronous JavaScript, but phone speeds and message shapes vary
 * too much for one fixed row count. Yield when a slice consumes a frame-sized
 * time budget, with a row-count ceiling for fast clocks/devices. This keeps
 * the exact ordered result while avoiding 40+ timer turns per 1,000 simple
 * alerts on a fast phone.
 */
const PARSE_TIME_BUDGET_MS = 8;
const MAX_PARSE_SLICE_SIZE = 64;
// Some Android providers insert one SMS twice. Collapse only byte-identical,
// same-sender, consecutive inbox rows delivered less than one second apart.
const EXACT_PROVIDER_DUPLICATE_MS = 1_000;

interface ParseYieldState {
  startedAt: number;
  parsed: number;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const createParseYieldState = (): ParseYieldState => ({ startedAt: Date.now(), parsed: 0 });

function parseYieldDue(state: ParseYieldState, hasMore: boolean): boolean {
  state.parsed += 1;
  if (!hasMore) return false;
  const withinCount = state.parsed < MAX_PARSE_SLICE_SIZE;
  const withinTime = Date.now() - state.startedAt < PARSE_TIME_BUDGET_MS;
  return !withinCount || !withinTime;
}

function resetParseYieldState(state: ParseYieldState): void {
  state.startedAt = Date.now();
  state.parsed = 0;
}

export function isSmsScanningAvailable(): boolean {
  return Platform.OS === 'android' && SmsReader != null;
}

export async function hasSmsPermission(): Promise<boolean> {
  if (!isSmsScanningAvailable()) return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
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
  if (await PermissionsAndroid.check(permission)) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

export type { CaptureChannel } from '@/lib/dedupe';

export type { ScannedSms, DeclinedSms, ImportPlan } from '@/lib/import-plan';
export { buildImportPlan } from '@/lib/import-plan';

export interface ScanResult {
  parsed: ScannedSms[];
  /**
   * Sanitized global alerts that the launch parser refused but the worldwide
   * inspector can ground strongly enough for review. These never enter
   * `parsed`, so this scanner cannot auto-import them.
   */
  reviewCandidates: ReviewAlert[];
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
  scannedCount: number;
  /** Strong launch-pack evidence observed while parsing this scan. */
  detectedLaunchMarket: 'AE' | 'SA' | null;
  /** Retire native notification rows only after ledger/review durability. */
  commit: () => Promise<void>;
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
async function reviewCaptureIdentity(
  source: string,
  sender: string,
  observedAt: number,
  channel: CaptureChannel,
  databaseKey: string,
): Promise<{ id: string; sourceKey: string; templateKey: string } | null> {
  if (!/^[0-9a-f]{64}$/i.test(databaseKey)) return null;
  const material = [
    channel,
    String(observedAt),
    bodyPrint(sender.normalize('NFKC')),
    bodyPrint(source.normalize('NFKC')),
  ].join('\u0000');
  const identityKey = await sha256(`${REVIEW_IDENTITY_DOMAIN}\u0000${databaseKey}`);
  const digest = await sha256(`${identityKey}\u0000${material}`);
  const template = normalizeUnparsedLaunchTemplate(source);
  const templateIdentityKey = await sha256(`${REVIEW_TEMPLATE_DOMAIN}\u0000${databaseKey}`);
  const templateDigest = await sha256([
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
 * Reads the inbox from `sinceMs` to now in pages (full history when sinceMs = 0)
 * and parses every message. onProgress fires per page for UI feedback.
 */
export async function scanInbox(
  sinceMs: number,
  overrides: Record<string, import('@/lib/types').CategoryId>,
  onProgress?: (scanned: number, found: number) => void,
  regionHint: string | null = deviceRegionHint(),
): Promise<ScanResult> {
  if (!isSmsScanningAvailable() || !SmsReader) {
    return {
      parsed: [], reviewCandidates: [], declined: [], newestTs: sinceMs,
      inboxScannedCount: 0, inboxHistoryComplete: false, scannedCount: 0,
      detectedLaunchMarket: null,
      commit: NOOP_SCAN_COMMIT,
    };
  }

  const parsed: (ParsedSms & {
    smsTs: number;
    sender: string;
    channel: CaptureChannel;
    sourceEventId?: string;
  })[] = [];
  const reviewCandidates: ReviewAlert[] = [];
  const reviewSourceKeys = new Set<string>();
  let databaseKeyPromise: Promise<string | null> | null = null;
  const databaseKey = (): Promise<string | null> => {
    databaseKeyPromise ??= SecureStore.getItemAsync(DATABASE_KEY_NAME);
    return databaseKeyPromise;
  };
  const declined: DeclinedSms[] = [];
  const notificationIds = new Set<string>();
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
  ): Promise<boolean> => {
    // A refusal, code challenge, hold or returned instrument is affirmative
    // proof that no settled money movement happened. It belongs only in the
    // guarded healing channel and must never become a reviewable charge.
    const reason = nonPostingReason(body);
    if (reason) {
      declined.push({ smsTs: ts, sender, channel, reason, sourceEventId });
      return false;
    }
    if (!hasBankAlertMoneyHint(body)) return false;
    const inspection = existingInspection ?? inspectWorldwide(body, sender);
    // Refuse unsafe/global-ambiguous evidence before touching Keychain or
    // hashing source-derived material.
    const prepared = inspection
      ? prepareReviewAlert({
          id: 'capture_probe_id_0001',
          sourceKey: 'capture_probe_key_001',
          observedAt: ts,
          channel,
          inspection,
        })
      : null;
    // A globally routed/ambiguous alert has already been judged by the global
    // inspector. Never let a Gulf sender alias bypass that refusal. The launch
    // fallback is reserved for alerts that have no global route at all.
    const launchReview = inspection === null
      ? inspectUnparsedLaunchAlert(body, sender)
      : null;
    const reviewPrepared = prepared ?? (launchReview?.outcome === 'review'
      ? prepareLaunchReviewAlert({
          id: 'capture_probe_id_0001',
          sourceKey: 'capture_probe_key_001',
          observedAt: ts,
          channel,
          review: launchReview.review,
        })
      : null);
    if (!reviewPrepared) return false;
    const key = await databaseKey();
    if (!key) throw new ReviewIdentityError('Encrypted review identity is unavailable');
    const identity = await reviewCaptureIdentity(body, sender, ts, channel, key);
    if (!identity) throw new ReviewIdentityError('Encrypted review identity is invalid');
    if (reviewSourceKeys.has(identity.sourceKey)) return true;
    reviewSourceKeys.add(identity.sourceKey);
    reviewCandidates.push({ ...reviewPrepared, ...identity });
    // Inbox, delivery and push are collected in different phases. Keep the
    // newest bounded set by event time—not whichever channel happened to run
    // first—so a full inbox cannot crowd out a fresh bank-app alert.
    reviewCandidates.sort((a, b) => a.observedAt - b.observedAt);
    if (reviewCandidates.length > MAX_REVIEW_CANDIDATES) {
      reviewCandidates.splice(0, reviewCandidates.length - MAX_REVIEW_CANDIDATES);
    }
    return true;
  };
  const shouldReviewParsedIncome = (parsedAlert: ParsedSms): boolean =>
    parsedAlert.type === 'income' && !parsedAlert.transferHint &&
    parsedAlert.categoryGuess === 'other' && !parsedAlert.categoryDeliberate;
  /** Bodies already taken from the inbox, so the delivery buffer cannot re-add them. */
  const inboxBodies = new Set<string>();
  let newestTs = sinceMs;
  let beforeDateMs = Date.now() + 60_000;
  let beforeId = Number.MAX_SAFE_INTEGER;
  let inboxScannedCount = 0;
  let inboxHistoryComplete = false;
  let scannedCount = 0;
  let previousInboxSms: InboxSms | null = null;

  for (;;) {
    const batch: InboxSms[] = await SmsReader.getInboxSms(
      sinceMs,
      beforeDateMs,
      beforeId,
      PAGE_SIZE,
    );
    if (batch.length === 0) {
      inboxHistoryComplete = true;
      break;
    }
    inboxScannedCount += batch.length;
    scannedCount += batch.length;
    const pageYield = createParseYieldState();
    for (let i = 0; i < batch.length; i++) {
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
      // The sender ID is the ONLY thing that says which bank sent a message —
      // no UAE bank but HSBC names itself in the body — so it is passed INTO
      // the parser, not merely recorded on the row. Three rules need it and
      // cannot be answered from the text: a Sharia-compliant issuer's
      // "Covered Card" is a credit card, a Liv Goal or a Wio Saving Space is
      // the bank's own savings pot rather than a shop, and money moving to the
      // bank's own brand name is moving inside your own bank.
      const worldwide = inspectWorldwide(sms.body, sms.address);
      // A globally identified issuer must never be interpreted as an AED/SAR
      // foreign-card purchase merely because that launch pack is active. The
      // routed alert remains review-only until its own bank/template gates pass.
      const p = parseLaunchAlert(sms.body, sms.address, worldwide);
      const reviewed = p && shouldReviewParsedIncome(p)
        ? await inspectRefused(
            sms.body, sms.date, sms.address, 'inbox', worldwide, sourceEventId,
          )
        : false;
      if (p && !reviewed) {
        parsed.push({
          ...p,
          date: p.date ?? toISODate(new Date(sms.date)),
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
    onProgress?.(scannedCount, parsed.length);
    const nextBeforeDateMs = batch[batch.length - 1].date;
    const nextBeforeId = batch[batch.length - 1].id;
    if (nextBeforeDateMs === beforeDateMs && nextBeforeId === beforeId) {
      throw new Error('SMS inbox pagination did not advance');
    }
    beforeDateMs = nextBeforeDateMs;
    beforeId = nextBeforeId;
    if (batch.length < PAGE_SIZE) {
      inboxHistoryComplete = true;
      break;
    }
  }

  // Alerts the delivery receiver caught as they arrived. Usually the inbox
  // query above already found them; this covers the case where a message
  // never reached the SMS provider, and is the hook a live alert hangs off.
  // Duplicates collapse on the date/amount/title fingerprint in the plan.
  if (SmsReader.getReceived) {
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
          const p = parseLaunchAlert(sms.body, sms.address, worldwide);
          const reviewed = p && shouldReviewParsedIncome(p)
            ? await inspectRefused(sms.body, sms.date, sms.address, 'delivery', worldwide)
            : false;
          if (p && !reviewed) {
            parsed.push({
              ...p,
              date: p.date ?? toISODate(new Date(sms.date)),
              smsTs: sms.date,
              sender: sms.address,
              channel: 'delivery',
            });
          } else if (!p) {
            await inspectRefused(sms.body, sms.date, sms.address, 'delivery', worldwide);
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
  if (notificationReader?.isEnabled?.()) {
    try {
      // This queue has its own explicit acknowledgement. Always read every
      // retained row: using the ledger watermark here could strand an older
      // unacknowledged notification forever after a newer SMS advances it.
      const captured = await notificationReader.getCaptured(0);
      const notificationYield = createParseYieldState();
      for (let i = 0; i < captured.length; i++) {
        const n = captured[i];
        if (typeof n.id !== 'string' || !/^[A-Za-z0-9-]{16,128}$/.test(n.id)) continue;
        const trustedMarket = trustedBankNotificationMarket(n.pkg);
        if (!trustedMarket) continue;
        scannedCount += 1;
        if (n.ts > newestTs) newestTs = n.ts;
        // Package names usually contain the bank ("com.enbd...", "adcb...").
        const source = `${n.title} ${n.text}`.trim();
        const sender = `${n.pkg} ${n.title}`;
        const worldwide = inspectWorldwide(
          source,
          trustedBankNotificationSender(n.pkg) ?? sender,
        );
        // Only the active launch market may auto-import from a bank app. A
        // Saudi app on a UAE ledger (or vice versa) must never relabel/convert
        // its money through the active parser; global packages remain review.
        const p = trustedMarket === 'AE' || trustedMarket === 'SA'
          ? parseLaunchAlert(source, sender, worldwide, trustedMarket)
          : null;
        const reviewed = p && shouldReviewParsedIncome(p)
          ? await inspectRefused(source, n.ts, sender, 'push', worldwide)
          : false;
        if (p && !reviewed) {
          parsed.push({
            ...p,
            date: p.date ?? toISODate(new Date(n.ts)),
            smsTs: n.ts,
            // Package names usually contain the bank ("com.enbd...", "adcb...").
            sender: `${n.pkg} ${n.title}`,
            channel: 'push',
          });
        } else if (!p) {
          await inspectRefused(
            source,
            n.ts,
            sender,
            'push',
            worldwide,
          );
        }
        // Claim the row only after all parser/review work for it completed.
        // If anything above throws, this ciphertext remains for the next run.
        notificationIds.add(n.id);
        if (parseYieldDue(notificationYield, i + 1 < captured.length)) {
          await yieldToUi();
          resetParseYieldState(notificationYield);
        }
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
  return {
    parsed,
    reviewCandidates,
    declined,
    newestTs,
    inboxScannedCount,
    inboxHistoryComplete,
    scannedCount,
    detectedLaunchMarket: launchSession.detectedMarket(),
    commit: notificationIds.size > 0 && notificationReader
      ? async () => {
          const acknowledged = await notificationReader.ackCaptured([...notificationIds]);
          if (!acknowledged) throw new Error('Notification capture acknowledgement failed');
        }
      : NOOP_SCAN_COMMIT,
  };
}
