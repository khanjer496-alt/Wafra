import { AppRegistry, AppState, Platform } from 'react-native';
import SmsReader from '../../modules/sms-reader';

interface HistoryNativeLease {
  startHistoryImport?(id: string): Promise<boolean>;
  isHistoryImportRunning?(id: string): boolean;
  stopHistoryImport?(id: string): Promise<void>;
}

/** The headless task keeps timers alive; it NEVER creates a second store or parser. */
export function createHistoryBackgroundRunner(native: HistoryNativeLease | null, isForeground: () => boolean) {
  let sequence = 0;
  let lease: { id: string; started: boolean; cancelled: boolean; done: Promise<void>; release(): void } | null = null;
  let inFlight: Promise<void> | null = null;

  const canContinue = (): boolean => {
    if (!lease || lease.cancelled) return false;
    // A service which was started but then stopped means Pause/timeout, not a
    // reason to silently continue in the foreground after a notification Pause.
    if (lease.started) {
      try { return native?.isHistoryImportRunning?.(lease.id) === true; }
      catch { return false; }
    }
    return isForeground(); // Compatibility with older installed binaries.
  };

  const run = (job: () => Promise<unknown>, canStart: () => boolean): Promise<void> => {
    if (inFlight) return lease?.cancelled
      ? inFlight.then(() => run(job, canStart)) : inFlight;
    if (!isForeground() || !canStart()) return Promise.resolve();
    let release!: () => void;
    const current = {
      id: `history-${Date.now()}-${++sequence}`, started: false, cancelled: false,
      done: new Promise<void>((resolve) => { release = resolve; }), release: () => release(),
    };
    lease = current;
    const operation = Promise.resolve().then(async () => {
      try {
        if (native?.startHistoryImport && native.isHistoryImportRunning && native.stopHistoryImport) {
          try { current.started = await native.startHistoryImport(current.id); }
          catch { current.started = false; }
        }
        if (!current.cancelled && canStart()) await job();
      } finally {
        current.cancelled = true;
        current.release();
        // Token matching on the native side prevents a late cleanup stopping a new import.
        try { await native?.stopHistoryImport?.(current.id); } catch { /* Saved page remains retryable. */ }
        if (lease === current) lease = null;
        if (inFlight === operation) inFlight = null;
      }
    });
    inFlight = operation;
    return operation;
  };

  return {
    run, canContinue,
    waitForTask: (id: unknown): Promise<void> => lease && lease.id === id ? lease.done : Promise.resolve(),
    cancel: () => {
      if (!lease) return;
      lease.cancelled = true;
      lease.release();
      void native?.stopHistoryImport?.(lease.id).catch(() => {});
    },
  };
}

export const historyBackground = createHistoryBackgroundRunner(
  Platform.OS === 'android' ? SmsReader : null, () => AppState.currentState === 'active',
);

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('WafraHistoryImport', () => (data: { sessionId?: unknown }) =>
    historyBackground.waitForTask(data.sessionId));
}
