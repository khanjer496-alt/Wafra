/**
 * E4 · Watch (sand): "Anything to keep an eye on?". One row per everyday
 * category. Tapping a row only opens or closes it — one open at a time — and
 * never removes anything; an open row sets its monthly limit with four quick
 * amounts in the currency's own scale, a typed figure, or ± steps. A row
 * with a limit shows it and has its own Remove. Every row with a limit
 * becomes an ordinary monthly budget when the person saves
 * (onboarding-e.ts: watchBudgetChanges); the one button says what it will do
 * (watchFooterAction): Save N limits, Continue after a removal, or Skip.
 *
 * Nothing guesses a starting figure. The honest line says the Limit sheet
 * shows their usual once a month of spending is in. Without a currency the
 * rows wait for one, chosen right here instead of a dead end.
 *
 * A row with a limit draws the picture the Limit sheet will use for it: a
 * 10-coin stack under the limit line. Nothing is spent yet, so the stack is
 * full; it rises in when the limit is first set, re-settles when the figure
 * changes, and drains away when the limit is removed. The figure is always
 * written beside it and spoken by the row; the coins are decorative.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { choiceSurface } from '@/components/onboarding/e-choice-row';
import { EBody, EHeadline, EStepFrame, bandButtonColor } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { ghostTone } from '@/components/ui/coins/coin-disc';
import { COIN_RISE, COIN_STAGGER, nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { CoinStack } from '@/components/ui/coins/coin-stack';
import { Icon } from '@/components/ui/icon';
import { Fonts, Motion, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useCategoryCatalog } from '@/hooks/use-category-catalog';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { normalizeArabicNumerals } from '@/lib/arabic-sms';
import { bandCopy } from '@/lib/band-copy';
import { parseAmountWithMoneySpec } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import {
  currencyDisplayLabel,
  formatMinorUnits,
  formatMinorUnitsForInput,
  formatMoneyText,
  typicalMinorAmount,
  type LedgerMoneySpec,
} from '@/lib/ledger-money';
import { WATCH_CATEGORIES, WATCH_QUICK_REFERENCES, type WatchDraft, type WatchFooterAction } from '@/lib/onboarding-e';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import type { CategoryId } from '@/lib/types';

/**
 * A typed limit in minor units: the app's own amount reading (Arabic digits
 * and marks, the device's decimal and group marks). Blank or all zeros is no
 * limit; anything unreadable is null and leaves the limit as it was.
 */
export function parseWatchAmount(text: string, spec: LedgerMoneySpec): number | null {
  const digits = normalizeArabicNumerals(text).replace(/[^0-9]/g, '');
  if (!digits || /^0+$/.test(digits)) return 0;
  return parseAmountWithMoneySpec(text, spec);
}

/** Money for a screen reader: the ISO code and the exact figure. */
const spoken = (minor: number, spec: LedgerMoneySpec) => `${spec.currency} ${formatMinorUnits(minor, spec)}`;

/**
 * The ± step at a limit, on the same scale as the quick amounts: 50 below
 * the 500 quick amount, 100 from 500, 250 from 2,000 (AED-sized references,
 * scaled to the currency like the quick amounts). Every quick amount is then
 * a whole number of steps, so ± from one walks round figures beside it.
 * Lowering uses the step of the range below, so 500 − is 450 and 2,000 − is
 * 1,900. Only the step changes; the figure saved is still exactly the one shown.
 */
export function watchStep(valueMinor: number, spec: LedgerMoneySpec, direction: 1 | -1): number {
  const at = direction > 0 ? valueMinor : valueMinor - 1;
  if (at >= typicalMinorAmount(spec, 2000)) return typicalMinorAmount(spec, 250);
  if (at >= typicalMinorAmount(spec, 500)) return typicalMinorAmount(spec, 100);
  return typicalMinorAmount(spec, 50);
}

/** Coins in a limit's stack and their width: the Limit sheet's stack, smaller. */
export const WATCH_COINS = 10;
const WATCH_COIN_WIDTH = 16;
/** How long a removed limit's coins take to lift away before the stack leaves. */
const DRAIN_MS = WATCH_COINS * COIN_STAGGER + 360;

/**
 * A row's limit as the Limit sheet will draw it: a full stack of gold under
 * the limit line, since nothing is spent yet. It rises in when the limit is
 * first set (CoinStack's first paint), re-settles when the figure changes,
 * and drains, then leaves, when the limit is removed. Reduce Motion (or a
 * screen reader) shows the stack in place and removes it at once.
 */
