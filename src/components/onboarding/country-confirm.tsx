import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { CountryPickerSheet, countryPickerName } from '@/components/country-picker-sheet';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { tapped } from '@/lib/haptics';
import { countryFlag } from '@/lib/country';
import { t } from '@/lib/i18n';
import { ONBOARDING_REGION_ELSEWHERE } from '@/lib/onboarding-bank-examples';

const night = Colors.dark;

/**
 * The one line that lets a person correct where Wafra thinks they are.
 *
 * A device Region is a guess, and for an expatriate it is routinely the wrong
 * one: a UAE resident whose phone or store account is British gets a British
 * bank on the first screen, which reads as Wafra not knowing what country it
 * is in. The guess has to be correctable where it is first shown.
 *
 * Every ISO country can be chosen. The answer is the ledger's country: it
 * sets how numeric dates in the user's alerts and statements are read
 * (day-first or month-first) and which example banks onboarding draws. It
 * does not change which messages Wafra can read — accounts still arrive from
 * the alerts themselves — so the copy must not promise more than that.
 */
export function OnboardingCountryConfirm({ country, resolved, onChange }: {
  /** The country the user has confirmed, if they have. */
  country: string | null;
  /** What onboarding is drawing right now: confirmed, or the device's guess. */
  resolved: string | null;
  onChange(country: string): void;
}) {
  const largeText = useLargeTextLayout();
  const [open, setOpen] = useState(false);
  const shown = country ?? resolved;
  const name = countryPickerName(shown);
  // "Examples for Somewhere else" is not a sentence. A deliberate opt-out
  // states itself; only an unanswered, unillustrable country asks to be set.
  const label = shown === ONBOARDING_REGION_ELSEWHERE
    ? t('onboardCountryElsewhere')
    : name ? `${t('onboardCountryShowing')} ${name}` : t('onboardCountryUnknown');

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${t('onboardCountryChange')}`}
        testID="onboarding-country-confirm"
        onPress={() => { tapped(); setOpen(true); }}
        style={({ pressed }) => [
          styles.row,
          largeText && styles.rowStacked,
          { opacity: pressed ? 0.7 : 1 },
        ]}>
        <ThemedText style={styles.flag} accessible={false}>{countryFlag(shown)}</ThemedText>
        {/* Never one clipped line: a country name is long in Arabic, longer at
            2x text on a 320pt screen, and a truncated country is the very
            confusion this control exists to end. It wraps and the row grows. */}
        <ThemedText style={[styles.label, largeText && styles.labelStacked]}>{label}</ThemedText>
        <ThemedText style={[styles.change, largeText && styles.changeStacked]}>
          {t('onboardCountryChange')}
        </ThemedText>
      </Pressable>

      <CountryPickerSheet
        visible={open}
        value={country}
        suggested={[resolved]}
        title={t('onboardCountrySheetTitle')}
        subtitle={t('onboardCountrySheetBody')}
        onClose={() => setOpen(false)}
        onSelect={(code) => {
          tapped();
          onChange(code);
        }}
        testID="onboarding-country-sheet"
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: night.cardBorder,
  },
  rowStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: Spacing.one },
  flag: { fontSize: 17 },
  label: { flex: 1, minWidth: 0, color: night.textSecondary, fontSize: 13, lineHeight: 18 },
  labelStacked: { flex: 0, alignSelf: 'stretch' },
  change: { color: night.primary, fontFamily: Fonts.sansSemi, fontSize: 13 },
  changeStacked: { alignSelf: 'flex-start' },
});
