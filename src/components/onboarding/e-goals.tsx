/**
 * E3 · Goals (green): "What should Wafra do?". Each goal picked drops its
 * shape into the pattern, and the line under the headline says it is
 * multi-select, then, truthfully, which Home section the answers move to the
 * top — the order itself is written to the existing Customize Home
 * preference (onboarding-e.ts: homeOrderForGoals). Any number, including
 * none: with none (and none saved before) the button says Skip for now.
 *
 * Goals choose what the app is for, not money, so nothing here draws money.
 * Beside the pattern sits a small, decorative Home: the totals row, then the
 * sections Home draws first, in the order these answers will save. Each pick
 * slides its sections up on the app's spring, so the person sees what it does.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';

import { EChoiceRow } from '@/components/onboarding/e-choice-row';
import { EBody, EHeadline, EStepFrame, bandButtonColor } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { COIN_MOVE, nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { Icon, type IconName } from '@/components/ui/icon';
import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import type { BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useMotionPreference, type MotionPreference } from '@/hooks/use-reduced-motion';
import { bandCopy } from '@/lib/band-copy';
import { customizeCopy } from '@/lib/customize-copy';
import {
  DEFAULT_HOME_WIDGETS,
  splitHomeWidgetLayout,
  type HomeWidgetId,
  type HomeWidgetPreferences,
} from '@/lib/home-widget-preferences';
import { loadHomeWidgetPreferences } from '@/lib/home-widgets';
import { GOAL_HOME_SECTIONS, firstHomeSectionForGoals, homeOrderForGoals } from '@/lib/onboarding-e';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import type { PatternTile } from '@/lib/pattern';
import { GOAL_IDS, type GoalId } from '@/lib/types';

/** Tray tiles: loose ~40pt shapes, three across, as on board E3. */
const TRAY_TILE = 38;
const TRAY_GAP = 5;
const TRAY_COLUMNS = 3;

/**
 * Tray tiles already shown in this journey: coming back to Goals (Back from
 * Watch) shows them in place instead of popping them in again. Only a tile
 * picked on this visit pops. Keyed by the journey (the gate passes one per
 * run: a new onboarding, a Settings preview), so a fresh journey pops anew.
 */
const trayShown: { journey: string | null; keys: Set<string> } = { journey: null, keys: new Set() };
/** The tiles this journey has already shown, starting a new record when the journey changes. */
function shownIn(journey: string): Set<string> {
  if (trayShown.journey !== journey) { trayShown.journey = journey; trayShown.keys = new Set(); }
  return trayShown.keys;
}
/** Forget every journey (the gate calls it when a journey resets; tests too). */
export function forgetTrayTiles(): void { trayShown.journey = null; trayShown.keys = new Set(); }

/**
 * The pattern's tiles in its reading order (row, then column, as Home packs
 * them). A green shape takes the board's on-band tones instead (mint for a
 * solid, cream for a ring), so it reads as a mark on the flow band.
 */
export function trayTiles(tiles: readonly PatternTile[]): PatternTile[] {
  return [...tiles].sort((a, b) => a.row - b.row || a.col - b.col)
    .map((tile) => tile.color === 'green' ? { ...tile, color: tile.kind === 'ring' ? 'cream' : 'mint' } : tile);
}

/** Home's section glyphs, as Customize Home draws them. */
const SECTION_ICONS: Record<HomeWidgetId, IconName> = {
  greeting: 'sun', overview: 'wallet', today: 'calendar', week: 'chart', capture: 'mail',
  assistant: 'spark', insight: 'trend', due: 'calendar', activity: 'receipt', upcoming: 'repeat',
};
/** The preview: the totals row, then this many of Home's sheet sections. */
export const HOME_PREVIEW_SECTIONS = 3;
/** A preview row's pitch at the default text size; it grows with the text size and with a wrapped label, never capped. */
const PREVIEW_PITCH = 28;
/** The space between one row's measured height and the next row. */
const PREVIEW_GAP = 6;

/**
 * The rows' pitch: at least the default scaled by the text size, and always
 * more than the tallest row as laid out (a label that wraps to two lines at a
 * larger text size pushes every place down, so nothing overlaps or clips).
 */
export function previewPitch(fontScale: number, rowHeights: readonly number[]): number {
  const scaled = Math.ceil(PREVIEW_PITCH * Math.max(1, Number.isFinite(fontScale) ? fontScale : 1));
  return Math.max(scaled, Math.ceil(Math.max(0, ...rowHeights)) + PREVIEW_GAP);
}

/**
 * Home's sheet sections in the order these goals will save them
 * (homeOrderForGoals over the saved layout, drawn as Home draws it): what
 * the preview stacks under the totals row. Hidden sections are left out.
 */
export function homePreviewOrder(goals: readonly GoalId[], current: HomeWidgetPreferences): HomeWidgetId[] {
  return splitHomeWidgetLayout(homeOrderForGoals(goals, current)).sheet;
}

