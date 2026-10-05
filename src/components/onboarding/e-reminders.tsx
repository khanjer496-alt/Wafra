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
 *
 * Above the list, a small strip shows when those nudges arrive around one
 * due date, as the Bills timeline shows payments: bell pins drop onto the
 * days one after another (cards three days before, bills and renewals the
 * day before, bills and cards on the day), and, only while its switch is
 * on, one example daily-summary pin hangs under the due day (it is sent only
 * on an evening with spending, so it is not drawn every day). Decorative: the
 * list below writes and speaks every one of them.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Platform, StyleSheet, Switch, View } from 'react-native';

import { EBody, EHeadline, EStepFrame, ETextAction, bandButtonColor } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { COIN_MOVE, COIN_RISE, COIN_STAGGER, nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { Icon } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useMotionPreference, type MotionPreference } from '@/hooks/use-reduced-motion';
import { onboardingECopy } from '@/lib/onboarding-e-copy';

/** The strip's days around one due date, earliest first: card reminders start three days out. */
export const REMINDER_STRIP_DAYS: readonly number[] = [-3, -2, -1, 0];

export type ReminderPinKind = 'bills' | 'cards' | 'daily';
export interface ReminderPin {
  key: string;
  kind: ReminderPinKind;
  /** Days from the due date: -1 is the day before, 0 the due day. */
  day: number;
}

/**
 * The nudges one due date brings, exactly as Wafra schedules them
 * (src/lib/reminders.ts): card payments three days before and on the day;
 * bills the day before and on the day, renewals the day before (one "Bills
 * and renewals" pin each day). The daily summary only while its switch is
 * on, and as one example evening (the due day): it is posted at SUMMARY_HOUR
 * only on a day with spending (syncDailySummary cancels it otherwise), so it
 * is never drawn as a nudge every day. Nothing else: there is no monthly
 * recap or trial reminder to draw.
 */
export function reminderPins(dailySummary: boolean): ReminderPin[] {
  const pin = (kind: ReminderPinKind, day: number): ReminderPin => ({ key: `${kind}${day}`, kind, day });
  const payments = [pin('cards', -3), pin('bills', -1), pin('bills', 0), pin('cards', 0)];
  return dailySummary ? [...payments, pin('daily', 0)] : payments;
}

/** How far a pin falls onto the strip, and the gap between one pin's drop and the next. */
const DROP = 12;
const PIN_STAGGER = COIN_STAGGER * 2;
const PIN = 22;
const DAILY_PIN = 16;
/** A payment pin's stem reaches down to the line's centre, behind the day's tick. */
const STEM = 17;
/** The day marks' row: the due day's calendar tile sets its height; the line runs through its centre. */
const MARK_ROW = 22;
/** Two pins on one day (bills and cards on the due day): far enough apart that both stems clear the calendar badge. */
const SAME_DAY_GAP = 14;

/** A bell drawn from plain shapes (dome, rim, clapper), so it paints the same everywhere. */
function Bell({ size, color }: { size: number; color: string }) {
  const dome = Math.round(size * 0.58);
  return <View style={[styles.bell, { width: size, height: size }]}>
    <View style={{ width: dome, height: Math.round(size * 0.48), backgroundColor: color,
      borderTopLeftRadius: dome / 2, borderTopRightRadius: dome / 2 }} />
    <View style={{ width: Math.round(size * 0.82), height: Math.max(1.5, size * 0.1), borderRadius: 1, backgroundColor: color }} />
    <View style={{ width: Math.round(size * 0.22), height: Math.round(size * 0.22), borderRadius: size, marginTop: 1, backgroundColor: color }} />
  </View>;
}

/**
 * One bell pin. Payment pins stand on the line; the daily summary's example
 * hangs under it. A pin drops in on first paint after `order` others; a daily pin
 * also drops in when its switch turns on and lifts away when it turns off.
 * Reduce Motion (or a screen reader) puts it where it ends at once.
 */
