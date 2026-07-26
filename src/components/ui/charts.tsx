import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

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

/** The neutral half of the in/out pair: out, when it isn't this month. */
export function useOutBarColor(): string {
  const scheme = useColorScheme();
  return scheme === 'dark' ? '#4A3A34' : '#DCC9C2';
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

export function PairedBars({
  months,
  height = 118,
  onPressMonth,
}: {
  months: MonthPair[];
  height?: number;
  onPressMonth?: (index: number) => void;
}) {
  const theme = useTheme();
  const outColor = useOutBarColor();
  const max = Math.max(1, ...months.flatMap((m) => [m.inFils, m.outFils]));

  return (
    <View style={styles.pairRow}>
      {months.map((m, i) => (
        <Pressable
          key={m.label + i}
          accessibilityRole={onPressMonth ? 'button' : undefined}
          accessibilityLabel={`${m.label}`}
          disabled={!onPressMonth}
          onPress={() => onPressMonth?.(i)}
          style={styles.pairColumn}>
          <View style={[styles.pairBars, { height }]}>
            <Animated.View
              entering={FadeIn.delay(i * 50).duration(Motion.sectionEnter)}
              style={[
                styles.bar,
                { height: Math.max(3, (m.inFils / max) * height), backgroundColor: theme.primary },
              ]}
            />
            <Animated.View
              entering={FadeIn.delay(i * 50 + 30).duration(Motion.sectionEnter)}
              style={[
                styles.bar,
                {
                  height: Math.max(3, (m.outFils / max) * height),
                  backgroundColor: m.current ? theme.expense : outColor,
                },
              ]}
            />
          </View>
          <ThemedText type="nano" themeColor={m.current ? 'text' : 'textTertiary'}>
            {m.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
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
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
  },
  bar: {
    width: 11,
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
