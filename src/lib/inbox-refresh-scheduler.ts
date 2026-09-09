/** Source-free refresh scheduling. One provider burst earns one scan; a change
 * arriving during that scan earns a follow-up rather than being lost. */
export function createInboxRefreshScheduler(scan: () => Promise<unknown>, canScan: () => boolean,
  waitMs = 250) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;
  let disposed = false;
  const run = async () => {
    timer = null;
    if (disposed || running || !pending || !canScan()) return;
    pending = false;
    running = true;
    try { await scan(); } catch { /* The normal capture surface owns errors/retry. */ }
    finally {
      running = false;
      if (!disposed && pending && canScan()) timer = setTimeout(() => { void run(); }, waitMs);
    }
  };
  return {
    request() {
      if (disposed) return;
      pending = true;
      if (!running && timer === null && canScan()) timer = setTimeout(() => { void run(); }, waitMs);
    },
    dispose() { disposed = true; pending = false; if (timer !== null) clearTimeout(timer); timer = null; },
  };
}
