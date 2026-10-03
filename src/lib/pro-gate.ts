/**
 * Where a Pro-gated control in Settings goes when it is tapped.
 *
 * Settings used to send every gated tap to the full-screen /pro route. In
 * design language E the answer comes in context: a sheet over Settings that
 * names the feature that was tapped and runs the same storefront checkout as
 * the Pro screen. These rules are pure so the trigger is tested without a
 * renderer; the Settings handlers only act on what they return.
 *
 * Only two Settings controls are gated: automatic capture (iOS, which shows
 * `paused` once the trial or subscription has lapsed) and the Android
 * bank-app notification reader (`isProActive`). Nothing else on Settings may
 * open the sheet.
 */
import type { CaptureSurfaceState } from '@/hooks/use-auto-import';

export type ProGatedFeature = 'capture' | 'notifications';

/** The gated feature to explain, or null when the tap may go ahead. */
export function proGateFor(proActive: boolean, feature: ProGatedFeature): ProGatedFeature | null {
  return proActive ? null : feature;
}

/** What flipping the iOS automatic-capture switch does. */
export type IosCaptureSwitchIntent = 'recover' | 'pro' | 'set';

export function iosCaptureSwitchIntent(enabled: boolean, captureState: CaptureSurfaceState): IosCaptureSwitchIntent {
  // Turning it OFF is always allowed, whatever state capture is in.
  if (enabled && captureState === 'queue-warning') return 'recover';
  if (enabled && captureState === 'paused') return 'pro';
  return 'set';
}

/** What tapping the automatic-capture row's words does. */
export type IosCaptureManageIntent = 'pro' | 'recover' | 'enable' | 'setup';

export function iosCaptureManageIntent(captureState: CaptureSurfaceState, captureOptOut: boolean): IosCaptureManageIntent {
  if (captureState === 'paused') return 'pro';
  if (captureState === 'queue-warning') return 'recover';
  if (captureOptOut || captureState === 'off' || captureState === 'needs-automation') return 'enable';
  return 'setup';
}
