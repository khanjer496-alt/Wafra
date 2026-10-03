import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import type { BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { bandCopy } from '@/lib/band-copy';
import { formatAED, shiftISO, shortDate } from '@/lib/format';
import { formatMinorUnits } from '@/lib/ledger-money';
import { billsTimelinePins } from '@/lib/money-places-band';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import type { PaymentAgendaItem } from '@/lib/reference-presentation';

const WINDOW_DAYS = 30;
const PREVIEW_COUNT = 8;

/**
 * Upcoming payments grouped by their actual due date. Each merchant owns its
 * space: nearby dates and same-day renewals never compete for one timeline
 * coordinate. The horizontal preview stays compact; the complete agenda is
 * on the sheet below. Amounts and estimated status are visible, not tap-only.
 */
export function BillsTimeline({ items, todayISO, palette }: {
  items: readonly PaymentAgendaItem[];
  todayISO: string;
  palette: BandPalette;
}) {
  const language = useLanguage();
  const w = moneyPlacesWords(language);
  const words = bandCopy(language);
  const large = useLargeTextLayout();
  const { width } = useWindowDimensions();
  const moneySpec = useLedgerMoney();
  const pins = useMemo(() => billsTimelinePins(items, todayISO, WINDOW_DAYS), [items, todayISO]);
  const timelinePins = useMemo(() => pins.map((pin) => {
    const amount = moneySpec
      ? `${moneySpec.currency} ${formatMinorUnits(Math.round(pin.amountFils), moneySpec)}`
      : formatAED(pin.amountFils);
    return { ...pin, amount, spokenAmount: pin.estimated ? `${w.about} ${amount}` : amount };
  }), [pins, moneySpec, w]);
  const groups = useMemo(() => {
    const result: { dayOffset: number; payments: typeof timelinePins }[] = [];
    for (const pin of timelinePins.slice(0, PREVIEW_COUNT)) {
      const last = result.at(-1);
      if (last?.dayOffset === pin.dayOffset) last.payments.push(pin);
      else result.push({ dayOffset: pin.dayOffset, payments: [pin] });
    }
    return result;
  }, [timelinePins]);
  if (timelinePins.length === 0) {
    return <ThemedText type="meta" testID="bills-timeline-empty" style={{ color: palette.onBandSecondary }}>
      {w.nothingIn30Days}
    </ThemedText>;
  }
  const cardWidth = large ? Math.min(560, width - 40) : Math.min(204, width - 80);
  const spoken = `${words.nextDays(WINDOW_DAYS)}: ` + timelinePins.map(pin =>
    `${pin.displayLabel ?? pin.title} ${words.dueIn(pin.dayOffset)} ${pin.spokenAmount}`).join(', ');
  return <View testID="bills-timeline" accessible={false} accessibilityLabel={spoken} style={styles.root}>
    <ScrollView key={language} horizontal showsHorizontalScrollIndicator
      testID="bills-timeline-scroll" contentContainerStyle={styles.groups}>
      {groups.map(group => {
        const date = shortDate(shiftISO(todayISO, group.dayOffset));
        const due = group.dayOffset === 0 ? words.today : words.dueIn(group.dayOffset);
        return <View key={group.dayOffset} testID={`bills-timeline-date-${group.dayOffset}`} style={styles.group}>
          <View style={styles.payments}>
            {group.payments.map(pin => <View key={pin.key} testID={`bills-timeline-payment-${pin.key}`}
              accessible accessibilityRole="text" accessibilityLabel={`${pin.displayLabel ?? pin.title}. ${date}. ${pin.spokenAmount}`}
              style={[styles.payment, { width: cardWidth, backgroundColor: palette.tile }]}>
              {/* One compact cell: the logo beside the payee, its date and its amount. */}
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <MerchantAvatar title={pin.title} category={pin.category} size={28} />
              </View>
              <View style={styles.name}>
                <ThemedText type="smallBold" style={{ color: palette.onBand }}>{pin.displayLabel ?? pin.title}</ThemedText>
                <ThemedText type="meta" testID={`bills-payment-due-${pin.key}`} style={{ color: palette.onBandSecondary }}>
                  {date} · {due}
                </ThemedText>
                <ThemedText type="smallBold" tabular style={{ color: palette.onBand }}>
                  {/* ≈ marks an estimate, as on the list; the spoken label says "About". */}
                  {pin.estimated ? `≈ ${pin.amount}` : pin.amount}
                </ThemedText>
              </View>
            </View>)}
          </View>
        </View>;
      })}
      {/* The rest are in the list below; say how many at the end of the strip. */}
      {timelinePins.length > PREVIEW_COUNT ? <View style={styles.more}>
        <ThemedText type="meta" testID="bills-timeline-more" style={{ color: palette.onBandSecondary }}>
          {words.morePins(timelinePins.length - PREVIEW_COUNT)}
        </ThemedText>
      </View> : null}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  groups: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  group: { gap: 8 },
  payments: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  payment: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 10, gap: 8, flexShrink: 0,
    flexDirection: 'row', alignItems: 'flex-start' },
  name: { flex: 1, minWidth: 0, gap: 1 },
  more: { justifyContent: 'center', paddingHorizontal: 8 },
});
