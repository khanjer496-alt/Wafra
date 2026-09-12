export type HomeWidgetId = 'assistant' | 'insight' | 'due' | 'activity' | 'upcoming';

export interface HomeWidgetPreferences {
  order: HomeWidgetId[];
  hidden: HomeWidgetId[];
}

export const DEFAULT_HOME_WIDGETS: HomeWidgetPreferences = {
  order: ['due', 'assistant', 'insight', 'activity', 'upcoming'],
  hidden: [],
};

const VALID = new Set<HomeWidgetId>(DEFAULT_HOME_WIDGETS.order);

export function defaultHomeWidgetPreferences(): HomeWidgetPreferences {
  return { order: [...DEFAULT_HOME_WIDGETS.order], hidden: [] };
}

export function normalizeHomeWidgetPreferences(value: unknown): HomeWidgetPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultHomeWidgetPreferences();
  const raw = value as { order?: unknown; hidden?: unknown };
  const order = Array.isArray(raw.order)
    ? raw.order.filter((id): id is HomeWidgetId => typeof id === 'string' && VALID.has(id as HomeWidgetId))
    : [];
  const uniqueOrder = [...new Set(order)];
  for (const id of DEFAULT_HOME_WIDGETS.order) if (!uniqueOrder.includes(id)) uniqueOrder.push(id);
  const hidden = Array.isArray(raw.hidden)
    ? [...new Set(raw.hidden.filter((id): id is HomeWidgetId => typeof id === 'string' && VALID.has(id as HomeWidgetId)))]
    : [];
  return { order: uniqueOrder, hidden };
}

export function setHomeWidgetVisible(
  preferences: HomeWidgetPreferences,
  id: HomeWidgetId,
  visible: boolean,
): HomeWidgetPreferences {
  const current = normalizeHomeWidgetPreferences(preferences);
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
