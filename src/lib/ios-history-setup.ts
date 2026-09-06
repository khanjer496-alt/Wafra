import AsyncStorage from '@react-native-async-storage/async-storage';

import type { IosMessageSetupProgress } from './ios-message-onboarding';

export type IosHistoryCardState =
  | 'unsupported'
  | 'install-unavailable'
  | 'needs-install'
  | 'ready'
  | 'running'
  | 'review';

export const IOS_HISTORY_HANDOFF_TTL_MS = 60 * 60_000;
export const IOS_HISTORY_SHORTCUT_NAME = 'Wafra History Import';
export const IOS_HISTORY_INSTALL_MARKER = 'wafra/ios-history-shortcut-installed/v1';
export const IOS_HISTORY_HANDOFF_MARKER = 'wafra/ios-history-handoff-started-at/v1';
export const IOS_HISTORY_RETURN_ORIGIN_MARKER = 'wafra/ios-history-return-origin/v1';

export type IosHistoryReturnOrigin =
  | 'home'
  | 'onboarding'
  | 'ios-setup'
  | 'wallet'
  | 'settings'
  | 'import';
export type IosHistoryReturnRoute =
  | '/'
  | '/ios-setup?fromOnboarding=1'
  | '/ios-setup'
  | '/wallet'
  | '/settings'
  | '/import-sms';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const HISTORY_SHORTCUT_RETURN_URL = 'wafra://import-sms';
const RETIRED_HISTORY_SHORTCUT_IDS = new Set([
  // Diagnostic graph retired after the physical V3 two-ended import passed.
  'cc85a21db99a4e4698c1a498de670199',
]);

export interface IosHistorySetupStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface IosHistorySetupSnapshot {
  installed: boolean;
  handoffStartedAt: number | null;
  expired: boolean;
}

export interface IosHistoryRecoveryNative {
  recoverCompletedSession(
    startedAfterMs: number,
  ): Promise<{ sessionId: unknown } | null>;
}

export interface IosHistorySetupReconciliation {
  snapshot: IosHistorySetupSnapshot;
  recoveredSessionId: string | null;
}

export type IosHistoryFinalizeResult = 'complete' | 'save-failed' | 'cleanup-failed';
export type IosHistoryControlledFinalizeResult = IosHistoryFinalizeResult | 'busy';
export type IosHistoryCleanupResult = 'complete' | 'busy' | 'cleanup-failed';
export type IosHistoryActionResult = 'complete' | 'busy' | 'failed';
export type IosHistoryLoadFailureDisposition =
  | 'source-retained'
  | 'source-discarded'
  | 'cleanup-failed';

export interface IosHistoryActionGuard {
  run(action: () => Promise<void>): Promise<boolean>;
}

export interface IosHistorySnapshotGate {
  next(): number;
  invalidate(): void;
  close(): void;
  isCurrent(generation: number): boolean;
}

export interface IosHistoryOperationController {
  finalize(input: {
    save: () => Promise<void>;
    discard: () => Promise<void>;
  }): Promise<IosHistoryControlledFinalizeResult>;
  discard(operation: () => Promise<void>): Promise<IosHistoryCleanupResult>;
}

export interface IosHistorySetupStorageCoordinator {
  run<T>(operation: () => Promise<T>): Promise<T>;
  runLatest<T>(
    gate: IosHistorySnapshotGate,
    operation: () => Promise<T>,
    apply: (value: T) => void,
  ): Promise<boolean>;
}

export const iosSupportsMessageHistory = (version: string | number): boolean => {
  const major = Number.parseInt(String(version), 10);
  return Number.isFinite(major) && major >= 26;
};

export const historyShortcutRunUrl = (): string => {
  const sourceFreeReturn = encodeURIComponent(HISTORY_SHORTCUT_RETURN_URL);
  return `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(
    IOS_HISTORY_SHORTCUT_NAME,
  )}&x-cancel=${sourceFreeReturn}&x-error=${sourceFreeReturn}`;
};

export const normalizeIosHistoryShortcutUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = /^https:\/\/www\.icloud\.com\/shortcuts\/([0-9A-Fa-f]{32})$/.exec(value);
  if (!match) return null;
  const id = match[1].toLowerCase();
  if (RETIRED_HISTORY_SHORTCUT_IDS.has(id)) return null;
  return `https://www.icloud.com/shortcuts/${id}`;
};

