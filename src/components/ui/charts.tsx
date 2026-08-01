import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Motion, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

/**
 * One hue at five lightnesses. Composition is a question of proportion, not
 * of identity, so the segments differ in weight rather than in colour.
 */
const RAMP_LIGHT = ['#1F6B52', '#3D8A72', '#63A791', '#8CBFAE', '#B2D4C7'];
const RAMP_DARK = ['#57B894', '#48A07F', '#3B826A', '#2F6754', '#264F41'];

export function useRamp(): string[] {
  const scheme = useColorScheme();
  return scheme === 'dark' ? RAMP_DARK : RAMP_LIGHT;
}

/* ── Progress ────────────────────────────────────────────────────────── */

interface ProgressBarProps {
  /** 0..1; above 1 is clamped, but the caller picks the colour that says so. */
  ratio: number;
  color: string;
  height?: number;
  /** Overrides the track on surfaces that ignore the OS theme. */
  trackColor?: string;
}

export function ProgressBar({ ratio, color, height = 6, trackColor }: ProgressBarProps) {
  const theme = useTheme();
  const clamped = Math.max(0.02, Math.min(ratio, 1));
  return (
    <View
      style={[styles.track, { backgroundColor: trackColor ?? theme.track, height, borderRadius: height / 2 }]}>
      <View
        style={{ width: `${clamped * 100}%`, height: '100%', backgroundColor: color, borderRadius: height / 2 }}
      />
    </View>
  );
}

/* ── Composition bar ─────────────────────────────────────────────────── */

export interface CompositionSegment {
  key: string;
  label: string;
  value: number;
  /** The leftover bucket: neutral, so it never reads as a sixth category. */
  neutral?: boolean;
}

/**
 * A single 12px stacked bar, replacing the donut. A donut asks you to compare
 * arcs; a bar puts every share on one axis, and the leftover track is the part
 * of the month that has not been spent.
 */
export function CompositionBar({
  segments,
  height = 12,
}: {
  segments: CompositionSegment[];
  height?: number;
}) {
  const theme = useTheme();
  const ramp = useRamp();
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return <View style={[styles.track, { backgroundColor: theme.track, height, borderRadius: height / 2 }]} />;
  }
  return (
    <View
      style={[
        styles.track,
        styles.composition,
        { backgroundColor: theme.track, height, borderRadius: height / 2 },
      ]}>
      {segments.map((s, i) => (
        <Animated.View
          key={s.key}
          entering={FadeIn.delay(i * 60).duration(Motion.sectionEnter)}
          accessibilityLabel={`${s.label} ${Math.round((s.value / total) * 100)} percent`}
          style={{
            flexGrow: s.value,
            flexBasis: 0,
            backgroundColor: s.neutral ? theme.cardBorderStrong : ramp[i % ramp.length],
            // Segments are separated by a background-coloured gap, not a
            // border: a border would eat into the smallest slices.
            borderRightWidth: i === segments.length - 1 ? 0 : 1,
            borderRightColor: theme.background,
          }}
        />
      ))}
    </View>
  );
}

/* ── In vs out, six months ───────────────────────────────────────────── */

export interface MonthPair {
  label: string;
  inFils: number;
  outFils: number;
  current?: boolean;
}

/** A colour and what it means. Two bars per column need saying out loud. */
function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendKey}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <ThemedText type="nano" themeColor="textTertiary">
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * In and out, side by side, one pair per month.
 *
 * This is the only in/out chart in the app. Flow used to draw its own copy
 * inline with a second set of bar widths, so the same six months rendered two
 * different ways depending on which screen you were standing on.
 *
 * Colour here means SERIES and nothing else: accent is in, clay is out, in
 * every month. It used to mean two things at once — out was clay in the
 * selected month and a muted brown everywhere else — so the legend's clay
 * "Out" swatch sat under five brown bars and one clay one, and the muting read
 * as "these five months are a different quantity" rather than "this one is
 * now". "Now" is a position on a time axis, not a third quantity, so it is
 * marked positionally: the current column keeps its label in full ink and
 * carries a tick beneath it.
 */
export function PairedBars({
  months,
  height = 118,
  legend = true,
  onPressMonth,
}: {
  months: MonthPair[];
  height?: number;
  /** Off only where a caption above already names the two series. */
  legend?: boolean;
  onPressMonth?: (index: number) => void;
}) {
  const theme = useTheme();
  const max = Math.max(1, ...months.flatMap((m) => [m.inFils, m.outFils]));

  return (
    <View style={styles.pairWrap}>
      <View style={styles.pairRow}>
        {months.map((m, i) => (
          <Pressable
            key={m.label + i}
            accessibilityRole={onPressMonth ? 'button' : undefined}
            accessibilityLabel={m.label}
            disabled={!onPressMonth}
            onPress={() => onPressMonth?.(i)}
            style={styles.pairColumn}>
            <View style={[styles.pairBars, { height }]}>
              <Animated.View
                entering={FadeIn.delay(i * 50).duration(Motion.sectionEnter)}
                style={[
                  styles.pairBar,
                  { height: Math.max(3, (m.inFils / max) * height), backgroundColor: theme.primary },
                ]}
              />
              <Animated.View
                entering={FadeIn.delay(i * 50 + 30).duration(Motion.sectionEnter)}
                style={[
                  styles.pairBar,
                  {
                    height: Math.max(3, (m.outFils / max) * height),
                    backgroundColor: theme.expense,
                  },
                ]}
              />
            </View>
            <ThemedText type="nano" themeColor={m.current ? 'text' : 'textTertiary'}>
              {m.label}
            </ThemedText>
            {/* The "you are here" tick. Ink, not a hue: it marks a position on
                the axis, and every hue in this chart is already spoken for. */}
            <View
              style={[
                styles.nowTick,
                { backgroundColor: m.current ? theme.text : 'transparent' },
              ]}
            />
          </Pressable>
        ))}
      </View>

      {legend && (
        <View style={styles.legend}>
          <LegendKey color={theme.primary} label="In" />
          <LegendKey color={theme.expense} label="Out" />
        </View>
      )}
    </View>
  );
}

