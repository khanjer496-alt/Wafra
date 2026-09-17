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
 *  - `lastScanAt` — ordinary mounts and ledger updates share a 30s freshness
 *    throttle instead of each screen repeating the same inbox read.
 *  - `sessionSetupRan` — entitlement refresh and reminder sync happen once per
 *    launch, not once per screen that mounts.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState, Linking, Platform } from 'react-native';

import { useToast } from '@/components/ui/toast';
import {
  hasBankNotificationAccess,
  hasBankNotificationSystemAccess,
  hasSmsDeliveryPermission,
  openBankNotificationAccessSettings,
  hasSmsPermission,
  isSmsInboxAccessError,
  isSmsScanningAvailable,
  openSmsPermissionSettings,
  requestSmsDeliveryPermission,
  requestSmsPermission,
  subscribeInboxChanges,
} from '@/lib/auto-import';
import { enableRelayBackgroundSync, setChargeAlertsEnabled } from '@/lib/background-relay';
import {
  getIosCaptureNativeModule,
  isCaptureAvailable,
  publishIosCaptureStatusRefresh,
  subscribeIosCaptureStatusRefresh,
} from '@/lib/capture';
import { createCaptureExecutor, type CaptureLedgerAdapter } from '@/lib/capture-executor';
import { installAndroidLiveCaptureLedger } from '@/lib/android-live-background';
import {
  androidNotificationCaptureEnabled,
  androidSmsCaptureEnabled,
} from '@/lib/android-capture-sources';
import { committed } from '@/lib/haptics';
import { t, tf } from '@/lib/i18n';
import {
  notificationDeliveryAllowed,
  requestNotificationPermission,
  syncDailySummary,
  syncPaymentReminders,
} from '@/lib/notifications';
import { isProActive } from '@/lib/purchases';
import { recordRuntimeOperation } from '@/lib/runtime-performance';
import { bankNotificationAdmissionExpiresAt } from '@/lib/trusted-bank-notification-packages';
import {
  getRelayConfig,
  isLegacyShortcutCaptureActive,
  retireRelayShortcutCapture,
} from '@/lib/relay';
import {
  getSharedIosLocalCaptureCoordinator,
} from '@/lib/ios-local-capture';
import { iosLocalCaptureCatchupUrl } from '@/lib/ios-local-capture-protocol';
import { useStore } from '@/lib/store';
import { isCaptureTimestamp } from '@/lib/ios-capture-health';
import { loadIosMessageSetupProgress } from '@/lib/ios-message-onboarding';
import { createInboxRefreshScheduler } from '@/lib/inbox-refresh-scheduler';
import { waitForForegroundHistoryIdle } from '@/lib/foreground-history-priority';
import type { AppState, IosCaptureWarningState } from '@/lib/types';
import type {
  WafraLiveCaptureNativeModule,
  WafraLiveCaptureStatus,
} from '../../modules/wafra-live-capture';
import NotificationReader from '../../modules/notification-reader';
import SmsReader from '../../modules/sms-reader';

/** The one-time setup that must not repeat: reminders and relay. */
let sessionSetupRan = false;
let androidNotificationAccessPromptShown = false;
let androidSmsLiveAlertPromptShown = false;
// A quick app switch must not reopen/decrypt the unchanged Android bank-app
// queue on every resume. Native `onQueueChanged` edges make fresh rows drain
// immediately while Wafra is alive; the bounded recheck is only a safety net
// for OEMs that suspend/drop that source-free event in background.
const ANDROID_NOTIFICATION_RECHECK_MS = 30_000;
const ANDROID_NOTIFICATION_RECOVERY_GRACE_MS = 10_000;
let androidNotificationDrainRequired = false;
let androidNotificationLastCheckedAt = 0;

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
 * Ordinary mounts and ledger updates can reuse a recent scan. Returning from
 * another app or receiving an Android provider event can mean a new bank
 * message arrived, so those triggers bypass this throttle.
 */
const RESCAN_AFTER_MS = 30_000;
let lastScanAt = 0;
const shouldSkipFreshAndroidResumeScan = (now = Date.now()): boolean =>
  lastScanAt > 0 && now - lastScanAt < RESCAN_AFTER_MS;
