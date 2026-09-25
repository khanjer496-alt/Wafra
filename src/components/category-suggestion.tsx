import { useEffect, useState } from 'react';

import { onDeviceAI } from '@/lib/on-device-ai';
import { categoryAdvisor, type CategoryAdvice } from '@/lib/on-device-category';
import type { CategoryId } from '@/lib/types';
import type { DirectionalCategoryRule } from '@/lib/universal-categorization';

export type CategorySuggestionState = CategoryAdvice | 'pending';

/**
 * One suggested category per unresolved merchant, for a list where every row
 * is open at once.
 *
 * Rules answer first; the platform model is asked only when they cannot, and
 * it is asked ONE MERCHANT AT A TIME: the on-device model refuses concurrent
 * requests ("busy"), so mounting a dozen independent requests would leave
 * most rows with nothing. Each merchant gets a single suggestion — never a
 * ranked list — and nothing is written until the user picks it. A row shows
 * "checking" only while a model that can actually answer is working on it.
 */
export function useCategorySuggestions({ merchants, language, overrides, rules, market }: {
  merchants: readonly string[];
  language: 'en' | 'ar';
  overrides?: Readonly<Record<string, CategoryId>>;
  rules?: readonly DirectionalCategoryRule[];
  market?: string;
}): ReadonlyMap<string, CategorySuggestionState> {
  const [advice, setAdvice] = useState<ReadonlyMap<string, CategorySuggestionState>>(() => new Map());
  const signature = merchants.join('\u0000');
  useEffect(() => {
    let current = true;
    const list = signature ? signature.split('\u0000') : [];
    setAdvice(new Map());
    void (async () => {
      const availability = await onDeviceAI.getAvailability().catch(() => null);
      const modelReady = availability?.status === 'available';
      for (const merchant of list) {
        if (!current) return;
        if (modelReady) setAdvice((map) => new Map(map).set(merchant, 'pending'));
        const next = await categoryAdvisor.suggest({
          merchant, appLanguage: language, overrides, rules, market, cancelled: () => !current,
        }).catch((): CategoryAdvice => ({ kind: 'none', reason: 'error' }));
        if (!current) return;
        setAdvice((map) => new Map(map).set(merchant, next));
      }
    })();
    return () => { current = false; };
  }, [signature, language, overrides, rules, market]);
  return advice;
}
