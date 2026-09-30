import { useCategoryCatalog } from '@/hooks/use-category-catalog';
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
 * come to the user, biggest first.
 *
 * EVERY ROW IS OPEN, WITH ONE SUGGESTION. Each merchant shows its single
 * suggested category (rules first, then the on-device model, asked one
 * merchant at a time — see useCategorySuggestions) and a "Choose…" chip that
 * opens the full twenty-category picker for that row only. Answers are STAGED:
 * nothing is written until "Save N answers", which applies every staged
 * answer in one go.
 *
 * APPLY TO EXISTING IS NOT OPTIONAL HERE. `setMerchantOverride(m, c, true)`.
 * The entry sheet asks "just future, or update all?" because the user is
 * looking at one row and might mean only that row. On this screen the row IS
 * the merchant, the count of entries behind it is printed on it, and moving 33
 * entries with one answer is the entire reason to be here.
 *
 * WHICH MAKES THE PRINTED COUNT LOAD-BEARING. It is the only warning the user
 * gets before a bulk rewrite, so it has to be the number of rows the reducer
 * actually moves — not the number of rows that put this merchant on the list.
 * `uncategorised.ts` keeps those two questions apart deliberately, and every
 * number on this screen (`categoriseEntries` on the row, the saved toast and
 * the `sortedRows` tally at the end) reads `count`/`rowCount`, which are
 * computed with `overrideAppliesTo` — the same predicate `setMerchantOverride`
 * applies.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useCategorySuggestions } from '@/components/category-suggestion';
import { ThemedText } from '@/components/themed-text';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { CategoryChips } from '@/components/ui/category-chips';
import { Icon } from '@/components/ui/icon';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Money } from '@/components/ui/money';
import { useToast } from '@/components/ui/toast';
import { Fonts, Radius, Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';

import { detailsWords } from '@/lib/details-copy';
import { shortDate } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import { reviewBandCopy } from '@/lib/review-band-copy';
import { useStore } from '@/lib/store';
import { uncategorisedMerchants, type UncategorisedMerchant, type UncategorisedPaymentPurpose } from '@/lib/uncategorised';
import type { CategoryId } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

const INITIAL_VISIBLE_ITEMS = 12;
/**
 * "Review all" pages rather than mounting every merchant card at once: one
 * real ledger had 182 names in `other`, each a card of text, a figure and an
 * icon inside the scroll view.
 */
const REVIEW_PAGE = 40;

type CategoriseItem =
  | ({ kind: 'merchant' } & UncategorisedMerchant)
  | ({ kind: 'payment-purpose' } & UncategorisedPaymentPurpose);

const itemId = (item: CategoriseItem) => `${item.kind}:${item.key}`;

/** A suggestion or answer pill on the sand sheet: ink when chosen, a card with a rule otherwise. */
function Chip({ label, selected, onPress, testID, icon, palette }: {
  label: string; selected: boolean; onPress: () => void; testID?: string; icon?: 'spark' | 'chevron-down'; palette: BandPalette;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }}
    onPress={onPress}
    style={({ pressed }) => [styles.chip, {
      borderColor: selected ? palette.fill : palette.rule,
      backgroundColor: selected ? palette.fill : palette.card,
      opacity: pressed ? 0.8 : 1,
    }]}>
    {icon ? <Icon name={icon} size={14} color={selected ? palette.onFill : palette.textSecondary} /> : null}
    <ThemedText type="smallBold" style={{ color: selected ? palette.onFill : palette.text }}>{label}</ThemedText>
  </Pressable>;
}

