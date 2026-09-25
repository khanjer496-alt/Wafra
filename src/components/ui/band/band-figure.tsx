import React from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { RollingMoney } from '@/components/ui/rolling-money';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney, useMoneyLocaleKey } from '@/hooks/use-ledger-money';
import { formatAmount } from '@/lib/format';
import { figureFontMultiplier } from '@/lib/large-text-figure';
import { currencyDisplayLabel, currencyPlacement, formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';
import { ledgerCurrencyDisplay } from '@/lib/markets';

export type BandFigureSize = 'hero' | 'large' | 'medium';

/** Band figures: Geist SemiBold with tabular digits, never Geist Mono (its comma spaces out "5 , 480"). */
const SIZES: Record<BandFigureSize, { fontSize: number; lineHeight: number; letterSpacing: number; cap: number; prefix: number }> = {
  hero: { fontSize: 56, lineHeight: 62, letterSpacing: -2.2, cap: 1.5, prefix: 22 },
  large: { fontSize: 32, lineHeight: 38, letterSpacing: -1, cap: 1.75, prefix: 17 },
  medium: { fontSize: 22, lineHeight: 28, letterSpacing: -0.5, cap: 2, prefix: 14 },
};

type Sign = 'none' | 'auto' | 'minus' | 'plus';

/* Device number conventions are module state; the locale key is an argument
 * only so a compiled memo re-formats when the device settings change (as Money). */
const placementFor = (currency: string, _localeKey: string) => currencyPlacement(currency);
const labelFor = (currency: string, _localeKey: string) => currencyDisplayLabel(currency);
const valueFor = (fils: number, spec: LedgerMoneySpec | null, decimals: boolean | undefined, _localeKey: string) => spec
  ? formatMinorUnits(Math.round(Math.abs(fils)), spec, decimals === true ? { decimals: true } : undefined)
  : formatAmount(Math.abs(fils), { decimals });

function signGlyph(fils: number, sign: Sign): string {
  if (sign === 'minus') return '−';
  if (sign === 'plus') return '+';
  if (sign === 'auto') return fils < 0 ? '−' : '+';
  return fils < 0 ? '−' : '';
}

export interface BandFigureProps {
  /** What the figure is ("Spent this month"). Spoken first. */
  label?: string;
  fils: number;
  moneySpec?: LedgerMoneySpec;
  sign?: Sign;
  decimals?: boolean;
  /** One short line under the figure ("Day 25 of 30"). */
  qualifier?: string;
  palette: BandPalette;
  size?: BandFigureSize;
  /** Text colours; defaults to the band's own. A mint tile passes onAccent. */
  color?: string;
  secondaryColor?: string;
  /**
   * Roll only the changed digits when the value changes (Home's Today). The
   * first appearance is static; Reduce Motion and screen readers get a static
   * figure; Android stays static unless measured.
   */
  rolling?: boolean;
  /** Horizontal space around the figure beyond the band gutters (a tile's padding). */
  fitInset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The one figure a band exists to show: a label, the amount in large Geist
 * SemiBold with tabular digits and a demoted currency, then an optional
 * qualifier. Formats exactly like Money (ledger minor units, device number
 * conventions, currency placement) and speaks "label, CUR amount. qualifier".
 * At the accessibility text sizes the figure shrinks toward its width (never
 * below 60% of the requested size) and the currency takes its own line.
 */
export function BandFigure({
  label, fils, moneySpec, sign = 'none', decimals, qualifier, palette, size = 'hero',
  color, secondaryColor, rolling = false, fitInset = 0, style, testID,
}: BandFigureProps) {
  const contextMoney = useLedgerMoney();
  const localeKey = useMoneyLocaleKey();
  const large = useLargeTextLayout();
  const { width, fontScale } = useWindowDimensions();
  const spec = moneySpec ?? contextMoney;
  const currency = spec?.currency ?? ledgerCurrencyDisplay();
  const amount = `${signGlyph(fils, sign)}${valueFor(fils, spec, decimals, localeKey)}`;
  const placement = placementFor(currency, localeKey);
  const currencyLabel = labelFor(currency, localeKey);
  const metrics = SIZES[size];
  const fg = color ?? palette.onBand;
  const fg2 = secondaryColor ?? palette.onBandSecondary;
  const multiplier = figureFontMultiplier(amount.length, metrics.fontSize, metrics.cap, width - 40 - fitInset, fontScale);
  const figureStyle: TextStyle[] = [styles.figure, {
    fontSize: metrics.fontSize, lineHeight: metrics.lineHeight, letterSpacing: metrics.letterSpacing, color: fg,
  }];
  const prefixStyle: TextStyle = { fontSize: metrics.prefix, lineHeight: Math.round(metrics.prefix * 1.25), color: fg2 };
  const spoken = [label, `${currency} ${amount}`].filter(Boolean).join(', ') + (qualifier ? `. ${qualifier}` : '');

  const figure = rolling
    ? <RollingMoney fils={fils} moneySpec={spec ?? undefined} sign={sign} decimals={decimals} type="amount"
        figureStyle={figureStyle} prefixStyle={[styles.prefix, prefixStyle]} maxFontSizeMultiplier={multiplier} prefix />
    : <View style={[styles.inline, large && styles.stacked, !placement.spaced && styles.tight]}>
        {placement.position === 'after' ? null
          : <ThemedText style={[styles.prefix, prefixStyle]}>{currencyLabel}</ThemedText>}
        <ThemedText tabular maxFontSizeMultiplier={multiplier} style={figureStyle}>{amount}</ThemedText>
        {placement.position === 'after'
          ? <ThemedText style={[styles.prefix, prefixStyle]}>{currencyLabel}</ThemedText> : null}
      </View>;

  return <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={spoken} style={[styles.root, style]}>
    {label ? <ThemedText type="small" style={{ color: fg2 }}>{label}</ThemedText> : null}
    {figure}
    {qualifier ? <ThemedText type="meta" style={{ color: fg2 }}>{qualifier}</ThemedText> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 4, alignItems: 'flex-start' },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 },
  stacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 0 },
  tight: { gap: 1 },
  figure: { fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], flexShrink: 0, maxWidth: '100%' },
  prefix: { fontFamily: Fonts.sansMedium },
});
