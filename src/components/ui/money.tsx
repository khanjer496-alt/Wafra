import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText, type TextType } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { formatAmount } from '@/lib/format';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';

type Sign = 'none' | 'auto' | 'minus' | 'plus';

interface MoneyProps {
  fils: number;
  /** Explicit ledger denomination for reactive surfaces such as restored Home. */
  moneySpec?: LedgerMoneySpec;
  type?: TextType;
  /** Colour of the figure. Defaults to ink. */
  color?: string;
  sign?: Sign;
  decimals?: boolean;
  /** The demoted currency prefix. On by default. */
  prefix?: boolean;
  style?: StyleProp<ViewStyle>;
}

function signGlyph(fils: number, sign: Sign): string {
  switch (sign) {
    case 'minus':
      return '−';
    case 'plus':
      return '+';
    case 'auto':
      return fils < 0 ? '−' : '+';
    default:
      return fils < 0 ? '−' : '';
  }
}

function CurrencyPrefix({ label }: { label?: string }) {
  const ledgerMoney = useLedgerMoney();
  return (
    <ThemedText themeColor="textSecondary" style={styles.currencyPrefix}>
      {label ?? ledgerMoney?.currency ?? ledgerCurrencyDisplay()}
    </ThemedText>
  );
}

/**
 * A money figure with its currency demoted in `textSecondary`,
 * sitting on the amount's baseline, so the digits carry the line.
 */
export function Money({
  fils,
  moneySpec,
  type = 'small',
  color,
  sign = 'none',
  decimals,
  prefix = true,
  style,
}: MoneyProps) {
  const contextMoney = useLedgerMoney();
  const denomination = moneySpec ?? contextMoney;
  const currency = denomination?.currency ?? ledgerCurrencyDisplay();
  const value = denomination
    ? formatMinorUnits(Math.round(Math.abs(fils)), denomination, decimals === true ? { decimals: true } : undefined)
    : formatAmount(Math.abs(fils), { decimals });
  const amount = `${signGlyph(fils, sign)}${value}`;
  const label = `${prefix ? `${currency} ` : ''}${amount}`;
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label} style={[styles.inline, style]}>
      {prefix && (
        <CurrencyPrefix label={currency} />
      )}
      <ThemedText type={type} tabular style={[styles.value, color ? { color } : undefined]}>
        {amount}
      </ThemedText>
    </View>
  );
}

interface AmountFieldProps {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  /** 38 on the new-entry sheet, 34 in the limit editor. */
  fontSize?: number;
  helper?: string;
  autoFocus?: boolean;
}

/**
 * The amount input: caps label, demoted currency, a big mono figure on a
 * 1.5px ink underline with a primary caret.
 */
export function AmountField({
  label,
  value,
  onChangeText,
  fontSize = 38,
  helper,
  autoFocus,
}: AmountFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="micro" themeColor="textTertiary">
        {label}
      </ThemedText>
      <View style={[styles.fieldRow, { borderBottomColor: theme.text }]}>
        <CurrencyPrefix />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          autoFocus={autoFocus}
          placeholder="0"
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.primary}
          cursorColor={theme.primary}
          style={[
            styles.input,
            {
              color: theme.text,
              fontSize,
              lineHeight: fontSize * 1.1,
              letterSpacing: fontSize * -0.02,
            },
          ]}
        />
      </View>
      {helper && (
        <ThemedText type="meta" themeColor="textTertiary">
          {helper}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The demoted currency: 15px mono in textSecondary, on the amount's baseline.
  currencyPrefix: {
    fontFamily: Fonts.sansMedium,
    fontSize: 15,
    lineHeight: 19,
  },
  inline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: Spacing.two - 2,
  },
  value: { flexShrink: 1, minWidth: 0 },
  field: {
    gap: Spacing.two,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
    borderBottomWidth: 1.5,
    paddingBottom: Spacing.two,
  },
  input: {
    flex: 1,
    padding: 0,
    fontFamily: Fonts.monoSemi,
    fontVariant: ['tabular-nums'],
  },
});
