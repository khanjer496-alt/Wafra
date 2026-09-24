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
export type IosCaptureSource = 'message' | 'notification' | 'apple-pay';

/**
 * Self-confirmed setup for a capture source that is NOT the recorded one.
 * Opening another source's setup screen never erases the recorded source's
 * finished progress; switching the recorded source parks it here instead.
 */
export interface IosParkedSourceProgress {
  shortcutConfirmed: boolean;
  shortcutVersion?: 3;
  automationConfirmed: boolean;
  automationConfirmedAt?: number;
  attemptStartedAt?: number;
  automationRelink?: true;
}

export interface IosMessageSetupProgress {
  version: 1;
  activeSection: IosMessageSetupSection;
  futureShortcutConfirmed: boolean;
  futureShortcutVersion?: 3;
  futureAutomationConfirmed: boolean;
  /** When the owner last confirmed the automation (device clock, ms). */
  futureAutomationConfirmedAt?: number;
  /**
   * Start of the latest install or setup-check attempt (device clock, ms).
   * Native proof older than this belongs to an earlier attempt, so setup
   * cannot present it as the result of the current one.
   */
  futureAttemptStartedAt?: number;
  /**
   * An upgraded Shortcut still needs the existing automation pointed at it.
   * Setup-only: the older automation keeps capturing, so Home is unaffected.
   */
  futureAutomationRelink?: true;
  futureStatus: IosMessageSetupStatus;
  /** Missing in legacy progress means Message automation. */
  futureCaptureSource?: IosCaptureSource;
  /** Progress kept for sources other than the recorded one. */
  parkedSources?: Partial<Record<IosCaptureSource, IosParkedSourceProgress>>;
  historyShortcutConfirmed: boolean;
  historyStatus: IosMessageSetupStatus;
  /** Explicit future-only choice. Absent on older progress and declined reviews. */
  historySkippedForNow?: boolean;
  returnToOnboarding: boolean;
}

export type IosMessageSetupEvent =
  | { type: 'active-section-changed'; section: IosMessageSetupSection }
  | { type: 'future-shortcut-install-started'; version?: 3; source?: IosCaptureSource; at?: number }
  | { type: 'future-check-started'; at: number; source?: IosCaptureSource }
  | { type: 'future-shortcut-confirmed'; version?: 3; source?: IosCaptureSource }
  | { type: 'future-automation-confirmed'; source?: IosCaptureSource; at?: number }
  | { type: 'future-status-changed'; status: IosMessageSetupStatus }
  | { type: 'future-source-changed'; source: IosCaptureSource }
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

const OPTIONAL_KEYS = new Set([
  'historySkippedForNow', 'futureCaptureSource', 'futureShortcutVersion',
  'futureAutomationConfirmedAt', 'futureAttemptStartedAt', 'futureAutomationRelink', 'parkedSources',
]);

const SOURCES: readonly IosCaptureSource[] = ['message', 'notification', 'apple-pay'];
const isSource = (value: unknown): value is IosCaptureSource =>
  SOURCES.includes(value as IosCaptureSource);
const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isStatus = (value: unknown): value is IosMessageSetupStatus =>
  value === 'not-started' ||
  value === 'in-progress' ||
  value === 'complete' ||
  value === 'skipped';

const PARKED_KEYS = new Set([
  'shortcutConfirmed', 'shortcutVersion', 'automationConfirmed',
  'automationConfirmedAt', 'attemptStartedAt', 'automationRelink',
]);

const parseParked = (value: unknown): IosParkedSourceProgress | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !PARKED_KEYS.has(key)) ||
    typeof candidate.shortcutConfirmed !== 'boolean' ||
    typeof candidate.automationConfirmed !== 'boolean' ||
    ('shortcutVersion' in candidate && candidate.shortcutVersion !== 3) ||
    ('automationConfirmedAt' in candidate && !isTimestamp(candidate.automationConfirmedAt)) ||
    ('attemptStartedAt' in candidate && !isTimestamp(candidate.attemptStartedAt)) ||
    ('automationRelink' in candidate && candidate.automationRelink !== true)) return null;
  return {
    shortcutConfirmed: candidate.shortcutConfirmed,
    automationConfirmed: candidate.automationConfirmed,
    ...(candidate.shortcutVersion === 3 ? { shortcutVersion: 3 as const } : {}),
    ...(isTimestamp(candidate.automationConfirmedAt) ? { automationConfirmedAt: candidate.automationConfirmedAt } : {}),
    ...(isTimestamp(candidate.attemptStartedAt) ? { attemptStartedAt: candidate.attemptStartedAt } : {}),
    ...(candidate.automationRelink === true ? { automationRelink: true as const } : {}),
  };
};

