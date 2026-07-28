import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { SectionHeader } from '@/components/ui/period-pill';
import { Elevation, Fonts, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { EXPENSE_CATEGORIES, getCategory } from '@/lib/categories';
import { daysInMonth, formatAED, parseAmountToFils, shiftMonthKey } from '@/lib/format';
import { spentInMonthForCategory } from '@/lib/insights';
import { inPeriod } from '@/lib/period';
import { useStore } from '@/lib/store';
import type { CategoryId } from '@/lib/types';

interface LimitSheetProps {
  /** The category being edited, or null to create a new limit. */
  category: CategoryId | null;
  open: boolean;
  /** The month the "spent so far" figure is measured against. */
  monthKey: string;
  onClose: () => void;
}

/**
 * Set or change a monthly limit on one category.
 *
 * The old editor asked for a number in a vacuum. A limit is only meaningful
 * next to what you actually spend, so this leads with the current month, offers
 * the three-month average as a suggestion, and lists the merchants that make up
 * the figure — which is the question anyone types a number in here to answer.
 */
export function LimitSheet({ category, open, monthKey: key, onClose }: LimitSheetProps) {
  const theme = useTheme();
  const { state, upsertBudget, deleteBudget } = useStore();

  const [picked, setPicked] = useState<CategoryId | null>(category);
  const [text, setText] = useState('');

  const existing = picked ? state.budgets.find((b) => b.category === picked) : undefined;

  // Re-seed each time the sheet opens rather than on every render, so typing
  // is not fought by the prop.
  useEffect(() => {
    if (!open) return;
    setPicked(category);
    const current = category ? state.budgets.find((b) => b.category === category) : undefined;
    setText(current ? String(Math.round(current.limitFils / 100)) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category]);

  const spent = useMemo(
    () => (picked ? spentInMonthForCategory(state.transactions, key, picked) : 0),
    [state.transactions, key, picked],
  );

  /** What this category has cost over the three months ending in `key`. */
  const threeMonthAverage = useMemo(() => {
    if (!picked) return 0;
    let total = 0;
    for (let i = 0; i < 3; i++) {
      total += spentInMonthForCategory(state.transactions, shiftMonthKey(key, -i), picked);
    }
    return Math.round(total / 3);
  }, [state.transactions, key, picked]);

  /** Who the money went to, so the number has something behind it. */
  const merchants = useMemo(() => {
    if (!picked) return [];
    const map = new Map<string, { title: string; totalFils: number; count: number }>();
    for (const t of state.transactions) {
      if (t.type !== 'expense' || t.isTransfer) continue;
      if (t.category !== picked || !inPeriod(t.date, key)) continue;
      const k = t.title.trim().toLowerCase();
      const cur = map.get(k);
      if (cur) {
        cur.totalFils += t.amountFils;
        cur.count += 1;
      } else {
        map.set(k, { title: t.title, totalFils: t.amountFils, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.totalFils - a.totalFils).slice(0, 4);
  }, [state.transactions, key, picked]);

  const limitFils = parseAmountToFils(text);
  const ratio = limitFils ? spent / limitFils : 0;
  const over = ratio >= 1;
  const daysLeft = Math.max(0, daysInMonth(key) - new Date().getDate());

  const suggestions = useMemo(() => {
    const out: { fils: number; note: string; highlight: boolean }[] = [];
    if (threeMonthAverage > 0) {
      out.push({
        fils: roundToHundred(threeMonthAverage),
        note: 'your 3-month average',
        highlight: true,
      });
    }
    if (spent > 0) out.push({ fils: roundToHundred(spent * 0.9), note: '10% under this month', highlight: false });
    for (const fils of [50_000, 100_000, 200_000]) {
      if (!out.some((s) => s.fils === fils)) out.push({ fils, note: '', highlight: false });
    }
    return out.slice(0, 4);
  }, [threeMonthAverage, spent]);

  const available = EXPENSE_CATEGORIES.filter(
    (c) => !state.budgets.some((b) => b.category === c.id) || c.id === picked,
  );

  const save = () => {
    if (!picked || !limitFils) return;
    upsertBudget({ category: picked, limitFils });
    onClose();
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            Elevation,
            { backgroundColor: theme.card, borderColor: theme.cardBorder },
          ]}
          onPress={() => {}}>
          <View style={styles.header}>
            <ThemedText type="micro" themeColor="textTertiary">
              {picked ? `${getCategory(picked).label} limit` : 'New limit'}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={10}>
              <Icon name="close" size={18} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {!category && (
              <View style={styles.picker}>
                {available.map((c) => {
                  const on = picked === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setPicked(c.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: on ? theme.text : 'transparent',
                          borderColor: on ? theme.text : theme.cardBorder,
                        },
                      ]}>
                      <ThemedText type="meta" style={{ color: on ? theme.background : theme.text }}>
                        {c.label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {picked && limitFils !== null && (
              <View style={styles.current}>
                <View style={styles.currentTop}>
                  <ThemedText type="meta" themeColor="textSecondary">
                    Spent this month
                  </ThemedText>
                  <ThemedText
                    type="smallBold"
                    tabular
                    style={{ color: over ? theme.expense : theme.text }}>
                    {formatAED(spent, { decimals: false })}
                    <ThemedText type="meta" themeColor="textTertiary" tabular>
                      {'  / '}
                      {formatAED(limitFils, { decimals: false })}
                    </ThemedText>
                  </ThemedText>
                </View>
                <View style={[styles.track, { backgroundColor: theme.track }]}>
                  <View
                    style={{
                      width: `${Math.max(2, Math.min(100, ratio * 100))}%`,
                      height: '100%',
                      backgroundColor: over ? theme.expenseGraphic : theme.primary,
                      borderRadius: 4,
                    }}
                  />
                </View>
                <ThemedText type="meta" themeColor="textTertiary">
                  {over
                    ? `Over by ${formatAED(spent - limitFils, { decimals: false })}`
                    : `${formatAED(limitFils - spent, { decimals: false })} left`}
                  {daysLeft > 0 ? ` with ${daysLeft} day${daysLeft === 1 ? '' : 's'} still to go.` : '.'}
                </ThemedText>
              </View>
            )}

            <View style={styles.amountBlock}>
              <ThemedText type="micro" themeColor="textTertiary">
                Monthly limit
              </ThemedText>
              <View style={[styles.amountRow, { borderBottomColor: theme.text }]}>
                <ThemedText type="smallBold" themeColor="textSecondary" tabular style={styles.aed}>
                  AED
                </ThemedText>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={theme.textTertiary}
                  selectionColor={theme.primary}
                  style={[styles.amountInput, { color: theme.text }]}
                />
              </View>
            </View>

            {picked && (
              <View style={styles.suggestions}>
                {suggestions.map((s) => (
                  <Pressable
                    key={`${s.fils}-${s.note}`}
                    onPress={() => setText(String(Math.round(s.fils / 100)))}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: s.highlight ? theme.primarySoft : 'transparent',
                        borderColor: s.highlight ? theme.primaryBorder : theme.cardBorder,
                      },
                    ]}>
                    <ThemedText type="meta" tabular>
                      {formatAED(s.fils, { decimals: false })}
                      {s.note ? (
                        <ThemedText type="meta" themeColor="textTertiary">
                          {` · ${s.note}`}
                        </ThemedText>
                      ) : null}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            )}

            {merchants.length > 0 && (
              <View style={styles.where}>
                <SectionHeader title="Where it went" />
                {merchants.map((m, i) => (
                  <View
                    key={m.title}
                    style={[
                      styles.whereRow,
                      i > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.cardBorder,
                      },
                    ]}>
                    <ThemedText type="small" numberOfLines={1} style={styles.whereName}>
                      {m.title}
                    </ThemedText>
                    <ThemedText type="meta" themeColor="textTertiary" tabular>
                      {m.count}×
                    </ThemedText>
                    <ThemedText type="smallBold" tabular style={styles.whereFigure}>
                      {formatAED(m.totalFils, { decimals: false })}
                    </ThemedText>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          <View style={styles.actions}>
            {existing && (
              <Pressable
                onPress={() => {
                  deleteBudget(existing.category);
                  onClose();
                }}
                style={[styles.btn, { borderWidth: 1, borderColor: theme.expenseSoftBorder }]}>
                <ThemedText type="micro" style={{ color: theme.expense }}>
                  Remove
                </ThemedText>
              </Pressable>
            )}
            <Pressable
              onPress={save}
              disabled={!picked || !limitFils}
              style={[
                styles.btn,
                styles.btnPrimary,
                { backgroundColor: theme.primary, opacity: !picked || !limitFils ? 0.45 : 1 },
              ]}>
              <ThemedText type="micro" style={{ color: theme.onPrimary }}>
                Save limit
              </ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Suggestions land on a round number — nobody budgets AED 1,247. */
function roundToHundred(fils: number): number {
  return Math.max(10_000, Math.round(fils / 10_000) * 10_000);
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(22,19,15,0.42)' },
  sheet: {
    maxHeight: '88%',
    flexShrink: 1,
    borderTopLeftRadius: Radius.bottomSheet,
    borderTopRightRadius: Radius.bottomSheet,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: ScreenPadding,
    paddingTop: ScreenPadding,
    paddingBottom: 30,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingBottom: Spacing.three },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.three },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  current: { marginTop: Spacing.four, gap: Spacing.two },
  currentTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  amountBlock: { marginTop: Spacing.four, gap: Spacing.two },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
    borderBottomWidth: 1.5,
    paddingBottom: Spacing.two,
  },
  aed: { fontSize: 15 },
  amountInput: {
    flex: 1,
    fontFamily: Fonts.monoSemi,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.7,
    padding: 0,
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.three },
  where: { marginTop: Spacing.five },
  whereRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: 11,
  },
  whereName: { flex: 1 },
  whereFigure: { minWidth: 62, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  btn: {
    borderRadius: Radius.control,
    paddingVertical: 15,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { flex: 1 },
});
