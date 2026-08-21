export const FOUNDER_TAPS_REQUIRED = 5;
export const FOUNDER_TAP_WINDOW_MS = 4_000;

const FOUNDER_UNLOCK_ENABLED =
  process.env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK === '1';

export interface FounderTapSequence {
  count: number;
  lastTapMs: number;
}

export interface FounderTapResult {
  next: FounderTapSequence;
  unlocked: boolean;
}

export const EMPTY_FOUNDER_TAP_SEQUENCE: FounderTapSequence = {
  count: 0,
  lastTapMs: 0,
};

/** Build-time gate. Production profiles compile the founder gesture closed. */
export const isFounderUnlockBuild = (): boolean => FOUNDER_UNLOCK_ENABLED;

/** Count one bounded burst of taps without retaining timers or user data. */
export const recordFounderTap = (
  previous: FounderTapSequence,
  nowMs: number,
): FounderTapResult => {
  const consecutive =
    nowMs >= previous.lastTapMs &&
    nowMs - previous.lastTapMs <= FOUNDER_TAP_WINDOW_MS;
  const count = consecutive ? previous.count + 1 : 1;
  if (count < FOUNDER_TAPS_REQUIRED) {
    return { next: { count, lastTapMs: nowMs }, unlocked: false };
  }
  return { next: EMPTY_FOUNDER_TAP_SEQUENCE, unlocked: true };
};
