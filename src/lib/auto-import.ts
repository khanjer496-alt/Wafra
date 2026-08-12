import { Linking, PermissionsAndroid, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import NotificationReader from '../../modules/notification-reader';
import SmsReader, { type InboxSms } from '../../modules/sms-reader';
import type { UniversalAlertReview } from '@/lib/alert-market-detection';
import { prepareReviewAlert, type ReviewAlert } from '@/lib/alert-review-tray';
import { toISODate } from '@/lib/format';
import { bodyPrint, type CaptureChannel } from '@/lib/dedupe';
import { nonPostingReason, type ParsedSms } from '@/lib/sms-parser';
import { createLaunchAlertSession, REVIEW_MONEY_HINT } from '@/lib/launch-alert-parser';
import {
  trustedBankNotificationMarket,
  trustedBankNotificationSender,
} from '@/lib/trusted-bank-notification-packages';
import type { DeclinedSms, ScannedSms } from '@/lib/import-plan';

const PAGE_SIZE = 1000;
const MAX_PAGES = 40; // 40k messages is far beyond any real inbox
const MAX_REVIEW_CANDIDATES = 50;
// Cheap superset of currencies the worldwide reviewer can currently ground.
// It avoids running fourteen market packs over ordinary personal SMS, while
// false positives merely reach the review module and are refused there.
/**
 * Parsing is synchronous JavaScript. A 1,000-message page takes roughly
 * 100 ms even on a desktop Hermes-class CPU and several times that on a
 * mid-range phone, so doing the whole page in one turn visibly freezes taps
 * and scrolling. Yield often enough to keep each slice below a frame while
 * preserving the exact same ordered parse result.
 */
const PARSE_SLICE_SIZE = 24;

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
    'code' in error && (error as { code?: unknown }).code === 'ERR_SMS_INBOX_ACCESS';
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
   * Fingerprints of the messages this scan refused as DECLINES.
   *
   * A suppressed message yields no ParsedSms and used to end here: the `if (p)`
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
): Promise<{ id: string; sourceKey: string } | null> {
  if (!/^[0-9a-f]{64}$/i.test(databaseKey)) return null;
  const material = [
    channel,
    String(observedAt),
    bodyPrint(sender.normalize('NFKC')),
    bodyPrint(source.normalize('NFKC')),
  ].join('\u0000');
  const identityKey = await sha256(`${REVIEW_IDENTITY_DOMAIN}\u0000${databaseKey}`);
  const digest = await sha256(`${identityKey}\u0000${material}`);
  if (!/^[0-9a-f]{64}$/i.test(digest)) return null;
  return { sourceKey: `arc1_${digest}`, id: `ari1_${digest}` };
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
      parsed: [], reviewCandidates: [], declined: [], newestTs: sinceMs, scannedCount: 0,
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
  ): Promise<void> => {
    // A refusal, code challenge, hold or returned instrument is affirmative
    // proof that no settled money movement happened. It belongs only in the
    // guarded healing channel and must never become a reviewable charge.
    const reason = nonPostingReason(body);
    if (reason) {
      declined.push({ smsTs: ts, sender, channel, reason, sourceEventId });
      return;
    }
    if (!REVIEW_MONEY_HINT.test(body)) return;
    const inspection = existingInspection ?? inspectWorldwide(body, sender);
    if (!inspection) return;
    // Refuse unsafe/global-ambiguous evidence before touching Keychain or
    // hashing source-derived material.
    const prepared = prepareReviewAlert({
      id: 'capture_probe_id_0001',
      sourceKey: 'capture_probe_key_001',
      observedAt: ts,
      channel,
      inspection,
    });
    if (!prepared) return;
    const key = await databaseKey();
    if (!key) throw new ReviewIdentityError('Encrypted review identity is unavailable');
    const identity = await reviewCaptureIdentity(body, sender, ts, channel, key);
    if (!identity) throw new ReviewIdentityError('Encrypted review identity is invalid');
    if (reviewSourceKeys.has(identity.sourceKey)) return;
    reviewSourceKeys.add(identity.sourceKey);
    reviewCandidates.push({ ...prepared, ...identity });
    // Inbox, delivery and push are collected in different phases. Keep the
    // newest bounded set by event time—not whichever channel happened to run
    // first—so a full inbox cannot crowd out a fresh bank-app alert.
    reviewCandidates.sort((a, b) => a.observedAt - b.observedAt);
    if (reviewCandidates.length > MAX_REVIEW_CANDIDATES) {
      reviewCandidates.splice(0, reviewCandidates.length - MAX_REVIEW_CANDIDATES);
    }
  };
  /** Bodies already taken from the inbox, so the delivery buffer cannot re-add them. */
  const inboxBodies = new Set<string>();
  let newestTs = sinceMs;
  let beforeDateMs = Date.now() + 60_000;
  let beforeId = Number.MAX_SAFE_INTEGER;
  let scannedCount = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const batch: InboxSms[] = await SmsReader.getInboxSms(
      sinceMs,
      beforeDateMs,
      beforeId,
      PAGE_SIZE,
    );
    if (batch.length === 0) break;
    scannedCount += batch.length;
    for (let i = 0; i < batch.length; i++) {
      const sms = batch[i];
      const sourceEventId = `a${sms.id}`;
      if (sms.date > newestTs) newestTs = sms.date;
      inboxBodies.add(bodyPrint(sms.body));
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
      if (p) {
        parsed.push({
          ...p,
          date: p.date ?? toISODate(new Date(sms.date)),
          smsTs: sms.date,
          sender: sms.address,
          channel: 'inbox',
          sourceEventId,
        });
      } else {
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
      if ((i + 1) % PARSE_SLICE_SIZE === 0 && i + 1 < batch.length) {
        await yieldToUi();
      }
    }
    onProgress?.(scannedCount, parsed.length);
    beforeDateMs = batch[batch.length - 1].date;
    beforeId = batch[batch.length - 1].id;
    if (batch.length < PAGE_SIZE) break;
  }

  // Alerts the delivery receiver caught as they arrived. Usually the inbox
  // query above already found them; this covers the case where a message
  // never reached the SMS provider, and is the hook a live alert hangs off.
  // Duplicates collapse on the date/amount/title fingerprint in the plan.
  if (SmsReader.getReceived) {
    try {
      const received = await SmsReader.getReceived(sinceMs);
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
          if (p) {
            parsed.push({
              ...p,
              date: p.date ?? toISODate(new Date(sms.date)),
              smsTs: sms.date,
              sender: sms.address,
              channel: 'delivery',
            });
          } else {
            await inspectRefused(sms.body, sms.date, sms.address, 'delivery', worldwide);
          }
        }
        if ((i + 1) % PARSE_SLICE_SIZE === 0 && i + 1 < received.length) {
          await yieldToUi();
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
        if (p) {
          parsed.push({
            ...p,
            date: p.date ?? toISODate(new Date(n.ts)),
            smsTs: n.ts,
            // Package names usually contain the bank ("com.enbd...", "adcb...").
            sender: `${n.pkg} ${n.title}`,
            channel: 'push',
          });
        } else {
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
        if ((i + 1) % PARSE_SLICE_SIZE === 0 && i + 1 < captured.length) {
          await yieldToUi();
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
