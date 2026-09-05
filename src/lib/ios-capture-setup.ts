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
}

export type IosSetupIntent =
  | { type: 'load' }
  | { type: 'refresh-status' }
  | { type: 'install-shortcut' }
  | { type: 'shortcut-added' }
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
    'getCaptureStatus' | 'setCaptureEnabled'
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
};

const iosVersionMajor = (): number => {
  const value = Platform.Version;
  if (typeof value === 'number') return Math.trunc(value);
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const SENDER_SCOPED_MESSAGE_TRIGGER = {
  selectedSenderCount: 1,
  messageContains: null,
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
  if (!status.enabled) return 'not-added';
  if (status.firstCapturedAt !== null) return 'first-alert-captured';
  if (status.setupProofVersion === 1) return 'shortcut-proven';
  return 'not-added';
}

export const isSupportedIosMessageAutomationTrigger = (
  trigger: IosMessageAutomationTrigger,
): boolean =>
  Number.isSafeInteger(trigger.selectedSenderCount) &&
  Number(trigger.selectedSenderCount) > 0 &&
  trigger.messageContains === null;

export const resolveIosFutureSetupStep = (
  progress: {
    futureShortcutConfirmed: boolean;
    futureAutomationConfirmed: boolean;
    futureStatus: string;
  },
  readiness: IosSetupReadiness,
): IosFutureSetupStep => {
  if (readiness !== 'not-added') return 'ready';
  if (!progress.futureShortcutConfirmed) {
    return progress.futureStatus === 'not-started' || progress.futureStatus === 'skipped'
      ? 'add-shortcut'
      : 'confirm-shortcut';
  }
  if (!progress.futureAutomationConfirmed) return 'create-automation';
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
        stage: 'shortcut',
        opening: false,
        failure: 'load',
      });
      return;
    }

    try {
      const status = await native.getCaptureStatus();
      if (disposed) return;
      const readiness = resolveIosSetupReadiness(status);
      publish({
        loading: false,
        supported: true,
        shortcutAvailable: shortcutUrl !== null,
        readiness,
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
        failure: 'load',
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
    if (!(await canUseShortcuts(generation))) {
      if (!disposed && generation === operationGeneration) {
        publish({ failure: 'shortcuts-missing' });
      }
      return;
    }
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
    try {
      await dependencies.openUrl('shortcuts://');
    } catch {
      if (!disposed && generation === operationGeneration) {
        publish({ failure: 'shortcut-run' });
      }
    }
  });

  const confirmAutomation = (): Promise<void> => joinOpening(async (generation) => {
    if (!isSupportedIosMessageAutomationTrigger(SENDER_SCOPED_MESSAGE_TRIGGER)) {
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
        case 'open-automation':
          await openAutomation();
          return;
        case 'automation-added':
          await confirmAutomation();
          return;
        case 'shortcut-callback':
          await refreshStatus(false);
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
