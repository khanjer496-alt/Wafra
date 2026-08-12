/**
 * Sort merchants — the half of the accuracy problem only the user can answer.
 *
 * `/accuracy` collects bank message FORMATS the parser could not read and
 * mails them to the developer, so the next release handles them. This screen
 * is for the opposite failure: the parser read the message perfectly, lifted
 * the right merchant name out of it, and has no idea what that merchant sells.
 * No rule list will ever contain "AL BAIT ALHAMAWI SUP" — there are hundreds
 * of thousands of shops here — so there is no release that fixes it. One real
 * ledger carried 182 correctly-named transactions in `other`.
 *
 * The app has always been able to learn a merchant: recategorise a row and it
 * offers to remember the shop and update every other entry from it. The flaw
 * was the trigger. It fired only if the user happened to OPEN that one row,
 * which nobody does 182 times. So the list is inverted here — the merchants
 * come to the user, biggest first, and each one costs a single tap.
 *
 * ONE OPEN AT A TIME, AND IT ADVANCES. The category picker is twenty chips;
 * stacking twenty of them under forty merchants is a screen nobody scrolls and
 * a lot of views to lay out. So one merchant is open, and assigning it opens
 * the next — which makes the second merchant onward genuinely one tap each,
 * with no aiming in between.
 *
 * APPLY TO EXISTING IS NOT OPTIONAL HERE. `setMerchantOverride(m, c, true)`.
 * The entry sheet asks "just future, or update all?" because the user is
 * looking at one row and might mean only that row. On this screen the row IS
 * the merchant, the count of entries behind it is printed on it, and moving 33
 * entries with one tap is the entire reason to be here.
 *
 * WHICH MAKES THE PRINTED COUNT LOAD-BEARING. It is the only warning the user
 * gets before a bulk rewrite, so it has to be the number of rows the reducer
 * actually moves — not the number of rows that put this merchant on the list.
 * `uncategorised.ts` keeps those two questions apart deliberately, and every
 * number on this screen (`categoriseEntries` on the row, `categoriseAssigned`
 * in the toast, `categoriseRemaining` in the header, and the `sortedRows`
 * tally at the end) reads `count`/`rowCount`, which are computed with
 * `overrideAppliesTo` — the same predicate `setMerchantOverride` applies.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CategoryChips } from '@/components/ui/category-chips';
import { Icon } from '@/components/ui/icon';
import { Row, ScreenHeader, Section } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel, EXPENSE_CATEGORIES } from '@/lib/categories';
import { shortDate } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import { useStore } from '@/lib/store';
import { uncategorisedMerchants } from '@/lib/uncategorised';
import type { CategoryId } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

export default function CategoriseScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { state, setMerchantOverride } = useStore();

  const summary = useMemo(() => uncategorisedMerchants(state), [state]);
  const { merchants } = summary;

  // Which merchant's chips are showing. Seeded to nothing rather than to the
  // first row so the screen opens as a readable list — the user gets to see
  // what they are being asked before a picker takes over the top of it — and
  // then advances on its own from the first tap.
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Rows moved in this visit. The list shrinking is the progress bar, but at
  // the end the list is empty and shows nothing about what just happened; this
  // is what lets the finished state say what the visit was worth.
  const [sortedRows, setSortedRows] = useState(0);

  const assign = useCallback(
    (merchant: string, key: string, count: number, category: CategoryId) => {
      tapped();
      // The next merchant on the CURRENT list, chosen before the store update
      // removes this one — afterwards the index no longer means anything.
      const at = merchants.findIndex((m) => m.key === key);
      const next = at >= 0 ? merchants[at + 1] : undefined;

      // `true`: past entries as well as future ones. See the header.
      setMerchantOverride(merchant, category, true);
      setSortedRows((n) => n + count);
      setOpenKey(next ? next.key : null);
      toast.show(
        tf('categoriseAssigned', {
          count,
          ending: count === 1 ? 'y' : 'ies',
          category: categoryLabel(category, state.language === 'ar' ? 'ar' : 'en'),
        }),
        { tone: 'success' },
      );
    },
    [merchants, setMerchantOverride, state.language, toast],
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('categoriseMerchants')} onBack={() => router.back()} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Section index={0} style={styles.intro}>
            <ThemedText type="default" themeColor="textSecondary">
              {t('categoriseIntro')}
            </ThemedText>
            {merchants.length > 0 && (
              <ThemedText type="meta" themeColor="textTertiary">
                {tf('categoriseRemaining', {
                  count: merchants.length,
                  s: merchants.length === 1 ? '' : 's',
                  rows: summary.rowCount,
                  ending: summary.rowCount === 1 ? 'y' : 'ies',
                })}
              </ThemedText>
            )}
          </Section>

          {merchants.map((m, i) => {
            const open = openKey === m.key;
            return (
              <View key={m.key}>
                <Row
                  last={i === merchants.length - 1 && !open}
                  onPress={() => {
                    tapped();
                    setOpenKey(open ? null : m.key);
                  }}
                  accessibilityLabel={tf('categoriseChooseA11y', { merchant: m.merchant })}
                  style={styles.merchantRow}>
                  <View style={styles.merchantText}>
                    <ThemedText type="small" numberOfLines={1}>
                      {m.merchant}
                    </ThemedText>
                    <ThemedText type="meta" themeColor="textTertiary">
                      {tf('categoriseEntries', {
                        count: m.count,
                        ending: m.count === 1 ? 'y' : 'ies',
                        date: shortDate(m.lastDate),
                      })}
                    </ThemedText>
                  </View>
                  <Money fils={m.totalFils} />
                  <Icon
                    name={open ? 'chevron-down' : 'chevron-right'}
                    size={16}
                    color={theme.textTertiary}
                  />
                </Row>
                {open && (
                  // `other` is deliberately still in the set. Tapping it is not
                  // a no-op: it writes the rule, which takes this merchant off
                  // the list for good. That is the escape hatch for a shop the
                  // user genuinely cannot classify, and without it the last few
                  // rows of a long list are unfinishable.
                  <View style={styles.chips}>
                    <CategoryChips
                      categories={EXPENSE_CATEGORIES}
                      selected={null}
                      onToggle={(id) => assign(m.merchant, m.key, m.count, id)}
                      layout="wrap"
                    />
                  </View>
                )}
              </View>
            );
          })}

          {merchants.length === 0 && (
            <Section index={1} style={styles.empty}>
              <Icon name="check" size={26} color={theme.income} strokeWidth={2.1} />
              <ThemedText type="small">{t('categoriseDone')}</ThemedText>
              {sortedRows > 0 && (
                <ThemedText type="default">
                  {tf('categoriseDoneCount', {
                    count: sortedRows,
                    ending: sortedRows === 1 ? 'y' : 'ies',
                  })}
                </ThemedText>
              )}
              <ThemedText type="default" themeColor="textSecondary">
                {t('categoriseDoneBody')}
              </ThemedText>
            </Section>
          )}
        </ScrollView>
      </SafeAreaView>
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
  headerWrap: {
    paddingHorizontal: ScreenPadding,
  },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.six,
  },
  intro: {
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  merchantRow: {
    paddingVertical: Spacing.three - 2,
  },
  merchantText: {
    flex: 1,
    gap: Spacing.two - 4,
  },
  chips: {
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  empty: {
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
});
