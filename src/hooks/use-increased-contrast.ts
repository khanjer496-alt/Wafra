import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** Follow the platform's stronger-colour preference without adding app state. */
export function useIncreasedContrast(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const query = globalThis.matchMedia?.('(prefers-contrast: more)');
      if (!query) return;
      setEnabled(query.matches);
      const onChange = (event: MediaQueryListEvent) => setEnabled(event.matches);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }

    const ios = Platform.OS === 'ios';
    const read = ios
      ? AccessibilityInfo.isDarkerSystemColorsEnabled
      : AccessibilityInfo.isHighTextContrastEnabled;
    const event = ios ? 'darkerSystemColorsChanged' : 'highTextContrastChanged';
    let mounted = true;
    void read().then((value) => {
      if (mounted) setEnabled(value);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(event, setEnabled);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return enabled;
}
