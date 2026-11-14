/**
 * One pending, deferred scan request that never loses a wake-up.
 *
 * On iPhone the launch scan and every return to `active` ran the whole inbox
 * scan the moment they fired, on top of Home's first frames and entrance
 * motion. This wraps the "run it later" half: a request schedules the scan
 * through `schedule` (the app passes runAfterFirstFrames, which waits for real
 * frames and the foreground lease), further requests while one is pending
 * join it, and the scan still runs once after the LAST request. Nothing is
 * dropped: the scan reads the whole native queue, so one scan after the last
 * request covers every earlier one. Only cancel() (the screen is leaving)
 * discards a pending request, and the next mount or `active` event asks again.
 */
interface DeferredScan {
  /** Ask for a scan; joins one that is already pending. */
  request(): void;
  /** Drop a pending request (the owner is unmounting). */
  cancel(): void;
  /** True while a scan has been requested and has not started yet. */
  pending(): boolean;
}

export function createDeferredScan(
  schedule: (run: () => void) => { cancel(): void },
  scan: () => void,
): DeferredScan {
  let task: { cancel(): void } | null = null;
  let waiting = false;
  return {
    request() {
      if (waiting) return;
      waiting = true;
      // A scheduler may call back before it returns its handle.
      let ranBeforeHandle = false;
      const handle = schedule(() => {
        if (!waiting) return;
        waiting = false;
        task = null;
        ranBeforeHandle = true;
        scan();
      });
      if (!ranBeforeHandle) task = handle;
    },
    cancel() {
      waiting = false;
      if (task) task.cancel();
      task = null;
    },
    pending() {
      return waiting;
    },
  };
}