function ReminderPinMark({ pin, on, order, palette, motion, testID }: {
  pin: ReminderPin;
  on: boolean;
  order: number;
  palette: BandPalette;
  motion: MotionPreference;
  testID: string;
}) {
  const shown = useAnimatedNumber(motion.reducedMotion && on ? 1 : 0);
  // Read when a drop starts, not a dependency: a re-render never restarts a pin on its way.
  const wait = useRef(order * PIN_STAGGER);
  wait.current = order * PIN_STAGGER;
  useEffect(() => {
    const target = on ? 1 : 0;
    if (motion.reducedMotion) {
      shown.setValue(target);
      return;
    }
    // Hold still until the screen-reader state is known.
    if (!motion.ready) return;
    const move = on
      ? Animated.sequence([
        Animated.delay(wait.current),
        Animated.spring(shown, { toValue: 1, ...COIN_RISE, useNativeDriver: nativeDriver }),
      ])
      : Animated.spring(shown, { toValue: 0, ...COIN_MOVE, useNativeDriver: nativeDriver });
    move.start();
    // A quick toggle carries on from wherever the pin is.
    return () => move.stop();
  }, [on, motion.ready, motion.reducedMotion, shown]);
  const daily = pin.kind === 'daily';
  const paint = useMemo(() => ({
    opacity: shown.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [-DROP, 0] }) }],
  }), [shown]);
  const size = daily ? DAILY_PIN : PIN;
  // Bills: a solid head. Cards: a ring. Daily: a small head in the band's mark tone.
  const head = pin.kind === 'bills' ? { backgroundColor: palette.onBand, borderColor: palette.onBand }
    : pin.kind === 'cards' ? { backgroundColor: palette.tile, borderColor: palette.onBand }
      : { backgroundColor: palette.bandMark, borderColor: palette.bandMark };
  const bell = pin.kind === 'cards' ? palette.onBand : palette.band;
  return <Animated.View testID={testID} style={[styles.pin, paint]}>
    <View style={[styles.head, head, { width: size, height: size, borderRadius: size / 2 }]}>
      <Bell size={Math.round(size * 0.62)} color={bell} />
    </View>
    {daily ? null : <View style={[styles.stem, { backgroundColor: palette.onBand }]} />}
  </Animated.View>;
}

/** The strip: days on a line, the due day marked with its calendar, the pins on their days. */
function ReminderStrip({ dailySummary, palette }: { dailySummary: boolean; palette: BandPalette }) {
  const motion = useMotionPreference();
  // After the first reveal, a daily pin switched on drops without waiting for the payment pins.
  const revealed = useRef(false);
  useEffect(() => {
    if (motion.ready) revealed.current = true;
  });
  // Every pin is placed; a daily pin is simply off while the summary is.
  const pins = reminderPins(true);
  const payments = pins.filter((pin) => pin.kind !== 'daily');
  return <View testID="onboarding-remind-timeline" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    aria-hidden style={styles.strip}>
    <View style={[styles.line, { backgroundColor: palette.bandRule }]} />
    {REMINDER_STRIP_DAYS.map((day) => {
      const due = day === 0;
      return <View key={day} style={styles.day}>
        <View style={styles.above}>
          {payments.filter((pin) => pin.day === day).map((pin) =>
            <ReminderPinMark key={pin.key} pin={pin} on order={payments.indexOf(pin)} palette={palette} motion={motion}
              testID={`onboarding-remind-pin-${pin.key}`} />)}
        </View>
        <View style={styles.marks}>
          {due ? <View style={[styles.dueMark, { backgroundColor: palette.onBand }]}>
            <Icon name="calendar" size={12} color={palette.band} strokeWidth={2.2} />
          </View> : <View style={[styles.tick, { backgroundColor: palette.bandMark }]} />}
        </View>
        <View style={styles.below}>
          {pins.filter((pin) => pin.kind === 'daily' && pin.day === day).map((pin) =>
            <ReminderPinMark key={pin.key} pin={pin} on={dailySummary}
              // On first paint after the payment pins; switched on later, at once.
              order={revealed.current ? 0 : payments.length}
              palette={palette} motion={motion} testID={`onboarding-remind-pin-${pin.key}`} />)}
        </View>
      </View>;
    })}
  </View>;
}

