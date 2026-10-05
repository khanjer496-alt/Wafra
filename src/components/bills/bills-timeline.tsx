import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { COIN_POP, COIN_RISE, COIN_STAGGER, nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { CoinColors, Motion, Radius, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { bandCopy } from '@/lib/band-copy';
import { formatAED, shiftISO, shortDate } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import { formatMinorUnits } from '@/lib/ledger-money';
import { billsTimelinePins } from '@/lib/money-places-band';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import type { PaymentAgendaItem } from '@/lib/reference-presentation';

const WINDOW_DAYS = 30;
const LOGO = 32;
/** How far a logo falls onto the strip, and how far a tapped one pops up. */
const DROP = 14;
const LIFT = 6;
/** The other logos while one is lifted; their dates stay at full strength. */
const DIMMED = 0.38;
/** The first-paint stagger stops growing here, so a long month still lands quickly. */
const MAX_STAGGERED = 12;

/**
 * Every payment in the next 30 days at a glance: its logo over its date, in
 * date order, wrapping onto another line rather than scrolling sideways or
 * hiding the rest behind "and N more". Names and amounts are in the list right
 * below; each logo still speaks its payee, date and amount (an estimate says
 * so), and the strip speaks the whole window in order.
 *
 * On first paint the logos drop onto their dates one after another, in date
 * order. Tapping a logo pops it up over a soft glow and writes its amount and
 * date under the strip; the others dim. That is visual only: the spoken
 * labels above already carry every figure, so screen readers never stop on
 * the tap targets, and Reduce Motion shows everything in place.
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
  const motion = useMotionPreference();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Logos that arrive after the strip's first reveal (a bill added later) appear in place.
  const revealed = useRef(false);
  useEffect(() => {
    if (motion.ready) revealed.current = true;
  });
  const pins = useMemo(() => billsTimelinePins(items, todayISO, WINDOW_DAYS).map((pin) => {
    const amount = moneySpec
      ? `${moneySpec.currency} ${formatMinorUnits(Math.round(pin.amountFils), moneySpec)}`
      : formatAED(pin.amountFils);
    return { ...pin, amount, spokenAmount: pin.estimated ? `${w.about} ${amount}` : amount };
  }), [items, todayISO, moneySpec, w]);
  const selected = pins.findIndex((pin) => pin.key === selectedKey);
  // A selection whose payment left the window (paid, or a day passed) clears,
  // so it cannot come back later.
  if (selectedKey !== null && selected < 0) setSelectedKey(null);
  if (pins.length === 0) {
    return <ThemedText type="meta" testID="bills-timeline-empty" style={{ color: palette.onBandSecondary }}>
      {w.nothingIn30Days}
    </ThemedText>;
  }
  const spoken = `${words.nextDays(WINDOW_DAYS)}: ` + pins.map(pin =>
    `${pin.displayLabel ?? pin.title} ${words.dueIn(pin.dayOffset)} ${pin.spokenAmount}`).join(', ');
  const dateOf = (dayOffset: number) => dayOffset === 0 ? words.today : shortDate(shiftISO(todayISO, dayOffset));
  const select = (key: string) => {
    tapped();
    setSelectedKey((current) => current === key ? null : key);
  };
  const lifted = selected >= 0 ? pins[selected] : undefined;
  return <View testID="bills-timeline" accessible={false} accessibilityLabel={spoken} style={styles.root}>
    {pins.map((pin, index) => {
      const date = shortDate(shiftISO(todayISO, pin.dayOffset));
      return <View key={pin.key} testID={`bills-timeline-payment-${pin.key}`}
        accessible accessibilityRole="text"
        accessibilityLabel={`${pin.displayLabel ?? pin.title}. ${date}. ${words.dueIn(pin.dayOffset)}. ${pin.spokenAmount}`}
        style={styles.pin}>
        <TimelineLogo pinKey={pin.key} title={pin.title} category={pin.category} index={index}
          selected={index === selected} dimmed={selected >= 0 && index !== selected}
          appear={!revealed.current} ready={motion.ready} reducedMotion={motion.reducedMotion}
          onPress={() => select(pin.key)} />
        <ThemedText type="meta" testID={`bills-payment-due-${pin.key}`} style={[styles.date, { color: palette.onBandSecondary }]}>
          {pin.dayOffset === 0 ? words.today : date}
        </ThemedText>
      </View>;
    })}
    {/* Visual only: the lifted logo's amount and date, which its spoken label already says.
        With nothing lifted the same line names the next payment, quietly, so the
        line is always there and a tap swaps its words rather than moving the agenda. */}
    {lifted ? <View key={lifted.key} testID="bills-timeline-lifted" style={styles.liftedLine}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <LiftedLabel ready={motion.ready} reducedMotion={motion.reducedMotion}>
        <View style={[styles.liftedChip, { backgroundColor: palette.selected }]}>
          <ThemedText type="meta" style={{ color: palette.onSelected }}>
            {[lifted.displayLabel ?? lifted.title, dateOf(lifted.dayOffset), lifted.spokenAmount].join(' · ')}
          </ThemedText>
        </View>
      </LiftedLabel>
    </View> : <View testID="bills-timeline-next" style={styles.liftedLine}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[styles.liftedChip, styles.nextChip, { borderColor: palette.bandRule }]}>
        <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>
          {[pins[0]!.displayLabel ?? pins[0]!.title, words.dueIn(pins[0]!.dayOffset), pins[0]!.spokenAmount].join(' · ')}
        </ThemedText>
      </View>
    </View>}
  </View>;
}

