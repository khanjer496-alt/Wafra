import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Linking, Platform } from 'react-native';

import {
  disableRelayBackgroundSync,
  enableRelayBackgroundSync,
} from '@/lib/background-relay';
import {
  createCaptureExecutor,
  type CaptureExecutor,
  type CaptureLedgerAdapter,
} from '@/lib/capture-executor';
import { requestSilentCapturePermission } from '@/lib/notifications';
import {
  DEFAULT_RELAY_URL,
  DEFAULT_SHORTCUT_URL,
  getRelayConfig,
  markRelayConfigured,
  pairDevice,
  RelayError,
  unpairDevice,
  type RelayConfig,
} from '@/lib/relay';
import { shortcutSetupCode, shortcutTestUrl } from '@/lib/relay-protocol';

export type IosSetupStep = 0 | 1 | 2 | 3;
export type IosSetupRecovery = 'settings' | 'shortcut' | null;
export type IosSetupCopyTarget = 'setup' | 'url' | 'token';
export type IosSetupFailure =
  | 'load'
  | 'relay-unavailable'
  | 'connect'
  | 'connect-rate-limited'
  | 'connect-unauthorized'
  | 'connect-device-limit'
  | 'disconnect'
  | 'shortcut-install'
  | 'shortcuts-open'
  | 'shortcut-run'
  | 'push-permission'
  | 'push-registration'
  | 'configure'
  | 'not-hydrated';

export interface IosSetupModel {
  loading: boolean;
  relayAvailable: boolean;
  shortcutAvailable: boolean;
  step: IosSetupStep;
  paired: boolean;
  captureOn: boolean;
  pairing: boolean;
  disconnecting: boolean;
  preparing: boolean;
  listening: boolean;
  timedOut: boolean;
  askPrivateMode: boolean;
  copied: IosSetupCopyTarget | null;
  ingestUrl: string | null;
  tokenPreview: string | null;
  captured: { merchant: string; isTest: boolean } | null;
  failure: IosSetupFailure | null;
  recovery: IosSetupRecovery;
}

export type IosSetupIntent =
  | { type: 'load' }
  | { type: 'connect' }
  | { type: 'confirm-private-mode' }
  | { type: 'cancel-private-mode' }
  | { type: 'disconnect' }
  | { type: 'copy'; target: IosSetupCopyTarget }
  | { type: 'install-shortcut' }
  | { type: 'shortcut-installed' }
  | { type: 'open-automation' }
  | { type: 'automation-ready' }
  | { type: 'start-test' }
  | { type: 'go-to-step'; step: IosSetupStep }
  | { type: 'clear-failure' }
  | { type: 'open-settings' };

export interface IosCaptureSetupController {
  getModel(): IosSetupModel;
  subscribe(listener: (model: IosSetupModel) => void): () => void;
  send(intent: IosSetupIntent): Promise<void>;
  dispose(): void;
}

