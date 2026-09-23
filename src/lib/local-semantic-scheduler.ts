export interface LocalSemanticEncodeOptions {
  priority?: 'interactive' | 'background';
  cancelled?: () => boolean;
}

/** One native session at a time; questions take precedence over queued diagnostics. */
export function createLocalSemanticScheduler(maxPending = 32, policy: { backgroundBlockedFor?: () => number; backgroundGapMs?: number } = {}) {
  const queue: { priority: 'interactive' | 'background'; run: () => Promise<void>; cancelled: () => boolean }[] = [];
  let running = false;
  let wake: ReturnType<typeof setTimeout> | null = null;
  let backgroundResumeAt = 0;
  const drain = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const interactive = queue.findIndex((job) => job.priority === 'interactive');
        const index = interactive < 0 ? 0 : interactive;
        const next = queue[index];
        const blocked = interactive < 0 && !next.cancelled()
          ? Math.max(policy.backgroundBlockedFor?.() ?? 0, backgroundResumeAt - Date.now()) : 0;
        if (blocked > 0) {
          // Do not await an idle lease while holding the session lock: a new
          // interactive question must be able to bypass this sleeping job.
          wake ??= setTimeout(() => { wake = null; void drain(); }, Math.min(blocked, 50));
          break;
        }
        queue.splice(index, 1);
        await next.run();
        if (next.priority === 'background') backgroundResumeAt = Date.now() + (policy.backgroundGapMs ?? 0);
      }
    } finally {
      running = false;
    }
  };
  return <T>(work: () => Promise<T>, options: LocalSemanticEncodeOptions = {}): Promise<T> => {
    if (queue.length >= maxPending) return Promise.reject(new Error('local-semantic-runtime:queue-full'));
    return new Promise<T>((resolve, reject) => {
      queue.push({
        priority: options.priority ?? 'interactive',
        cancelled: () => options.cancelled?.() ?? false,
        run: async () => {
          try {
            if (options.cancelled?.()) throw new Error('local-semantic-runtime:cancelled');
            const value = await work();
            if (options.cancelled?.()) throw new Error('local-semantic-runtime:cancelled');
            resolve(value);
          } catch (error) {
            reject(error);
          }
        },
      });
      void drain();
    });
  };
}
