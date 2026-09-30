import { useMemo } from 'react';
import { categoriesForType, categoryLabel, getCategory } from '@/lib/categories';
import { useStoreSelector } from '@/lib/store';
import type { CustomCategory } from '@/lib/types';

const EMPTY: readonly CustomCategory[] = [];

/** Names belong to this ledger. Subscribe only to its catalog, never a global registry. */
export function useCategoryCatalog() {
  const catalog = useStoreSelector(({ state }) => state.customCategories ?? EMPTY);
  return useMemo(() => ({
    catalog,
    getCategory: (id: Parameters<typeof getCategory>[0]) => getCategory(id, catalog),
    categoryLabel: (category: Parameters<typeof categoryLabel>[0], language?: Parameters<typeof categoryLabel>[1]) =>
      categoryLabel(category, language, catalog),
    expenseCategories: categoriesForType('expense', catalog),
    incomeCategories: categoriesForType('income', catalog),
  }), [catalog]);
}
