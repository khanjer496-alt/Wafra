/** Process-local cancellation. Queued optional AI work cannot cross lifecycle or ledger resets. */
// Headless launches do not run optional inference until the UI declares itself active.
let active = false;
let generation = 0;
const listeners = new Set<() => void>();

export function cancelLocalSemanticBackgroundWork(): void {
  generation++;
  for (const listener of listeners) listener();
}

export function setLocalSemanticAppActive(value: boolean): void {
  if (active === value) return;
  active = value;
  if (!active) cancelLocalSemanticBackgroundWork();
}

export function localSemanticBackgroundCancellation(): () => boolean {
  const started = generation;
  return () => !active || generation !== started;
}

export function onLocalSemanticBackgroundCancelled(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}


/** Yield before optional preparation phases, then recheck lifecycle and navigation. */
export async function waitForLocalSemanticPreparation(
  cancelled: () => boolean, waitForIdle: () => Promise<void>,
): Promise<void> {
  if (cancelled()) throw new Error('local-semantic-runtime:cancelled');
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  if (cancelled()) throw new Error('local-semantic-runtime:cancelled');
  await waitForIdle();
  if (cancelled()) throw new Error('local-semantic-runtime:cancelled');
}

export const isLocalSemanticPreparationCancelled = (error: unknown): boolean =>
  error instanceof Error && error.message === 'local-semantic-runtime:cancelled';

export function createLocalSemanticPreparationController(background: boolean, waitForIdle: () => Promise<void>) {
  const lifecycleCancelled = localSemanticBackgroundCancellation();
  let optional = background;
  let promote!: () => void;
  const promoted = new Promise<void>(resolve => { promote = resolve; });
  const cancelled = () => optional && lifecycleCancelled();
  return {
    cancelled,
    promote(): void { optional = false; promote(); },
    async checkpoint(): Promise<void> {
      if (!optional) return;
      await Promise.race([waitForLocalSemanticPreparation(cancelled, waitForIdle), promoted]);
      if (cancelled()) throw new Error('local-semantic-runtime:cancelled');
    },
  };
}

export type LocalSemanticPreparationController = ReturnType<typeof createLocalSemanticPreparationController>;

/** Interactive callers promote the same preparation; a cancelled attempt settles before one retry. */
export function createLocalSemanticPreparationFlight<T>(
  prepare: (controller: LocalSemanticPreparationController) => Promise<T>, waitForIdle: () => Promise<void>,
) {
  let current: { controller: LocalSemanticPreparationController; promise: Promise<T> } | null = null;
  const get = (background = false, retryCancelled = true): Promise<T> => {
    if (!current) {
      const controller = createLocalSemanticPreparationController(background, waitForIdle);
      const entry = { controller, promise: undefined as unknown as Promise<T> };
      current = entry;
      entry.promise = Promise.resolve().then(() => prepare(controller)).catch(error => {
        if (current === entry) current = null;
        throw error;
      });
    }
    const entry = current;
    if (!background) entry.controller.promote();
    return !background && retryCancelled ? entry.promise.catch(error => {
      if (isLocalSemanticPreparationCancelled(error)) return get(false, false);
      throw error;
    }) : entry.promise;
  };
  return { get, clear: () => { current = null; } };
}


/** Keep a preparation attempt alive until every writer has released its artifact path. */
export async function settleLocalSemanticArtifacts<T>(tasks: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(tasks);
  const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
  return settled.map(result => (result as PromiseFulfilledResult<T>).value);
}