export const historyShortcutInstallUrl = (): string | null =>
  normalizeIosHistoryShortcutUrl(
    process.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL,
  );

export const validIosHistorySessionId = (value: unknown): value is string =>
  typeof value === 'string' && SESSION_ID_RE.test(value);

export const iosHistoryReturnOriginFromParam = (
  value: unknown,
): IosHistoryReturnOrigin | null =>
  value === 'home' ||
  value === 'onboarding' ||
  value === 'ios-setup' ||
  value === 'wallet' ||
  value === 'settings' ||
  value === 'import'
    ? value
    : null;

export const iosHistorySuccessRoute = (
  progress: IosMessageSetupProgress,
  returnOrigin: IosHistoryReturnOrigin | null = null,
): IosHistoryReturnRoute => {
  switch (returnOrigin) {
    case 'onboarding':
      return progress.returnToOnboarding ? '/ios-setup?fromOnboarding=1' : '/';
    case 'ios-setup':
      return '/ios-setup';
    case 'wallet':
      return '/wallet';
    case 'settings':
      return '/settings';
    case 'import':
      return '/import-sms';
    case 'home':
      return '/';
    default:
      return progress.returnToOnboarding ? '/ios-setup?fromOnboarding=1' : '/';
  }
};

export const loadIosHistoryReturnOrigin = async (
  storage: IosHistorySetupStorage = AsyncStorage,
): Promise<IosHistoryReturnOrigin | null> => {
  const raw = await storage.getItem(IOS_HISTORY_RETURN_ORIGIN_MARKER);
  const origin = iosHistoryReturnOriginFromParam(raw);
  if (raw !== null && origin === null) {
    await storage.removeItem(IOS_HISTORY_RETURN_ORIGIN_MARKER);
  }
  return origin;
};

export const consumeIosHistoryReturnOrigin = async (
  storage: IosHistorySetupStorage = AsyncStorage,
): Promise<IosHistoryReturnOrigin | null> => {
  const raw = await storage.getItem(IOS_HISTORY_RETURN_ORIGIN_MARKER);
  const origin = iosHistoryReturnOriginFromParam(raw);
  if (raw !== null) await storage.removeItem(IOS_HISTORY_RETURN_ORIGIN_MARKER);
  return origin;
};

export const clearIosHistoryReturnOrigin = async (
  storage: IosHistorySetupStorage = AsyncStorage,
): Promise<void> => {
  await storage.removeItem(IOS_HISTORY_RETURN_ORIGIN_MARKER);
};

export const recoverIosHistoryHandoff = async (
  startedAfterMs: number | null,
  native: IosHistoryRecoveryNative,
): Promise<string | null> => {
  if (
    startedAfterMs === null ||
    !Number.isSafeInteger(startedAfterMs) ||
    startedAfterMs < 0
  ) return null;
  const recovered = await native.recoverCompletedSession(startedAfterMs);
  return validIosHistorySessionId(recovered?.sessionId)
    ? recovered.sessionId
    : null;
};

export const cancelIosHistoryHandoff = async (input: {
  recover: () => Promise<string | null>;
  discard: (sessionId: string) => Promise<void>;
  clearHandoff: () => Promise<void>;
}): Promise<void> => {
  const recoveredSessionId = await input.recover();
  if (recoveredSessionId !== null) {
    await input.discard(recoveredSessionId);
  }
  await input.clearHandoff();
};

export const finalizeIosHistorySession = async (input: {
  save: () => Promise<void>;
  discard: () => Promise<void>;
}): Promise<IosHistoryFinalizeResult> => {
  try {
    await input.save();
  } catch {
    return 'save-failed';
  }
  try {
    await input.discard();
  } catch {
    return 'cleanup-failed';
  }
  return 'complete';
};

export const createIosHistoryOperationController = (): IosHistoryOperationController => {
  let running = false;
  return {
    async finalize(input) {
      if (running) return 'busy';
      running = true;
      try {
        return await finalizeIosHistorySession(input);
      } finally {
        running = false;
      }
    },
    async discard(operation) {
      if (running) return 'busy';
      running = true;
      try {
        await operation();
        return 'complete';
      } catch {
        return 'cleanup-failed';
      } finally {
        running = false;
      }
    },
  };
};

