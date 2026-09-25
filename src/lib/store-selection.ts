/**
 * Narrow store subscriptions, without React.
 *
 * `useStore()` hands every caller the whole provider value, so any change
 * (import progress, a scan timestamp, a review tray) re-renders every screen
 * that calls it. The selector hooks in store.tsx subscribe through the handle
 * below instead and only re-render when the part a screen selected changes.
 * The pieces live here so tests can drive them without the store provider.
 */

export type Listener = () => void;

export interface StoreHandle<T> {
  /** The latest provider value. */
  get(): T;
  subscribe(listener: Listener): () => void;
}

export interface PublishingStoreHandle<T> extends StoreHandle<T> {
  /** Record a new value. Listeners run only on `notify`. */
  set(value: T): void;
  notify(): void;
}

export function createStoreHandle<T>(initial: T): PublishingStoreHandle<T> {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify: () => {
      for (const listener of Array.from(listeners)) listener();
    },
  };
}

/**
 * Object.is for primitives and identities; one level deep for plain objects
 * and arrays, so a selector may return `{ transactions, accounts }` freshly
 * built on every call and still keep its previous result when neither array
 * changed.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.hasOwn(b, key)) return false;
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

/**
 * A snapshot function for useSyncExternalStore that returns the previous
 * selection while it is still equal, so React sees the same value and skips
 * the render. The selector runs again only when the source or selector
 * changes.
 */
export function createSelection<S, T>(equal: (a: T, b: T) => boolean = shallowEqual) {
  let last: { source: S; selector: (source: S) => T; selection: T } | null = null;
  return (source: S, selector: (source: S) => T): T => {
    if (last && last.source === source && last.selector === selector) return last.selection;
    const next = selector(source);
    const selection = last && equal(last.selection, next) ? last.selection : next;
    last = { source, selector, selection };
    return selection;
  };
}

const statusOnlyCache = new Map<string, { status: string }>();

/**
 * Import progress reduced to its status, with one shared object per status.
 *
 * Transfer scope (internalTransferIdsForState) needs to know only whether a
 * first-history import is unfinished. Selecting the live progress object
 * would re-render a screen on every page the import reads; this identity
 * changes only when the status does.
 */
export function historyStatusOnly<S extends string>(
  progress: { status: S } | null | undefined,
): { readonly status: S } | null {
  if (!progress) return null;
  let shared = statusOnlyCache.get(progress.status);
  if (!shared) {
    shared = Object.freeze({ status: progress.status });
    statusOnlyCache.set(progress.status, shared);
  }
  return shared as { readonly status: S };
}

/**
 * Equality over a fixed list of fields, for a screen that must keep passing
 * the whole state object to helpers typed on AppState. The previous object
 * is kept while none of `keys` changed, so every key those helpers read has
 * to be listed or the screen goes stale.
 */
export function fieldsEqual<T extends object>(keys: readonly (keyof T)[]) {
  return (a: T, b: T): boolean => a === b || keys.every((key) => Object.is(a[key], b[key]));
}
