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
  /** Android only, and absent from binaries built before it existed. */
  canPinWidgets?(): boolean;
  pinWidget?(kind: string): Promise<boolean>;
};

export type PinnableWidget = 'today' | 'upcoming' | 'spending';

const native = Platform.OS === 'web' ? null : requireOptionalNativeModule<NativeWidgets>('WafraWidgets');

export function setWidgetSnapshot(json: string): void {
  try { native?.setSnapshot(json); } catch { /* presentation only */ }
}

export function clearWidgetSnapshot(): void {
  try { native?.clearSnapshot(); } catch { /* presentation only */ }
}

/**
 * Whether the launcher accepts a request to pin one of Wafra's widgets
 * (Android's AppWidgetManager.isRequestPinAppWidgetSupported). iOS has no
 * such API: a widget is added only from the Home Screen's own editor.
 */
export function canPinWidgets(): boolean {
  if (Platform.OS !== 'android') return false;
  try { return native?.canPinWidgets?.() === true; } catch { return false; }
}

/**
 * Asks the launcher to show its "add widget" dialog for Today
 * (TodayWidgetProvider), Coming up (UpcomingWidgetProvider) or Spending this
 * month (SpendingWidgetProvider). True means the
 * launcher took the request, not that the person placed the widget.
 */
export async function pinWidget(kind: PinnableWidget): Promise<boolean> {
  if (Platform.OS !== 'android' || typeof native?.pinWidget !== 'function') return false;
  try { return (await native.pinWidget(kind)) === true; } catch { return false; }
}
