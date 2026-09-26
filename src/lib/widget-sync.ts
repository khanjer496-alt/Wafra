import { internalTransferIdsForState, liveAccountIds } from '@/lib/ledger';
import { detectSubscriptionsCooperatively } from '@/lib/subscriptions';
import { widgetSnapshotForLedger, type WidgetLedgerInput } from '@/lib/widget-ledger';
import type { WidgetSnapshot } from '@/lib/widget-snapshot';
import { clearWidgetSnapshot, setWidgetSnapshot } from '../../modules/wafra-widgets';

export function widgetSnapshotAllowed(input: WidgetLedgerInput): boolean {
  return input.state.hydrated && input.state.onboarded && !input.state.privateMode;
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
  if (input.state.historyImport && input.state.historyImport.status !== 'complete') return undefined;
  const { state, now } = input;
  const detected = await detect(state.transactions, state.notSubscriptions, now,
    liveAccountIds(state.accounts), internalTransferIdsForState(state), cancelled);
  if (cancelled() || detected === null) return undefined;
  return widgetSnapshotForLedger(input, detected);
}

export type WidgetSyncOutcome = 'written' | 'cleared' | 'pending' | 'cancelled' | 'failed';
interface WidgetSyncDependencies {
  write(json: string): void | Promise<void>;
  clear(): void | Promise<void>;
  prepare?: typeof prepareWidgetSnapshot;
}

/** Latest request wins. Only native mutations serialize; detection stays cooperative. */
export function createWidgetSnapshotSync(dependencies: WidgetSyncDependencies) {
  let generation = 0;
  let mutation = Promise.resolve();
  const enqueue = (current: () => boolean, action: () => void | Promise<void>, outcome: WidgetSyncOutcome): Promise<WidgetSyncOutcome> => {
    const next = mutation.catch(() => {}).then(async (): Promise<WidgetSyncOutcome> => {
      if (!current()) return 'cancelled';
      await action();
      return outcome;
    }).catch((): WidgetSyncOutcome => 'failed');
    mutation = next.then(() => {});
    return next;
  };
  const clear = (): Promise<WidgetSyncOutcome> => {
    const mine = ++generation;
    // An in-flight native write is followed by this clear before completion.
    return enqueue(() => mine === generation, dependencies.clear, 'cleared');
  };
  const request = (input: WidgetLedgerInput, isCurrent: () => boolean = () => true) => {
    const mine = ++generation;
    let cancelled = false;
    const current = () => !cancelled && mine === generation && isCurrent();
    const done = !widgetSnapshotAllowed(input)
      // Privacy cleanup must not be lost merely because the caller unmounts.
      ? enqueue(() => mine === generation, dependencies.clear, 'cleared')
      : (async (): Promise<WidgetSyncOutcome> => {
        try {
          const snapshot = await (dependencies.prepare ?? prepareWidgetSnapshot)(input, () => !current());
          if (!current()) return 'cancelled';
          if (snapshot === undefined) return 'pending';
          if (snapshot === null) return enqueue(current, dependencies.clear, 'cleared');
          return enqueue(current, () => dependencies.write(JSON.stringify(snapshot)), 'written');
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

const nativeSync = createWidgetSnapshotSync({ write: setWidgetSnapshot, clear: clearWidgetSnapshot });
export const requestWidgetSnapshotSync = nativeSync.request;
/** Invalidate pending analyses and erase the native shared summary. */
export const invalidateWidgetSnapshotSync = nativeSync.clear;
