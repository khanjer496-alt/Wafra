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
  /** Android answers false when it could not store it; iOS answers nothing. */
  setSnapshot(json: string): boolean | void;
  clearSnapshot(): void;
  /** Android only, and absent from binaries built before it existed. */
  canPinWidgets?(): boolean;
  pinWidget?(kind: string): Promise<boolean>;
};

export type PinnableWidget = 'today' | 'upcoming' | 'spending';

const native = Platform.OS === 'web' ? null : requireOptionalNativeModule<NativeWidgets>('WafraWidgets');

/**
 * False only when the native side said it could not store the snapshot
 * (Android's module answers false, for example without a React context) or
 * threw. iOS answers nothing and counts as stored. The sync uses the answer
 * to avoid skipping later writes of figures that never arrived.
 */
export function setWidgetSnapshot(json: string): boolean {
  try { return native?.setSnapshot(json) !== false; } catch { return false; /* presentation only */ }
}

let clears = 0;

export function clearWidgetSnapshot(): void {
  clears += 1;
  try { native?.clearSnapshot(); } catch { /* presentation only */ }
}

/**
 * How many times the native copy has been erased in this process. The sync
 * (src/lib/widget-sync.ts) skips rewriting figures the widgets already hold;
 * an erase from anywhere (Erase everything calls this directly) means they
 * no longer hold them.
 */
export function widgetSnapshotClearCount(): number {
  return clears;
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
