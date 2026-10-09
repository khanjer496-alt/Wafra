/**
 * The Spent card's lean from device motion (home-tilt.ts), as two
 * Animated values in degrees that the card reads on the native driver.
 *
 * The motion sensor comes from expo-sensors' DeviceMotion native module when
 * the installed build includes it. This build does not add the package
 * (it brings the Android ACTIVITY_RECOGNITION permission and an iOS motion
 * usage description with it; see docs/design/language-e.md), so the module is
 * looked up as optional: without it, on the web, under Reduce Motion or a
 * screen reader, while the app is in the background or Home is not the
 * focused screen, the card simply stays flat and nothing subscribes.
 */
import { useFocusEffect } from '@react-navigation/native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform } from 'react-native';

import { useAppActive } from '@/hooks/use-app-active';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { TILT_INTERVAL_MS, tiltStep, type TiltState } from '@/lib/home-tilt';
import { isRTL } from '@/lib/i18n';

interface MotionReading { rotation?: { beta?: number; gamma?: number } }
interface DeviceMotionModule {
  addListener(event: 'deviceMotionDidUpdate', listener: (reading: MotionReading) => void): { remove(): void };
  setUpdateInterval?(intervalMs: number): unknown;
  isAvailableAsync?(): Promise<boolean>;
}

let looked = false;
let motionModule: DeviceMotionModule | null = null;
function deviceMotion(): DeviceMotionModule | null {
  if (Platform.OS === 'web') return null;
  if (!looked) {
    looked = true;
    try { motionModule = requireOptionalNativeModule<DeviceMotionModule>('ExponentDeviceMotion'); } catch { motionModule = null; }
  }
  return motionModule;
}

/** Whether this build can tilt at all (the native sensor module is present). */
export function deviceTiltSupported(): boolean {
  return deviceMotion() !== null;
}

export function useDeviceTilt(hold: boolean): { x: Animated.Value; y: Animated.Value } {
  const motion = useMotionPreference();
  const active = useAppActive();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  const values = useRef<{ x: Animated.Value; y: Animated.Value } | null>(null);
  if (!values.current) values.current = { x: new Animated.Value(0), y: new Animated.Value(0) };
  const live = !hold && focused && active && motion.ready && !motion.reducedMotion;
  useEffect(() => {
    const { x, y } = values.current!;
    const module = live ? deviceMotion() : null;
    if (!module) {
      x.setValue(0);
      y.setValue(0);
      return;
    }
    let state: TiltState | null = null;
    let cancelled = false;
    let subscription: { remove(): void } | null = null;
    const rtl = isRTL();
    const start = () => {
      if (cancelled) return;
      try {
        void module.setUpdateInterval?.(TILT_INTERVAL_MS);
        subscription = module.addListener('deviceMotionDidUpdate', (reading) => {
          const next = tiltStep(state, reading.rotation?.beta ?? NaN, reading.rotation?.gamma ?? NaN, rtl);
          if (!next || next === state) return;
          state = next;
          // setValue on a native-driven value updates the UI thread directly.
          x.setValue(next.x);
          y.setValue(next.y);
        });
      } catch {
        subscription = null;
      }
    };
    if (module.isAvailableAsync) void module.isAvailableAsync().then((available) => { if (available) start(); }).catch(() => {});
    else start();
    return () => {
      cancelled = true;
      subscription?.remove();
      x.setValue(0);
      y.setValue(0);
    };
  }, [live]);
  return values.current;
}
