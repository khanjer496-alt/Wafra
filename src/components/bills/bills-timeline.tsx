import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

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
/** Two cards share the band's width, so nothing scrolls sideways. */
const PREVIEW_COUNT = 2;

/**
 * The next two payments as cards side by side (stacked at the accessibility
 * text sizes): logo, payee, date and amount, an estimate marked ≈. No strip
 * scrolls sideways; how many more there are is said underneath, and the
 * complete dated agenda is the list right below. The whole window is still
 * spoken in date order, each payment with its amount.
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
  const moneySpec = useLedgerMoney();
  const pins = useMemo(() => billsTimelinePins(items, todayISO, WINDOW_DAYS).map((pin) => {
    const amount = moneySpec
      ? `${moneySpec.currency} ${formatMinorUnits(Math.round(pin.amountFils), moneySpec)}`
      : formatAED(pin.amountFils);
    return { ...pin, amount, spokenAmount: pin.estimated ? `${w.about} ${amount}` : amount };
  }), [items, todayISO, moneySpec, w]);
  if (pins.length === 0) {
    return <ThemedText type="meta" testID="bills-timeline-empty" style={{ color: palette.onBandSecondary }}>
      {w.nothingIn30Days}
    </ThemedText>;
  }
  const spoken = `${words.nextDays(WINDOW_DAYS)}: ` + pins.map(pin =>
    `${pin.displayLabel ?? pin.title} ${words.dueIn(pin.dayOffset)} ${pin.spokenAmount}`).join(', ');
  return <View testID="bills-timeline" accessible={false} accessibilityLabel={spoken} style={styles.root}>
    <View style={[styles.cards, large && styles.cardsStacked]}>
      {pins.slice(0, PREVIEW_COUNT).map(pin => {
        const date = shortDate(shiftISO(todayISO, pin.dayOffset));
        return <View key={pin.key} testID={`bills-timeline-payment-${pin.key}`}
          accessible accessibilityRole="text" accessibilityLabel={`${pin.displayLabel ?? pin.title}. ${date}. ${pin.spokenAmount}`}
          style={[styles.card, large && styles.cardStacked, { backgroundColor: palette.tile }]}>
          <View style={styles.head}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <MerchantAvatar title={pin.title} category={pin.category} size={24} />
            </View>
            <ThemedText type="smallBold" style={[styles.name, { color: palette.onBand }]}>{pin.displayLabel ?? pin.title}</ThemedText>
          </View>
          <ThemedText type="meta" testID={`bills-payment-due-${pin.key}`} style={{ color: palette.onBandSecondary }}>
            {date} · {words.dueIn(pin.dayOffset)}
          </ThemedText>
          {/* ≈ marks an estimate, as on the list; the spoken label says "About". */}
          <ThemedText type="smallBold" tabular style={{ color: palette.onBand }}>
            {pin.estimated ? `≈ ${pin.amount}` : pin.amount}
          </ThemedText>
        </View>;
      })}
    </View>
    {pins.length > PREVIEW_COUNT ? <ThemedText type="meta" testID="bills-timeline-more" style={{ color: palette.onBandSecondary }}>
      {words.morePins(pins.length - PREVIEW_COUNT)}
    </ThemedText> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  cards: { flexDirection: 'row', gap: 8 },
  cardsStacked: { flexDirection: 'column' },
  card: { flex: 1, minWidth: 0, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 9, gap: 2 },
  cardStacked: { flex: 0, flexBasis: 'auto' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  name: { flex: 1, minWidth: 0 },
});
