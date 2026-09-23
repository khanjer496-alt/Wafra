import { Linking, Platform } from 'react-native';

import type {
  WafraLiveCaptureNativeModule,
  WafraLiveCaptureStatus,
} from '../../modules/wafra-live-capture';
import {
  getIosCaptureNativeModule,
  subscribeIosCaptureStatusRefresh,
} from '@/lib/capture';
import {
  IOS_LOCAL_CAPTURE_SHORTCUT_URL,
  iosLocalCaptureTestUrl,
  normalizeIosLocalCaptureShortcutUrl,
} from '@/lib/ios-local-capture-protocol';

import {
  isCaptureTimestamp,
  readIosCaptureHealth,
  type IosCaptureHealth,
} from './ios-capture-health';

export const SHORTCUTS_APP_STORE_URL =
  'https://apps.apple.com/app/shortcuts/id1462947752';

export type IosSetupStage = 'shortcut' | 'automation';
export type IosSetupReadiness =
  | 'not-added'
  | 'shortcut-proven'
  | 'first-alert-captured';
export type IosSetupFailure =
  | 'load'
  | 'shortcut-install'
  | 'shortcut-run'
  | 'shortcuts-missing'
  | null;
export type IosShortcutCallbackResult = 'success' | 'cancel' | 'error';
export type IosFutureSetupStep =
  | 'add-shortcut'
  | 'confirm-shortcut'
  | 'create-automation'
  | 'prove-shortcut'
  | 'ready';

export interface IosMessageAutomationTrigger {
  selectedSenderCount: unknown;
  messageContains: unknown;
}

export interface IosMessageOnboardingCompletionInput {
  retryRequired: boolean;
  ensureDurable(): Promise<void>;
  markFinished(): Promise<void>;
  markStarted(): Promise<void>;
  setOnboarded(): void;
}

export type IosMessageOnboardingCompletionResult = 'complete' | 'retry-required';

export interface IosSetupModel {
  loading: boolean;
  supported: boolean;
  shortcutAvailable: boolean;
  stage: IosSetupStage;
  readiness: IosSetupReadiness;
  opening: boolean;
  failure: IosSetupFailure;
  captureHealth: IosCaptureHealth | null;
  /** Separate proof: an SMS Shortcut check cannot prove notification input. */
  notificationReadiness?: IosSetupReadiness;
  notificationSupported?: boolean;
}

export type IosSetupIntent =
  | { type: 'load' }
  | { type: 'refresh-status' }
  | { type: 'install-shortcut' }
  | { type: 'shortcut-added' }
  | { type: 'check-shortcut' }
  | { type: 'open-automation' }
  | { type: 'automation-added' }
  | { type: 'shortcut-callback'; result: IosShortcutCallbackResult }
  | { type: 'go-to-stage'; stage: IosSetupStage }
  | { type: 'manual-only' }
  | { type: 'open-shortcuts-store' }
  | { type: 'clear-failure' };

export interface IosCaptureSetupController {
  getModel(): IosSetupModel;
  subscribe(listener: (model: IosSetupModel) => void): () => void;
  send(intent: IosSetupIntent): Promise<void>;
  dispose(): void;
}

export interface IosSetupDependencies {
  isSupported(): boolean;
  getNativeModule(): Pick<
    WafraLiveCaptureNativeModule,
    'getCaptureStatus' | 'setCaptureEnabled' | 'notificationCaptureSupported'
  > | null;
  shortcutUrl: string | null;
  canOpenUrl(url: string): Promise<boolean>;
  openUrl(url: string): Promise<void>;
  subscribeCaptureStatus?(listener: () => void): () => void;
}

export interface IosCaptureSetupOptions {
  fromOnboarding?: boolean;
  /** Internal seams for deterministic interface tests. Production omits this. */
  dependencies?: Partial<IosSetupDependencies>;
}

export const INITIAL_IOS_SETUP_MODEL: IosSetupModel = {
  loading: true,
  supported: false,
  shortcutAvailable: false,
  stage: 'shortcut',
  readiness: 'not-added',
  opening: false,
  failure: null,
  captureHealth: null,
  notificationReadiness: 'not-added',
  notificationSupported: false,
};