/**
 * One payee's logo: it drops onto its date on first paint, and pops up over a
 * glow when tapped. Paint only (opacity and transform on the native driver).
 */
function TimelineLogo({ pinKey, title, category, index, selected, dimmed, appear, ready, reducedMotion, onPress }: {
  pinKey: string;
  title: string;
  category: PaymentAgendaItem['category'];
  index: number;
  selected: boolean;
  dimmed: boolean;
  /** False for a logo that arrives after the strip's first reveal: it appears in place. */
  appear: boolean;
  ready: boolean;
  reducedMotion: boolean;
  onPress: () => void;
}) {
  const shown = useRef(!appear);
  // The date order at first paint sets the stagger; a later re-sort does not replay it.
  const delay = useRef(Math.min(index, MAX_STAGGERED) * COIN_STAGGER);
  const enter = useAnimatedNumber(reducedMotion || !appear ? 1 : 0);
  const lift = useAnimatedNumber(selected ? 1 : 0);
  const fade = useAnimatedNumber(dimmed ? DIMMED : 1);
  const settled = useRef(false);

  useEffect(() => {
    if (reducedMotion) {
      shown.current = true;
      enter.setValue(1);
      return;
    }
    // Hold still until the screen-reader state is known.
    if (!ready || shown.current) return;
    shown.current = true;
    const drop = Animated.sequence([
      Animated.delay(delay.current),
      Animated.spring(enter, { toValue: 1, ...COIN_RISE, useNativeDriver: nativeDriver }),
    ]);
    drop.start();
    // Interrupted, the logo lands on its date rather than hanging half-faded.
    return () => {
      drop.stop();
      enter.setValue(1);
    };
  }, [enter, ready, reducedMotion]);

  useEffect(() => {
    // The values start where the props put them; only a change animates.
    if (!settled.current) {
      settled.current = true;
      return;
    }
    if (reducedMotion) {
      lift.setValue(selected ? 1 : 0);
      fade.setValue(dimmed ? DIMMED : 1);
      return;
    }
    const change = Animated.parallel([
      Animated.spring(lift, { toValue: selected ? 1 : 0, ...COIN_POP, useNativeDriver: nativeDriver }),
      Animated.timing(fade, { toValue: dimmed ? DIMMED : 1, duration: Motion.change,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: nativeDriver }),
    ]);
    change.start();
    // A newer tap retargets from wherever the logo is; it never jumps.
    return () => change.stop();
  }, [dimmed, fade, lift, reducedMotion, selected]);

  // Built once: new interpolation nodes per render would churn the native driver.
  const logoMotion = useMemo(() => ({
    opacity: Animated.multiply(
      fade,
      enter.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
    ),
    transform: [
      {
        translateY: Animated.add(
          enter.interpolate({ inputRange: [0, 1], outputRange: [-DROP, 0] }),
          lift.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT] }),
        ),
      },
      {
        scale: Animated.add(
          Animated.add(
            enter.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }),
            lift.interpolate({ inputRange: [0, 1], outputRange: [0, 0.08] }),
          ),
          // A dimmed logo also steps back a little, so the lifted one reads as in front
          // rather than the rest just turning muddy on a dark band.
          fade.interpolate({ inputRange: [DIMMED, 1], outputRange: [-0.08, 0], extrapolate: 'clamp' }),
        ),
      },
    ],
  }), [enter, fade, lift]);
  const glowMotion = useMemo(() => ({
    opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [0, 0.9], extrapolate: 'clamp' }),
    transform: [{ translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT] }) }],
  }), [lift]);

  // Decorative and out of the accessibility tree: the pin around it speaks.
  return <View testID={`bills-timeline-logo-${pinKey}`} style={[styles.logoSlot, { zIndex: selected ? 1 : 0 }]}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Animated.View testID={`bills-timeline-glow-${pinKey}`}
      style={[styles.glow, { boxShadow: `0 0 12px 3px ${CoinColors.shine}` }, glowMotion]} />
    <Animated.View testID={`bills-timeline-paint-${pinKey}`} style={[styles.inert, logoMotion]}>
      <MerchantAvatar title={title} category={category} size={LOGO} />
    </Animated.View>
    <Pressable testID={`bills-timeline-tap-${pinKey}`} onPress={onPress} focusable={false} accessible={false}
      importantForAccessibility="no" style={StyleSheet.absoluteFill} hitSlop={{ top: LIFT + 4, bottom: 4, left: 7, right: 7 }} />
  </View>;
}

