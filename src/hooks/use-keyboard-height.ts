import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How much of the screen the software keyboard is covering, in points.
 *
 * Every mechanism the platform offers for this had already failed here:
 *
 * `softwareKeyboardLayoutMode: 'resize'` is the Android default and is
 * supposed to shrink the window. Under edge-to-edge — which is on by default
 * now — the window no longer shrinks, it just gets an inset, so a layout that
 * fills the screen keeps filling it and the keyboard sits on top.
 *
 * `KeyboardAvoidingView` was already wrapped around the add-entry screen, with
 * `behavior` set for iOS and left UNDEFINED on Android. With no behavior it
 * does nothing at all, so on the platform this app ships to it was decoration.
 *
 * And a `Modal` — which every bottom sheet is — is a separate window that
 * never resizes for the keyboard on Android under any setting.
 *
 * Measuring it directly sidesteps all three. The caller decides what to do
 * with the number: pad a scroll view so its fields can be scrolled clear, or
 * lift a sheet so it sits above the keys.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS fires the "will" pair early enough to animate with the keyboard;
    // Android only reports a usable height on "did".
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      setHeight(e.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
