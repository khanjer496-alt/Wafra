import { internalTransferIdsForState, liveAccountIds } from '@/lib/ledger';
import { detectSubscriptionsCooperatively } from '@/lib/subscriptions';
import { widgetSnapshotForLedger, type WidgetLedgerInput } from '@/lib/widget-ledger';
import type { AppState } from '@/lib/types';
import type { WidgetSnapshot } from '@/lib/widget-snapshot';
import { clearWidgetSnapshot, setWidgetSnapshot, widgetSnapshotClearCount } from '../../modules/wafra-widgets';

export function widgetSnapshotAllowed(input: WidgetLedgerInput): boolean {
  return input.state.hydrated && input.state.onboarded && !input.state.privateMode;
}

/** A queued import has not changed the ledger until its first page is scanned. */
export function widgetHistoryBlocksUpdate(progress: AppState['historyImport']): boolean {
  if (!progress || progress.status === 'complete') return false;
  return !(progress.status === 'paused' && progress.scanned === 0 &&
    progress.found === 0 && progress.cursor === null);
}

/** Undefined means analysis is pending/cancelled, never "no upcoming bills". */
export async function prepareWidgetSnapshot(
  input: WidgetLedgerInput,
  cancelled: () => boolean = () => false,
  detect: typeof detectSubscriptionsCooperatively = detectSubscriptionsCooperatively,
): Promise<WidgetSnapshot | null | undefined> {
  if (cancelled()) return undefined;
  if (!widgetSnapshotAllowed(input)) return null;
  // A partial import is not evidence that a subscription stopped. Keep the
  // last valid native summary (whose own staleness limit still applies).
  if (widgetHistoryBlocksUpdate(input.state.historyImport)) return undefined;
  const { state, now } = input;
  const detected = await detect(state.transactions, state.notSubscriptions, now,
    liveAccountIds(state.accounts), internalTransferIdsForState(state), cancelled);
  if (cancelled() || detected === null) return undefined;
  return widgetSnapshotForLedger(input, detected);
}

/**
 * `unchanged`: the native copy already holds these figures (written by this
 * process, not cleared since, and recently enough), so nothing was rewritten.
 */
export type WidgetSyncOutcome = 'written' | 'unchanged' | 'cleared' | 'pending' | 'cancelled' | 'failed';
interface WidgetSyncDependencies {
  /** False (or a rejection) when the native copy was not stored. */
  write(json: string): void | boolean | Promise<void | boolean>;
  clear(): void | Promise<void>;
  prepare?: typeof prepareWidgetSnapshot;
  /** Epoch ms, for the rewrite limit. */
  now?: () => number;
  /** Changes whenever something outside this sync erased the native copy (Erase everything). */
  externalClears?: () => number;
}

/**
 * The same figures written by this process are not rewritten for this long.
 * A same-day reopen never re-stamps them: the snapshot carries `todayISO`, so
 * a new day is different content and is written, and the widgets themselves
 * drop a snapshot whose `todayISO` is not today. This limit only bounds how
 * stale `generatedAt` can get within one long-lived process.
 */
export const WIDGET_REWRITE_AFTER_MS = 3 * 60 * 60_000;

/** A snapshot without its clock: two snapshots with the same key draw the same widgets. */
export function widgetSnapshotContentKey(snapshot: WidgetSnapshot): string {
  return JSON.stringify({ ...snapshot, generatedAt: 0 });
}

/** Latest request wins. Only native mutations serialize; detection stays cooperative. */
export function createWidgetSnapshotSync(dependencies: WidgetSyncDependencies) {
  let generation = 0;
  let mutation = Promise.resolve();
  // What this process last wrote. A native write re-renders every placed
  // widget (Android redraws their bitmaps), so a reopen with the same
  // figures must not repeat it.
  let written: { key: string; at: number; clears: number } | null = null;
  const now = () => dependencies.now?.() ?? Date.now();
  const clears = () => dependencies.externalClears?.() ?? 0;
  const enqueue = (current: () => boolean, action: () => WidgetSyncOutcome | Promise<WidgetSyncOutcome>): Promise<WidgetSyncOutcome> => {
    const next = mutation.catch(() => {}).then(async (): Promise<WidgetSyncOutcome> => {
      if (!current()) return 'cancelled';
      return action();
    }).catch((): WidgetSyncOutcome => 'failed');
    mutation = next.then(() => {});
    return next;
  };
  const clearNative = async (): Promise<WidgetSyncOutcome> => {
    written = null;
    await dependencies.clear();
    return 'cleared';
  };
  const writeNative = async (snapshot: WidgetSnapshot): Promise<WidgetSyncOutcome> => {
    const key = widgetSnapshotContentKey(snapshot);
    const at = now();
    if (written && written.key === key && written.clears === clears() && at >= written.at &&
      at - written.at < WIDGET_REWRITE_AFTER_MS) return 'unchanged';
    // Unknown until the write completes: a failed write must not be remembered as done.
    written = null;
    const stored = await dependencies.write(JSON.stringify(snapshot));
    // Not stored (Android had no context, the write threw): the next request writes again.
    if (stored === false) return 'failed';
    written = { key, at, clears: clears() };
    return 'written';
  };
  const clear = (): Promise<WidgetSyncOutcome> => {
    const mine = ++generation;
    // An in-flight native write is followed by this clear before completion.
    return enqueue(() => mine === generation, clearNative);
  };
  const request = (input: WidgetLedgerInput, isCurrent: () => boolean = () => true) => {
    const mine = ++generation;
    let cancelled = false;
    const current = () => !cancelled && mine === generation && isCurrent();
    const done = !widgetSnapshotAllowed(input)
      // Privacy cleanup must not be lost merely because the caller unmounts.
      ? enqueue(() => mine === generation, clearNative)
      : (async (): Promise<WidgetSyncOutcome> => {
        try {
          const snapshot = await (dependencies.prepare ?? prepareWidgetSnapshot)(input, () => !current());
          if (!current()) return 'cancelled';
          if (snapshot === undefined) return 'pending';
          if (snapshot === null) return enqueue(current, clearNative);
          return enqueue(current, () => writeNative(snapshot));
        } catch {
          // Presentation failure cannot erase the ledger or replace a useful
          // native snapshot with an invented empty one.
          return 'failed';
        }
      })();
    return { cancel: () => { cancelled = true; }, done };
  };
  return { request, clear };
}

const nativeSync = createWidgetSnapshotSync({ write: setWidgetSnapshot, clear: clearWidgetSnapshot,
  externalClears: typeof widgetSnapshotClearCount === 'function' ? widgetSnapshotClearCount : undefined });
export const requestWidgetSnapshotSync = nativeSync.request;
/** Invalidate pending analyses and erase the native shared summary. */
export const invalidateWidgetSnapshotSync = nativeSync.clear;
