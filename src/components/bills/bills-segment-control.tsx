import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';

export type BillsSegment = 'subscriptions' | 'cards' | 'utilities';

type BillsSegmentControlProps = {
  segment: BillsSegment;
  onChange: (segment: BillsSegment) => void;
  subscriptionCount: number;
  cardCount: number;
  utilityCount: number;
  largeText: boolean;
};

export function BillsSegmentControl({
  segment,
  onChange,
  subscriptionCount,
  cardCount,
  utilityCount,
  largeText,
}: BillsSegmentControlProps) {
  const theme = useTheme();
  const labels: Record<BillsSegment, string> = {
    subscriptions: `${t('subscriptionsSeg')} ${subscriptionCount}`,
    cards: `${t('cardsSeg')} ${cardCount}`,
    utilities: `${t('utilitiesSeg')} ${utilityCount}`,
  };
  const segments = (Object.keys(labels) as BillsSegment[]).map((value) => ({
    value,
    label: labels[value],
  }));

  return largeText ? (
    <View
      role="tablist"
      accessibilityLabel={t('billsTitle')}
      style={[
        styles.segment,
        largeText && styles.segmentLarge,
        { backgroundColor: theme.backgroundSelected },
      ]}>
      {segments.map((item) => (
        <Pressable
          key={item.value}
          accessibilityRole="tab"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: segment === item.value }}
          aria-selected={segment === item.value}
          onPress={() => onChange(item.value)}
          style={[
            styles.segmentItem,
            Platform.OS === 'android' && styles.segmentItemAndroid,
            segment === item.value && {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.controlBorder,
            },
          ]}>
          <ThemedText
            type="nano"
            tabular
            themeColor={segment === item.value ? 'text' : 'textTertiary'}>
            {item.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  ) : (
    <SegmentedControl
      segments={segments}
      value={segment}
      onChange={onChange}
      label={t('billsTitle')}
    />
  );
}

const styles = StyleSheet.create({
  segment: {
    padding: Spacing.one,
    borderRadius: Radius.control,
    gap: Spacing.one,
  },
  segmentLarge: { flexDirection: 'column' },
  segmentItem: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.tile,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: Spacing.two,
  },
  segmentItemAndroid: { minHeight: 48 },
});
