import { Platform } from 'react-native';

import type { OnboardingFocus, OnboardingTracking } from '@/lib/types';

/**
 * Stable identifiers that can be copied into Adapty later.
 *
 * They are intentionally provider-neutral today: adding this file does not
 * initialize an SDK, contact a server, or change purchase behavior.
 */
export const GROWTH_PLACEMENTS = {
  onboarding: 'onboarding_main',
  postImportPro: 'post_import_pro',
  settingsPro: 'settings_pro',
} as const;

export type GrowthEvent =
  | 'onboarding_started'
  | 'onboarding_focus_selected'
  | 'onboarding_tracking_selected'
  | 'onboarding_value_previewed'
  | 'onboarding_privacy_seen'
  | 'capture_setup_started'
  | 'capture_permission_granted'
  | 'capture_permission_denied'
  | 'capture_setup_failed'
  | 'manual_tracking_selected'
  | 'onboarding_completed'
  | 'post_import_pro_opened';

export interface GrowthEventPayload {
  focus?: OnboardingFocus | null;
  tracking?: OnboardingTracking | null;
  platform?: 'ios' | 'android' | 'web' | 'other';
  placement?: (typeof GROWTH_PLACEMENTS)[keyof typeof GROWTH_PLACEMENTS];
  outcome?: 'automatic' | 'manual' | 'denied' | 'failed';
}

export type GrowthEventSink = (event: GrowthEvent, payload: GrowthEventPayload) => void;

let sink: GrowthEventSink | null = null;

/** Future analytics/Adapty adapter hook. Null by default = zero network traffic. */
export function setGrowthEventSink(next: GrowthEventSink | null): void {
  sink = next;
}

export function growthPlatform(): GrowthEventPayload['platform'] {
  if (Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web') return Platform.OS;
  return 'other';
}

export function trackGrowthEvent(event: GrowthEvent, payload: GrowthEventPayload = {}): void {
  if (!sink) return;
  try {
    sink(event, { ...payload, platform: payload.platform ?? growthPlatform() });
  } catch {
    // Analytics can never block money, onboarding, permissions, or navigation.
  }
}