const parseParkedSources = (value: unknown): IosMessageSetupProgress['parkedSources'] | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: NonNullable<IosMessageSetupProgress['parkedSources']> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isSource(key)) return null;
    const parsed = parseParked(entry);
    if (!parsed) return null;
    result[key] = parsed;
  }
  return result;
};

const parseProgress = (raw: string): IosMessageSetupProgress | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate).filter((key) => !OPTIONAL_KEYS.has(key)).sort();
    const parked = 'parkedSources' in candidate ? parseParkedSources(candidate.parkedSources) : undefined;
    if (
      keys.length !== PROGRESS_KEYS.length ||
      keys.some((key, index) => key !== PROGRESS_KEYS[index]) ||
      candidate.version !== 1 ||
      (candidate.activeSection !== 'future' && candidate.activeSection !== 'history') ||
      typeof candidate.futureShortcutConfirmed !== 'boolean' ||
      ('futureShortcutVersion' in candidate && candidate.futureShortcutVersion !== 3) ||
      typeof candidate.futureAutomationConfirmed !== 'boolean' ||
      ('futureAutomationConfirmedAt' in candidate && !isTimestamp(candidate.futureAutomationConfirmedAt)) ||
      ('futureAttemptStartedAt' in candidate && !isTimestamp(candidate.futureAttemptStartedAt)) ||
      ('futureAutomationRelink' in candidate && candidate.futureAutomationRelink !== true) ||
      !isStatus(candidate.futureStatus) ||
      ('futureCaptureSource' in candidate && !isSource(candidate.futureCaptureSource)) ||
      parked === null ||
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
      ...(isTimestamp(candidate.futureAutomationConfirmedAt) ? { futureAutomationConfirmedAt: candidate.futureAutomationConfirmedAt } : {}),
      ...(isTimestamp(candidate.futureAttemptStartedAt) ? { futureAttemptStartedAt: candidate.futureAttemptStartedAt } : {}),
      ...(candidate.futureAutomationRelink === true ? { futureAutomationRelink: true as const } : {}),
      futureStatus: candidate.futureStatus,
      ...(isSource(candidate.futureCaptureSource) ? { futureCaptureSource: candidate.futureCaptureSource } : {}),
      ...(parked && Object.keys(parked).length ? { parkedSources: parked } : {}),
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

export const recordedIosCaptureSource = (
  progress: Pick<IosMessageSetupProgress, 'futureCaptureSource'>,
): IosCaptureSource => progress.futureCaptureSource ?? 'message';

const EMPTY_PARKED: IosParkedSourceProgress = { shortcutConfirmed: false, automationConfirmed: false };

const parkRecorded = (current: IosMessageSetupProgress): IosParkedSourceProgress => ({
  shortcutConfirmed: current.futureShortcutConfirmed,
  automationConfirmed: current.futureAutomationConfirmed,
  ...(current.futureShortcutVersion ? { shortcutVersion: current.futureShortcutVersion } : {}),
  ...(current.futureAutomationConfirmedAt !== undefined ? { automationConfirmedAt: current.futureAutomationConfirmedAt } : {}),
  ...(current.futureAttemptStartedAt !== undefined ? { attemptStartedAt: current.futureAttemptStartedAt } : {}),
  ...(current.futureAutomationRelink ? { automationRelink: true as const } : {}),
});

/** Replace the top-level future fields; never leaves stale optional fields behind. */
const withFuture = (
  current: IosMessageSetupProgress,
  value: IosParkedSourceProgress,
): IosMessageSetupProgress => {
  const next: IosMessageSetupProgress = { ...current,
    futureShortcutConfirmed: value.shortcutConfirmed, futureAutomationConfirmed: value.automationConfirmed };
  delete next.futureShortcutVersion;
  delete next.futureAutomationConfirmedAt;
  delete next.futureAttemptStartedAt;
  delete next.futureAutomationRelink;
  if (value.shortcutVersion) next.futureShortcutVersion = value.shortcutVersion;
  if (value.automationConfirmedAt !== undefined) next.futureAutomationConfirmedAt = value.automationConfirmedAt;
  if (value.attemptStartedAt !== undefined) next.futureAttemptStartedAt = value.attemptStartedAt;
  if (value.automationRelink) next.futureAutomationRelink = true;
  return next;
};

const withParked = (
  current: IosMessageSetupProgress,
  source: IosCaptureSource,
  value: IosParkedSourceProgress | undefined,
): IosMessageSetupProgress => {
  const parked = { ...(current.parkedSources ?? {}) };
  if (value) parked[source] = value; else delete parked[source];
  const next = { ...current };
  if (Object.keys(parked).length) next.parkedSources = parked; else delete next.parkedSources;
  return next;
};

/** Make `source` the recorded source, parking (never erasing) the previous one. */
const switchRecorded = (current: IosMessageSetupProgress, source: IosCaptureSource): IosMessageSetupProgress => {
  const previous = recordedIosCaptureSource(current);
  if (previous === source) return current;
  const restored = current.parkedSources?.[source] ?? EMPTY_PARKED;
  const parked = withParked(withParked(current, previous, parkRecorded(current)), source, undefined);
  return { ...withFuture(parked, restored), futureCaptureSource: source };
};

/**
 * The saved future progress of one source, shaped like the recorded fields.
 * Setup screens read a source through this so viewing one source can never
 * reinterpret, or be written over by, another source's confirmations.
 */
export const progressForSource = (
  progress: IosMessageSetupProgress,
  source: IosCaptureSource,
): IosMessageSetupProgress => {
  if (recordedIosCaptureSource(progress) === source) return progress;
  const parked = progress.parkedSources?.[source] ?? EMPTY_PARKED;
  return { ...withFuture(progress, parked), futureCaptureSource: source,
    futureStatus: parked.automationConfirmed ? 'complete' : parked.shortcutConfirmed ? 'in-progress' : 'not-started' };
};

/** Apply a source-scoped change to the recorded fields or to the parked source. */
const updateSource = (
  current: IosMessageSetupProgress,
  source: IosCaptureSource | undefined,
  update: (value: IosParkedSourceProgress) => IosParkedSourceProgress,
): IosMessageSetupProgress => {
  const target = source ?? recordedIosCaptureSource(current);
  if (target === recordedIosCaptureSource(current)) {
    return { ...withFuture(current, update(parkRecorded(current))),
      futureStatus: markInProgress(current.futureStatus) };
  }
  return withParked(current, target, update(current.parkedSources?.[target] ?? EMPTY_PARKED));
};

export function reduceIosMessageSetup(
  current: IosMessageSetupProgress,
  event: IosMessageSetupEvent,
): IosMessageSetupProgress {
  switch (event.type) {
    case 'future-source-changed': {
      // An explicit source switch parks the previous source's progress
      // instead of erasing it, so switching back restores a finished setup.
      if (recordedIosCaptureSource(current) === event.source) return current;
      return { ...switchRecorded(current, event.source), futureStatus: 'in-progress' };
    }
    case 'active-section-changed':
      return { ...current, activeSection: event.section };
    case 'future-shortcut-install-started':
      // A reinstall starts a new attempt but keeps the automation the owner
      // already confirmed: Home stays as it was until a new check succeeds.
      // Upgrading from an older Shortcut asks for the automation to be
      // pointed at the new one, in setup only.
      return updateSource(current, event.source, (value) => {
        const upgrading = value.automationConfirmed && event.version === 3 && value.shortcutVersion !== 3;
        const next: IosParkedSourceProgress = { ...value, shortcutConfirmed: false };
        delete next.shortcutVersion;
        if (event.version) next.shortcutVersion = event.version;
        if (event.at !== undefined) next.attemptStartedAt = event.at;
        if (upgrading) next.automationRelink = true;
        return next;
      });
    case 'future-check-started':
      return updateSource(current, event.source, (value) => ({ ...value, attemptStartedAt: event.at }));
    case 'future-shortcut-confirmed':
      return updateSource(current, event.source, (value) => ({
        ...value,
        shortcutConfirmed: true,
        ...(event.version ? { shortcutVersion: event.version } : {}),
      }));
    case 'future-automation-confirmed': {
      // Only a confirmed automation may become the recorded source that Home
      // reports; the previously recorded source's progress is parked.
      const switched = event.source ? switchRecorded(current, event.source) : current;
      return updateSource(switched, undefined, (value) => {
        const confirmed: IosParkedSourceProgress = { ...value, automationConfirmed: true };
        delete confirmed.automationRelink;
        if (event.at !== undefined) confirmed.automationConfirmedAt = event.at;
        return confirmed;
      });
    }
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
