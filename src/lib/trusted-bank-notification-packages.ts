/**
 * Curated current and launch-tested legacy Android bank-app package identities.
 * Native capture additionally requires Google Play install provenance. Unknown
 * packages are refused even when their notification imitates a bank alert.
 * Keep aligned with the native listener map; contracts.test.js enforces it.
 */
export const TRUSTED_BANK_NOTIFICATION_PACKAGES = {
  'com.emiratesnbd.android': 'AE',
  'com.adcb.nexgen': 'AE',
  'com.adcb.bank': 'AE',
  'com.fab.personalbanking': 'AE',
  'com.vipera.ts.starter.MashreqAE': 'AE',
  'io.wio.retail': 'AE',
  'ae.wio.personal': 'AE',
  'com.alrajhiretailapp': 'SA',
  'com.BankAlBilad': 'SA',
  'com.bankalbilad.NewRMB': 'SA',
  'com.riyadbank.digitalmobile': 'SA',
  'com.AamalTech.alinmaBank': 'SA',
  'net.bnpparibas.mescomptes': 'FR',
  'com.barclays.android.barclaysmobilebanking': 'GB',
  'com.hdfcbank.android.now': 'IN',
} as const;

export type TrustedBankNotificationMarket =
  typeof TRUSTED_BANK_NOTIFICATION_PACKAGES[keyof typeof TRUSTED_BANK_NOTIFICATION_PACKAGES];

export const trustedBankNotificationMarket = (
  packageName: string,
): TrustedBankNotificationMarket | null =>
  Object.prototype.hasOwnProperty.call(TRUSTED_BANK_NOTIFICATION_PACKAGES, packageName)
    ? TRUSTED_BANK_NOTIFICATION_PACKAGES[
        packageName as keyof typeof TRUSTED_BANK_NOTIFICATION_PACKAGES
      ]
    : null;

/**
 * Canonical issuer header used only after the native listener has verified the
 * exact Play-installed package. It lets the review grammar use package
 * identity without treating a notification title/body as issuer proof.
 */
const TRUSTED_GLOBAL_NOTIFICATION_SENDERS: Partial<
  Record<keyof typeof TRUSTED_BANK_NOTIFICATION_PACKAGES, string>
> = {
  'net.bnpparibas.mescomptes': 'BNPPARIBAS',
  'com.barclays.android.barclaysmobilebanking': 'BARCLAYS',
  'com.hdfcbank.android.now': 'HDFCBK',
};

export const trustedBankNotificationSender = (packageName: string): string | null =>
  Object.prototype.hasOwnProperty.call(TRUSTED_GLOBAL_NOTIFICATION_SENDERS, packageName)
    ? TRUSTED_GLOBAL_NOTIFICATION_SENDERS[
        packageName as keyof typeof TRUSTED_GLOBAL_NOTIFICATION_SENDERS
      ] ?? null
    : null;
