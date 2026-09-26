export type HomeWidgetId =
  | 'greeting' | 'overview' | 'today' | 'week'
  | 'due' | 'upcoming' | 'activity' | 'assistant' | 'insight' | 'capture';

export interface HomeWidgetPreferences {
  order: HomeWidgetId[];
  hidden: HomeWidgetId[];
}

export const DEFAULT_HOME_WIDGETS: HomeWidgetPreferences = {
  order: ['greeting', 'overview', 'today', 'week', 'due', 'upcoming', 'activity', 'assistant', 'insight', 'capture'],
  hidden: [],
};

const LEGACY_ORDER: readonly HomeWidgetId[] = ['due', 'upcoming', 'activity', 'assistant', 'insight'];
const BAND_SECTIONS: readonly HomeWidgetId[] = ['greeting', 'overview', 'today', 'week'];
const ADDED = new Set<HomeWidgetId>([...BAND_SECTIONS, 'capture']);
const VALID = new Set<HomeWidgetId>(DEFAULT_HOME_WIDGETS.order);
const ids = (value: unknown): HomeWidgetId[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is HomeWidgetId => typeof id === 'string' && VALID.has(id as HomeWidgetId)))] : [];

export function defaultHomeWidgetPreferences(): HomeWidgetPreferences {
  return { order: [...DEFAULT_HOME_WIDGETS.order], hidden: [] };
}

export function normalizeHomeWidgetPreferences(value: unknown): HomeWidgetPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultHomeWidgetPreferences();
  const raw = value as { order?: unknown; hidden?: unknown };
  const order = ids(raw.order);
  const hidden = ids(raw.hidden);
  // v1 originally stored only five lower sections. Keep every old ordering
  // and visibility choice; the formerly fixed content becomes movable around
  // it. No extra persisted schema/appearance field is needed.
  const legacy = ![...order, ...hidden].some(id => ADDED.has(id));
  if (legacy) {
    const middle = [...order];
    for (const id of LEGACY_ORDER) if (!middle.includes(id)) middle.push(id);
    return { order: [...BAND_SECTIONS, ...middle, 'capture'], hidden };
  }
  // Expanded layouts retain their chosen positions. Unknown/duplicate ids
  // are removed, and an omitted known section is restored once at the end.
  for (const id of DEFAULT_HOME_WIDGETS.order) if (!order.includes(id)) order.push(id);
  return { order, hidden };
}

export function setHomeWidgetVisible(
  preferences: HomeWidgetPreferences,
  id: HomeWidgetId,
  visible: boolean,
): HomeWidgetPreferences {
  const current = normalizeHomeWidgetPreferences(preferences);
  if (!VALID.has(id)) return current;
  const hidden = visible
    ? current.hidden.filter((item) => item !== id)
    : [...current.hidden.filter((item) => item !== id), id];
  return { order: [...current.order], hidden };
}

export function moveHomeWidget(
  preferences: HomeWidgetPreferences,
  id: HomeWidgetId,
  direction: -1 | 1,
): HomeWidgetPreferences {
  const current = normalizeHomeWidgetPreferences(preferences);
  const index = current.order.indexOf(id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= current.order.length) return current;
  const order = [...current.order];
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  return { order, hidden: [...current.hidden] };
}

export function homeWidgetVisible(preferences: HomeWidgetPreferences, id: HomeWidgetId): boolean {
  return !preferences.hidden.includes(id);
}

/** Only the visible opening run of header/financial sections belongs on the band. */
export function splitHomeWidgetLayout(preferences: HomeWidgetPreferences): { band: HomeWidgetId[]; sheet: HomeWidgetId[] } {
  const current = normalizeHomeWidgetPreferences(preferences);
  const visible = current.order.filter(id => !current.hidden.includes(id));
  const firstSheet = visible.findIndex(id => !BAND_SECTIONS.includes(id));
  const boundary = firstSheet < 0 ? visible.length : firstSheet;
  return { band: visible.slice(0, boundary), sheet: visible.slice(boundary) };
}
