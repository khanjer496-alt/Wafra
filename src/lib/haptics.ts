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
    // Deferred, not removed — and the distinction is the whole point.
    //
    // History: `9626f4f` deleted this call because a bridge hop on every one
    // of ~39 tap sites can land on the same JS turn as the navigation it
    // accompanies, making a registered tap feel late on OEM devices. `4fdf50f`
    // put it back and rewrote the guard to demand it. `dcfe56d7` deleted it
    // again and restored the guard.
    //
    // Build 219 shipped that deletion, and it is now measured against the
    // phone rather than argued: the tap haptics are gone AND the navigation
    // lag is still reported. Removing the call cost the app its feel and did
    // not buy the responsiveness it was removed for, so the premise that this
    // call is the dominant cost does not survive contact with the device.
    //
    // What the guard was actually protecting is in its own words: the call
    // must not "overlap the navigation turn". A macrotask does not. The tap
    // handler and the navigation it schedules complete first; the bridge hop
    // happens on a later turn, typically inside one frame, which is well under
    // the ~10-20ms at which a haptic stops feeling simultaneous with the touch.
    // So the feedback returns and the invariant the guard names still holds.
    //
    // Context_Click, not Segment_Tick: expo-haptics resolves these constants by
    // reflection and throws HapticsNotSupportedException when the field is
    // absent. CONTEXT_CLICK is one of the five it can always fall back to and
    // predates this app's minSdk 24; SEGMENT_TICK is API 34+, so on anything
    // older it would be a silent no-op behind the .catch below.
    setTimeout(() => {
      Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click).catch(() => {});
    }, 0);
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
