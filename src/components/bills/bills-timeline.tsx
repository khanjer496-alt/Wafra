import React, { useMemo } from 'react';

import { ThemedText } from '@/components/themed-text';
import { PinTimeline } from '@/components/ui/band/pin-timeline';
import type { BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { formatAED } from '@/lib/format';
import { formatMinorUnits } from '@/lib/ledger-money';
import { billsTimelinePins } from '@/lib/money-places-band';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import type { PaymentAgendaItem } from '@/lib/reference-presentation';

const WINDOW_DAYS = 30;

/**
 * The next 30 days on the Bills band: a baseline with a merchant-logo pin on
 * each day something falls due (design language E's PinTimeline).
 *
 * A picture of the window its segment names, nothing more: what is already
 * late and anything later stay in the list on the sheet. Every payment is
 * spoken in date order with its amount (an estimate says "about"), even when
 * only the first eight pins fit.
 */
export function BillsTimeline({ items, todayISO, palette }: {
  items: readonly PaymentAgendaItem[];
  todayISO: string;
  palette: BandPalette;
}) {
  const w = moneyPlacesWords(useLanguage());
  const moneySpec = useLedgerMoney();
  const pins = useMemo(() => billsTimelinePins(items, todayISO, WINDOW_DAYS), [items, todayISO]);
  const timelinePins = useMemo(() => pins.map((pin) => {
    const amount = moneySpec
      ? `${moneySpec.currency} ${formatMinorUnits(Math.round(pin.amountFils), moneySpec)}`
      : formatAED(pin.amountFils);
    return {
      key: pin.key, dayOffset: pin.dayOffset, title: pin.title, category: pin.category,
      spokenAmount: pin.estimated ? `${w.about} ${amount}` : amount,
    };
  }), [pins, moneySpec, w]);
  if (timelinePins.length === 0) {
    return <ThemedText type="meta" testID="bills-timeline-empty" style={{ color: palette.onBandSecondary }}>
      {w.nothingIn30Days}
    </ThemedText>;
  }
  return <PinTimeline testID="bills-timeline" palette={palette} days={WINDOW_DAYS} pins={timelinePins} />;
}
