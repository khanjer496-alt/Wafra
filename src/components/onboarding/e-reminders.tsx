/**
 * E6 · Reminders (ochre): "When should we nudge you?". Only reminders Wafra
 * actually sends are listed, and only the one the person can switch has a
 * switch:
 *
 * - bills (the day before and on the day) with subscription renewals (the day
 *   before), and card statements (three days before and on the day) are the
 *   payment reminders. They have no separate setting in the app — they are
 *   scheduled whenever notifications are allowed — so they are shown as what
 *   notifications turn on — a plain checked list with no card or control
 *   look — never as a toggle that does nothing;
 * - the daily summary is the app's real switch (`dailySummary`, Settings),
 *   the only filled card, marked optional.
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

/** One reminder notifications turn on: a check, what it is, when it comes. Not a control. */
function IncludedItem({ title, when, palette, testID }: {
  title: string;
  when: string;
  palette: BandPalette;
  testID: string;
}) {
  return <View testID={testID} style={styles.item} accessible accessibilityLabel={`${title}. ${when}`}>
    <View style={[styles.itemCheck, { backgroundColor: palette.tile }]}>
      <Icon name="check" size={14} color={palette.onBand} strokeWidth={2.4} />
    </View>
    <View style={styles.cardCopy}>
      <ThemedText type="smallBold" style={[styles.cardTitle, { color: palette.onBand }]}>{title}</ThemedText>
      <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{when}</ThemedText>
    </View>
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
  const largeText = useLargeTextLayout();
  return <EStepFrame palette={band} step={4} onBack={onBack} onClose={onClose} backDisabled={busy} testID="onboarding-reminders"
    footer={<>
      <EButton palette={band} color={bandButtonColor(band)} label={words.allowNotifications} onPress={onAllow}
        busy={busy} testID="onboarding-reminders-allow" />
      <ETextAction palette={band} label={words.notNow} onPress={onNotNow} disabled={busy} testID="onboarding-reminders-not-now" />
    </>}>
    <EHeadline palette={band} size={44}>{words.remindersTitle}</EHeadline>
    <EBody palette={band}>{words.remindersBody}</EBody>
    <View style={[styles.group, { borderColor: band.bandRule }]}>
      <ThemedText type="meta" accessibilityRole="header" style={[styles.groupTitle, { color: band.onBandSecondary }]}>
        {words.remindIncludedTitle}
      </ThemedText>
      <IncludedItem palette={band} title={words.remindBillsTitle} when={words.remindBillsWhen} testID="onboarding-remind-bills" />
      <View style={[styles.rule, { backgroundColor: band.bandRule }]} />
      <IncludedItem palette={band} title={words.remindCardsTitle} when={words.remindCardsWhen} testID="onboarding-remind-cards" />
    </View>
    <View testID="onboarding-remind-daily" style={[styles.card, largeText && styles.cardStacked, { backgroundColor: band.fill }]}>
      <View style={styles.cardCopy}>
        <ThemedText type="micro" style={{ color: band.onFill, opacity: 0.85 }}>{words.remindOptional}</ThemedText>
        <ThemedText type="smallBold" style={[styles.cardTitle, { color: band.onFill }]}>{words.remindDailyTitle}</ThemedText>
        <ThemedText type="meta" style={{ color: band.onFill, opacity: 0.85 }}>{words.remindDailyWhen}</ThemedText>
      </View>
      <View style={styles.switchBox}>
        <Switch value={dailySummary} onValueChange={onDailySummary} disabled={busy}
          accessibilityLabel={`${words.remindDailyTitle}. ${words.remindDailyWhen}`}
          trackColor={{ true: band.accent, false: band.bandMark }} thumbColor={band.onFill}
          ios_backgroundColor={band.bandMark} testID="onboarding-remind-daily-switch" />
      </View>
    </View>
  </EStepFrame>;
}

const styles = StyleSheet.create({
  group: { borderWidth: 1.5, borderRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  groupTitle: { paddingBottom: 6 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  itemCheck: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  rule: { height: StyleSheet.hairlineWidth, marginStart: 36 },
  card: {
    minHeight: 72, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  cardStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  cardCopy: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 16, lineHeight: 22 },
  // react-native-web draws a Switch's thumb outside its track under RTL; the
  // control itself has no reading direction, so it stays left-to-right there.
  switchBox: Platform.OS === 'web' ? { direction: 'ltr' } : {},
});