const iosVersionMajor = (): number => {
  const value = Platform.Version;
  if (typeof value === 'number') return Math.trunc(value);
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function iosSupportsNotificationAutomation(version: unknown): boolean {
  const value = String(version);
  return /^\d+(?:\.\d+)*$/.test(value) && Number(value.split('.')[0]) >= 27;
}

export function resolveIosNotificationReadiness(status: Pick<WafraLiveCaptureStatus,
  'enabled' | 'entitled' | 'notificationSetupProofAt' | 'firstNotificationReceivedAt'>): IosSetupReadiness {
  if (!status.enabled || !status.entitled) return 'not-added';
  // A receipt proves delivery to the protected queue, not a posted transaction.
  return isCaptureTimestamp(status.notificationSetupProofAt) || isCaptureTimestamp(status.firstNotificationReceivedAt)
    ? 'shortcut-proven' : 'not-added';
}

export function resolveIosSelectedReadiness(source: unknown, model: Pick<IosSetupModel,
  'readiness' | 'notificationReadiness'> | null | undefined): IosSetupReadiness {
  return source === 'notification' ? model?.notificationReadiness ?? 'not-added' : model?.readiness ?? 'not-added';
}

// The guided automation. Apple's Sender picker lists Contacts only and bank
// SMS IDs are not Contacts. iOS 26 refuses a Message automation with neither
// filter (Next stays disabled, verified on the owner's iPhone on 25 August and
// 19 September 2026), so the guide asks for a single space in "Message
// Contains": every message with a space matches, and Wafra keeps only
// supported bank alerts on-device.
/** Shortcuts' own route to the New Automation trigger picker. */
export const IOS_CREATE_AUTOMATION_URL = 'shortcuts://create-automation';
const UNFILTERED_MESSAGE_TRIGGER = {
  selectedSenderCount: 0,
  messageContains: ' ',
} as const;

const defaultDependencies = (): IosSetupDependencies => ({
  isSupported: () => Platform.OS === 'ios' && iosVersionMajor() >= 16,
  getNativeModule: getIosCaptureNativeModule,
  shortcutUrl: IOS_LOCAL_CAPTURE_SHORTCUT_URL,
  canOpenUrl: async (url) => Linking.canOpenURL(url),
  openUrl: async (url) => {
    await Linking.openURL(url);
  },
  subscribeCaptureStatus: subscribeIosCaptureStatusRefresh,
});

export function resolveIosSetupReadiness(
  status: Pick<WafraLiveCaptureStatus, 'enabled' | 'setupProofVersion' | 'firstCapturedAt'>,
): IosSetupReadiness {
  if (status.enabled !== true) return 'not-added';
  if (isCaptureTimestamp(status.firstCapturedAt)) return 'first-alert-captured';
  if (status.setupProofVersion === 1) return 'shortcut-proven';
  return 'not-added';
}

/**
 * A Message automation Wafra can process. Zero selected senders is the guided
 * configuration (Apple cannot select bank SMS IDs); explicitly selected
 * Contacts are still accepted. "Message Contains" may be empty or the guided
 * whitespace-only filter, which every bank alert satisfies. A keyword filter
 * is not accepted: it would silently drop alerts without that keyword.
 */
export const isSupportedIosMessageAutomationTrigger = (
  trigger: IosMessageAutomationTrigger,
): boolean =>
  Number.isSafeInteger(trigger.selectedSenderCount) &&
  Number(trigger.selectedSenderCount) >= 0 &&
  (trigger.messageContains === null ||
    (typeof trigger.messageContains === 'string' &&
      trigger.messageContains.length > 0 &&
      trigger.messageContains.trim().length === 0));

export const resolveIosFutureSetupStep = (
  progress: {
    futureShortcutConfirmed: boolean;
    futureAutomationConfirmed: boolean;
    futureStatus: string;
  },
  readiness: IosSetupReadiness,
): IosFutureSetupStep => {
  // Running the no-input Shortcut proves the local action, not the personal
  // Message automation. Keep its instructions until the user confirms them.
  if (readiness !== 'not-added') {
    return progress.futureAutomationConfirmed ? 'ready' : 'create-automation';
  }
  if (!progress.futureShortcutConfirmed) {
    return progress.futureStatus === 'not-started' || progress.futureStatus === 'skipped'
      ? 'add-shortcut'
      : 'confirm-shortcut';
  }
  // Resolve first-run app permissions while Shortcuts is in the foreground.
  // Otherwise the first background trigger may fail before it can ask.
  return 'prove-shortcut';
};

export const completeIosMessageOnboardingAttempt = async (
  input: IosMessageOnboardingCompletionInput,
): Promise<IosMessageOnboardingCompletionResult> => {
  if (!input.retryRequired) await input.ensureDurable();
  await input.markFinished();
  if (!input.retryRequired) input.setOnboarded();
  try {
    await input.ensureDurable();
    return 'complete';
  } catch {
    try {
      await input.markStarted();
    } catch {
      // The caller still blocks exit and keeps retry available when the
      // source-free recovery flag itself cannot be restored immediately.
    }
    return 'retry-required';
  }
};

export function createIosCaptureSetup({
  fromOnboarding = false,
  dependencies: overrides,
}: IosCaptureSetupOptions = {}): IosCaptureSetupController {
  const dependencies = { ...defaultDependencies(), ...overrides };
  const shortcutUrl = normalizeIosLocalCaptureShortcutUrl(dependencies.shortcutUrl);
  const listeners = new Set<(model: IosSetupModel) => void>();
  let model = { ...INITIAL_IOS_SETUP_MODEL };
  let disposed = false;
  let operationGeneration = 0;
  let statusInFlight: Promise<void> | null = null;
  let statusRefreshPending = false;
  let openingInFlight: Promise<void> | null = null;
  let manualOnlyInFlight: Promise<void> | null = null;

  const publish = (patch: Partial<IosSetupModel>): void => {
    if (disposed) return;
    model = { ...model, ...patch };
    for (const listener of listeners) listener(model);
  };

  const readStatusOnce = async (initial: boolean): Promise<void> => {
    const supported = dependencies.isSupported();
    if (!supported) {
      publish({
        loading: false,
        supported: false,
        shortcutAvailable: false,
        readiness: 'not-added',
        captureHealth: null,
        notificationReadiness: 'not-added',
        notificationSupported: false,
        stage: 'shortcut',
        opening: false,
        failure: null,
      });
      return;
    }

    const native = dependencies.getNativeModule();
    if (!native) {
      publish({
        loading: false,
        supported: true,
        shortcutAvailable: false,
        readiness: 'not-added',
        captureHealth: null,
        stage: 'shortcut',
        opening: false,
        failure: 'load',
        notificationReadiness: 'not-added',
        notificationSupported: false,
      });
      return;
    }

    try {
      const status = await native.getCaptureStatus();
      if (disposed) return;
      const readiness = resolveIosSetupReadiness(status);
      const notificationSupported = Platform.OS === 'ios' && iosSupportsNotificationAutomation(Platform.Version) &&
        native.notificationCaptureSupported === true;
      publish({
        loading: false,
        supported: true,
        shortcutAvailable: shortcutUrl !== null,
        readiness,
        captureHealth: readIosCaptureHealth(status),
        notificationSupported,
        notificationReadiness: notificationSupported ? resolveIosNotificationReadiness(status) : 'not-added',
        stage:
          readiness !== 'not-added' || (!initial && model.stage === 'automation')
            ? 'automation'
            : model.stage,
        failure: null,
      });
    } catch {
      publish({
        loading: false,
        supported: true,
        shortcutAvailable: false,
        readiness: 'not-added',
        captureHealth: null,
        failure: 'load',
        notificationReadiness: 'not-added',
        notificationSupported: false,
      });
    }
  };

  const refreshStatus = (initial = false): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (statusInFlight) {
      statusRefreshPending = true;
      return statusInFlight;
    }

    statusInFlight = (async () => {
      let firstRead = initial;
      do {
        statusRefreshPending = false;
        await readStatusOnce(firstRead);
        firstRead = false;
      } while (statusRefreshPending && !disposed);
    })().finally(() => {
      statusInFlight = null;
    });
    return statusInFlight;
  };

  const canUseShortcuts = async (generation: number): Promise<boolean> => {
    try {
      const canOpen = await dependencies.canOpenUrl('shortcuts://');
      return !disposed && generation === operationGeneration && canOpen;
    } catch {
      return false;
    }
  };

  const joinOpening = (operation: (generation: number) => Promise<void>): Promise<void> => {
    if (manualOnlyInFlight) return manualOnlyInFlight;
    if (openingInFlight) return openingInFlight;
    const generation = ++operationGeneration;
    publish({ opening: true, failure: null });

    openingInFlight = operation(generation).finally(() => {
      if (!disposed && generation === operationGeneration) {
        publish({ opening: false });
      }
      openingInFlight = null;
    });
    return openingInFlight;
  };

  const installShortcut = (): Promise<void> => joinOpening(async (generation) => {
    const url = shortcutUrl;
    if (!url) {
      publish({ failure: 'shortcut-install' });
      return;
    }
    // Installing from an iCloud share URL does not require the Shortcuts URL
    // scheme to pass canOpenURL first. On some real devices that probe can
    // return false even though the iCloud share page opens and hands off to
    // Shortcuts correctly. Blocking on it made the onboarding CTA look inert.
    try {
      await dependencies.openUrl(url);
      if (!disposed && generation === operationGeneration) {
        publish({ stage: 'automation', failure: null });
      }
    } catch {
      if (!disposed && generation === operationGeneration) {
        publish({ failure: 'shortcut-install' });
      }
    }
  });

  const openAutomation = (): Promise<void> => joinOpening(async (generation) => {
    if (!(await canUseShortcuts(generation))) {
      if (!disposed && generation === operationGeneration) {
        publish({ failure: 'shortcuts-missing' });
      }
      return;
    }
    // `shortcuts://create-automation` lands on the New Automation trigger
    // picker (one screen away from "Message"), sparing the Automation tab and
    // "+" taps. It is an undocumented but stable Shortcuts route; Apple offers
    // no way to pre-fill a trigger or create the automation itself. Fall back
    // to plainly opening Shortcuts if the route is refused.
    try {
      await dependencies.openUrl(IOS_CREATE_AUTOMATION_URL);
    } catch {
      try {
        await dependencies.openUrl('shortcuts://');
      } catch {
        if (!disposed && generation === operationGeneration) {
          publish({ failure: 'shortcut-run' });
        }
      }
    }
  });

  const checkShortcut = (skipProven = false): Promise<void> => joinOpening(async (generation) => {
    if (skipProven) {
      await refreshStatus();
      if (disposed || generation !== operationGeneration) return;
      if (model.failure === 'load') return;
      if (model.readiness !== 'not-added') return;
    }
    if (!isSupportedIosMessageAutomationTrigger(UNFILTERED_MESSAGE_TRIGGER)) {
      publish({ failure: 'shortcut-run' });
      return;
    }
    if (!(await canUseShortcuts(generation))) {
      if (!disposed && generation === operationGeneration) {
        publish({ failure: 'shortcuts-missing' });
      }
      return;
    }

    const native = dependencies.getNativeModule();
    if (!native) {
      publish({ shortcutAvailable: false, failure: 'load' });
      return;
    }

    try {
      await native.setCaptureEnabled(true);
      if (disposed || generation !== operationGeneration) return;
      await dependencies.openUrl(iosLocalCaptureTestUrl(fromOnboarding));
    } catch {
      if (!disposed && generation === operationGeneration) {
        publish({ failure: 'shortcut-run' });
      }
    }
  });

  const openShortcutsStore = (): Promise<void> => joinOpening(async (generation) => {
    try {
      await dependencies.openUrl(SHORTCUTS_APP_STORE_URL);
    } catch {
      if (!disposed && generation === operationGeneration) {
        publish({ failure: 'shortcut-install' });
      }
    }
  });

  const disableForManualOnly = (): Promise<void> => {
    if (manualOnlyInFlight) return manualOnlyInFlight;
    const openingToSettle = openingInFlight;
    const generation = ++operationGeneration;
    publish({ opening: true, failure: null });

    manualOnlyInFlight = (async () => {
      if (openingToSettle) {
        try {
          await openingToSettle;
        } catch {
          // The safety disable still runs after any failed handoff.
        }
      }
      if (!dependencies.isSupported()) return;
      const native = dependencies.getNativeModule();
      if (!native) return;
      try {
        await native.setCaptureEnabled(false);
      } catch {
        publish({ failure: 'load' });
        throw new Error('ios_capture_disable_failed');
      }
    })().finally(() => {
      if (!disposed && generation === operationGeneration) {
        publish({ opening: false });
      }
      manualOnlyInFlight = null;
    });
    return manualOnlyInFlight;
  };

  const unsubscribeStatus =
    dependencies.subscribeCaptureStatus?.(() => {
      void refreshStatus(false);
    }) ?? (() => {});

  return {
    getModel: () => model,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      listener(model);
      return () => listeners.delete(listener);
    },
    async send(intent) {
      if (disposed) return;
      switch (intent.type) {
        case 'load':
          await refreshStatus(true);
          return;
        case 'refresh-status':
          await refreshStatus(false);
          return;
        case 'install-shortcut':
          await installShortcut();
          return;
        case 'shortcut-added':
          publish({ stage: 'automation', failure: null });
          return;
        case 'check-shortcut':
          await checkShortcut();
          return;
        case 'open-automation':
          await openAutomation();
          return;
        case 'automation-added':
          await checkShortcut(true);
          return;
        case 'shortcut-callback':
          await refreshStatus(false);
          if (intent.result === 'error' && model.failure !== 'load') {
            publish({ failure: 'shortcut-run' });
          }
          return;
        case 'go-to-stage':
          ++operationGeneration;
          publish({ stage: intent.stage, opening: false, failure: null });
          return;
        case 'manual-only':
          await disableForManualOnly();
          return;
        case 'open-shortcuts-store':
          await openShortcutsStore();
          return;
        case 'clear-failure':
          publish({ failure: null });
          return;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      operationGeneration += 1;
      statusRefreshPending = false;
      listeners.clear();
      unsubscribeStatus();
    },
  };
}
