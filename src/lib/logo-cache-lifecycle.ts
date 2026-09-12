import AsyncStorage from '@react-native-async-storage/async-storage';

// These namespaces include old cache versions, even if a resolver has not
// loaded this session. Do not clear unrelated AsyncStorage keys or image caches.
const CACHE_PREFIXES = ['wafra:merchant-logo:', 'wafra:bank-logo:'];
const resetters = new Set<() => void>();
let generation = 0;
let erasesInProgress = 0;
let mutationQueue: Promise<unknown> = Promise.resolve();

function serialiseMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(task, task);
  mutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** Module-owned memory and pending maps must be discarded at an erase boundary. */
export function registerLogoCacheReset(reset: () => void): void {
  resetters.add(reset);
}

/** Null prevents new lookups while the complete ledger erase is running. */
export function logoCacheGeneration(): number | null {
  return erasesInProgress > 0 ? null : generation;
}

export function isLogoCacheGenerationCurrent(started: number): boolean {
  return erasesInProgress === 0 && started === generation;
}

/**
 * Queue persistent mutations so erase also waits for writes already handed to
 * AsyncStorage. Checking an epoch before setItem alone cannot stop such writes
 * from landing after multiRemove has finished.
 */
export async function mutateLogoCache(started: number, task: () => Promise<void>): Promise<void> {
  await serialiseMutation(async () => {
    if (isLogoCacheGenerationCurrent(started)) await task();
  });
}

/**
 * Clear cache identities before destructive ledger work, preserving the
 * storage adapter's erase-failure contract if cache removal fails. The native
 * adapter invokes this inside its existing write queue; no SQL writes can
 * interleave with cache removal, key deletion or database deletion.
 */
export async function withLogoCacheErase<T>(eraseLedger: () => Promise<T>): Promise<T> {
  generation += 1;
  erasesInProgress += 1;
  for (const reset of resetters) reset();
  try {
    await serialiseMutation(async () => {
      const keys = await AsyncStorage.getAllKeys();
      const owned = keys.filter(key => CACHE_PREFIXES.some(prefix => key.startsWith(prefix)));
      if (owned.length > 0) await AsyncStorage.multiRemove(owned);
    });
    return await eraseLedger();
  } finally {
    erasesInProgress -= 1;
  }
}