/**
 * react-native-web colours an on Switch's knob with `activeThumbColor` (its
 * own prop, absent from the native types) and ignores `thumbColor` there;
 * native ignores it.
 */
const webThumb = (color: string): Record<string, string> => ({ activeThumbColor: color });

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
    <ReminderStrip dailySummary={dailySummary} palette={band} />
    <View style={[styles.group, { borderColor: band.bandRule }]}>
      <ThemedText type="meta" accessibilityRole="header" style={[styles.groupTitle, { color: band.onBandSecondary }]}>
        {words.remindIncludedTitle}
      </ThemedText>
      <IncludedItem palette={band} title={words.remindBillsTitle} when={words.remindBillsWhen} testID="onboarding-remind-bills" />
      <View style={[styles.rule, { backgroundColor: band.bandRule }]} />
      <IncludedItem palette={band} title={words.remindCardsTitle} when={words.remindCardsWhen} testID="onboarding-remind-cards" />
    </View>
    {/* The one switch, on the band's own tone in both schemes (the primary
        fill inverts between light and dark, so it is not used here). */}
    <View testID="onboarding-remind-daily" style={[styles.card, largeText && styles.cardStacked,
      { backgroundColor: band.tile, borderColor: band.bandRule }]}>
      <View style={styles.cardCopy}>
        <ThemedText type="micro" style={{ color: band.onBandSecondary }}>{words.remindOptional}</ThemedText>
        <ThemedText type="smallBold" style={[styles.cardTitle, { color: band.onBand }]}>{words.remindDailyTitle}</ThemedText>
        <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{words.remindDailyWhen}</ThemedText>
      </View>
      <View style={styles.switchBox}>
        <Switch value={dailySummary} onValueChange={onDailySummary} disabled={busy}
          accessibilityLabel={`${words.remindDailyTitle}. ${words.remindDailyWhen}`}
          trackColor={{ true: band.onBand, false: band.bandMark }} thumbColor={band.band} {...webThumb(band.band)}
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
  // The strip: four day columns; the line runs between the first and last day's centres.
  strip: { flexDirection: 'row', paddingVertical: 4, pointerEvents: 'none' },
  line: { position: 'absolute', start: '12.5%', end: '12.5%', top: 4 + PIN + STEM - 1, height: 2, borderRadius: 1 },
  day: { flex: 1, alignItems: 'center' },
  // The pins' stems run down to the line, in front of the day's mark; pins on
  // the same day stand apart so their heads and stems never touch the badge.
  above: {
    height: PIN + STEM, marginBottom: -MARK_ROW / 2, zIndex: 1,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: SAME_DAY_GAP,
  },
  marks: { height: MARK_ROW, alignItems: 'center', justifyContent: 'center' },
  below: { height: DAILY_PIN + 6, paddingTop: 4, alignItems: 'center' },
  tick: { width: 8, height: 8, borderRadius: 4 },
  dueMark: { width: MARK_ROW, height: MARK_ROW, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  pin: { alignItems: 'center' },
  head: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stem: { width: 2, height: STEM },
  bell: { alignItems: 'center', justifyContent: 'center' },
  card: {
    minHeight: 72, borderRadius: 22, borderWidth: 1.5, paddingHorizontal: 18, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  cardStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  cardCopy: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 16, lineHeight: 22 },
  // react-native-web draws a Switch's thumb outside its track under RTL; the
  // control itself has no reading direction, so it stays left-to-right there.
  switchBox: Platform.OS === 'web' ? { direction: 'ltr' } : {},
});
