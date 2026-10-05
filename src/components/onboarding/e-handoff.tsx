/**
 * E11 · Into Home. After the last onboarding screen, the overlay itself —
 * the paywall as it is, words, band and its dimmed pattern — fades away over
 * the already-mounted Home; nothing is cut on the first frame.
 *
 * Where the E flourishes run (useEMotion: not Android, not Reduce Motion, not a
 * screen reader), the pattern also travels: a copy starts exactly where and as
 * the paywall's backdrop drew it (same place, same dimming), brightens and
 * shrinks to the head of Home's band, where YourPattern draws it at 24pt. Home's
 * own pattern is covered by a patch of the band until the copy lands on it, then
 * both go together, so two patterns are never seen at once. Everywhere else the
 * whole paywall simply cross-fades into Home, with no separate mosaic (under
 * Reduce Motion too: a fade moves nothing).
 *
 * `OverlayHandoff` always wraps the overlay (a stable element, so the paywall
 * is not mounted again when the hand-off starts). Core Animated on the native
 * driver, paint only; presentation only, untouchable while it runs, and it
 * calls `onDone` once when it is over.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { E_GUTTER, fitPatternTile } from '@/components/onboarding/e-frame';
import { WIPE_MS, useEMotion } from '@/components/onboarding/e-motion';
import { PAYWALL_BACKDROP_TOP, paywallBackdropOpacity } from '@/components/onboarding/e-paywall';
import { PATTERN_MOSAIC_TOP } from '@/components/onboarding/e-pattern';
import { nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import { Motion } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { compactPattern, patternSize, type PatternTile } from '@/lib/pattern';

/** Home's header pattern tile and gap (journal-home-screen: YourPattern tile 24, gap 3). */
const HOME_TILE = 24;
const HOME_GAP = 3;
/** Home's band gutter (BAND_GUTTER), and the pattern's distance below the safe area. */
const HOME_GUTTER = 20;
const HOME_TOP = 12;
/** EStepFrame's widest column. */
const FRAME_MAX = 560;
/** The paywall's words fade out this fast: the first beat, not the whole flight. */
export const HANDOFF_WORDS_MS = 150;
/** The patch over Home's own pattern reaches this far past it, so no edge of it shows. */
const PATCH_MARGIN = 4;
const FLIGHT_EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

/** How long the hand-off runs: the flight, or the plain cross-fade. */
export function handoffMs(flying: boolean): number {
  return flying ? WIPE_MS : Motion.change;
}

/**
 * Where the travelling pattern starts and lands, for a screen `width` wide.
 * It starts where the last screen drew it — the paywall's dimmed backdrop
 * (PAYWALL_BACKDROP_TOP under the safe area), or the reveal's mosaic at full
 * strength (PATTERN_MOSAIC_TOP) when the journey ends on the reveal (Pro, or
 * after iPhone setup) — at the start of the step's column, and lands on Home's
 * header pattern. Scaling is about the centre, so the centre's travel is
 * returned, physical (a transform is never mirrored).
 *
 * Boxes are placed from the start edge on native, where the layout already
 * runs in the app's direction (the root's `direction`, and I18nManager after
 * an Arabic relaunch, which would swap a physical left a second time); on the
 * web, which resolves start from the device instead, they are physical.
 */
export function handoffGeometry(tiles: readonly PatternTile[], width: number, insetTop: number, rtl: boolean,
  from: 'paywall' | 'pattern' = 'paywall', platform: string = Platform.OS) {
  const tile = fitPatternTile(width, 52);
  const layout = compactPattern(tiles);
  const size = patternSize(tile, Math.max(2, Math.round((tile * 6) / 52)), layout.columns, layout.rows);
  const home = patternSize(HOME_TILE, HOME_GAP, layout.columns, layout.rows);
  const scale = HOME_TILE / tile;
  const frameStart = Math.max(0, (width - FRAME_MAX) / 2) + E_GUTTER;
  // Physical left edges, for the travel.
  const startLeft = rtl ? width - frameStart - size.width : frameStart;
  const endLeft = rtl ? width - HOME_GUTTER - home.width : HOME_GUTTER;
  const startTop = insetTop + (from === 'pattern' ? PATTERN_MOSAIC_TOP : PAYWALL_BACKDROP_TOP);
  const endTop = insetTop + HOME_TOP;
  const place = (fromStart: number, physicalLeft: number) =>
    platform === 'web' ? { left: physicalLeft } : { start: fromStart };
  return {
    tile, scale, size, home,
    /** Where the copy is first drawn, and how strongly: as the last screen drew it. */
    start: { top: startTop, ...place(frameStart, startLeft) },
    startOpacity: from === 'pattern' ? 1 : null,
    end: { top: endTop, ...place(HOME_GUTTER, endLeft) },
    dx: endLeft - (size.width - size.width * scale) / 2 - startLeft,
    dy: endTop - (size.height - size.height * scale) / 2 - startTop,
    patch: { top: endTop - PATCH_MARGIN, ...place(HOME_GUTTER - PATCH_MARGIN, endLeft - PATCH_MARGIN),
      width: home.width + PATCH_MARGIN * 2, height: home.height + PATCH_MARGIN * 2 },
  };
}

