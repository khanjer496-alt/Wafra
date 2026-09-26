/**
 * Structured parts of an Ask Wafra answer: upcoming payment rows with their
 * merchant logos, and a bar per recorded month. Both draw only what the
 * executor computed (AssistantAnswer.payments / monthlySeries); nothing here
 * derives a figure of its own.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GrowBar } from '@/components/ui/grow-bar';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Spacing, type BandPalette } from '@/constants/theme';
import { assistantScreenCopy } from '@/lib/assistant-screen-copy';
import { categoryLabel } from '@/lib/categories';
import { structuralTitleLabel } from '@/lib/i18n';
import { formatMinorUnits, formatMoneyText, type LedgerMoneySpec } from '@/lib/ledger-money';
import type { AssistantMonthTotal, AssistantPaymentRow } from '@/lib/wafra-assistant';

/** Tallest bar, in points. */
const CHART_HEIGHT = 80;
/** Longest value drawn above a bar ("12,345"); longer ones are only spoken. */
const MAX_VALUE_CHARS = 6;

function shortDate(iso: string, language: 'en' | 'ar'): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  try {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-AE' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      .format(new Date(year, month - 1, day));
  } catch {
    return iso;
  }
}

function monthLabel(key: string, language: 'en' | 'ar'): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  try {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-AE' : 'en-GB', { month: 'short' })
      .format(new Date(year, month - 1, 1));
  } catch {
    return key;
  }
}

/**
 * The whole-unit value drawn above a bar, or '' when it would not fit a
 * column or would round to a misleading "0" over a visible bar.
 */
export function monthBarValue(totalFils: number, money: LedgerMoneySpec): string {
  if (totalFils <= 0 || Math.round(totalFils / 10 ** money.exponent) === 0) return '';
  const value = formatMinorUnits(totalFils, money, { decimals: false });
  return value.length <= MAX_VALUE_CHARS ? value : '';
}

export function AssistantPaymentRows({ payments, money, language, palette }: {
  payments: AssistantPaymentRow[];
  money: LedgerMoneySpec;
  language: 'en' | 'ar';
  palette: BandPalette;
}) {
  const copy = assistantScreenCopy(language);
  return (
    <View testID="assistant-payment-rows" style={[styles.rows, { borderColor: palette.rule }]}>
      {payments.map((payment, index) => {
        const title = structuralTitleLabel(payment.title, language);
        const when = payment.daysLeft < 0
          ? copy.dueLate(Math.abs(payment.daysLeft))
          : payment.daysLeft === 0 ? copy.dueToday : copy.dueIn(payment.daysLeft);
        const detail = [categoryLabel(payment.category, language), shortDate(payment.dateISO, language), when].join(' · ');
        const amount = formatMoneyText(payment.amountFils, money);
        return (
          <View
            key={`${payment.title}-${payment.dateISO}-${index}`}
            accessible
            accessibilityLabel={`${title}, ${detail}, ${amount}`}
            style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.rule }]}>
            <MerchantAvatar title={payment.title} category={payment.category} size={32} />
            <View style={styles.rowText}>
              <ThemedText type="small" numberOfLines={1} style={{ color: palette.text }}>{title}</ThemedText>
              <ThemedText type="meta" numberOfLines={1} style={{ color: palette.textSecondary }}>{detail}</ThemedText>
            </View>
            <ThemedText type="smallBold" tabular style={{ color: palette.text }}>{amount}</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

/**
 * A bar per recorded month, oldest first, on the sheet: the month the answer
 * names in the band's tint, every other month in the sheet's rule tone, the
 * whole-unit value above each bar and the short month under it. Bars grow
 * from the baseline 50ms apart on first appearance and stay still under
 * Reduce Motion (GrowBar). At the accessibility text sizes the values above
 * the bars step aside; each column's spoken label always carries its amount.
 */
export function AssistantMonthChart({ series, highlight, money, language, palette, largeText = false }: {
  series: AssistantMonthTotal[];
  /** The month the answer names. No bar is emphasised when it is absent. */
  highlight?: string;
  money: LedgerMoneySpec;
  language: 'en' | 'ar';
  palette: BandPalette;
  largeText?: boolean;
}) {
  const copy = assistantScreenCopy(language);
  const largest = series.reduce((max, month) => Math.max(max, month.totalFils), 0);
  if (series.length < 2 || largest <= 0) return null;
  return (
    <View testID="assistant-month-chart" accessibilityLabel={copy.monthlyChartLabel} style={styles.chart}>
      {series.map((month, index) => {
        const amount = formatMoneyText(month.totalFils, money, { decimals: false });
        const label = monthLabel(month.month, language);
        const named = highlight !== undefined && month.month === highlight;
        return (
          <View key={month.month} style={styles.column} accessible accessibilityLabel={`${label} ${month.month.slice(0, 4)}, ${amount}`}>
            {!largeText ? <ThemedText type="nano" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
              style={[styles.value, { color: named ? palette.text : palette.textSecondary }]}>
              {monthBarValue(month.totalFils, money)}
            </ThemedText> : null}
            <View style={styles.barTrack}>
              <GrowBar
                axis="height"
                size={Math.max(3, Math.round((month.totalFils / largest) * CHART_HEIGHT))}
                delay={index * 50}
                style={[styles.bar, { backgroundColor: named ? palette.tint : palette.rule }]}
              />
            </View>
            <ThemedText type="meta" numberOfLines={1} style={{ color: named ? palette.text : palette.textSecondary }}>{label}</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingVertical: Spacing.two + 2 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, paddingTop: Spacing.two },
  column: { flex: 1, minWidth: 0, alignItems: 'center', gap: Spacing.one },
  value: { fontVariant: ['tabular-nums'], textAlign: 'center', alignSelf: 'stretch' },
  barTrack: { height: CHART_HEIGHT, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '100%', borderRadius: 6 },
});
