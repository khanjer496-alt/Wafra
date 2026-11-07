/**
 * The SDK uses an explicitly selected regional language variant, or combines
 * a language-only preference with the actual device region. The bank-support
 * market and the ledger denomination are independent;
 * neither determines a Play/App Store account's billing country or currency.
 */
export function billingLocaleIdentifier(languageTag: string, deviceRegion?: string | null): string {
  // Keep language/script/region from a canonical BCP-47 tag (extensions do not
  // select the paywall translation). Accept underscores at this SDK boundary.
  const normalized = typeof languageTag === 'string' ? languageTag.trim().replace(/_/g, '-') : '';
  const parts = /^([a-z]{2,3})(?:-([a-z]{4}))?(?:-([a-z]{2}|\d{3}))?(?:-[a-z0-9]{1,8})*$/i.exec(normalized);
  const language = parts?.[1].toLowerCase() ?? 'en';
  const script = parts?.[2] ? parts[2][0].toUpperCase() + parts[2].slice(1).toLowerCase() : undefined;
  const actualRegion = deviceRegion?.trim() ?? '';
  const region = parts?.[3]?.toUpperCase() ?? (/^(?:[a-z]{2}|\d{3})$/i.test(actualRegion)
    ? actualRegion.toUpperCase() : undefined);
  // A language-only locale is valid. Missing region data must not silently
  // turn someone in another country into a UAE locale.
  return [language, script, region].filter(Boolean).join('_');
}
