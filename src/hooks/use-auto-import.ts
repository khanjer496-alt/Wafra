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
import { enableRelayBackgroundSync, setChargeAlertsEnabled } from '@/lib/background-relay';
import {
  getIosCaptureNativeModule,
  isCaptureAvailable,
  publishIosCaptureStatusRefresh,
  subscribeIosCaptureStatusRefresh,
} from '@/lib/capture';
import { createCaptureExecutor, type CaptureLedgerAdapter } from '@/lib/capture-executor';
import { committed } from '@/lib/haptics';
import { t, tf } from '@/lib/i18n';
import { syncDailySummary, syncPaymentReminders } from '@/lib/notifications';
import { isProActive } from '@/lib/purchases';
import {
  getRelayConfig,
  isLegacyShortcutCaptureActive,
  retireRelayShortcutCapture,
} from '@/lib/relay';
import {
  getSharedIosLocalCaptureCoordinator,
} from '@/lib/ios-local-capture';
import { useStore } from '@/lib/store';
import type { AppState, IosCaptureWarningState } from '@/lib/types';
import type {
  WafraLiveCaptureNativeModule,
  WafraLiveCaptureStatus,
} from '../../modules/wafra-live-capture';

/** The one-time setup that must not repeat: reminders and relay. */
let sessionSetupRan = false;

type IosCaptureWarningFacts = Pick<
  IosCaptureWarningState,
  'dropped' | 'corrupt' | 'nativeWarningId'
>;

// Warning persistence is deliberately attempted for every native observation,
// but a persistent `corrupt` flag must not make two mounted status surfaces
// publish each other into an infinite reread loop. This remembers only the
// source-free facts last broadcast by this JS session; it is never durability
// evidence and is never authorization to acknowledge native evidence.
const lastPublishedIosCaptureWarnings = new WeakMap<
  IosLocalCaptureCycleDependencies['getStateSnapshot'],
  IosCaptureWarningFacts
>();

const warningFactsAdvance = (
  previous: IosCaptureWarningFacts | null,
  next: IosCaptureWarningFacts,
): boolean => previous === null || next.dropped > previous.dropped ||
  (next.corrupt && !previous.corrupt) || next.nativeWarningId !== previous.nativeWarningId;

const retireLegacyShortcutCapture = async (): Promise<'not-needed' | 'complete'> => {
  const cfg = await getRelayConfig();
  if (!cfg || !isLegacyShortcutCaptureActive(cfg)) {
    await setChargeAlertsEnabled(false);
    return 'not-needed';
  }
  await retireRelayShortcutCapture(cfg);
  await setChargeAlertsEnabled(false);
  return 'complete';
};

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
  | 'first-alert-captured'
  | 'waiting-for-alert'
  | 'needs-automation'
  | 'queue-warning'
  | 'migration-retry'
  | 'off'
  | 'paused'
  | 'unsupported';

export function resolveIosCaptureSurfaceState({
  hydrated = true,
  supported = true,
  proActive = true,
  entitled = true,
  captureOptOut = false,
  enabled,
  setupProofVersion,
  firstCapturedAt,
  pending,
  dropped,
  corrupt,
  retirementPending,
}: {
  hydrated?: boolean;
  supported?: boolean;
  proActive?: boolean;
  entitled?: boolean;
  captureOptOut?: boolean;
  enabled: boolean;
  setupProofVersion: number | null;
  firstCapturedAt: number | null;
  pending: number;
  dropped: number;
  corrupt: boolean;
  retirementPending: boolean;
}): CaptureSurfaceState {
  if (!hydrated) return 'checking';
  if (!supported) return 'unsupported';
  if (captureOptOut) return 'off';
  if (pending > 0 || dropped > 0 || corrupt) return 'queue-warning';
  if (!proActive || !entitled) return 'paused';
  if (!enabled) return 'off';
  if (retirementPending) return 'migration-retry';
  if (setupProofVersion !== 1) return 'needs-automation';
  if (firstCapturedAt !== null) return 'first-alert-captured';
  return 'waiting-for-alert';
}

export const iosRelayIntentFor = ({
  hasRelayConfig,
  privateMode,
}: {
  hasRelayConfig: boolean;
  privateMode: boolean;
}): 'supplemental' | null => hasRelayConfig && !privateMode ? 'supplemental' : null;

