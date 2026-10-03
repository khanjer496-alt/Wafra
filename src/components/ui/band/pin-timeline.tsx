import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import type { BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { bandCopy } from '@/lib/band-copy';
import type { CategoryId } from '@/lib/types';

export interface TimelinePin {
  key: string;
  /** Days from today, 0-based. Pins outside the window are left out. */
  dayOffset: number;
  /** The payee; its logo tile marks the pin (category glyph only as fallback). */
  title: string;
  category?: CategoryId;
  /** Spoken amount text, e.g. "about AED 420" — the caller formats it. */
  spokenAmount?: string;
}

const MAX_PINS = 8;

/** Where a pin sits along the strip, as a share of its width (0–100). */
export function pinPosition(dayOffset: number, days: number): number {
  const clamped = Math.max(0, Math.min(days, dayOffset));
  return 3 + (94 * clamped) / Math.max(1, days);
}

/**
 * The next N days as a strip on a band: a baseline with day marks, and a
 * pin for each payment carrying its merchant logo. Stems alternate in three
 * heights so same-day pins stay readable. Up to eight pins are drawn; the
 * spoken label names every payment in date order either way. RTL mirrors:
 * today sits at the reading start.
 */
export function PinTimeline({ pins, palette, days = 30, testID }: {
  pins: readonly TimelinePin[];
  palette: BandPalette;
  days?: number;
  testID?: string;
}) {
  const words = bandCopy(useLanguage());
  const inWindow = pins.filter((pin) => pin.dayOffset >= 0 && pin.dayOffset <= days)
    .sort((a, b) => a.dayOffset - b.dayOffset || a.key.localeCompare(b.key));
  const drawn = inWindow.slice(0, MAX_PINS);
  const spoken = `${words.nextDays(days)}: ` + inWindow.map((pin) =>
    [pin.title, words.dueIn(pin.dayOffset), pin.spokenAmount].filter(Boolean).join(' ')).join(', ');
  const ticks = [0, Math.round(days / 3), Math.round((2 * days) / 3), days];
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={spoken} style={styles.root}>
    <View style={styles.pins}>
      {drawn.map((pin, index) => <View key={pin.key}
        style={[styles.pin, { start: `${pinPosition(pin.dayOffset, days)}%` }]}>
        <View style={[styles.logo, { borderColor: palette.bandRule }]}>
          <MerchantAvatar title={pin.title} category={pin.category ?? 'other'} size={30} />
        </View>
        <View style={[styles.stem, { height: 18 + (index % 3) * 16, backgroundColor: palette.onBand }]} />
      </View>)}
    </View>
    <View style={[styles.baseline, { backgroundColor: palette.onBand }]} />
    <View style={styles.axis}>
      {ticks.map((tick, index) => <ThemedText key={tick} type="meta" style={[styles.tick, { color: palette.onBand }]}>
        {index === 0 ? words.today : words.inDays(tick)}
      </ThemedText>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 4 },
  pins: { height: 100, position: 'relative' },
  pin: { position: 'absolute', bottom: 0, alignItems: 'center', gap: 4, marginStart: -15 },
  logo: { borderRadius: 9, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  stem: { width: 2, opacity: 0.5 },
  baseline: { height: 3, borderRadius: 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  tick: { fontSize: 11.5, lineHeight: 16 },
});
