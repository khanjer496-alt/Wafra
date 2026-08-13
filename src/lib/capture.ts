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
 * The one thing the durable capture executor must honour is `commit()`.
 * Android has nothing to
 * commit — the inbox is still the inbox. On iOS the relay keeps a queue row
 * until the phone says it has it, so `commit()` is what stops the same
 * transaction arriving forever. It calls this only once the batch is persisted; a
 * crash before that costs a duplicate sync, not a lost transaction.
 */
import {
  isSmsScanningAvailable,
  scanInbox,
  type DeclinedSms,
  type ScannedSms,
} from '@/lib/auto-import';
import {
  BACKGROUND_RELAY_ERASE_PENDING_KEY,
  backgroundRelayStorage,
} from '@/lib/background-relay-storage';
import {
  ackRelay,
  getRelayConfig,
  isRelayPlatform,
  isRelayRevokedError,
  syncRelay,
} from '@/lib/relay';
import { PARSER_VERSION } from '@/lib/sms-parser';
import type { ReviewAlert } from '@/lib/alert-review-tray';
import type { AppState } from '@/lib/types';

export type CaptureSource = 'sms' | 'relay' | 'none';

export interface CaptureResult {
  parsed: ScannedSms[];
  /** Sanitized global alerts. They are review evidence, never import rows. */
  reviewCandidates: ReviewAlert[];
  /**
   * Timestamps of messages this collection read and refused as declines, so
   * the planner can retire rows an older parser booked from them.
   *
   * Android only, and it is not an omission on the other pipe. The relay
   * parses server-side and discards Message Content before sealing the row
   * (server/src/index.ts), so there is no body on this device to test and
   * nothing to re-read once a queue row is acknowledged — the same reason
   * there is no relay equivalent of the parser-version re-read below. Always
   * `[]` there, which makes the sweep a no-op rather than a wrong answer.
   */
  declined: DeclinedSms[];
  /** Newest message timestamp seen, for the next incremental scan. */
  newestTs: number;
  /** Rows the platform actually yielded, including safe refusals. */
  scannedCount?: number;
  /** Rows yielded by Android's inbox provider, excluding push/delivery buffers. */
  inboxScannedCount?: number;
  /** Android deliberately started at the beginning for a parser migration. */
  historicalReread?: boolean;
  /** Strong per-alert evidence for the launch-tested UAE/Saudi parser pack. */
  detectedLaunchMarket: 'AE' | 'SA' | null;
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

class SmsHistoryUnavailableError extends Error {
  readonly code = 'ERR_SMS_HISTORY_UNAVAILABLE';

  constructor() {
    super('SMS history was unavailable during parser migration');
    this.name = 'SmsHistoryUnavailableError';
  }
}

/**
 * The staging queue key. background-relay.ts owns every write to it and
 * declares the same literal as its own QUEUE_KEY; contracts.test.js asserts
 * the two agree, because a silent divergence here would clear nothing and the
 * queue would simply grow until MAX_LOCAL_ROWS started dropping the oldest
 * rows on the floor.
 */
const STAGED_ROWS_KEY = 'wafra/background-relay/v1';

interface StagedRows {
  rows: ScannedSms[];
  /** The exact bytes `rows` was parsed from, so the commit can clear only those. */
  snapshot: string | null;
}

function parseStagedRows(raw: string | null): ScannedSms[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (row): row is ScannedSms =>
        !!row &&
        typeof row === 'object' &&
        typeof (row as Partial<ScannedSms>).merchant === 'string' &&
        Number.isSafeInteger((row as Partial<ScannedSms>).amountFils),
    );
  } catch {
    return [];
  }
}

async function readBackgroundRelayRows(): Promise<ScannedSms[]> {
  return parseStagedRows(await backgroundRelayStorage.getItem(STAGED_ROWS_KEY));
}