export const shouldReplayJoinedAutoImport = ({
  platform,
  outcome,
}: {
  platform: string;
  outcome: AutoImportOutcome;
}): boolean => outcome !== 'imported' && !(platform === 'ios' && outcome === 'up-to-date');

type IosLocalCoordinator = ReturnType<typeof getSharedIosLocalCaptureCoordinator>;

interface IosLocalCaptureCycleDependencies {
  getStateSnapshot: () => Pick<
    AppState,
    'hydrated' | 'captureOptOut' | 'privateMode' | 'iosCaptureWarning'
  >;
  native: Pick<WafraLiveCaptureNativeModule, 'getCaptureStatus'>;
  coordinator: IosLocalCoordinator;
  recordWarning: (warning: IosCaptureWarningState) => { durable: Promise<void> };
  publishStatusRefresh: (origin: 'warning' | 'drain') => void;
  now: () => number;
}

export interface IosLocalCaptureCycleResult {
  status: WafraLiveCaptureStatus | null;
  drain: Awaited<ReturnType<IosLocalCoordinator['drain']>> | null;
  retirement: Awaited<ReturnType<IosLocalCoordinator['retryRetirementIfNeeded']>>;
}

/** One source-free local lifecycle operation, shared by hook effects and tests. */
export const runIosLocalCaptureCycle = async (
  dependencies: IosLocalCaptureCycleDependencies,
  mode: 'drain' | 'status',
): Promise<IosLocalCaptureCycleResult> => {
  const before = dependencies.getStateSnapshot();
  if (!before.hydrated || before.captureOptOut) {
    return { status: null, drain: null, retirement: 'not-needed' };
  }

  const status = await dependencies.native.getCaptureStatus();
  const afterStatus = dependencies.getStateSnapshot();
  if (!afterStatus.hydrated || afterStatus.captureOptOut) {
    return { status, drain: null, retirement: 'not-needed' };
  }

  if (status.dropped > 0 || status.corrupt) {
    // AppState changes synchronously before its encrypted write settles. It is
    // therefore evidence of observation, never evidence of durability: every
    // native warning observation earns a fresh persistence receipt before any
    // later targeted-recovery acknowledgement.
    const warningWasCleared = afterStatus.iosCaptureWarning == null;
    const warningFacts: IosCaptureWarningFacts = {
      dropped: Math.max(status.dropped, afterStatus.iosCaptureWarning?.dropped ?? 0),
      corrupt: Boolean(status.corrupt || afterStatus.iosCaptureWarning?.corrupt),
      nativeWarningId: status.warningId,
    };
    if (warningWasCleared) {
      lastPublishedIosCaptureWarnings.delete(dependencies.getStateSnapshot);
    }
    const warningReceipt = dependencies.recordWarning({
      dropped: status.dropped,
      corrupt: status.corrupt,
      recordedAt: dependencies.now(),
      nativeWarningId: status.warningId,
    });
    await warningReceipt.durable;
    const publishDurableWarning = () => {
      // A cleared store deleted the prior lifetime above. Otherwise only
      // advancing facts publish; every repeated observation still received the
      // fresh durability write that completed before this callback was built.
      const lastPublishedWarning =
        lastPublishedIosCaptureWarnings.get(dependencies.getStateSnapshot) ?? null;
      if (warningFactsAdvance(lastPublishedWarning, warningFacts)) {
        lastPublishedIosCaptureWarnings.set(dependencies.getStateSnapshot, warningFacts);
        dependencies.publishStatusRefresh('warning');
      }
    };
    // Native evidence remains until the user runs targeted recovery. Status
    // reads never erase a loss/corruption warning merely because it was seen.
    publishDurableWarning();
  }

  const current = dependencies.getStateSnapshot();
  if (!current.hydrated || current.captureOptOut) {
    return { status, drain: null, retirement: 'not-needed' };
  }

  if (mode === 'drain') {
    let drain: Awaited<ReturnType<IosLocalCoordinator['drain']>> | null = null;
    if (status.enabled) {
      try {
        drain = await dependencies.coordinator.drain();
      } finally {
        // A partial page can update native counts or a first-capture milestone
        // before a later durability/ACK step fails. Surfaces must reread those
        // facts even when the drain rejects.
        dependencies.publishStatusRefresh('drain');
      }
    }
    return {
      status,
      drain,
      retirement: drain?.retirement ?? 'not-needed',
    };
  }

  const retirement = await dependencies.coordinator.retryRetirementIfNeeded();
  return { status, drain: null, retirement };
};

