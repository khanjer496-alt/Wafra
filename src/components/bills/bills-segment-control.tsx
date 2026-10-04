import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BandSegmented } from '@/components/ui/band/band-segmented';
import { BandLayout, Spacing, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { tapped } from '@/lib/haptics';
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
  /** The ochre band it sits on. */
  palette: BandPalette;
};

/**
 * Next 30 days · All, set on the Bills band (design language E): a tablist
 * whose track is the band's own tone and whose selected pill is ink with
 * cream text on ochre. It stacks at the accessibility text sizes.
 */
export function BillsSegmentControl({ segment, onChange, palette }: BillsSegmentControlProps) {
  const w = moneyPlacesWords(useLanguage());
  return <BandSegmented<BillsSegment>
    testID="bills-segments"
    palette={palette}
    label={w.billsViews}
    value={segment}
    onChange={onChange}
    segments={[
      { value: 'upcoming', label: w.next30Days, testID: 'bills-segment-upcoming' },
      { value: 'all', label: w.allBills, testID: 'bills-segment-all' },
    ]} />;
}

/**
 * Inside All: the payment types that used to be their own tabs, as 38pt
 * chips on the sheet. The selected chip takes the band's control fill; the
 * others are cards with a rule. Each keeps a 44pt hit area.
 */
export function BillsGroupFilter({ value, onChange, palette }: {
  value: BillsGroupFilterValue;
  onChange: (value: BillsGroupFilterValue) => void;
  palette: BandPalette;
}) {
  const language = useLanguage();
  const w = moneyPlacesWords(language);
  const agenda = paymentAgendaCopy[language === 'ar' ? 'ar' : 'en'];
  const labels: Record<BillsGroupFilterValue, string> = {
    everything: w.everything,
    subscriptions: agenda.subscriptions,
    utilities: agenda.utilities,
    cards: agenda.cards,
  };
  const values: BillsGroupFilterValue[] = ['everything', 'subscriptions', 'utilities', 'cards'];
  return (
    <View style={styles.full} testID="bills-group-filter">
      <View style={styles.wrap}>
        {values.map((option) => {
          const active = value === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={labels[option]}
              accessibilityState={{ selected: active }}
              aria-pressed={active}
              testID={`bills-filter-${option}`}
              hitSlop={3}
              onPress={() => {
                if (active) return;
                tapped();
                onChange(option);
              }}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: active ? palette.fill : palette.card,
                  borderColor: active ? palette.fill : palette.rule,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}>
              <ThemedText type={active ? 'smallBold' : 'small'}
                style={[styles.label, { color: active ? palette.onFill : palette.text }]}>
                {labels[option]}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { width: '100%' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingVertical: 3 },
  chip: {
    minHeight: BandLayout.chipHeight,
    borderRadius: BandLayout.chipHeight / 2,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flexShrink: 1, textAlign: 'center' },
});
