import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IosSetupReadiness } from './ios-capture-setup';
import { futureSetupConfigured } from './ios-setup-journey';

import {
  isIosHistoryShortcutInstalled,
  type IosHistorySetupStorage,
} from './ios-history-setup';

export const IOS_MESSAGE_SETUP_PROGRESS_KEY =
  'wafra/ios-message-setup-progress/v1';

export type IosMessageSetupSection = 'future' | 'history';
export type IosMessageSetupStatus =
  | 'not-started'
  | 'in-progress'
  | 'complete'
  | 'skipped';

export interface IosMessageSetupProgress {
  version: 1;
  activeSection: IosMessageSetupSection;
  futureShortcutConfirmed: boolean;
  futureShortcutVersion?: 3;
  futureAutomationConfirmed: boolean;
  futureStatus: IosMessageSetupStatus;
  /** Missing in legacy progress means Message automation. */
  futureCaptureSource?: 'message' | 'notification' | 'apple-pay';
  historyShortcutConfirmed: boolean;
  historyStatus: IosMessageSetupStatus;
  /** Explicit future-only choice. Absent on older progress and declined reviews. */
  historySkippedForNow?: boolean;
  returnToOnboarding: boolean;
}

export type IosMessageSetupEvent =
  | { type: 'active-section-changed'; section: IosMessageSetupSection }
  | { type: 'future-shortcut-install-started'; version?: 3 }
  | { type: 'future-shortcut-confirmed'; version?: 3 }
  | { type: 'future-automation-confirmed' }
  | { type: 'future-status-changed'; status: IosMessageSetupStatus }
  | { type: 'future-source-changed'; source: 'message' | 'notification' | 'apple-pay' }
  | { type: 'history-shortcut-confirmed' }
  | { type: 'history-status-changed'; status: IosMessageSetupStatus }
  | { type: 'history-skipped-for-now'; readiness: IosSetupReadiness }
  | { type: 'onboarding-started' }
  | { type: 'onboarding-return-cleared' }
  | { type: 'onboarding-finished' };

export type IosMessageSetupStorage = IosHistorySetupStorage;

const DEFAULT_PROGRESS: IosMessageSetupProgress = {
  version: 1,
  activeSection: 'future',
  futureShortcutConfirmed: false,
  futureAutomationConfirmed: false,
  futureStatus: 'not-started',
  historyShortcutConfirmed: false,
  historyStatus: 'not-started',
  returnToOnboarding: false,
};

const PROGRESS_KEYS = [
  'activeSection',
  'futureAutomationConfirmed',
  'futureShortcutConfirmed',
  'futureStatus',
  'historyShortcutConfirmed',
  'historyStatus',
  'returnToOnboarding',
  'version',
] as const;

const isStatus = (value: unknown): value is IosMessageSetupStatus =>
  value === 'not-started' ||
  value === 'in-progress' ||
  value === 'complete' ||
  value === 'skipped';

const parseProgress = (raw: string): IosMessageSetupProgress | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate).filter((key) => key !== 'historySkippedForNow' && key !== 'futureCaptureSource' && key !== 'futureShortcutVersion').sort();
    if (
      keys.length !== PROGRESS_KEYS.length ||
      keys.some((key, index) => key !== PROGRESS_KEYS[index]) ||
      candidate.version !== 1 ||
      (candidate.activeSection !== 'future' && candidate.activeSection !== 'history') ||
      typeof candidate.futureShortcutConfirmed !== 'boolean' ||
      ('futureShortcutVersion' in candidate && candidate.futureShortcutVersion !== 3) ||
      typeof candidate.futureAutomationConfirmed !== 'boolean' ||
      !isStatus(candidate.futureStatus) ||
      ('futureCaptureSource' in candidate && candidate.futureCaptureSource !== 'message' && candidate.futureCaptureSource !== 'notification' && candidate.futureCaptureSource !== 'apple-pay') ||
      typeof candidate.historyShortcutConfirmed !== 'boolean' ||
      !isStatus(candidate.historyStatus) ||
      ('historySkippedForNow' in candidate && typeof candidate.historySkippedForNow !== 'boolean') ||
      typeof candidate.returnToOnboarding !== 'boolean'
    ) return null;
    return {
      version: 1,
      activeSection: candidate.activeSection,
      futureShortcutConfirmed: candidate.futureShortcutConfirmed,
      ...(candidate.futureShortcutVersion === 3 ? { futureShortcutVersion: 3 as const } : {}),
      futureAutomationConfirmed: candidate.futureAutomationConfirmed,
      futureStatus: candidate.futureStatus,
      ...(candidate.futureCaptureSource ? { futureCaptureSource: candidate.futureCaptureSource as 'message' | 'notification' | 'apple-pay' } : {}),
      historyShortcutConfirmed: candidate.historyShortcutConfirmed,
      historyStatus: candidate.historyStatus,
      returnToOnboarding: candidate.returnToOnboarding,
      ...(candidate.historySkippedForNow === true && candidate.historyStatus === 'skipped'
        ? { historySkippedForNow: true } : {}),
    };
  } catch {
    return null;
  }
};

