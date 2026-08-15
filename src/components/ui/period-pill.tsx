import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { SpringPressable } from '@/components/ui/spring-pressable';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { tf } from '@/lib/i18n';
import { periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';

/**
 * The reporting period, as a chip.
 *
 * Every screen reports on the same period, so it belongs in the same place on
 * each of them — top left, one tap from the picker — rather than as a chevron
 * navigator that only existed on Insights.
 */
export function PeriodPill({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const language = useLanguage();
  const { period } = usePeriod();

  return (
    <SpringPressable
      onPress={() => {
        tapped();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={tf('reportingPeriod', { period: periodLabel(period) }, language)}
      style={[
        styles.pill,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.cardBorder,
        },
      ]}>
      <ThemedText type="micro" themeColor="textSecondary">
        {periodLabel(period)}
      </ThemedText>
      <Icon name="chevron-down" size={12} color={theme.textTertiary} />
    </SpringPressable>
  );
}

/**
 * A labelled pill that goes somewhere — the pill's navigation counterpart.
 *
 * Labelled, not a glyph. The one destination this exists for, `/stats`, is the
 * long form of the Flow tab, and the only icon that would say so is `chart` —
 * which is the Flow tab's own glyph, sitting in the bar at the bottom of the
 * same screen. A word cannot be mistaken for the tab you are already on.
 *
 * `label` is already-translated text: this file must not hold an English
 * string, because contracts.test.js scans src/components for them. Callers pass
 * t('…'), which also keeps the accessibility label in the reader's language.
 */
export function LinkPill({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <SpringPressable
      // Same tapped() as PeriodPill and IconButton. A pill that navigates
      // without the tick feels dead next to the two beside it in the header.
      onPress={() => {
        tapped();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={[
        styles.pill,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.primaryBorder,
        },
      ]}>
      <ThemedText type="micro" themeColor="primary">
        {label}
      </ThemedText>
      <Icon name="chevron-right" size={12} color={theme.primary} />
    </SpringPressable>
  );
}

/** A 44×44 bordered icon button — the square counterpart to the pill. */
export function IconButton({
  name,
  onPress,
  label,
}: {
  name: React.ComponentProps<typeof Icon>['name'];
  onPress: () => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <SpringPressable
      onPress={() => {
        tapped();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={[
        styles.iconBtn,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.cardBorder,
        },
      ]}>
      <Icon name={name} size={17} color={theme.textSecondary} />
    </SpringPressable>
  );
}

/** Caps section header with an optional action on the right. */
export function SectionHeader({
  title,
  right,
  onPressRight,
}: {
  title: string;
  right?: string;
  onPressRight?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <ThemedText type="micro" themeColor="textTertiary" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      {right !== undefined &&
        (onPressRight ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              tapped();
              onPressRight();
            }}
            style={styles.sectionAction}>
            <ThemedText type="micro" themeColor="primary">
              {right}
            </ThemedText>
          </Pressable>
        ) : (
          <ThemedText type="micro" themeColor="textTertiary" tabular>
            {right}
          </ThemedText>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.full,
    paddingStart: 12,
    paddingEnd: 11,
    paddingVertical: 6,
    minHeight: 44,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  sectionTitle: {
    flexShrink: 1,
  },
  sectionAction: {
    flexShrink: 0,
    minHeight: 44,
    justifyContent: 'center',
    marginVertical: -14,
  },
});
