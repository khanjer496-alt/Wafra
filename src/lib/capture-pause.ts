/**
 * "Bank texts seem to have stopped" — a deliberately conservative check.
 *
 * Wafra cannot see the inbox, only the captures that reached the ledger. A
 * quiet week can be a holiday, a cash week or a new card, so a false alarm is
 * worse than a late one. The rule therefore needs:
 *
 *   - at least 14 days between the first and the latest live capture it can
 *     see (a new user has no "usual" yet),
 *   - at least MIN_CAPTURES live captures in the recent window,
 *   - a current silence longer than max(3 days, 3 × the person's typical gap
 *     between captures), where "typical" is the median gap in the window.
 *
 * "I was away" is recorded as a timestamp and treated as if a capture had
 * arrived then: the banner returns only if the silence continues past the
 * same threshold measured from that moment. Nothing here reads message text.
 *
 * Pure and dependency-free so the date arithmetic is testable on its own.
 */

export const DAY_MS = 86_400_000;
/** History needed before a "usual" rhythm exists. */
export const MIN_HISTORY_MS = 14 * DAY_MS;
/** Floor on the silence that can ever count as stopped. */
export const MIN_SILENCE_MS = 3 * DAY_MS;
/** How much longer than usual the silence must be. */
export const GAP_MULTIPLIER = 3;
/** Captures needed in the window for a median to mean anything. */
export const MIN_CAPTURES = 6;
/** Rhythm is read from recent captures only; habits change. */
export const RHYTHM_WINDOW_MS = 90 * DAY_MS;
/** A clock skewed into the future is not evidence of a recent capture. */
const FUTURE_TOLERANCE_MS = DAY_MS;

export type CaptureRhythm = 'several-a-day' | 'about-daily' | 'every-few-days';

export interface CapturePauseInput {
  /** Epoch ms of live captures (bank text, app alert, Apple Pay). Any order. */
  captureTimes: readonly number[];
  nowMs: number;
  /** When the person last said "I was away", or null. */
  snoozedAtMs: number | null;
}

export interface CapturePause {
  stopped: boolean;
  lastCaptureMs: number;
  /** Whole days since the last capture (not since the snooze). */
  silentDays: number;
  typicalGapMs: number;
  thresholdMs: number;
  rhythm: CaptureRhythm;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function captureRhythm(typicalGapMs: number): CaptureRhythm {
  if (typicalGapMs <= DAY_MS / 2) return 'several-a-day';
  if (typicalGapMs <= DAY_MS * 1.5) return 'about-daily';
  return 'every-few-days';
}

/**
 * Null when there is not enough history to say anything. Otherwise the
 * measured rhythm and whether the current silence is long enough to mention.
 */
export function detectCapturePause(input: CapturePauseInput): CapturePause | null {
  const { nowMs } = input;
  if (!Number.isFinite(nowMs)) return null;
  const times = input.captureTimes
    .filter((ms) => Number.isFinite(ms) && ms > 0 && ms <= nowMs + FUTURE_TOLERANCE_MS)
    .sort((a, b) => a - b);
  if (times.length < MIN_CAPTURES) return null;
  const first = times[0]!;
  const last = times[times.length - 1]!;
  if (last - first < MIN_HISTORY_MS) return null;

  const windowStart = last - RHYTHM_WINDOW_MS;
  const recent = times.filter((ms) => ms >= windowStart);
  if (recent.length < MIN_CAPTURES) return null;
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i += 1) gaps.push(recent[i]! - recent[i - 1]!);
  const typicalGapMs = median(gaps);
  const thresholdMs = Math.max(MIN_SILENCE_MS, GAP_MULTIPLIER * typicalGapMs);

  const snooze = input.snoozedAtMs !== null && Number.isFinite(input.snoozedAtMs) && input.snoozedAtMs <= nowMs
    ? input.snoozedAtMs : null;
  const quietSince = snooze !== null && snooze > last ? snooze : last;
  const silence = nowMs - quietSince;
  return {
    stopped: silence > thresholdMs,
    lastCaptureMs: last,
    silentDays: Math.max(0, Math.floor((nowMs - last) / DAY_MS)),
    typicalGapMs,
    thresholdMs,
    rhythm: captureRhythm(typicalGapMs),
  };
}