export function OverlayHandoff({ tiles, from = 'paywall', onDone, children }: {
  /** The pattern to hand to Home; null while onboarding is still showing (nothing happens). */
  tiles: readonly PatternTile[] | null;
  /** The screen the journey ends on: the copy starts where that screen drew the pattern. */
  from?: 'paywall' | 'pattern';
  onDone: () => void;
  children: React.ReactNode;
}) {
  const band = useBand('home');
  const flourish = useEMotion();
  // A cross-fade is kept even under Reduce Motion (nothing moves); only before
  // the motion answer is known does the overlay simply go.
  const moving = useMotionPreference().ready;
  const rtl = useLanguage() === 'ar';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const handing = tiles !== null;
  const flying = handing && flourish;
  const fade = useAnimatedNumber(1);
  const flight = useAnimatedNumber(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!handing) { fade.setValue(1); flight.setValue(0); return; }
    const total = handoffMs(flying);
    let run: Animated.CompositeAnimation | null = null;
    if (!moving) {
      fade.setValue(0);
      flight.setValue(1);
    } else {
      run = Animated.parallel([
        // Flying, the words go in the first beat and the pattern carries on;
        // otherwise the whole paywall cross-fades into Home.
        Animated.timing(fade, { toValue: 0, duration: flying ? HANDOFF_WORDS_MS : total,
          easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }),
        ...(flying ? [Animated.timing(flight, { toValue: 1, duration: total, easing: FLIGHT_EASE, useNativeDriver: nativeDriver })] : []),
      ]);
      run.start();
    }
    const timer = setTimeout(() => done.current(), moving ? total + 40 : 0);
    return () => { run?.stop(); clearTimeout(timer); };
  }, [handing, flying, moving, fade, flight]);
  const geometry = useMemo(() => tiles ? handoffGeometry(tiles, width, insets.top, rtl, from) : null,
    [tiles, width, insets.top, rtl, from]);
  const dim = geometry?.startOpacity ?? paywallBackdropOpacity(band.scheme);
  const travel = useMemo(() => geometry ? {
    // From the last screen's strength (the backdrop's dimming, or full) to full in the first part of the flight.
    opacity: flight.interpolate({ inputRange: [0, 0.45, 1], outputRange: [dim, 1, 1], extrapolate: 'clamp' }),
    transform: [
      { translateX: flight.interpolate({ inputRange: [0, 1], outputRange: [0, geometry.dx] }) },
      { translateY: flight.interpolate({ inputRange: [0, 1], outputRange: [0, geometry.dy] }) },
      { scale: flight.interpolate({ inputRange: [0, 1], outputRange: [1, geometry.scale] }) },
    ],
  } : null, [dim, flight, geometry]);
  return <>
    <Animated.View pointerEvents={handing ? 'none' : 'box-none'} accessibilityElementsHidden={handing}
      importantForAccessibility={handing ? 'no-hide-descendants' : 'auto'} aria-hidden={handing || undefined}
      // While it fades, Android draws the overlay as one layer, so overlapping pieces fade together.
      needsOffscreenAlphaCompositing={handing} renderToHardwareTextureAndroid={handing}
      style={[StyleSheet.absoluteFillObject, { opacity: fade }]} testID={handing ? 'onboarding-handoff' : undefined}>
      {children}
    </Animated.View>
    {flying && geometry && tiles ? <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden aria-hidden style={StyleSheet.absoluteFillObject} testID="onboarding-handoff-flight">
      {/* Home's own pattern stays under the band's colour until the copy lands exactly on it. */}
      <View testID="onboarding-handoff-patch" style={[styles.absolute, geometry.patch, { backgroundColor: band.band }]} />
      <Animated.View testID="onboarding-handoff-pattern" style={[styles.absolute, geometry.start, travel]}>
        <PatternMosaic tiles={tiles} tile={geometry.tile} compact accessibilityLabel="" />
      </Animated.View>
    </View> : null}
  </>;
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute' },
});