const markInProgress = (status: IosMessageSetupStatus): IosMessageSetupStatus =>
  status === 'not-started' ? 'in-progress' : status;

export function reduceIosMessageSetup(
  current: IosMessageSetupProgress,
  event: IosMessageSetupEvent,
): IosMessageSetupProgress {
  switch (event.type) {
    case 'future-source-changed':
      if ((current.futureCaptureSource ?? 'message') === event.source) return current;
      return { ...current, futureCaptureSource: event.source, futureShortcutConfirmed: false, futureShortcutVersion: undefined, futureAutomationConfirmed: false, futureStatus: 'in-progress' };
    case 'active-section-changed':
      return { ...current, activeSection: event.section };
    case 'future-shortcut-install-started':
      return { ...current, futureShortcutVersion: event.version, futureShortcutConfirmed: false,
        futureAutomationConfirmed: false, futureStatus: 'in-progress' };
    case 'future-shortcut-confirmed':
      return {
        ...current,
        futureShortcutConfirmed: true,
        ...(event.version ? { futureShortcutVersion: event.version } : {}),
        futureStatus: markInProgress(current.futureStatus),
      };
    case 'future-automation-confirmed':
      return {
        ...current,
        futureAutomationConfirmed: true,
        futureStatus: markInProgress(current.futureStatus),
      };
    case 'future-status-changed':
      return { ...current, futureStatus: event.status };
    case 'history-shortcut-confirmed':
      return {
        ...current,
        historyShortcutConfirmed: true,
        historyStatus: markInProgress(current.historyStatus),
      };
    case 'history-status-changed': {
      // A fresh attempt, completion, reset or declined review supersedes the
      // earlier explicit choice. Never turn a declined review into consent.
      const next = { ...current, historyStatus: event.status };
      delete next.historySkippedForNow;
      return next;
    }
    case 'history-skipped-for-now':
      if (current.historyStatus === 'complete' ||
        !futureSetupConfigured(event.readiness, current.futureAutomationConfirmed)) return current;
      return { ...current, historyStatus: 'skipped', historySkippedForNow: true };
    case 'onboarding-started':
      return { ...current, returnToOnboarding: true };
    case 'onboarding-return-cleared':
    case 'onboarding-finished':
      return { ...current, returnToOnboarding: false };
  }
}

const reconcileHistoryShortcutConfirmation = async (
  progress: IosMessageSetupProgress,
  storage: IosMessageSetupStorage,
): Promise<IosMessageSetupProgress> => {
  if (!await isIosHistoryShortcutInstalled(storage)) return progress;
  return {
    ...progress,
    historyShortcutConfirmed: true,
    historyStatus: markInProgress(progress.historyStatus),
  };
};

// AsyncStorage has no compare-and-swap. Keep all progress reads and writes in
// one queue so a later event never reads an earlier event's stale snapshot.
let operationTail: Promise<void> = Promise.resolve();

const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = operationTail.then(operation, operation);
  operationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const loadIosMessageSetupProgressUnlocked = async (
  storage: IosMessageSetupStorage = AsyncStorage,
): Promise<IosMessageSetupProgress> => {
  const raw = await storage.getItem(IOS_MESSAGE_SETUP_PROGRESS_KEY);
  const parsed = raw === null ? null : parseProgress(raw);
  if (raw !== null && parsed === null) {
    await storage.removeItem(IOS_MESSAGE_SETUP_PROGRESS_KEY);
  }
  return reconcileHistoryShortcutConfirmation(parsed ?? { ...DEFAULT_PROGRESS }, storage);
};

export const loadIosMessageSetupProgress = async (
  storage: IosMessageSetupStorage = AsyncStorage,
): Promise<IosMessageSetupProgress> =>
  enqueue(() => loadIosMessageSetupProgressUnlocked(storage));

export const dispatchIosMessageSetup = async (
  event: IosMessageSetupEvent,
  storage: IosMessageSetupStorage = AsyncStorage,
): Promise<IosMessageSetupProgress> =>
  enqueue(async () => {
    const next = reduceIosMessageSetup(
      await loadIosMessageSetupProgressUnlocked(storage),
      event,
    );
    await storage.setItem(IOS_MESSAGE_SETUP_PROGRESS_KEY, JSON.stringify(next));
    return next;
  });

export const clearIosMessageSetupProgress = async (
  storage: IosMessageSetupStorage = AsyncStorage,
): Promise<void> =>
  enqueue(() => storage.removeItem(IOS_MESSAGE_SETUP_PROGRESS_KEY));
