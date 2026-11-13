import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { Icon, type IconName } from '@/components/ui/icon';
import { SectionHeader as CanonicalSectionHeader } from '@/components/ui/section-header';
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
          borderColor: theme.controlBorder,
        },
      ]}>
      <ThemedText type="meta" themeColor="textSecondary" style={styles.label}>
        {periodLabel(period)}
      </ThemedText>
      <Icon name="chevron-down" size={12} color={theme.textTertiary} />
    </SpringPressable>
  );
}

/** @deprecated Import ActionIconButton from ui/action-icon-button. */
export function IconButton({
  name,
  onPress,
  label,
}: {
  name: IconName;
  onPress: () => void;
  label: string;
}) {
  return <ActionIconButton icon={name} label={label} onPress={onPress} />;
}

/** @deprecated Import SectionHeader from ui/section-header. */
export function SectionHeader({
  title,
  right,
  onPressRight,
}: {
  title: string;
  right?: string;
  onPressRight?: () => void;
}) {
  if (right !== undefined && onPressRight) {
    return (
      <CanonicalSectionHeader title={title} action={{ label: right, onPress: onPressRight }} />
    );
  }
  if (right !== undefined) {
    return <CanonicalSectionHeader title={title} value={right} />;
  }
  return <CanonicalSectionHeader title={title} />;
}

const styles = StyleSheet.create({
  label: { flexShrink: 1 },
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
});
