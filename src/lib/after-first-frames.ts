/**
 * Work a screen wants done soon, but not in the frames that show it.
 *
 * `InteractionManager.runAfterInteractions` is a `setImmediate` in React
 * Native 0.83 (it no longer waits for anything), so Home's "deferred"
 * projections ran the tick after its first commit, on top of the entrance
 * motion and the resume. This waits for two real frames (the first is the
 * commit, the second has been drawn), a short settle, and then for the
 * foreground lease (foreground-history-priority.ts) that a tap, a tab switch
 * or Home's entrance holds, so the work starts once the screen is quiet.
 *
 * Frames do not run while the app is in the background, so work queued as
 * the app leaves waits for its return rather than running unseen.
 */
import { waitForForegroundHistoryIdle } from '@/lib/foreground-history-priority';

/** The settle after the second frame, before the foreground lease is checked. */
export const AFTER_FIRST_FRAMES_DELAY_MS = 120;

export interface AfterFirstFramesOptions {
  /** The settle after the two frames, in ms (default AFTER_FIRST_FRAMES_DELAY_MS). */
  delayMs?: number;
  /** Also wait out the foreground lease. Default true. */
  idle?: boolean;
}

export interface DeferredWork {
  cancel(): void;
}

export function runAfterFirstFrames(task: () => void, options: AfterFirstFramesOptions = {}): DeferredWork {
  const delayMs = Math.max(0, options.delayMs ?? AFTER_FIRST_FRAMES_DELAY_MS);
  const idle = options.idle !== false;
  let cancelled = false;
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const nextFrame = (then: () => void) => {
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(() => { frame = null; then(); });
    } else {
      timer = setTimeout(() => { timer = null; then(); }, 16);
    }
  };
  const run = () => { if (!cancelled) task(); };
  nextFrame(() => nextFrame(() => {
    if (cancelled) return;
    timer = setTimeout(() => {
      timer = null;
      if (cancelled) return;
      if (idle) void waitForForegroundHistoryIdle().then(run);
      else run();
    }, delayMs);
  }));
  return {
    cancel() {
      cancelled = true;
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      frame = null;
      timer = null;
    },
  };
}

/**
 * The next turn, without waiting for frames or the lease: what
 * `runAfterInteractions` amounted to. For recomputing after an edit on a
 * screen that is already shown, where waiting would leave stale figures up.
 */
export function runSoon(task: () => void): DeferredWork {
  let cancelled = false;
  const run = () => { if (!cancelled) task(); };
  if (typeof setImmediate === 'function') {
    const handle = setImmediate(run);
    return { cancel() { cancelled = true; clearImmediate(handle); } };
  }
  const timer = setTimeout(run, 0);
  return { cancel() { cancelled = true; clearTimeout(timer); } };
}

/** The same wait as a promise, for async work. */
export function afterFirstFrames(options?: AfterFirstFramesOptions): Promise<void> {
  return new Promise((resolve) => { runAfterFirstFrames(resolve, options); });
}
