import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadHomeWidgetPreferences, saveHomeWidgetPreferences } from '@/lib/home-widgets';
import { repairGoalOrderedHome } from '@/lib/onboarding-e';

/** Set once the check has run on this device, whatever it found. */
export const GOAL_ORDER_REPAIR_KEY = 'wafra/ui/home-widgets/goal-order-repair/v1';
const HOME_WIDGETS_KEY = 'wafra/ui/home-widgets/v1';

let running: Promise<void> | null = null;

async function run(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(GOAL_ORDER_REPAIR_KEY)) return;
    // Read the stored layout directly: loadHomeWidgetPreferences answers a
    // read failure with the defaults, which would look like "nothing to
    // repair" and wrongly retire the check.
    const raw = await AsyncStorage.getItem(HOME_WIDGETS_KEY);
    if (raw !== null && repairGoalOrderedHome(JSON.parse(raw))) {
      // Repair the serialized load, so a Customize Home save in flight wins.
      // If that no longer needs repair (the person rearranged it, or the load
      // fell back to defaults), leave the check for the next launch.
      const repaired = repairGoalOrderedHome(await loadHomeWidgetPreferences());
      if (!repaired) return;
      await saveHomeWidgetPreferences(repaired);
    }
    await AsyncStorage.setItem(GOAL_ORDER_REPAIR_KEY, '1');
  } catch {
    // Left unmarked; the next launch tries again.
  }
}

/**
 * Runs `repairGoalOrderedHome` once per device for people whose Goals step
 * saved the earlier goal-first order (see onboarding-e.ts). The marker is
 * written only after the layout was read and, when it matched, saved, so a
 * failed read or write is retried on a later launch instead of being
 * recorded as done. Never throws: a layout preference is not worth an error.
 */
export function repairGoalOrderedHomeOnce(): Promise<void> {
  // Reset in a later microtask, after `running` is assigned, so even a
  // synchronous storage failure leaves the next call free to retry.
  running ??= run().finally(() => { running = null; });
  return running;
}
