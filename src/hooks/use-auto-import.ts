/**
 * The inbox scan, owned in one place so every screen can ask for it.
 *
 * This lived inside Home, and being inside Home was the bug. A user pays a
 * credit card, opens Wafra, goes to Bills — the screen that exists to answer
 * "is this card settled?" — and the card still says AED 5,645 owing. Bills had
 * no pull-to-refresh and no scan of its own, so the only thing that could have
 * imported the payment SMS was a foreground resume Home happened to catch. The
 * screen built to answer the question could not go and get the answer.
 *
 * So the scan moves here and Bills, Wallet and Flow can pull to refresh the
 * same way Home does. Three pieces of state are module-level rather than
 * per-component precisely BECAUSE more than one screen now mounts this:
 *
 *  - `importInFlight` — two screens must join one scan, not run two against
 *    the same stale ledger. Per-component, each screen would have had its own.
 *  - `lastScanAt` — the 30s freshness throttle is a property of the inbox, not
 *    of whoever is looking at it.
 *  - `sessionSetupRan` — entitlement refresh and reminder sync happen once per
 *    launch, not once per screen that mounts.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState, Platform } from 'react-native';

import { useToast } from '@/components/ui/toast';
import {
  hasSmsPermission,
  isSmsInboxAccessError,
  isSmsScanningAvailable,
  openSmsPermissionSettings,
  requestSmsPermission,
} from '@/lib/auto-import';
import { enableRelayBackgroundSync } from '@/lib/background-relay';
import { isCaptureAvailable } from '@/lib/capture';
import { createCaptureExecutor } from '@/lib/capture-executor';
import { committed } from '@/lib/haptics';
import { t, tf } from '@/lib/i18n';
import { syncDailySummary, syncPaymentReminders } from '@/lib/notifications';
import { isProActive } from '@/lib/purchases';
import { getRelayAutomationProof, getRelayConfig, getRelayRevokedAt } from '@/lib/relay';
import { useStore } from '@/lib/store';

/** The one-time setup that must not repeat: reminders and relay. */
let sessionSetupRan = false;

/**
 * How long a scan stays fresh enough to skip on returning to the app.
 *
 * Coming back from the banking app to see the charge is the single most
 * common way this app is opened, so the bar for re-scanning is low. It is
 * not zero only because flicking between two apps should not run a full inbox
 * read on every flick.
 */
const RESCAN_AFTER_MS = 30_000;
let lastScanAt = 0;

/**
 * Android provider access is a process-wide fact, not a screen-local one.
 *
 * The tabs shell owns the actual foreground scan while Home owns the visible
 * status card. Keeping this in either hook's useState lets a restricted OEM
 * provider fail invisibly in the shell while Home independently sees the
 * runtime permission bit and says ON. This tiny external store keeps those
 * adapters on one truthful answer; it contains no financial data.
 */
let sharedSmsAccessUnavailable = false;
const smsAccessListeners = new Set<() => void>();

const setSharedSmsAccessUnavailable = (unavailable: boolean): void => {
  if (sharedSmsAccessUnavailable === unavailable) return;
  sharedSmsAccessUnavailable = unavailable;
  for (const listener of smsAccessListeners) listener();
};

const subscribeSmsAccess = (listener: () => void): (() => void) => {
  smsAccessListeners.add(listener);
  return () => smsAccessListeners.delete(listener);
};

const smsAccessSnapshot = (): boolean => sharedSmsAccessUnavailable;

/**
 * What a scan attempt actually did, so a caller who only *joined* it — rather
 * than starting it — can tell whether it still owes its own interactive
 * feedback. `'imported'` is the one outcome that already shows a toast
 * unconditionally; every other outcome only acts when `interactive` was true
 * for THAT attempt, so a silent attempt that hit one of them delivered
 * nothing a joining interactive caller would see.
 */
export type AutoImportOutcome =
  | 'not-hydrated'
  | 'history-import-running'
  | 'not-pro'
  | 'unavailable'
  | 'no-permission'
  | 'needs-setup'
  | 'up-to-date'
  | 'imported';

export type CaptureSurfaceState =
  | 'checking'
  | 'active'
  | 'pipe-ready'
  | 'needs-test'
  /**
   * The relay has cut this device off — the vault owner removed it from
   * another phone. Distinct from 'off' on purpose: 'off' is a user who has not
   * set capture up, this is a user who did, whose card said ON for weeks
   * afterwards, and who has to be told why it stopped before "set it up again"
   * means anything.
   */
  | 'revoked'
  | 'off'
  | 'paused'
  | 'unsupported';