function WatchCoins({ limitMinor, palette, surface, testID }: {
  limitMinor: number;
  palette: BandPalette;
  /** The row's surface, for the empty places a draining stack leaves. */
  surface: string;
  testID: string;
}) {
  const motion = useMotionPreference();
  const animate = motion.ready && !motion.reducedMotion;
  const set = limitMinor > 0;
  // Still drawn while a removed limit drains; without motion it leaves at once.
  const [kept, setKept] = useState(set);
  if (set && !kept) setKept(true);
  if (!set && kept && !animate) setKept(false);
  const fade = useAnimatedNumber(1);
  const settle = useAnimatedNumber(0);
  const last = useRef(limitMinor);
  useEffect(() => {
    if (set) { fade.setValue(1); return; }
    if (!kept || !animate) return;
    const leave = Animated.sequence([
      Animated.delay(DRAIN_MS),
      Animated.timing(fade, { toValue: 0, duration: Motion.change, useNativeDriver: nativeDriver }),
    ]);
    leave.start(({ finished }) => { if (finished) setKept(false); });
    return () => leave.stop();
  }, [set, kept, animate, fade]);
  useEffect(() => {
    const before = last.current;
    last.current = limitMinor;
    if (!animate || before <= 0 || limitMinor <= 0 || before === limitMinor) return;
    // A new figure: the stack lifts a little and lands again under the line.
    settle.setValue(1);
    const land = Animated.spring(settle, { toValue: 0, ...COIN_RISE, useNativeDriver: nativeDriver });
    land.start();
    return () => { land.stop(); settle.setValue(0); };
  }, [limitMinor, animate, settle]);
  const lift = useMemo(() => ({
    transform: [{ translateY: settle.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }],
  }), [settle]);
  if (!set && !(kept && animate)) return null;
  return <Animated.View testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden
    style={[styles.coins, { opacity: fade }]}>
    {/* The limit, in the within-limit colour the Limit sheet gives it while nothing is spent. */}
    <View testID={`${testID}-line`} style={[styles.coinLine, { backgroundColor: palette.limitOk }]} />
    <Animated.View style={lift}>
      <CoinStack testID={`${testID}-stack`} total={WATCH_COINS} filled={set ? WATCH_COINS : 0} width={WATCH_COIN_WIDTH}
        ghost={ghostTone(surface, palette.onBand)} />
    </Animated.View>
  </Animated.View>;
}

/**
 * An open row's editor: quick amounts, the typed figure between − and +.
 * Every path reports whole minor units through `onChange`; 0 is no limit.
 */