export const iosHistoryCleanupStateAfterFailure = (
  current: string,
): 'cleanup-failed' | 'source-cleanup-failed' | 'cancel-cleanup-failed' => {
  if (current === 'cleanup-failed') return 'cleanup-failed';
  if (current === 'source-cleanup-failed') return 'source-cleanup-failed';
  return 'cancel-cleanup-failed';
};

export const iosHistorySourceCounts = (
  summary: { found: number; parsed: number; declined: number },
  sourceEventIds: readonly string[],
  existingSmsKeys: readonly string[],
): { understood: number; unread: number; alreadyFiled: number; notAlreadyFiled: number } => {
  const found = Math.max(0, Math.floor(summary.found));
  const understood = Math.min(
    found,
    Math.max(0, Math.floor(summary.parsed + summary.declined)),
  );
  const existing = new Set(existingSmsKeys);
  const uniqueSourceIds = new Set(sourceEventIds.filter(Boolean));
  let alreadyFiled = 0;
  for (const sourceId of uniqueSourceIds) {
    if (existing.has(`h${sourceId}`)) alreadyFiled += 1;
  }
  const boundedAlreadyFiled = Math.min(understood, alreadyFiled);
  return {
    understood,
    unread: found - understood,
    alreadyFiled: boundedAlreadyFiled,
    notAlreadyFiled: Math.max(0, understood - boundedAlreadyFiled),
  };
};

export const eraseIosHistoryData = async (input: {
  eraseNative: () => Promise<void>;
  clearSetup: () => Promise<void>;
}): Promise<void> => {
  await input.eraseNative();
  await input.clearSetup();
};

export const createIosHistoryPostEraseCleanup = (input: {
  eraseCapture: () => Promise<void>;
  eraseHistory: () => Promise<void>;
  clearMessageSetup: () => Promise<void>;
  clearBackground: () => Promise<void>;
}): (() => Promise<void>) => async () => {
  await input.eraseCapture();
  await input.eraseHistory();
  await input.clearMessageSetup();
  await input.clearBackground();
};

export const createIosHistoryActionGuard = (): IosHistoryActionGuard => {
  let running = false;
  return {
    async run(action) {
      if (running) return false;
      running = true;
      try {
        await action();
        return true;
      } finally {
        running = false;
      }
    },
  };
};

export const performIosHistoryAction = async (
  guard: IosHistoryActionGuard,
  action: () => Promise<void>,
  invalidateSnapshots?: () => void,
): Promise<IosHistoryActionResult> => {
  try {
    return (await guard.run(async () => {
      invalidateSnapshots?.();
      try {
        await action();
      } finally {
        invalidateSnapshots?.();
      }
    })) ? 'complete' : 'busy';
  } catch {
    return 'failed';
  }
};

export const createIosHistorySnapshotGate = (): IosHistorySnapshotGate => {
  let generation = 0;
  let closed = false;
  return {
    next() {
      generation += 1;
      return generation;
    },
    invalidate() {
      generation += 1;
    },
    close() {
      closed = true;
      generation += 1;
    },
    isCurrent(candidate) {
      return !closed && candidate === generation;
    },
  };
};

export const createIosHistorySetupStorageCoordinator = (
): IosHistorySetupStorageCoordinator => {
  let tail: Promise<void> = Promise.resolve();
  const run = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const runLatest = <T,>(
    gate: IosHistorySnapshotGate,
    operation: () => Promise<T>,
    apply: (value: T) => void,
  ): Promise<boolean> => {
    const generation = gate.next();
    return run(async () => {
      if (!gate.isCurrent(generation)) return false;
      let value: T;
      try {
        value = await operation();
      } catch (error) {
        if (!gate.isCurrent(generation)) return false;
        throw error;
      }
      if (!gate.isCurrent(generation)) return false;
      apply(value);
      return true;
    });
  };
  return { run, runLatest };
};

export const iosHistorySetupStorageCoordinator =
  createIosHistorySetupStorageCoordinator();

