/**
 * Improve categories — only the low-confidence cases the user can answer.
 *
 * `/accuracy` collects bank message FORMATS the parser could not read and
 * mails them to the developer, so the next release handles them. This screen
 * is for the opposite failure: the parser read the message, but either cannot
 * tell what a merchant sells OR knows this was a bank bill payment whose saved
 * nickname is not reliable merchant identity.
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
import { WorkflowHero } from '@/components/workflows/workflow-surfaces';
import { workflowCopy } from '@/components/workflows/workflow-copy';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CategoryChips } from '@/components/ui/category-chips';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { useToast } from '@/components/ui/toast';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel, EXPENSE_CATEGORIES } from '@/lib/categories';
import { shortDate } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import { useStore } from '@/lib/store';
import { uncategorisedMerchants, type UncategorisedMerchant, type UncategorisedPaymentPurpose } from '@/lib/uncategorised';
import type { CategoryId } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

const INITIAL_VISIBLE_ITEMS = 12;

type CategoriseItem =
  | ({ kind: 'merchant' } & UncategorisedMerchant)
  | ({ kind: 'payment-purpose' } & UncategorisedPaymentPurpose);

export default function CategoriseScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { state, setMerchantOverride, setBillAlias } = useStore();
  const words = workflowCopy(state.language);

  const summary = useMemo(() => uncategorisedMerchants(state), [state]);
  const items = useMemo<CategoriseItem[]>(() => [
    // Payment aliases are the dangerous cases: a bank nickname can look like a
    // merchant while actually being SEWA, Salik, internet, rent, etc. Put them
    // first so the user fixes the cases where a name-based guess would be worst.
    ...summary.paymentPurposes.map((item) => ({ ...item, kind: 'payment-purpose' as const })),
    ...summary.merchants.map((item) => ({ ...item, kind: 'merchant' as const })),
  ], [summary]);

  // Which merchant's chips are showing. Seeded to nothing rather than to the
  // first row so the screen opens as a readable list — the user gets to see
  // what they are being asked before a picker takes over the top of it — and
  // then advances on its own from the first tap.
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Rows moved in this visit. The list shrinking is the progress bar, but at
  // the end the list is empty and shows nothing about what just happened; this
  // is what lets the finished state say what the visit was worth.
  const [sortedRows, setSortedRows] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const visibleItems = showAll ? items : items.slice(0, INITIAL_VISIBLE_ITEMS);

  const assign = useCallback(
    (item: CategoriseItem, category: CategoryId) => {
      tapped();
      // The next item on the CURRENT list, chosen before the store update
      // removes this one — afterwards the index no longer means anything.
      const at = items.findIndex((candidate) => candidate.key === item.key && candidate.kind === item.kind);
      const next = at >= 0 ? items[at + 1] : undefined;

      if (item.kind === 'payment-purpose') {
        // Keep the bank's displayed nickname as the title unless the user later
        // renames it in transaction details. The important learning here is the
        // economic purpose, scoped to the bill identity rather than the name.
        setBillAlias(item.sourceTitle, item.billIdentity, item.sourceTitle, category, true);
      } else {
        setMerchantOverride(item.merchant, category, true);
      }
      setSortedRows((n) => n + item.count);
      setOpenKey(next && (showAll || at + 1 < INITIAL_VISIBLE_ITEMS) ? next.key : null);
      toast.show(
        tf(item.kind === 'payment-purpose' ? 'categorisePurposeAssigned' : 'categoriseAssigned', {
          count: item.count,
          ending: item.count === 1 ? 'y' : 'ies',
          category: categoryLabel(category, state.language === 'ar' ? 'ar' : 'en'),
        }),
        { tone: 'success' },
      );
    },
    [items, setBillAlias, setMerchantOverride, showAll, state.language, toast],
  );

  const categoriseHeader: ScreenHeaderProps = {
    title: t('categoriseMerchants'),
    back: { label: t('back'), onPress: () => router.back() },
  };

  return (
    <>
      <ScreenScaffold
        headerMode="native"
        header={categoriseHeader}
        scrollProps={{ showsVerticalScrollIndicator: false }}>
          <Section index={0} style={styles.intro}>
            <WorkflowHero title={words.sortTitle} body={words.sortBody} icon="cart"
              facts={items.length > 0 ? [{ label: words.merchants, value: String(items.length) },
                { label: words.entries, value: String(summary.rowCount) }] : []} />
          </Section>

          {visibleItems.map((item, i) => {
            const open = openKey === item.key;
            const label = item.kind === 'payment-purpose' ? item.sourceTitle : item.merchant;
            return (
              <View key={`${item.kind}:${item.key}`} style={[styles.merchantCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                <Row
                  last={i === visibleItems.length - 1 && !open}
                  onPress={() => {
                    tapped();
                    setOpenKey(open ? null : item.key);
                  }}
                  accessibilityLabel={tf(item.kind === 'payment-purpose' ? 'categorisePurposeA11y' : 'categoriseChooseA11y', { merchant: label })}
                  style={styles.merchantRow}>
                  <View style={styles.merchantText}>
                    {item.kind === 'payment-purpose' && (
                      <ThemedText type="nano" style={{ color: theme.warning }}>
                        {t('categorisePaymentPurpose')}
                      </ThemedText>
                    )}
                    <ThemedText type="smallBold">
                      {label}
                    </ThemedText>
                    <ThemedText type="meta" themeColor="textTertiary">
                      {tf('categoriseEntries', {
                        count: item.count,
                        ending: item.count === 1 ? 'y' : 'ies',
                        date: shortDate(item.lastDate),
                      })}
                    </ThemedText>
                  </View>
                  <Money fils={item.totalFils} />
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
                    {item.kind === 'payment-purpose' && (
                      <ThemedText type="meta" themeColor="textSecondary" style={styles.purposeHint}>
                        {t('categorisePaymentPurposeHint')}
                      </ThemedText>
                    )}
                    <CategoryChips
                      categories={EXPENSE_CATEGORIES}
                      selected={null}
                      onToggle={(id) => assign(item, id)}
                      layout="wrap"
                    />
                  </View>
                )}
              </View>
            );
          })}

          {!showAll && items.length > INITIAL_VISIBLE_ITEMS && (
            <Button
              variant="outline"
              label={tf('categoriseShowAll', { count: items.length })}
              onPress={() => setShowAll(true)}
            />
          )}
          {showAll && items.length > INITIAL_VISIBLE_ITEMS && (
            <Button variant="ghost" label={t('categoriseShowPriority')} onPress={() => {
              setShowAll(false);
              setOpenKey(null);
            }} />
          )}

          {items.length === 0 && (
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
      </ScreenScaffold>
    </>
  );
}

const styles = StyleSheet.create({
  merchantCard: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, marginBottom: 12, overflow: 'hidden' },
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
    gap: Spacing.two,
  },
  purposeHint: { paddingHorizontal: Spacing.one },
  empty: {
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
});
