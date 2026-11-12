/**
 * The two Android live-capture hooks the rest of the app calls, behind a
 * platform split. This default file (Android, and anything Metro does not give
 * the iOS file below) re-exports the real implementations from
 * android-live-background.ts.
 *
 * iOS resolves android-live-background-api.ios.ts instead, whose no-ops are
 * exactly what these functions already did on iOS (both begin with
 * `Platform.OS !== 'android'`), so the iPhone no longer loads the whole Android
 * capture stack before its first screen just to call a no-op.
 */
export {
  installAndroidLiveCaptureLedger,
  waitForAndroidBackgroundCaptureIdle,
} from '@/lib/android-live-background';
