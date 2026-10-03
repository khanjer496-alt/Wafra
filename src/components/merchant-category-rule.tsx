import { useCategoryCatalog } from '@/hooks/use-category-catalog';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { GlyphTile } from '@/components/ui/band/glyph-tile';
import { CategoryChips } from '@/components/ui/category-chips';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';

import { detailsWords } from '@/lib/details-copy';
import { t, tf } from '@/lib/i18n';
import { merchantRuleSummary } from '@/lib/merchant-insights';
import { merchantSpendingKey } from '@/lib/merchant-spending';
import { spendingDetailsCopy } from '@/lib/spending-details-copy';
import { useStore } from '@/lib/store';
import type { CategoryId } from '@/lib/types';

/** The same minimum the entry sheet applies before it offers a merchant rule. */
const MIN_RULE_KEY_LENGTH = 3;

/**
 * "Always <Category>" for one merchant: the saved merchant rule, the number of
 * entries it governs, and a way to change it.
 *
 * Changing it is the entry sheet's own flow, not a new one: the same store
 * action (`setMerchantOverride`) and the same two shapes — a choice between
 * "just future" and "update all N" when existing entries would move, a plain
 * confirmation when none would — with the same copy. N is counted with the
 * reducer's own predicate (merchantRuleSummary), so it is the number of rows
 * the rewrite changes.
 */
export function MerchantCategoryRule({ merchant, kind, palette }: {
  merchant: string;
  kind: 'expense' | 'income';
  /** The screen's band: the row is a card on its sheet, "Change" in its tint. */
  palette: BandPalette;
}) {
  const { categoryLabel, expenseCategories, incomeCategories } = useCategoryCatalog();
  const language = useLanguage();
  const d = detailsWords(language);
  const words = spendingDetailsCopy(language);
  const lang = language === 'ar' ? 'ar' : 'en';
  const { state, setMerchantOverride } = useStore();
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<{ category: CategoryId; count: number } | null>(null);
  const rule = useMemo(() => merchantRuleSummary(state.transactions, state.merchantOverrides, merchant, kind),
    [state.transactions, state.merchantOverrides, merchant, kind]);
  if (merchantSpendingKey(merchant).length < MIN_RULE_KEY_LENGTH) return null;

  const choose = (category: CategoryId) => {
    setOpen(false);
    if (category === rule.category) return;
    setAsk({ category, count: rule.movable(category) });
  };
  const title = rule.category ? d.merchant.always(categoryLabel(rule.category, lang)) : d.merchant.noRule;
  const body = `${rule.category ? d.merchant.alwaysBody(merchant) : d.merchant.noRuleBody} · ${d.entries(rule.applies)}`;

  return <>
    <Pressable testID="merchant-category-rule" accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`} accessibilityHint={d.merchant.ruleAction}
      onPress={() => setOpen(true)}
      style={({ pressed }) => [styles.row, { borderColor: palette.rule, backgroundColor: palette.card, opacity: pressed ? 0.8 : 1 }]}>
      <GlyphTile category={rule.category ?? 'other'} palette={palette} size={36} />
      <View style={styles.copy}>
        <ThemedText type="smallBold" style={{ color: palette.text }}>{title}</ThemedText>
        <ThemedText type="meta" style={{ color: palette.textSecondary }}>{body}</ThemedText>
      </View>
      <ThemedText type="smallBold" style={[styles.change, { color: palette.tint }]}>{words.change}</ThemedText>
    </Pressable>
    <BottomSheet visible={open} onClose={() => setOpen(false)} title={d.merchant.ruleTitle} subtitle={merchant}
      palette={palette} testID="merchant-category-rule-sheet">
      <CategoryChips createType={kind} categories={kind === 'income' ? incomeCategories : expenseCategories} selected={rule.category}
        onToggle={choose} layout="wrap" />
    </BottomSheet>
    {ask && ask.count > 0 && <ChoiceSheet visible onClose={() => setAsk(null)}
      title={t('remember')}
      question={tf('rememberForMerchant', { merchant })}
      body={tf('merchantRuleAlso', { merchant, n: ask.count, entries: ask.count === 1 ? 'entry' : 'entries' })}
      options={[{ value: 'future', label: t('justFuture') }, { value: 'all', label: t('yesUpdateAll') }]}
      onSelect={(scope) => setMerchantOverride(merchant, ask.category, scope === 'all', kind)} />}
    {ask && ask.count === 0 && <ConfirmSheet visible onClose={() => setAsk(null)}
      question={tf('rememberForMerchant', { merchant })}
      body={tf('merchantRuleOnly', { merchant })}
      confirmLabel={t('remember')} cancelLabel={t('no')}
      onConfirm={() => setMerchantOverride(merchant, ask.category, false, kind)} />}
  </>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingVertical: 12,
    paddingHorizontal: 16, borderWidth: 1, borderRadius: 18 },
  copy: { flex: 1, minWidth: 160, gap: 2 },
  change: { fontFamily: Fonts.sansSemi },
});
