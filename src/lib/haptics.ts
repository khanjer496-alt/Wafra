import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { prioritizeForegroundNavigation } from '@/lib/foreground-history-priority';

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
  // The user's tap outranks parser/history maintenance. Most call sites route
  // through this one helper, so reserving the interaction window here protects
  // buttons, chips and rows as well as the tab bar without adding dozens of
  // separate scheduling hooks.
  prioritizeForegroundNavigation();
  if (Platform.OS === 'android') {
    // Give navigation/state handling the current frame, then ask Android for
    // its shortest contextual click. The old implementation called the bridge
    // in the same press turn (janky on some OEMs); the later workaround removed
    // Android tap haptics entirely. Deferring one frame keeps the interaction
    // responsive while restoring the physical feedback the app is designed to
    // have.
    requestAnimationFrame(() => {
      Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click).catch(() => {});
    });
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
 * A transaction arrived by itself (a live capture). Light, because the user
 * did nothing: it says "that landed", not "you committed something". Called
 * outside any press, so there is no frame to defer to.
 */
export function captured(): void {
  if (!native) return;
  if (Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click).catch(() => {});
    return;
  }
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/**
 * One keypad key. The softest tick the platform has, because it fires for
 * every digit and a firmer one would read as buzzing while typing.
 */
export function keyed(): void {
  if (!native) return;
  if (Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Keyboard_Tap).catch(() => {});
    return;
  }
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
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
