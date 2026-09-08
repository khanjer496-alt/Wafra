import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { SectionHeader } from '@/components/ui/period-pill';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import { categoryLabel, EXPENSE_CATEGORIES, getCategory } from '@/lib/categories';
import { formatAED, formatAmount, parseAmountToFils, shiftMonthKey } from '@/lib/format';
import { spentInMonthForCategory } from '@/lib/insights';
import { daysInPeriod, elapsedDays, inPeriod, isCurrentMonth } from '@/lib/period';
import { useStore } from '@/lib/store';
import type { CategoryId } from '@/lib/types';
import { alignEnd, t, tf } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';

/** How many merchants the sheet names before pooling the rest. */
const MERCHANT_ROWS = 4;

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
    setText(current ? formatAmount(current.limitFils).replace(/,/g, '') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category]);

  /**
   * The same two exclusions Flow's budget bar applies.
   *
   * Without them this sheet answered a different question from the screen that
   * opened it: Flow's bar drops hidden accounts and both halves of a move
   * between the user's own accounts, and this sheet counted them. One AED
   * 200,000 sweep between two of their own accounts is a category that reads
   * "0 spent" on Flow and "200,000 spent, limit exceeded" in the editor for
   * that very limit — and the three-month average it then suggests is built
   * from the same inflated months.
   */
  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = useMemo(
    () => internalTransferIds(state.transactions, state.accounts),
    [state.transactions, state.accounts],
  );

  const spent = useMemo(
    () =>
      picked
        ? spentInMonthForCategory(state.transactions, key, picked, liveAccounts, internal)
        : 0,
    [state.transactions, key, picked, liveAccounts, internal],
  );

  /**
   * What this category has cost over the three COMPLETE months before `key`.
   *
   * It used to average the current month in and still divide by three. On the
   * 2nd of the month that is two days of spending dragging a three-month
   * average down by a third: dining steady at AED 2,000 a month suggested a
   * limit of 1,400, and the chip that says "your 3-month average" was offering
   * a number the user had never once spent under.
   */
  const threeMonthAverage = useMemo(() => {
    if (!picked) return 0;
    let total = 0;
    for (let i = 1; i <= 3; i++) {
      total += spentInMonthForCategory(
        state.transactions,
        shiftMonthKey(key, -i),
        picked,
        liveAccounts,
        internal,
      );
    }
    return Math.round(total / 3);
  }, [state.transactions, key, picked, liveAccounts, internal]);

  /**
   * Who the money went to, so the number has something behind it.
   *
   * Four rows, plus the remainder. The four biggest were shown on their own
   * under a "Spent this month" figure that covers every merchant in the
   * category, so with a fifth grocer the column simply did not add up: AED
   * 2,289 spent, four rows totalling 2,074, and nothing anywhere to say where
   * the other 215 went. Home's "leaving soon" list had the identical bug and
   * takes the identical cure — keep the total honest and state the rest.
   */
  const { merchants, restFils, restCount, shownTotalFils } = useMemo(() => {
    if (!picked) return { merchants: [], restFils: 0, restCount: 0, shownTotalFils: 0 };
    const map = new Map<string, { title: string; totalFils: number; count: number }>();
    for (const t of state.transactions) {
      // Same filter as `spent` above, or the rows listed here do not add up to
      // the total printed over them — the exact defect the comment above this
      // block describes, reintroduced through a different door.
      if (!isSpending(t, liveAccounts, internal)) continue;
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
    // Keep the same exact minor units in the header, visible rows and remainder.
    const all = [...map.values()]
      .sort((a, b) => b.totalFils - a.totalFils);
    const shown = all.slice(0, MERCHANT_ROWS);
    const rest = all.slice(MERCHANT_ROWS);
    return {
      merchants: shown,
      restFils: rest.reduce((s, m) => s + m.totalFils, 0),
      restCount: rest.length,
      // The header is derived FROM the rows rather than computed alongside
      // them, so the two cannot drift apart however the rounding falls.
      shownTotalFils: all.reduce((s, m) => s + m.totalFils, 0),
    };
  }, [state.transactions, key, picked, liveAccounts, internal]);

  const limitFils = parseAmountToFils(text);
  const ratio = limitFils ? spent / limitFils : 0;
  const over = ratio >= 1;
  // Only a live month has days left. `key` is whatever month Flow was
  // showing, so on a March period in July this counted down inside a month
  // that ended four months ago — "AED 400 left with 5 days still to go."
  //
  // Both halves are measured against the PERIOD, not the calendar: the old
  // `daysInMonth(key) - new Date().getDate()` ignored a salary-day month start
  // and cheerfully offered "13 days still to go" for a month already over.
  // elapsedDays gets the real ledger because a salary-day period's start is
  // inferred from it.
  const now = useMemo(() => new Date(), []);
  const period = useMemo(() => ({ mode: 'month' as const, key }), [key]);
  const live = isCurrentMonth(period, now);
  const daysLeft = live
    ? Math.max(0, daysInPeriod(period, now) - elapsedDays(period, now, state.transactions))
    : 0;

  const suggestions = useMemo(() => {
    const out: { fils: number; note: string; highlight: boolean }[] = [];
    if (threeMonthAverage > 0) {
      out.push({
        fils: roundToHundred(threeMonthAverage),
        note: t('threeMonthAverageNote'),
        highlight: true,
      });
    }
    // The fixed suggestions were de-duplicated against the computed ones and
    // the computed ones were not de-duplicated against each other, so a month
    // running close to its own three-month average offered "AED 2,100 · your
    // 3-month average" beside "AED 2,100 · 10% under this month" — the same
    // number twice, under two explanations that cannot both be the reason.
    const add = (fils: number, note: string, highlight = false) => {
      if (!out.some((s) => s.fils === fils)) out.push({ fils, note, highlight });
    };
    if (spent > 0) add(roundToHundred(spent * 0.9), t('tenPercentUnderMonth'));
    for (const fils of [50_000, 100_000, 200_000]) add(fils, '');
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

  const removeExisting = () => {
    if (!existing) return;
    deleteBudget(existing.category);
    onClose();
  };

  return (
    <BottomSheet
      visible={open}
      onClose={onClose}
      title={
        picked
          ? tf('categoryLimit', { category: categoryLabel(getCategory(picked)) })
          : t('newLimitTitle')
      }
      footer={(
        <View style={styles.actions}>
          {existing ? (
            <Button
              inline
              label={t('remove')}
              variant="danger"
              onPress={removeExisting}
            />
          ) : null}
          <Button
            inline
            label={t('saveLimit')}
            disabled={!picked || !limitFils}
            onPress={save}
          />
        </View>
      )}>
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
                        {categoryLabel(c)}
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
                    {t('spentThisMonth')}
                  </ThemedText>
                  <ThemedText
                    type="smallBold"
                    tabular
                    style={{ color: over ? theme.expense : theme.text }}>
                    {formatAED(shownTotalFils, { decimals: false })}
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
                    ? tf('limitOverBy', { amount: formatAED(spent - limitFils, { decimals: false }) })
                    : tf('limitAmountLeft', { amount: formatAED(limitFils - spent, { decimals: false }) })}
                  {daysLeft > 0 ? tf('timeStillToGo', { days: daysLeft, s: daysLeft === 1 ? '' : 's' }) : '.'}
                </ThemedText>
              </View>
            )}

            <View style={styles.amountBlock}>
              <TextField
                numeric
                label={t('monthlyLimit')}
                value={text}
                onChangeText={setText}
                placeholder="0"
                placeholderTextColor={theme.textTertiary}
                selectionColor={theme.primary}
                leading={(
                <ThemedText type="smallBold" themeColor="textSecondary" tabular style={styles.aed}>
                  {ledgerCurrencyDisplay()}
                </ThemedText>
                )}
                style={styles.amountInput}
              />
            </View>

            {picked && (
              <View style={styles.suggestions}>
                {suggestions.map((s) => (
                  <Pressable
                    key={`${s.fils}-${s.note}`}
                    onPress={() => setText(formatAmount(s.fils).replace(/,/g, ''))}
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
                <SectionHeader title={t('whereItWent')} />
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
                    <ThemedText type="smallBold" tabular style={[styles.whereFigure, { textAlign: alignEnd() }]}>
                      {formatAED(m.totalFils, { decimals: false })}
                    </ThemedText>
                  </View>
                ))}
                {restCount > 0 && (
                  <View
                    style={[
                      styles.whereRow,
                      { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
                    ]}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.whereName}>
                      {tf('moreMerchants', { count: restCount, s: restCount === 1 ? '' : 's' })}
                    </ThemedText>
                    <ThemedText type="smallBold" tabular themeColor="textSecondary" style={[styles.whereFigure, { textAlign: alignEnd() }]}>
                      {formatAED(restFils, { decimals: false })}
                    </ThemedText>
                  </View>
                )}
              </View>
            )}
    </BottomSheet>
  );
}

/** Suggestions land on a round number — nobody budgets AED 1,247. */
function roundToHundred(fils: number): number {
  return Math.max(10_000, Math.round(fils / 10_000) * 10_000);
}

const styles = StyleSheet.create({
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
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
  amountBlock: { marginTop: Spacing.four },
  aed: { fontSize: 15 },
  amountInput: {
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.7,
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
  whereFigure: { minWidth: 62 },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