function AmountEditor({ valueMinor, onChange, spec, label, palette, disabled, testID }: {
  valueMinor: number;
  onChange: (next: number) => void;
  spec: LedgerMoneySpec;
  label: string;
  palette: BandPalette;
  disabled: boolean;
  testID: string;
}) {
  const language = useLanguage();
  const words = onboardingECopy(language);
  const steps = bandCopy(language);
  const largeText = useLargeTextLayout();
  const quick = WATCH_QUICK_REFERENCES.map((major) => typicalMinorAmount(spec, major));
  const lower = watchStep(valueMinor, spec, -1);
  const raise = watchStep(valueMinor, spec, 1);
  const shown = (minor: number) => minor > 0 ? formatMinorUnitsForInput(minor, spec) : '';
  const [text, setText] = useState(() => shown(valueMinor));
  // Focus shows on the field's underline (heavier), since the browser's own box is removed on the web.
  const [focused, setFocused] = useState(false);
  // The figure the text last stood for: a quick amount or a step replaces
  // the text, typing that already reads as the value leaves it alone.
  const typed = useRef(valueMinor);
  useEffect(() => {
    if (typed.current !== valueMinor) {
      typed.current = valueMinor;
      setText(shown(valueMinor));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueMinor]);
  // A quick amount or a step always rewrites the field, even when the limit
  // is unchanged, so an unreadable draft never stays next to a saved figure.
  const set = (next: number) => {
    const safe = Math.max(0, next);
    typed.current = safe;
    setText(shown(safe));
    if (safe === valueMinor) return;
    tapped();
    onChange(safe);
  };
  const currency = currencyDisplayLabel(spec.currency);
  // Opening a row: the editor's controls drop in and fade up (paint only, the
  // native driver); the rows below make room at once. Reduce Motion: in place.
  const motion = useMotionPreference();
  const appear = useAnimatedNumber(motion.ready && !motion.reducedMotion ? 0 : 1);
  useEffect(() => {
    if (!motion.ready || motion.reducedMotion) { appear.setValue(1); return; }
    const run = Animated.timing(appear, { toValue: 1, duration: Motion.change, easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver });
    run.start();
    return () => run.stop();
  }, [appear, motion.ready, motion.reducedMotion]);
  const appearPaint = useMemo(() => ({
    opacity: appear,
    transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
  }), [appear]);
  const lowerButton = <Pressable accessibilityRole="button" accessibilityLabel={steps.lower(spoken(lower, spec))}
    disabled={disabled || valueMinor <= 0} testID={`${testID}-lower`} onPress={() => set(valueMinor - lower)}
    style={({ pressed }) => [styles.stepper, { borderColor: palette.bandRule, opacity: valueMinor <= 0 ? 0.4 : pressed ? 0.7 : 1 }]}>
    <ThemedText type="heading" style={{ color: palette.onBand }}>−</ThemedText>
  </Pressable>;
  const raiseButton = <Pressable accessibilityRole="button" accessibilityLabel={steps.raise(spoken(raise, spec))}
    disabled={disabled} testID={`${testID}-raise`} onPress={() => set(valueMinor + raise)}
    style={({ pressed }) => [styles.stepper, { borderColor: palette.bandRule, opacity: pressed ? 0.7 : 1 }]}>
    <ThemedText type="heading" style={{ color: palette.onBand }}>+</ThemedText>
  </Pressable>;
  const perMonth = <ThemedText type="meta" style={{ color: palette.onBandSecondary }} testID={`${testID}-per-month`}>
    {words.watchPerMonth}
  </ThemedText>;
  return <Animated.View style={[styles.editor, { borderTopColor: palette.bandRule }, appearPaint]} testID={testID}>
    <View style={styles.quickRow}>
      {quick.map((minor, index) => {
        const on = minor === valueMinor;
        return <Pressable key={minor} accessibilityRole="button" accessibilityLabel={spoken(minor, spec)}
          accessibilityState={{ selected: on, disabled }} disabled={disabled} testID={`${testID}-quick-${index}`}
          onPress={() => set(minor)}
          style={({ pressed }) => [styles.quick, largeText && styles.quickWide, {
            borderColor: on ? palette.onBand : palette.bandRule,
            backgroundColor: on ? palette.onBand : 'transparent',
            opacity: pressed ? 0.7 : 1,
          }]}>
          <ThemedText type="smallBold" tabular style={{ color: on ? palette.band : palette.onBand }}>
            {formatMinorUnits(minor, spec, { decimals: false })}
          </ThemedText>
        </Pressable>;
      })}
    </View>
    {/* At the accessibility sizes the field takes the whole width, "per month" its own line under
        it, and − and + a row of their own, so nothing runs past the edge or under a stepper. */}
    <View style={largeText ? styles.stepStack : styles.stepRow} testID={`${testID}-steps`}>
      {largeText ? null : lowerButton}
      <View testID={`${testID}-field`}
        style={[styles.field, largeText && styles.fieldWide, focused && styles.fieldFocused, { borderColor: palette.onBand }]}>
        <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{currency}</ThemedText>
        <TextInput value={text} editable={!disabled} accessibilityLabel={words.watchTypeAmount(label)}
          testID={`${testID}-input`} keyboardType={spec.exponent === 0 ? 'number-pad' : 'decimal-pad'}
          returnKeyType="done" placeholder="0"
          placeholderTextColor={palette.onBandSecondary} selectionColor={palette.onBand} cursorColor={palette.onBand}
          onChangeText={(next) => {
            setText(next);
            const parsed = parseWatchAmount(next, spec);
            if (parsed === null) return;
            typed.current = parsed;
            if (parsed !== valueMinor) onChange(parsed);
          }}
          // Leaving the field shows exactly the limit that will be saved.
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); typed.current = valueMinor; setText(shown(valueMinor)); }}
          // The browser's focus box; the field's own underline already marks it.
          style={[styles.input, Platform.OS === 'web' ? styles.inputWeb : null, { color: palette.onBand }]} />
        {largeText ? null : perMonth}
      </View>
      {largeText ? <>{perMonth}<View style={styles.stepRow}>{lowerButton}{raiseButton}</View></> : raiseButton}
    </View>
    <EBody palette={palette} style={styles.usual}>{words.watchUsual}</EBody>
  </Animated.View>;
}

