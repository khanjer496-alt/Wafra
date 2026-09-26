import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The single "Add Wafra to your Home Screen" hint on Home.
 *
 * It appears once someone has lived with automatic capture for a week, and
 * never again after they dismiss it or open the Widgets screen (from the
 * hint or from Settings). The rule is pure (`widgetsHintEligible`) and the
 * "done" mark is a UI preference beside the other Home preferences
 * (capture-pause-state, recap-view-state): one word and a timestamp, no
 * ledger data. A failed read keeps the hint hidden; a failed write only means
 * it may show again.
 */
const STORAGE_KEY = 'wafra/ui/widgets-hint/v1';

export const WIDGETS_HINT_MIN_DAYS = 7;

export type WidgetsHintDone = 'dismissed' | 'opened';

export interface WidgetsHintInput {
  hydrated: boolean;
  onboarded: boolean;
  /** Automatic capture is set up and expected to be delivering. */
  captureSetUp: boolean;
  /** Home's "bank texts seem to have stopped" notice is showing. */
  captureStopped: boolean;
  /** The first-week progress card, a history import or the "fill in the past" offer is on Home. */
  firstDays: boolean;
  /** Local date (YYYY-MM-DD) of the oldest automatically captured entry, or null. */
  oldestCaptureISO: string | null;
  /** Local date (YYYY-MM-DD) today. */
  todayISO: string;
  /** Widgets exist on this platform (not web). */
  platformHasWidgets: boolean;
  /** Stored mark; `undefined` while it is still being read. */
  done: WidgetsHintDone | null | undefined;
}

function dayIndex(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}

/** Whole local days between two YYYY-MM-DD dates, or null when either is malformed. */
export function daysBetweenISO(fromISO: string, toISO: string): number | null {
  const from = dayIndex(fromISO);
  const to = dayIndex(toISO);
  return from === null || to === null ? null : to - from;
}

export function widgetsHintEligible(input: WidgetsHintInput): boolean {
  if (!input.platformHasWidgets || !input.hydrated || !input.onboarded) return false;
  // Still reading the mark, or already dismissed/opened.
  if (input.done !== null) return false;
  if (!input.captureSetUp || input.captureStopped || input.firstDays) return false;
  if (input.oldestCaptureISO === null) return false;
  const days = daysBetweenISO(input.oldestCaptureISO, input.todayISO);
  return days !== null && days >= WIDGETS_HINT_MIN_DAYS;
}

/**
 * Oldest automatically captured entry's local date. `isLive` is the shared
 * transaction-source rule (bank text, app alert, Apple Pay); statement and
 * manual rows are not "captured history".
 */
export function oldestLiveCaptureISO<T extends { date: string }>(
  transactions: readonly T[],
  isLive: (transaction: T) => boolean,
): string | null {
  let oldest: string | null = null;
  for (const transaction of transactions) {
    if (!isLive(transaction)) continue;
    if (oldest === null || transaction.date < oldest) oldest = transaction.date;
  }
  return oldest;
}

export async function loadWidgetsHintDone(): Promise<WidgetsHintDone | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { done?: unknown };
    return parsed?.done === 'dismissed' || parsed?.done === 'opened' ? parsed.done : null;
  } catch {
    // Unreadable: behave as done so a broken preference never nags.
    return 'dismissed';
  }
}

const listeners = new Set<(done: WidgetsHintDone) => void>();

/** Told when the hint is marked done anywhere (Settings opening Widgets while Home stays mounted). */
export function subscribeWidgetsHintDone(listener: (done: WidgetsHintDone) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function markWidgetsHintDone(done: WidgetsHintDone, atMs = Date.now()): Promise<void> {
  for (const listener of [...listeners]) listener(done);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ done, at: Math.round(atMs) }));
  } catch {
    // Cosmetic preference; never block Home or the Widgets screen on it.
  }
}
