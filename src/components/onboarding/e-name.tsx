/**
 * E2 · Name (slate). The name becomes the first tile of the pattern and
 * Home's greeting; it stays on this device (`userName`). Skip is allowed.
 * The tile is a card with two faces: blank until a name is typed, then it
 * turns over in 3D to show the initial (and back when the name is cleared).
 *
 * Below it, two compact rows confirm where Wafra thinks the person is and
 * which currency the ledger counts in. They are separate answers and stay
 * separate controls: the country decides how alert and statement dates are
 * read, the currency is the ledger's unit and is needed before the Watch step
 * can write a limit. Each "Change" opens the existing sheet (the same country
 * picker and ledger-currency sheet Settings uses).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { CountryPickerSheet, countryPickerName } from '@/components/country-picker-sheet';
import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { EHeadline, EStepFrame, ETextAction, bandButtonColor } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { COIN_MOVE, nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { Icon } from '@/components/ui/icon';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { ONBOARDING_E_BANDS } from '@/lib/onboarding-e';
import { countryFlag } from '@/lib/country';
import { tapped } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { MAX_PREFERRED_NAME_LENGTH, normalizePreferredName } from '@/lib/onboarding';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import { patternInitial } from '@/lib/pattern';

function ConfirmRow({ label, value, spoken, onPress, palette, testID, missing = false }: {
  label: string;
  value: string;
  spoken: string;
  onPress: () => void;
  palette: BandPalette;
  testID: string;
  /** Nothing chosen yet: the value is the action itself, outlined in full. */
  missing?: boolean;
}) {
  const largeText = useLargeTextLayout();
  const words = onboardingECopy(useLanguage());
  return <Pressable accessibilityRole="button" accessibilityLabel={spoken} testID={testID}
    onPress={() => { tapped(); onPress(); }}
    style={({ pressed }) => [styles.row, largeText && styles.rowStacked, {
      borderColor: missing ? palette.onBand : palette.bandRule, opacity: pressed ? 0.7 : 1,
    }]}>
    <ThemedText type="meta" style={[styles.rowLabel, { color: palette.onBandSecondary }]}>{label}</ThemedText>
    <ThemedText type="smallBold" style={[styles.rowValue, largeText && styles.rowValueStacked, { color: palette.onBand }]}>{value}</ThemedText>
    {missing ? <Icon name="chevron-right" size={18} color={palette.onBand} />
      : <ThemedText type="smallBold" style={{ color: palette.onBand }}>{words.change}</ThemedText>}
  </Pressable>;
}

/** The tile's perspective, as the card stack's. */
const TILE_PERSPECTIVE = 900;

/**
 * The first tile of the pattern as a card with two faces: a blank, dashed
 * face until there is a name, the initial on the band's text colour after.
 * Typing the first letter turns it over on its vertical axis; clearing the
 * name turns it back. Each face shows only on its half of the turn. Reduce
 * Motion (or a screen reader) shows the face at once, and nothing turns
 * before that answer is known. Decorative: the preview row speaks it.
 */
export function FlipTile({ initial, palette }: { initial: string; palette: BandPalette }) {
  const motion = useMotionPreference();
  const named = initial.length > 0;
  const turn = useAnimatedNumber(named ? 1 : 0);
  // The last letter shown, so the face keeps it while turning back to blank.
  const [shown, setShown] = useState(initial);
  if (named && shown !== initial) setShown(initial);
  useEffect(() => {
    const target = named ? 1 : 0;
    if (!motion.ready || motion.reducedMotion) { turn.setValue(target); return; }
    const move = Animated.spring(turn, { toValue: target, ...COIN_MOVE, useNativeDriver: nativeDriver });
    move.start();
    // A newer change carries on from wherever the tile is.
    return () => move.stop();
  }, [named, motion.ready, motion.reducedMotion, turn]);
  const faces = useMemo(() => ({
    blank: {
      opacity: turn.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [1, 1, 0, 0], extrapolate: 'clamp' }),
      transform: [{ perspective: TILE_PERSPECTIVE },
        { rotateY: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'], extrapolate: 'clamp' }) }],
    },
    letter: {
      opacity: turn.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' }),
      transform: [{ perspective: TILE_PERSPECTIVE },
        { rotateY: turn.interpolate({ inputRange: [0, 1], outputRange: ['-180deg', '0deg'], extrapolate: 'clamp' }) }],
    },
  }), [turn]);
  return <View style={styles.tile} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    testID="onboarding-name-tile">
    <Animated.View testID="onboarding-name-tile-blank"
      style={[styles.face, styles.tileEmpty, { borderColor: palette.bandRule }, faces.blank]} />
    <Animated.View testID="onboarding-name-tile-letter"
      style={[styles.face, { backgroundColor: palette.onBand }, faces.letter]}>
      <ThemedText style={[styles.tileLetter, { color: palette.band }]} allowFontScaling={false}>{named ? initial : shown}</ThemedText>
    </Animated.View>
  </View>;
}

