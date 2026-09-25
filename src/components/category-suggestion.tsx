import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Spacing } from '@/constants/theme';
import { categoryLabel } from '@/lib/categories';
import { tf, t } from '@/lib/i18n';
import { onDeviceAI } from '@/lib/on-device-ai';
import { categoryAdvisor, type CategoryAdvice } from '@/lib/on-device-category';
import type { CategoryId } from '@/lib/types';
import type { DirectionalCategoryRule } from '@/lib/universal-categorization';

/**
 * One suggested category above the full picker for an unresolved merchant.
 * Rules answer first; the platform model is asked only when they cannot.
 * Nothing is written until the user taps the suggestion (which goes through
 * the screen's normal assign path), and nothing shows when there is no
 * confident suggestion or no on-device model.
 */
export function CategorySuggestion({ merchant, count, language, overrides, rules, market, onUse }: {
  merchant: string;
  count: number;
  language: 'en' | 'ar';
  overrides?: Readonly<Record<string, CategoryId>>;
  rules?: readonly DirectionalCategoryRule[];
  market?: string;
  onUse: (category: CategoryId) => void;
}) {
  const [advice, setAdvice] = useState<CategoryAdvice | 'pending' | null>(null);
  useEffect(() => {
    let current = true;
    setAdvice(null);
    void (async () => {
      const availability = await onDeviceAI.getAvailability();
      // Show "checking" only when a model can actually answer.
      if (current && availability.status === 'available') setAdvice('pending');
      const next = await categoryAdvisor.suggest({
        merchant, appLanguage: language, overrides, rules, market, cancelled: () => !current,
      });
      if (current) setAdvice(next);
    })().catch(() => { if (current) setAdvice(null); });
    return () => { current = false; };
  }, [merchant, language, overrides, rules, market]);

  if (advice === null || (advice !== 'pending' && advice.kind === 'none')) return null;
  if (advice === 'pending') {
    return <ThemedText testID="category-suggestion-pending" type="meta" themeColor="textSecondary"
      accessibilityLiveRegion="polite">{t('categoriseSuggestionChecking')}</ThemedText>;
  }
  const label = categoryLabel(advice.category, language);
  return (
    <View testID="category-suggestion" accessibilityLiveRegion="polite" style={styles.box}>
      <ThemedText type="small">
        {tf(advice.kind === 'on-device-ai' ? 'categoriseAiSuggestion' : 'categoriseRuleSuggestion', { category: label })}
      </ThemedText>
      <Button variant="outline" label={tf('categoriseSuggestionUse', { category: label })}
        onPress={() => onUse(advice.category)} />
      <ThemedText type="meta" themeColor="textSecondary">
        {tf('categoriseSuggestionNote', { count, ending: count === 1 ? 'y' : 'ies' })}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: Spacing.two, paddingHorizontal: Spacing.one },
});
