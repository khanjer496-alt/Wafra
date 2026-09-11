import AsyncStorage from '@react-native-async-storage/async-storage';

export type HomeWidgetId = 'assistant' | 'insight' | 'due' | 'activity' | 'upcoming';

export interface HomeWidgetPreferences {
  order: HomeWidgetId[];
  hidden: HomeWidgetId[];
}

const STORAGE_KEY = 'wafra/ui/home-widgets/v1';

export const DEFAULT_HOME_WIDGETS: HomeWidgetPreferences = {
  order: ['assistant', 'insight', 'due', 'activity', 'upcoming'],
  hidden: [],
};

const VALID = new Set<HomeWidgetId>(DEFAULT_HOME_WIDGETS.order);

export function normalizeHomeWidgetPreferences(value: unknown): HomeWidgetPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_HOME_WIDGETS;
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

export async function loadHomeWidgetPreferences(): Promise<HomeWidgetPreferences> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? normalizeHomeWidgetPreferences(JSON.parse(raw)) : DEFAULT_HOME_WIDGETS;
  } catch {
    return DEFAULT_HOME_WIDGETS;
  }
}

export async function saveHomeWidgetPreferences(value: HomeWidgetPreferences): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeHomeWidgetPreferences(value)));
}

export function homeWidgetVisible(preferences: HomeWidgetPreferences, id: HomeWidgetId): boolean {
  return !preferences.hidden.includes(id);
}
