import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { t } from '@/lib/i18n';

export type BillsSegment = 'upcoming' | 'subscriptions' | 'utilities' | 'cards' | 'all';

type BillsSegmentControlProps = {
  segment: BillsSegment;
  onChange: (segment: BillsSegment) => void;
};

/** Compact Bills filters: horizontally scrollable on native, wrapping safely on narrow web viewports. */
export function BillsSegmentControl({ segment, onChange }: BillsSegmentControlProps) {
  const theme = useTheme();
  // At the accessibility text sizes a sideways-scrolling row hides most of
  // five tall chips off screen; they wrap onto lines instead, as on the web.
  const largeText = useLargeTextLayout();
  const wrap = Platform.OS === 'web' || largeText;
  const labels: Record<BillsSegment, string> = {
    upcoming: t('refUpcoming'),
    subscriptions: t('subscriptionsSeg'),
    utilities: t('utilitiesSeg'),
    cards: t('cardsSeg'),
    all: t('refAll'),
  };
  const segments: BillsSegment[] = ['upcoming', 'subscriptions', 'utilities', 'cards', 'all'];

  const tabs = (
    <View role="tablist" style={[styles.segment, wrap && styles.webSegment]}>
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
              style={[styles.segmentLabel, { color: active ? theme.inverseText : theme.textSecondary }]}>
              {labels[value]}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );

  if (wrap) {
    return (
      <View style={styles.webContainer} accessibilityLabel={t('billsTitle')}>
        {tabs}
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      accessibilityLabel={t('billsTitle')}>
      {tabs}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingEnd: Spacing.one },
  webContainer: { width: '100%' },
  segment: { flexDirection: 'row', gap: Spacing.two },
  webSegment: { flexWrap: 'wrap', width: '100%' },
  segmentItem: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    maxWidth: '100%',
  },
  segmentLabel: { flexShrink: 1, textAlign: 'center' },
});
