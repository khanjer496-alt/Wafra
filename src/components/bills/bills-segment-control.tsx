import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { t } from '@/lib/i18n';

export type BillsSegment = 'upcoming' | 'subscriptions' | 'utilities' | 'cards' | 'all';

type BillsSegmentControlProps = {
  segment: BillsSegment;
  onChange: (segment: BillsSegment) => void;
};

/** Compact, horizontally scrollable Bills filters so five views fit on phones without a giant control. */
export function BillsSegmentControl({ segment, onChange }: BillsSegmentControlProps) {
  const theme = useTheme();
  const labels: Record<BillsSegment, string> = {
    upcoming: t('refUpcoming'),
    subscriptions: t('subscriptionsSeg'),
    utilities: t('utilitiesSeg'),
    cards: t('cardsSeg'),
    all: t('refAll'),
  };
  const segments: BillsSegment[] = ['upcoming', 'subscriptions', 'utilities', 'cards', 'all'];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      accessibilityLabel={t('billsTitle')}>
      <View role="tablist" style={styles.segment}>
        {segments.map((value) => {
          const active = segment === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityLabel={labels[value]}
              accessibilityState={{ selected: active }}
              aria-selected={active}
              onPress={() => {
                if (active) return;
                tapped();
                onChange(value);
              }}
              style={({ pressed }) => [
                styles.segmentItem,
                {
                  backgroundColor: active
                    ? theme.inverseSurface
                    : pressed
                      ? theme.backgroundSelected
                      : theme.backgroundElement,
                  borderColor: active ? theme.inverseSurface : theme.cardBorder,
                },
              ]}>
              <ThemedText
                type={active ? 'smallBold' : 'small'}
                style={{ color: active ? theme.inverseText : theme.textSecondary }}>
                {labels[value]}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingEnd: Spacing.one },
  segment: { flexDirection: 'row', gap: Spacing.two },
  segmentItem: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
