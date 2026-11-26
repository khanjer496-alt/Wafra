/**
 * Mount the hidden iOS tabs once each, one at a time, after launch has gone
 * quiet, so a tab's first open is a reveal of an already rendered screen
 * instead of a cold mount on the tap (ios-tab-gate.tsx).
 *
 * Each tab waits for two real frames, TAB_PREWARM_DELAY_MS, and the
 * foreground lease (a tap, a tab switch, Home's entrance). The lease is checked
 * again right before the mount; if the user has tapped since, the tab waits for
 * another slot. The next tab waits again after that, so pre-warming never runs
 * during launch, never mounts two tabs in one frame, and never starts under
 * the user's finger. The mount itself is a transition (ios-tab-gate.tsx), so
 * React yields it to a tap that arrives while it renders.
 */
import { runAfterFirstFrames, type DeferredWork } from '@/lib/after-first-frames';
import { TAB_PREWARM_DELAY_MS } from '@/lib/covered-screen-freeze';
import { foregroundHistoryBlockedFor } from '@/lib/foreground-history-priority';

interface PrewarmJob {
  run: () => void;
  cancelled: boolean;
}

const queue: PrewarmJob[] = [];
let pending: DeferredWork | null = null;

function pump(): void {
  while (queue.length && queue[0].cancelled) queue.shift();
  if (pending || !queue.length) return;
  pending = runAfterFirstFrames(() => {
    pending = null;
    // A tap since the slot opened: give the screen back and try again later.
    if (foregroundHistoryBlockedFor() > 0) {
      pump();
      return;
    }
    const job = queue.shift();
    if (job && !job.cancelled) job.run();
    pump();
  }, { delayMs: TAB_PREWARM_DELAY_MS });
}

/** Queue one hidden tab's first mount. `cancel` drops it (the tab was opened, or unmounted). */
export function scheduleTabPrewarm(run: () => void): { cancel(): void } {
  const job: PrewarmJob = { run, cancelled: false };
  queue.push(job);
  pump();
  return {
    cancel() {
      job.cancelled = true;
    },
  };
}
