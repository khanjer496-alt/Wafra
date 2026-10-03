import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  COUNTRY_CODES,
  COUNTRY_UNKNOWN,
  countryDisplayName,
  countryFlag,
  normalizeCountryCode,
} from '@/lib/country';
import { getLanguage, t } from '@/lib/i18n';

/** Case- and accent-insensitive search text ("Côte d’Ivoire" finds "cote"). */
const fold = (value: string): string =>
  value.normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase('en-US');

/** The name a picker shows, including the explicit "not listed" answer. */
export function countryPickerName(code: string | null, language = getLanguage()): string | null {
  if (!code) return null;
  if (code === COUNTRY_UNKNOWN) return t('onboardCountryElsewhere');
  return countryDisplayName(code, language === 'ar' ? 'ar' : 'en');
}

/**
 * Every ISO country, searchable in English and Arabic, with a few suggestions
 * (the phone's Region, the current answer) pinned above the full list. The
 * last option is the explicit "somewhere else", stored as `ZZ`.
 */
export function CountryPickerSheet({
  visible,
  value,
  suggested = [],
  title,
  subtitle,
  onClose,
  onSelect,
  testID,
}: {
  visible: boolean;
  value: string | null;
  suggested?: readonly (string | null | undefined)[];
  title: string;
  subtitle?: string;
  onClose(): void;
  onSelect(country: string): void;
  testID?: string;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const language = getLanguage() === 'ar' ? 'ar' : 'en';
  const everyone = useMemo(() => [...COUNTRY_CODES].sort((a, b) =>
    countryDisplayName(a, language).localeCompare(countryDisplayName(b, language), language)),
  [language]);
  const pinned = useMemo(() => [...new Set(suggested
    .map((code) => normalizeCountryCode(code))
    .filter((code): code is string => !!code && code !== COUNTRY_UNKNOWN))],
  [suggested]);
  const options = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return [...pinned, ...everyone.filter((code) => !pinned.includes(code)), COUNTRY_UNKNOWN];
    return everyone.filter((code) =>
      code.toLowerCase() === needle ||
      fold(countryDisplayName(code, 'en')).includes(needle) ||
      fold(countryDisplayName(code, 'ar')).includes(needle));
  }, [everyone, pinned, query]);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={close} title={title} subtitle={subtitle} testID={testID}>
      <TextField
        label={t('countrySearch')}
        value={query}
        onChangeText={setQuery}
        inputMode="search"
        autoCorrect={false}
        leading={<Icon name="search" size={17} color={theme.textSecondary} />}
      />
      <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel={title}>
        {options.map((code) => {
          const selected = value === code;
          const name = countryPickerName(code, language) ?? code;
          return (
            <Pressable
              key={code}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              accessibilityLabel={name}
              onPress={() => {
                onSelect(code);
                close();
              }}
              style={({ pressed }) => [styles.option, { opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText style={styles.optionFlag} accessible={false}>{countryFlag(code)}</ThemedText>
              <ThemedText
                style={[styles.optionText, selected && { fontFamily: Fonts.sansSemi, color: theme.primary }]}>
                {name}
              </ThemedText>
              {selected && <Icon name="check" size={16} color={theme.primary} />}
            </Pressable>
          );
        })}
        {options.length === 0 && (
          <View style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary">{t('countryNoMatch')}</ThemedText>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
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
  empty: { paddingVertical: Spacing.four, alignItems: 'center' },
});