interface Clock {
  now(): number;
  set(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clear(timer: ReturnType<typeof setTimeout>): void;
}

interface IosSetupDependencies {
  isWeb: boolean;
  relayUrl: string | null;
  shortcutUrl: string | null;
  getConfig(): Promise<RelayConfig | null>;
  pair(baseUrl: string): Promise<RelayConfig>;
  markConfigured(config: RelayConfig): Promise<RelayConfig>;
  unpair(config: RelayConfig): Promise<void>;
  requestSilentPermission(): Promise<boolean>;
  enableBackground(config: RelayConfig): Promise<boolean>;
  disableBackground(): Promise<void>;
  writeClipboard(value: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  openSettings(): Promise<void>;
  successHaptic(): Promise<void>;
  selectionHaptic(): Promise<void>;
  clock: Clock;
}

export interface IosCaptureSetupOptions {
  ledger: CaptureLedgerAdapter;
  leavePrivateMode: () => Promise<void>;
  captureExecutor?: CaptureExecutor;
  /** Internal seams for deterministic interface tests. Production omits this. */
  dependencies?: Partial<IosSetupDependencies>;
  pollMs?: number;
  timeoutMs?: number;
}

export const INITIAL_IOS_SETUP_MODEL: IosSetupModel = {
  loading: true,
  relayAvailable: false,
  shortcutAvailable: false,
  step: 0,
  paired: false,
  captureOn: false,
  pairing: false,
  disconnecting: false,
  preparing: false,
  listening: false,
  timedOut: false,
  askPrivateMode: false,
  copied: null,
  ingestUrl: null,
  tokenPreview: null,
  captured: null,
  failure: null,
  recovery: null,
};

const defaultClock: Clock = {
  now: () => Date.now(),
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (timer) => clearTimeout(timer),
};

const defaultDependencies = (): IosSetupDependencies => ({
  isWeb: Platform.OS === 'web',
  relayUrl: DEFAULT_RELAY_URL,
  shortcutUrl: DEFAULT_SHORTCUT_URL,
  getConfig: getRelayConfig,
  pair: pairDevice,
  markConfigured: markRelayConfigured,
  unpair: unpairDevice,
  requestSilentPermission: requestSilentCapturePermission,
  enableBackground: enableRelayBackgroundSync,
  disableBackground: disableRelayBackgroundSync,
  writeClipboard: async (value) => {
    await Clipboard.setStringAsync(value);
  },
  openUrl: Linking.openURL,
  openSettings: Linking.openSettings,
  successHaptic: async () => {
    if (Platform.OS !== 'web') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  },
  selectionHaptic: async () => {
    if (Platform.OS !== 'web') await Haptics.selectionAsync();
  },
  clock: defaultClock,
});

const connectFailure = (error: unknown): IosSetupFailure => {
  if (!(error instanceof RelayError)) return 'connect';
  if (error.code === 'rate_limited') return 'connect-rate-limited';
  if (error.code === 'unauthorized') return 'connect-unauthorized';
  if (error.code === 'device_limit') return 'connect-device-limit';
  return 'connect';
};

export const createIosCaptureSetup = ({
  ledger,
  leavePrivateMode,
  captureExecutor = createCaptureExecutor({ ledger }),
  dependencies: overrides,
  pollMs = 2_500,
  timeoutMs = 120_000,
}: IosCaptureSetupOptions): IosCaptureSetupController => {
  const dependencies = { ...defaultDependencies(), ...overrides };
  const listeners = new Set<(model: IosSetupModel) => void>();
  let model = {
    ...INITIAL_IOS_SETUP_MODEL,
    relayAvailable: Boolean(dependencies.relayUrl),
    shortcutAvailable: Boolean(dependencies.shortcutUrl),
  };
  let config: RelayConfig | null = null;
  let sensitiveCopyPending = false;
  let disposed = false;
  let attempt = 0;
  let startedAt = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  const publish = (patch: Partial<IosSetupModel>): void => {
    if (disposed) return;
    model = { ...model, ...patch };
    for (const listener of listeners) listener(model);
  };

  const safeConfig = (active: RelayConfig | null): Partial<IosSetupModel> => ({
    paired: active !== null,
    captureOn: active?.setupState === 'verified',
    ingestUrl: active?.ingestUrl ?? null,
    tokenPreview: active
      ? `${active.ingestToken.slice(0, 10)}···${active.ingestToken.slice(-6)}`
      : null,
  });

  const clearPoll = (): void => {
    attempt += 1;
    if (pollTimer) dependencies.clock.clear(pollTimer);
    pollTimer = null;
  };

  const clearFailure = (): void => publish({ failure: null, recovery: null });

  const fail = (failure: IosSetupFailure, recovery: IosSetupRecovery = null): void => {
    publish({ failure, recovery, preparing: false });
  };

  const clearSensitiveClipboard = async (): Promise<void> => {
    if (!sensitiveCopyPending) return;
    try {
      await dependencies.writeClipboard('');
      sensitiveCopyPending = false;
    } catch {
      // Best effort. The same credential remains in the installed Shortcut.
    }
  };

  const setCopied = (target: IosSetupCopyTarget): void => {
    if (copiedTimer) dependencies.clock.clear(copiedTimer);
    publish({ copied: target });
    copiedTimer = dependencies.clock.set(() => {
      copiedTimer = null;
      if (model.copied === target) publish({ copied: null });
    }, 2_000);
  };

  const copy = async (target: IosSetupCopyTarget): Promise<void> => {
    if (!config) return;
    const value = target === 'setup'
      ? shortcutSetupCode(config.ingestUrl, config.ingestToken)
      : target === 'url'
        ? config.ingestUrl
        : config.ingestToken;
    const sensitive = target === 'setup' || target === 'token';
    if (sensitive) sensitiveCopyPending = true;
    await dependencies.writeClipboard(value);
    if (disposed) {
      if (sensitive) {
        await dependencies.writeClipboard('').catch(() => {});
        sensitiveCopyPending = false;
      }
      return;
    }
    setCopied(target);
    dependencies.selectionHaptic().catch(() => {});
  };

  const ensureSilentDelivery = async (): Promise<boolean> => {
    if (!config) return false;
    if (!(await dependencies.requestSilentPermission())) {
      fail('push-permission', 'settings');
      return false;
    }
    if (!(await dependencies.enableBackground(config))) {
      fail('push-registration');
      return false;
    }
    clearFailure();
    return true;
  };

  const stopVerification = (patch: Partial<IosSetupModel> = {}): void => {
    clearPoll();
    publish({ listening: false, timedOut: false, captured: null, preparing: false, ...patch });
  };

  const schedulePoll = (generation: number): void => {
    if (generation !== attempt || disposed) return;
    if (dependencies.clock.now() - startedAt > timeoutMs) {
      publish({ listening: false, timedOut: true });
      return;
    }
    pollTimer = dependencies.clock.set(() => void poll(generation), pollMs);
  };

  const poll = async (generation: number): Promise<void> => {
    try {
      const outcome = await captureExecutor.execute('setup-verification');
      if (generation !== attempt || disposed) return;
      if (outcome.kind === 'setup-observed') {
        if (config) {
          config = { ...config, setupState: 'verified', verifiedAt: outcome.verifiedAt };
        }
        publish({
          listening: false,
          timedOut: false,
          captured: { merchant: outcome.merchant, isTest: outcome.isTest },
          captureOn: true,
        });
        dependencies.successHaptic().catch(() => {});
        return;
      }
      if (outcome.kind === 'needs-setup') {
        config = null;
        stopVerification({ step: 0, ...safeConfig(null) });
        return;
      }
      if (outcome.kind === 'not-hydrated') {
        stopVerification();
        fail('not-hydrated');
        return;
      }
    } catch {
      // A flaky minute on mobile data does not end verification.
    }
    schedulePoll(generation);
  };

  const startTest = async (): Promise<void> => {
    if (!config || model.listening) return;
    clearPoll();
    const generation = attempt;
    clearFailure();
    startedAt = dependencies.clock.now();
    publish({ step: 3, captured: null, timedOut: false, listening: true });
    if (!dependencies.isWeb) {
      try {
        await dependencies.openUrl(shortcutTestUrl());
      } catch {
        if (generation !== attempt || disposed) return;
        stopVerification();
        fail('shortcut-run', 'shortcut');
        return;
      }
    }
    void poll(generation);
  };

  const load = async (): Promise<void> => {
    publish({ loading: true, failure: null, recovery: null });
    try {
      const existing = await dependencies.getConfig();
      if (disposed) return;
      config = existing;
      publish({
        loading: false,
        step: existing ? existing.setupState === 'paired' ? 1 : 3 : 0,
        ...safeConfig(existing),
      });
    } catch {
      fail('load');
      publish({ loading: false });
    }
  };

  const connect = async (ignorePrivateMode = false): Promise<void> => {
    if (model.loading || model.pairing || config) return;
    if (!ignorePrivateMode && ledger.getState().privateMode) {
      publish({ askPrivateMode: true });
      return;
    }
    if (!dependencies.relayUrl) {
      fail('relay-unavailable');
      return;
    }
    publish({ pairing: true, failure: null, recovery: null });
    try {
      const paired = await dependencies.pair(dependencies.relayUrl);
      if (disposed) {
        // pair() has already persisted the identity. Best-effort cleanup keeps
        // a screen dismissal from leaving a hidden device behind.
        await dependencies.unpair(paired).catch(() => {});
        return;
      }
      config = paired;
      publish({ pairing: false, step: 1, ...safeConfig(paired) });
      dependencies.successHaptic().catch(() => {});
    } catch (error) {
      publish({ pairing: false });
      fail(connectFailure(error));
    }
  };

  const disconnect = async (): Promise<void> => {
    if (!config || model.disconnecting) return;
    const active = config;
    stopVerification();
    publish({ disconnecting: true, failure: null, recovery: null });
    try {
      await dependencies.disableBackground();
      await dependencies.unpair(active);
      config = null;
      publish({ disconnecting: false, step: 0, copied: null, ...safeConfig(null) });
      dependencies.successHaptic().catch(() => {});
    } catch {
      publish({ disconnecting: false });
      fail('disconnect');
    }
  };

  const send = async (intent: IosSetupIntent): Promise<void> => {
    if (disposed) return;
    if (intent.type === 'load') return load();
    if (intent.type === 'connect') return connect();
    if (intent.type === 'cancel-private-mode') {
      publish({ askPrivateMode: false });
      return;
    }
    if (intent.type === 'confirm-private-mode') {
      publish({ askPrivateMode: false });
      try {
        await leavePrivateMode();
        await connect(true);
      } catch {
        fail('connect');
      }
      return;
    }
    if (intent.type === 'disconnect') return disconnect();
    if (intent.type === 'copy') {
      try {
        await copy(intent.target);
      } catch {
        fail('shortcut-install');
      }
      return;
    }
    if (intent.type === 'install-shortcut') {
      if (!config) return;
      try {
        await copy('setup');
        if (disposed) return;
        await dependencies.openUrl(dependencies.shortcutUrl ?? 'shortcuts://');
        clearFailure();
      } catch {
        fail('shortcut-install');
      }
      return;
    }
    if (intent.type === 'shortcut-installed') {
      await clearSensitiveClipboard();
      stopVerification({ step: 2, copied: null });
      clearFailure();
      return;
    }
    if (intent.type === 'open-automation') {
      if (!(await ensureSilentDelivery())) return;
      try {
        await dependencies.openUrl('shortcuts://');
      } catch {
        fail('shortcuts-open');
      }
      return;
    }
    if (intent.type === 'automation-ready') {
      if (!config || model.preparing) return;
      const generation = attempt;
      publish({ preparing: true });
      if (!(await ensureSilentDelivery())) return;
      if (generation !== attempt || disposed) return;
      await clearSensitiveClipboard();
      try {
        const configured = await dependencies.markConfigured(config);
        if (generation !== attempt || disposed) return;
        config = configured;
        publish({ preparing: false, step: 3, ...safeConfig(config) });
        await startTest();
      } catch {
        fail('configure');
      }
      return;
    }
    if (intent.type === 'start-test') return startTest();
    if (intent.type === 'go-to-step') {
      stopVerification({ step: intent.step, failure: null, recovery: null });
      return;
    }
    if (intent.type === 'clear-failure') {
      clearFailure();
      return;
    }
    try {
      await dependencies.openSettings();
    } catch {
      // The existing settings button is best effort.
    }
  };

  return {
    getModel: () => model,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(model);
      return () => listeners.delete(listener);
    },
    send,
    dispose: () => {
      disposed = true;
      clearPoll();
      if (copiedTimer) dependencies.clock.clear(copiedTimer);
      copiedTimer = null;
      listeners.clear();
      // Header-back is as much a setup exit as the explicit Continue button.
      // Never leave an ingest credential on the pasteboard deliberately.
      void clearSensitiveClipboard();
    },
  };
};