/** The sections the chosen goals bring up: they wear the solid glyph tile in the preview. */
export function promotedHomeSections(goals: readonly GoalId[]): Set<HomeWidgetId> {
  return new Set(goals.flatMap((goal) => GOAL_HOME_SECTIONS[goal] ?? []));
}

/**
 * One section row of the preview. It sits at `index` (0 is right under the
 * totals) and slides there on the app's spring when a pick moves it; past the
 * last shown place it fades out. Reduce Motion puts it in place at once.
 */
function PreviewRow({ index, pitch, onHeight, label, icon, promoted, palette, motion, testID }: {
  index: number;
  pitch: number;
  /** The row's laid-out height, which sets the pitch. */
  onHeight: (height: number) => void;
  label: string;
  icon: IconName;
  promoted: boolean;
  palette: BandPalette;
  motion: MotionPreference;
  testID: string;
}) {
  const place = useAnimatedNumber(index);
  useEffect(() => {
    // Hold still until the screen-reader state is known.
    if (!motion.ready || motion.reducedMotion) {
      place.setValue(index);
      return;
    }
    const move = Animated.spring(place, { toValue: index, ...COIN_MOVE, useNativeDriver: nativeDriver });
    move.start();
    // A newer pick carries on from wherever the row is.
    return () => move.stop();
  }, [index, motion.ready, motion.reducedMotion, place]);
  const paint = useMemo(() => ({
    opacity: place.interpolate({
      inputRange: [HOME_PREVIEW_SECTIONS - 1, HOME_PREVIEW_SECTIONS - 0.4], outputRange: [1, 0], extrapolate: 'clamp',
    }),
    transform: [{ translateY: place.interpolate({ inputRange: [0, 1], outputRange: [pitch, pitch * 2] }) }],
  }), [place, pitch]);
  return <Animated.View testID={testID} onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    style={[styles.previewRow, paint]}>
    <PreviewGlyph icon={icon} solid={promoted} palette={palette} />
    <ThemedText type="meta"
      style={[styles.previewLabel, { color: promoted ? palette.onBand : palette.onBandSecondary }]}>
      {label}
    </ThemedText>
  </Animated.View>;
}

/** A small glyph tile: solid for a section the picks bring up, the band's tone otherwise. */
function PreviewGlyph({ icon, solid, palette }: { icon: IconName; solid: boolean; palette: BandPalette }) {
  return <View style={[styles.previewGlyph, { backgroundColor: solid ? palette.onBand : palette.tile }]}>
    <Icon name={icon} size={12} color={solid ? palette.band : palette.onBandSecondary} strokeWidth={2.2} />
  </View>;
}

/**
 * A miniature of Home's opening order, decorative: the totals row stays on
 * top (the goals never move it), and the sheet sections follow in the order
 * the picks will save. No figures — it shows where things go, not money.
 */
