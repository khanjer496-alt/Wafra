/**
 * Two pipes, one UX.
 *
 * Android reads the SMS inbox on device and never touches the network. iOS
 * cannot read SMS at all, so a Shortcut the user configured POSTs each bank
 * message to the relay, which parses it and holds the sealed row until the app
 * collects it. Those are completely different mechanisms with completely
 * different failure modes, and every screen above this file is entitled to not
 * care: both arrive here as `ScannedSms[]` and go through the same
 * buildImportPlan() — same deduplication, same card mapping, same transfer
 * detection, same rescan healing.
 *
 * The one thing callers must honour is `commit()`. Android has nothing to
 * commit — the inbox is still the inbox. On iOS the relay keeps a queue row
 * until the phone says it has it, so `commit()` is what stops the same
 * transaction arriving forever. Call it only once the batch is persisted; a
 * crash before that costs a duplicate sync, not a lost transaction.
 */
import {
  buildImportPlan,
  isSmsScanningAvailable,
  scanInbox,
  type ImportPlan,
  type ScannedSms,
} from '@/lib/auto-import';
import { ackRelay, getRelayConfig, isRelayPlatform, syncRelay } from '@/lib/relay';
import { PARSER_VERSION } from '@/lib/sms-parser';
import type { AppState } from '@/lib/types';

export type CaptureSource = 'sms' | 'relay' | 'none';

export interface CaptureResult {
  parsed: ScannedSms[];
  /** Newest message timestamp seen, for the next incremental scan. */
  newestTs: number;
  source: CaptureSource;
  /** Acknowledge collected rows. Safe to call when there is nothing to ack. */
  commit: () => Promise<void>;
  /**
   * The platform can capture, but the user has not finished setting it up —
   * on iOS that means no paired relay. Screens use this to offer the setup
   * flow instead of reporting "up to date" over a pipe that is not connected.
   */
  needsSetup: boolean;
}

const NOOP = async () => {};

const EMPTY: CaptureResult = {
  parsed: [],
  newestTs: 0,
  source: 'none',
  commit: NOOP,
  needsSetup: false,
};

/**
 * Collect whatever has arrived since the last scan. Assumes any permission
 * the platform needs has already been granted — the caller owns prompting,
 * because only it knows whether this is an interactive refresh or a silent
 * background sync.
 */
export async function collectNewMessages(state: AppState): Promise<CaptureResult> {
  if (isSmsScanningAvailable()) {
    // The routine scan reads only what arrived since last time. That is right
    // for a normal refresh and wrong after a parser change: a message is
    // imported once and can never arrive again, so every improvement would
    // apply to the future only, and the card payments already in the ledger
    // would stay filed as spending forever. When the parser has moved on,
    // re-read everything — existing rows are recognized by fingerprint and
    // healed in place, not duplicated.
    const reread = state.parserVersion !== PARSER_VERSION;
    const sinceMs = reread || state.lastScanTs <= 0 ? 0 : state.lastScanTs + 1;
    const { parsed, newestTs } = await scanInbox(sinceMs, state.merchantOverrides);
    return { parsed, newestTs, source: 'sms', commit: NOOP, needsSetup: false };
  }

  // Note there is no relay equivalent of the re-read above, and there cannot
  // be: the relay drops the message text as it parses (server/src/index.ts)
  // and deletes each queue row once acknowledged. Nothing is kept to re-read.
  // A parser fix therefore reaches iOS from the next message onward, while
  // Android heals its history. That asymmetry is a consequence of the
  // retention promise, not an oversight.

  if (isRelayPlatform()) {
    const cfg = await getRelayConfig();
    if (!cfg) return { ...EMPTY, source: 'relay', needsSetup: true };
    const { parsed, ids } = await syncRelay(cfg);
    const newestTs = parsed.reduce((max, p) => Math.max(max, p.smsTs ?? 0), state.lastScanTs);
    return {
      parsed,
      newestTs,
      source: 'relay',
      commit: ids.length ? () => ackRelay(cfg, ids) : NOOP,
      needsSetup: false,
    };
  }

  return EMPTY;
}

export interface CapturePlan {
  plan: ImportPlan;
  source: CaptureSource;
  commit: () => Promise<void>;
  needsSetup: boolean;
}

/** collectNewMessages() + buildImportPlan(), which is all any caller wants. */
export async function planNewMessages(state: AppState): Promise<CapturePlan> {
  const { parsed, newestTs, source, commit, needsSetup } = await collectNewMessages(state);
  return { plan: buildImportPlan(parsed, state, newestTs), source, commit, needsSetup };
}

/** True when this build can capture at all, configured or not. */
export function isCaptureAvailable(): boolean {
  return isSmsScanningAvailable() || isRelayPlatform();
}
