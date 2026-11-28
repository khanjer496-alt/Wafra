import AsyncStorage from '@react-native-async-storage/async-storage';

// These namespaces include old cache versions, even if a resolver has not
// loaded this session. Do not clear unrelated AsyncStorage keys or image caches.
const CACHE_PREFIXES = ['wafra:merchant-logo:', 'wafra:bank-logo:'];
const resetters = new Set<() => void>();
let generation = 0;
let lookupsAllowed = false;

/** Off until the store has hydrated, and whenever local-only (private) mode is on. */
export function setLogoLookupsAllowed(allowed: boolean): void {
  if (lookupsAllowed === allowed) return;
  lookupsAllowed = allowed;
  generation += 1;
  for (const reset of resetters) reset();
}
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

/** Both platforms skip cache, search and CDN resolution while lookups are not allowed. */
export function logoCacheGeneration(): number | null {
  return !lookupsAllowed || erasesInProgress > 0 ? null : generation;
}

export function isLogoCacheGenerationCurrent(started: number): boolean {
  return lookupsAllowed && erasesInProgress === 0 && started === generation;
}

async function removeOwnedKeys(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const owned = keys.filter(key => CACHE_PREFIXES.some(prefix => key.startsWith(prefix)));
  if (owned.length > 0) await AsyncStorage.multiRemove(owned);
}

/**
 * Brandfetch's terms forbid storing Brand Search results, and 1.0.2 keeps them
 * in memory only. Builds before 1.0 persisted them under these prefixes; the
 * store calls this once per launch after hydration to delete any left behind.
 */
export async function removeStoredLogoSearchResults(): Promise<void> {
  await serialiseMutation(removeOwnedKeys).catch(() => undefined);
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
    await serialiseMutation(removeOwnedKeys);
    return await eraseLedger();
  } finally {
    erasesInProgress -= 1;
  }
}