export function WatchStep({ draft, open, onOpen, onLimit, moneySpec, currency, onCurrency,
  action, onContinue, onBack, onClose, disabled }: {
  draft: readonly WatchDraft[];
  /** The row that is open, if any. */
  open: CategoryId | null;
  onOpen: (category: CategoryId | null) => void;
  /** 0 removes the row's limit. */
  onLimit: (category: CategoryId, limitMinor: number) => void;
  /** The ledger's money spec, or the confirmed currency's; null until a currency is known. */
  moneySpec: LedgerMoneySpec | null;
  currency: string | null;
  onCurrency: (code: string) => void;
  action: WatchFooterAction;
  onContinue: () => void;
  onBack: () => void;
  onClose?: () => void;
  disabled: boolean;
}) {
  const { categoryLabel, getCategory } = useCategoryCatalog();
  const language = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const words = onboardingECopy(language);
  const band = useBand('settings');
  // A row with a limit wears Spending's colours on its icon, as picked tiles do on the board.
  const clay = useBand('spending');
  const largeText = useLargeTextLayout();
  const bandSecondary = useMemo(() => ({ ...band, card: band.tile, rule: band.onBand, text: band.onBand }), [band]);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  /** The row tapped before a currency was chosen; it opens once one is. */
  const [pending, setPending] = useState<CategoryId | null>(null);
  const label = action.kind === 'save' ? words.watchSave(action.count)
    : action.kind === 'continue' ? words.continue : words.skipForNow;
  const reserveLabels = useMemo(() => [words.skipForNow, words.continue,
    ...WATCH_CATEGORIES.map((_category, index) => words.watchSave(index + 1))], [words]);
  return <EStepFrame palette={band} step={3} onBack={onBack} onClose={onClose} backDisabled={disabled} testID="onboarding-watch"
    footer={<EButton palette={band} color={bandButtonColor(band)} label={label} onPress={onContinue}
      // Every label the button can show keeps its room, so the strip never changes height as limits are set.
      reserveLabels={reserveLabels}
      disabled={disabled} testID="onboarding-watch-continue" />}>
    <EHeadline palette={band} size={42}>{words.watchTitle}</EHeadline>
    <EBody palette={band}>{words.watchBody}</EBody>
    {moneySpec ? null : <View style={styles.currency}>
      <EBody palette={band} secondary={false}>{words.watchNoCurrency}</EBody>
      {/* The secondary button in the band's own tones (as an active row), not a sheet card on the band. */}
      <EButton palette={bandSecondary} variant="secondary" label={words.chooseCurrency} onPress={() => setCurrencyOpen(true)}
        testID="onboarding-watch-currency" />
    </View>}
    <View style={styles.list} testID="onboarding-watch-options">
      {WATCH_CATEGORIES.map((category) => {
        const name = categoryLabel(category, lang);
        const limit = draft.find((item) => item.category === category)?.limitMinor ?? 0;
        // Exact, never rounded: the row shows the figure that will be saved.
        const amount = limit > 0 && moneySpec ? formatMoneyText(limit, moneySpec) : null;
        const isOpen = open === category && moneySpec !== null;
        const active = isOpen || amount !== null;
        return <View key={category} style={[styles.row, choiceSurface(band, active)]}>
          <View style={styles.head}>
            <Pressable accessibilityRole="button"
              accessibilityLabel={`${name}, ${limit > 0 && moneySpec ? spoken(limit, moneySpec) : words.watchNoLimit}`}
              accessibilityState={{ expanded: isOpen, disabled }} aria-expanded={isOpen} disabled={disabled}
              testID={`onboarding-watch-${category}`}
              onPress={() => {
                tapped();
                if (!moneySpec) { setPending(category); setCurrencyOpen(true); return; }
                onOpen(isOpen ? null : category);
              }}
              style={({ pressed }) => [styles.headPress, largeText && styles.headWrap,
                { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
              {/* At the accessibility sizes the name takes a whole line of its own, first, so a long
                  word ("المطاعم" at 3x) wraps whole instead of splitting beside the icon. */}
              {largeText ? <ThemedText type="smallBold" style={[styles.name, styles.nameWide, { color: band.onBand }]}>{name}</ThemedText> : null}
              <View style={[styles.icon, {
                backgroundColor: amount ? clay.fill : band.scheme === 'dark' ? band.bandRule : band.card,
              }]}>
                <Icon name={getCategory(category).icon} size={20} color={amount ? clay.onFill : band.text} strokeWidth={2} />
              </View>
              {largeText ? null : <ThemedText type="smallBold" style={[styles.name, { color: band.onBand }]}>{name}</ThemedText>}
              {/* Open, the field below writes the figure; closed, the row does. */}
              {amount && !isOpen ? <ThemedText type="smallBold" tabular style={{ color: band.onBand }}>{amount}</ThemedText>
                : amount || isOpen ? null
                  : <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{words.watchAdd}</ThemedText>}
              {/* At the accessibility sizes the name and figure need the whole row: no coins beside them. */}
              {largeText ? null : <WatchCoins limitMinor={moneySpec ? limit : 0} palette={band}
                surface={active ? band.tile : band.band} testID={`onboarding-watch-${category}-coins`} />}
              <View style={isOpen ? styles.flipped : null}>
                <Icon name="chevron-down" size={18} color={band.onBandSecondary} />
              </View>
            </Pressable>
            {amount ? <Pressable accessibilityRole="button" accessibilityLabel={words.watchRemove(name)} hitSlop={6}
              disabled={disabled} testID={`onboarding-watch-${category}-remove`}
              onPress={() => { tapped(); onLimit(category, 0); }}
              style={({ pressed }) => [styles.remove, { opacity: pressed ? 0.6 : 1 }]}>
              <Icon name="close" size={16} color={band.onBand} />
            </Pressable> : null}
          </View>
          {isOpen && moneySpec ? <AmountEditor valueMinor={limit} onChange={(next) => onLimit(category, next)}
            spec={moneySpec} label={name} palette={band} disabled={disabled} testID="onboarding-watch-limit" /> : null}
        </View>;
      })}
    </View>
    <LedgerCurrencySheet visible={currencyOpen} value={currency}
      onClose={() => { setCurrencyOpen(false); setPending(null); }}
      onSelect={(code) => {
        onCurrency(code);
        setCurrencyOpen(false);
        if (pending) onOpen(pending);
        setPending(null);
      }} />
  </EStepFrame>;
}

const styles = StyleSheet.create({
  currency: { gap: 10 },
  list: { gap: 8 },
  row: { borderRadius: 20, borderWidth: 1.5, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center' },
  headPress: {
    flex: 1, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingStart: 12, paddingEnd: 14, paddingVertical: 10,
  },
  // At the accessibility sizes the amount may take its own line; never the chevron alone.
  headWrap: { flexWrap: 'wrap' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 23 },
  // The name has the row's whole width; the icon, amount and chevron share the line under it.
  nameWide: { flex: 0, flexBasis: '100%' },
  flipped: { transform: [{ rotate: '180deg' }] },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginEnd: 6 },
  // The coins and their limit line: a little wider than the coins, as in the Limit sheet.
  coins: { width: WATCH_COIN_WIDTH + 6, alignItems: 'center', gap: 2, pointerEvents: 'none' },
  coinLine: { height: 2, width: '100%', borderRadius: 1 },
  // A rule under the row's head, then the quick amounts, the field and one quiet line.
  editor: {
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 14, gap: 14, borderTopWidth: StyleSheet.hairlineWidth,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quick: {
    flexGrow: 1, flexBasis: '20%', minHeight: 44, borderRadius: 22, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10,
  },
  // At the accessibility sizes each amount takes its own width and the row wraps, never overlapping.
  quickWide: { flexBasis: 'auto', paddingHorizontal: 16, paddingVertical: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepStack: { gap: 10 },
  stepper: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  field: {
    flex: 1, minWidth: 0, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderBottomWidth: 2, paddingHorizontal: 4,
  },
  fieldWide: { flex: 0, alignSelf: 'stretch' },
  inputWeb: { outlineWidth: 0 },
  /** One point heavier when focused, taken back from below so nothing under it moves. */
  fieldFocused: { borderBottomWidth: 3, marginBottom: -1 },
  input: {
    flex: 1, minWidth: 48, fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], fontSize: 26, lineHeight: 32,
    paddingVertical: 6,
  },
  usual: { fontSize: 13, lineHeight: 18 },
});
