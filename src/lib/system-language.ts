import type { Lang } from '@/lib/i18n';

export type LanguagePreference = 'system' | Lang;

type LocaleLike = {
  languageCode?: string | null;
  languageTag?: string;
};

export function resolveSystemLanguage(locales: readonly LocaleLike[]): Lang {
  const locale = locales[0];
  const code = locale?.languageCode ?? locale?.languageTag ?? '';
  return /^ar(?:-|$)/i.test(code) ? 'ar' : 'en';
}

export function resolveUiLanguage(
  preference: LanguagePreference,
  locales: readonly LocaleLike[],
): Lang {
  return preference === 'system' ? resolveSystemLanguage(locales) : preference;
}
