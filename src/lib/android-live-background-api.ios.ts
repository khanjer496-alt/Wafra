/**
 * iOS side of android-live-background-api.ts. Android's live capture does not
 * exist here, and the real functions returned immediately on iOS
 * (`if (Platform.OS !== 'android')`), so these keep the same observable
 * behaviour without importing the Android capture stack and its parsers.
 */
import type { CaptureLedgerAdapter } from '@/lib/capture-executor';

/** Android borrows the mounted ledger for headless captures; iOS has none to install. */
export function installAndroidLiveCaptureLedger(_adapter: CaptureLedgerAdapter): () => void {
  return () => {};
}

/** There is never an Android background capture to wait for on iOS. */
export async function waitForAndroidBackgroundCaptureIdle(): Promise<void> {}
