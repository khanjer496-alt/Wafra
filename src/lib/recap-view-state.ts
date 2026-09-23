import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'wafra/ui/recap-viewed/v1';
const MAX_IDS = 36;

export async function loadViewedRecaps(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : []);
  } catch {
    return new Set();
  }
}

export async function markRecapViewed(id: string): Promise<void> {
  try {
    const viewed = await loadViewedRecaps();
    viewed.add(id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...viewed].slice(-MAX_IDS)));
  } catch {
    // Read-state is cosmetic. A failed preference write must never block Recap.
  }
}
