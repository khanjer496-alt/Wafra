/**
 * The foreground half of iPhone capture: the layer that is always correct.
 *
 * The push and background-task layers are latency. Each of them can be off —
 * notifications declined, Background App Refresh disabled, the app force-quit
 * from the switcher, a build with no EAS project id — and none of that loses a
 * transaction, because the relay holds a row until the phone acknowledges it.
 * This hook is what makes that true: it runs on launch, every time the app
 * comes back to the front, whenever a background sync stages something while
 * the app happens to be open, and on pull-to-refresh.
 *
 * It is also the ONLY layer that writes the ledger. `importBatch` is a method
 * on the React store, so the headless layers cannot call it and must not try;
 * they stage, and this drains.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  cacheEntitlement,
  isRelaySupported,
  runRelayImport,
  subscribeRelayStaged,
  type RelayImportResult,
} from '@/lib/relay';
import { ensureRelayWake } from '@/lib/relay-wake';
import type { ImportBatchInput } from '@/lib/store';
import type { AppState as WafraState } from '@/lib/types';

/**
 * iOS delivers `active` for reasons that are not "the user came back" — a
 * permission alert dismissing, Control Centre closing, a share sheet. Two syncs
 * a few hundred milliseconds apart would achieve nothing but a second round
 * trip, so a run inside this window is skipped.
 */
const MIN_GAP_MS = 10_000;

export interface RelayCapture {
  /**
   * Run the whole collect-import-acknowledge path. Never throws, never runs
   * twice at once, and resolves to `null` when there was nothing to do.
   */
  capture: (interactive: boolean) => Promise<RelayImportResult | null>;
}

export function useRelayCapture({
  state,
  importBatch,
  onCaptured,
}: {
  state: WafraState;
  importBatch: (input: ImportBatchInput) => string[];
  /** Called only when rows were actually filed, or the trial has lapsed. */
  onCaptured: (result: RelayImportResult, interactive: boolean) => void;
}): RelayCapture {
  // The store changes on every ledger write, and a capture triggered by an app
  // state change must use the CURRENT store rather than whatever was captured
  // when the listener was attached. A ref keeps the listeners stable and the
  // data fresh; without it, every import would tear down and rebuild the
  // subscriptions it was started from.
  const latest = useRef({ state, importBatch, onCaptured });
  latest.current = { state, importBatch, onCaptured };

  const running = useRef(false);
  const lastRunAt = useRef(0);

  const capture = useCallback(async (interactive: boolean): Promise<RelayImportResult | null> => {
    if (!isRelaySupported()) return null;
    const now = Date.now();
    // An interactive pull-to-refresh always runs: the user asked, and telling
    // them "too soon" would be answering a gesture with nothing.
    if (running.current || (!interactive && now - lastRunAt.current < MIN_GAP_MS)) return null;
    running.current = true;
    lastRunAt.current = now;
    try {
      const result = await runRelayImport(latest.current.state, latest.current.importBatch);
      if (result.skipped === 'not-pro' || result.ids.length > 0) {
        latest.current.onCaptured(result, interactive);
      }
      return result;
    } catch {
      // A relay that is down, a keychain that is locked, a network that is
      // gone. None of those is worth an error on screen: the queue holds for
      // 72 hours and the next foreground tries again.
      return null;
    } finally {
      running.current = false;
    }
  }, []);

  /* ── Launch: mirror the entitlement, turn the wake layers on, collect ── */
  useEffect(() => {
    if (!state.hydrated || !isRelaySupported()) return;
    let cancelled = false;
    (async () => {
      // Written before anything else so a background task that fires in the
      // next fifteen minutes knows whether it is allowed to run at all.
      await cacheEntitlement(state);
      if (cancelled) return;
      // Collecting comes first. Registering the wake layers involves a round
      // trip to Expo for a push token, and today's transactions must not wait
      // behind tomorrow's latency optimisation.
      await capture(false);
      if (cancelled) return;
      void ensureRelayWake().catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on hydration and the entitlement rather than the whole
    // store: this is a once-per-session job, and re-running it on every ledger
    // write would re-register the background task on every import.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hydrated, state.pro, capture]);

  /* ── Back to the front: the moment a user expects to see today's spend ── */
  useEffect(() => {
    if (!isRelaySupported()) return;
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') void capture(false);
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [capture]);

  /* ── A background sync staged rows while the app was open ──
     A silent push wakes the same JS context the UI is running in, so the rows
     would otherwise sit in staging until the next launch while the user was
     looking at the screen they belong on. */
  useEffect(() => {
    if (!isRelaySupported()) return;
    return subscribeRelayStaged(() => {
      void capture(true);
    });
  }, [capture]);

  return { capture };
}
