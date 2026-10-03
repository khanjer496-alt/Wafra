import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  defaultHomeWidgetPreferences,
  normalizeHomeWidgetPreferences,
  type HomeWidgetPreferences,
} from '@/lib/home-widget-preferences';

export {
  DEFAULT_HOME_WIDGETS,
  defaultHomeWidgetPreferences,
  drawnHomeWidgetOrder,
  homeWidgetVisible,
  moveHomeWidget,
  moveHomeWidgetDrawn,
  normalizeHomeWidgetPreferences,
  setHomeWidgetVisible,
  splitHomeWidgetLayout,
  type HomeWidgetId,
  type HomeWidgetPreferences,
} from '@/lib/home-widget-preferences';

const STORAGE_KEY = 'wafra/ui/home-widgets/v1';
let revision = 0;
let writes: Promise<void> = Promise.resolve();
let saved: HomeWidgetPreferences | null = null;
const listeners = new Set<(preferences: HomeWidgetPreferences) => void>();
const clone = (value: HomeWidgetPreferences): HomeWidgetPreferences => ({ order: [...value.order], hidden: [...value.hidden] });

/** A successful save updates mounted Home immediately; consumers cannot mutate the cache. */
export function subscribeHomeWidgetPreferences(listener: (preferences: HomeWidgetPreferences) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function loadHomeWidgetPreferences(): Promise<HomeWidgetPreferences> {
  const at = revision;
  // A read started during a save must not restore the preceding layout after
  // the live subscription already delivered the new one.
  await writes.catch(() => {});
  if (at !== revision) return loadHomeWidgetPreferences();
  if (saved) return clone(saved);
  let result: HomeWidgetPreferences;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    result = raw ? normalizeHomeWidgetPreferences(JSON.parse(raw)) : defaultHomeWidgetPreferences();
  } catch {
    // Preserve the historical read fallback. Never write it back implicitly.
    if (at !== revision) return loadHomeWidgetPreferences();
    return defaultHomeWidgetPreferences();
  }
  if (at !== revision) return loadHomeWidgetPreferences();
  saved = clone(result);
  return clone(result);
}

/** Writes serialize in request order. Failures reject to the editor, never claim Saved. */
export function saveHomeWidgetPreferences(value: HomeWidgetPreferences): Promise<void> {
  const next = normalizeHomeWidgetPreferences(value);
  revision += 1;
  const operation = writes.catch(() => {}).then(async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    saved = clone(next);
    for (const listener of listeners) {
      try { listener(clone(next)); } catch { /* one view cannot prevent other subscribers or undo a durable save */ }
    }
  });
  writes = operation;
  return operation;
}

export function resetHomeWidgetPreferences(): Promise<void> {
  return saveHomeWidgetPreferences(defaultHomeWidgetPreferences());
}
