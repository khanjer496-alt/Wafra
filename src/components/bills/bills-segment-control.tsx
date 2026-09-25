import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import { paymentAgendaCopy } from '@/lib/reference-copy';

/**
 * Two views: what falls due in the next 30 days, and everything.
 *
 * The three payment-type views that used to sit beside them (subscriptions,
 * utilities, cards) are still one tap away as filters inside All, with the
 * same per-type totals and empty states — see {@link BillsGroupFilter}.
 */
export type BillsSegment = 'upcoming' | 'all';
/** Payment-type filter inside All. */
export type BillsGroupFilterValue = 'everything' | 'subscriptions' | 'utilities' | 'cards';

type BillsSegmentControlProps = {
  segment: BillsSegment;
  onChange: (segment: BillsSegment) => void;
};

/** Compact Bills views: horizontally scrollable on native, wrapping safely on narrow web viewports. */
export function BillsSegmentControl({ segment, onChange }: BillsSegmentControlProps) {
  const theme = useTheme();
  const w = moneyPlacesWords(useLanguage());
  // At the accessibility text sizes a sideways-scrolling row hides tall chips
  // off screen; they wrap onto lines instead, as on the web.
  const largeText = useLargeTextLayout();
  const wrap = Platform.OS === 'web' || largeText;
  const labels: Record<BillsSegment, string> = {
    upcoming: w.next30Days,
    all: w.allBills,
  };
  const segments: BillsSegment[] = ['upcoming', 'all'];

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
            testID={`bills-segment-${value}`}
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

/** Inside All: the payment types that used to be their own tabs, as quieter filter chips. */
export function BillsGroupFilter({ value, onChange }: {
  value: BillsGroupFilterValue;
  onChange: (value: BillsGroupFilterValue) => void;
}) {
  const theme = useTheme();
  const language = useLanguage();
  const w = moneyPlacesWords(language);
  const agenda = paymentAgendaCopy[language === 'ar' ? 'ar' : 'en'];
  // Same rule as the views above: wrap rather than scroll sideways at the
  // accessibility text sizes.
  const largeText = useLargeTextLayout();
  const wrap = Platform.OS === 'web' || largeText;
  const labels: Record<BillsGroupFilterValue, string> = {
    everything: w.everything,
    subscriptions: agenda.subscriptions,
    utilities: agenda.utilities,
    cards: agenda.cards,
  };
  const values: BillsGroupFilterValue[] = ['everything', 'subscriptions', 'utilities', 'cards'];
  const chips = (
      <View style={[styles.segment, wrap && styles.webSegment]}>
        {values.map((option) => {
          const active = value === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={labels[option]}
              accessibilityState={{ selected: active }}
              testID={`bills-filter-${option}`}
              onPress={() => {
                if (active) return;
                tapped();
                onChange(option);
              }}
              style={({ pressed }) => [
                styles.filterItem,
                {
                  backgroundColor: active ? theme.primarySoft : pressed ? theme.backgroundSelected : 'transparent',
                  borderColor: active ? theme.primary : theme.cardBorder,
                },
              ]}>
              <ThemedText type={active ? 'smallBold' : 'small'}
                style={[styles.segmentLabel, { color: active ? theme.text : theme.textSecondary }]}>
                {labels[option]}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
  );
  if (wrap) return <View style={styles.webContainer} testID="bills-group-filter">{chips}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}
      testID="bills-group-filter">
      {chips}
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
  filterItem: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    maxWidth: '100%',
  },
  segmentLabel: { flexShrink: 1, textAlign: 'center' },
});