export const iosHistoryLoadFailureDisposition = (
  error: unknown,
): IosHistoryLoadFailureDisposition => {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'cleanup-failed'
  ) {
    return 'cleanup-failed';
  }
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    [
      'session-unavailable',
      'invalid-descriptor',
      'invalid-chunk',
      'record-mismatch',
      'duplicate-record',
      'record-count-mismatch',
    ].includes(error.code)
  ) {
    return 'source-discarded';
  }
  return 'source-retained';
};

export const resolveIosHistoryCardState = (input: {
  platform: string;
  version: string | number;
  installUrl?: string | null;
  installed: boolean;
  handoffStartedAt: number | null;
  historySessionId?: string;
  now?: number;
}): IosHistoryCardState => {
  if (input.platform !== 'ios' || !iosSupportsMessageHistory(input.version)) {
    return 'unsupported';
  }
  if (validIosHistorySessionId(input.historySessionId)) return 'review';
  if (!input.installUrl?.trim()) return 'install-unavailable';
  if (!input.installed) return 'needs-install';
  if (input.handoffStartedAt === null) return 'ready';

  const age = (input.now ?? Date.now()) - input.handoffStartedAt;
  return age >= 0 && age < IOS_HISTORY_HANDOFF_TTL_MS ? 'running' : 'ready';
};

export const loadIosHistorySetup = async (
  now = Date.now(),
  storage: IosHistorySetupStorage = AsyncStorage,
): Promise<IosHistorySetupSnapshot> => {
  const [installedValue, handoffValue] = await Promise.all([
    storage.getItem(IOS_HISTORY_INSTALL_MARKER),
    storage.getItem(IOS_HISTORY_HANDOFF_MARKER),
  ]);
  const parsedHandoff = handoffValue === null ? NaN : Number(handoffValue);
  const validHandoff = Number.isSafeInteger(parsedHandoff) && parsedHandoff >= 0;
  const age = validHandoff ? now - parsedHandoff : -1;
  const expired = validHandoff && age >= IOS_HISTORY_HANDOFF_TTL_MS;
  const invalid = handoffValue !== null && (!validHandoff || age < 0);

  if (expired || invalid) {
    await Promise.all([
      storage.removeItem(IOS_HISTORY_HANDOFF_MARKER),
      storage.removeItem(IOS_HISTORY_RETURN_ORIGIN_MARKER),
    ]);
  }
  return {
    installed: installedValue === 'true',
    handoffStartedAt: expired || invalid || !validHandoff ? null : parsedHandoff,
    expired,
  };
};

export const reconcileIosHistorySetup = async (input: {
  historySessionId?: unknown;
  native: IosHistoryRecoveryNative;
  now?: number;
  storage?: IosHistorySetupStorage;
}): Promise<IosHistorySetupReconciliation> => {
  const now = input.now ?? Date.now();
  const storage = input.storage ?? AsyncStorage;
  const [installedValue, handoffValue] = await Promise.all([
    storage.getItem(IOS_HISTORY_INSTALL_MARKER),
    storage.getItem(IOS_HISTORY_HANDOFF_MARKER),
  ]);
  const installed = installedValue === 'true';
  const parsedHandoff = handoffValue === null ? NaN : Number(handoffValue);
  const validHandoff = Number.isSafeInteger(parsedHandoff) && parsedHandoff >= 0;
  const age = validHandoff ? now - parsedHandoff : -1;
  const invalid = handoffValue !== null && (!validHandoff || age < 0);

  if (invalid) {
    await Promise.all([
      storage.removeItem(IOS_HISTORY_HANDOFF_MARKER),
      storage.removeItem(IOS_HISTORY_RETURN_ORIGIN_MARKER),
    ]);
    return {
      snapshot: { installed, handoffStartedAt: null, expired: false },
      recoveredSessionId: null,
    };
  }
  if (!validHandoff) {
    return {
      snapshot: { installed, handoffStartedAt: null, expired: false },
      recoveredSessionId: null,
    };
  }

  // Recover before removing an expired marker. A completed native session gets
  // its own one-hour lifetime, which can end later than the handoff marker
  // when Find Messages took many minutes. If native lookup fails, preserving
  // this source-free timestamp leaves a safe retry path.
  const recoveredSessionId = await recoverIosHistoryHandoff(
    parsedHandoff,
    input.native,
  );
  const hasHistoryParam = input.historySessionId !== undefined;
  const matchesDeepLink =
    validIosHistorySessionId(input.historySessionId) &&
    input.historySessionId === recoveredSessionId;
  const expired = age >= IOS_HISTORY_HANDOFF_TTL_MS;

  if (matchesDeepLink) {
    await storage.removeItem(IOS_HISTORY_HANDOFF_MARKER);
  } else if (expired && !hasHistoryParam && recoveredSessionId === null) {
    await Promise.all([
      storage.removeItem(IOS_HISTORY_HANDOFF_MARKER),
      storage.removeItem(IOS_HISTORY_RETURN_ORIGIN_MARKER),
    ]);
  }

  return {
    snapshot: {
      installed,
      handoffStartedAt: expired || matchesDeepLink ? null : parsedHandoff,
      expired,
    },
    recoveredSessionId:
      !hasHistoryParam && recoveredSessionId !== null
        ? recoveredSessionId
        : null,
  };
};