function HomePreview({ goals, palette, stacked }: { goals: readonly GoalId[]; palette: BandPalette; stacked: boolean }) {
  const language = useLanguage();
  const copy = customizeCopy(language);
  const motion = useMotionPreference();
  // Rows are placed (so a move is paint only), at a pitch that follows their measured height.
  const { fontScale } = useWindowDimensions();
  const [heights, setHeights] = useState<Record<string, number>>({});
  const measure = (id: string) => (height: number) => setHeights((known) =>
    known[id] === height ? known : { ...known, [id]: height });
  const pitch = previewPitch(fontScale, Object.values(heights));
  // The layout the gate will reorder when Continue saves (saveGoals reads the same).
  const [current, setCurrent] = useState<HomeWidgetPreferences>(DEFAULT_HOME_WIDGETS);
  useEffect(() => {
    let live = true;
    loadHomeWidgetPreferences().then((saved) => { if (live) setCurrent(saved); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const order = homePreviewOrder(goals, current);
  const promoted = promotedHomeSections(goals);
  return <View testID="onboarding-goals-home" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden
    style={[styles.preview, stacked && styles.previewStacked, { borderColor: palette.bandRule }]}>
    <View testID="onboarding-goals-home-rows" style={[styles.previewRows, { height: pitch * (HOME_PREVIEW_SECTIONS + 1) }]}>
      <View testID="onboarding-goals-home-overview" onLayout={(event) => measure('overview')(event.nativeEvent.layout.height)}
        style={[styles.previewRow, styles.previewTop]}>
        <PreviewGlyph icon={SECTION_ICONS.overview} solid={false} palette={palette} />
        <ThemedText type="meta"
          style={[styles.previewLabel, { color: palette.onBandSecondary }]}>
          {copy.widgetTitle.overview}
        </ThemedText>
      </View>
      <View style={[styles.previewRule, { top: pitch - 2, backgroundColor: palette.bandRule }]} />
      {/* Keyed by section, in a fixed order, so a pick slides rows rather than redrawing them. */}
      {DEFAULT_HOME_WIDGETS.order.filter((id) => order.includes(id)).map((id) =>
        <PreviewRow key={id} index={order.indexOf(id)} pitch={pitch} onHeight={measure(id)} label={copy.widgetTitle[id]} icon={SECTION_ICONS[id]}
          promoted={promoted.has(id)} palette={palette} motion={motion} testID={`onboarding-goals-home-${id}`} />)}
    </View>
  </View>;
}

/** Board E3's order: salary, bills, subscriptions, spend less, cash and cards. */
const SHOWN: readonly GoalId[] = ['salary', 'bills', 'subscriptions', 'spend-less', 'cash-cards'];

export function GoalsStep({ goals, saved = false, onToggle, onContinue, onBack, onClose, tiles, disabled, journey = '' }: {
  goals: readonly GoalId[];
  /** Which onboarding run this is: tray tiles shown earlier in the same run do not pop in again. */
  journey?: string;
  /** Goals were saved on an earlier pass: unpicking them all is a change, so the button stays Continue. */
  saved?: boolean;
  onToggle: (goal: GoalId) => void;
  onContinue: () => void;
  onBack: () => void;
  onClose?: () => void;
  /** The pattern so far: the name tile and the picked goals. */
  tiles: readonly PatternTile[];
  disabled: boolean;
}) {
  const language = useLanguage();
  const words = onboardingECopy(language);
  const bandWords = bandCopy(language);
  const band = useBand('flow');
  const largeText = useLargeTextLayout();
  const first = firstHomeSectionForGoals(goals);
  // What was already on the tray when this visit began; recorded once drawn.
  const [seenBefore] = useState(() => new Set(shownIn(journey)));
  const tray = trayTiles(tiles);
  useEffect(() => { const shown = shownIn(journey); for (const tile of tray) shown.add(tile.key); });
  return <EStepFrame palette={band} step={2} onBack={onBack} onClose={onClose} backDisabled={disabled} testID="onboarding-goals"
    footer={<EButton palette={band} color={bandButtonColor(band)} label={goals.length > 0 || saved ? words.continue : words.skipForNow}
      // Both labels' room is kept, so Skip for now (two lines at large text) giving way to Continue never moves the list.
      reserveLabels={[words.continue, words.skipForNow]}
      onPress={onContinue} disabled={disabled} testID="onboarding-goals-continue" />}>
    {/* The headline has the full width: the pictures sit under it, never beside it. */}
    <EHeadline palette={band} size={42}>{words.goalsTitle}</EHeadline>
    <View style={[styles.pictures, largeText && styles.picturesStacked]}>
      <HomePreview goals={goals} palette={band} stacked={largeText} />
      {/* Loose tiles straight on the band, as on the board: a fixed-width
          tray of three across, so picking a goal never reflows its neighbour. */}
      <View testID="onboarding-goals-pattern" accessible accessibilityRole="image" accessibilityLabel={bandWords.pattern}
        style={styles.tray}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={styles.trayTiles}>
          {tray.map((tile) =>
            <PatternMosaic key={tile.key} tiles={[tile]} tile={TRAY_TILE} compact animate={!seenBefore.has(tile.key)} />)}
        </View>
      </View>
    </View>
    <EBody palette={band} style={styles.hint} testID="onboarding-goals-hint">
      {first ? words.goalsHint[first] : words.goalsHintNone}
    </EBody>
    <View style={styles.list} testID="onboarding-goal-options">
      {SHOWN.filter((goal) => GOAL_IDS.includes(goal)).map((goal) => <EChoiceRow key={goal} palette={band}
        label={words.goals[goal]} checked={goals.includes(goal)} onPress={() => onToggle(goal)} disabled={disabled}
        testID={`onboarding-goal-${goal}`} />)}
    </View>
  </EStepFrame>;
}

const styles = StyleSheet.create({
  pictures: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  picturesStacked: { flexDirection: 'column', alignItems: 'stretch' },
  preview: { flex: 1, minWidth: 0, borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8 },
  // Stacked under large text, the preview takes the full width at its own height.
  previewStacked: { flex: 0, alignSelf: 'stretch' },
  // The totals row, a rule, then the shown sections: each row is placed, so a move is paint only.
  previewRows: { overflow: 'hidden' },
  previewRow: {
    position: 'absolute', top: 0, start: 0, end: 0,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  previewTop: { position: 'relative' },
  previewRule: { position: 'absolute', start: 0, end: 0, height: StyleSheet.hairlineWidth },
  previewGlyph: { width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  previewLabel: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 17 },
  tray: { width: TRAY_TILE * TRAY_COLUMNS + TRAY_GAP * (TRAY_COLUMNS - 1), alignSelf: 'flex-start' },
  trayTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: TRAY_GAP },
  list: { gap: 10 },
  hint: { fontSize: 16, lineHeight: 23 },
});
