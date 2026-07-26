import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/ui/card';
import { CategoryAvatar } from '@/components/ui/category-avatar';
import { Icon } from '@/components/ui/icon';
import { ProgressBar } from '@/components/ui/progress-bar';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import { EXPENSE_CATEGORIES, getCategory } from '@/lib/categories';
import { daysInMonth, formatAED, monthKey, monthLabel, parseAmountToFils } from '@/lib/format';
import { spentInMonthForCategory } from '@/lib/insights';
import { isCurrentMonth } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import type { CategoryId } from '@/lib/types';


export default function BudgetsScreen() {
  const theme = useTheme();
  const tabBarClearance = useTabBarClearance();
  const { state, upsertBudget, deleteBudget } = useStore();
  const { period } = usePeriod();
  const now = new Date();
  // Budgets are monthly, so follow the global period only when it IS a month;
  // year/range/all views fall back to the current month.
  const key = period.mode === 'month' ? period.key : monthKey(now);
  const live = isCurrentMonth({ mode: 'month', key }, now);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editCategory, setEditCategory] = useState<CategoryId | null>(null);
  const [amountText, setAmountText] = useState('');

  const rows = useMemo(
    () =>
      state.budgets
        .map((b) => ({
          budget: b,
          spent: spentInMonthForCategory(state.transactions, key, b.category),
        }))
        .sort((a, b) => b.spent / b.budget.limitFils - a.spent / a.budget.limitFils),
    [state.budgets, state.transactions, key],
  );

  const totalLimit = rows.reduce((s, r) => s + r.budget.limitFils, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  const monthProgress = live ? now.getDate() / daysInMonth(key) : 1;
  const available = EXPENSE_CATEGORIES.filter(
    (c) => !state.budgets.some((b) => b.category === c.id) || c.id === editCategory,
  );

  const openEditor = (category: CategoryId | null, currentFils?: number) => {
    setEditCategory(category);
    setAmountText(currentFils ? String(Math.round(currentFils / 100)) : '');
    setEditorVisible(true);
  };

  const save = () => {
    const fils = parseAmountToFils(amountText);
    if (!editCategory || !fils) return;
    upsertBudget({ category: editCategory, limitFils: fils });
    setEditorVisible(false);
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <View>
              <ThemedText style={styles.title}>{t('budgetsTitle')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {monthLabel(key)}
                {live ? ` · ${Math.round(monthProgress * 100)}% of the month gone` : ' · full month'}
              </ThemedText>
            </View>
            <Pressable
              onPress={() => openEditor(null)}
              style={[styles.addBtn, { backgroundColor: theme.primary }]}>
              <Icon name="plus" size={20} color={theme.onPrimary} strokeWidth={2.4} />
            </Pressable>
          </View>

          {rows.length > 0 && (
            <Animated.View entering={FadeInDown.duration(400)}>
              <Card style={styles.totalCard}>
                <View style={styles.totalTop}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {live ? 'Overall this month' : `Overall in ${monthLabel(key, true)}`}
                  </ThemedText>
                  <ThemedText type="smallBold">
                    {formatAED(totalSpent, { decimals: false })} / {formatAED(totalLimit, { decimals: false })}
                  </ThemedText>
                </View>
                <ProgressBar
                  ratio={totalLimit > 0 ? totalSpent / totalLimit : 0}
                  color={totalSpent > totalLimit ? theme.expense : theme.primary}
                  height={10}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  {totalSpent <= totalLimit
                    ? `${formatAED(totalLimit - totalSpent, { decimals: false })} left across all budgets`
                    : `${formatAED(totalSpent - totalLimit, { decimals: false })} over your combined limit`}
                </ThemedText>
              </Card>
            </Animated.View>
          )}

          <View style={styles.list}>
            {rows.map(({ budget, spent }, i) => {
              const meta = getCategory(budget.category);
              const ratio = spent / budget.limitFils;
              const over = ratio >= 1;
              const nearly = !over && ratio >= 0.85;
              // Pace: how spending compares to how far through the month we are.
              const paceAhead = ratio > monthProgress + 0.1;
              return (
                <Animated.View
                  key={budget.category}
                  entering={FadeInDown.delay(60 + i * 50).duration(350)}>
                  <Pressable onPress={() => openEditor(budget.category, budget.limitFils)}>
                    <Card style={styles.budgetCard}>
                      <View style={styles.budgetHeader}>
                        <CategoryAvatar category={budget.category} size={40} />
                        <View style={styles.budgetInfo}>
                          <ThemedText type="smallBold">{meta.label}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {over
                              ? `Over by ${formatAED(spent - budget.limitFils, { decimals: false })}`
                              : `${formatAED(budget.limitFils - spent, { decimals: false })} left`}
                            {/* "ahead of pace" reads as praise; this is a warning. */}
                            {paceAhead && !over ? ' · faster than the month' : ''}
                          </ThemedText>
                        </View>
                        <View style={styles.budgetAmounts}>
                          <ThemedText
                            type="smallBold"
                            style={{ color: over ? theme.expense : nearly ? theme.warning : theme.text }}>
                            {formatAED(spent, { decimals: false })}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            of {formatAED(budget.limitFils, { decimals: false })}
                          </ThemedText>
                        </View>
                      </View>
                      {/* Health, not identity. Painting the bar in the
                          category's own color meant Shopping at 70% rendered
                          red while Groceries at 99% rendered amber — the
                          alarm colors read backwards. The avatar and label
                          already say which category this is. */}
                      <ProgressBar
                        ratio={ratio}
                        color={over ? theme.expense : nearly ? theme.warning : theme.primary}
                      />
                    </Card>
                  </Pressable>
                </Animated.View>
              );
            })}

            {rows.length === 0 && (
              <Card style={styles.emptyCard}>
                <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                  <Icon name="target" size={26} color={theme.textSecondary} strokeWidth={1.7} />
                </View>
                <ThemedText type="smallBold">No budgets yet</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                  Set monthly limits per category and Wafra will track your pace and warn you
                  before you overspend.
                </ThemedText>
              </Card>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Budget editor */}
      <Modal visible={editorVisible} transparent animationType="fade" onRequestClose={() => setEditorVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEditorVisible(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
            onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <ThemedText type="smallBold" style={styles.sheetTitle}>
                {editCategory && state.budgets.some((b) => b.category === editCategory)
                  ? 'Edit budget'
                  : 'New budget'}
              </ThemedText>
              <Pressable onPress={() => setEditorVisible(false)}>
                <Icon name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catPicker}>
              {available.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setEditCategory(c.id)}
                  style={[
                    styles.catChip,
                    {
                      backgroundColor: editCategory === c.id ? `${c.color}2c` : theme.backgroundSelected,
                      borderColor: editCategory === c.id ? c.color : 'transparent',
                    },
                  ]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Icon name={c.icon} size={13} color={c.color} />
                    <ThemedText type="small">{c.label}</ThemedText>
                  </View>
                </Pressable>
              ))}
            </ScrollView>

            <View style={[styles.amountBox, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">AED</ThemedText>
              <TextInput
                value={amountText}
                onChangeText={setAmountText}
                keyboardType="numeric"
                placeholder="Monthly limit"
                placeholderTextColor={theme.textSecondary}
                style={[styles.amountInput, { color: theme.text }]}
              />
            </View>

            <View style={styles.sheetActions}>
              {editCategory && state.budgets.some((b) => b.category === editCategory) && (
                <Pressable
                  onPress={() => {
                    deleteBudget(editCategory);
                    setEditorVisible(false);
                  }}
                  style={[styles.sheetBtn, { backgroundColor: `${theme.expense}22` }]}>
                  <ThemedText type="smallBold" style={{ color: theme.expense }}>Delete</ThemedText>
                </Pressable>
              )}
              <Pressable
                onPress={save}
                disabled={!editCategory || !parseAmountToFils(amountText)}
                style={[
                  styles.sheetBtn,
                  styles.sheetBtnPrimary,
                  {
                    backgroundColor: theme.primary,
                    opacity: !editCategory || !parseAmountToFils(amountText) ? 0.45 : 1,
                  },
                ]}>
                <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>Save budget</ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 32,
  },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: Radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalCard: {
    gap: Spacing.two,
  },
  totalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  list: {
    gap: Spacing.two,
  },
  budgetCard: {
    gap: Spacing.three,
  },
  budgetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  budgetInfo: {
    flex: 1,
    gap: 1,
  },
  budgetAmounts: {
    alignItems: 'flex-end',
    gap: 1,
  },
  emptyCard: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 280,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: 17,
  },
  catPicker: {
    gap: Spacing.two,
  },
  catChip: {
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    borderWidth: 1.5,
  },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
  },
  amountInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    paddingVertical: Spacing.three,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  sheetBtn: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBtnPrimary: {
    flex: 1,
  },
});
