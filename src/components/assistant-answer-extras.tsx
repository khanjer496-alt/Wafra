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
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { assistantScreenCopy } from '@/lib/assistant-screen-copy';
import { categoryLabel } from '@/lib/categories';
import { structuralTitleLabel } from '@/lib/i18n';
import { formatMoneyText, type LedgerMoneySpec } from '@/lib/ledger-money';
import type { AssistantMonthTotal, AssistantPaymentRow } from '@/lib/wafra-assistant';

const CHART_HEIGHT = 72;

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

export function AssistantPaymentRows({ payments, money, language }: {
  payments: AssistantPaymentRow[];
  money: LedgerMoneySpec;
  language: 'en' | 'ar';
}) {
  const theme = useTheme();
  const copy = assistantScreenCopy(language);
  return (
    <View testID="assistant-payment-rows" style={[styles.rows, { borderColor: theme.cardBorder }]}>
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
            style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder }]}>
            <MerchantAvatar title={payment.title} category={payment.category} size={32} />
            <View style={styles.rowText}>
              <ThemedText type="small" numberOfLines={1}>{title}</ThemedText>
              <ThemedText type="meta" themeColor="textSecondary" numberOfLines={1}>{detail}</ThemedText>
            </View>
            <ThemedText type="smallBold" tabular>{amount}</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

export function AssistantMonthChart({ series, highlight, money, language }: {
  series: AssistantMonthTotal[];
  /** The month the answer names. No bar is emphasised when it is absent. */
  highlight?: string;
  money: LedgerMoneySpec;
  language: 'en' | 'ar';
}) {
  const theme = useTheme();
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
            <View style={styles.barTrack}>
              <GrowBar
                axis="height"
                size={Math.max(3, Math.round((month.totalFils / largest) * CHART_HEIGHT))}
                delay={index * 40}
                style={[styles.bar, { backgroundColor: named ? theme.primary : theme.primaryBorder }]}
              />
            </View>
            <ThemedText type="meta" themeColor="textSecondary">{label}</ThemedText>
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
  column: { flex: 1, alignItems: 'center', gap: Spacing.one },
  barTrack: { height: CHART_HEIGHT, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '70%', borderRadius: 4 },
});