export function NameStep({ nameDraft, onChangeName, onContinue, onSkip, onBack, onClose, busy, saveFailed,
  country, suggestedCountry, onCountry, currency, onCurrency }: {
  nameDraft: string;
  onChangeName: (value: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
  onClose?: () => void;
  busy: boolean;
  saveFailed: boolean;
  /** The country shown: the confirmed one, else the device's guess. */
  country: string | null;
  suggestedCountry: string | null;
  onCountry: (code: string) => void;
  /** The ledger currency, or the region's suggestion until one is chosen. */
  currency: string | null;
  onCurrency: (code: string) => void;
}) {
  const language = useLanguage();
  const words = onboardingECopy(language);
  const band = useBand(ONBOARDING_E_BANDS.name);
  const largeText = useLargeTextLayout();
  // The lock is drawn at the privacy line's text size, so it grows with it.
  const { fontScale } = useWindowDimensions();
  const lockSize = Math.round(14 * Math.max(1, fontScale || 1));
  const [countryOpen, setCountryOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  // Focus shows on the underline (brighter and heavier), not as the browser's box.
  const [focused, setFocused] = useState(false);
  // What will be saved: the same normalisation setUserName applies.
  const trimmed = normalizePreferredName(nameDraft) ?? '';
  const initial = patternInitial(trimmed);
  const greeting = words.greeting(new Date().getHours(), trimmed || null);
  const countryName = countryPickerName(country, language === 'ar' ? 'ar' : 'en');
  const countryValue = countryName ? `${countryFlag(country)} ${countryName}` : words.notSet;
  const currencyValue = currency ?? words.chooseCurrency;
  return <EStepFrame palette={band} step={1} onBack={onBack} onClose={onClose} backDisabled={busy} testID="onboarding-name"
    footer={<>
      <EButton palette={band} color={bandButtonColor(band)} label={words.continue} onPress={onContinue}
        disabled={!trimmed || busy} busy={busy} testID="onboarding-name-continue" />
      <ETextAction palette={band} label={t('onboardNameSkip')} onPress={onSkip} disabled={busy} testID="onboarding-name-skip" />
    </>}>
    <EHeadline palette={band} size={44}>{words.nameTitle}</EHeadline>
    <View testID="onboarding-name-underline"
      style={[styles.inputWrap, focused ? styles.inputWrapFocused : null, { borderBottomColor: focused ? band.onBand : band.onBandSecondary }]}>
      <TextInput
        testID="onboarding-name-input"
        accessibilityLabel={words.namePlaceholder}
        value={nameDraft}
        onChangeText={onChangeName}
        placeholder={words.namePlaceholder}
        placeholderTextColor={band.onBandSecondary}
        selectionColor={band.onBand}
        maxLength={MAX_PREFERRED_NAME_LENGTH}
        autoCapitalize="words"
        autoCorrect={false}
        enterKeyHint="done"
        returnKeyType="done"
        onSubmitEditing={() => { if (trimmed) onContinue(); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, Platform.OS === 'web' ? styles.inputWeb : null, {
          color: band.onBand,
          fontFamily: language === 'ar' ? Fonts.arabicBold : Fonts.sansSemi,
          textAlign: language === 'ar' ? 'right' : 'left',
        }]}
      />
    </View>
    <View style={[styles.preview, largeText && styles.previewStacked]} testID="onboarding-name-preview" accessible
      accessibilityLiveRegion="polite" accessibilityLabel={`${words.firstTile} ${words.homeGreets} ${greeting}`}>
      <FlipTile initial={initial ?? ''} palette={band} />
      {/* At the accessibility sizes the words take the full width under the
          tile, so "afternoon" wraps as a word instead of mid-word. */}
      <View style={[styles.previewCopy, largeText && styles.previewCopyStacked]}>
        <ThemedText style={[styles.previewText, { color: band.onBandSecondary }]}>{words.firstTile}</ThemedText>
        <ThemedText style={[styles.previewText, { color: band.onBandSecondary }]}>{words.homeGreets}</ThemedText>
        <ThemedText type="smallBold" style={[styles.previewGreeting, { color: band.onBand }]}>{greeting}</ThemedText>
      </View>
    </View>
    <View style={styles.privacy}>
      <View style={[styles.privacyIcon, { height: Math.round(PRIVACY_LINE * Math.max(1, fontScale || 1)) }]}>
        <Icon name="lock" size={lockSize} color={band.onBandSecondary} />
      </View>
      <ThemedText type="meta" style={[styles.privacyText, { color: band.onBandSecondary }]}>{t('onboardNamePrivacy')}</ThemedText>
    </View>
    {saveFailed ? <ThemedText accessibilityLiveRegion="polite" type="meta" style={{ color: band.onBand }}>
      {t('onboardFinishSaveFailedBody')}
    </ThemedText> : null}
    <View style={styles.confirm}>
      <ConfirmRow palette={band} label={words.countryLabel} value={countryValue} testID="onboarding-country-confirm"
        spoken={words.countryChange(countryName ?? words.notSet)} onPress={() => setCountryOpen(true)} />
      <ConfirmRow palette={band} label={words.currencyLabel} value={currencyValue} testID="onboarding-currency-confirm"
        missing={!currency}
        spoken={currency ? words.currencyChange(currency) : words.chooseCurrency} onPress={() => setCurrencyOpen(true)} />
    </View>
    <CountryPickerSheet
      visible={countryOpen}
      value={country}
      suggested={[suggestedCountry]}
      title={t('onboardCountrySheetTitle')}
      subtitle={t('onboardCountrySheetBody')}
      onClose={() => setCountryOpen(false)}
      onSelect={(code) => { tapped(); onCountry(code); }}
      testID="onboarding-country-sheet"
    />
    <LedgerCurrencySheet
      visible={currencyOpen}
      value={currency}
      onClose={() => setCurrencyOpen(false)}
      onSelect={(code) => { onCurrency(code); setCurrencyOpen(false); }}
    />
  </EStepFrame>;
}

/** The privacy line's line height (ThemedText `meta`), for centring the lock on its first line. */
const PRIVACY_LINE = 20;

const styles = StyleSheet.create({
  inputWrap: { borderBottomWidth: 2, paddingBottom: 6, marginTop: 8 },
  /** One point heavier when focused, taken from the padding so nothing moves. */
  inputWrapFocused: { borderBottomWidth: 3, paddingBottom: 5 },
  /** The browser's focus box drawn round the field; the underline shows focus instead. */
  inputWeb: { outlineWidth: 0 },
  input: { minHeight: 64, fontSize: 40, lineHeight: 48, letterSpacing: -1, paddingVertical: 4 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 12 },
  previewStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 12 },
  tile: { width: 96, height: 96 },
  face: {
    ...StyleSheet.absoluteFillObject, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backfaceVisibility: 'hidden',
  },
  tileEmpty: { borderWidth: 2, borderStyle: 'dashed' },
  tileLetter: { fontFamily: Fonts.sansSemi, fontSize: 54, lineHeight: 64 },
  previewCopy: { flex: 1, minWidth: 0, gap: 2 },
  previewCopyStacked: { flex: 0, alignSelf: 'stretch' },
  previewText: { fontSize: 16, lineHeight: 23 },
  previewGreeting: { fontSize: 17, lineHeight: 24 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, minHeight: 28 },
  privacyIcon: { justifyContent: 'center' },
  privacyText: { flexShrink: 1 },
  confirm: { gap: 8, marginTop: 4 },
  row: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 14, borderWidth: 1.5,
  },
  rowStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  rowLabel: { minWidth: 64 },
  rowValue: { flex: 1, minWidth: 0 },
  rowValueStacked: { flex: 0, alignSelf: 'stretch' },
});