async function readStagedRows(): Promise<StagedRows> {
  if (await backgroundRelayStorage.getItem(BACKGROUND_RELAY_ERASE_PENDING_KEY)) {
    return { rows: [], snapshot: null };
  }
  // The snapshot is taken BEFORE the rows, never after. A push wake landing
  // between the two reads leaves `rows` a superset of `snapshot`, so the
  // compare-and-swap in the commit refuses and the queue survives to be
  // re-imported — a duplicate sync, which buildImportPlan() fingerprints away.
  // Reading the rows first would produce the opposite: a snapshot newer than
  // what was imported, a compare that passes, and rows deleted from the phone
  // that no ledger ever saw.
  const snapshot = await backgroundRelayStorage.getItem(STAGED_ROWS_KEY);
  return { rows: await readBackgroundRelayRows(), snapshot };
}

/**
 * Retire exactly the staged rows this import read, and nothing a background
 * wake has appended since. background-relay's own clearBackgroundRelayRows
 * export deletes the whole key unconditionally and must not be called from an
 * import commit, whatever it looks like it is for: the review step
 * between the read and the commit is long enough for a wake to append rows,
 * acknowledge them to the relay, and have them dropped here.
 */
async function clearStagedRows(snapshot: string | null): Promise<void> {
  await backgroundRelayStorage.removeItemIfUnchanged(STAGED_ROWS_KEY, snapshot);
}

const EMPTY: CaptureResult = {
  parsed: [],
  reviewCandidates: [],
  declined: [],
  newestTs: 0,
  detectedLaunchMarket: null,
  source: 'none',
  commit: NOOP,
  needsSetup: false,
};

function relayLaunchMarket(
  rows: readonly ScannedSms[],
  fallback?: string | null,
): 'AE' | 'SA' | null {
  const fallbackMarket = fallback === 'AE' || fallback === 'SA' ? fallback : null;
  const markets = new Set<'AE' | 'SA'>();
  for (const row of rows) {
    if (row.market === 'AE' || row.market === 'SA') markets.add(row.market);
    else if (fallbackMarket) markets.add(fallbackMarket);
  }
  if (markets.size > 1) {
    throw new Error('Relay page contains more than one ledger currency');
  }
  if (markets.size === 1) return [...markets][0];
  return null;
}

/**
 * Collect whatever has arrived since the last scan. Assumes any permission
 * the platform needs has already been granted — the caller owns prompting,
 * because only it knows whether this is an interactive refresh or a silent
 * background sync.
 */
