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
import { readBackgroundRelayRows } from '@/lib/background-relay';
import { backgroundRelayStorage } from '@/lib/background-relay-storage';
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

async function readStagedRows(): Promise<StagedRows> {
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

  // Private Mode is local-only. Android already returned above through its
  // on-device inbox pipe; iOS must stop here because a Shortcut can only hand
  // its message to the app by making an HTTP request to the relay.
  if (state.privateMode) return EMPTY;

  if (isRelayPlatform()) {
    // A headless wake may already have collected and acknowledged rows while
    // the UI process was not running. They live in SQLCipher until the normal
    // import boundary durably folds them into the ledger.
    const staged = await readStagedRows();
    const cfg = await getRelayConfig();
    if (!cfg || cfg.setupState === 'paired') {
      if (staged.rows.length > 0) {
        const newestTs = staged.rows.reduce(
          (max, p) => Math.max(max, p.smsTs ?? 0),
          state.lastScanTs,
        );
        return {
          parsed: staged.rows,
          newestTs,
          source: 'relay',
          commit: async () => {
            await clearStagedRows(staged.snapshot);
          },
          needsSetup: false,
        };
      }
      return { ...EMPTY, source: 'relay', needsSetup: true };
    }
    const { parsed, ids, testIds } = await syncRelay(cfg);
    const collected = [...staged.rows, ...parsed];
    const newestTs = collected.reduce((max, p) => Math.max(max, p.smsTs ?? 0), state.lastScanTs);
    return {
      parsed: collected,
      newestTs,
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
