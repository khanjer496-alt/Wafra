/**
 * E11 · Into Home. After the last onboarding screen the ink layer fades away
 * over the already-mounted Home while the pattern shrinks from where it sat
 * on the reveal to the head of Home's band, where YourPattern draws it at 24pt.
 * Under Reduce Motion, a screen reader or on Android it is a plain cross-fade.
 * Presentation only: it sits above Home with no touch handling and removes
 * itself when done.
 */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { E_EASE, WIPE_MS, useEMotion } from '@/components/onboarding/e-motion';
import { fitPatternTile } from '@/components/onboarding/e-frame';
import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { patternSize, type PatternTile } from '@/lib/pattern';

/** Home's header pattern tile (journal-home-screen: YourPattern tile 24). */
const HOME_TILE = 24;
/** Home's band gutter (BAND_GUTTER). */
const HOME_GUTTER = 20;

export function HandoffLayer({ tiles, onDone }: { tiles: readonly PatternTile[]; onDone: () => void }) {
  const band = useBand('home');
  const moving = useEMotion();
  const rtl = useLanguage() === 'ar';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tile = fitPatternTile(width, 52);
  const size = patternSize(tile, Math.max(2, Math.round((tile * 6) / 52)));
  const scale = HOME_TILE / tile;
  const startLeft = (width - size.width) / 2;
  const startTop = insets.top + 56;
  const endLeft = rtl ? width - HOME_GUTTER - size.width * scale : HOME_GUTTER;
  const endTop = insets.top + 12;
  // Scaling happens about the centre, so translate the centre, not the corner.
  const dx = endLeft - (size.width - size.width * scale) / 2 - startLeft;
  const dy = endTop - (size.height - size.height * scale) / 2 - startTop;
  const progress = useSharedValue(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    progress.value = withTiming(1, { duration: WIPE_MS, easing: E_EASE });
    const timer = setTimeout(() => done.current(), WIPE_MS + 40);
    return () => clearTimeout(timer);
  }, [progress]);
  const fade = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const travel = useAnimatedStyle(() => moving ? {
    transform: [
      { translateX: dx * progress.value },
      { translateY: dy * progress.value },
      { scale: 1 + (scale - 1) * progress.value },
    ],
    opacity: 1 - Math.max(0, progress.value - 0.85) / 0.15,
  } : { opacity: 1 - progress.value });
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
    style={StyleSheet.absoluteFillObject} testID="onboarding-handoff">
    <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: band.band }, fade]} />
    <Animated.View style={[{ position: 'absolute', left: startLeft, top: startTop }, travel]}>
      <PatternMosaic tiles={tiles} tile={tile} accessibilityLabel="" />
    </Animated.View>
  </View>;
}
