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
  getRelayAutomationProof,
  getRelayConfig,
  isRelayAutomationProofCurrent,
  markRelayAutomationPrepared,
  markRelayConfigured,
  pairDevice,
  RelayError,
  subscribeRelayAutomationProof,
  unpairDevice,
  type RelayConfig,
} from '@/lib/relay';
import { shortcutSetupCode, shortcutTestUrl } from '@/lib/relay-protocol';

export type IosSetupStep = 0 | 1 | 2 | 3;
export const SHORTCUTS_APP_STORE_URL =
  'https://apps.apple.com/app/shortcuts/id1462947752';
export type IosShortcutCallbackResult = 'success' | 'cancel' | 'error';
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
  | 'shortcuts-missing'
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
  automationPrepared: boolean;
  automationActive: boolean;
  timedOut: boolean;
  askPrivateMode: boolean;
  copied: IosSetupCopyTarget | null;
  ingestUrl: string | null;
  tokenPreview: string | null;
  captured: { merchant: string; isTest: boolean } | null;
  shortcutCallbackResult: IosShortcutCallbackResult | null;
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
  | { type: 'refresh-proof' }
  | { type: 'continue-to-automation' }
  | { type: 'shortcut-callback'; result: IosShortcutCallbackResult }
  | { type: 'go-to-step'; step: IosSetupStep }
  | { type: 'clear-failure' }
  | { type: 'open-shortcuts-store' }
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
  getAutomationProof(deviceId: string | null): Promise<string | null>;
  subscribeAutomationProof(listener: () => void): () => void;
  markConfigured(config: RelayConfig): Promise<RelayConfig>;
  markAutomationPrepared(config: RelayConfig): Promise<RelayConfig>;
  pair(baseUrl: string): Promise<RelayConfig>;
  unpair(config: RelayConfig): Promise<void>;
  requestSilentPermission(): Promise<boolean>;
  enableBackground(config: RelayConfig): Promise<boolean>;
  disableBackground(): Promise<void>;
  writeClipboard(value: string): Promise<void>;
  canOpenUrl(url: string): Promise<boolean>;
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
  /** Preserve onboarding routing through the native Shortcut callback. */
  fromOnboarding?: boolean;
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
  automationPrepared: false,
  automationActive: false,
  timedOut: false,
  askPrivateMode: false,
  copied: null,
  ingestUrl: null,
  tokenPreview: null,
  captured: null,
  shortcutCallbackResult: null,
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
  getAutomationProof: getRelayAutomationProof,
  subscribeAutomationProof: subscribeRelayAutomationProof,
  markConfigured: markRelayConfigured,
  markAutomationPrepared: markRelayAutomationPrepared,
  pair: pairDevice,
  unpair: unpairDevice,
  requestSilentPermission: requestSilentCapturePermission,
  enableBackground: enableRelayBackgroundSync,
  disableBackground: disableRelayBackgroundSync,
  writeClipboard: async (value) => {
    await Clipboard.setStringAsync(value);
  },
  canOpenUrl: async (url) => Linking.canOpenURL(url),
  openUrl: async (url) => {
    await Linking.openURL(url);
  },
  openSettings: async () => {
    await Linking.openSettings();
  },
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
  fromOnboarding = false,
}: IosCaptureSetupOptions): IosCaptureSetupController => {
  const dependencies = { ...defaultDependencies(), ...overrides };
  const listeners = new Set<(model: IosSetupModel) => void>();
  let model = {
    ...INITIAL_IOS_SETUP_MODEL,
    relayAvailable: Boolean(dependencies.relayUrl),
    shortcutAvailable: Boolean(dependencies.shortcutUrl),
  };
  let config: RelayConfig | null = null;
  let automationProofGeneration: string | null = null;
  let sensitiveCopyPending = false;
  let disposed = false;
  let attempt = 0;
  let startedAt = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeAutomationProof = (): void => {};
  let relayStatusRequest = 0;
  let refreshAfterLoad = false;
  let refreshRelayStatus: () => Promise<void>;
  let installHandoffPending = false;

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
    publish({ failure, recovery, preparing: installHandoffPending });
  };

  const canUseShortcuts = async (): Promise<boolean> => {
    try {
      return await dependencies.canOpenUrl('shortcuts://');
    } catch {
      // canOpenURL rejects on iOS when the scheme cannot be queried.
      return false;
    }
  };

  const clearSensitiveClipboard = async (): Promise<void> => {
    if (!sensitiveCopyPending) return;
    try {
      await dependencies.writeClipboard('');
      sensitiveCopyPending = false;
      if (model.copied === 'setup' || model.copied === 'token') {
        publish({ copied: null });
      }
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

  const copy = async (
    target: IosSetupCopyTarget,
    ownedByInstallHandoff = false,
  ): Promise<boolean> => {
    if (
      !config ||
      model.disconnecting ||
      (model.preparing && !ownedByInstallHandoff)
    ) return false;
    const active = config;
    const generation = attempt;
    const value = target === 'setup'
      ? shortcutSetupCode(active.ingestUrl, active.ingestToken)
      : target === 'url'
        ? active.ingestUrl
        : active.ingestToken;
    const sensitive = target === 'setup' || target === 'token';
    if (sensitive) sensitiveCopyPending = true;
    await dependencies.writeClipboard(value);
    if (
      disposed ||
      model.disconnecting ||
      (model.preparing && !ownedByInstallHandoff) ||
      generation !== attempt ||
      config?.deviceId !== active.deviceId ||
      config.syncToken !== active.syncToken
    ) {
      if (sensitive) {
        await dependencies.writeClipboard('').catch(() => {});
        sensitiveCopyPending = false;
      }
      return false;
    }
    setCopied(target);
    dependencies.selectionHaptic().catch(() => {});
    return true;
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
    publish({
      listening: false,
      timedOut: false,
      captured: null,
      preparing: installHandoffPending,
      ...patch,
    });
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
          automationActive: isRelayAutomationProofCurrent(config, automationProofGeneration),
        });
        dependencies.successHaptic().catch(() => {});
        return;
      }
      if (outcome.kind === 'needs-setup') {
        config = null;
        automationProofGeneration = null;
        stopVerification({
          step: 0,
          automationPrepared: false,
          automationActive: false,
          ...safeConfig(null),
        });
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

  const prepareRelayVerification = (): number | null => {
    if (!config || model.listening) return null;
    clearPoll();
    const generation = attempt;
    clearFailure();
    startedAt = dependencies.clock.now();
    publish({
      step: 2,
      captured: null,
      shortcutCallbackResult: null,
      timedOut: false,
      listening: true,
    });
    return generation;
  };

  const resumeRelayVerification = (): void => {
    const generation = prepareRelayVerification();
    if (generation === null) return;
    void poll(generation);
  };

  const startTest = async (): Promise<void> => {
    const generation = prepareRelayVerification();
    if (generation === null) return;
    if (!dependencies.isWeb) {
      const shortcutsAvailable = await canUseShortcuts();
      if (generation !== attempt || disposed) return;
      if (!shortcutsAvailable) {
        stopVerification();
        fail('shortcuts-missing', 'shortcut');
        return;
      }
      try {
        await dependencies.openUrl(shortcutTestUrl({ fromOnboarding }));
      } catch {
        if (generation !== attempt || disposed) return;
        stopVerification();
        fail('shortcut-run', 'shortcut');
        return;
      }
    }
    if (generation !== attempt || disposed) return;
    void poll(generation);
  };

  const load = async (): Promise<void> => {
    const request = ++relayStatusRequest;
    const active = config;
    const generation = attempt;
    publish({ loading: true, failure: null, recovery: null });
    try {
      const existing = await dependencies.getConfig();
      const automationProof = await dependencies.getAutomationProof(existing?.deviceId ?? null);
      if (
        disposed ||
        request !== relayStatusRequest ||
        generation !== attempt ||
        config !== active
      ) return;
      config = existing;
      automationProofGeneration = automationProof;
      const proofCurrent = isRelayAutomationProofCurrent(existing, automationProof);
      publish({
        loading: false,
        step: existing
          ? existing.setupState === 'paired'
            ? 1
            : existing.setupState === 'configured'
              ? 2
              : 3
          : 0,
        automationPrepared: Boolean(existing?.automationPreparedAt) || proofCurrent,
        automationActive: proofCurrent,
        ...safeConfig(existing),
      });
    } catch {
      fail('load');
      publish({ loading: false });
    } finally {
      if (refreshAfterLoad && !disposed) {
        refreshAfterLoad = false;
        void refreshRelayStatus();
      }
    }
  };

  refreshRelayStatus = async (): Promise<void> => {
    if (model.loading) {
      refreshAfterLoad = true;
      return;
    }
    const request = ++relayStatusRequest;
    const active = config;
    const generation = attempt;
    try {
      const existing = await dependencies.getConfig();
      const proof = await dependencies.getAutomationProof(existing?.deviceId ?? null)
        .catch(() => null);
      const configAdvancedInScope =
        request === relayStatusRequest &&
        generation === attempt &&
        active !== null &&
        config !== null &&
        config !== active &&
        config.deviceId === active.deviceId &&
        config.syncToken === active.syncToken;
      if (
        disposed ||
        request !== relayStatusRequest ||
        generation !== attempt ||
        config !== active
      ) {
        if (configAdvancedInScope) {
          // A setup poll can persist pipe verification while this proof read is
          // in flight. Replay against that newer same-device config so the
          // matching automation proof is not discarded with the stale object.
          Promise.resolve().then(() => {
            if (!disposed) void refreshRelayStatus();
          });
        }
        return;
      }

      if (!existing) {
        config = null;
        automationProofGeneration = null;
        stopVerification({
          step: 0,
          copied: null,
          automationPrepared: false,
          automationActive: false,
          ...safeConfig(null),
        });
        return;
      }

      const identityChanged = !active ||
        active.deviceId !== existing.deviceId ||
        active.syncToken !== existing.syncToken;
      if (identityChanged) clearPoll();
      config = existing;
      automationProofGeneration = proof;
      const current = isRelayAutomationProofCurrent(existing, proof);
      publish({
        step: identityChanged
          ? existing.setupState === 'paired'
            ? 1
            : existing.setupState === 'configured'
              ? 2
              : 3
          : model.step,
        automationPrepared: Boolean(existing.automationPreparedAt) || current,
        automationActive: current,
        ...safeConfig(existing),
      });
    } catch {
      // A foreground refresh is advisory. Keep the last durable view on a
      // transient Keychain read failure; the next app-state or relay signal retries.
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
      automationProofGeneration = null;
      publish({
        pairing: false,
        step: 1,
        automationPrepared: false,
        automationActive: false,
        ...safeConfig(paired),
      });
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
    // Clear while the remote credential is still known. This also covers a
    // failed unpair: a live ingest token must not remain in the pasteboard just
    // because the network refused to disconnect it.
    await clearSensitiveClipboard();
    try {
      await dependencies.disableBackground();
      await dependencies.unpair(active);
      // A copy/install tap that began just before disconnect was pressed can
      // finish after the first clear. Clear once more before dropping identity.
      await clearSensitiveClipboard();
      config = null;
      automationProofGeneration = null;
      publish({
        disconnecting: false,
        step: 0,
        copied: null,
        automationPrepared: false,
        automationActive: false,
        ...safeConfig(null),
      });
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
      if (!config || model.disconnecting || model.preparing) return;
      const active = config;
      const generation = attempt;
      const installUrl = dependencies.shortcutUrl ?? 'shortcuts://';
      installHandoffPending = true;
      publish({ preparing: true });
      try {
        const shortcutsAvailable = dependencies.isWeb || await canUseShortcuts();
        if (
          generation !== attempt ||
          disposed ||
          config?.deviceId !== active.deviceId ||
          config.syncToken !== active.syncToken
        ) return;
        if (!shortcutsAvailable) {
          fail('shortcuts-missing', 'shortcut');
          return;
        }
        if (!(await copy('setup', true))) return;
        if (
          generation !== attempt ||
          disposed ||
          config?.deviceId !== active.deviceId ||
          config.syncToken !== active.syncToken
        ) {
          await clearSensitiveClipboard();
          return;
        }
        await dependencies.openUrl(installUrl);
        if (generation !== attempt || disposed) {
          await clearSensitiveClipboard();
          return;
        }
        clearFailure();
      } catch {
        await clearSensitiveClipboard();
        if (generation !== attempt || disposed) return;
        fail('shortcut-install');
      } finally {
        installHandoffPending = false;
        publish({ preparing: false });
      }
      return;
    }
    if (intent.type === 'shortcut-installed') {
      if (!config || model.disconnecting || model.preparing) return;
      const active = config;
      // Publish the busy state before the first await. Otherwise a second tap
      // can copy the credential after the pending blank pasteboard write and
      // leave the secret behind when that earlier clear finally resolves.
      stopVerification({ step: 2, copied: null, preparing: true });
      const generation = attempt;
      await clearSensitiveClipboard();
      if (
        disposed ||
        generation !== attempt ||
        config?.deviceId !== active.deviceId ||
        config.syncToken !== active.syncToken
      ) return;
      try {
        const configured = await dependencies.markConfigured(active);
        if (disposed) return;
        config = configured;
        if (generation !== attempt) return;
        publish({ preparing: false, ...safeConfig(configured) });
        clearFailure();
      } catch {
        if (generation !== attempt || disposed) return;
        fail('configure');
        return;
      }
      await startTest();
      return;
    }
    if (intent.type === 'open-automation') {
      const generation = attempt;
      const shortcutsAvailable = await canUseShortcuts();
      if (generation !== attempt || disposed) return;
      if (!shortcutsAvailable) {
        fail('shortcuts-missing', 'shortcut');
        return;
      }
      if (!(await ensureSilentDelivery())) return;
      if (generation !== attempt || disposed) return;
      try {
        await dependencies.openUrl('shortcuts://');
      } catch {
        if (generation !== attempt || disposed) return;
        fail('shortcuts-open');
      }
      return;
    }
    if (intent.type === 'automation-ready') {
      if (!config || model.preparing) return;
      if (config.setupState !== 'verified') {
        stopVerification({ step: 2 });
        fail('configure');
        return;
      }
      const generation = attempt;
      publish({ preparing: true });
      const shortcutsAvailable = await canUseShortcuts();
      if (generation !== attempt || disposed) return;
      if (!shortcutsAvailable) {
        fail('shortcuts-missing', 'shortcut');
        return;
      }
      if (!(await ensureSilentDelivery())) return;
      if (generation !== attempt || disposed) return;
      await clearSensitiveClipboard();
      if (generation !== attempt || disposed) return;
      try {
        config = await dependencies.markAutomationPrepared(config);
      } catch {
        if (generation !== attempt || disposed) return;
        fail('configure');
        return;
      }
      if (generation !== attempt || disposed) return;
      const automationProof = await dependencies.getAutomationProof(config.deviceId);
      if (generation !== attempt || disposed) return;
      automationProofGeneration = automationProof;
      publish({
        preparing: false,
        step: 3,
        automationPrepared: true,
        automationActive: isRelayAutomationProofCurrent(config, automationProof),
      });
      return;
    }
    if (intent.type === 'start-test') return startTest();
    if (intent.type === 'refresh-proof') return refreshRelayStatus();
    if (intent.type === 'continue-to-automation') {
      if (config?.setupState !== 'verified') return;
      stopVerification({ step: 3 });
      clearFailure();
      return;
    }
    if (intent.type === 'shortcut-callback') {
      // The custom URL scheme is public. A callback is meaningful only after
      // this device durably confirmed the Shortcut install; otherwise any app
      // or webpage could skip a freshly paired user past the install step.
      if (!config || config.setupState === 'paired') return;
      // The callback URL is public and native delivery can be delayed. Once a
      // verified setup is idle, a stale cancel/error is not evidence about the
      // current flow and must not regress Message-automation setup to step 2.
      if (
        intent.result !== 'success' &&
        config.setupState === 'verified' &&
        !model.listening
      ) return;
      publish({ shortcutCallbackResult: intent.result });
      if (intent.result === 'success') {
        // A late x-success can arrive after the poll has already persisted and
        // acknowledged its probe. Only a configured (not yet verified) setup
        // needs a cold-return poll; restarting on a verified config would wait
        // for an already consumed row and turn success into a false timeout.
        if (!model.listening && config.setupState === 'configured') {
          resumeRelayVerification();
        }
        return;
      }
      if (intent.result === 'cancel') {
        stopVerification({ step: 2, shortcutCallbackResult: 'cancel' });
        clearFailure();
        return;
      }
      stopVerification({ step: 2, shortcutCallbackResult: 'error' });
      fail('shortcut-run', 'shortcut');
      return;
    }
    if (intent.type === 'go-to-step') {
      stopVerification({ step: intent.step, failure: null, recovery: null });
      return;
    }
    if (intent.type === 'clear-failure') {
      clearFailure();
      return;
    }
    if (intent.type === 'open-shortcuts-store') {
      try {
        await dependencies.openUrl(SHORTCUTS_APP_STORE_URL);
        clearFailure();
      } catch {
        fail('shortcut-install');
      }
      return;
    }
    try {
      await dependencies.openSettings();
    } catch {
      // The existing settings button is best effort.
    }
  };

  unsubscribeAutomationProof = dependencies.subscribeAutomationProof(() => {
    void refreshRelayStatus();
  });

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
      unsubscribeAutomationProof();
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
