import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button, Chip } from '@/components/ui/controls';
import { CategoryChips } from '@/components/ui/category-chips';
import { Icon } from '@/components/ui/icon';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { EXPENSE_CATEGORIES } from '@/lib/categories';
import { shortDate, toISODate } from '@/lib/format';
import { t, tf, type StringKey } from '@/lib/i18n';
import { UNASSIGNED_INCOME_ACCOUNT_ID } from '@/lib/ledger';
import { periodLabel } from '@/lib/period';
import { projectTransactionFilter, type TransactionFilters as Filters, type DatePreset, type SortMode } from '@/lib/transaction-filter';
import type { Account, CategoryId, TransactionType } from '@/lib/types';

type FilterIndex = Parameters<typeof projectTransactionFilter>[0];
type FilterOptions = Parameters<typeof projectTransactionFilter>[2];
export interface TransactionFilterSheetProps {
  initialFilters: Filters;
  resetFilters: Filters;
  accounts: readonly Account[];
  hasUnassignedIncome: boolean;
  index: FilterIndex;
  options: FilterOptions;
  onClose: () => void;
  onApply: (filters: Filters, resetScope: boolean) => void;
}

function FilterSection({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const theme = useTheme();
  return <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.cardBorder }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title + ': ' + summary}
      accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
      style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{summary}</ThemedText>
      </View>
      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={16} color={theme.textSecondary} />
    </Pressable>
    {expanded && <View style={{ paddingBottom: 12, gap: 8 }}>{children}</View>}
  </View>;
}

/** Draft controls own their state. Editing a chip cannot rebuild the ledger behind
 * the modal. Close discards the draft; Show results applies it once. */
