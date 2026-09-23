import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import {
  ONBOARDING_REGION_ELSEWHERE,
  ONBOARDING_REGION_IDS,
  ONBOARDING_REGION_LABELS,
} from '@/lib/onboarding-bank-examples';

const night = Colors.dark;

const PICKABLE: readonly string[] = [...ONBOARDING_REGION_IDS, ONBOARDING_REGION_ELSEWHERE];

/** The country's own name, or its bare code if a newer build knew one more. */
function countryName(code: string | null): string | null {
  if (!code) return null;
  const entry = ONBOARDING_REGION_LABELS[code];
  return entry ? t(entry.labelKey) : code;
}

function countryFlag(code: string | null): string {
  return (code && ONBOARDING_REGION_LABELS[code]?.flag) || '🌍';
}

/**
 * The one line that lets a person correct where Wafra thinks they are.
 *
 * A device Region is a guess, and for an expatriate it is routinely the wrong
 * one: a UAE resident whose phone or store account is British gets a British
 * bank on the first screen, which reads as Wafra not knowing what country it
 * is in. Nothing downstream depended on that guess — the parser routes from
 * the alerts themselves — but the person cannot see that, so the guess has to
 * be correctable where it is first shown.
 *
 * Hence the copy: this changes the EXAMPLES, and their own accounts arrive
 * from their own messages whatever country those are in. Overstating it would
 * turn a cosmetic control into a promise about parsing that it does not keep.
 */
export function OnboardingCountryConfirm({ country, resolved, onChange }: {
  /** The country the user has confirmed, if they have. */
  country: string | null;
  /** What onboarding is drawing right now: confirmed, or the device's guess. */
  resolved: string | null;
  onChange(country: string): void;
}) {
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const [open, setOpen] = useState(false);
  const shown = country ?? resolved;
  const name = countryName(shown);
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

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('onboardCountrySheetTitle')}
        subtitle={t('onboardCountrySheetBody')}
        testID="onboarding-country-sheet">
        <View style={styles.list}>
          {PICKABLE.map((code) => {
            const selected = country === code;
            const optionName = countryName(code) ?? code;
            return (
              <Pressable
                key={code}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                aria-checked={selected}
                accessibilityLabel={optionName}
                onPress={() => {
                  tapped();
                  onChange(code);
                  setOpen(false);
                }}
                style={({ pressed }) => [styles.option, { opacity: pressed ? 0.7 : 1 }]}>
                <ThemedText style={styles.optionFlag} accessible={false}>{countryFlag(code)}</ThemedText>
                <ThemedText
                  style={[styles.optionText, selected && { fontFamily: Fonts.sansSemi, color: theme.primary }]}>
                  {optionName}
                </ThemedText>
                {selected && <Icon name="check" size={16} color={theme.primary} />}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
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
  list: { paddingBottom: Spacing.two },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  optionFlag: { fontSize: 19 },
  optionText: { flex: 1, minWidth: 0, fontFamily: Fonts.sansMedium, fontSize: 15 },
});
