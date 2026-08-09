import { PermissionsAndroid, Platform } from 'react-native';

import NotificationReader from '../../modules/notification-reader';
import SmsReader, { type RawSms } from '../../modules/sms-reader';
import { toISODate } from '@/lib/format';
import { bodyPrint, type CaptureChannel } from '@/lib/dedupe';
import { isDeclinedMessage, parseSms, type ParsedSms } from '@/lib/sms-parser';
import type { DeclinedSms, ScannedSms } from '@/lib/import-plan';

const PAGE_SIZE = 1000;
const MAX_PAGES = 40; // 40k messages is far beyond any real inbox
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
  // READ_SMS covers the inbox history scan, RECEIVE_SMS the delivery
  // broadcast that catches an alert as it lands. They share a permission
  // group, so this is one prompt, but each has to be asked for by name or
  // the receiver silently never fires.
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  ]);
  // The inbox scan is the feature; live capture is an enhancement on top, so
  // READ_SMS alone still counts as granted.
  return result[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED;
}

export type { CaptureChannel } from '@/lib/dedupe';

export type { ScannedSms, DeclinedSms, ImportPlan } from '@/lib/import-plan';
export { buildImportPlan } from '@/lib/import-plan';

export interface ScanResult {
  parsed: ScannedSms[];
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
}

/**
 * Reads the inbox from `sinceMs` to now in pages (full history when sinceMs = 0)
 * and parses every message. onProgress fires per page for UI feedback.
 */
export async function scanInbox(
  sinceMs: number,
  overrides: Record<string, import('@/lib/types').CategoryId>,
  onProgress?: (scanned: number, found: number) => void,
): Promise<ScanResult> {
  if (!isSmsScanningAvailable() || !SmsReader) {
    return { parsed: [], declined: [], newestTs: sinceMs, scannedCount: 0 };
  }

  const parsed: (ParsedSms & { smsTs: number; sender: string; channel: CaptureChannel })[] = [];
  const declined: DeclinedSms[] = [];
  /**
   * Called only where a parse returned null, and only the REFUSAL half of that
   * is kept. `parseSms` answers null for a dozen reasons — an OTP, an offer, a
   * spend summary, a pre-auth hold, a figure the bank masked — and "the parser
   * no longer reads this" is emphatically not evidence that a charge did not
   * happen. `isDeclinedMessage` is the parser's OWN suppression predicate,
   * exported so the two cannot drift, and it is the affirmative half.
   */
  const noteIfDeclined = (body: string, ts: number, sender: string, channel: CaptureChannel) => {
    if (isDeclinedMessage(body)) declined.push({ smsTs: ts, sender, channel });
  };
  /** Bodies already taken from the inbox, so the delivery buffer cannot re-add them. */
  const inboxBodies = new Set<string>();
  let newestTs = sinceMs;
  let untilMs = Date.now() + 60_000;
  let scannedCount = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const batch: RawSms[] = await SmsReader.getInboxSms(sinceMs, untilMs, PAGE_SIZE);
    if (batch.length === 0) break;
    scannedCount += batch.length;
    for (let i = 0; i < batch.length; i++) {
      const sms = batch[i];
      if (sms.date > newestTs) newestTs = sms.date;
      inboxBodies.add(bodyPrint(sms.body));
      // The sender ID is the ONLY thing that says which bank sent a message —
      // no UAE bank but HSBC names itself in the body — so it is passed INTO
      // the parser, not merely recorded on the row. Three rules need it and
      // cannot be answered from the text: a Sharia-compliant issuer's
      // "Covered Card" is a credit card, a Liv Goal or a Wio Saving Space is
      // the bank's own savings pot rather than a shop, and money moving to the
      // bank's own brand name is moving inside your own bank.
      const p = parseSms(sms.body, overrides, { sender: sms.address });
      if (p) {
        parsed.push({
          ...p,
          date: p.date ?? toISODate(new Date(sms.date)),
          smsTs: sms.date,
          sender: sms.address,
          channel: 'inbox',
        });
      } else {
        noteIfDeclined(sms.body, sms.date, sms.address, 'inbox');
      }
      // The native inbox query is already asynchronous; the expensive part is
      // the regex grammar above after the 1,000 bodies cross the bridge. A
      // timer turn lets React Native present pending frames and input events.
      if ((i + 1) % PARSE_SLICE_SIZE === 0 && i + 1 < batch.length) {
        await yieldToUi();
      }
    }
    onProgress?.(scannedCount, parsed.length);
    untilMs = batch[batch.length - 1].date; // page ends exclusive, walk backwards
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
          const p = parseSms(sms.body, overrides, { sender: sms.address });
          if (p) {
            parsed.push({
              ...p,
              date: p.date ?? toISODate(new Date(sms.date)),
              smsTs: sms.date,
              sender: sms.address,
              channel: 'delivery',
            });
          } else {
            noteIfDeclined(sms.body, sms.date, sms.address, 'delivery');
          }
        }
        if ((i + 1) % PARSE_SLICE_SIZE === 0 && i + 1 < received.length) {
          await yieldToUi();
        }
      }
      onProgress?.(scannedCount, parsed.length);
    } catch {
      // Capture buffer is best-effort; the inbox results stand on their own.
    }
  }

  // Bank-app push notifications captured by the notification listener (banks
  // are shifting from SMS to push). Same parser, same dedupe fingerprints.
  if (NotificationReader?.isEnabled?.()) {
    try {
      const captured = await NotificationReader.getCaptured(sinceMs);
      for (let i = 0; i < captured.length; i++) {
        const n = captured[i];
        scannedCount += 1;
        if (n.ts > newestTs) newestTs = n.ts;
        // Package names usually contain the bank ("com.enbd...", "adcb...").
        const p = parseSms(`${n.title} ${n.text}`.trim(), overrides, {
          sender: `${n.pkg} ${n.title}`,
        });
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
          noteIfDeclined(`${n.title} ${n.text}`.trim(), n.ts, `${n.pkg} ${n.title}`, 'push');
        }
        if ((i + 1) % PARSE_SLICE_SIZE === 0 && i + 1 < captured.length) {
          await yieldToUi();
        }
      }
      onProgress?.(scannedCount, parsed.length);
    } catch {
      // Listener data is best-effort; SMS results stand on their own.
    }
  }

  // Oldest-first so account auto-creation sees the earliest occurrence first.
  parsed.sort((a, b) => a.smsTs - b.smsTs);
  return { parsed, declined, newestTs, scannedCount };
}
