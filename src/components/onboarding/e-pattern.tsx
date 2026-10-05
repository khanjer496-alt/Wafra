/**
 * E7 · The pattern, revealed (ink). The whole mosaic from the person's own
 * answers — the name's initial, the goals, the watched categories, and the
 * reminders that have something to remind about — with a key to what each
 * kind of tile means. The key lists only the kinds actually in the pattern.
 * It never carries money (pattern.ts has no amount field).
 *
 * The mosaic is packed exactly as Home's header draws it (`compact`): a
 * skipped answer leaves no hole, and the person recognises it when they land.
 * It assembles one group at a time (you, goals, what you watch, reminders),
 * each key row arriving with its tiles, and then the whole mosaic lifts
 * upright from lying flat, like a card picked up off a table. Core Animated
 * on the native driver, paint only; Reduce Motion or a screen reader shows
 * the finished mosaic and key at once. With nothing but the first tile, a
 * line says honestly that it fills in as Wafra is used.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { E_BODY_TOP, E_TOP_ROW_HEIGHT, EBody, EHeadline, EStepFrame, fitPatternTile } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { COIN_MOVE, COIN_POP, COIN_RISE, COIN_STAGGER, nativeDriver } from '@/components/ui/coins/coin-motion';
import { Icon } from '@/components/ui/icon';
import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import { WafraMark } from '@/components/wafra-logo';
import { Fonts, PatternPalette } from '@/constants/theme';
import { useBand, useBandScheme } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { getCategory } from '@/lib/categories';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import type { PatternGroup, PatternTile } from '@/lib/pattern';

const SWATCH = 26;
/** Room above the mosaic inside the step's body. */
const MOSAIC_TOP_PAD = 36;
/**
 * Where the reveal's mosaic stands under the safe area: the header row, the
 * body's top padding, then its own. The paywall's backdrop starts here when it
 * follows the reveal, so the picture carries on rather than jumping.
 */
export const PATTERN_MOSAIC_TOP = E_TOP_ROW_HEIGHT + E_BODY_TOP + MOSAIC_TOP_PAD;
/** The order the groups assemble in, and the key's order. */
const GROUP_ORDER: readonly PatternGroup[] = ['name', 'goals', 'watch', 'remind'];
/** One group starts this long after the one before it. */
const GROUP_GAP_MS = 300;
/** A first beat before the first tile, so the step's own entrance lands first. */
const LEAD_MS = 180;
/** How far back the mosaic lies before it lifts, and how far below it starts. */
const FLAT_DEG = 56;
const FLAT_DROP = 14;
/** A tile drops this far into its place; a key row slides in this far from the start. */
const TILE_DROP = 10;
const ROW_SLIDE = 12;

/** A small copy of the first tile of a group, for the key. */
function Swatch({ tile }: { tile: PatternTile }) {
  const palette = PatternPalette[useBandScheme()];
  const fill = palette.fill[tile.color];
  if (tile.kind === 'letter') {
    return <View style={[styles.swatch, { backgroundColor: fill, borderRadius: 6 }]}>
      <Text allowFontScaling={false} style={[styles.swatchLetter, { color: palette.mark[tile.mark ?? 'cream'] }]}>{tile.letter}</Text>
    </View>;
  }
  if (tile.kind === 'glyph') {
    return <View style={[styles.swatch, { backgroundColor: fill, borderRadius: 6 }]}>
      <Icon name={getCategory(tile.category ?? 'other').icon} size={14} color={palette.mark[tile.mark ?? 'ink']} strokeWidth={2} />
    </View>;
  }
  if (tile.kind === 'dot') {
    return <View style={styles.swatch}><View style={[styles.dot, { backgroundColor: fill }]} /></View>;
  }
  if (tile.kind === 'ring') {
    return <View style={[styles.swatch, { borderRadius: SWATCH / 2, borderWidth: SWATCH / 6, borderColor: fill }]} />;
  }
  if (tile.kind === 'quarter') {
    return <View style={[styles.swatch, { backgroundColor: fill, borderTopLeftRadius: SWATCH,
      transform: tile.rotation ? [{ rotate: `${tile.rotation}deg` }] : undefined }]} />;
  }
  if (tile.kind === 'square' && tile.group === 'name') {
    // No name: Home's compact pattern draws Wafra's mark on this tile, so the key does too.
    return <View style={[styles.swatch, { backgroundColor: fill, borderRadius: 6 }]}>
      <WafraMark size={SWATCH * 0.8} color={palette.mark.cream} />
    </View>;
  }
  return <View style={[styles.swatch, { backgroundColor: fill, borderRadius: tile.kind === 'circle' ? SWATCH / 2 : 6 }]} />;
}