export const confirmIosHistoryShortcutInstalled = async (
  storage: IosHistorySetupStorage = AsyncStorage,
): Promise<void> => {
  await storage.setItem(IOS_HISTORY_INSTALL_MARKER, 'true');
};

/**
 * This confirmation is deliberately separate from native history handoff and
 * recovery state. It only reflects the user's acknowledgement that the
 * published Shortcut was added.
 */
export const isIosHistoryShortcutInstalled = async (
  storage: IosHistorySetupStorage = AsyncStorage,
): Promise<boolean> =>
  (await storage.getItem(IOS_HISTORY_INSTALL_MARKER)) === 'true';

export const beginIosHistoryHandoff = async (
  startedAt = Date.now(),
  storage: IosHistorySetupStorage = AsyncStorage,
): Promise<void> => {
  await storage.setItem(IOS_HISTORY_HANDOFF_MARKER, String(startedAt));
};

export const beginIosHistoryHandoffForOrigin = async (
  returnOrigin: IosHistoryReturnOrigin,
  startedAt = Date.now(),
  storage: IosHistorySetupStorage = AsyncStorage,
): Promise<void> => {
  const safeOrigin = iosHistoryReturnOriginFromParam(returnOrigin);
  if (safeOrigin === null) throw new Error('invalid_history_return_origin');
  await storage.setItem(IOS_HISTORY_HANDOFF_MARKER, String(startedAt));
  try {
    await storage.setItem(IOS_HISTORY_RETURN_ORIGIN_MARKER, safeOrigin);
  } catch (error) {
    try {
      await storage.removeItem(IOS_HISTORY_HANDOFF_MARKER);
    } finally {
      throw error;
    }
  }
};

export const clearIosHistoryHandoff = async (
  storage: IosHistorySetupStorage = AsyncStorage,
): Promise<void> => {
  await storage.removeItem(IOS_HISTORY_HANDOFF_MARKER);
};

export const clearIosHistoryHandoffForDeepLink = async (
  sessionId: unknown,
  recoveredSessionId: unknown,
  storage: IosHistorySetupStorage = AsyncStorage,
): Promise<boolean> => {
  if (
    !validIosHistorySessionId(sessionId) ||
    !validIosHistorySessionId(recoveredSessionId) ||
    sessionId !== recoveredSessionId
  ) return false;
  await clearIosHistoryHandoff(storage);
  return true;
};

export const resetIosHistorySetup = async (
  storage: IosHistorySetupStorage = AsyncStorage,
): Promise<void> => {
  await Promise.all([
    storage.removeItem(IOS_HISTORY_INSTALL_MARKER),
    storage.removeItem(IOS_HISTORY_HANDOFF_MARKER),
    storage.removeItem(IOS_HISTORY_RETURN_ORIGIN_MARKER),
  ]);
};

export const eraseIosHistorySessions = async (): Promise<void> => {
  await iosHistorySetupStorageCoordinator.run(async () => {
    const native = (await import('../../modules/wafra-message-history')).default;
    await eraseIosHistoryData({
      eraseNative: () => native.eraseAll(),
      clearSetup: () => resetIosHistorySetup(),
    });
  });
};