// Foregrounding is an interaction-critical transition: Android is restoring
// the window, navigation and input dispatch at the same time. Starting inbox
// bridge/parsing work 250ms later still lands directly in that hot path and is
// visible as the app freezing immediately after it reopens. Provider-change
// signals remain fast; only the lifecycle-triggered catch-up gets a longer
// grace period. A real new SMS received while backgrounded is still picked up
// after this bounded delay (or immediately by a provider event/pull refresh).
const ANDROID_RESUME_SCAN_GRACE_MS = 5_000;
const ANDROID_INITIAL_SCAN_GRACE_MS = 6_000;
const DAILY_SUMMARY_MAINTENANCE_GRACE_MS = 9_000;
// Payment-reminder recurrence analysis is useful background maintenance, not
// launch-critical work. Keep it away from Home's first usable interaction
// window; the projection itself also yields in 2 ms slices on Android.
const SESSION_REMINDER_SYNC_GRACE_MS = 8_000;

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
 * feedback. A completed scan (`'up-to-date'` or `'imported'`) must never be
 * repeated just because an interactive caller joined it: that would reread
 * the same inbox on Android and can duplicate expensive local work. Outcomes
 * that stopped before a completed scan may be replayed interactively so the
 * user still gets the relevant permission/setup/paywall feedback.
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
  futureAutomationConfirmed = false,
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
  futureAutomationConfirmed?: boolean;
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
  if (isCaptureTimestamp(firstCapturedAt)) return 'first-alert-captured';
  // Native proof checks the local action, not the user's Message automation.
  // Keep an actual captured milestone above this self-confirmation requirement.
  if (futureAutomationConfirmed !== true) return 'needs-automation';
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
  outcome,
}: {
  platform: string;
  outcome: AutoImportOutcome;
}): boolean => outcome !== 'imported' && outcome !== 'up-to-date';

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
  liveEvent: boolean;
} | null = null;

