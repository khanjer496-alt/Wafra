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
/** On the band, the overview is the month line under the Today tiles (splitHomeWidgetLayout). */
const MONTH_LINE: HomeWidgetId = 'overview';

/**
 * Whether a section belongs to Home's opening group (greeting, overview,
 * Today, week). All but the overview are drawn on the colour band.
 */
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
 * Only the visible opening run of header sections belongs on the band. Home
 * v2 draws it as the greeting, Today | Left in budgets, the month line
 * (the overview: Spent · In · Net) and the week: within the band the
 * overview always follows the Today tiles. Placed lower by the person, it is
 * drawn on the sheet where they put it, as its full card.
 */
export function splitHomeWidgetLayout(preferences: HomeWidgetPreferences): { band: HomeWidgetId[]; sheet: HomeWidgetId[] } {
  const current = normalizeHomeWidgetPreferences(preferences);
  const visible = current.order.filter(id => !current.hidden.includes(id));
  const firstSheet = visible.findIndex(id => !BAND_SECTIONS.includes(id));
  const boundary = firstSheet < 0 ? visible.length : firstSheet;
  const opening = visible.slice(0, boundary);
  const anchor = opening.indexOf('today');
  if (!opening.includes(MONTH_LINE) || anchor < 0) return { band: opening, sheet: visible.slice(boundary) };
  const band = opening.filter(id => id !== MONTH_LINE);
  band.splice(band.indexOf('today') + 1, 0, MONTH_LINE);
  return { band, sheet: visible.slice(boundary) };
}

/**
 * Every section, hidden ones included, in the order Home draws them: the
 * order an editor lists them in, so its list and Home's preview agree.
 */
export function drawnHomeWidgetOrder(preferences: HomeWidgetPreferences): HomeWidgetId[] {
  const current = normalizeHomeWidgetPreferences(preferences);
  const { band, sheet } = splitHomeWidgetLayout({ order: current.order, hidden: [] });
  return [...band, ...sheet];
}

/**
 * The same layout with the overview stored where it is drawn: right after
 * Today within the opening run. Home draws both identically; this form keeps
 * moves in the editor one visible step at a time.
 */
function drawnCanonical(preferences: HomeWidgetPreferences): HomeWidgetPreferences {
  const { order, hidden } = preferences;
  let run = 0;
  while (run < order.length && BAND_SECTIONS.includes(order[run])) run++;
  const at = order.indexOf(MONTH_LINE);
  const today = order.indexOf('today');
  if (at < 0 || at >= run || today < 0 || today >= run) return { order: [...order], hidden: [...hidden] };
  const without = order.filter(id => id !== MONTH_LINE);
  without.splice(without.indexOf('today') + 1, 0, MONTH_LINE);
  return { order: without, hidden: [...hidden] };
}

/**
 * Moves a section one visible step up (-1) or down (1) in the drawn order,
 * keeping every other section where it is drawn. Some steps cannot be drawn
 * (on the band the month line always follows Today; a band section that
 * leaves the band lands after the first ordinary section), so the nearest drawable step in
 * that direction is taken. Returns null when none exists: the editor then
 * disables the control rather than offering a press that changes nothing.
 */
export function moveHomeWidgetDrawn(
  preferences: HomeWidgetPreferences,
  id: HomeWidgetId,
  direction: -1 | 1,
): HomeWidgetPreferences | null {
  const current = drawnCanonical(normalizeHomeWidgetPreferences(preferences));
  const before = drawnHomeWidgetOrder(current);
  const from = before.indexOf(id);
  const saved = current.order.indexOf(id);
  if (from < 0 || saved < 0) return null;
  const others = before.filter(other => other !== id).join();
  const rest = current.order.filter(other => other !== id);
  let best: { order: HomeWidgetId[]; step: number; shift: number } | null = null;
  for (let at = 0; at <= rest.length; at++) {
    const order = [...rest.slice(0, at), id, ...rest.slice(at)];
    const drawn = drawnHomeWidgetOrder({ order, hidden: [] });
    const step = (drawn.indexOf(id) - from) * direction;
    if (step <= 0 || drawn.filter(other => other !== id).join() !== others) continue;
    const shift = Math.abs(at - saved);
    if (!best || step < best.step || (step === best.step && shift < best.shift)) best = { order, step, shift };
  }
  return best ? { order: best.order, hidden: [...current.hidden] } : null;
}
