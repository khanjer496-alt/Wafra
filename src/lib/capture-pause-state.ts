import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "I was away" on Home's capture-stopped notice. A UI preference beside the
 * other Home preferences (recap-view-state, home-widgets): one timestamp, no
 * ledger data. A failed read or write only means the notice may show again.
 */
const STORAGE_KEY = 'wafra/ui/capture-pause-snooze/v1';

export async function loadCapturePauseSnooze(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function saveCapturePauseSnooze(atMs: number): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, String(Math.round(atMs)));
  } catch {
    // Cosmetic preference; never block Home on it.
  }
}