export type AutoImport = {
  /** Scan now. `interactive` owns explicit UI; `liveEvent` is a source-backed Android arrival. */
  runAutoImport: (interactive: boolean, liveEvent?: boolean) => Promise<void>;
  /** Drain only the encrypted Android bank-notification queue; never reads SMS. */
  runAndroidNotificationDrain: (liveEvent?: boolean) => Promise<void>;
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
  useEffect(() => {
    // Exactly one mounted owner lends the headless task the live StoreProvider.
    // Pull-to-refresh hooks in the other tabs must not race to replace it.
    if (Platform.OS !== 'android' || !watchForeground) return;
    return installAndroidLiveCaptureLedger(captureLedger);
  }, [captureLedger, watchForeground]);
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
  const syncAndroidNotificationAdmission = useCallback(async (current: AppState): Promise<void> => {
    if (Platform.OS !== 'android') return;
    const { default: reader } = await import('../../modules/notification-reader');
    if (!reader?.setCaptureEnabled) return;
    const smsEnabled = androidSmsCaptureEnabled(current);
    const notificationEnabled = androidNotificationCaptureEnabled(current);
    const leaseEnabled = current.hydrated && current.onboarded &&
      (smsEnabled || notificationEnabled) && isProActive(current);
    const expiresAt = leaseEnabled ? bankNotificationAdmissionExpiresAt(current) : 0;
    if (reader.setSourceConfiguration) {
      await reader.setSourceConfiguration(notificationEnabled && leaseEnabled, expiresAt);
    } else {
      // Older native builds cannot represent SMS-only as a separate lease.
      // Prefer not capturing notifications the user disabled; foreground SMS
      // still works until the native update provides source separation.
      await reader.setCaptureEnabled(
        notificationEnabled && leaseEnabled,
        notificationEnabled && leaseEnabled ? expiresAt : 0,
      );
    }
  }, []);
  const sharedAccessUnavailable = React.useSyncExternalStore(
    subscribeSmsAccess,
    smsAccessSnapshot,
    smsAccessSnapshot,
  );
  const previousCaptureOptOut = useRef(state.captureOptOut);
  const previousEntitlementActive = useRef(entitlementActive);
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
      await syncAndroidNotificationAdmission(current).catch(() => {});
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
      // Failure to read self-confirmation must not retain a stale Ready state
      // or suppress native queue warnings and actual received-alert evidence.
      const setupProgress = await loadIosMessageSetupProgress().catch(() => null);
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
        futureAutomationConfirmed: setupProgress?.futureAutomationConfirmed === true,
        firstCapturedAt: nativeStatus?.firstCapturedAt ?? null,
        pending: nativeStatus?.pending ?? 0,
        dropped: Math.max(nativeStatus?.dropped ?? 0, warning?.dropped ?? 0),
        corrupt: Boolean(nativeStatus?.corrupt || warning?.corrupt),
        retirementPending: isCaptureTimestamp(nativeStatus?.firstCapturedAt) &&
          isLegacyShortcutCaptureActive(cfg),
      }));
      return;
    }
    if (Platform.OS === 'android' && isSmsScanningAvailable()) {
      await syncAndroidNotificationAdmission(current).catch(() => {});
      const granted = await hasSmsPermission().catch(() => false);
      if (!isCurrent()) return;
      // A status-only read can say the permission is absent through this
      // hook's local flag. Reserve the process-wide failure flag for an
      // actual provider/scan failure; otherwise a permission denied behind
      // onboarding survives the later grant and keeps Home falsely off.
      setNeedsPermission(!granted);
      setCaptureState((granted && !sharedAccessUnavailable) || hasBankNotificationAccess()
        ? 'waiting-for-alert' : 'off');
      return;
    }
    if (isCurrent()) setCaptureState('unsupported');
  }, [getStateSnapshot, iosCycleDependencies, iosNative, sharedAccessUnavailable, syncAndroidNotificationAdmission]);
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
  useEffect(() => {
    if (Platform.OS !== 'android' || !state.hydrated) return;
    void syncAndroidNotificationAdmission(getStateSnapshot()).catch(() => {});
  }, [entitlementActive, getStateSnapshot, state.captureOptOut, state.hydrated,
    state.onboarded, syncAndroidNotificationAdmission]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !watchForeground || androidNotificationAccessPromptShown) return;
    const current = getStateSnapshot();
    if (!current.hydrated || !current.onboarded || current.captureOptOut || !isProActive(current)) return;
    if (hasBankNotificationSystemAccess()) return;
    androidNotificationAccessPromptShown = true;
    toast.show(t('notifAccessAutoPrompt'), {
      tone: 'warning',
      actions: [{
        label: t('openSettings'),
        onPress: () => void openBankNotificationAccessSettings().catch(() => { /* The Settings row remains available for retry. */ }),
      }],
    });
  }, [entitlementActive, getStateSnapshot, state.captureOptOut, state.hydrated, state.onboarded, toast, watchForeground]);

  // Older Android builds could have READ_SMS (foreground catch-up works) while
  // lacking RECEIVE_SMS or POST_NOTIFICATIONS (no Wafra alert while the app is
  // away). That exact split looks like capture is healthy until the next app
  // open. Repair existing installs once per JS session with an explicit action
  // rather than silently leaving the native instant-alert preference "on".
  useEffect(() => {
    if (Platform.OS !== 'android' || !watchForeground || androidSmsLiveAlertPromptShown) return;
    const current = getStateSnapshot();
    if (!current.hydrated || !current.onboarded || current.captureOptOut ||
        !isProActive(current) || !androidSmsCaptureEnabled(current)) return;
    try {
      if (SmsReader?.getInstantAlerts?.() === false) return;
    } catch {
      return;
    }
    let cancelled = false;
    void Promise.all([
      hasSmsDeliveryPermission().catch(() => false),
      notificationDeliveryAllowed().catch(() => false),
    ]).then(([deliveryReady, notificationsReady]) => {
      if (cancelled || (deliveryReady && notificationsReady)) return;
      androidSmsLiveAlertPromptShown = true;
      toast.show(t('instantAlertsLivePermissionPrompt'), {
        tone: 'warning',
        actions: [{
          label: t('enableAction'),
          onPress: () => void (async () => {
            const delivery = await requestSmsDeliveryPermission().catch(() => false);
            if (!delivery) return;
            await requestNotificationPermission().catch(() => false);
          })(),
        }],
      });
    });
    return () => { cancelled = true; };
  }, [entitlementActive, getStateSnapshot, state.androidCaptureSources?.sms,
    state.captureOptOut, state.hydrated, state.onboarded, toast, watchForeground]);

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

  const postAndroidImportNotice = useCallback((transactionIds: readonly string[]): void => {
    if (Platform.OS !== 'android' || transactionIds.length === 0 ||
        !NotificationReader?.postImportNotice) return;
    try {
      if (SmsReader?.getInstantAlerts?.() === false) return;
    } catch {
      // Older native builds have no preference reader; default remains on.
    }
    const ids = new Set(transactionIds);
    const rows = getStateSnapshot().transactions.filter(
      (transaction) => ids.has(transaction.id) && transaction.viaPush === true,
    );
    if (rows.length === 0) return;
    const title = rows.length === 1
      ? t('bankPushNoticeTitle')
      : tf('bankPushNoticeGroupTitle', { count: rows.length });
    const body = rows.length === 1
      ? tf('bankPushNoticeBody', { merchant: rows[0].title })
      : tf('bankPushNoticeGroupBody', { count: rows.length });
    try {
      NotificationReader.postImportNotice(title, body);
    } catch {
      // The ledger write is authoritative; a presentation failure is not.
    }
  }, [getStateSnapshot]);

  const showLiveCaptureFeedback = useCallback((count: number): void => {
    if (count <= 0) return;
    committed();
    toast.show(
      count === 1 ? t('liveTransactionAdded') : tf('liveTransactionsAdded', { count }),
      { tone: 'success', durationMs: 3200 },
    );
  }, [toast]);

  const performAutoImport = useCallback(
    async (interactive: boolean, liveEvent = false): Promise<AutoImportOutcome> => {
      const state = getStateSnapshot();
      // Never scan against a ledger that has not finished loading. Every
      // duplicate check in the plan is a lookup against state.transactions,
      // so an unhydrated store means nothing matches and the entire inbox
      // imports as new — on top of the rows that arrive a moment later.
      if (!state.hydrated) {
        if (interactive) toast.show(t('stillLoading'));
        return 'not-hydrated';
      }
      // Re-evaluate expiry on every foreground attempt, even if React state
      // did not change while the app was closed.
      await syncAndroidNotificationAdmission(state).catch(() => {});
      // The first-history owner reads bounded pages from a durable cursor.
      // Running the incremental scanner beside it would parse the same inbox
      // against a competing ledger snapshot and could advance lastScanTs past
      // history the page coordinator has not committed yet.
      const historyRunning = state.historyImport && state.historyImport.status !== 'complete';
      if (historyRunning && Platform.OS !== 'android') {
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
      const smsSourceEnabled = Platform.OS !== 'android' || androidSmsCaptureEnabled(state);
      const notificationSourceEnabled = Platform.OS === 'android' && androidNotificationCaptureEnabled(state);
      if (Platform.OS === 'android' && !smsSourceEnabled && !notificationSourceEnabled) {
        return 'unavailable';
      }
      if (historyRunning && Platform.OS === 'android' &&
        !(notificationSourceEnabled && hasBankNotificationAccess())) {
        return 'history-import-running';
      }
      let outcome: Awaited<ReturnType<typeof captureExecutor.execute>> | null = null;
      let notificationOnly = false;
      // SMS and bank-app notifications have separate Android permissions.
      // A user with Notification access can process push alerts without
      // granting Wafra access to the SMS inbox.
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
        let granted = smsSourceEnabled ? await hasSmsPermission() : false;
        const notificationAccess = notificationSourceEnabled && hasBankNotificationAccess();
        if (smsSourceEnabled && !granted && !notificationAccess && interactive) {
          granted = await requestSmsPermission();
        }
        if (historyRunning && granted && !notificationAccess) return 'history-import-running';
        if (!granted && !notificationAccess) {
          setSharedSmsAccessUnavailable(smsSourceEnabled);
          setNeedsPermission(smsSourceEnabled);
          setCaptureState('off');
          if (interactive && smsSourceEnabled) {
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
        notificationOnly = !granted || Boolean(historyRunning && notificationAccess);
        setNeedsPermission(smsSourceEnabled && !granted);
        setCaptureState('waiting-for-alert');
      }

      if (Platform.OS !== 'ios') {
        try {
          outcome = await captureExecutor.execute(notificationOnly ? 'notification-only' : 'routine');
        } catch (error) {
          if (!isSmsInboxAccessError(error)) throw error;
          setSharedSmsAccessUnavailable(true);
          setNeedsPermission(true);
          if (notificationSourceEnabled && hasBankNotificationAccess()) {
            // A restricted SMS provider must not strand the independent,
            // encrypted bank-app queue or advance the SMS cursor.
            notificationOnly = true;
            outcome = await captureExecutor.execute('notification-only');
            setCaptureState('waiting-for-alert');
          } else {
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
      }
      if (!outcome) return 'unavailable';
      if (!notificationOnly) setSharedSmsAccessUnavailable(false);
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
      // A routine Android SMS scan also drains the encrypted bank-app queue.
      // If it wins the race against the dedicated queue listener, it still owns
      // posting Wafra's confirmed bank-app notification after the durable write.
      if (Platform.OS === 'android') postAndroidImportNotice(outcome.transactionIds);
      // Source-free launch/resume maintenance stays quiet, but an actual live
      // Android provider edge should feel immediate once the durable row lands.
      if (liveEvent && !interactive) {
        showLiveCaptureFeedback(outcome.transactions);
      } else if (interactive) {
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
      }
      return 'imported';
    },
    [captureExecutor, getStateSnapshot, iosCycleDependencies, syncAndroidNotificationAdmission,
      undoBatch, toast, router, postAndroidImportNotice, showLiveCaptureFeedback],
  );

  // The single owner of `importInFlight`. Always starts a fresh scan — callers
  // that should instead join one already running go through `runAutoImport`.
  const startAutoImport = useCallback(
    (interactive: boolean, liveEvent = false): Promise<AutoImportOutcome> => {
      const startedAt = Date.now();
      const operation = performAutoImport(interactive, liveEvent).finally(() => {
        recordRuntimeOperation('auto-import', Date.now() - startedAt);
        if (importInFlight?.promise === operation) importInFlight = null;
      });
      importInFlight = { promise: operation, interactive, liveEvent };
      return operation;
    },
    [performAutoImport],
  );

  const runAutoImport = useCallback(
    (interactive: boolean, liveEvent = false): Promise<void> => {
      // iOS cannot grant Wafra direct Messages-database access. For an explicit
      // refresh, hand control to the installed Local Capture Shortcut's
      // no-input recovery branch. It rereads a bounded newest-message overlap
      // and stages rows using the same SHA-256(Message.GUID) identities as the
      // live automation. Its x-callback returns to Wafra, where the foreground
      // listener below drains both the old pending queue and recovered rows.
      // Silent foreground scans never launch Shortcuts, so resume cannot loop.
      if (interactive && Platform.OS === 'ios') {
        return Linking.openURL(iosLocalCaptureCatchupUrl())
          .then(() => undefined)
          .catch(() => startAutoImport(true).then(() => undefined));
      }
      const existing = importInFlight;
      if (!existing) return startAutoImport(interactive, liveEvent).then(() => undefined);
      // Two silent callers, or an interactive caller joining another
      // interactive one already in flight: the one running owns delivering
      // whatever feedback applies, same as before.
      if (!interactive) {
        if (!liveEvent || existing.interactive || existing.liveEvent) {
          return existing.promise.then(() => undefined);
        }
        return existing.promise.then(async (outcome) => {
          const followUp = await startAutoImport(false, true);
          if (followUp !== 'imported' && outcome === 'imported') showLiveCaptureFeedback(1);
        });
      }
      if (existing.interactive) return existing.promise.then(() => undefined);
      // An explicit action (pull-to-refresh, tapping the capture card) joined
      // a scan nobody was watching. That scan only ever ran its `interactive`
      // branches as false, so a permission prompt, a paywall/setup redirect,
      // or the up-to-date toast never fired — the user's tap would otherwise
      // get no feedback at all. None of those outcomes did any actual
      // reading or importing, so re-running interactively is a fresh first
      // attempt for this request, not a second scan of the same data. The one
      // completed scans (`'up-to-date'` and `'imported'`) are never re-run.
      // `'imported'` already toasts unconditionally; an iOS joined
      // `'up-to-date'` gets the explicit toast below.
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
    [showLiveCaptureFeedback, startAutoImport, toast],
  );

  const runAndroidNotificationDrain = useCallback(async (liveEvent = false): Promise<void> => {
    if (Platform.OS !== 'android') return;

    // Notification capture is independent from the SMS inbox. A recent SMS
    // scan must never make the encrypted push queue look "fresh". Serialize
    // behind any scan already mutating the ledger, then claim the same import
    // lane for this lightweight notification-only pass.
    const beforePushIds = liveEvent
      ? new Set(getStateSnapshot().transactions.filter((transaction) => transaction.viaPush === true)
        .map((transaction) => transaction.id))
      : null;
    const existing = importInFlight?.promise;
    if (existing) await existing.catch(() => {});
    if (importInFlight) return;
    const pushRowsImportedByExisting = beforePushIds
      ? getStateSnapshot().transactions.filter(
        (transaction) => transaction.viaPush === true && !beforePushIds.has(transaction.id),
      ).length
      : 0;

    const current = getStateSnapshot();
    if (!current.hydrated || !current.onboarded || current.captureOptOut ||
      !androidNotificationCaptureEnabled(current) || !isProActive(current) ||
      !hasBankNotificationAccess()) return;
    if (!androidNotificationDrainRequired) return;

    await syncAndroidNotificationAdmission(current).catch(() => {});
    const drainStartedAt = Date.now();
    // Clear the edge BEFORE reading. If another notification lands while this
    // drain is in flight, onQueueChanged sets it back to true and the coalesced
    // scheduler performs one more pass after this one. Clearing on completion
    // loses exactly that race.
    androidNotificationDrainRequired = false;
    const operation = captureExecutor.execute('notification-only')
      .then<AutoImportOutcome>((outcome) => {
        if (outcome.kind === 'not-hydrated') return 'not-hydrated';
        if (outcome.kind === 'needs-setup') return 'needs-setup';
        androidNotificationLastCheckedAt = Date.now();
        if (outcome.kind === 'imported') {
          postAndroidImportNotice(outcome.transactionIds);
          if (liveEvent) showLiveCaptureFeedback(outcome.transactions);
          return 'imported';
        }
        if (liveEvent && pushRowsImportedByExisting > 0) {
          showLiveCaptureFeedback(pushRowsImportedByExisting);
        }
        return 'up-to-date';
      })
      .catch((error) => {
        // Failure is not evidence the queue is empty. Keep the recovery edge
        // armed for the next delayed pass.
        androidNotificationDrainRequired = true;
        throw error;
      })
      .finally(() => {
        recordRuntimeOperation('notification-drain', Date.now() - drainStartedAt);
        if (importInFlight?.promise === operation) importInFlight = null;
      });
    importInFlight = { promise: operation, interactive: false, liveEvent };
    await operation;
  }, [captureExecutor, getStateSnapshot, postAndroidImportNotice, showLiveCaptureFeedback,
    syncAndroidNotificationAdmission]);

  // Android's NotificationListenerService emits onQueueChanged while JS is
  // alive; that path below drains immediately. Cold launch/resume can miss that
  // edge, but recovery must never blindly decrypt the queue in the first Home
  // frames. Wait for an idle grace window, inspect only the plaintext envelope
  // count, and touch AndroidKeyStore only when a queue actually exists.
  useEffect(() => {
    if (!watchForeground || Platform.OS !== 'android' || !state.hydrated ||
      !state.onboarded || !androidNotificationCaptureEnabled(state) || !entitlementActive) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!mounted || RNAppState.currentState !== 'active') return;
        void (async () => {
          await waitForForegroundHistoryIdle();
          if (!mounted || RNAppState.currentState !== 'active') return;
          // Notification access can remain granted while some Android OEMs
          // kill the listener service. Repair only that disconnected state;
          // the native method is otherwise a no-op and never scans the shade.
          if (hasBankNotificationAccess()) {
            await NotificationReader?.ensureListenerConnected?.().catch(() => false);
          }
          if (!androidNotificationDrainRequired) {
            const now = Date.now();
            if (now - androidNotificationLastCheckedAt < ANDROID_NOTIFICATION_RECHECK_MS) return;
            const pending = await NotificationReader?.getPendingCount?.().catch(() => 0) ?? 0;
            androidNotificationLastCheckedAt = Date.now();
            if (pending <= 0) return;
            androidNotificationDrainRequired = true;
          }
          await runAndroidNotificationDrain();
        })().catch(() => {});
      }, ANDROID_NOTIFICATION_RECOVERY_GRACE_MS);
    };
    schedule();
    const subscription = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') schedule();
      else if (timer !== null) { clearTimeout(timer); timer = null; }
    });
    return () => {
      mounted = false;
      if (timer !== null) clearTimeout(timer);
      subscription.remove();
    };
  }, [entitlementActive, runAndroidNotificationDrain, state.captureOptOut,
    state.androidCaptureSources?.notifications,
    state.hydrated, state.onboarded, watchForeground]);

  // Truly live bank-app capture while Wafra is already open. The native
  // listener emits no bank data here — only a source-free queue-changed edge.
  // The encrypted queue is then drained through the same parser/durable commit
  // boundary used by resume recovery. Bursts coalesce, and no SMS/provider or
  // full notification-shade scan is performed.
  useEffect(() => {
    if (!watchForeground || Platform.OS !== 'android' || !state.hydrated ||
      !state.onboarded || !androidNotificationCaptureEnabled(state) || !entitlementActive ||
      !NotificationReader?.addListener) return;
    let mounted = true;
    const canDrain = () => {
      const current = getStateSnapshot();
      return mounted && RNAppState.currentState === 'active' && current.hydrated &&
        current.onboarded && androidNotificationCaptureEnabled(current) && isProActive(current) &&
        hasBankNotificationAccess();
    };
    const scheduler = createInboxRefreshScheduler(async () => {
      // Let the drain own the join so it can detect whether a scan already in
      // flight consumed this viaPush arrival and still acknowledge it.
      if (canDrain()) await runAndroidNotificationDrain(true);
    }, canDrain);
    let subscription: { remove(): void } | null = null;
    try {
      subscription = NotificationReader.addListener('onQueueChanged', () => {
        androidNotificationDrainRequired = true;
        scheduler.request();
      });
    } catch {
      scheduler.dispose();
      return;
    }
    return () => {
      mounted = false;
      subscription?.remove();
      scheduler.dispose();
    };
  }, [entitlementActive, getStateSnapshot, runAndroidNotificationDrain, state.captureOptOut,
    state.androidCaptureSources?.notifications,
    state.hydrated, state.onboarded, watchForeground]);

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

  useEffect(() => {
    if (!watchForeground || Platform.OS !== 'android' || !state.hydrated ||
      !state.onboarded || !androidSmsCaptureEnabled(state) || !entitlementActive) return;
    let mounted = true;
    let providerHintPending = false;
    const canScan = () => {
      const current = getStateSnapshot();
      return mounted && RNAppState.currentState === 'active' && current.hydrated &&
        current.onboarded && androidSmsCaptureEnabled(current) && isProActive(current);
    };
    const scheduler = createInboxRefreshScheduler(async () => {
      // Clear only when the queued source evidence actually enters the scan
      // lane. A hint received while backgrounded must survive until resume.
      providerHintPending = false;
      // Let runAutoImport own the join so a provider edge that races an
      // already-running silent scan still gets a bounded follow-up and feedback.
      if (canScan()) await latestScan.current(false, true);
    }, canScan);
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    // The native observer checks permission only when it starts. Recreate it
    // after a denied permission is restored; foreground checks stay available
    // while it is denied so returning from Settings can recover capture.
    const unsubscribe = needsPermission ? () => {} : subscribeInboxChanges(() => {
      providerHintPending = true;
      scheduler.request();
    });
    const foreground = RNAppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        if (resumeTimer !== null) {
          clearTimeout(resumeTimer);
          resumeTimer = null;
        }
        return;
      }
      // Real provider evidence outranks the source-free freshness throttle. If
      // it arrived while Wafra was backgrounded, re-arm the scheduler now that
      // canScan() is true instead of silently stranding the pending edge.
      if (providerHintPending) {
        scheduler.request();
        return;
      }
      // A quick app switch after a completed scan has no new source evidence.
      // Do not schedule an expensive safety reread just because Android emitted
      // another lifecycle edge; the native inbox-change listener still fires
      // immediately if a message actually arrived while Wafra was away.
      if (shouldSkipFreshAndroidResumeScan()) return;
      // Do not compete with Android's first resumed frames. The provider
      // listener above still requests immediately when there is actual inbox
      // evidence, so this delay applies only to the source-free safety catch-up.
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        void waitForForegroundHistoryIdle().then(() => {
          if (canScan()) scheduler.request();
        });
      }, ANDROID_RESUME_SCAN_GRACE_MS);
    });
    return () => {
      mounted = false;
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      unsubscribe();
      foreground.remove();
      scheduler.dispose();
    };
  // `state.historyImport` is deliberately NOT a dependency: the effect reads
  // live state through `getStateSnapshot()`, and the progress object is
  // replaced on every committed page, so listing it tore down and recreated
  // the native inbox observer, the AppState listener and the scheduler every
  // ~500ms for the whole of a history import.
  }, [entitlementActive, getStateSnapshot, needsPermission, state.captureOptOut,
    state.androidCaptureSources?.sms,
    state.hydrated, state.onboarded, watchForeground]);

  // The native signal carries no source data and is only a foreground hint.
  // The same serialized drain, parser and durable-save-before-ACK boundary do
  // the work; launch/resume below reconciles signals missed while suspended.
  useEffect(() => {
    if (!watchForeground || Platform.OS !== 'ios' ||
      iosNative?.queueChangeEventsSupported !== true || !iosNative.addListener) return;
    let mounted = true;
    const canScan = () => {
      const current = getStateSnapshot();
      return mounted && RNAppState.currentState === 'active' && current.hydrated &&
        !current.captureOptOut && isProActive(current) &&
        (!current.historyImport || current.historyImport.status === 'complete');
    };
    const scheduler = createInboxRefreshScheduler(async () => {
      // A signal may arrive after another scan read its final native page.
      // Joining that scan alone would lose the wake-up. Wait, then reread.
      const ongoing = importInFlight?.promise;
      if (ongoing) await ongoing.catch(() => {});
      if (canScan()) await latestScan.current(false);
    }, canScan);
    const subscription = iosNative.addListener('onQueueChanged', () => scheduler.request());
    return () => {
      mounted = false;
      subscription.remove();
      scheduler.dispose();
    };
  }, [getStateSnapshot, iosNative, watchForeground]);

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
    const entitlementJustActivated = !previousEntitlementActive.current && entitlementActive;
    // A restored entitlement owes one scan, even within the 30s throttle.
    // Keep that transition pending while the history owner prevents scanning.
    // Revocation always clears it; it must never authorize a later scan.
    if (!entitlementActive || !state.historyImport || state.historyImport.status === 'complete') {
      previousEntitlementActive.current = entitlementActive;
    }

    /**
     * @param force ignore the freshness throttle for a reset ledger or
     * renewed eligibility. Android foreground returns use the scheduler above.
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
     * foreground-resume path, and a rebuild that does import moves the
     * watermark off 0 — which re-runs this effect once more into a throttle
     * that was just stamped.
     */
    // Do not stamp the freshness throttle for a scan that the durable opt-out
    // will refuse. When capture is explicitly enabled again, force the first
    // real scan even if another scan happened less than 30 seconds earlier.
    let initialScanTimer: ReturnType<typeof setTimeout> | null = null;
    let initialScanCancelled = false;
    if (!state.captureOptOut && entitlementActive) {
      const force = state.lastScanTs <= 0 || captureJustEnabled || entitlementJustActivated;
      if (Platform.OS === 'android') {
        initialScanTimer = setTimeout(() => {
          void waitForForegroundHistoryIdle().then(() => {
            if (!initialScanCancelled && RNAppState.currentState === 'active') scan(force);
          });
        }, ANDROID_INITIAL_SCAN_GRACE_MS);
      } else {
        scan(force);
      }
    }

    if (state.onboarded && !sessionSetupRan) {
      sessionSetupRan = true;
      void (async () => {
        try {
          await enableRelayBackgroundSync();
          await waitForForegroundHistoryIdle(SESSION_REMINDER_SYNC_GRACE_MS);
          const current = getStateSnapshot();
          if (!current.hydrated || !current.onboarded) return;
          // Never prompt on launch. Reminder/instant-alert surfaces ask only
          // after the user explicitly enables them; this call is a no-op when
          // notification authorization has not already been granted.
          await syncPaymentReminders(current);
        } catch {
          // Reminders are best-effort; the ledger does not depend on them.
        }
      })();
    }

    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active' && Platform.OS !== 'android') scan();
    });
    return () => {
      initialScanCancelled = true;
      if (initialScanTimer !== null) clearTimeout(initialScanTimer);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entitlementActive,
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
  // While a history import is committing pages, every page replaces the
  // transaction array; rescheduling the digest (a permission query, a channel
  // write, a full-ledger summary and a native schedule call) per page is
  // wasted work that competes with the import itself. The completing page
  // changes `historyImportRunning` back and schedules once with the final
  // ledger.
  const historyImportRunning = state.historyImport?.status === 'running';
  useEffect(() => {
    if (!watchForeground || !state.hydrated || !state.onboarded || !state.dailySummary) return;
    if (historyImportRunning) return;
    let cancelled = false;
    void (async () => {
      await waitForForegroundHistoryIdle(DAILY_SUMMARY_MAINTENANCE_GRACE_MS);
      if (cancelled || RNAppState.currentState !== 'active') return;
      const current = getStateSnapshot();
      if (!current.hydrated || !current.onboarded || !current.dailySummary ||
          current.historyImport?.status === 'running') return;
      const startedAt = Date.now();
      try {
        await syncDailySummary(current);
      } catch {
        // A digest is never worth surfacing an error over.
      } finally {
        recordRuntimeOperation('daily-summary', Date.now() - startedAt);
      }
    })();
    return () => { cancelled = true; };
  }, [getStateSnapshot, historyImportRunning, state.dailySummary, state.hydrated, state.onboarded,
    state.transactions, watchForeground]);

  return {
    runAutoImport,
    runAndroidNotificationDrain,
    needsPermission: (needsPermission || sharedAccessUnavailable) &&
      !(Platform.OS === 'android' && hasBankNotificationAccess()),
    captureState: sharedAccessUnavailable &&
      !(Platform.OS === 'android' && hasBankNotificationAccess()) ? 'off' : captureState,
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
