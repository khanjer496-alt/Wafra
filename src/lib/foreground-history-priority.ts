/**
 * Foreground history import is maintenance work. Main navigation is not.
 *
 * Hermes still executes the SMS parser on the JS thread. Cooperative parser
 * yields keep individual slices short, but a fixed timer cannot know that the
 * user has just started a tab transition. This process-local lease lets
 * touch/navigation code reserve the JS thread for a short quiet window. Rapid
 * taps extend the same deadline instead of queueing timers.
 */
const DEFAULT_NAVIGATION_QUIET_MS = 900;

let blockedUntil = 0;

export function prioritizeForegroundNavigation(
  quietMs = DEFAULT_NAVIGATION_QUIET_MS,
  now = Date.now(),
): void {
  if (!Number.isFinite(quietMs) || quietMs <= 0) return;
  blockedUntil = Math.max(blockedUntil, now + quietMs);
}

export function foregroundHistoryBlockedFor(now = Date.now()): number {
  return Math.max(0, blockedUntil - now);
}

/**
 * Yield at least `minimumMs`, and longer when navigation extended the lease
 * while this task was sleeping. The minimum deadline is computed only once.
 */
export async function waitForForegroundHistoryIdle(minimumMs = 0): Promise<void> {
  const earliestResume = Date.now() + Math.max(0, minimumMs);
  for (;;) {
    const resumeAt = Math.max(earliestResume, blockedUntil);
    const remaining = resumeAt - Date.now();
    if (remaining <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }
}

