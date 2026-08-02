import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * The app's haptic vocabulary — three verbs, and a rule for when each applies.
 *
 * The app had three haptic calls in total: the tab bar's +, saving an entry,
 * and a finished import. Two of the three used `notificationAsync(Success)`,
 * which on Android is a multi-pulse pattern ~350ms long. Fired to confirm a
 * save it does not read as "done", it reads as the phone stuttering — and
 * because it is long, it overlaps the screen transition that follows and makes
 * the whole action feel late. Everything else in the app — every tab, toggle,
 * chip, row and sheet — was silent, so what feedback existed felt arbitrary.
 *
 * The rule now: a tick for a choice, a firmer tap for a commitment, and the
 * long pattern reserved for the one case it is designed for — telling the user
 * something went wrong when they are not looking at the thing that failed.
 *
 * All three are fire-and-forget and no-ops off native, so call sites do not
 * repeat a Platform check or a `.catch()`.
 */

const native = Platform.OS === 'ios' || Platform.OS === 'android';

/** A choice registered: tab, chip, segment, toggle, period, row selection. */
export function tapped(): void {
  if (!native) return;
  if (Platform.OS === 'android') {
    // Expo SDK 55 recommends Android's haptics engine over a simulated
    // Vibrator impact. Segment_Tick is the native semantic for a discrete
    // choice and does not require the VIBRATE permission.
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick).catch(() => {});
    return;
  }
  Haptics.selectionAsync().catch(() => {});
}

/** A commitment landed: saved, paid, imported, deleted, limit set. */
export function committed(): void {
  if (!native) return;
  if (Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm).catch(() => {});
    return;
  }
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/**
 * Something the user should notice went wrong. The long pattern earns its
 * length here and nowhere else.
 */
export function failed(): void {
  if (!native) return;
  if (Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject).catch(() => {});
    return;
  }
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
