import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionRow } from '@/components/transaction-row';
import { Icon } from '@/components/ui/icon';
import { ScreenHeader, SectionHeader } from '@/components/ui/layout';
import { PeriodPill } from '@/components/ui/period-pill';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { formatAED } from '@/lib/format';
import { formatOriginalCurrency } from '@/lib/fx';
import { summarizeForeignActivity } from '@/lib/fx-summary';
import { t, tf } from '@/lib/i18n';
import { inPeriod } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import type { Transaction } from '@/lib/types';

const CURRENCY_FLAGS: Record<string, string> = {
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  INR: '🇮🇳',
  SAR: '🇸🇦',
  QAR: '🇶🇦',
};

export default function CurrencyScreen() {
  const theme = useTheme();
  const language = useLanguage();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { state } = useStore();
  const { period } = usePeriod();
  const [periodOpen, setPeriodOpen] = useState(false);
  const [entry, setEntry] = useState<Transaction | null>(null);
  const [query, setQuery] = useState('');

  const summary = useMemo(
    () => summarizeForeignActivity(state.transactions, (tx) => inPeriod(tx.date, period)),
    [state.transactions, period],
  );
  const accountById = useMemo(
    () => new Map(state.accounts.map((account) => [account.id, account] as const)),
    [state.accounts],
  );
  const chargeCount = summary.transactions.length;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = normalizedQuery
    ? summary.groups.filter((group) => group.currency.toLowerCase().includes(normalizedQuery))
    : summary.groups;
  const visibleTransactions = normalizedQuery
    ? summary.transactions.filter((transaction) => {
        const account = accountById.get(transaction.accountId);
        return [transaction.title, transaction.originalCurrency, account?.name]
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
    : summary.transactions;
  const caption = tf(
    'foreignActivityCaption',
    {
      count: chargeCount,
      s: chargeCount === 1 ? '' : 's',
      currencies: summary.groups.length,
      ending: summary.groups.length === 1 ? 'y' : 'ies',
    },
    language,
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}>
          <ScreenHeader title={t('foreignSpending', language)} onBack={() => router.back()} />

          <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
            {t('foreignSpendingSubtitle', language)}
          </ThemedText>

          <View style={styles.periodRow}>
            <PeriodPill onPress={() => setPeriodOpen(true)} />
          </View>

          <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}>
            <Icon name="search" size={16} color={theme.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('searchForeignSpending', language)}
              placeholderTextColor={theme.textTertiary}
              accessibilityLabel={t('searchForeignSpending', language)}
              autoCorrect={false}
              style={[styles.searchInput, { color: theme.text }]}
            />
            {query.length > 0 && (
              <Pressable accessibilityRole="button" accessibilityLabel={t('clearSearch', language)} onPress={() => setQuery('')} hitSlop={10}>
                <Icon name="close" size={15} color={theme.textSecondary} />
              </Pressable>
            )}
          </View>

          <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(320)}>
            <ThemedText type="micro" themeColor="textTertiary" style={styles.heroLabel}>
              {t('foreignConvertedTotal', language)}
            </ThemedText>
            <ThemedText type="amount" tabular>
              {formatAED(summary.totalLocalFils, { decimals: false })}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
              {caption}
            </ThemedText>
            <ThemedText type="meta" themeColor="textTertiary">
              {t('foreignOriginalsKept', language)}
            </ThemedText>
          </Animated.View>

          {summary.transactions.length > 0 ? (
            <>
              <Animated.View
                entering={reducedMotion ? undefined : FadeInDown.delay(40).duration(320)}
                style={styles.section}>
                <SectionHeader title={t('conversionQuality', language)} />
                <View style={[styles.quality, { borderColor: theme.cardBorder }]}>
                  {[
                    [t('bankQuoted', language), summary.bankQuotedCount, theme.income],
                    [t('referenceRate', language), summary.referenceCount, theme.primary],
                    [t('offlineEstimate', language), summary.estimatedCount, theme.warning],
                  ].map(([label, count, color], index) => (
                    <View
                      key={String(label)}
                      style={[
                        styles.qualityCell,
                        index > 0 && { borderStartColor: theme.cardBorder, borderStartWidth: StyleSheet.hairlineWidth },
                      ]}>
                      <ThemedText type="heading" tabular style={{ color: String(color) }}>
                        {String(count)}
                      </ThemedText>
                      <ThemedText type="nano" themeColor="textTertiary" style={styles.qualityLabel}>
                        {String(label)}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </Animated.View>

              <Animated.View
                entering={reducedMotion ? undefined : FadeInDown.delay(80).duration(320)}
                style={styles.section}>
                <SectionHeader title={t('currencyBreakdown', language)} />
                {visibleGroups.map((group, index) => (
                  <Pressable
                    key={group.currency}
                    accessibilityRole="button"
                    accessibilityLabel={`${group.currency}, ${group.count} ${t('charges', language)}`}
                    onPress={() => setQuery(group.currency)}
                    style={[
                      styles.currencyRow,
                      {
                        borderTopColor: theme.cardBorder,
                        borderBottomColor: theme.cardBorder,
                        ...(index === visibleGroups.length - 1
                          ? { borderBottomWidth: StyleSheet.hairlineWidth }
                          : null),
                      },
                    ]}>
                    <View style={[styles.currencyMark, { backgroundColor: theme.primarySoft }]}>
                      <ThemedText style={styles.flag}>{CURRENCY_FLAGS[group.currency] ?? '🌐'}</ThemedText>
                      <ThemedText type="smallBold" tabular style={{ color: theme.primary }}>
                        {group.currency}
                      </ThemedText>
                    </View>
                    <View style={styles.currencyMiddle}>
                      <ThemedText type="smallBold" tabular>
                        {formatOriginalCurrency(group.originalMinor, group.currency, language)}
                      </ThemedText>
                      <ThemedText type="meta" themeColor="textTertiary">
                        {tf(
                          'transactionsCount',
                          { count: group.count, s: group.count === 1 ? '' : 's' },
                          language,
                        )}
                      </ThemedText>
                    </View>
                    <ThemedText type="smallBold" tabular>
                      {formatAED(group.localFils, { decimals: false })}
                    </ThemedText>
                  </Pressable>
                ))}
              </Animated.View>

              <Animated.View
                entering={reducedMotion ? undefined : FadeInDown.delay(120).duration(320)}
                style={styles.section}>
                <SectionHeader title={t('foreignRecent', language)} />
                {visibleTransactions.map((transaction, index) => (
                  <View
                    key={transaction.id}
                    style={
                      index > 0
                        ? { borderTopColor: theme.cardBorder, borderTopWidth: StyleSheet.hairlineWidth }
                        : undefined
                    }>
                    <TransactionRow
                      transaction={transaction}
                      account={accountById.get(transaction.accountId)}
                      onPress={setEntry}
                    />
                  </View>
                ))}
              </Animated.View>
            </>
          ) : (
            <View style={[styles.empty, { borderColor: theme.cardBorder }]}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                <Icon name="plane" size={22} color={theme.textSecondary} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {t('noForeignActivity', language)}
              </ThemedText>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
      <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { paddingHorizontal: ScreenPadding, paddingBottom: Spacing.five },
  intro: { marginTop: -Spacing.one, maxWidth: 330 },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.three,
    marginBottom: Spacing.three,
  },
  search: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.five,
  },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: Spacing.two, fontSize: 15 },
  heroLabel: { marginBottom: Spacing.two },
  caption: { marginTop: Spacing.three, marginBottom: Spacing.one },
  section: { marginTop: Spacing.five },
  quality: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  qualityCell: { flex: 1, paddingVertical: Spacing.three, gap: 5, alignItems: 'center' },
  qualityLabel: { textAlign: 'center' },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 2,
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
  },
  currencyMark: {
    width: 62,
    height: 40,
    flexDirection: 'row',
    gap: 5,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flag: { fontSize: 15, lineHeight: 19 },
  currencyMiddle: { flex: 1, gap: 2 },
  empty: {
    marginTop: Spacing.five,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.five,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
