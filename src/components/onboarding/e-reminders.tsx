/**
 * E6 · Reminders (ochre): "When should we nudge you?". Only reminders Wafra
 * actually sends are listed, and only the one the person can switch has a
 * switch:
 *
 * - bills (the day before and on the day) with subscription renewals (the day
 *   before), and card statements (three days before and on the day) are the
 *   payment reminders. They have no separate setting in the app — they are
 *   scheduled whenever notifications are allowed — so they are shown as what
 *   notifications turn on, never as a toggle that does nothing;
 * - the daily summary is the app's real switch (`dailySummary`, Settings).
 *
 * There is no monthly recap notification, so none is offered. "Allow
 * notifications" is the explicit tap that may show the system prompt.
 */
import React from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { EBody, EHeadline, EStepFrame, ETextAction, bandButtonColor } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { Icon } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { onboardingECopy } from '@/lib/onboarding-e-copy';

function ReminderCard({ title, when, note, palette, trailing, testID }: {
  title: string;
  when: string;
  /** A short line under the timing, e.g. "With notifications on". */
  note?: React.ReactNode;
  palette: BandPalette;
  trailing?: React.ReactNode;
  testID: string;
}) {
  const largeText = useLargeTextLayout();
  return <View testID={testID} style={[styles.card, largeText && styles.cardStacked, { backgroundColor: palette.fill }]}>
    <View style={styles.cardCopy}>
      <ThemedText type="smallBold" style={[styles.cardTitle, { color: palette.onFill }]}>{title}</ThemedText>
      <ThemedText type="meta" style={{ color: palette.onFill, opacity: 0.85 }}>{when}</ThemedText>
      {note}
    </View>
    {trailing ?? null}
  </View>;
}

export function RemindersStep({ dailySummary, onDailySummary, onAllow, onNotNow, onBack, onClose, busy }: {
  dailySummary: boolean;
  onDailySummary: (enabled: boolean) => void;
  onAllow: () => void;
  onNotNow: () => void;
  onBack: () => void;
  onClose?: () => void;
  busy: boolean;
}) {
  const words = onboardingECopy(useLanguage());
  const band = useBand('bills');
  const included = <View style={styles.included} accessible accessibilityLabel={words.remindIncluded}>
    <Icon name="check" size={14} color={band.onFill} strokeWidth={2.2} />
    <ThemedText type="meta" style={{ color: band.onFill }}>{words.remindIncluded}</ThemedText>
  </View>;
  return <EStepFrame palette={band} step={4} onBack={onBack} onClose={onClose} backDisabled={busy} testID="onboarding-reminders"
    footer={<>
      <EButton palette={band} color={bandButtonColor(band)} label={words.allowNotifications} onPress={onAllow}
        busy={busy} testID="onboarding-reminders-allow" />
      <ETextAction palette={band} label={words.notNow} onPress={onNotNow} disabled={busy} testID="onboarding-reminders-not-now" />
    </>}>
    <EHeadline palette={band} size={44}>{words.remindersTitle}</EHeadline>
    <EBody palette={band}>{words.remindersBody}</EBody>
    <View style={styles.cards}>
      <ReminderCard palette={band} title={words.remindBillsTitle} when={words.remindBillsWhen} note={included}
        testID="onboarding-remind-bills" />
      <ReminderCard palette={band} title={words.remindCardsTitle} when={words.remindCardsWhen} note={included}
        testID="onboarding-remind-cards" />
      <ReminderCard palette={band} title={words.remindDailyTitle} when={words.remindDailyWhen} testID="onboarding-remind-daily"
        trailing={<View style={styles.switchBox}>
          <Switch value={dailySummary} onValueChange={onDailySummary} disabled={busy}
            accessibilityLabel={`${words.remindDailyTitle}. ${words.remindDailyWhen}`}
            trackColor={{ true: band.accent, false: band.bandMark }} thumbColor={band.onFill}
            ios_backgroundColor={band.bandMark} testID="onboarding-remind-daily-switch" />
        </View>} />
    </View>
  </EStepFrame>;
}

const styles = StyleSheet.create({
  cards: { gap: 8 },
  card: {
    minHeight: 72, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  cardStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  cardCopy: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 16, lineHeight: 22 },
  included: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  // react-native-web draws a Switch's thumb outside its track under RTL; the
  // control itself has no reading direction, so it stays left-to-right there.
  switchBox: Platform.OS === 'web' ? { direction: 'ltr' } : {},
});