interface IosCaptureRecoveryDependencies {
  getStateSnapshot: IosLocalCaptureCycleDependencies['getStateSnapshot'];
  native: Pick<
    WafraLiveCaptureNativeModule,
    'getCaptureStatus' | 'acknowledgeCaptureWarning'
  >;
  coordinator: IosLocalCoordinator;
  recordWarning: IosLocalCaptureCycleDependencies['recordWarning'];
  clearWarning: (
    expectedWarningId: string | null,
  ) => { cleared: boolean; durable: Promise<void> };
  publishStatusRefresh: () => void;
  now: () => number;
}

/**
 * Process a bounded recoverable backlog, then compare-and-clear only the exact
 * source-free warning generation the user chose to acknowledge.
 */
export const recoverIosCaptureQueue = async (
  dependencies: IosCaptureRecoveryDependencies,
): Promise<boolean> => {
  const usable = () => {
    const state = dependencies.getStateSnapshot();
    return state.hydrated && !state.captureOptOut;
  };
  if (!usable()) return false;

  // This intentionally bypasses the subscription paywall. It drains only the
  // already bounded backlog and never re-enables native admission.
  await dependencies.coordinator.drain();
  if (!usable()) return false;

  const persistWarning = async (status: WafraLiveCaptureStatus): Promise<void> => {
    const receipt = dependencies.recordWarning({
      dropped: status.dropped,
      corrupt: status.corrupt,
      recordedAt: dependencies.now(),
      nativeWarningId: status.warningId,
    });
    await receipt.durable;
  };

  let status = await dependencies.native.getCaptureStatus();
  if (!usable()) return false;
  if (status.pending > 0) {
    if (status.dropped > 0 || status.corrupt) await persistWarning(status);
    dependencies.publishStatusRefresh();
    return false;
  }

  if (status.dropped > 0 || status.corrupt) {
    await persistWarning(status);
    if (!status.warningId ||
      !(await dependencies.native.acknowledgeCaptureWarning(status.warningId))) {
      const raced = await dependencies.native.getCaptureStatus();
      if (raced.dropped > 0 || raced.corrupt) await persistWarning(raced);
      dependencies.publishStatusRefresh();
      return false;
    }
    const cleared = dependencies.clearWarning(status.warningId);
    if (!cleared.cleared) {
      dependencies.publishStatusRefresh();
      return false;
    }
    await cleared.durable;
  } else {
    // Covers a crash after the native compare-and-clear but before SQLCipher
    // persisted the source-free AppState clear.
    const stale = dependencies.getStateSnapshot().iosCaptureWarning;
    if (stale) {
      const cleared = dependencies.clearWarning(stale.nativeWarningId);
      if (cleared.cleared) await cleared.durable;
    }
  }

  status = await dependencies.native.getCaptureStatus();
  if (status.dropped > 0 || status.corrupt) {
    await persistWarning(status);
    dependencies.publishStatusRefresh();
    return false;
  }
  dependencies.publishStatusRefresh();
  return status.pending === 0;
};

export interface CoalescingStatusRefresh {
  request(): Promise<void>;
  /** Invalidate a screen/focus generation without permanently stopping it. */
  invalidate(): void;
  /** Permanently stop work for an unmounted hook consumer. */
  dispose(): void;
}

/**
 * Source-free signals are edge notifications, not state. A signal that lands
 * during a native read therefore queues exactly one newer read and invalidates
 * the older result instead of disappearing behind an `inFlight` boolean.
 */
