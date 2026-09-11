import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  defaultHomeWidgetPreferences,
  normalizeHomeWidgetPreferences,
  type HomeWidgetPreferences,
} from '@/lib/home-widget-preferences';

export {
  DEFAULT_HOME_WIDGETS,
  homeWidgetVisible,
  moveHomeWidget,
  normalizeHomeWidgetPreferences,
  setHomeWidgetVisible,
  type HomeWidgetId,
  type HomeWidgetPreferences,
} from '@/lib/home-widget-preferences';

const STORAGE_KEY = 'wafra/ui/home-widgets/v1';

export async function loadHomeWidgetPreferences(): Promise<HomeWidgetPreferences> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? normalizeHomeWidgetPreferences(JSON.parse(raw)) : defaultHomeWidgetPreferences();
  } catch {
    return defaultHomeWidgetPreferences();
  }
}

export async function saveHomeWidgetPreferences(value: HomeWidgetPreferences): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeHomeWidgetPreferences(value)));
}
