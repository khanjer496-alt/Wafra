import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { CategoryAvatar } from '@/components/ui/category-avatar';
import { CategoryChips } from '@/components/ui/category-chips';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Icon } from '@/components/ui/icon';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/categories';
import { detailsWords } from '@/lib/details-copy';
import { t, tf } from '@/lib/i18n';
import { merchantRuleSummary } from '@/lib/merchant-insights';
import { merchantSpendingKey } from '@/lib/merchant-spending';
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
export function MerchantCategoryRule({ merchant, kind }: { merchant: string; kind: 'expense' | 'income' }) {
  const theme = useTheme(); const language = useLanguage();
  const d = detailsWords(language);
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
      style={({ pressed }) => [styles.row, { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
      <CategoryAvatar category={rule.category ?? 'other'} size={32} />
      <View style={styles.copy}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{body}</ThemedText>
      </View>
      <Icon name="chevron-right" size={16} color={theme.textTertiary} />
    </Pressable>
    <BottomSheet visible={open} onClose={() => setOpen(false)} title={d.merchant.ruleTitle} subtitle={merchant}
      testID="merchant-category-rule-sheet">
      <CategoryChips categories={kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES} selected={rule.category}
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
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderRadius: 12 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
});