export const createCoalescingStatusRefresh = (
  readAndCommit: (isCurrent: () => boolean) => Promise<void>,
): CoalescingStatusRefresh => {
  let running: Promise<void> | null = null;
  let pending = false;
  let generation = 0;
  let disposed = false;

  const request = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    pending = true;
    generation += 1;
    if (running) return running;

    const operation = (async () => {
      let failure: unknown = null;
      try {
        while (!disposed && pending) {
          pending = false;
          const readGeneration = generation;
          try {
            await readAndCommit(
              () => !disposed && readGeneration === generation,
            );
          } catch (error) {
            failure ??= error;
          }
        }
        if (failure) throw failure;
      } finally {
        running = null;
      }
    })();
    running = operation;
    return operation;
  };

  return {
    request,
    invalidate: () => {
      generation += 1;
      pending = false;
    },
    dispose: () => {
      disposed = true;
      generation += 1;
      pending = false;
    },
  };
};

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
  /** Source-free native counts for Settings recovery. */
  iosCaptureStatus: WafraLiveCaptureStatus | null;
  /** Process the existing bounded iOS backlog and clear one exact warning. */
  recoverIosCaptureQueue: () => Promise<boolean>;
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
    getStateSnapshot,
    getStateGeneration,
    importBatch,
    stageReviewAlerts,
    undoBatch,
    ensureDurable,
    setMarket,
    recordIosCaptureWarning,
    clearIosCaptureWarning,
  } = useStore();
  const captureLedger = useMemo<CaptureLedgerAdapter>(() => ({
    getState: getStateSnapshot,
    getStateGeneration,
    importBatch,
    stageReviewAlerts,
    ensureDurable,
    setMarket,
  }), [
    ensureDurable,
    getStateGeneration,
    getStateSnapshot,
    importBatch,
    setMarket,
    stageReviewAlerts,
  ]);
  const captureExecutor = useMemo(
    () =>
      createCaptureExecutor({
        ledger: captureLedger,
      }),
    [captureLedger],
  );
  const iosNative = useMemo(() => getIosCaptureNativeModule(), []);
  const statusReadInProgress = useRef(false);
  const ignoreOwnWarningSignal = useRef(false);
  const iosCoordinator = useMemo(() => {
    if (!iosNative) return null;
    return getSharedIosLocalCaptureCoordinator({
      native: iosNative,
      ledger: captureLedger,
      retireShortcutCapture: retireLegacyShortcutCapture,
    });
  }, [captureLedger, iosNative]);
  const iosCycleDependencies = useMemo<IosLocalCaptureCycleDependencies | null>(() => {
    if (!iosNative || !iosCoordinator) return null;
    return {
      getStateSnapshot,
      native: iosNative,
      coordinator: iosCoordinator,
      recordWarning: recordIosCaptureWarning,
      publishStatusRefresh: (origin) => {
        const ignoreForThisHook = origin === 'warning' && statusReadInProgress.current;
        if (ignoreForThisHook) ignoreOwnWarningSignal.current = true;
        try {
          publishIosCaptureStatusRefresh();
        } finally {
          if (ignoreForThisHook) ignoreOwnWarningSignal.current = false;
        }
      },
      now: Date.now,
    };
  }, [getStateSnapshot, iosCoordinator, iosNative, recordIosCaptureWarning]);
  const toast = useToast();
  const router = useRouter();
  const [needsPermission, setNeedsPermission] = useState(false);
  const [captureState, setCaptureState] = useState<CaptureSurfaceState>('checking');
  const [iosCaptureStatus, setIosCaptureStatus] = useState<WafraLiveCaptureStatus | null>(null);
  const entitlementActive = isProActive(state);
  const sharedAccessUnavailable = React.useSyncExternalStore(
    subscribeSmsAccess,
    smsAccessSnapshot,
    smsAccessSnapshot,
  );
  const previousCaptureOptOut = useRef(state.captureOptOut);
  const iosRecoveryInFlight = useRef<Promise<boolean> | null>(null);

  const readAndCommitCaptureStatus = useCallback(async (
    isCurrent: () => boolean,
  ): Promise<void> => {
    const current = getStateSnapshot();
    if (!current.hydrated) {
      if (isCurrent()) setCaptureState('checking');
      return;
    }
    if (current.captureOptOut) {
      if (Platform.OS === 'ios' && iosNative) {
        // Opt-out stops admission, but a previously staged record can cross
        // its logical 30-day expiry while capture is off. Touch only the
        // native expiry path here—never list or drain message records.
        await iosNative.purgeExpired().catch(() => 0);
      }
      if (!isCurrent()) return;
      setNeedsPermission(false);
      setIosCaptureStatus(null);
      setCaptureState('off');
      return;
    }
    if (Platform.OS === 'ios') {
      if (!iosCycleDependencies) {
        if (isCurrent()) {
          setIosCaptureStatus(null);
          setCaptureState('unsupported');
        }
        return;
      }
      const entitlementActive = isProActive(current);
      let cycle: IosLocalCaptureCycleResult;
      statusReadInProgress.current = true;
      try {
        cycle = await runIosLocalCaptureCycle(iosCycleDependencies, 'status');
      } finally {
        statusReadInProgress.current = false;
      }
      const cfg = await getRelayConfig();
      if (!isCurrent()) return;
      const latest = getStateSnapshot();
      const warning = latest.iosCaptureWarning;
      const nativeStatus = cycle.status;
      setIosCaptureStatus(nativeStatus ? {
        ...nativeStatus,
        dropped: Math.max(nativeStatus.dropped, warning?.dropped ?? 0),
        corrupt: Boolean(nativeStatus.corrupt || warning?.corrupt),
      } : null);
      setCaptureState(resolveIosCaptureSurfaceState({
        hydrated: latest.hydrated,
        supported: nativeStatus !== null,
        proActive: entitlementActive,
        entitled: nativeStatus?.entitled ?? false,
        captureOptOut: latest.captureOptOut,
        enabled: nativeStatus?.enabled ?? false,
        setupProofVersion: nativeStatus?.setupProofVersion ?? null,
        firstCapturedAt: nativeStatus?.firstCapturedAt ?? null,
        pending: nativeStatus?.pending ?? 0,
        dropped: Math.max(nativeStatus?.dropped ?? 0, warning?.dropped ?? 0),
        corrupt: Boolean(nativeStatus?.corrupt || warning?.corrupt),
        retirementPending: nativeStatus?.firstCapturedAt !== null &&
          isLegacyShortcutCaptureActive(cfg),
      }));
      return;
    }
    if (Platform.OS === 'android' && isSmsScanningAvailable()) {
      const granted = await hasSmsPermission().catch(() => false);
      if (!isCurrent()) return;
      // A status-only read can say the permission is absent through this
      // hook's local flag. Reserve the process-wide failure flag for an
      // actual provider/scan failure; otherwise a permission denied behind
      // onboarding survives the later grant and keeps Home falsely off.
      setNeedsPermission(!granted);
      setCaptureState(granted && !sharedAccessUnavailable ? 'waiting-for-alert' : 'off');
      return;
    }
    if (isCurrent()) setCaptureState('unsupported');
  }, [getStateSnapshot, iosCycleDependencies, iosNative, sharedAccessUnavailable]);
  const latestStatusRead = useRef(readAndCommitCaptureStatus);
  latestStatusRead.current = readAndCommitCaptureStatus;
  const statusRefresh = useMemo(
    () => createCoalescingStatusRefresh(
      (isCurrent) => latestStatusRead.current(isCurrent),
    ),
    [],
  );
  const refreshCaptureStatus = useCallback(
    (): Promise<void> => statusRefresh.request(),
    [statusRefresh],
  );

  const recoverIosCapture = useCallback((): Promise<boolean> => {
    if (iosRecoveryInFlight.current) return iosRecoveryInFlight.current;
    if (!iosNative || !iosCoordinator) return Promise.resolve(false);
    const operation = recoverIosCaptureQueue({
      getStateSnapshot,
      native: iosNative,
      coordinator: iosCoordinator,
      recordWarning: recordIosCaptureWarning,
      clearWarning: clearIosCaptureWarning,
      publishStatusRefresh: publishIosCaptureStatusRefresh,
      now: Date.now,
    }).finally(() => {
      if (iosRecoveryInFlight.current === operation) {
        iosRecoveryInFlight.current = null;
      }
    });
    iosRecoveryInFlight.current = operation;
    return operation;
  }, [
    clearIosCaptureWarning,
    getStateSnapshot,
    iosCoordinator,
    iosNative,
    recordIosCaptureWarning,
  ]);

  useEffect(() => () => {
    // Effect cleanup is replayed immediately in React Strict Mode. Invalidate
    // the current generation without permanently poisoning the memoized
    // scheduler that the replayed setup reuses; listener effects clean up their
    // own subscriptions, and an actual unmount drops the scheduler afterward.
    statusRefresh.invalidate();
  }, [statusRefresh]);

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
      void refreshCaptureStatus().catch(() => {});
      return () => {
        statusRefresh.invalidate();
      };
    }, [refreshCaptureStatus, statusRefresh, watchStatus]),
  );

  // Store hydration is asynchronous. Focus may have read the intentional
  // `checking` state before SQLCipher finished; the false -> true transition
  // must request a new status read even when navigation focus never changes.
  useEffect(() => {
    if (!watchStatus) return;
    void refreshCaptureStatus().catch(() => {});
  }, [
    entitlementActive,
    refreshCaptureStatus,
    sharedAccessUnavailable,
    state.captureOptOut,
    state.hydrated,
    state.onboarded,
    watchStatus,
  ]);

  // Returning from Shortcuts does not change navigation focus: Home stays the
  // focused route while the app backgrounds. Refresh status on the lifecycle
  // transition itself so a newly proven automation appears immediately even
  // when the inbox scan below is still inside its freshness throttle.
  useEffect(() => {
    if (!watchStatus) return;
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshCaptureStatus().catch(() => {});
    });
    return () => {
      sub.remove();
      statusRefresh.invalidate();
    };
  }, [refreshCaptureStatus, statusRefresh, watchStatus]);

  // A drain or durable warning can finish just after another mounted surface
  // read status. The signal carries no record data; observers reread status.
  useEffect(() => {
    if (!watchStatus || Platform.OS !== 'ios') return;
    return subscribeIosCaptureStatusRefresh(() => {
      if (ignoreOwnWarningSignal.current) return;
      void refreshCaptureStatus().catch(() => {});
    });
  }, [refreshCaptureStatus, watchStatus]);

  const performAutoImport = useCallback(
    async (interactive: boolean): Promise<AutoImportOutcome> => {
      const state = getStateSnapshot();
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
      let outcome: Awaited<ReturnType<typeof captureExecutor.execute>> | null = null;
      // Android needs the SMS permission before it can read anything. iOS has
      // no permission to ask for — its messages arrive over the relay — so the
      // prompt is skipped there rather than shown and refused.
      if (Platform.OS === 'ios') {
        if (!iosCycleDependencies) return 'unavailable';
        const localCycle = await runIosLocalCaptureCycle(iosCycleDependencies, 'drain');
        const local = localCycle.drain;
        const cfg = await getRelayConfig();
        const relayIntent = iosRelayIntentFor({
          hasRelayConfig: cfg !== null,
          privateMode: getStateSnapshot().privateMode,
        });
        const supplemental = relayIntent
          ? await captureExecutor.execute(relayIntent)
          : null;
        const supplementalSummary = supplemental &&
          (supplemental.kind === 'imported' || supplemental.kind === 'up-to-date')
          ? supplemental
          : null;
        const localChanged = Boolean(local && (local.imported > 0 || local.reviews > 0));
        outcome = {
          kind: localChanged || supplementalSummary?.kind === 'imported'
            ? 'imported' as const
            : 'up-to-date' as const,
          source: supplementalSummary?.source ?? ('none' as const),
          transactions: (local?.imported ?? 0) + (supplementalSummary?.transactions ?? 0),
          dues: supplementalSummary?.dues ?? 0,
          bills: supplementalSummary?.bills ?? 0,
          healed: supplementalSummary?.healed ?? 0,
          newAccounts: supplementalSummary?.newAccounts ?? 0,
          transactionIds: supplementalSummary?.transactionIds ?? [],
          reviewAlerts: (local?.reviews ?? 0) + (supplementalSummary?.reviewAlerts ?? 0),
        };
      } else if (isSmsScanningAvailable()) {
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
        setCaptureState('waiting-for-alert');
      }

      if (Platform.OS !== 'ios') {
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
      }
      if (!outcome) return 'unavailable';
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
    [captureExecutor, getStateSnapshot, iosCycleDependencies, undoBatch, toast, router],
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
      return existing.promise.then((outcome) => {
        if (shouldReplayJoinedAutoImport({ platform: Platform.OS, outcome })) {
          return startAutoImport(true).then(() => undefined);
        }
        if (Platform.OS === 'ios' && outcome === 'up-to-date') {
          toast.show(t('upToDateNoNew'));
        }
        return undefined;
      });
    },
    [startAutoImport, toast],
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
    if (!state.hydrated) return;
    if (Platform.OS !== 'ios' && !state.onboarded) return;
    const captureJustEnabled = previousCaptureOptOut.current && !state.captureOptOut;
    previousCaptureOptOut.current = state.captureOptOut;

    /**
     * @param force ignore the freshness throttle. Only the call below passes
     * it, and only for a ledger with no watermark at all.
     */
    const scan = (force = false) => {
      if (!force && Platform.OS !== 'ios' &&
        Date.now() - lastScanAt < RESCAN_AFTER_MS) return;
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

    if (state.onboarded && !sessionSetupRan) {
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
    iosCaptureStatus,
    recoverIosCaptureQueue: recoverIosCapture,
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
