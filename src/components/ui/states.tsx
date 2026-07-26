import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { EASE, Fonts, Motion, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getActiveMarket } from '@/lib/markets';

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

/* ── Loading ─────────────────────────────────────────────────────────── */

/**
 * Skeleton rows sized to the real content, with a shimmer sweep staggered
 * 150ms down the list. Never a circular spinner: a spinner says "wait",
 * a skeleton says what is about to appear.
 */
export function SkeletonRows({ count = 4, height = 38 }: { count?: number; height?: number }) {
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} index={i} height={height} />
      ))}
    </View>
  );
}

function SkeletonRow({ index, height }: { index: number; height: number }) {
  const theme = useTheme();
  const shimmer = useSharedValue(0.55);

  useEffect(() => {
    // 150ms down the list, so the sweep reads as one motion rather than a
    // row of independently blinking bars.
    shimmer.value = withDelay(
      index * 150,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 700, easing: EASING }),
          withTiming(0.55, { duration: 700, easing: EASING }),
        ),
        -1,
        false,
      ),
    );
  }, [shimmer, index]);

  const style = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { height, backgroundColor: theme.backgroundSelected },
        style,
      ]}
    />
  );
}

/* ── Status pulse ────────────────────────────────────────────────────── */

/** 7px dot with a 2.8s breath: scale 1 → 1.4, opacity .85 → .3. */
export function PulseDot({ color, size = 7 }: { color: string; size?: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: Motion.pulse / 2, easing: EASING }),
      -1,
      true,
    );
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 0.4 }],
    opacity: 0.85 - progress.value * 0.55,
  }));

  return (
    <Animated.View
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}
    />
  );
}

/* ── Empty ───────────────────────────────────────────────────────────── */

export function EmptyMonth({
  monthName,
  onReadInbox,
  onAddManually,
}: {
  monthName: string;
  onReadInbox?: () => void;
  onAddManually: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.dashed, { borderColor: theme.cardBorderStrong }]}>
      <View style={styles.zero}>
        <ThemedText themeColor="textSecondary" style={styles.currencyPrefix}>
          {getActiveMarket().currency.display}
        </ThemedText>
        <ThemedText type="amount">0</ThemedText>
      </View>
      <ThemedText type="small">No entries in {monthName} yet</ThemedText>
      <ThemedText type="default" themeColor="textSecondary">
        Pull down to read your inbox, or add the last thing you paid for — one entry is enough to
        start the month.
      </ThemedText>
      <View style={styles.actions}>
        {onReadInbox && <Button inline label="Read inbox" onPress={onReadInbox} />}
        <Button inline variant="outline" label="Add manually" onPress={onAddManually} />
      </View>
    </View>
  );
}

/* ── Permission denied ───────────────────────────────────────────────── */

export function PermissionDenied({
  onOpenSettings,
  onKeepManual,
}: {
  onOpenSettings: () => void;
  onKeepManual?: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.deniedBlock,
        { backgroundColor: theme.expenseSoftBg, borderColor: theme.expenseSoftBorder },
      ]}>
      <View style={styles.deniedHead}>
        <Icon name="alert" size={17} color={theme.expense} />
        <ThemedText type="small" style={{ color: theme.expense }}>
          SMS access is off, so nothing can import
        </ThemedText>
      </View>
      <ThemedText type="default" themeColor="textSecondary">
        Turn it back on at Settings → Apps → Wafra → Permissions → SMS.
      </ThemedText>
      <View style={styles.actions}>
        <Button inline label="Open settings" onPress={onOpenSettings} />
        {onKeepManual && <Button inline variant="outline" label="Keep manual" onPress={onKeepManual} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonList: {
    gap: Spacing.two,
  },
  skeleton: {
    borderRadius: 8,
  },
  dashed: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.sheet + 2,
    padding: Spacing.four,
    gap: Spacing.two + 2,
  },
  currencyPrefix: {
    fontFamily: Fonts.monoMedium,
    fontSize: 15,
    lineHeight: 19,
  },
  zero: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two - 2,
    opacity: 0.35,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
    paddingTop: Spacing.two,
  },
  deniedBlock: {
    borderWidth: 1,
    borderRadius: Radius.sheet,
    padding: Spacing.three + 2,
    gap: Spacing.two,
  },
  deniedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
});
