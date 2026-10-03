import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import type { BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { bandCopy } from '@/lib/band-copy';
import { formatAED, shiftISO, shortDate } from '@/lib/format';
import { formatMinorUnits } from '@/lib/ledger-money';
import { billsTimelinePins } from '@/lib/money-places-band';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import type { PaymentAgendaItem } from '@/lib/reference-presentation';

const WINDOW_DAYS = 30;

/**
 * Every payment in the next 30 days at a glance: its logo over its date, in
 * date order, wrapping onto another line rather than scrolling sideways or
 * hiding the rest behind "and N more". Names and amounts are in the list right
 * below; each logo still speaks its payee, date and amount (an estimate says
 * so), and the strip speaks the whole window in order.
 */
export function BillsTimeline({ items, todayISO, palette }: {
  items: readonly PaymentAgendaItem[];
  todayISO: string;
  palette: BandPalette;
}) {
  const language = useLanguage();
  const w = moneyPlacesWords(language);
  const words = bandCopy(language);
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
    {pins.map(pin => {
      const date = shortDate(shiftISO(todayISO, pin.dayOffset));
      return <View key={pin.key} testID={`bills-timeline-payment-${pin.key}`}
        accessible accessibilityRole="text"
        accessibilityLabel={`${pin.displayLabel ?? pin.title}. ${date}. ${words.dueIn(pin.dayOffset)}. ${pin.spokenAmount}`}
        style={styles.pin}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <MerchantAvatar title={pin.title} category={pin.category} size={32} />
        </View>
        <ThemedText type="meta" testID={`bills-payment-due-${pin.key}`} style={[styles.date, { color: palette.onBandSecondary }]}>
          {pin.dayOffset === 0 ? words.today : date}
        </ThemedText>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: 8, paddingTop: 2 },
  // At least the logo's column; a longer date (Arabic, Larger Text) widens
  // its own cell rather than overflowing it.
  pin: { minWidth: 46, maxWidth: '100%', alignItems: 'center', gap: 3 },
  date: { textAlign: 'center', fontSize: 11.5, lineHeight: 14 },
});