/**
 * Foreground resume, pull-to-refresh and the capture card can all request a
 * scan within the same second. Reading and parsing the same inbox twice is
 * both expensive and a race between two import plans built from one stale
 * ledger. Every caller joins the scan already in progress instead.
 *
 * Tracked with the interactivity it was started with: a silent background
 * scan and a user-initiated one owe different feedback, and joining the
 * wrong one used to mean the user's explicit pull-to-refresh silently rode
 * along on a scan that could not redirect to paywall/setup, prompt for SMS
 * permission, or show the up-to-date toast — all gated on `interactive`.
 */
let importInFlight: {
  promise: Promise<AutoImportOutcome>;
  interactive: boolean;
} | null = null;

export type AutoImport = {
  /** Scan now. `interactive` decides who owes the user feedback. */
  runAutoImport: (interactive: boolean) => Promise<void>;
  /** Android has not granted READ_SMS. */
  needsPermission: boolean;
  /** What the capture surface should say on this platform right now. */
  captureState: CaptureSurfaceState;
};

/**
 * @param watchForeground pass true on exactly the screens that should trigger
 * a scan on mount and on foreground resume. Home does; a screen the user only
 * visits deliberately does not need to, because the throttle and the in-flight
 * join make a second watcher redundant rather than harmful.
 */