/* ── Curve ───────────────────────────────────────────────────────────── */

/** Only the value: the axis labels belong to the caller, under the chart. */
export interface CurvePoint {
  fils: number;
}

/**
 * A continuous quantity over time — net worth, and nothing else so far.
 *
 * Bars would be wrong here: a bar chart says "these are six separate amounts",
 * and a balance is one amount that never stopped existing between the months.
 * The baseline is drawn at zero when the series crosses it, so "underwater"
 * reads instantly rather than having to be worked out from the axis labels.
 */
export function TrendCurve({
  points,
  height = 132,
  width = 320,
}: {
  points: CurvePoint[];
  height?: number;
  /** Measured width of the container; the path is drawn to it. */
  width?: number;
}) {
  const theme = useTheme();
  if (points.length < 2) return null;

  const values = points.map((p) => p.fils);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Scaled to the DATA, not anchored at zero. A net-worth series that lives at
  // AED 300k and moves 58k of it is a straight line on a zero-anchored axis —
  // the movement, which is the only reason to draw a curve rather than print
  // the figure, disappears. The absolute amount is stated above the chart in
  // full; this is here for the shape. Zero still enters the range, and gets
  // its dashed baseline, the moment the series goes underwater.
  // A series that never moves is centred rather than pinned to the floor.
  const flat = max === min;
  const lo = flat ? min - 1 : min;
  const hi = flat ? max + 1 : max;
  const span = hi - lo;
  const crossesZero = lo < 0 && hi > 0;
  // A little air top and bottom so the last point never sits on the edge.
  const pad = Spacing.two;
  const plot = height - pad * 2;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (fils: number) => pad + (1 - (fils - lo) / span) * plot;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.fils)}`).join(' ');
  const area = `${line} L${width},${y(lo)} L0,${y(lo)} Z`;
  const last = points[points.length - 1];
  const rising = last.fils >= points[0].fils;
  const stroke = rising ? theme.primary : theme.expense;

  return (
    <Svg width={width} height={height}>
      {/* The fill is the same hue at a whisper — it gives the line a body
          without becoming a second colour in the system. */}
      <Path d={area} fill={stroke} opacity={0.09} />
      {crossesZero && (
        <Line
          x1={0}
          y1={y(0)}
          x2={width}
          y2={y(0)}
          stroke={theme.cardBorderStrong}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
      <Path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={x(points.length - 1)} cy={y(last.fils)} r={3.5} fill={stroke} />
    </Svg>
  );
}

/* ── History strip ───────────────────────────────────────────────────── */

/**
 * Six bars of the same charge over six months. When the amount never moves,
 * the strip is flat — which is the whole finding.
 */
export function HistoryStrip({
  months,
  height = 46,
}: {
  months: { label: string; fils: number; current?: boolean }[];
  height?: number;
}) {
  const theme = useTheme();
  const max = Math.max(1, ...months.map((m) => m.fils));
  return (
    <View style={styles.pairRow}>
      {months.map((m, i) => (
        <View key={m.label + i} style={styles.pairColumn}>
          <View style={[styles.historyBarWrap, { height }]}>
            <View
              style={[
                styles.bar,
                styles.historyBar,
                {
                  height: Math.max(4, (m.fils / max) * height),
                  backgroundColor: m.current ? theme.primary : theme.track,
                },
              ]}
            />
          </View>
          <ThemedText type="nano" themeColor={m.current ? 'text' : 'textTertiary'}>
            {m.label}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    overflow: 'hidden',
    borderRadius: Radius.full,
    width: '100%',
  },
  composition: {
    flexDirection: 'row',
  },
  pairWrap: {
    gap: Spacing.three,
  },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  pairColumn: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.two - 2,
  },
  pairBars: {
    // Stretch, not shrink-to-fit: the column centres its children, so without
    // this the row collapses to the width of two flex-basis-0 bars — which is
    // nothing, and the chart renders empty.
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
  },
  /** Bars share the column and cap out, so six months and twelve both fit. */
  pairBar: {
    flex: 1,
    maxWidth: 14,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  nowTick: {
    width: 14,
    height: 2,
    borderRadius: 1,
    marginTop: 1,
  },
  legend: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  legendKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 2,
  },
  swatch: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  bar: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  historyBarWrap: {
    justifyContent: 'flex-end',
  },
  historyBar: {
    width: 16,
  },
});
