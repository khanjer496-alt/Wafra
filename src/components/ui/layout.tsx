import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Motion, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Section enter: translateY 10 → 0 over 320ms, staggered 40ms per section.
 * `index` is the section's position on the screen, not a delay in ms.
 */
export function Section({
  index = 0,
  style,
  children,
  ...rest
}: ViewProps & { index?: number }) {
  return (
    <Animated.View
      entering={FadeInDown.delay(index * Motion.sectionStagger)
        .duration(Motion.sectionEnter)
        .withInitialValues({ transform: [{ translateY: 10 }] })}
      style={style}
      {...rest}>
      {children}
    </Animated.View>
  );
}

/** Caps header with an optional trailing figure or link. */
export function SectionHeader({
  title,
  action,
  onAction,
  trailing,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  trailing?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <ThemedText type="micro" themeColor="textTertiary">
        {title}
      </ThemedText>
      {trailing}
      {action && (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onAction}>
          <ThemedText type="micro" style={{ color: theme.primary }}>
            {action}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

/**
 * A list row. Grouping is done with 1px dividers rather than cards, so every
 * row carries a top border and the list closes with one on the last row.
 */
export function Row({
  onPress,
  onLongPress,
  last,
  style,
  children,
  accessibilityLabel,
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  /** Draws the closing border under the final row of a list. */
  last?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const border = {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.cardBorder,
    ...(last
      ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.cardBorder }
      : null),
  };

  if (!onPress && !onLongPress) {
    return <View style={[styles.row, border, style]}>{children}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        border,
        // Row press is scale only — no opacity change, so the figure never
        // fades out from under the thumb.
        pressed && { transform: [{ scale: 0.985 }] },
        style,
      ]}>
      {children}
    </Pressable>
  );
}

/** Bordered block: the shape used when a whole group is one tappable thing. */
export function Block({
  onPress,
  tone = 'default',
  style,
  children,
}: {
  onPress?: () => void;
  tone?: 'default' | 'expense';
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const surface =
    tone === 'expense'
      ? { backgroundColor: theme.expenseSoftBg, borderColor: theme.expenseSoftBorder }
      : { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder };

  if (!onPress) return <View style={[styles.block, surface, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.block,
        surface,
        pressed && { transform: [{ scale: 0.985 }] },
        style,
      ]}>
      {children}
    </Pressable>
  );
}

/** Label / value table used inside every detail sheet. */
export function LabelTable({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  const theme = useTheme();
  return (
    <View>
      {rows.map((r, i) => (
        <View
          key={r.label}
          style={[
            styles.tableRow,
            {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.cardBorder,
              ...(i === rows.length - 1
                ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.cardBorder }
                : null),
            },
          ]}>
          <ThemedText type="micro" themeColor="textTertiary" style={styles.tableLabel}>
            {r.label}
          </ThemedText>
          <View style={styles.tableValue}>{r.value}</View>
        </View>
      ))}
    </View>
  );
}

/** Back chevron + caps title, the header on every pushed screen. */
export function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.screenHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} onPress={onBack}>
        <Icon name="chevron-left" size={20} color={theme.text} />
      </Pressable>
      <ThemedText type="micro" themeColor="textTertiary">
        {title}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 2,
    paddingVertical: 13,
  },
  block: {
    borderWidth: 1,
    borderRadius: Radius.sheet,
    padding: Spacing.three + 2,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingVertical: Spacing.three - 4,
  },
  tableLabel: {
    width: 110,
    paddingTop: 2,
  },
  tableValue: {
    flex: 1,
    gap: 2,
  },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    paddingVertical: Spacing.two + 2,
  },
});
