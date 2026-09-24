import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText, type TextType } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLedgerMoney, useMoneyLocaleKey } from '@/hooks/use-ledger-money';
import { formatAmount } from '@/lib/format';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { currencyDisplayLabel, currencyPlacement, formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';

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

/*
 * The device number conventions are module state that React cannot see, and
 * React Compiler memoizes each call below on its arguments. The locale key is
 * an argument only so a device settings change invalidates those memos; the
 * formatting itself reads the conventions ledger-money.ts has applied.
 */
function figureText(
  fils: number,
  denomination: LedgerMoneySpec | null,
  decimals: boolean | undefined,
  _localeKey: string,
): string {
  return denomination
    ? formatMinorUnits(Math.round(Math.abs(fils)), denomination, decimals === true ? { decimals: true } : undefined)
    : formatAmount(Math.abs(fils), { decimals });
}
const placementFor = (currency: string, _localeKey: string) => currencyPlacement(currency);
const labelFor = (code: string, _localeKey: string) => currencyDisplayLabel(code);

/**
 * The visual currency label: an unambiguous symbol in the device locale
 * ("€", "₹", "CA$"), else the ISO code. AED and SAR always show their code.
 * Screen readers hear the ISO code, never a bare symbol.
 */
function CurrencyPrefix({ label }: { label?: string }) {
  const ledgerMoney = useLedgerMoney();
  const localeKey = useMoneyLocaleKey();
  const code = label ?? ledgerMoney?.currency ?? ledgerCurrencyDisplay();
  return (
    <ThemedText themeColor="textSecondary" style={styles.currencyPrefix}
      accessibilityLabel={code}>
      {labelFor(code, localeKey)}
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
  const localeKey = useMoneyLocaleKey();
  const denomination = moneySpec ?? contextMoney;
  const currency = denomination?.currency ?? ledgerCurrencyDisplay();
  const value = figureText(fils, denomination, decimals, localeKey);
  const amount = `${signGlyph(fils, sign)}${value}`;
  const label = `${prefix ? `${currency} ` : ''}${amount}`;
  // The locale's own pattern: "1.234,56 €" in de-DE, "$1,234.56" in en-US;
  // AED/SAR and any code-labelled currency stay "AED 1,234.56". The screen
  // reader label above always speaks the ISO code first.
  const placement = placementFor(currency, localeKey);
  const currencyNode = prefix ? <CurrencyPrefix label={currency} /> : null;
  const figure = (
    <ThemedText type={type} tabular style={[styles.value, color ? { color } : undefined]}>
      {amount}
    </ThemedText>
  );
  const [first, second] = placement.position === 'after' ? [figure, currencyNode] : [currencyNode, figure];
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label}
      style={[styles.inline, !placement.spaced && styles.tight, style]}>
      {first}
      {second}
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
  tight: { gap: 1 },
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