export default function CategoriseScreen() {
  const { categoryLabel, expenseCategories } = useCategoryCatalog();
  const band = useBand('settings');
  const toast = useToast();
  const { state, setMerchantOverride, setBillAlias } = useStore();
  const language = state.language === 'ar' ? 'ar' : 'en';
  const d = detailsWords(language);
  const bandWords = reviewBandCopy(language);

  const summary = useMemo(() => uncategorisedMerchants(state), [state]);
  const items = useMemo<CategoriseItem[]>(() => [
    // Payment aliases are the dangerous cases: a bank nickname can look like a
    // merchant while actually being SEWA, Salik, internet, rent, etc. Put them
    // first so the user fixes the cases where a name-based guess would be worst.
    ...summary.paymentPurposes.map((item) => ({ ...item, kind: 'payment-purpose' as const })),
    ...summary.merchants.map((item) => ({ ...item, kind: 'merchant' as const })),
  ], [summary]);

  // Staged answers, keyed by row. Nothing is written until Save.
  const [answers, setAnswers] = useState<Record<string, CategoryId>>({});
  // Which row has the full twenty-category picker open.
  const [pickerId, setPickerId] = useState<string | null>(null);
  // Rows moved in this visit. The list shrinking is the progress bar, but at
  // the end the list is empty and shows nothing about what just happened; this
  // is what lets the finished state say what the visit was worth.
  const [sortedRows, setSortedRows] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [reviewLimit, setReviewLimit] = useState(REVIEW_PAGE);
  const visibleLimit = showAll ? reviewLimit : INITIAL_VISIBLE_ITEMS;
  const visibleItems = items.slice(0, visibleLimit);

  // Merchants only. A bank bill nickname is exactly where a name-based guess
  // is worst, so payment purposes get no suggestion.
  const suggestionMerchants = useMemo(
    () => visibleItems.flatMap((item) => item.kind === 'merchant' ? [item.merchant] : []),
    [visibleItems],
  );
  const suggestions = useCategorySuggestions({
    merchants: suggestionMerchants, language, overrides: state.merchantOverrides, market: state.marketId,
  });

  const staged = items.filter((item) => answers[itemId(item)] !== undefined);

  const stage = (item: CategoriseItem, category: CategoryId) => {
    tapped();
    setAnswers((current) => ({ ...current, [itemId(item)]: category }));
    setPickerId(null);
  };
  const clear = (item: CategoriseItem) => {
    setAnswers((current) => {
      const next = { ...current };
      delete next[itemId(item)];
      return next;
    });
  };

  const save = () => {
    if (staged.length === 0) return;
    tapped();
    let moved = 0;
    for (const item of staged) {
      const category = answers[itemId(item)]!;
      if (item.kind === 'payment-purpose') {
        // Keep the bank's displayed nickname as the title unless the user later
        // renames it in transaction details. The important learning here is the
        // economic purpose, scoped to the bill identity rather than the name.
        setBillAlias(item.sourceTitle, item.billIdentity, item.sourceTitle, category, true);
      } else {
        setMerchantOverride(item.merchant, category, true);
      }
      moved += item.count;
    }
    setSortedRows((n) => n + moved);
    setAnswers({});
    setPickerId(null);
    toast.show(d.categorise.saved(moved), { tone: 'success' });
  };

  // The band: how many names wait (bank-payment nicknames are not merchants,
  // so a mixed list says "names"), and what an answer does to their entries.
  const headline = items.length === 0 ? t('categoriseDone')
    : summary.paymentPurposes.length > 0 ? bandWords.namesToPlace(items.length) : d.merchants.count(items.length);

  return (
    <BandScaffold
      band="settings"
      testID="categorise-screen"
      nav={{ back: true, title: t('categoriseMerchants') }}
      bandContent={<View testID="categorise-band" style={styles.bandIntro}>
        <ThemedText accessibilityRole="header" style={[styles.headline, { color: band.onBand }]}>{headline}</ThemedText>
        {items.length > 0 ? (
          <ThemedText type="small" style={{ color: band.onBandSecondary }}>{bandWords.placeLine(d.entries(summary.rowCount))}</ThemedText>
        ) : null}
      </View>}
      footer={staged.length > 0 ? (
        <View testID="categorise-save" accessibilityLiveRegion="polite">
          <EButton palette={band} label={d.categorise.save(staged.length)} onPress={save} />
        </View>
      ) : undefined}
      scrollProps={{ showsVerticalScrollIndicator: false }}>
      <View>
        {visibleItems.map((item) => {
          const id = itemId(item);
          const label = item.kind === 'payment-purpose' ? item.sourceTitle : item.merchant;
          const answer = answers[id];
          const advice = item.kind === 'merchant' ? suggestions.get(item.merchant) : undefined;
          const suggested = advice && advice !== 'pending' && advice.kind !== 'none' ? advice : null;
          const pickerOpen = pickerId === id;
          return (
            <View key={id} testID="categorise-row" style={[styles.row, { borderBottomColor: band.rule }]}>
              <View style={styles.merchantRow}>
                <MerchantAvatar title={label} category={answer ?? 'other'} size={40} />
                <View style={styles.merchantText}>
                  {item.kind === 'payment-purpose' && (
                    <ThemedText type="nano" style={{ color: band.statusNear }}>
                      {t('categorisePaymentPurpose')}
                    </ThemedText>
                  )}
                  <ThemedText type="smallBold" style={{ color: band.text }}>
                    {label}
                  </ThemedText>
                  <ThemedText type="meta" style={{ color: band.textSecondary }}>
                    {tf('categoriseEntries', {
                      count: item.count,
                      ending: item.count === 1 ? 'y' : 'ies',
                      date: shortDate(item.lastDate),
                    })}
                  </ThemedText>
                </View>
                <Money fils={item.totalFils} color={band.text} />
              </View>
              {advice === 'pending' && (
                <ThemedText testID="category-suggestion-pending" type="meta" style={{ color: band.textSecondary }} accessibilityLiveRegion="polite">
                  {t('categoriseSuggestionChecking')}
                </ThemedText>
              )}
              {suggested && (
                <ThemedText type="meta" style={{ color: band.textSecondary }}>
                  {tf(suggested.kind === 'on-device-ai' ? 'categoriseAiSuggestion' : 'categoriseRuleSuggestion',
                    { category: categoryLabel(suggested.category, language) })}
                </ThemedText>
              )}
              <View style={styles.chipRow} accessibilityLabel={tf(item.kind === 'payment-purpose' ? 'categorisePurposeA11y' : 'categoriseChooseA11y', { merchant: label })}>
                {suggested && <Chip testID="category-suggestion" icon="spark" palette={band}
                  label={categoryLabel(suggested.category, language)} selected={answer === suggested.category}
                  onPress={() => answer === suggested.category ? clear(item) : stage(item, suggested.category)} />}
                {answer && answer !== suggested?.category && <Chip palette={band} label={categoryLabel(answer, language)} selected
                  onPress={() => clear(item)} />}
                <Chip testID="categorise-choose" icon="chevron-down" palette={band} label={d.categorise.choose} selected={false}
                  onPress={() => { tapped(); setPickerId(pickerOpen ? null : id); }} />
              </View>
              {answer ? (
                <View style={styles.answerLine}>
                  {/* The answer and how many entries it moves when saved (the same count setMerchantOverride moves). */}
                  <ThemedText testID="categorise-staged" type="meta" style={[styles.answerText, { color: band.text }]}>
                    {`${d.categorise.staged(categoryLabel(answer, language))} · ${bandWords.entriesMoved(d.entries(item.count))}`}
                  </ThemedText>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${d.categorise.clear}: ${label}`}
                    onPress={() => clear(item)} style={styles.clearButton}>
                    <ThemedText type="meta" style={{ color: band.textSecondary }}>{d.categorise.clear}</ThemedText>
                  </Pressable>
                </View>
              ) : null}
              {pickerOpen && (
                // `other` is deliberately still in the set. Choosing it is not
                // a no-op: it writes the rule, which takes this merchant off
                // the list for good. That is the escape hatch for a shop the
                // user genuinely cannot classify, and without it the last few
                // rows of a long list are unfinishable.
                <View style={styles.chips}>
                  {item.kind === 'payment-purpose' && (
                    <ThemedText type="meta" style={[styles.purposeHint, { color: band.textSecondary }]}>
                      {t('categorisePaymentPurposeHint')}
                    </ThemedText>
                  )}
                  <CategoryChips createType="expense"
                    categories={expenseCategories}
                    selected={answer ?? null}
                    onToggle={(category) => stage(item, category)}
                    layout="wrap"
                  />
                </View>
              )}
            </View>
          );
        })}
      </View>

      {!showAll && items.length > INITIAL_VISIBLE_ITEMS && (
        <EButton
          variant="secondary"
          palette={band}
          label={tf('categoriseShowAll', { count: items.length })}
          onPress={() => setShowAll(true)}
        />
      )}
      {showAll && items.length > visibleItems.length && (
        <EButton
          variant="secondary"
          palette={band}
          label={tf('showMoreRows', { count: Math.min(REVIEW_PAGE, items.length - visibleItems.length) })}
          onPress={() => setReviewLimit(visibleItems.length + REVIEW_PAGE)}
        />
      )}
      {showAll && items.length > INITIAL_VISIBLE_ITEMS && (
        <EButton variant="quiet" palette={band} label={t('categoriseShowPriority')} onPress={() => {
          setShowAll(false);
          setReviewLimit(REVIEW_PAGE);
          setPickerId(null);
        }} />
      )}

      {items.length === 0 && (
        <View testID="categorise-done" style={styles.empty}>
          <Icon name="check" size={26} color={band.statusOk} strokeWidth={2.1} />
          {sortedRows > 0 && (
            <ThemedText type="default" style={{ color: band.text }}>
              {tf('categoriseDoneCount', {
                count: sortedRows,
                ending: sortedRows === 1 ? 'y' : 'ies',
              })}
            </ThemedText>
          )}
          <ThemedText type="default" style={{ color: band.textSecondary }}>
            {t('categoriseDoneBody')}
          </ThemedText>
        </View>
      )}
    </BandScaffold>
  );
}

const styles = StyleSheet.create({
  bandIntro: { gap: Spacing.two },
  // The band's headline: Geist SemiBold with tabular digits, never Geist Mono.
  headline: { fontFamily: Fonts.sansSemi, fontSize: 34, lineHeight: 40, letterSpacing: -1.2, fontVariant: ['tabular-nums'] },
  row: { paddingVertical: 14, gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  merchantRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  merchantText: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.two - 4,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
  answerLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  answerText: { flexShrink: 1 },
  clearButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: Spacing.one },
  chips: {
    paddingTop: Spacing.one,
    gap: Spacing.two,
  },
  purposeHint: { paddingHorizontal: Spacing.one },
  empty: {
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
});
