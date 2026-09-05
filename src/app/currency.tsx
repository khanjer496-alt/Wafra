import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { TransactionRow } from '@/components/transaction-row';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { Icon } from '@/components/ui/icon';
import { SectionHeader } from '@/components/ui/layout';
import { PeriodPill } from '@/components/ui/period-pill';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { formatAED } from '@/lib/format';
import { formatOriginalCurrency } from '@/lib/fx';
import { summarizeForeignActivity } from '@/lib/fx-summary';
import { ledgerCurrencyCode, ledgerCurrencyDisplay } from '@/lib/markets';
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

  // The ledger's own currency is passed rather than left to the default, so
  // this screen states which currency it is calling "local" instead of
  // inheriting it. "Foreign" below means "not the currency the stored fils are
  // in" — a SAR charge on a SAR ledger is not foreign activity, and its stored
  // fils are the same money as its original amount, not a conversion of it.
  const ledgerCurrency = ledgerCurrencyCode();
  const summary = useMemo(
    () =>
      summarizeForeignActivity(
        state.transactions,
        (tx) => inPeriod(tx.date, period),
        ledgerCurrency,
      ),
    [state.transactions, period, ledgerCurrency],
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

  const currencyHeader: ScreenHeaderProps = {
    title: t('foreignSpending', language),
    back: { label: t('back', language), onPress: () => router.back() },
  };

  return (
    <>
      <ScreenScaffold
        headerMode="native"
        header={currencyHeader}
        scrollProps={{ showsVerticalScrollIndicator: false }}>
          <View style={styles.periodRow}>
            <PeriodPill onPress={() => setPeriodOpen(true)} />
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
            {t('foreignSpendingSubtitle', language)}
          </ThemedText>

          <TextField
            label={t('searchForeignSpending', language)}
            value={query}
            onChangeText={setQuery}
            inputMode="search"
            returnKeyType="search"
            placeholder={t('searchForeignSpending', language)}
            autoCorrect={false}
            leading={<Icon name="search" size={17} color={theme.textSecondary} />}
            trailing={query.length > 0 ? (
              <ActionIconButton
                icon="close"
                label={t('clearSearch', language)}
                variant="plain"
                onPress={() => setQuery('')}
              />
            ) : undefined}
          />

          <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(320)}>
            <ThemedText type="micro" themeColor="textTertiary" style={styles.heroLabel}>
              {tf('foreignConvertedTotal', { currency: ledgerCurrencyDisplay() }, language)}
            </ThemedText>
            <ThemedText type="amount" tabular>
              {formatAED(summary.totalLocalFils, { decimals: false })}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
              {caption}
            </ThemedText>
            <ThemedText type="meta" themeColor="textTertiary">
              {tf('foreignOriginalsKept', { currency: ledgerCurrencyDisplay() }, language)}
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
      </ScreenScaffold>

      <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
      <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  intro: { maxWidth: 330 },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
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
