import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Motion, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { formatAED } from '@/lib/format';
import { isRTL, t, tf } from '@/lib/i18n';

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

// There is deliberately no `useOutBarColor` here any more. It returned a muted
// brown for the out bar in every month except the selected one, which made one
// colour mean two things at once — series AND recency — and left the legend's
// clay "Out" swatch sitting above five brown bars and one clay one. PairedBars
// marks "now" positionally instead, so the hook had no caller left (checked
// across src/ before deleting). Do not bring it back to dim a bar: dimming a
// bar changes what the bar says it measures.

/* ── Progress ────────────────────────────────────────────────────────── */

export { ProgressBar } from '@/components/ui/progress-bar';

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
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={t('noSpendingComposition')}
        style={[styles.track, { backgroundColor: theme.track, height, borderRadius: height / 2 }]}
      />
    );
  }
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={segments
        .map((s) =>
          tf('compositionPercent', {
            label: s.label,
            percent: Math.round((s.value / total) * 100),
          }),
        )
        .join('. ')}
      style={[
        styles.track,
        styles.composition,
        { backgroundColor: theme.track, height, borderRadius: height / 2 },
      ]}>
      {segments.map((s, i) => (
        <Animated.View
          key={s.key}
          accessible={false}
          entering={FadeIn.delay(i * 60).duration(Motion.sectionEnter)}
          style={{
            flexGrow: s.value,
            flexBasis: 0,
            backgroundColor: s.neutral ? theme.cardBorderStrong : ramp[i % ramp.length],
            // Segments are separated by a background-coloured gap, not a
            // border: a border would eat into the smallest slices. `End` and
            // not `Right`, so under RTL the gap stays on the trailing edge
            // instead of doubling up on the leading one.
            borderEndWidth: i === segments.length - 1 ? 0 : 1,
            borderEndColor: theme.background,
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

const BAR_SPRING = {
  damping: 23,
  stiffness: 250,
  mass: 0.82,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;

function AnimatedChartBar({
  color,
  delay,
  height,
  style,
}: {
  color: string;
  delay: number;
  height: number;
  style: object;
}) {
  const reducedMotion = useReducedMotion();
  const animatedHeight = useSharedValue(reducedMotion ? height : 0);

  useEffect(() => {
    animatedHeight.value = reducedMotion
      ? height
      : withDelay(delay, withSpring(height, BAR_SPRING), ReduceMotion.System);
  }, [animatedHeight, delay, height, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ height: animatedHeight.value }));

  return (
    <Animated.View
      accessible={false}
      style={[style, { backgroundColor: color }, animatedStyle]}
    />
  );
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
 *
 * The two colours are read into locals that both the bars AND the legend
 * swatches use. That is what stops the legend from describing a bar it does
 * not match again — the defect above was only possible because the swatch held
 * a colour literal of its own.
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
  // The graphic clay, not the text clay: theme.ts holds `expense` to WCAG AA
  // because it carries meaning as TEXT, and keeps `expenseGraphic` for bars and
  // dots, where 3:1 is the bar and the AA value goes muddy at this size.
  const inColor = theme.primary;
  const outColor = theme.expenseGraphic;
  const max = Math.max(1, ...months.flatMap((m) => [m.inFils, m.outFils]));

  return (
    <View style={styles.pairWrap}>
      <View style={styles.pairRow}>
        {months.map((m, i) => (
          <Pressable
            key={m.label + i}
            accessibilityRole={onPressMonth ? 'button' : undefined}
            accessibilityLabel={tf('monthCashflowA11y', {
              month: m.label,
              income: formatAED(m.inFils),
              spending: formatAED(m.outFils),
            })}
            disabled={!onPressMonth}
            onPress={() => onPressMonth?.(i)}
            style={styles.pairColumn}>
            <View style={[styles.pairBars, { height }]}>
              <AnimatedChartBar
                color={inColor}
                delay={i * 36}
                height={Math.max(3, (m.inFils / max) * height)}
                style={styles.pairBar}
              />
              <AnimatedChartBar
                color={outColor}
                delay={i * 36 + 24}
                height={Math.max(3, (m.outFils / max) * height)}
                style={styles.pairBar}
              />
            </View>
            <ThemedText type="nano" themeColor={m.current ? 'text' : 'textTertiary'}>
              {m.label}
            </ThemedText>
            {/* The "you are here" tick. Ink, not a hue: it marks a position on
                the axis, and every hue in this chart is already spoken for. */}
            <View
              style={[styles.nowTick, { backgroundColor: m.current ? theme.text : 'transparent' }]}
            />
          </Pressable>
        ))}
      </View>

      {legend && (
        <View style={styles.legend}>
          <LegendKey color={inColor} label={t('inLabel')} />
          <LegendKey color={outColor} label={t('outLabel')} />
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
  // Under RTL the month axis is mirrored by the layout — أغسطس (newest) on the
  // left through مارس (oldest) on the right — but an SVG path is drawn in its
  // own coordinate space and `direction: rtl` does not touch it. With only the
  // labels flipped, a rising series ran UPHILL TOWARDS THE OLDEST MONTH, so an
  // Arabic reader saw their net worth falling while the caption directly under
  // the chart said "+40,470 since March". Mirror the plot with the axis.
  const rtl = isRTL();
  const x = (i: number) => {
    const at = (i / (points.length - 1)) * width;
    return rtl ? width - at : at;
  };
  const y = (fils: number) => pad + (1 - (fils - lo) / span) * plot;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.fils)}`).join(' ');
  // The wash under the line closes through the two baseline corners, and they
  // have to be taken in the order the line left off. Under RTL the path ends at
  // x=0, so the LTR order (width, then 0) sent it back across the whole chart
  // and then out again along the floor: the polygon crossed itself, and the
  // nonzero fill that survived was a bowtie sliver between the curve and its
  // own chord rather than the area beneath it.
  const area = rtl
    ? `${line} L0,${y(lo)} L${width},${y(lo)} Z`
    : `${line} L${width},${y(lo)} L0,${y(lo)} Z`;
  const last = points[points.length - 1];
  const rising = last.fils >= points[0].fils;
  // Falling takes the graphic clay for the same reason the bars do: this is a
  // 2px stroke and a wash, which theme.ts holds to 3:1 rather than to AA.
  const stroke = rising ? theme.primary : theme.expenseGraphic;

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
        <View
          key={m.label + i}
          accessible
          accessibilityRole="image"
          // A month and an amount, with no English connective between them, so
          // the label reads the same under Arabic — formatAED already localises
          // the figure.
          accessibilityLabel={`${m.label}, ${formatAED(m.fils)}`}
          style={styles.pairColumn}>
          <View style={[styles.historyBarWrap, { height }]}>
            <AnimatedChartBar
              color={m.current ? theme.primary : theme.track}
              delay={i * 36}
              height={Math.max(4, (m.fils / max) * height)}
              style={[styles.bar, styles.historyBar]}
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