/**
 * The reveal's motion values: one per tile, one per key row (its group) and
 * one for the lift. 1 is the finished picture; under Reduce Motion or a
 * screen reader every value starts there. Nothing starts before the motion
 * preference is known, the reveal plays once per visit, and an interrupted
 * reveal lands finished.
 */
function useAssembly(tiles: readonly PatternTile[], groups: readonly PatternGroup[], slide: number) {
  const { ready, reducedMotion } = useMotionPreference();
  const played = useRef(false);
  const values = useRef(new Map<string, Animated.Value>());
  const value = (key: string) => {
    let found = values.current.get(key);
    if (!found) {
      // A tile or key row that first appears after the reveal has played is simply there.
      found = new Animated.Value(reducedMotion || played.current ? 1 : 0);
      values.current.set(key, found);
    }
    return found;
  };
  const tileValue = (tile: PatternTile) => value(`tile:${tile.key}`);
  const groupValue = (group: PatternGroup) => value(`group:${group}`);
  const lift = value('lift');
  // Paint built once per tile and key row and kept, so a re-render during the
  // reveal (the gate updates around it) never rebuilds the native nodes.
  const paints = useRef(new Map<string, object>());
  const paint = <T extends object>(key: string, build: () => T): T => {
    let found = paints.current.get(key) as T | undefined;
    if (!found) {
      found = build();
      paints.current.set(key, found);
    }
    return found;
  };
  const tilePaint = (tile: PatternTile) => paint(`tile:${tile.key}`, () => {
    const progress = tileValue(tile);
    return {
      opacity: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
      transform: [
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-TILE_DROP, 0] }) },
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
      ],
    };
  });
  const rowPaint = (group: PatternGroup) => paint(`row:${group}:${slide}`, () => {
    const progress = groupValue(group);
    return {
      opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [slide, 0] }) }],
    };
  });
  const stage = paint('stage', () => ({
    opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1], extrapolate: 'clamp' }),
    transform: [
      { perspective: 900 },
      { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [FLAT_DROP, 0] }) },
      { rotateX: lift.interpolate({ inputRange: [0, 1], outputRange: [`${FLAT_DEG}deg`, '0deg'] }) },
    ],
  }));
  // Read when the reveal starts, not dependencies: a re-render with the same
  // answers must not restart a reveal already under way.
  const plan = useRef({ tiles, groups });
  plan.current = { tiles, groups };
  useEffect(() => {
    const finish = () => { for (const each of values.current.values()) each.setValue(1); };
    if (reducedMotion) { played.current = true; finish(); return; }
    if (!ready || played.current) return;
    played.current = true;
    const { tiles: drawn, groups: order } = plan.current;
    const steps: Animated.CompositeAnimation[] = [];
    order.forEach((group, index) => {
      const start = LEAD_MS + index * GROUP_GAP_MS;
      steps.push(Animated.sequence([Animated.delay(start),
        Animated.spring(groupValue(group), { toValue: 1, ...COIN_MOVE, useNativeDriver: nativeDriver })]));
      drawn.filter((tile) => tile.group === group).forEach((tile, within) => {
        steps.push(Animated.sequence([Animated.delay(start + within * COIN_STAGGER),
          Animated.spring(tileValue(tile), { toValue: 1, ...COIN_POP, useNativeDriver: nativeDriver })]));
      });
    });
    // Once the last group is down, the mosaic lifts off the table and settles.
    steps.push(Animated.sequence([Animated.delay(LEAD_MS + order.length * GROUP_GAP_MS + 120),
      Animated.spring(lift, { toValue: 1, ...COIN_RISE, useNativeDriver: nativeDriver })]));
    const run = Animated.parallel(steps);
    run.start();
    return () => { run.stop(); finish(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, reducedMotion]);
  return { tilePaint, rowPaint, stage };
}

export function PatternStep({ tiles, name, continueLabel, onContinue, onBack, onClose, disabled }: {
  tiles: readonly PatternTile[];
  name: string | null;
  continueLabel: string;
  onContinue: () => void;
  onBack?: () => void;
  onClose?: () => void;
  disabled: boolean;
}) {
  const language = useLanguage();
  const words = onboardingECopy(language);
  const band = useBand('home');
  const tile = fitPatternTile(useWindowDimensions().width, 52);
  const labels: Record<PatternGroup, string> = {
    name: words.legendYou, goals: words.legendGoals, watch: words.legendWatch, remind: words.legendRemind,
  };
  const shown = GROUP_ORDER.flatMap((group) => {
    const first = tiles.find((item) => item.group === group);
    return first ? [{ group, label: labels[group], tile: first }] : [];
  });
  const groups = shown.map((entry) => entry.group);
  // Nothing answered but the name (or not even that): the first tile alone.
  const starting = !tiles.some((item) => item.group !== 'name');
  // Key rows slide in from the reading start: the right edge in Arabic.
  const slide = language === 'ar' ? ROW_SLIDE : -ROW_SLIDE;
  const motion = useAssembly(tiles, groups, slide);
  const wrapTile = (item: PatternTile, drawn: React.ReactElement) =>
    <Animated.View testID={`onboarding-pattern-tile-${item.key}`} style={motion.tilePaint(item)}>{drawn}</Animated.View>;
  return <EStepFrame palette={band} step={null} onBack={onBack} onClose={onClose} backDisabled={disabled} testID="onboarding-pattern"
    footer={<EButton palette={band} color={{ fill: band.accent, text: band.onAccent }} label={continueLabel}
      onPress={onContinue} disabled={disabled} testID="onboarding-pattern-continue" />}>
    <View style={styles.mosaic}>
      <Animated.View testID="onboarding-pattern-stage" style={[styles.stage, motion.stage]}>
        <PatternMosaic tiles={tiles} tile={tile} compact wrapTile={wrapTile} testID="onboarding-pattern-mosaic" />
      </Animated.View>
    </View>
    <EHeadline palette={band} size={44}>{words.patternTitle(name)}</EHeadline>
    <View style={styles.legend} testID="onboarding-pattern-legend">
      {shown.map((entry) => <Animated.View key={entry.group} testID={`onboarding-pattern-key-${entry.group}`}
        style={[styles.legendItem, motion.rowPaint(entry.group)]}>
        <Swatch tile={entry.tile} />
        <ThemedText type="small" style={[styles.legendLabel, { color: band.onBand }]}>{entry.label}</ThemedText>
      </Animated.View>)}
    </View>
    <EBody palette={band} style={styles.note}>{starting ? words.patternNoteStarting : words.patternNote}</EBody>
  </EStepFrame>;
}

const styles = StyleSheet.create({
  // Start-aligned like the headline and like Home's header, where it lands.
  mosaic: { alignItems: 'flex-start', paddingTop: MOSAIC_TOP_PAD, paddingBottom: 12 },
  stage: { transformOrigin: 'center bottom' },
  // One column: every row starts at the same edge, so no row is ever orphaned.
  legend: { flexDirection: 'column', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: SWATCH },
  legendLabel: { flexShrink: 1 },
  swatch: { width: SWATCH, height: SWATCH, alignItems: 'center', justifyContent: 'center' },
  swatchLetter: { fontFamily: Fonts.sansSemi, fontSize: 15, lineHeight: 18 },
  dot: { width: SWATCH / 3, height: SWATCH / 3, borderRadius: SWATCH / 6 },
  note: { fontSize: 15, lineHeight: 22 },
});
