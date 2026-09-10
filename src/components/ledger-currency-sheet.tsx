import { getLocales } from 'expo-localization';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY_MINOR_UNITS } from '@/lib/currency-metadata';
import { t, tf } from '@/lib/i18n';
import { ledgerMoneySpec } from '@/lib/ledger-money';

const COMMON = [
  'USD', 'EUR', 'GBP', 'JPY', 'INR', 'CAD', 'AUD', 'SGD', 'CHF',
  'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'CNY', 'KRW', 'BRL', 'MXN', 'ZAR',
] as const;

/** Currencies the ledger can represent exactly today (ISO exponents 0, 2 or 3). */
export const supportedLedgerCurrencies = (): string[] => Object.keys(CURRENCY_MINOR_UNITS)
  .filter((code) => ledgerMoneySpec(code) !== null)
  .sort();

/** Region is a suggestion only. The user still confirms before the first manual entry. */
export function suggestedLedgerCurrency(): string | null {
  try {
    const code = getLocales()[0]?.currencyCode?.trim().toUpperCase() ?? '';
    return code && ledgerMoneySpec(code) ? code : null;
  } catch {
    return null;
  }
}

export function LedgerCurrencySheet({
  visible,
  value,
  onClose,
  onSelect,
}: {
  visible: boolean;
  value: string | null;
  onClose: () => void;
  onSelect: (currency: string) => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const suggestion = useMemo(suggestedLedgerCurrency, []);
  const all = useMemo(supportedLedgerCurrencies, []);
  const options = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (needle) return all.filter((code) => code.includes(needle)).slice(0, 30);
    return [...new Set([suggestion, value, ...COMMON].filter((code): code is string => !!code))]
      .filter((code) => all.includes(code));
  }, [all, query, suggestion, value]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('ledgerCurrencyTitle')}>
      <ThemedText type="small" themeColor="textSecondary">
        {t('ledgerCurrencyBody')}
      </ThemedText>
      <TextField
        label={t('searchCurrency')}
        value={query}
        onChangeText={setQuery}
        inputMode="search"
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={t('currencyCodeExample')}
        leading={<Icon name="search" size={17} color={theme.textSecondary} />}
      />
      <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel={t('ledgerCurrencyTitle')}>
        {options.map((code) => {
          const selected = code === value;
          const exponent = ledgerMoneySpec(code)?.exponent ?? 2;
          return (
            <Pressable
              key={code}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={code}
              onPress={() => {
                onSelect(code);
                setQuery('');
                onClose();
              }}
              style={({ pressed }) => [
                styles.option,
                { borderColor: theme.cardBorder },
                selected && { backgroundColor: theme.primarySoft, borderColor: theme.primary },
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <View style={styles.optionCopy}>
                <ThemedText type="smallBold">{code}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {suggestion === code
                    ? t('currencySuggestedByPhone')
                    : tf('currencyDecimalPlaces', { count: exponent })}
                </ThemedText>
              </View>
              {selected && <Icon name="check" size={17} color={theme.primary} />}
            </Pressable>
          );
        })}
        {options.length === 0 && (
          <View style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary">{t('currencyNotSupported')}</ThemedText>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.one },
  option: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control,
  },
  optionCopy: { flex: 1, minWidth: 0, gap: 2 },
  empty: { paddingVertical: Spacing.four, alignItems: 'center' },
});
