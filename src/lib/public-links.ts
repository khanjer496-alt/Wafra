import Constants from 'expo-constants';

export type PublicLinkKey = 'privacyPolicyUrl' | 'termsOfUseUrl' | 'supportUrl';

export const configuredPublicUrl = (key: PublicLinkKey): string | null => {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const value = extra?.[key];
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};
