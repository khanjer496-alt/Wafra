import React, { createContext, useContext } from 'react';

import type { Lang } from '@/lib/i18n';

/**
 * The UI language as reactive render state.
 *
 * The translation module also keeps the active language for pure formatting
 * helpers, but that module-level value is invisible to React. This context is
 * deliberately tiny: changing a transaction does not invalidate every text
 * node, while changing the language does.
 */
const LanguageContext = createContext<Lang>('en');

export function LanguageProvider({
  language,
  children,
}: {
  language: Lang;
  children: React.ReactNode;
}) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): Lang {
  return useContext(LanguageContext);
}
