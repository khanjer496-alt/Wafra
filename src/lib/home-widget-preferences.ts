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
/** In the opening group, but drawn first on the sheet (splitHomeWidgetLayout). */
const SHEET_LEAD: HomeWidgetId = 'overview';

/** Whether a section is one of the four that can sit on Home's colour band. */
export function isHomeBandSection(id: HomeWidgetId): boolean {
  return BAND_SECTIONS.includes(id);
}
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

/**
 * Only the visible opening run of header sections belongs on the band: the
 * greeting, Today | Left in budgets and the week, as design language E draws
 * Home. The period overview (Total spent, Income, Net) still belongs to that
 * opening group, so it never ends the run, but it leads the sheet rather than
 * crowding the band. Placed lower by the person, it stays where they put it.
 */
export function splitHomeWidgetLayout(preferences: HomeWidgetPreferences): { band: HomeWidgetId[]; sheet: HomeWidgetId[] } {
  const current = normalizeHomeWidgetPreferences(preferences);
  const visible = current.order.filter(id => !current.hidden.includes(id));
  const firstSheet = visible.findIndex(id => !BAND_SECTIONS.includes(id));
  const boundary = firstSheet < 0 ? visible.length : firstSheet;
  const opening = visible.slice(0, boundary);
  const lead = opening.filter(id => id === SHEET_LEAD);
  return { band: opening.filter(id => id !== SHEET_LEAD), sheet: [...lead, ...visible.slice(boundary)] };
}
