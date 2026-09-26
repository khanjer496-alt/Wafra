import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Hands the widget snapshot (src/lib/widget-snapshot.ts) to the native widgets.
 *
 * iOS writes it to the shared App Group container (group.app.wafra.ios) and asks
 * WidgetKit to reload; Android writes it to private SharedPreferences and
 * refreshes its AppWidgetProviders. Both read ONLY this JSON — never the ledger.
 * Missing native code (web, Expo Go, an older binary) is a silent no-op: widgets
 * are presentation, and a failed write must never affect the app.
 */
type NativeWidgets = {
  setSnapshot(json: string): void;
  clearSnapshot(): void;
};

const native = Platform.OS === 'web' ? null : requireOptionalNativeModule<NativeWidgets>('WafraWidgets');

export function setWidgetSnapshot(json: string): void {
  try { native?.setSnapshot(json); } catch { /* presentation only */ }
}

export function clearWidgetSnapshot(): void {
  try { native?.clearSnapshot(); } catch { /* presentation only */ }
}
