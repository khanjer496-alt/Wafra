import type { AndroidCaptureSources, AppState } from '@/lib/types';

const LEGACY_BOTH: AndroidCaptureSources = Object.freeze({ sms: true, notifications: true });

export function resolvedAndroidCaptureSources(
  state: Pick<AppState, 'captureOptOut' | 'androidCaptureSources'>,
): AndroidCaptureSources {
  if (state.captureOptOut) return { sms: false, notifications: false };
  return state.androidCaptureSources ?? LEGACY_BOTH;
}

export function androidSmsCaptureEnabled(
  state: Pick<AppState, 'captureOptOut' | 'androidCaptureSources'>,
): boolean {
  return resolvedAndroidCaptureSources(state).sms;
}

export function androidNotificationCaptureEnabled(
  state: Pick<AppState, 'captureOptOut' | 'androidCaptureSources'>,
): boolean {
  return resolvedAndroidCaptureSources(state).notifications;
}
