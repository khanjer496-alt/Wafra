/**
 * E2 · Name (clay). The name becomes the first tile of the pattern and
 * Home's greeting; it stays on this device (`userName`). Skip is allowed.
 *
 * Below it, two compact rows confirm where Wafra thinks the person is and
 * which currency the ledger counts in. They are separate answers and stay
 * separate controls: the country decides how alert and statement dates are
 * read, the currency is the ledger's unit and is needed before the Watch step
 * can write a limit. Each "Change" opens the existing sheet (the same country
 * picker and ledger-currency sheet Settings uses).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { CountryPickerSheet, countryPickerName } from '@/components/country-picker-sheet';
import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { EHeadline, EStepFrame, ETextAction, bandButtonColor } from '@/components/onboarding/e-frame';
import { useEMotion } from '@/components/onboarding/e-motion';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { Icon } from '@/components/ui/icon';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { countryFlag } from '@/lib/country';
import { tapped } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { MAX_PREFERRED_NAME_LENGTH, normalizePreferredName } from '@/lib/onboarding';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import { patternInitial } from '@/lib/pattern';

function ConfirmRow({ label, value, spoken, onPress, palette, testID }: {
  label: string;
  value: string;
  spoken: string;
  onPress: () => void;
  palette: BandPalette;
  testID: string;
}) {
  const largeText = useLargeTextLayout();
  const words = onboardingECopy(useLanguage());
  return <Pressable accessibilityRole="button" accessibilityLabel={spoken} testID={testID}
    onPress={() => { tapped(); onPress(); }}
    style={({ pressed }) => [styles.row, largeText && styles.rowStacked, { borderColor: palette.bandRule, opacity: pressed ? 0.7 : 1 }]}>
    <ThemedText type="meta" style={[styles.rowLabel, { color: palette.onBandSecondary }]}>{label}</ThemedText>
    <ThemedText type="smallBold" style={[styles.rowValue, largeText && styles.rowValueStacked, { color: palette.onBand }]}>{value}</ThemedText>
    <ThemedText type="smallBold" style={{ color: palette.onBand }}>{words.change}</ThemedText>
  </Pressable>;
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
  const band = useBand('spending');
  const moving = useEMotion();
  const [countryOpen, setCountryOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  // What will be saved: the same normalisation setUserName applies.
  const trimmed = normalizePreferredName(nameDraft) ?? '';
  const initial = patternInitial(trimmed);
  const greeting = words.greeting(new Date().getHours(), trimmed || null);
  const countryName = countryPickerName(country, language === 'ar' ? 'ar' : 'en');
  const countryValue = countryName ? `${countryFlag(country)} ${countryName}` : words.notSet;
  const currencyValue = currency ?? words.notSet;
  return <EStepFrame palette={band} step={1} onBack={onBack} onClose={onClose} backDisabled={busy} testID="onboarding-name"
    footer={<>
      <EButton palette={band} color={bandButtonColor(band)} label={words.continue} onPress={onContinue}
        disabled={!trimmed || busy} busy={busy} testID="onboarding-name-continue" />
      <ETextAction palette={band} label={t('onboardNameSkip')} onPress={onSkip} disabled={busy} testID="onboarding-name-skip" />
    </>}>
    <EHeadline palette={band} size={44}>{words.nameTitle}</EHeadline>
    <View style={[styles.inputWrap, { borderBottomColor: band.onBandSecondary }]}>
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
        style={[styles.input, {
          color: band.onBand,
          fontFamily: language === 'ar' ? Fonts.arabicBold : Fonts.sansSemi,
          textAlign: language === 'ar' ? 'right' : 'left',
        }]}
      />
    </View>
    <View style={styles.preview} testID="onboarding-name-preview" accessible accessibilityLiveRegion="polite"
      accessibilityLabel={`${words.firstTile} ${words.homeGreets} ${greeting}`}>
      {initial ? <Animated.View key={initial} entering={moving ? ZoomIn.duration(240) : undefined}
        style={[styles.tile, { backgroundColor: band.onBand }]}>
        <ThemedText style={[styles.tileLetter, { color: band.band }]} allowFontScaling={false}>{initial}</ThemedText>
      </Animated.View> : <View style={[styles.tile, styles.tileEmpty, { borderColor: band.bandRule }]} />}
      <View style={styles.previewCopy}>
        <ThemedText style={[styles.previewText, { color: band.onBandSecondary }]}>{words.firstTile}</ThemedText>
        <ThemedText style={[styles.previewText, { color: band.onBandSecondary }]}>{words.homeGreets}</ThemedText>
        <ThemedText type="smallBold" style={[styles.previewGreeting, { color: band.onBand }]}>{greeting}</ThemedText>
      </View>
    </View>
    <View style={styles.privacy}>
      <Icon name="lock" size={14} color={band.onBandSecondary} />
      <ThemedText type="meta" style={[styles.privacyText, { color: band.onBandSecondary }]}>{t('onboardNamePrivacy')}</ThemedText>
    </View>
    {saveFailed ? <ThemedText accessibilityLiveRegion="polite" type="meta" style={{ color: band.onBand }}>
      {t('onboardFinishSaveFailedBody')}
    </ThemedText> : null}
    <View style={styles.confirm}>
      <ConfirmRow palette={band} label={words.countryLabel} value={countryValue} testID="onboarding-country-confirm"
        spoken={words.countryChange(countryName ?? words.notSet)} onPress={() => setCountryOpen(true)} />
      <ConfirmRow palette={band} label={words.currencyLabel} value={currencyValue} testID="onboarding-currency-confirm"
        spoken={words.currencyChange(currencyValue)} onPress={() => setCurrencyOpen(true)} />
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

const styles = StyleSheet.create({
  inputWrap: { borderBottomWidth: 2, paddingBottom: 6, marginTop: 8 },
  input: { minHeight: 64, fontSize: 40, lineHeight: 48, letterSpacing: -1, paddingVertical: 4 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 12 },
  tile: { width: 96, height: 96, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tileEmpty: { borderWidth: 2, borderStyle: 'dashed' },
  tileLetter: { fontFamily: Fonts.sansSemi, fontSize: 54, lineHeight: 64 },
  previewCopy: { flex: 1, minWidth: 0, gap: 2 },
  previewText: { fontSize: 16, lineHeight: 23 },
  previewGreeting: { fontSize: 17, lineHeight: 24 },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
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