/** The lifted logo's line rises into place as it appears. */
function LiftedLabel({ ready, reducedMotion, children }: { ready: boolean; reducedMotion: boolean; children: React.ReactNode }) {
  const enter = useAnimatedNumber(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      enter.setValue(1);
      return;
    }
    if (!ready) return;
    const rise = Animated.spring(enter, { toValue: 1, ...COIN_POP, useNativeDriver: nativeDriver });
    rise.start();
    return () => {
      rise.stop();
      enter.setValue(1);
    };
  }, [enter, ready, reducedMotion]);
  const style = useMemo(() => ({
    opacity: enter.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-LIFT, 0] }) }],
  }), [enter]);
  return <Animated.View style={style}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: 8, paddingTop: 2 },
  // At least the logo's column; a longer date (Arabic, Larger Text) widens
  // its own cell rather than overflowing it.
  pin: { minWidth: 46, maxWidth: '100%', alignItems: 'center', gap: 3 },
  date: { textAlign: 'center', fontSize: 11.5, lineHeight: 14 },
  logoSlot: { width: LOGO, height: LOGO },
  inert: { pointerEvents: 'none' },
  // Light only: a spread shadow around the logo's tile, under the logo.
  glow: { position: 'absolute', pointerEvents: 'none', top: 0, bottom: 0, start: 0, end: 0, borderRadius: Radius.tile },
  // Its own line under the strip, whatever the text size; wraps rather than truncating.
  liftedLine: { width: '100%', alignItems: 'flex-start' },
  liftedChip: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3, maxWidth: '100%' },
  // Same size as the lifted chip (its border replaces the fill), so swapping them never moves the line.
  nextChip: { borderWidth: 1, paddingHorizontal: 9, paddingVertical: 2 },
});