export function useAutoImport(
  watchForeground = false,
  watchStatus = watchForeground,
): AutoImport {
  const {
    state,
    importBatch,
    stageReviewAlerts,
    undoBatch,
    ensureDurable,
    setMarket,
  } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const captureExecutor = useMemo(
    () =>
      createCaptureExecutor({
        ledger: {
          getState: () => stateRef.current,
          importBatch,
          stageReviewAlerts,
          ensureDurable,
          setMarket,
        },
      }),
    [ensureDurable, importBatch, setMarket, stageReviewAlerts],
  );
  const toast = useToast();
  const router = useRouter();
  const [needsPermission, setNeedsPermission] = useState(false);
  const [captureState, setCaptureState] = useState<CaptureSurfaceState>('checking');
  const sharedAccessUnavailable = React.useSyncExternalStore(
    subscribeSmsAccess,
    smsAccessSnapshot,
    smsAccessSnapshot,
  );
  const previousCaptureOptOut = useRef(state.captureOptOut);

  // Read the real platform capability whenever the screen regains focus. This
  // makes the card turn on immediately after returning from Settings or iOS
  // setup, without making the user relaunch to see that their choice worked.
  //
  // Only the screen that RENDERS that card pays for it. Four tabs now take
  // this hook, and without the guard every tab switch fired a native
  // permission query and two relay reads to update a status nobody displays.
  useFocusEffect(
    useCallback(() => {
      if (!watchStatus) return;
      let current = true;
      void (async () => {
        if (state.captureOptOut) {
          setNeedsPermission(false);
          setCaptureState('off');
          return;
        }
        if (Platform.OS === 'ios') {
          const [cfg, revokedAt] = await Promise.all([
            getRelayConfig(),
            getRelayRevokedAt(),
          ]);
          const automationProof = await getRelayAutomationProof(cfg?.deviceId ?? null);
          if (!current) return;
          // The revocation check comes first and is not derived from `cfg`,
          // because a revoked credential reads as no config at all. It also
          // outranks the automation proof: that marker is written once and
          // never expires, so a device the relay has cut off still carries
          // proof that its Shortcut worked — which is exactly how this card
          // went on saying "syncing silently" over a dead pipe.
          setCaptureState(
            revokedAt
              ? 'revoked'
              : cfg?.setupState === 'verified' && automationProof
                ? 'active'
                : cfg?.setupState === 'verified'
                  ? 'pipe-ready'
                  : cfg
                    ? 'needs-test'
                    : 'off',
          );
          return;
        }
        if (Platform.OS === 'android' && isSmsScanningAvailable()) {
          const granted = await hasSmsPermission().catch(() => false);
          if (!current) return;
          if (!granted) setSharedSmsAccessUnavailable(true);
          setNeedsPermission(!granted);
          setCaptureState(granted && !sharedAccessUnavailable ? 'active' : 'off');
          return;
        }
        if (current) setCaptureState('unsupported');
      })();
      return () => {
        current = false;
      };
    }, [sharedAccessUnavailable, state.captureOptOut, watchStatus]),
  );

  const performAutoImport = useCallback(
    async (interactive: boolean): Promise<AutoImportOutcome> => {
      // Never scan against a ledger that has not finished loading. Every
      // duplicate check in the plan is a lookup against state.transactions,
      // so an unhydrated store means nothing matches and the entire inbox
      // imports as new — on top of the rows that arrive a moment later.
      if (!state.hydrated) {
        if (interactive) toast.show(t('stillLoading'));
        return 'not-hydrated';
      }
      // The first-history owner reads bounded pages from a durable cursor.
      // Running the incremental scanner beside it would parse the same inbox
      // against a competing ledger snapshot and could advance lastScanTs past
      // history the page coordinator has not committed yet.
      if (state.historyImport && state.historyImport.status !== 'complete') {
        return 'history-import-running';
      }
      // Hard paywall: tracking pauses when the trial ends without Pro.
      if (!isProActive(state)) {
        if (interactive) router.push('/pro');
        return 'not-pro';
      }
      // The OS may still report READ_SMS as granted after the user opted out
      // inside Wafra. Stop before even asking the native permission module;
      // the explicit capture-card action is what turns this preference back
      // on.
      if (state.captureOptOut) return 'unavailable';
      if (!isCaptureAvailable()) return 'unavailable';
      // Android needs the SMS permission before it can read anything. iOS has
      // no permission to ask for — its messages arrive over the relay — so the
      // prompt is skipped there rather than shown and refused.
      if (isSmsScanningAvailable()) {
        let granted = await hasSmsPermission();
        if (!granted && interactive) granted = await requestSmsPermission();
        if (!granted) {
          setSharedSmsAccessUnavailable(true);
          setNeedsPermission(true);
          setCaptureState('off');
          if (interactive) {
            toast.show(t('smsAccessOff'), {
              tone: 'warning',
              actions: [{
                label: t('openSettings'),
                onPress: () => void openSmsPermissionSettings().catch(() => {}),
              }],
            });
          }
          return 'no-permission';
        }
        setNeedsPermission(false);
        setCaptureState('active');
      }

      let outcome;
      try {
        outcome = await captureExecutor.execute('routine');
      } catch (error) {
        if (!isSmsInboxAccessError(error)) throw error;
        setSharedSmsAccessUnavailable(true);
        setNeedsPermission(true);
        setCaptureState('off');
        if (interactive) {
          toast.show(t('smsAccessOff'), {
            tone: 'warning',
            actions: [{
              label: t('openSettings'),
              onPress: () => void openSmsPermissionSettings().catch(() => {}),
            }],
          });
        }
        return 'no-permission';
      }
      setSharedSmsAccessUnavailable(false);
      // Only a completed native/relay read makes capture fresh. A provider
      // restriction thrown above must not suppress the immediate retry after
      // the user returns from Android settings.
      lastScanAt = Date.now();
      if (outcome.kind === 'not-hydrated') {
        if (interactive) toast.show(t('stillLoading'));
        return 'not-hydrated';
      }
      if (outcome.kind === 'needs-setup') {
        // The relay is not paired yet, so silence here means "not connected",
        // not "nothing new". Only say so when the user actually asked.
        //
        // The card is corrected here as well as on focus. A scan is what
        // DISCOVERS a revocation, and the screen it happens on is already
        // mounted and focused — waiting for the next focus event would leave
        // "syncing silently" on screen for the rest of the session.
        if (Platform.OS === 'ios') {
          const revokedAt = await getRelayRevokedAt().catch(() => null);
          setCaptureState(revokedAt ? 'revoked' : 'off');
        }
        if (interactive) router.push('/ios-setup');
        return 'needs-setup';
      }
      if (outcome.kind === 'up-to-date') {
        if (interactive && outcome.reviewAlerts > 0) {
          toast.show(
            tf('reviewAlertsHomeCount', {
              count: outcome.reviewAlerts,
              s: outcome.reviewAlerts === 1 ? '' : 's',
            }),
            {
              tone: 'warning',
              actions: [{ label: t('review'), onPress: () => router.push('/review-alerts') }],
            },
          );
        } else if (interactive) {
          toast.show(t('upToDateNoNew'));
        }
        return 'up-to-date';
      }
      if (outcome.kind !== 'imported') return 'up-to-date';
      committed();
      toast.show(
        tf('importedTransactions', {
          count: outcome.transactions,
          s: outcome.transactions === 1 ? '' : 's',
          bills:
            outcome.bills > 0
              ? tf('importedBills', {
                  count: outcome.bills,
                  s: outcome.bills === 1 ? '' : 's',
                })
              : '',
          cards:
            outcome.newAccounts > 0
              ? tf('importedNewCards', {
                  count: outcome.newAccounts,
                  s: outcome.newAccounts === 1 ? '' : 's',
                })
              : '',
        }),
        {
          tone: 'success',
          actions: [
            ...(outcome.transactionIds.length > 0
              ? [{ label: t('undo'), onPress: () => undoBatch(outcome.transactionIds) }]
              : []),
            { label: t('review'), onPress: () => router.push('/transactions?source=sms') },
          ],
        },
      );
      return 'imported';
    },
    [captureExecutor, state, undoBatch, toast, router],
  );

  // The single owner of `importInFlight`. Always starts a fresh scan — callers
  // that should instead join one already running go through `runAutoImport`.
  const startAutoImport = useCallback(
    (interactive: boolean): Promise<AutoImportOutcome> => {
      const operation = performAutoImport(interactive).finally(() => {
        if (importInFlight?.promise === operation) importInFlight = null;
      });
      importInFlight = { promise: operation, interactive };
      return operation;
    },
    [performAutoImport],
  );

  const runAutoImport = useCallback(
    (interactive: boolean): Promise<void> => {
      const existing = importInFlight;
      if (!existing) return startAutoImport(interactive).then(() => undefined);
      // Two silent callers, or an interactive caller joining another
      // interactive one already in flight: the one running owns delivering
      // whatever feedback applies, same as before.
      if (!interactive || existing.interactive) return existing.promise.then(() => undefined);
      // An explicit action (pull-to-refresh, tapping the capture card) joined
      // a scan nobody was watching. That scan only ever ran its `interactive`
      // branches as false, so a permission prompt, a paywall/setup redirect,
      // or the up-to-date toast never fired — the user's tap would otherwise
      // get no feedback at all. None of those outcomes did any actual
      // reading or importing, so re-running interactively is a fresh first
      // attempt for this request, not a second scan of the same data. The one
      // exception is `'imported'`, whose toast already fires unconditionally.
      return existing.promise.then((outcome) =>
        outcome === 'imported' ? undefined : startAutoImport(true).then(() => undefined),
      );
    },
    [startAutoImport],
  );

  /**
   * The current scan, for the foreground listener to call.
   *
   * `runAutoImport` closes over `state`, and the effect below deliberately
   * does not list it: re-subscribing on every state change would also re-run
   * `scan()` on every state change, which on Android puts a full inbox parse
   * on the interaction path. The price of that omission was a listener frozen
   * with whatever `state` existed when it was registered — the hydration-time
   * ledger, for the rest of the session.
   *
   * Erase Everything is where a frozen listener stops being merely wasteful.
   * The blank ledger is the whole point of the erase, and a resume scan
   * holding the pre-erase state read from the OLD watermark and deduped every
   * message against rows that no longer exist: "up to date", over an empty
   * app, forever. A ref keeps the listener cheap and honest at once.
   *
   * Declared BEFORE the effect that reads it. React fires one commit's
   * effects in declaration order, so by the time that effect's body calls
   * `scan()` this assignment has already landed — which is what makes the
   * post-erase scan use the post-erase ledger rather than the one that
   * happened to be current when the listener was registered.
   */
  const latestScan = React.useRef(runAutoImport);
  useEffect(() => {
    latestScan.current = runAutoImport;
  }, [runAutoImport]);

  // Silent auto-import on open, and again every time the app comes back to
  // the foreground.
  //
  // This used to run once per JS session, behind a module-level flag that was
  // never reset. Android keeps the JS context alive when the app is
  // backgrounded, so "once per session" meant once per COLD START: leaving the
  // app to pay for something and coming back — the exact moment a new bank SMS
  // exists — imported nothing, and the charge only appeared after a manual
  // pull-to-refresh. The app looked like it could not see messages it had
  // already captured.
  useEffect(() => {
    if (!watchForeground) return;
    // The navigator stays mounted under onboarding so Expo Router can return
    // from the iOS setup route. Mounted must not mean active: scanning and
    // rebuilding projections behind the welcome flow competes with the one
    // progress surface the user is actually watching.
    if (!state.hydrated || !state.onboarded) return;
    const captureJustEnabled = previousCaptureOptOut.current && !state.captureOptOut;
    previousCaptureOptOut.current = state.captureOptOut;

    /**
     * @param force ignore the freshness throttle. Only the call below passes
     * it, and only for a ledger with no watermark at all.
     */
    const scan = (force = false) => {
      if (!force && Date.now() - lastScanAt < RESCAN_AFTER_MS) return;
      void latestScan.current(false).catch(() => {
        // Best-effort; manual import still available.
      });
    };

    /**
     * `state.lastScanTs` is in this effect's deps, and both halves of that
     * are Erase Everything.
     *
     * Erasing resets the ledger to EMPTY_STATE, whose watermark is 0, and the
     * inbox is the source of truth — a reinstall rebuilds from it, so an
     * erase has to as well. But nothing was making that rebuild happen. Home
     * is a tab, so it stays mounted while the user is in Settings and never
     * remounts; the effect's old deps (`hydrated`, `watchForeground`) do not
     * move when a ledger is wiped, so it never re-ran; and the one remaining
     * trigger, the resume listener, hit the 30s throttle that an erase does
     * not clear. The user came back to a permanently empty Home.
     *
     * The watermark going to 0 is the honest signal that there is nothing to
     * be fresh ABOUT, so it both re-runs this effect and forces past the
     * throttle. It cannot storm: the effect re-runs on a CHANGE to
     * `lastScanTs`, so a ledger sitting at 0 (a phone with no parseable bank
     * messages) forces exactly once and is then only reachable through the
     * throttled resume path, and a rebuild that does import moves the
     * watermark off 0 — which re-runs this effect once more into a throttle
     * that was just stamped.
     */
    // Do not stamp the freshness throttle for a scan that the durable opt-out
    // will refuse. When capture is explicitly enabled again, force the first
    // real scan even if another scan happened less than 30 seconds earlier.
    if (!state.captureOptOut) scan(state.lastScanTs <= 0 || captureJustEnabled);

    if (!sessionSetupRan) {
      sessionSetupRan = true;
      void (async () => {
        try {
          await enableRelayBackgroundSync();
          // Never prompt on launch. Reminder/instant-alert surfaces ask only
          // after the user explicitly enables them; this call is a no-op when
          // notification authorization has not already been granted.
          await syncPaymentReminders(state);
        } catch {
          // Reminders are best-effort; the ledger does not depend on them.
        }
      })();
    }

    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') scan();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.captureOptOut,
    state.historyImport?.status,
    state.hydrated,
    state.onboarded,
    state.lastScanTs,
    watchForeground,
  ]);

  /**
   * Tonight's summary follows the ledger, not the launch.
   *
   * A local notification's content is fixed when it is scheduled, so the digest
   * has to be rebuilt every time the day's spending changes — otherwise it
   * announces whatever was known when the app last opened, which on a day the
   * user does not open it is nothing at all. Keyed on the transactions array
   * identity: the store is a reducer, so that reference changes exactly when
   * the rows do, and never otherwise.
   *
   * Home is the single owner. `usePullToRefresh` mounts this hook in every
   * visited tab; letting all four instances observe the same reducer meant one
   * import could schedule the same native notification four times. A scan from
   * another tab still updates the shared transaction array, so Home's mounted
   * owner sees it and keeps the digest current.
   */
  useEffect(() => {
    if (!watchForeground || !state.hydrated || !state.onboarded || !state.dailySummary) return;
    void syncDailySummary(state).catch(() => {
      // A digest is never worth surfacing an error over.
    });
  }, [state, watchForeground]);

  return {
    runAutoImport,
    needsPermission: needsPermission || sharedAccessUnavailable,
    captureState: sharedAccessUnavailable ? 'off' : captureState,
  };
}

/**
 * Pull-to-refresh for a screen that only wants the scan, not the surface.
 *
 * Bills, Wallet and Flow all want the same three lines: a `refreshing` flag,
 * a handler that scans interactively, and nothing else. Writing those three
 * lines three times is how one of them ends up subtly different.
 */
export function usePullToRefresh(): { refreshing: boolean; onRefresh: () => void } {
  const { runAutoImport } = useAutoImport();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const alive = React.useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // `.finally` alone is not error handling. A scan that threw — a dead
    // network, a relay 5xx, a page that did not parse — rejected here with no
    // `.catch` at all: an unhandled promise rejection whose only visible
    // effect was the spinner disappearing, on the one gesture in the app that
    // exists to ask a question out loud. Every failure now says so, and
    // nothing reaches the global handler.
    void runAutoImport(true)
      .catch(() => {
        if (alive.current) toast.show(t('captureRefreshFailed'), { tone: 'error' });
      })
      .finally(() => {
        if (alive.current) setRefreshing(false);
      });
  }, [runAutoImport, toast]);
  return { refreshing, onRefresh };
}