export async function collectNewMessages(state: AppState): Promise<CaptureResult> {
  // An Android runtime permission can remain granted after the user turns
  // capture off inside Wafra, so the durable app preference must stop before
  // the inbox reader is called. Private Mode is a different promise on
  // Android (structured local parsing with raw text dropped); on iOS it still
  // blocks the non-local relay entirely.
  if (state.captureOptOut || (state.privateMode && isRelayPlatform())) return EMPTY;

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
    // `declined` is the other half of that re-read. A decline the old parser
    // booked as an expense cannot be healed into anything — the money never
    // moved — so the row has to be retired, and the proof is the message
    // still sitting in the inbox at that exact millisecond. The scan is the
    // only place that proof exists. The default covers a stubbed scanInbox.
    const {
      parsed,
      reviewCandidates = [],
      declined = [],
      newestTs,
      inboxScannedCount = 0,
      scannedCount = 0,
      detectedLaunchMarket = null,
      commit,
    } = await scanInbox(
      sinceMs,
      state.merchantOverrides,
    );
    // A parser migration is only complete when Android actually yielded the
    // history it was asked to re-read. Some OEM restricted-access layers keep
    // READ_SMS looking granted but return an empty provider cursor. Calling
    // that a successful zero-change scan stamps PARSER_VERSION and strands all
    // older Fishbasket/Fbinter/Nazemhome receipts forever. An established SMS
    // ledger proves that zero rows is not a credible full-history result.
    const hasStoredSmsHistory =
      state.lastScanTs > 0 || state.transactions.some((row) => row.source === 'sms');
    if (reread && inboxScannedCount === 0 && hasStoredSmsHistory) {
      throw new SmsHistoryUnavailableError();
    }
    return {
      parsed,
      reviewCandidates,
      declined,
      newestTs,
      inboxScannedCount,
      scannedCount,
      historicalReread: reread,
      detectedLaunchMarket,
      source: 'sms',
      commit,
      needsSetup: false,
    };
  }

  // Note there is no relay equivalent of the re-read above, and there cannot
  // be: the relay drops the message text as it parses (server/src/index.ts)
  // and deletes each queue row once acknowledged. Nothing is kept to re-read.
  // A parser fix therefore reaches iOS from the next message onward, while
  // Android heals its history. That asymmetry is a consequence of the
  // retention promise, not an oversight.

  if (isRelayPlatform()) {
    // A headless wake may already have collected and acknowledged rows while
    // the UI process was not running. They live in SQLCipher until the normal
    // import boundary durably folds them into the ledger.
    const staged = await readStagedRows();
    // What this pipe can still deliver when the network half of it is not
    // usable: whatever a wake already wrote to disk, retired the same
    // conditional way, and otherwise an honest "not connected".
    const stagedOnly = (): CaptureResult => {
      if (staged.rows.length > 0) {
        const newestTs = staged.rows.reduce(
          (max, p) => Math.max(max, p.smsTs ?? 0),
          state.lastScanTs,
        );
        return {
          parsed: staged.rows,
          reviewCandidates: [],
          // No body ever reached this device; see CaptureResult.declined.
          declined: [],
          newestTs,
          detectedLaunchMarket: relayLaunchMarket(staged.rows, state.marketId),
          source: 'relay',
          commit: async () => {
            await clearStagedRows(staged.snapshot);
          },
          needsSetup: false,
        };
      }
      return { ...EMPTY, source: 'relay', needsSetup: true };
    };
    const cfg = await getRelayConfig();
    // getRelayConfig() already answers null for a credential the relay has
    // refused, so a device revoked before this scan started never reaches the
    // network at all.
    if (!cfg || cfg.setupState === 'paired') return stagedOnly();
    // Revoked DURING this scan is the same outcome one tick later. syncRelay()
    // has stamped the stored credential by the time it throws, so degrade to
    // the branch above rather than propagating: this call has an interactive
    // caller behind it, and an exception there is a spinner that clears with
    // nothing said. Anything else — offline, 5xx, a malformed page — still
    // throws, because those are conditions a retry can fix and must not be
    // reported as "you are no longer set up".
    const queued = await syncRelay(cfg).catch((error: unknown) => {
      if (isRelayRevokedError(error)) return null;
      throw error;
    });
    if (!queued) return stagedOnly();
    const { parsed, ids, testIds } = queued;
    const collected = [...staged.rows, ...parsed];
    const detectedLaunchMarket = relayLaunchMarket(collected, cfg.market);
    const newestTs = collected.reduce((max, p) => Math.max(max, p.smsTs ?? 0), state.lastScanTs);
    return {
      parsed: collected,
      reviewCandidates: [],
      // No body ever reached this device; see CaptureResult.declined.
      declined: [],
      newestTs,
      detectedLaunchMarket,
      source: 'relay',
      commit: async () => {
        // The setup probe is addressed to /ios-setup and to nobody else.
        // syncRelay() reports its id in BOTH `ids` and `testIds` — it does have
        // to be acknowledged eventually, but only by the screen that is polling
        // for it. Home mounts useAutoImport(true) underneath that flow, so this
        // scan runs while the user is still on step 3, and acking the whole
        // `ids` array here made "Run test" time out on a correctly configured
        // phone. The retry it offers is byte-identical, so the relay's replay
        // receipt suppresses it and refreshes its own expiry — every attempt
        // extended the block. background-relay.ts reserves these ids the same
        // way; this is the second of the three collectors, not a special case.
        const reserved = new Set(testIds);
        const acknowledge = ids.filter((id) => !reserved.has(id));
        if (acknowledge.length > 0) await ackRelay(cfg, acknowledge);
        await clearStagedRows(staged.snapshot);
      },
      needsSetup: false,
    };
  }

  return EMPTY;
}

/** True when this build can capture at all, configured or not. */
export function isCaptureAvailable(): boolean {
  return isSmsScanningAvailable() || isRelayPlatform();
}