export function TransactionFilterSheet({ initialFilters, resetFilters, accounts, hasUnassignedIncome, index, options, onClose, onApply }: TransactionFilterSheetProps) {
  const theme = useTheme();
  const language = useLanguage();
  const tr = useCallback((key: StringKey) => t(key, language), [language]);
  const trf = useCallback((key: StringKey, vars: Record<string, string | number>) => tf(key, vars, language), [language]);
  const [filters, setFilters] = useState<Filters>(() => ({ ...initialFilters, categories: new Set(initialFilters.categories) }));
  const [resetScope, setResetScope] = useState(false);
  const [picking, setPicking] = useState<'dateFrom' | 'dateTo' | null>(null);
  const [rangeDraft, setRangeDraft] = useState({ dateFrom: initialFilters.dateFrom ?? '', dateTo: initialFilters.dateTo ?? '' });
  const appliedFilters = useDeferredValue(filters);
  const preview = useMemo(() => projectTransactionFilter(index, appliedFilters,
    resetScope ? { ...options, merchant: null, smsOnly: false } : options), [index, appliedFilters, options, resetScope]);
  const { filtered } = preview;
  const resultsPending = appliedFilters !== filters;
  const period = options.period;
  const presetLabel: Record<DatePreset, string> = {
    selected: period.mode === 'all' ? tr('selectedPeriod') : periodLabel(period),
    all: tr('allTime'), month: tr('thisMonth'), lastMonth: tr('lastMonth'),
    '3months': tr('lastThreeMonths'), custom: tr('dateRange'),
  };
  const toggleCategory = (id: CategoryId) => setFilters(current => {
    const categories = new Set(current.categories);
    if (categories.has(id)) categories.delete(id); else categories.add(id);
    return { ...current, categories };
  });
  const clearFilters = () => {
    setFilters({ ...resetFilters, categories: new Set(resetFilters.categories) });
    setRangeDraft({ dateFrom: '', dateTo: '' });
    setPicking(null);
    setResetScope(true);
  };
  return (<BottomSheet
        visible
        title={tr('filtersTitle')}
        onClose={onClose}
        testID="transaction-filter-sheet"
        footer={<View style={styles.sheetActions}>
          <Button inline variant="outline" label={tr('reset')} onPress={clearFilters} />
          <Button inline wrapLabel disabled={resultsPending}
            label={trf('showResults', { count: filtered.length, s: filtered.length === 1 ? '' : 's' })}
            onPress={() => onApply(filters, resetScope)} />
        </View>}>
        <View style={styles.filterGroup}>
          <ThemedText type="micro" themeColor="textSecondary">
            {tr('typeFilter')}
          </ThemedText>
          <View style={styles.chipRow}>
            {([null, 'expense', 'income'] as (TransactionType | null)[]).map((type) => {
              const label =
                type === null
                  ? tr('allWord')
                  : type === 'expense'
                    ? `− ${tr('expenseLabel')}`
                    : `+ ${tr('incomeLabel')}`;
              return (
                <Chip
                  key={String(type)}
                  label={label}
                  active={filters.type === type}
                  onPress={() => setFilters((current) => ({ ...current, type }))}
                />
              );
            })}
          </View>
        </View>

        <View style={styles.filterGroup}>
          <ThemedText type="micro" themeColor="textSecondary">
            {tr('periodFilter')}
          </ThemedText>
          <View style={styles.chipRow}>
            {(Object.keys(presetLabel) as DatePreset[]).map((preset) => (
              <Chip
                key={preset}
                label={presetLabel[preset]}
                active={filters.datePreset === preset}
                onPress={() =>
                  setFilters((current) => ({ ...current, datePreset: preset }))
                }
              />
            ))}
          </View>

          {filters.datePreset === 'custom' && (
            <View style={styles.rangeRow}>
              {(['dateFrom', 'dateTo'] as const).map((field) => {
                const label = field === 'dateFrom' ? tr('fromLabel') : tr('toLabel');
                return (
                  <View key={field} style={styles.rangeColumn}>
                    <ThemedText type="micro" themeColor="textSecondary">
                      {label}
                    </ThemedText>
                    {Platform.OS === 'web' ? (
                      // Typed, because there is no picker to open here. The
                      // bound only moves on a complete ISO date, so the list
                      // is not re-filtered against "2026-0".
                      <TextInput
                        accessibilityLabel={`${label}: ${
                          filters[field] ? shortDate(filters[field]!) : tr('anyLabel')
                        }`}
                        value={rangeDraft[field]}
                        onChangeText={(text) => {
                          setRangeDraft((current) => ({ ...current, [field]: text }));
                          const iso = text.trim();
                          const whole = /^\d{4}-\d{2}-\d{2}$/.test(iso);
                          if (whole || iso === '') {
                            setFilters((current) => ({ ...current, [field]: whole ? iso : null }));
                          }
                        }}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={theme.textSecondary}
                        inputMode="numeric"
                        style={[
                          styles.rangeInput,
                          styles.rangeTextInput,
                          { backgroundColor: theme.backgroundSelected, color: theme.text },
                        ]}
                      />
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${label}: ${
                          filters[field] ? shortDate(filters[field]!) : tr('anyLabel')
                        }`}
                        onPress={() => setPicking(field)}
                        style={[styles.rangeInput, { backgroundColor: theme.backgroundSelected }]}>
                        <ThemedText
                          type="small"
                          themeColor={filters[field] ? 'text' : 'textSecondary'}>
                          {filters[field] ? shortDate(filters[field]!) : tr('anyLabel')}
                        </ThemedText>
                      </Pressable>
                    )}
                  </View>
                );
              })}
              {filters.dateFrom || filters.dateTo ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr('clearFilter')}
                  onPress={() => {
                    setRangeDraft({ dateFrom: '', dateTo: '' });
                    setFilters((current) => ({
                      ...current,
                      dateFrom: null,
                      dateTo: null,
                    }));
                  }}
                  style={styles.rangeClear}
                  hitSlop={8}>
                  <ThemedText type="small" style={{ color: theme.primary }}>
                    {tr('clearFilter')}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          )}
          {/* Never mounted on web: the package has no web build, so this
              renders null after a console warning. The typed fields above are
              the web path. */}
          {picking !== null && Platform.OS !== 'web' && (
            <DateTimePicker
              mode="date"
              display="calendar"
              value={filters[picking] ? new Date(`${filters[picking]}T12:00:00`) : new Date()}
              minimumDate={
                picking === 'dateTo' && filters.dateFrom
                  ? new Date(`${filters.dateFrom}T12:00:00`)
                  : undefined
              }
              maximumDate={
                picking === 'dateFrom' && filters.dateTo
                  ? new Date(`${filters.dateTo}T12:00:00`)
                  : new Date()
              }
              onChange={(event, picked) => {
                const field = picking;
                setPicking(null);
                if (event.type !== 'set' || !picked || !field) return;
                setFilters((current) => ({ ...current, [field]: toISODate(picked) }));
              }}
            />
          )}
        </View>

<FilterSection title={tr('accountFilter')} summary={filters.accountId ? accounts.find(account => account.id === filters.accountId)?.name ?? tr('incomeAccountReview') : tr('allWord')}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRowScroll}>
            <Chip
              label={tr('allWord')}
              active={!filters.accountId}
              onPress={() => setFilters((current) => ({ ...current, accountId: null }))}
            />
            {hasUnassignedIncome && <Chip
              label={tr('incomeAccountReview')} active={filters.accountId === UNASSIGNED_INCOME_ACCOUNT_ID}
              onPress={() => setFilters(current => ({ ...current, accountId: UNASSIGNED_INCOME_ACCOUNT_ID }))} />}
            {accounts.map((account) => (
              <Chip
                key={account.id}
                label={account.name}
                active={filters.accountId === account.id}
                onPress={() =>
                  setFilters((current) => ({
                    ...current,
                    accountId: current.accountId === account.id ? null : account.id,
                  }))
                }
              />
            ))}
          </ScrollView>
</FilterSection>

<FilterSection title={tr('categoriesFilter')} summary={filters.categories.size > 0 ? String(filters.categories.size) : tr('allWord')}>
          <CategoryChips
            categories={EXPENSE_CATEGORIES}
            selected={filters.categories}
            onToggle={toggleCategory}
            layout="wrap"
          />
</FilterSection>

<FilterSection title={tr('minimumAmountFilter')} summary={filters.minFils ? `${filters.minFils / 100}+` : tr('anyLabel')}>
          <View style={styles.chipRow}>
            {[null, 10000, 50000, 100000].map((value) => (
              <Chip
                key={String(value)}
                label={value === null ? tr('anyLabel') : `${value / 100}+`}
                active={filters.minFils === value}
                onPress={() =>
                  setFilters((current) => ({ ...current, minFils: value }))
                }
              />
            ))}
          </View>
</FilterSection>

<FilterSection title={tr('sortFilter')} summary={tr(filters.sort === 'newest' ? 'newest' : filters.sort === 'oldest' ? 'oldest' : 'largest')}>
          <View style={styles.chipRow}>
            {(['newest', 'oldest', 'largest'] as SortMode[]).map((sort) => (
              <Chip
                key={sort}
                label={
                  sort === 'newest'
                    ? tr('newest')
                    : sort === 'oldest'
                      ? tr('oldest')
                      : tr('largest')
                }
                active={filters.sort === sort}
                onPress={() => setFilters((current) => ({ ...current, sort }))}
              />
            ))}
          </View>
</FilterSection>

</BottomSheet>);
}

const styles = StyleSheet.create({
  filterGroup: {
    gap: Spacing.two,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.two,
  },
  rangeColumn: {
    flex: 1,
    gap: Spacing.one,
  },
  rangeInput: {
    minHeight: 44,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two + 2,
    justifyContent: 'center',
  },
  rangeTextInput: {
    fontSize: 14,
    fontWeight: '500',
  },
  rangeClear: {
    minHeight: 44,
    justifyContent: 'flex-end',
    paddingBottom: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chipRowScroll: {
    gap: Spacing.two,
    paddingBottom: Spacing.one,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  }
});
