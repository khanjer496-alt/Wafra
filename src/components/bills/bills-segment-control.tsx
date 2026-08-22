import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, ScreenPadding } from '@/constants/theme';
import { t } from '@/lib/i18n';

export type BillsSegment = 'subscriptions' | 'cards' | 'utilities';

type BillsSegmentControlProps = {
  segment: BillsSegment;
  onChange: (segment: BillsSegment) => void;
  subscriptionCount: number;
  cardCount: number;
  utilityCount: number;
  largeText: boolean;
  theme: (typeof Colors)[keyof typeof Colors];
};

export function BillsSegmentControl({
  segment,
  onChange,
  subscriptionCount,
  cardCount,
  utilityCount,
  largeText,
  theme,
}: BillsSegmentControlProps) {
  const labels: Record<BillsSegment, string> = {
    subscriptions: `${t('subscriptionsSeg')} ${subscriptionCount}`,
    cards: `${t('cardsSeg')} ${cardCount}`,
    utilities: `${t('utilitiesSeg')} ${utilityCount}`,
  };

  return (
    <View role="tablist" style={[styles.segment, largeText && styles.segmentLarge, { backgroundColor: theme.backgroundSelected }]}>
      {(Object.keys(labels) as BillsSegment[]).map((item) => (
        <Pressable
          key={item}
          accessibilityRole="tab"
          accessibilityState={{ selected: segment === item }}
          aria-selected={segment === item}
          onPress={() => onChange(item)}
          style={[
            styles.segmentItem,
            segment === item && {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.controlBorder,
              borderWidth: 1,
            },
          ]}>
          <ThemedText
            type="nano"
            numberOfLines={largeText ? undefined : 1}
            tabular
            themeColor={segment === item ? 'text' : 'textTertiary'}>
            {labels[item]}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', marginHorizontal: ScreenPadding, borderRadius: 11, padding: 3, gap: 3 },
  segmentLarge: { flexDirection: 'column' },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 8 },
});
