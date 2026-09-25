import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useScreenEntering } from '@/hooks/use-screen-entering';
import { useTheme } from '@/hooks/use-theme';
import { shiftISO, shortDate } from '@/lib/format';
import { timelinePins, type TimelineInput } from '@/lib/money-places';
import { moneyPlacesWords } from '@/lib/money-places-copy';

const WINDOW_DAYS = 30;
/** A label needs roughly this share of the strip to itself, or its pin goes unlabelled. */
const LABEL_GAP = 0.2;
const LANE_HEIGHT = 18;

/**
 * The next 30 days as one strip, with a pin on each day something falls due.
 *
 * A picture of the window its segment names, nothing more: overdue items and
 * anything later stay in the list below. Pins rise into place 100 ms apart on
 * iOS; on Android and with Reduce Motion or a screen reader they are simply
 * there (useScreenEntering), and money figures never move.
 */
export function BillsTimeline({ items, todayISO }: { items: readonly TimelineInput[]; todayISO: string }) {
  const theme = useTheme();
  const language = useLanguage();
  const w = moneyPlacesWords(language);
  const enter = useScreenEntering();
  const pins = useMemo(() => timelinePins(items, todayISO, WINDOW_DAYS), [items, todayISO]);
  const lanes = Math.max(1, ...pins.map((pin) => pin.lane + 1));
  // Label the first pin of each crowded stretch; the rest stay dots and are
  // still spoken in the summary label below.
  let lastLabelled = -1;
  const labelled = new Set<string>();
  for (const pin of pins) {
    if (pin.lane > 0) continue;
    if (lastLabelled < 0 || pin.position - lastLabelled >= LABEL_GAP) {
      labelled.add(pin.id);
      lastLabelled = pin.position;
    }
  }
  const spoken = pins.length === 0
    ? w.nothingIn30Days
    : `${w.timelineA11y(pins.length)}: ${pins.map((pin) => w.pinA11y(pin.title, shortDate(pin.dateISO))).join('; ')}`;
  const ticks = [0, 10, 20, 30];

  return (
    <View style={styles.root} testID="bills-timeline" accessible accessibilityRole="summary" accessibilityLabel={spoken}>
      <View style={[styles.pins, { height: lanes * LANE_HEIGHT + 22 }]} importantForAccessibility="no-hide-descendants">
        {pins.map((pin, index) => (
          <Animated.View
            key={pin.id}
            entering={enter(FadeInUp.delay(index * 100).springify().damping(24).stiffness(260))}
            style={[styles.pin, { start: `${pin.position * 100}%`, bottom: pin.lane * LANE_HEIGHT }]}>
            {labelled.has(pin.id) && (
              <ThemedText type="nano" themeColor="textSecondary" numberOfLines={1} style={styles.pinLabel}>
                {pin.title}
              </ThemedText>
            )}
            <View style={[styles.dot, { backgroundColor: pin.day === 0 ? theme.warning : theme.primary }]} />
          </Animated.View>
        ))}
      </View>
      <View style={[styles.track, { backgroundColor: theme.track }]} />
      <View style={styles.axis} importantForAccessibility="no-hide-descendants">
        {ticks.map((day) => (
          <ThemedText key={day} type="nano" themeColor="textTertiary" tabular>
            {day === 0 ? w.today : shortDate(shiftISO(todayISO, day))}
          </ThemedText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.one, paddingVertical: Spacing.two },
  pins: { position: 'relative', marginHorizontal: Spacing.two },
  pin: { position: 'absolute', alignItems: 'center', width: 88, marginStart: -44 },
  pinLabel: { textAlign: 'center', maxWidth: 88 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 2 },
  track: { height: 2, borderRadius: 1, marginHorizontal: Spacing.two },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
